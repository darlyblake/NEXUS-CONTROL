# Accès distant Android : choix d'outils

## Recommandation actuelle

Pour prendre le contrôle d'un téléphone Android depuis un PC à travers Internet, tester d'abord **RustDesk** comme outil externe. Installer le client depuis les sources officielles sur le PC et sur le téléphone, puis établir une session avec l'identifiant et le mot de passe générés par l'application. Sur Android, accepter explicitement la capture d'écran et, si le modèle le nécessite, activer le service d'accessibilité ou installer le plug-in de contrôle recommandé par l'application. Vérifier les permissions et interrompre la session quand elle n'est plus nécessaire.

- Site officiel : https://rustdesk.com/
- Documentation Android : https://rustdesk.com/docs/fr/client/android/
- Code source : https://github.com/rustdesk/rustdesk

Les capacités de contrôle tactile dépendent de la version Android, du fabricant et des autorisations. La capture d'écran Android exige un consentement système ; elle ne doit pas être contournée.

## Rôle de NEXUS CONTROL

- **ADB + scrcpy** : contrôle local utile quand le téléphone est branché en USB ou déjà configuré en ADB réseau.
- **Transfert ADB ajouté à l'application** : copie un fichier du PC vers un téléphone autorisé et récupère un fichier du téléphone vers un chemin local. Cette fonction est limitée à USB/ADB réseau et n'est pas un transfert par Internet.
- **RustDesk** : solution externe recommandée pour tester une session distante complète avant de décider d'une intégration plus profonde.
- **MeshCentral** : utile pour gérer les ordinateurs et certains appareils Android ; l'agent Android documenté fournit actuellement le partage d'écran en lecture seule, sans toucher ni saisie à distance.
- **Nmap, arp-scan et Netdiscover** : outils de découverte du réseau local. Ils ne fournissent pas le contrôle à distance d'un téléphone.

## Sécurité

Ne jamais exposer le port ADB directement sur Internet. Ne pas installer un agent ou un plug-in à partir d'un site non officiel. Ne pas activer l'accès non surveillé sur un téléphone partagé ou appartenant à quelqu'un d'autre sans autorisation explicite. Pour une intégration native future, NEXUS CONTROL devra utiliser un serveur/relais HTTPS sécurisé, des identifiants d'appareil vérifiés, des jetons de session à durée limitée, des permissions par fonction et un journal de connexion.
