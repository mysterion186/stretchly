const path = require('path')
const fs = require('fs')
const log = require('electron-log/main')

class ProfileManager {

  constructor(settings) {
    this.settings = settings

    console.log("Valeur récupérée depuis settings: ", + settings)
    // Vérifier si un profil existe déjà dans les settings
    if (!this.settings.has('customProfile')) {
      // Initialiser avec un profil par défaut si aucun n'existe
      this.initializeDefaultProfile()
    }
    else {
      this.profile = this.settings.get('customProfile')
    }

    log.info("profil chargé: ", this.profile)

    log.info('Stretchly: profil client chargé depuis les settings')
  }

  initializeDefaultProfile() {
    const defaultProfile = {
      name: 'Default Client Profile',
      miniBreakBackground: path.join(__dirname, '../images/profiles/client-mini-bg.jpg'),
      longBreakBackground: path.join(__dirname, '../images/profiles/client-long-bg.jpg'),
      miniBreakIdeas: [
        "Prenez un moment pour respirer profondément",
        "Étirez vos bras vers le ciel",
        "Regardez au loin pour reposer vos yeux"
      ],
      longBreakIdeas: [
        {
          title: "Marchez un peu",
          text: "Faire quelques pas aide à stimuler la circulation et à détendre les muscles"
        },
        {
          title: "Hydratez-vous",
          text: "Boire de l'eau est essentiel pour maintenir votre concentration"
        }
      ]
    }

    this.settings.set('customProfile', defaultProfile)
    log.info('Stretchly: profil par défaut initialisé dans les settings')
  }

  updateProfile(newProfile) {
    this.settings.set('customProfile', newProfile)
    this.profile = newProfile
    log.info('Stretchly: profil mis à jour dans les settings')
  }

  getActiveProfile() {
    return this.profile
  }

  // Obtenir une idée de pause courte
  getMiniBreakIdea() {
    if (!this.profile || !this.profile.miniBreakIdeas) return null

    return this.profile.miniBreakIdeas[Math.floor(Math.random() * this.profile.miniBreakIdeas.length)]
  }

  // Obtenir une idée de pause longue
  getLongBreakIdea() {
    if (!this.profile || !this.profile.longBreakIdeas) return null

    return this.profile.longBreakIdeas
  }

  // Obtenir l'image de fond pour une pause courte
  getMiniBreakBackground() {
    return this.profile ? this.profile.miniBreakBackground : null
  }

  // Obtenir l'image de fond pour une pause longue
  getLongBreakBackground() {
    return this.profile ? this.profile.longBreakBackground : null
  }

  exportProfile(filePath) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.profile, null, 2), 'utf8')
      log.info(`Stretchly: profil exporté vers ${filePath}`)
      return true
    } catch (error) {
      log.error('Stretchly: erreur lors de l\'exportation du profil', error)
      return false
    }
  }

  // Importer un profil depuis un fichier JSON
  importProfile(filePath) {
    try {
      const profileData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      this.updateProfile(profileData)
      log.info(`Stretchly: profil importé depuis ${filePath}`)
      return true
    } catch (error) {
      log.error('Stretchly: erreur lors de l\'importation du profil', error)
      return false
    }
  }

}

module.exports = ProfileManager
