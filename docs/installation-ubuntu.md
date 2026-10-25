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

## 5. Préparer Android

```bash
sudo apt install -y adb scrcpy
adb version
scrcpy --version
adb devices
```

Sur le téléphone, active les options développeur et le débogage USB uniquement pour un appareil de confiance. Vérifie l'empreinte RSA affichée par le téléphone avant d'autoriser l'ordinateur.

La page « Mes appareils » affiche les appareils réellement détectés par ADB. Le bouton d'écran distant lance scrcpy uniquement si l'appareil est encore connecté et autorisé au moment du lancement.

Si la version de scrcpy fournie par Ubuntu est ancienne, consulte le dépôt officiel : https://github.com/Genymobile/scrcpy

## 6. MeshCentral

MeshCentral est un serveur distinct. NEXUS CONTROL ne le configure pas automatiquement et ne stocke pas ses identifiants.

Guide officiel : https://docs.meshcentral.com/install/quickstart/

Ne l'expose pas sur Internet pendant les premiers tests. Valide la configuration locale, l'authentification et TLS avant de connecter des appareils.

## 7. État des fonctions

La première version comprend l'interface de bureau, la détection d'outils locaux et la découverte ADB. Le bureau distant via MeshCentral, le transfert de fichiers, les scripts et les automatisations restent à intégrer et tester. Ils ne doivent pas être considérés comme disponibles tant qu'ils ne sont pas reliés à un connecteur fonctionnel.
