const Store = require('electron-store')
const fs = require('fs')
const path = require('path')

// Charger le fichier de profil spécifié en argument
const profilePath = process.argv[2]

if (!profilePath) {
  console.error('Veuillez spécifier un fichier de profil')
  process.exit(1)
}

if (!fs.existsSync(profilePath)) {
  console.error(`Le fichier de profil ${profilePath} n'existe pas`)
  process.exit(1)
}

try {
  // Lire le profil depuis le fichier
  const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'))

  // Initialiser le store
  const settings = new Store()

  // Normaliser les chemins d'image pour qu'ils soient correctement référencés
  if (profileData.miniBreakBackground) {
    // Si le chemin commence par '../', on considère qu'il pointe déjà vers le bon dossier
    if (profileData.miniBreakBackground.startsWith('../')) {
      profileData.miniBreakBackground = profileData.miniBreakBackground.replace('../', '')
    }
  }

  if (profileData.longBreakBackground) {
    if (profileData.longBreakBackground.startsWith('../')) {
      profileData.longBreakBackground = profileData.longBreakBackground.replace('../', '')
    }
  }

  // Définir le profil dans les settings
  settings.set('customProfile', profileData)

  console.log(`Profil ${profileData.name} défini avec succès!`)
  console.log('Configuration terminée')
} catch (error) {
  console.error('Erreur lors de la configuration du profil:', error)
  process.exit(1)
}
