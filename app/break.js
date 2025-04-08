const { ipcRenderer, shell } = require('electron')
const remote = require('@electron/remote')
const fs = require('fs')
const Utils = remote.require('./utils/utils')
const HtmlTranslate = require('./utils/htmlTranslate')
const Store = require('electron-store')
const path = require('path')
const app = remote.app
const settings = new Store()

window.onload = (event) => {
  ipcRenderer.send('send-break-data')
  require('./platform')
  new HtmlTranslate(document).translate()

  document.ondragover = event =>
    event.preventDefault()

  document.ondrop = event =>
    event.preventDefault()

  document.querySelector('#close').onclick = event =>
    ipcRenderer.send('finish-break', false)

  document.querySelector('#postpone').onclick = event =>
    ipcRenderer.send('postpone-break')

  ipcRenderer.once('breakIdea', (event, message) => {
    const breakIdea = document.querySelector('.break-idea')
    const breakText = document.querySelector('.break-text')

    // Vérifier si on a une idée de pause du profil
    const profileIdea = remote.getGlobal('profileManager').getLongBreakIdea()
    if (profileIdea) {
      // Si le titre et le texte sont présents dans le profil
      if (profileIdea.title && profileIdea.text) {
        // Créez un lien cliquable avec le titre
        breakIdea.innerHTML = `<a href="#" id="break-title-link">${profileIdea.title || ''}</a>`

        // Cachez le texte par défaut (nous l'utiliserons comme URL)
        breakText.style.display = 'none'

        // Stocker l'URL dans une variable
        const url = profileIdea.text || ''

        // Ajouter l'événement de clic sur le lien du titre
        document.addEventListener('click', (e) => {
          if (e.target && e.target.id === 'break-title-link') {
            e.preventDefault()
            // Vérifier si le texte ressemble à une URL
            if (url.startsWith('http://') || url.startsWith('https://')) {
              shell.openExternal(url)
            } else {
              // Si ce n'est pas une URL, vous pouvez choisir d'afficher le texte
              breakText.style.display = breakText.style.display === 'none' ? 'block' : 'none'
            }
          }
        })
      } else {
        // Si l'un des deux est manquant, affichez ce qui est disponible
        breakIdea.innerHTML = profileIdea.title || ''
        breakText.innerHTML = profileIdea.text || ''
      }
    } else {
      breakIdea.innerHTML = message[0] || ''
      breakText.innerHTML = message[1] || ''
    }

    // Appliquer l'image de fond si disponible
    const backgroundImage = remote.getGlobal('profileManager').getLongBreakBackground()
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
    const mainColor = settings.get('mainColor')
    document.body.classList.add(mainColor.substring(1))
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
        Utils.canSkip(strictMode, postpone, passedPercent, postponePercent)
        postponeElement.style.display =
          Utils.canPostpone(postpone, passedPercent, postponePercent) ? 'flex' : 'none'
        closeElement.style.display =
          Utils.canSkip(strictMode, postpone, passedPercent, postponePercent) ? 'flex' : 'none'
        progress.value = (100 - passedPercent) * progress.max / 100
        progressTime.innerHTML = Utils.formatTimeRemaining(Math.trunc(duration - Date.now() + started),
          settings.get('language'))
      }
    }, 100)
    ipcRenderer.send('long-break-loaded')
  })
}
