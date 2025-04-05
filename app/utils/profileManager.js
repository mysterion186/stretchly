const path = require('path')
const fs = require('fs')
const log = require('electron-log/main')

class ProfileManager {
  constructor(settings) {
    this.settings = settings

    // Définir le profil directement dans le code
    // Ce profil sera utilisé et ne pourra pas être modifié par l'utilisateur
    this.profile = {
      name: 'Client Profile',
      miniBreakBackground: path.join(__dirname, '../images/profiles/IMG_4805.JPG'),
      longBreakBackground: path.join(__dirname, '../images/profiles/wallpaper.jpeg'),
      miniBreakIdeas: [
        "Message numéro 1",
        "Message numéro 2",
        "Message numéro 3",
      ],
      longBreakIdeas: [
        {
          title: "text custom",
          text: "message custom 1"
        },
        {
          title: "text custom 2",
          text: "message custom 2"
        }
      ]
    }

    log.info('Stretchly: profil client chargé')
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

    return this.profile.longBreakIdeas[Math.floor(Math.random() * this.profile.longBreakIdeas.length)]
  }

  // Obtenir l'image de fond pour une pause courte
  getMiniBreakBackground() {
    return this.profile ? this.profile.miniBreakBackground : null
  }

  // Obtenir l'image de fond pour une pause longue
  getLongBreakBackground() {
    return this.profile ? this.profile.longBreakBackground : null
  }
}

module.exports = ProfileManager
