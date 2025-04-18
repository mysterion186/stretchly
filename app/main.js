const {
  app, nativeTheme, BrowserWindow, Menu, ipcMain,
  shell, dialog, globalShortcut, Tray
} = require('electron')

const path = require('path')
const i18next = require('i18next')
const Backend = require('i18next-fs-backend')
const log = require('electron-log/main')
const Store = require('electron-store')
const { registerBreakShortcuts } = require('./utils/breakShortcuts')
const ProfileManager = require('./utils/profileManager')

process.on('uncaughtException', (err, _) => {
  log.error(err)
  const dialogOpts = {
    type: 'error',
    title: 'Stretchly',
    message: 'An error occured while running Stretchly and it will now quit. To report the issue, click Report.',
    buttons: ['Report', 'OK']
  }
  dialog.showMessageBox(dialogOpts).then((returnValue) => {
    if (returnValue.response === 0) {
      shell.openExternal('https://github.com/hovancik/stretchly/issues')
    }
    app.quit()
  })
})

nativeTheme.on('updated', function theThemeHasChanged() {
  if (!gotTheLock) {
    return
  }
  updateTray()
})

const Utils = require('./utils/utils')
const IdeasLoader = require('./utils/ideasLoader')
const BreaksPlanner = require('./breaksPlanner')
const AppIcon = require('./utils/appIcon')
const { UntilMorning } = require('./utils/untilMorning')
const AutostartManager = require('./utils/autostartManager')
const Command = require('./utils/commands')

let microbreakIdeas
let breakIdeas
let breakPlanner
let profileManager = null
let appIcon = null
let autostartManager = null
let processWin = null
let microbreakWins = null
let breakWins = null
let preferencesWin = null
let welcomeWin = null
let contributorPreferencesWindow = null
let syncPreferencesWindow = null
let myStretchlyWindow = null
let settings
let pausedForSuspendOrLock = false
let nextIdea = null
let updateChecker
let currentTrayIconPath = null
let currentTrayMenuTemplate = null
let trayUpdateIntervalObj = null

require('@electron/remote/main').initialize()
log.initialize({ preload: true })

app.setAppUserModelId('net.hovancik.stretchly')

global.shared = {
  isNewVersion: false,
  isContributor: false,
  profileManager: profileManager
}

const commandLineArguments = process.argv
  .slice(app.isPackaged ? 1 : 2)

const gotTheLock = app.requestSingleInstanceLock(commandLineArguments)

if (!gotTheLock) {
  const cmd = new Command(commandLineArguments, app.getVersion(), false)
  cmd.runOrForward()
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory, commandLineArguments) => {
    log.info(`Stretchly: arguments received from second instance: ${commandLineArguments}`)
    const cmd = new Command(commandLineArguments, app.getVersion())

    if (!cmd.hasSupportedCommand) {
      return
    }

    if (!cmd.checkInMain()) {
      log.info(`Stretchly: command '${cmd.command}' executed in second instance, dropped in main instance`)
      return
    }

    switch (cmd.command) {
      case 'reset':
        log.info('Stretchly: resetting breaks (requested by second instance)')
        resetBreaks()
        break

      case 'mini': {
        log.info('Stretchly: skip to Mini Break (requested by second instance)')
        const delay = cmd.waitToMs()
        if (delay === -1) {
          log.error('Stretchly: error parsing wait interval to ms because of invalid value')
          return
        }
        if (cmd.options.title) nextIdea = [cmd.options.title]
        if (!cmd.options.noskip || delay) skipToMicrobreak(delay)
        break
      }

      case 'long': {
        log.info('Stretchly: skip to Long Break (requested by second instance)')
        const delay = cmd.waitToMs()
        if (delay === -1) {
          log.error('Stretchly: error parsing wait interval to ms because of invalid value')
          return
        }
        nextIdea = [cmd.options.title ? cmd.options.title : null, cmd.options.text ? cmd.options.text : null]
        if (!cmd.options.noskip || delay) skipToBreak(delay)
        break
      }

      case 'resume':
        log.info('Stretchly: resume Breaks (requested by second instance)')
        if (breakPlanner.isPaused) resumeBreaks(false)
        break

      case 'toggle':
        log.info('Stretchly: toggle Breaks (requested by second instance)')
        if (breakPlanner.isPaused) resumeBreaks(false)
        else pauseBreaks(1)
        break

      case 'pause': {
        log.info('Stretchly: pause Breaks (requested by second instance)')
        const duration = cmd.durationToMs(settings)
        // -1 indicates an invalid value
        if (duration === -1) {
          log.error('Stretchly: error when parsing duration to ms because of invalid value')
          return
        }
        pauseBreaks(duration)
        break
      }

      case 'preferences':
        log.info('Stretchly: open Preferences window (requested by second instance)')
        createPreferencesWindow()
        break
    }
  })
}

app.on('ready', initialize)
app.on('window-all-closed', () => {
  // do nothing, so app wont get closed
})
app.on('before-quit', (event) => {
  if ((breakPlanner.scheduler.reference === 'finishMicrobreak' && settings.get('microbreakStrictMode')) ||
    (breakPlanner.scheduler.reference === 'finishBreak' && settings.get('breakStrictMode'))
  ) {
    log.info('Stretchly: preventing app closure (in break with strict mode)')
    event.preventDefault()
  } else {
    globalShortcut.unregisterAll()
    app.quit()
  }
})

