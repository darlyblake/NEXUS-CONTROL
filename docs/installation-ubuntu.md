# Installation sur Ubuntu

## 1. Prérequis

Ubuntu 24.04 ou compatible, Git, Node.js LTS, npm, Rust stable et Cargo.

## 2. Dépendances système Tauri 2

```bash
sudo apt update
sudo apt install -y \
  git curl wget file build-essential pkg-config \
  libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf
```

Référence officielle : https://v2.tauri.app/start/prerequisites/

## 3. Récupérer le dépôt

```bash
mkdir -p ~/Projets
cd ~/Projets
git clone https://github.com/darlyblake/NEXUS-CONTROL.git
cd NEXUS-CONTROL/apps/desktop
npm install
```

Le squelette Tauri est déjà versionné dans le dépôt : il n'est pas nécessaire de relancer le générateur.

## 4. Lancer l'application

```bash
npm run tauri dev
```

Pour vérifier le frontend :

```bash
npm run build
```

## 5. Construire l'application de bureau

Depuis `apps/desktop`, installe les dépendances Node.js, puis lance :

```bash
npm install
npm run tauri:build
```

Les paquets générés sont dans `apps/desktop/src-tauri/target/release/bundle/`. Pour construire la version Windows, utilise un ordinateur Windows ou le workflow GitHub Actions **Build desktop** ; un paquet Windows natif ne se construit pas comme une cible Linux ordinaire.

## 6. Préparer Android

```bash
sudo apt install -y adb scrcpy
adb version
scrcpy --version
adb devices
```

Sur le téléphone, active les options développeur et le débogage USB uniquement pour un appareil de confiance. Vérifie l'empreinte RSA affichée par le téléphone avant d'autoriser l'ordinateur.

La page « Mes appareils » affiche les appareils réellement détectés par ADB. Le bouton d'écran distant lance scrcpy uniquement si l'appareil est encore connecté et autorisé au moment du lancement.

Si la version de scrcpy fournie par Ubuntu est ancienne, consulte le dépôt officiel : https://github.com/Genymobile/scrcpy

## 7. MeshCentral

Dans l'application de bureau, ouvre **Intégrations → MeshCentral → Installer / configurer**. NEXUS CONTROL détecte Windows ou Linux et ouvre le script correspondant dans un terminal visible.

Le script installe le paquet MeshCentral dans le dossier de données de l'utilisateur, crée une configuration locale sur le port 4430 si elle n'existe pas déjà, puis démarre le serveur. Il nécessite Node.js 20+ et npm. Sur Windows, si Node.js est absent et winget est disponible, l'installation de Node.js LTS est proposée ; relance ensuite l'intégration. Sur Ubuntu, le script indique les commandes à utiliser si Node.js/npm manquent ou sont trop anciens.

Adresse de test : https://localhost:4430. Le serveur tourne tant que le terminal d'installation reste actif ; arrête-le avec Ctrl+C. La configuration existante est conservée lors des exécutions suivantes.

Guide officiel : https://docs.meshcentral.com/install/quickstart/

**Sécurité :** ce premier flux installe et démarre le serveur, mais n'installe pas encore les agents sur les autres appareils et ne connecte pas automatiquement ces appareils à NEXUS CONTROL. Ne l'expose pas sur Internet. Vérifie les comptes, TLS et le pare-feu avant tout usage sur un réseau partagé.

## 8. État des fonctions

La première version comprend l'interface de bureau, la détection d'outils locaux, la découverte ADB et un flux d'installation/démarrage local de MeshCentral sur Windows et Linux. Le contrôle des bureaux distants via MeshCentral, le transfert de fichiers, l'installation des agents, les scripts et les automatisations restent à intégrer et tester.
