# NEXUS CONTROL

Application de bureau open source pour administrer les appareils personnels depuis une interface unifiée.

## Fonctionnalités de la première version

- Interface de bureau Tauri 2 + React + TypeScript.
- Tableau de bord et navigation en français.
- Détection locale des outils ADB, scrcpy, Node.js, MeshCentral CLI et WireGuard.
- Découverte des appareils Android via `adb devices -l`.
- Lancement de scrcpy depuis la fiche d'un appareil, après validation qu'il est toujours connecté et autorisé.
- Scripts d’installation MeshCentral distincts pour Windows et Linux, lancés dans un terminal visible depuis la carte d’intégration (Node.js 20+ requis).
- Pages de préparation des intégrations, sécurité, journal et paramètres.

Les fonctions de bureau distant MeshCentral, transfert de fichiers, scripts, automatisations, Android TV, Home Assistant et gestion Apple restent à intégrer. L'interface indique leur état sans prétendre qu'elles sont déjà opérationnelles.

## Architecture

- **Tauri 2 + React + TypeScript** : application de bureau multiplateforme.
- **MeshCentral** : intégration prévue pour les ordinateurs Windows/Linux.
- **scrcpy + ADB** : premier connecteur Android local.
- **WireGuard** : accès distant privé, à configurer après validation de la sécurité locale.
- **Connecteurs futurs** : Android TV, Home Assistant et gestion Apple/MDM selon les capacités autorisées.

## Applications natives Windows et Linux

NEXUS CONTROL est conçu comme une application de bureau Tauri, pas seulement comme un site web. Le workflow **Build desktop** construit les paquets natifs sur des runners Windows et Ubuntu et publie les fichiers en tant qu'artefacts GitHub Actions.

- Windows : paquets natifs générés par Tauri (selon les cibles activées).
- Linux : paquets natifs générés par Tauri (selon les cibles activées).
- Pour obtenir les paquets, ouvre l'onglet **Actions** du dépôt GitHub, sélectionne **Build desktop**, puis consulte les artefacts du dernier workflow réussi.
- Pour lancer en développement local : `npm run tauri dev`.
- Pour construire sur le système actuel : `npm run tauri:build`.

Le premier build doit encore être validé dans GitHub Actions avant de considérer les paquets comme prêts à distribuer.

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