async function initialize(isAppStart = true) {
  if (!gotTheLock) {
    return
  }
  // TODO maybe we should not reinitialize but handle everything when we save new values for preferences
  log.info(`Stretchly: ${isAppStart ? '' : 're'}initializing...`)
  require('events').defaultMaxListeners = 200 // for watching Store changes
  if (!settings) {
    settings = new Store({
      defaults: require('./utils/defaultSettings'),
      beforeEachMigration: (store, context) => {
        log.info(`Stretchly: migrating preferences from Stretchly v${context.fromVersion} to v${context.toVersion}`)
      },
      migrations: {
        '1.13.0': store => {
          if (store.has('pauseBreaksShortcut')) {
            store.set('pauseBreaksToggleShortcut', store.get('pauseBreaksShortcut'))
            log.info(`Stretchly: settings pauseBreaksToggleShortcut to "${store.get('pauseBreaksShortcut')}"`)
            store.delete('pauseBreaksShortcut')
            log.info('Stretchly: removing pauseBreaksShortcut')
          } else {
            log.info('Stretchly: not migrating pauseBreaksShortcut')
          }
          if (store.has('pauseBreaksShortcut')) {
            store.delete('resumeBreaksShortcut')
            log.info('Stretchly: removing resumeBreaksShortcut')
          }
        },
        '1.17.0': store => {
          if (store.has('showBreakActionsInStrictMode')) {
            store.set('showTrayMenuInStrictMode', store.get('showBreakActionsInStrictMode'))
            log.info(`Stretchly: settings showTrayMenuInStrictMode to "${store.get('showBreakActionsInStrictMode')}"`)
            store.delete('showBreakActionsInStrictMode')
            log.info('Stretchly: removing showBreakActionsInStrictMode')
          } else {
            log.info('Stretchly: not migrating showBreakActionsInStrictMode')
          }
        }
      },
      watch: true
    })
    log.info('Stretchly: loading preferences')
    //log.info("Valeur de settings: ", settings.store)

    Store.initRenderer()
    Object.entries(settings.store).forEach(([key, _]) => {
      settings.onDidChange(key, (newValue, oldValue) => {
        log.info(`Stretchly: setting '${key}' to '${JSON.stringify(newValue)}' (was '${JSON.stringify(oldValue)}')`)
      })
    })
    if (!profileManager) {
      profileManager = new ProfileManager(settings)
      global.profileManager = profileManager
    }

  }
  if (!breakPlanner) {
    breakPlanner = new BreaksPlanner(settings)
    breakPlanner.nextBreak()
    breakPlanner.on('startMicrobreakNotification', () => { startMicrobreakNotification() })
    breakPlanner.on('startBreakNotification', () => { startBreakNotification() })
    breakPlanner.on('startMicrobreak', () => { startMicrobreak() })
    breakPlanner.on('finishMicrobreak', (shouldPlaySound, shouldPlanNext) => { finishMicrobreak(shouldPlaySound, shouldPlanNext) })
    breakPlanner.on('startBreak', () => { startBreak() })
    breakPlanner.on('finishBreak', (shouldPlaySound, shouldPlanNext) => { finishBreak(shouldPlaySound, shouldPlanNext) })
    breakPlanner.on('resumeBreaks', () => { resumeBreaks() })
    breakPlanner.on('updateToolTip', function() {
      updateTray()
    })
  } else {
    breakPlanner.clear()
    breakPlanner.appExclusionsManager.reinitialize(settings)
    breakPlanner.doNotDisturb(settings.get('monitorDnd'))
    breakPlanner.naturalBreaks(settings.get('naturalBreaks'))
    breakPlanner.nextBreak()
  }

  autostartManager = new AutostartManager({
    platform: process.platform,
    windowsStore: process.windowsStore,
    app
  })

  startI18next()
  startProcessWin()
  createWelcomeWindow()
  nativeTheme.themeSource = settings.get('themeSource')

  require('fs').readFile(path.join(app.getPath('userData'), 'stamp'), 'utf8', (err, data) => {
    if (err) {
      return
    }
    const { DateTime } = require('luxon')
    if (DateTime.fromISO(data).month === DateTime.now().month) {
      global.shared.isContributor = true
      log.info('Stretchly: Thanks for your contributions!')
      if (preferencesWin) {
        preferencesWin.send('enableContributorPreferences')
      }
      updateTray()
    }
  })
  startPowerMonitoring()
  if (preferencesWin) {
    preferencesWin.send('renderSettings', await settingsToSend())
  }
  if (welcomeWin) {
    welcomeWin.send('renderSettings', await settingsToSend())
  }
  if (contributorPreferencesWindow) {
    contributorPreferencesWindow.send('renderSettings', await settingsToSend())
  }
  globalShortcut.unregisterAll()

  registerBreakShortcuts({
    settings,
    log,
    globalShortcut,
    breakPlanner,
    functions: { pauseBreaks, resumeBreaks, skipToBreak, skipToMicrobreak, resetBreaks }
  })

  loadIdeas()
  updateTray()
}

function startI18next() {
  i18next
    .use(Backend)
    .init({
      lng: settings.get('language'),
      fallbackLng: 'en',
      debug: false,
      backend: {
        loadPath: path.join(__dirname, '/locales/{{lng}}.json'),
        jsonIndent: 2
      }
    }, function(err, t) {
      if (err) {
        console.log(err.stack)
      }
      updateTray()
    })
}

i18next.on('languageChanged', async function(lng) {
  if (welcomeWin) {
    welcomeWin.send('translate', await settingsToSend())
  }
  if (preferencesWin) {
    preferencesWin.send('translate', await settingsToSend())
  }
  updateTray()
  loadIdeas()
})

function onSuspendOrLock() {
  log.info('System: suspend or lock')
  if (settings.get('pauseForSuspendOrLock')) {
    if (breakPlanner.isPaused || breakPlanner.dndManager.isOnDnd ||
      breakPlanner.naturalBreaksManager.isSchedulerCleared ||
      breakPlanner.appExclusionsManager.isSchedulerCleared) {
      log.info('Stretchly: not pausing for suspendOrLock because paused already')
    } else {
      pausedForSuspendOrLock = true
      pauseBreaks(1)
      updateTray()
    }
  }
}

function onResumeOrUnlock() {
  log.info('System: resume or unlock')
  if (pausedForSuspendOrLock) {
    pausedForSuspendOrLock = false
    resumeBreaks(false)
  } else {
    // corrrect the planner for the time spent in suspend
    breakPlanner.correctScheduler()
  }
  updateTray()
}

