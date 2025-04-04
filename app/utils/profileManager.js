const Store = require('electron-store')
const path = require('path')
const fs = require('fs')
const { app } = require('electron')

class ProfileManager {
  constructor(settings) {
    this.settings = settings
    this.profilesDir = path.join(app.getPath('userData'), 'profiles')
    this.ensureProfilesDirectory()
  }

  ensureProfilesDirectory() {
    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true })
    }
  }

  getProfiles() {
    return this.settings.get('profiles.list')
  }

  getActiveProfile() {
    const activeProfileId = this.settings.get('profiles.active')
    return this.settings.get(`profiles.list.${activeProfileId}`)
  }

  setActiveProfile(profileId) {
    this.settings.set('profiles.active', profileId)
  }

  createProfile(name) {
    const profileId = Date.now().toString()
    const newProfile = {
      name,
      backgroundImage: null,
      content: {
        microbreak: null,
        break: null
      },
      colors: {
        microbreak: '#478484',
        break: '#478484'
      }
    }

    this.settings.set(`profiles.list.${profileId}`, newProfile)
    return profileId
  }

  updateProfile(profileId, data) {
    this.settings.set(`profiles.list.${profileId}`, {
      ...this.settings.get(`profiles.list.${profileId}`),
      ...data
    })
  }

  deleteProfile(profileId) {
    // Don't delete default profile
    if (profileId === 'default') return false

    const profiles = this.settings.get('profiles.list')
    delete profiles[profileId]
    this.settings.set('profiles.list', profiles)

    // If we deleted the active profile, switch to default
    if (this.settings.get('profiles.active') === profileId) {
      this.settings.set('profiles.active', 'default')
    }

    return true
  }

  // Methods for background images
  saveBackgroundImage(profileId, imageData, type) {
    const fileName = `${profileId}-${type}-bg.png`
    const imagePath = path.join(this.profilesDir, fileName)

    // Remove data URL prefix if present
    let imgData = imageData
    if (imageData.startsWith('data:image')) {
      imgData = imageData.split(',')[1]
    }

    fs.writeFileSync(imagePath, Buffer.from(imgData, 'base64'))

    // Update profile
    this.settings.set(`profiles.list.${profileId}.backgroundImage.${type}`, fileName)
    return fileName
  }

  getBackgroundImagePath(profileId, type) {
    const fileName = this.settings.get(`profiles.list.${profileId}.backgroundImage.${type}`)
    if (!fileName) return null

    return path.join(this.profilesDir, fileName)
  }
}

module.exports = ProfileManager
