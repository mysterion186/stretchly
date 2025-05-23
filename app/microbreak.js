const { ipcRenderer } = require('electron')
const fs = require('fs')
const remote = require('@electron/remote')
const Utils = remote.require('./utils/utils')
const HtmlTranslate = require('./utils/htmlTranslate')
const Store = require('electron-store')
const path = require('path')
const app = remote.app
const settings = new Store()

window.onload = (e) => {
  ipcRenderer.send('send-microbreak-data')
  require('./platform')
  new HtmlTranslate(document).translate()

  document.ondragover = event =>
    event.preventDefault()

  document.ondrop = event =>
    event.preventDefault()

  document.querySelector('#close').onclick = event =>
    ipcRenderer.send('finish-microbreak', false)

  document.querySelector('#postpone').onclick = event =>
    ipcRenderer.send('postpone-microbreak')

  ipcRenderer.once('microbreakIdea', (event, message) => {
    const microbreakIdea = document.querySelector('.microbreak-idea')

    const profileIdea = remote.getGlobal('profileManager').getMiniBreakIdea()
    if (profileIdea) {
      microbreakIdea.innerHTML = profileIdea
    } else {
      microbreakIdea.innerHTML = message
    }

    // Appliquer l'image de fond si disponible
    const backgroundImage = remote.getGlobal('profileManager').getMiniBreakBackground()
    if (backgroundImage && fs.existsSync(backgroundImage)) {
      const basePath = app.getAppPath()
      const backgroundImagePath = backgroundImage ? path.join(basePath, backgroundImage) : null
      document.body.style.backgroundImage = `url('${backgroundImagePath.replace(/\\/g, '/')}')`
      document.body.style.backgroundSize = 'cover'
      document.body.style.backgroundPosition = 'center'
    }
  })

  ipcRenderer.once('progress', (event, started, duration, strictMode, postpone, postponePercent, backgroundColor, backgroundImage) => {
    const progress = document.querySelector('#progress')
    const progressTime = document.querySelector('#progress-time')
    const postponeElement = document.querySelector('#postpone')
    const closeElement = document.querySelector('#close')
    const miniBreakColor = settings.get('miniBreakColor')
    document.body.classList.add(miniBreakColor.substring(1))
    document.body.style.backgroundColor = backgroundColor

    if (backgroundImage) {
      document.body.style.backgroundImage = `url('${backgroundImage}')`
    }


    document.querySelectorAll('.tiptext').forEach(tt => {
      const keyboardShortcut = settings.get('endBreakShortcut')
      tt.innerHTML = Utils.formatKeyboardShortcut(keyboardShortcut)
    })

    window.setInterval(() => {
      if (settings.get('currentTimeInBreaks')) {
        document.querySelector('.breaks > :last-child').innerHTML =
          (new Date()).toLocaleTimeString()
      }
      if (Date.now() - started < duration) {
        const passedPercent = (Date.now() - started) / duration * 100
        postponeElement.style.display =
          Utils.canPostpone(postpone, passedPercent, postponePercent) ? 'flex' : 'none'
        closeElement.style.display =
          Utils.canSkip(strictMode, postpone, passedPercent, postponePercent) ? 'flex' : 'none'
        progress.value = (100 - passedPercent) * progress.max / 100
        progressTime.innerHTML = Utils.formatTimeRemaining(Math.trunc(duration - Date.now() + started),
          settings.get('language'))
      }
    }, 100)
    ipcRenderer.send('mini-break-loaded')
  })
}