function startPowerMonitoring() {
  const electron = require('electron')
  electron.powerMonitor.on('suspend', onSuspendOrLock)
  electron.powerMonitor.on('lock-screen', onSuspendOrLock)
  electron.powerMonitor.on('resume', onResumeOrUnlock)
  electron.powerMonitor.on('unlock-screen', onResumeOrUnlock)
}

function numberOfDisplays() {
  const electron = require('electron')
  return electron.screen.getAllDisplays().length
}

function closeWindows(windowArray) {
  for (const window of windowArray) {
    window.hide()
    if (windowArray[0] === window) {
      ipcMain.removeAllListeners('send-break-data')
      ipcMain.removeAllListeners('send-microbreak-data')
    }
    window.close()
  }
  return null
}

function displaysX(displayID = -1, width = 800, fullscreen = false) {
  const electron = require('electron')
  let theScreen

  if (!settings.get('allScreens')) {
    if (settings.get('screen') === 'primary') {
      theScreen = electron.screen.getPrimaryDisplay()
    } else if (settings.get('screen') === 'cursor') {
      theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
    } else {
      displayID = parseInt(settings.get('screen'))
    }
  }

  if (displayID === -1) {
    theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
  } else if (displayID >= numberOfDisplays() || displayID < 0) {
    log.warn(`Stretchly: invalid displayID ${displayID} to displaysX`)
    theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
  } else {
    const screens = electron.screen.getAllDisplays()
    theScreen = screens[displayID]
  }
  const bounds = theScreen.bounds
  if (fullscreen) {
    return Math.ceil(bounds.x)
  } else {
    return Math.ceil(bounds.x + ((bounds.width - width) / 2))
  }
}

function displaysY(displayID = -1, height = 600, fullscreen = false) {
  const electron = require('electron')
  let theScreen

  if (!settings.get('allScreens')) {
    if (settings.get('screen') === 'primary') {
      theScreen = electron.screen.getPrimaryDisplay()
    } else if (settings.get('screen') === 'cursor') {
      theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
    } else {
      displayID = parseInt(settings.get('screen'))
    }
  }

  if (displayID === -1) {
    theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
  } else if (displayID >= numberOfDisplays() || displayID < 0) {
    log.warn(`Stretchly: invalid displayID ${displayID} to displaysY`)
    theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
  } else {
    const screens = electron.screen.getAllDisplays()
    theScreen = screens[displayID]
  }
  const bounds = theScreen.bounds
  if (fullscreen) {
    return Math.ceil(bounds.y)
  } else {
    return Math.ceil(bounds.y + ((bounds.height - height) / 2))
  }
}

function displaysWidth(displayID = -1) {
  const electron = require('electron')
  let theScreen

  if (!settings.get('allScreens')) {
    if (settings.get('screen') === 'primary') {
      theScreen = electron.screen.getPrimaryDisplay()
    } else if (settings.get('screen') === 'cursor') {
      theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
    } else {
      displayID = parseInt(settings.get('screen'))
    }
  }

  if (displayID === -1) {
    theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
  } else if (displayID >= numberOfDisplays() || displayID < 0) {
    log.warn(`Stretchly: invalid displayID ${displayID} to displaysWidth`)
    theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
  } else {
    const screens = electron.screen.getAllDisplays()
    theScreen = screens[displayID]
  }
  const bounds = theScreen.bounds
  return Math.ceil(bounds.width)
}

function displaysHeight(displayID = -1) {
  const electron = require('electron')
  let theScreen

  if (!settings.get('allScreens')) {
    if (settings.get('screen') === 'primary') {
      theScreen = electron.screen.getPrimaryDisplay()
    } else if (settings.get('screen') === 'cursor') {
      theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
    } else {
      displayID = parseInt(settings.get('screen'))
    }
  }

  if (displayID === -1) {
    theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
  } else if (displayID >= numberOfDisplays() || displayID < 0) {
    log.warn(`Stretchly: invalid displayID ${displayID} to displaysHeight`)
    theScreen = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
  } else {
    const screens = electron.screen.getAllDisplays()
    theScreen = screens[displayID]
  }
  const bounds = theScreen.bounds
  return Math.ceil(bounds.height)
}

function trayIconPath() {
  const params = {
    paused:
      breakPlanner.isPaused ||
      breakPlanner.dndManager.isOnDnd ||
      breakPlanner.naturalBreaksManager.isSchedulerCleared ||
      breakPlanner.appExclusionsManager.isSchedulerCleared,
    monochrome: settings.get('useMonochromeTrayIcon'),
    inverted: settings.get('useMonochromeInvertedTrayIcon'),
    darkMode: nativeTheme.shouldUseDarkColors,
    platform: process.platform,
    timeToBreakInTray: settings.get('timeToBreakInTray'),
    timeToBreak: Utils.minutesRemaining(breakPlanner.timeToNextBreak),
    reference: breakPlanner.scheduler.reference
  }
  const trayIconFileName = new AppIcon(params).trayIconFileName
  const pathToTrayIcon = path.join(__dirname, '/images/app-icons/', trayIconFileName)
  return pathToTrayIcon
}

function windowIconPath() {
  const unusedParams = null
  const params = {
    paused: false,
    monochrome: settings.get('useMonochromeTrayIcon'),
    inverted: settings.get('useMonochromeInvertedTrayIcon'),
    darkMode: nativeTheme.shouldUseDarkColors,
    platform: unusedParams,
    timeToBreakInTrayString: unusedParams,
    reference: unusedParams
  }
  const windowIconFileName = new AppIcon(params).windowIconFileName
  return path.join(__dirname, '/images/app-icons', windowIconFileName)
}

