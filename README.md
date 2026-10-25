# NEXUS CONTROL

Application de bureau open source pour administrer les appareils personnels depuis une interface unifiée.

## Stratégie

NEXUS CONTROL réutilise des outils existants au lieu de réimplémenter les protocoles de contrôle à distance :

- **Tauri 2 + React + TypeScript** : application de bureau.
- **MeshCentral** : gestion à distance des ordinateurs Windows/Linux.
- **scrcpy + ADB** : affichage et contrôle des appareils Android autorisés.
- **WireGuard** : réseau privé pour l'accès distant, ajouté après validation du réseau local.
- **Connecteurs futurs** : Android TV, Home Assistant, gestion Apple/MDM selon les capacités et autorisations des appareils.

## État du projet

Phase initiale : structure, documentation, préparation de l'environnement Ubuntu et tests locaux. Les fonctions de contrôle ne sont pas encore intégrées à l'interface.

## Prérequis de développement

- Ubuntu 24.04 ou compatible
- Git, Node.js LTS et npm
- Rust via rustup
- Dépendances système Tauri 2
- Android Platform Tools (ADB) pour les tests Android

## Démarrage

Voir [Installation Ubuntu](docs/installation-ubuntu.md).

## Sécurité

Ne pas exposer ADB, les terminaux ni les interfaces d'administration directement sur Internet. Commencer sur le réseau local, utiliser des identités individuelles par appareil et demander une confirmation avant toute action sensible. Voir [Sécurité](docs/security.md).

## Licence

À définir avant une première publication stable. Les licences des outils intégrés restent distinctes ; consulter leurs dépôts officiels.
