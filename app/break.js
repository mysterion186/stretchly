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
    const breakIdeaContainer = document.querySelector('.break-idea');
    const breakTextElement = document.querySelector('.break-text');

    // Vider le contenu précédent
    breakIdeaContainer.innerHTML = '';
    breakTextElement.innerHTML = '';
    breakTextElement.style.display = 'none'; // Cacher par défaut

    // Récupérer le tableau d'idées de pause
    // Renommé en profileIdeas (pluriel) pour la clarté
    const profileIdeas = remote.getGlobal('profileManager').getLongBreakIdea();

    // Vérifier si on a bien un tableau non vide d'idées
    if (Array.isArray(profileIdeas) && profileIdeas.length > 0) {
      // Boucler sur chaque idée dans le tableau
      profileIdeas.forEach(idea => {
        const title = idea.title || ''; // Utiliser une chaîne vide si le titre est manquant
        const text = idea.text || '';   // Utiliser une chaîne vide si le texte est manquant

        // Créer un élément pour chaque idée (optionnel, mais bon pour la structure/style)
        const ideaDiv = document.createElement('div');
        ideaDiv.classList.add('break-idea-item'); // Ajouter une classe pour le style si besoin

        // Créer le lien cliquable avec le titre
        const link = document.createElement('a');
        link.href = '#'; // Empêche la navigation mais conserve le style de lien
        link.textContent = title || '[Sans titre]'; // Afficher un texte par défaut si le titre est vide
        link.dataset.text = text; // Stocker le texte/URL associé dans un attribut data-*

        // Ajouter le lien au div de l'idée
        ideaDiv.appendChild(link);

        // Ajouter le div de l'idée au conteneur principal
        breakIdeaContainer.appendChild(ideaDiv);
      });

      // Ajouter UN SEUL écouteur d'événement sur le conteneur (délégation d'événement)
      breakIdeaContainer.addEventListener('click', (e) => {
        // Vérifier si l'élément cliqué est bien un de nos liens avec data-text
        if (e.target && e.target.tagName === 'A' && e.target.dataset.text !== undefined) {
          e.preventDefault(); // Empêcher le comportement par défaut du lien (#)
          const associatedText = e.target.dataset.text;

          // Vérifier si le texte associé ressemble à une URL
          if (associatedText.startsWith('http://') || associatedText.startsWith('https://')) {
            shell.openExternal(associatedText); // Ouvrir l'URL externe
          } else {
            // Gérer le cas où ce n'est pas une URL
            // Optionnel : Vous pourriez afficher le texte d'une autre manière (ex: tooltip, console.log)
            console.log("Texte associé (non-URL) :", associatedText);
            // Ou ne rien faire si le clic ne doit rien déclencher pour le texte simple
          }
        }
      });

    } else {
      // Comportement de secours : si profileIdeas n'est pas un tableau valide ou est vide
      // Utiliser le message reçu via IPC comme avant
      breakIdeaContainer.innerHTML = message[0] || '';
      const fallbackText = message[1] || '';
      if (fallbackText) {
        breakTextElement.innerHTML = fallbackText;
        breakTextElement.style.display = 'block'; // Afficher si du texte existe
      }
    }

    // --- Appliquer l'image de fond (logique inchangée) ---
    const backgroundImage = remote.getGlobal('profileManager').getLongBreakBackground();
    if (backgroundImage) {
      try {
        const basePath = app.getAppPath(); // S'assurer que 'app' est bien défini
        const backgroundImagePath = path.join(basePath, backgroundImage); // S'assurer que 'path' est défini

        // Vérifier l'existence AVANT de l'appliquer
        if (fs.existsSync(backgroundImagePath)) { // S'assurer que 'fs' est défini
          // Normaliser les slashs pour CSS, surtout sous Windows
          const cssPath = backgroundImagePath.replace(/\\/g, '/');
          document.body.style.backgroundImage = `url('${cssPath}')`;
          document.body.style.backgroundSize = 'cover';
          document.body.style.backgroundPosition = 'center';
        } else {
          console.warn(`Image de fond non trouvée: ${backgroundImagePath}`);
        }
      } catch (error) {
        console.error("Erreur lors de l'application de l'image de fond:", error);
      }
    }
  });

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