function startProcessWin() {
  if (processWin) {
    planVersionCheck()
    return
  }
  const modalPath = path.join('file://', __dirname, '/process.html')
  processWin = new BrowserWindow({
    show: false,
    backgroundThrottling: false,
    webPreferences: {
      preload: path.join(__dirname, './process.js'),
      enableRemoteModule: true,
      sandbox: false
    }
  })
  require('@electron/remote/main').enable(processWin.webContents)
  processWin.loadURL(modalPath)
  processWin.once('ready-to-show', () => {
    planVersionCheck()
  })
}

function createWelcomeWindow(isAppStart = true) {
  if (settings.get('isFirstRun') && isAppStart) {
    const modalPath = path.join('file://', __dirname, '/welcome.html')
    welcomeWin = new BrowserWindow({
      x: displaysX(-1, 1000),
      y: displaysY(-1, 750),
      width: 1000,
      height: 750,
      autoHideMenuBar: true,
      icon: windowIconPath(),
      backgroundColor: 'EDEDED',
      webPreferences: {
        preload: path.join(__dirname, './welcome.js'),
        enableRemoteModule: true,
        sandbox: false
      }
    })
    require('@electron/remote/main').enable(welcomeWin.webContents)
    welcomeWin.loadURL(modalPath)
    if (welcomeWin) {
      welcomeWin.on('closed', () => {
        welcomeWin = null
      })
    }
    setTimeout(() => {
      welcomeWin.center()
    }, 0)
  }
}

function createContributorSettingsWindow() {
  if (contributorPreferencesWindow) {
    contributorPreferencesWindow.show()
    return
  }
  const modalPath = path.join('file://', __dirname, '/contributor-preferences.html')
  contributorPreferencesWindow = new BrowserWindow({
    x: displaysX(-1, 735),
    y: displaysY(),
    width: 735,
    autoHideMenuBar: true,
    icon: windowIconPath(),
    backgroundColor: 'EDEDED',
    webPreferences: {
      preload: path.join(__dirname, './contributor-preferences.js'),
      enableRemoteModule: true,
      sandbox: false
    }
  })
  require('@electron/remote/main').enable(contributorPreferencesWindow.webContents)
  contributorPreferencesWindow.loadURL(modalPath)
  if (contributorPreferencesWindow) {
    contributorPreferencesWindow.on('closed', () => {
      contributorPreferencesWindow = null
    })
  }
  setTimeout(() => {
    contributorPreferencesWindow.center()
  }, 0)
}

function createSyncPreferencesWindow() {
  if (syncPreferencesWindow) {
    syncPreferencesWindow.show()
    return
  }

  const syncPreferencesUrl = 'https://my.stretchly.net/app/v1/sync'
  syncPreferencesWindow = new BrowserWindow({
    autoHideMenuBar: true,
    width: 1000,
    height: 700,
    icon: windowIconPath(),
    x: displaysX(),
    y: displaysY(),
    backgroundColor: 'whitesmoke',
    webPreferences: {
      preload: path.resolve(__dirname, './electron-bridge.js'),
      enableRemoteModule: true,
      sandbox: false
    }
  })
  require('@electron/remote/main').enable(syncPreferencesWindow.webContents)
  syncPreferencesWindow.loadURL(syncPreferencesUrl)
  if (syncPreferencesWindow) {
    syncPreferencesWindow.on('closed', () => {
      syncPreferencesWindow = null
    })
  }

  setTimeout(() => {
    syncPreferencesWindow.center()
  }, 0)
}

function planVersionCheck(seconds = 1) {
  if (updateChecker) {
    clearInterval(updateChecker)
    updateChecker = null
  }
  updateChecker = setTimeout(checkVersion, seconds * 1000)
}

function checkVersion() {
  if (settings.get('checkNewVersion')) {
    processWin.webContents.send('checkVersion', {
      oldVersion: `v${app.getVersion()}`,
      notify: settings.get('notifyNewVersion'),
      silent: settings.get('silentNotifications')
    })
    planVersionCheck(3600 * 48)
  }
}

function startMicrobreakNotification() {
  showNotification(i18next.t('main.microbreakIn', { seconds: settings.get('microbreakNotificationInterval') / 1000 }))
  log.info('Stretchly: showing Mini Break notification')
  breakPlanner.nextBreakAfterNotification()
  updateTray()
}

function startBreakNotification() {
  showNotification(i18next.t('main.breakIn', { seconds: settings.get('breakNotificationInterval') / 1000 }))
  log.info('Stretchly: showing Long Break notification')
  breakPlanner.nextBreakAfterNotification()
  updateTray()
}

function getBlurredBackgroundWindowOptions() {
  if (!settings.get('blurredBackground')) {
    return {}
  }

  switch (process.platform) {
    case 'darwin':
      return {
        vibrancy: 'hud',
        visualEffectState: 'active'
      }
    default:
      return {}
  }
}

function startMicrobreak() {
  const breakDuration = settings.get('microbreakDuration')
  breakHandler(breakDuration)
}

function startBreak() {
  const breakDuration = settings.get("breakDuration")
  breakHandler(breakDuration)
}

