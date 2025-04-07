const Store = require('electron-store')
const fs = require('fs')
const path = require('path')

// Charger le fichier de profil spécifié en argument
const profilePath = process.argv[2]
// Ajouter dans votre script set-profile.js
const os = require('os')

if (!profilePath) {
  console.error('Veuillez spécifier un fichier de profil')
  process.exit(1)
}

if (!fs.existsSync(profilePath)) {
  console.error(`Le fichier de profil ${profilePath} n'existe pas`)
  process.exit(1)
}

try {

  // Déterminer le chemin du fichier config.json selon le système d'exploitation
  let configPath
  switch (process.platform) {
    case 'darwin':
      configPath = path.join(os.homedir(), 'Library', 'Application Support', 'Stretchly', 'config.json')
      break
    case 'win32':
      configPath = path.join(process.env.APPDATA, 'Stretchly', 'config.json')
      break
    default: // linux et autres
      configPath = path.join(os.homedir(), '.config', 'Stretchly', 'config.json')
  }

  // Supprimer le fichier s'il existe
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath)
    console.log(`Fichier de configuration ${configPath} supprimé.`)
    console.log('Les nouvelles valeurs par défaut seront utilisées au prochain démarrage de l\'application.')
  }
  // Lire le profil depuis le fichier
  const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'))

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

  // Stocker le profil dans le store local pour la session en cours
  const settings = new Store()
  settings.set('customProfile', profileData)

  // Créer un fichier temporaire qui définit le profil par défaut
  const tempProfileFile = path.join(__dirname, 'app', 'utils', 'customProfile.js')

  // Écrire le module d'exportation du profil
  const moduleContent = `
// Ce fichier est généré automatiquement par set-profile.js
module.exports = ${JSON.stringify(profileData, null, 2)}
`

  fs.writeFileSync(tempProfileFile, moduleContent, 'utf8')

  // Modifier defaultSettings.js pour importer le profil personnalisé
  const defaultSettingsPath = path.join(__dirname, 'app', 'utils', 'defaultSettings.js')
  let defaultSettingsContent = fs.readFileSync(defaultSettingsPath, 'utf8')

  // Vérifier si l'import du profil personnalisé existe déjà
  if (!defaultSettingsContent.includes('customProfile')) {
    // Ajouter l'import en haut du fichier
    const importStatement = `const customProfile = require('./customProfile')\n`
    defaultSettingsContent = importStatement + defaultSettingsContent

    // Ajouter le profil personnalisé à l'objet de paramètres exporté
    // Remplacer le dernier accolade fermante par une référence au profil personnalisé
    defaultSettingsContent = defaultSettingsContent.replace(
      /}(\s*)$/,
      '  customProfile: customProfile\n}$1'
    )

    // Écrire les modifications dans le fichier defaultSettings.js
    fs.writeFileSync(defaultSettingsPath, defaultSettingsContent, 'utf8')

    console.log(`Profil ${profileData.name} intégré dans les paramètres par défaut!`)
  } else {
    console.log('Le profil personnalisé est déjà intégré dans les paramètres par défaut.')
  }

  console.log(`Profil ${profileData.name} défini avec succès!`)
  console.log('Configuration terminée')
} catch (error) {
  console.error('Erreur lors de la configuration du profil:', error)
  process.exit(1)
}
