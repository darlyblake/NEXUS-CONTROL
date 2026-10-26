# NEXUS CONTROL

Application de bureau open source pour administrer les appareils personnels depuis une interface unifiée.

## Fonctionnalités de la première version

- Interface de bureau Tauri 2 + React + TypeScript.
- Tableau de bord et navigation en français.
- Détection locale des outils ADB, scrcpy, Node.js, MeshCentral CLI et WireGuard.
- Découverte des appareils Android via `adb devices -l`.
- Page **Analyse réseau** : découverte d'hôtes du sous-réseau local avec Nmap (`-sn`), arp-scan si disponible, puis ping en secours ; aucun scan de ports n'est lancé par défaut.
- Page **Sécurité** : bouton d'audit local en lecture seule qui vérifie la présence de Nmap, arp-scan, Netdiscover, TShark, WireGuard et l'état d'UFW sous Linux.
- Lancement de scrcpy depuis la fiche d'un appareil, après validation qu'il est toujours connecté et autorisé.
- Scripts d’installation MeshCentral distincts pour Windows et Linux, lancés dans un terminal visible depuis la carte d’intégration (Node.js 20+ requis).
- Page **Accès distant** : configuration locale d’une URL HTTPS MeshCentral et ouverture sécurisée de la console dans le navigateur.
- Boutons graphiques pour ouvrir l'analyse Nmap/arp-scan, vérifier les outils de diagnostic et ouvrir la console distante HTTPS.

La page Sécurité fournit un audit local de présence des outils, pas un audit de vulnérabilités. La page Analyse réseau fait une découverte d'hôtes sur le réseau local, pas un scan de ports. La page Accès distant est une première étape : elle ouvre une console MeshCentral déjà déployée, mais ne crée pas encore les invitations ni ne gère les sessions directement. Le serveur public, les agents distants, l’authentification et les permissions doivent être configurés et testés. Le contrôle Android via Internet, les scripts, les automatisations, Android TV, Home Assistant et la gestion Apple restent à intégrer.

## Accès distant Android

Voir [le guide des outils de contrôle Android à distance](docs/android-remote-access.md) pour comparer RustDesk, MeshCentral et scrcpy et comprendre leurs limites. La page **Transfert de fichiers** de l'application de bureau permet désormais d'envoyer/récupérer des fichiers via ADB avec un téléphone autorisé ; elle ne remplace pas un relais sécurisé Internet.

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

Voir [Installation Ubuntu](docs/installation-ubuntu.md) et le [guide d’accès distant par Internet](docs/remote-access-link.md).

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


## Agent Android (NEXUS Agent)

Le compagnon Android se trouve dans [apps/android](apps/android/README.md). Il fournit un tableau de bord local, les informations de l'appareil, un sélecteur de fichiers, une demande de consentement système pour la capture d'écran, un inventaire des applications visibles et une liste locale d'appareils de confiance révocable.

Pour compiler sur Ubuntu, consulte [le guide Android](apps/android/README.md). GitHub Actions peut aussi produire un APK de débogage téléchargeable depuis les artefacts du workflow **Android APK**.

**Important :** cette première version n'établit pas encore de session de contrôle distante et ne transfère pas les fichiers sur le réseau. L'association locale d'un appareil n'est pas une authentification serveur. Le relais inter-réseaux, le protocole chiffré et l'intégration avec le client desktop restent à implémenter avant tout usage réel. Le service d'accessibilité est inactif et n'exécute aucune commande distante.


## Agent Android (NEXUS Agent)

Le compagnon Android se trouve dans [apps/android](apps/android/README.md). Il fournit un tableau de bord local, les informations de l'appareil, un sélecteur de fichiers, une demande de consentement système pour la capture d'écran, un inventaire des applications visibles et une liste locale d'appareils de confiance révocable.

Pour compiler sur Ubuntu, consulte le [guide Android](apps/android/README.md). GitHub Actions peut aussi produire un APK de débogage téléchargeable depuis les artefacts du workflow **Android APK**.

**Important :** cette première version n'établit pas encore de session de contrôle distante et ne transfère pas les fichiers sur le réseau. L'association locale d'un appareil n'est pas une authentification serveur. Le relais inter-réseaux, le protocole chiffré et l'intégration avec le client desktop restent à implémenter avant tout usage réel. Le service d'accessibilité est inactif et n'exécute aucune commande distante.