function breakHandler(breakRetrievedDuration) {
  if (breakWins) {
    log.warn('Stretchly: Long Break already running, not starting Long Break')
    return
  }

  const breakDuration = breakRetrievedDuration
  const strictMode = settings.get('breakStrictMode')
  const postponesLimit = settings.get('breakPostponesLimit')
  const postponableDurationPercent = settings.get('breakPostponableDurationPercent')
  const postponable = settings.get('breakPostpone') &&
    breakPlanner.postponesNumber < postponesLimit && postponesLimit > 0
  const showBreaksAsRegularWindows = settings.get('showBreaksAsRegularWindows')

  const modalPath = path.join('file://', __dirname, '/break.html')
  breakWins = []

  const defaultNextIdea = settings.get('ideas') ? breakIdeas.randomElement : ['', '']
  const idea = nextIdea ? (nextIdea.map((val, index) => val || defaultNextIdea[index])) : defaultNextIdea
  nextIdea = null

  if (settings.get('breakStartSoundPlaying') && !settings.get('silentNotifications')) {
    processWin.webContents.send('playSound', settings.get('audio'), settings.get('volume'))
  }

  for (let localDisplayId = 0; localDisplayId < numberOfDisplays(); localDisplayId++) {
    const windowOptions = {
      width: Number.parseInt(displaysWidth(localDisplayId) * settings.get('breakWindowWidth')),
      height: Number.parseInt(displaysHeight(localDisplayId) * settings.get('breakWindowHeight')),
      autoHideMenuBar: true,
      icon: windowIconPath(),
      resizable: false,
      frame: showBreaksAsRegularWindows,
      show: false,
      backgroundThrottling: false,
      transparent: true,
      ...getBlurredBackgroundWindowOptions(),
      backgroundColor: calculateBackgroundColor(settings.get('mainColor')),
      skipTaskbar: !showBreaksAsRegularWindows,
      focusable: showBreaksAsRegularWindows,
      alwaysOnTop: !showBreaksAsRegularWindows,
      hasShadow: false,
      title: 'Stretchly',
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      webPreferences: {
        preload: path.join(__dirname, './break.js'),
        enableRemoteModule: true,
        sandbox: false
      }
    }

    if (settings.get('fullscreen') && process.platform !== 'darwin') {
      windowOptions.width = displaysWidth(localDisplayId)
      windowOptions.height = displaysHeight(localDisplayId)
      windowOptions.x = displaysX(localDisplayId, 0, true)
      windowOptions.y = displaysY(localDisplayId, 0, true)
    } else if (!(settings.get('fullscreen') && process.platform === 'win32')) {
      windowOptions.x = displaysX(localDisplayId, windowOptions.width, false)
      windowOptions.y = displaysY(localDisplayId, windowOptions.height, false)
    }

    let breakWinLocal = new BrowserWindow(windowOptions)
    // seems to help with multiple-displays problems
    breakWinLocal.setSize(windowOptions.width, windowOptions.height)
    ipcMain.on('send-break-data', (event) => {
      const startTime = Date.now()
      if (!strictMode || postponable) {
        if (settings.get('endBreakShortcut') !== '') {
          globalShortcut.register(settings.get('endBreakShortcut'), () => {
            const passedPercent = (Date.now() - startTime) / breakDuration * 100
            if (Utils.canPostpone(postponable, passedPercent, postponableDurationPercent)) {
              postponeBreak()
            } else if (Utils.canSkip(strictMode, postponable, passedPercent, postponableDurationPercent)) {
              finishBreak(false)
            }
          })
        }
      }
      const activeProfile = profileManager.getActiveProfile()
      let backgroundImage = null
      if (activeProfile && activeProfile.backgroundImage && activeProfile.backgroundImage.microbreak) {
        backgroundImage = profileManager.getBackgroundImagePath(settings.get('profiles.active'), 'break')
      }

      event.sender.send('breakIdea', idea)
      event.sender.send('progress', startTime,
        breakDuration, strictMode, postponable, postponableDurationPercent,
        calculateBackgroundColor(settings.get('mainColor')), backgroundImage)
    })
    // breakWinLocal.webContents.openDevTools()
    breakWinLocal.once('ready-to-show', () => {
      log.info('Stretchly: ready-to-show fired')
    })

    ipcMain.once('long-break-loaded', () => {
      log.info('Stretchly: Long Break window loaded')
      if (showBreaksAsRegularWindows) {
        breakWinLocal.show()
      } else {
        breakWinLocal.showInactive()
      }

      log.info(`Stretchly: showing window ${localDisplayId + 1} of ${numberOfDisplays()}`)
      if (process.platform === 'darwin') {
        if (showBreaksAsRegularWindows) {
          breakWinLocal.setFullScreen(settings.get('fullscreen'))
        } else {
          breakWinLocal.setMinimizable(false)
          breakWinLocal.setClosable(false)
          breakWinLocal.setKiosk(settings.get('fullscreen'))
        }
      }
      if (localDisplayId === 0) {
        breakPlanner.emit('breakStarted', true)
        log.info('Stretchly: starting Long Break')
      }

      if (!settings.get('fullscreen') && process.platform !== 'darwin') {
        setTimeout(() => {
          breakWinLocal.center()
        }, 0)
      }
      updateTray()
    })

    require('@electron/remote/main').enable(breakWinLocal.webContents)
    breakWinLocal.loadURL(modalPath)
    breakWinLocal.setVisibleOnAllWorkspaces(true)
    breakWinLocal.setAlwaysOnTop(!showBreaksAsRegularWindows, 'pop-up-menu')
    if (breakWinLocal) {
      breakWinLocal.on('close', (e) => {
        if (breakPlanner.scheduler.timeLeft > 0 && settings.get('breakStrictMode')) {
          // FIXME this will still log when postponing break
          log.info('Stretchly: preventing closing break window as in strict mode')
          e.preventDefault()
        }
      })
      breakWinLocal.on('closed', () => {
        breakWinLocal = null
      })
    }
    breakWins.push(breakWinLocal)

    if (!settings.get('allScreens')) {
      if (numberOfDisplays() > 1) {
        log.info('Stretchly: not showing on more Monitors as it is disabled.')
      }
      break
    }
  }
  if (process.platform === 'darwin') {
    if (app.dock.isVisible) {
      app.dock.hide()
    }
  }
}

function breakComplete(shouldPlaySound, windows, breakType) {
  if (settings.get('endBreakShortcut') && globalShortcut.isRegistered(settings.get('endBreakShortcut'))) {
    globalShortcut.unregister(settings.get('endBreakShortcut'))
  }
  if (shouldPlaySound && !settings.get('silentNotifications')) {
    const audio = breakType === 'mini' ? 'miniBreakAudio' : 'audio'
    processWin.webContents.send('playSound', settings.get(audio), settings.get('volume'))
  }
  if (process.platform === 'darwin') {
    // get focus on the last app
    Menu.sendActionToFirstResponder('hide:')
  }
  return closeWindows(windows)
}

