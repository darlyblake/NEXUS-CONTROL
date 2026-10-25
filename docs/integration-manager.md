# Gestionnaire d'intégrations NEXUS CONTROL

Le bouton **Installer / configurer** d'une intégration native peut ouvrir un script dédié au système d'exploitation. Les scripts sont versionnés dans `scripts/installers/` et intégrés au binaire par le code Rust Tauri.

## MeshCentral (première intégration d'installation)

- Linux : `scripts/installers/meshcentral-linux.sh`
- Windows : `scripts/installers/meshcentral-windows.ps1`
- Le script utilise Node.js/npm présents sur le poste et crée les données dans le dossier utilisateur, sans exiger un serveur distant.
- Il installe le paquet npm `meshcentral`, crée une configuration locale sur le port 4430 si aucune configuration n'existe, puis démarre le serveur dans un terminal visible.
- Le terminal reste le lieu d'affichage des journaux. L'utilisateur peut arrêter le serveur avec Ctrl+C.
- Sur Windows, si Node.js est absent et winget disponible, le script propose l'installation de Node.js LTS puis demande de relancer l'intégration pour actualiser le PATH. Sur Linux, les prérequis manquants sont affichés plutôt que de lancer silencieusement une installation privilégiée.

## Limites et sécurité

- Ce flux installe et démarre le serveur local ; il ne configure pas automatiquement les agents sur d'autres ordinateurs.
- L'accès initial, les comptes, les certificats TLS et le pare-feu doivent être vérifiés avant toute utilisation hors du poste local.
- Ne pas exposer le port 4430 à Internet pendant les tests.
- Les scripts sont choisis dans une liste fixe côté Rust ; aucun script ou argument arbitraire fourni par l'interface n'est exécuté.
- Les scripts sont affichés dans un terminal séparé afin que les invites de privilèges et les erreurs soient visibles.
