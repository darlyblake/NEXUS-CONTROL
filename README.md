# NEXUS CONTROL

Application de bureau open source pour administrer les appareils personnels depuis une interface unifiée.

## Fonctionnalités de la première version

- Interface de bureau Tauri 2 + React + TypeScript.
- Tableau de bord et navigation en français.
- Détection locale des outils ADB, scrcpy, Node.js, MeshCentral CLI et WireGuard.
- Découverte des appareils Android via `adb devices -l`.
- Lancement de scrcpy depuis la fiche d'un appareil, après validation qu'il est toujours connecté et autorisé.
- Pages de préparation des intégrations, sécurité, journal et paramètres.

Les fonctions de bureau distant MeshCentral, transfert de fichiers, scripts, automatisations, Android TV, Home Assistant et gestion Apple restent à intégrer. L'interface indique leur état sans prétendre qu'elles sont déjà opérationnelles.

## Architecture

- **Tauri 2 + React + TypeScript** : application de bureau multiplateforme.
- **MeshCentral** : intégration prévue pour les ordinateurs Windows/Linux.
- **scrcpy + ADB** : premier connecteur Android local.
- **WireGuard** : accès distant privé, à configurer après validation de la sécurité locale.
- **Connecteurs futurs** : Android TV, Home Assistant et gestion Apple/MDM selon les capacités autorisées.

## Installation

Voir [Installation Ubuntu](docs/installation-ubuntu.md).

Depuis le dossier de l'application :

```bash
cd apps/desktop
npm install
npm run tauri dev
```

## Sécurité

Ne pas exposer ADB, les terminaux ni les interfaces d'administration directement sur Internet. Le contrôle Android requiert l'autorisation explicite du téléphone. Voir [Sécurité](docs/security.md).

## Validation continue

Un workflow GitHub Actions vérifie le build frontend et la compilation Rust sur Ubuntu.

## Licence

MIT — voir [LICENSE](LICENSE). Les logiciels intégrés restent soumis à leurs licences respectives.