function finishMicrobreak(shouldPlaySound = true, shouldPlanNext = true) {
  microbreakWins = breakComplete(shouldPlaySound, microbreakWins, 'mini')
  log.info(`Stretchly: finishing Mini Break (shouldPlanNext: ${shouldPlanNext})`)
  if (shouldPlanNext) {
    breakPlanner.nextBreak()
  } else {
    breakPlanner.clear()
  }
  updateTray()
}

function finishBreak(shouldPlaySound = true, shouldPlanNext = true) {
  breakWins = breakComplete(shouldPlaySound, breakWins, 'long')
  log.info(`Stretchly: finishing Long Break (shouldPlanNext: ${shouldPlanNext})`)
  if (shouldPlanNext) {
    breakPlanner.nextBreak()
  }
  updateTray()
}

function postponeMicrobreak(shouldPlaySound = false) {
  microbreakWins = breakComplete(shouldPlaySound, microbreakWins)
  breakPlanner.postponeCurrentBreak()
  log.info('Stretchly: postponing Mini Break')
  updateTray()
}

function postponeBreak(shouldPlaySound = false) {
  breakWins = breakComplete(shouldPlaySound, breakWins)
  breakPlanner.postponeCurrentBreak()
  log.info('Stretchly: postponing Long Break')
  updateTray()
}

function skipToMicrobreak(delay) {
  if (microbreakWins) {
    microbreakWins = breakComplete(false, microbreakWins)
  }
  if (breakWins) {
    breakWins = breakComplete(false, breakWins)
  }
  if (delay) {
    breakPlanner.skipToMicrobreak(delay)
    log.info(`Stretchly: skipping to Mini Break in ${delay}ms`)
  } else {
    breakPlanner.skipToMicrobreak()
    log.info('Stretchly: skipping to Mini Break')
  }
  updateTray()
}

function skipToBreak(delay) {
  if (microbreakWins) {
    microbreakWins = breakComplete(false, microbreakWins)
  }
  if (breakWins) {
    breakWins = breakComplete(false, breakWins)
  }
  if (delay) {
    breakPlanner.skipToBreak(delay)
    log.info(`Stretchly: skipping to Long Break in ${delay}ms`)
  } else {
    breakPlanner.skipToBreak()
    log.info('Stretchly: skipping to Long Break')
  }
  updateTray()
}

function resetBreaks() {
  if (microbreakWins) {
    microbreakWins = breakComplete(false, microbreakWins)
  }
  if (breakWins) {
    breakWins = breakComplete(false, breakWins)
  }
  breakPlanner.reset()
  log.info('Stretchly: resetting breaks')
  updateTray()
}

function calculateBackgroundColor(color) {
  let opacityMultiplier = 1
  if (settings.get('transparentMode')) {
    opacityMultiplier = settings.get('opacity')
  }
  return color + Math.round(opacityMultiplier * 255).toString(16).padStart(2, '0')
}

function loadIdeas() {
  let longBreakIdeasData
  let miniBreakIdeasData
  if (settings.get('useIdeasFromSettings')) {
    longBreakIdeasData = settings.get('breakIdeas')
    miniBreakIdeasData = settings.get('microbreakIdeas')
    log.info('Stretchly: loading custom break ideas from preferences file')
  } else {
    const t = i18next.getFixedT('en')
    miniBreakIdeasData = Object.keys(t('miniBreakIdeas',
      { returnObjects: true }))
      .map((item) => {
        return { data: i18next.t(`miniBreakIdeas.${item}.text`), enabled: true }
      })

    longBreakIdeasData = Object.keys(t('longBreakIdeas',
      { returnObjects: true }))
      .map((item) => {
        return { data: [i18next.t(`longBreakIdeas.${item}.title`), i18next.t(`longBreakIdeas.${item}.text`)], enabled: true }
      })
    log.info('Stretchly: loading default break ideas')
  }

  breakIdeas = new IdeasLoader(longBreakIdeasData).ideas()
  microbreakIdeas = new IdeasLoader(miniBreakIdeasData).ideas()
}

function pauseBreaks(milliseconds) {
  if (microbreakWins) {
    finishMicrobreak(false)
  }
  if (breakWins) {
    finishBreak(false)
  }
  breakPlanner.pause(milliseconds)
  log.info(`Stretchly: pausing breaks for ${milliseconds}ms`)
  updateTray()
}

function resumeBreaks(notify = true) {
  if (breakPlanner.dndManager.isOnDnd) {
    log.info('Stretchly: not resuming breaks because in Do Not Disturb')
  } else {
    breakPlanner.resume()
    log.info('Stretchly: resuming breaks')
    if (notify) {
      showNotification(i18next.t('main.resumingBreaks'))
    }
  }
  updateTray()
}

function createPreferencesWindow() {
  const electron = require('electron')
  if (preferencesWin) {
    preferencesWin.show()
    return
  }
  const modalPath = path.join('file://', __dirname, '/preferences.html')
  const maxHeight = electron.screen
    .getDisplayNearestPoint(electron.screen.getCursorScreenPoint())
    .workAreaSize.height * 0.9
  preferencesWin = new BrowserWindow({
    autoHideMenuBar: true,
    icon: windowIconPath(),
    width: 600,
    height: 530,
    maxHeight: Math.round(maxHeight),
    x: displaysX(-1, 600),
    y: displaysY(-1, 530),
    backgroundColor: '#EDEDED',
    webPreferences: {
      preload: path.join(__dirname, './preferences.js'),
      enableRemoteModule: true,
      sandbox: false
    }
  })
  require('@electron/remote/main').enable(preferencesWin.webContents)
  preferencesWin.loadURL(modalPath)
  preferencesWin.on('closed', () => {
    preferencesWin = null
  })
  setTimeout(() => {
    preferencesWin.center()
  }, 0)
}

function updateTray() {
  if (process.platform === 'darwin') {
    if (app.dock.isVisible) {
      app.dock.hide()
    }
  }

  if (!appIcon && !settings.get('showTrayIcon')) {
    return
  }

  if (settings.get('showTrayIcon')) {
    if (!appIcon) {
      appIcon = new Tray(trayIconPath())
      appIcon.on('double-click', () => {
        createPreferencesWindow()
      })
      appIcon.on('click', () => {
        appIcon.popUpContextMenu(Menu.buildFromTemplate(currentTrayMenuTemplate))
      })
    }
    if (!trayUpdateIntervalObj) {
      trayUpdateIntervalObj = setInterval(updateTray, 10000)
    }

    updateToolTip()

    const newTrayIconPath = trayIconPath()
    if (newTrayIconPath !== currentTrayIconPath) {
      appIcon.setImage(newTrayIconPath)
      currentTrayIconPath = newTrayIconPath
    }

    const newTrayMenuTemplate = getTrayMenuTemplate()
    if (JSON.stringify(newTrayMenuTemplate) !== JSON.stringify(currentTrayMenuTemplate)) {
      const trayMenu = Menu.buildFromTemplate(newTrayMenuTemplate)
      appIcon.setContextMenu(trayMenu)
      currentTrayMenuTemplate = newTrayMenuTemplate
    }
  }
}

function getTrayMenuTemplate() {
  const trayMenu = []

  if (global.shared.isNewVersion) {
    trayMenu.push({
      label: i18next.t('main.downloadLatestVersion'),
      click: function() {
        shell.openExternal('https://hovancik.net/stretchly/downloads')
      }
    }, {
      type: 'separator'
    })
  }

  const StatusMessages = require('./utils/statusMessages')
  const statusMessage = new StatusMessages({
    breakPlanner,
    settings
  }).trayMessage

  if (statusMessage !== '') {
    const messages = statusMessage.split('\n')
    for (const index in messages) {
      trayMenu.push({
        label: messages[index],
        enabled: false
      })
    }

    trayMenu.push({
      type: 'separator'
    })
  }

  if ((breakPlanner.scheduler.reference === 'finishMicrobreak' && settings.get('microbreakStrictMode') &&
    !settings.get('showTrayMenuInStrictMode')) ||
    (breakPlanner.scheduler.reference === 'finishBreak' && settings.get('breakStrictMode') &&
      !settings.get('showTrayMenuInStrictMode'))
  ) {
    // empty menu, we are in strict mode
    return trayMenu
  }

  if (!(breakPlanner.isPaused || breakPlanner.dndManager.isOnDnd || breakPlanner.appExclusionsManager.isSchedulerCleared)) {
    let submenu = []
    if (settings.get('microbreak')) {
      submenu = submenu.concat([{
        label: i18next.t('main.toMicrobreak'),
        click: () => skipToMicrobreak()
      }])
    }
    if (settings.get('break')) {
      submenu = submenu.concat([{
        label: i18next.t('main.toBreak'),
        click: () => skipToBreak()
      }])
    }
    if (settings.get('break') || settings.get('microbreak')) {
      trayMenu.push({
        label: i18next.t('main.skipToTheNext'),
        submenu
      })
    }
  }

  if (breakPlanner.isPaused) {
    trayMenu.push({
      label: i18next.t('main.resume'),
      click: function() {
        resumeBreaks(false)
        updateTray()
      }
    })
  } else if (!(breakPlanner.dndManager.isOnDnd || breakPlanner.appExclusionsManager.isSchedulerCleared)) {
    trayMenu.push({
      label: i18next.t('main.pause'),
      submenu: [
        {
          label: i18next.t('utils.minutes', { count: 30 }),
          accelerator: settings.get('pauseBreaksFor30MinutesShortcut') || null,
          click: function() {
            pauseBreaks(1800 * 1000)
          }
        }, {
          label: i18next.t('main.forHour'),
          accelerator: settings.get('pauseBreaksFor1HourShortcut') || null,
          click: function() {
            pauseBreaks(3600 * 1000)
          }
        }, {
          label: i18next.t('main.for2Hours'),
          accelerator: settings.get('pauseBreaksFor2HoursShortcut') || null,
          click: function() {
            pauseBreaks(3600 * 2 * 1000)
          }
        }, {
          label: i18next.t('main.for5Hours'),
          accelerator: settings.get('pauseBreaksFor5HoursShortcut') || null,
          click: function() {
            pauseBreaks(3600 * 5 * 1000)
          }
        }, {
          label: i18next.t('main.untilMorning'),
          accelerator: settings.get('pauseBreaksUntilMorningShortcut') || null,
          click: function() {
            const untilMorning = new UntilMorning(settings).msToSunrise()
            pauseBreaks(untilMorning)
          }
        }, {
          type: 'separator'
        }, {
          label: i18next.t('main.indefinitely'),
          click: function() {
            pauseBreaks(1)
          }
        }
      ]
    }, {
      label: i18next.t('main.resetBreaks'),
      click: resetBreaks
    })
  }

  trayMenu.push({
    type: 'separator'
  }, {
    label: i18next.t('main.preferences'),
    click: function() {
      createPreferencesWindow()
    }
  })

  if (global.shared.isContributor) {
    trayMenu.push({
      label: i18next.t('main.contributorPreferences'),
      click: function() {
        createContributorSettingsWindow()
      }
    }, {
      label: i18next.t('main.syncPreferences'),
      click: function() {
        createSyncPreferencesWindow()
      }
    })
  }

  trayMenu.push({
    type: 'separator'
  }, {
    label: i18next.t('main.quitStretchly'),
    role: 'quit',
    click: function() {
      app.quit()
    }
  })

  return trayMenu
}

function updateToolTip() {
  const StatusMessages = require('./utils/statusMessages')
  let trayMessage = i18next.t('main.toolTipHeader')
  const message = new StatusMessages({
    breakPlanner,
    settings
  }).trayMessage
  if (message !== '') {
    trayMessage += '\n\n' + message
  }
  if (appIcon) {
    appIcon.setToolTip(trayMessage)
  }
}

function showNotification(text) {
  processWin.webContents.send('showNotification', {
    text,
    silent: settings.get('silentNotifications')
  })
}

ipcMain.on('postpone-microbreak', function(event, shouldPlaySound) {
  postponeMicrobreak()
})

ipcMain.on('postpone-break', function(event, shouldPlaySound) {
  postponeBreak()
})

ipcMain.on('finish-microbreak', function(event, shouldPlaySound, shouldPlanNext) {
  finishMicrobreak(shouldPlaySound, shouldPlanNext)
})

ipcMain.on('finish-break', function(event, shouldPlaySound, shouldPlanNext) {
  finishBreak(shouldPlaySound, shouldPlanNext)
})

ipcMain.on('save-setting', function(event, key, value) {
  if (key === 'naturalBreaks') {
    breakPlanner.naturalBreaks(value)
  }

  if (key === 'monitorDnd') {
    breakPlanner.doNotDisturb(value)
  }

  if (key === 'language') {
    i18next.changeLanguage(value)
  }

  if (key === 'themeSource') {
    nativeTheme.themeSource = value
  }

  if (key === 'audio') {
    settings.set('miniBreakAudio', value)
  }

  if (key === 'mainColor') {
    settings.set('miniBreakColor', value)
  }

  if (key === 'showTrayIcon') {
    settings.set('showTrayIcon', value)
    if (value) {
      updateTray()
    } else {
      clearInterval(trayUpdateIntervalObj)
      trayUpdateIntervalObj = null
      appIcon.destroy()
      appIcon = null
    }
  }

  if (key === 'openAtLogin') {
    autostartManager.setAutostartEnabled(value)
  } else {
    settings.set(key, value)
  }

  updateTray()
})

ipcMain.on('update-tray', function(event) {
  updateTray()
})

ipcMain.on('restore-defaults', (event) => {
  const dialogOpts = {
    type: 'question',
    title: i18next.t('main.restoreDefaults'),
    message: i18next.t('main.warning'),
    buttons: [i18next.t('main.continue'), i18next.t('main.cancel')]
  }
  dialog.showMessageBox(dialogOpts).then(async (returnValue) => {
    if (returnValue.response === 0) {
      log.info('Stretchly: restoring default settings')
      settings.store = Object.assign(require('./utils/defaultSettings'), { isFirstRun: false })
      initialize(false)
      event.sender.send('renderSettings', await settingsToSend())
    }
  })
})

ipcMain.on('send-settings', async function(event) {
  event.sender.send('renderSettings', await settingsToSend())
})

async function settingsToSend() {
  return Object.assign({}, settings.store, { openAtLogin: await autostartManager.autoLaunchStatus() })
}

ipcMain.on('play-sound', function(event, sound) {
  processWin.webContents.send('playSound', sound, settings.get('volume'))
})

ipcMain.on('show-debug', function(event) {
  const reference = breakPlanner.scheduler.reference
  const timeleft = Utils.formatTimeRemaining(breakPlanner.scheduler.timeLeft, settings.get('language'))
  const breaknumber = breakPlanner.breakNumber
  const postponesnumber = breakPlanner.postponesNumber
  const doNotDisturb = breakPlanner.dndManager.isOnDnd
  let settingsFile = settings.path
  let logsFile = log.transports.file.getFile().path
  if (process.windowsStore) {
    settingsFile = settingsFile.replace('Roaming', 'Local\\Packages\\33881JanHovancik.stretchly_24fg4m0zq65je\\LocalCache\\Roaming')
    logsFile = logsFile.replace('Roaming', 'Local\\Packages\\33881JanHovancik.stretchly_24fg4m0zq65je\\LocalCache\\Roaming')
  }
  event.sender.send('debugInfo', reference, timeleft,
    breaknumber, postponesnumber, settingsFile, logsFile, doNotDisturb)
})

ipcMain.on('open-preferences', function(event) {
  createPreferencesWindow()
})

ipcMain.on('set-contributor', function(event) {
  const dir = app.getPath('userData')
  const contributorStampFile = `${dir}/stamp`
  const { DateTime } = require('luxon')
  require('fs').writeFile(contributorStampFile, DateTime.now().toString(), () => { })
  global.shared.isContributor = true
  log.info('Stretchly: Logged in. Thanks for your contributions!')
  if (preferencesWin) {
    preferencesWin.send('enableContributorPreferences')
  }
  updateTray()
})

ipcMain.on('open-contributor-preferences', function(event) {
  createContributorSettingsWindow()
})

ipcMain.on('open-contributor-auth', function(event, provider) {
  if (myStretchlyWindow) {
    myStretchlyWindow.show()
    return
  }
  const myStretchlyUrl = `https://my.stretchly.net/app/v1?provider=${provider}`
  myStretchlyWindow = new BrowserWindow({
    autoHideMenuBar: true,
    width: 1000,
    height: 700,
    icon: windowIconPath(),
    x: displaysX(),
    y: displaysY(),
    backgroundColor: 'whitesmoke',
    webPreferences: {
      preload: path.resolve(__dirname, './electron-bridge.js'),
      enableRemoteModule: true,
      sandbox: false
    }
  })
  require('@electron/remote/main').enable(myStretchlyWindow.webContents)
  myStretchlyWindow.loadURL(myStretchlyUrl)
  if (myStretchlyWindow) {
    myStretchlyWindow.on('closed', () => {
      myStretchlyWindow = null
    })
  }
  setTimeout(() => {
    myStretchlyWindow.center()
  }, 0)
})

ipcMain.on('open-sync-preferences', function(event) {
  createSyncPreferencesWindow()
})

ipcMain.handle('current-settings', (event) => {
  return settings.store
})

ipcMain.handle('restore-remote-settings', (event, remoteSettings) => {
  log.info('Stretchly: restoring remote settings')
  settings.store = remoteSettings
  initialize(false)
})
