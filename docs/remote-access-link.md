# Accès distant par Internet

## État actuel

La page **Accès distant** de NEXUS CONTROL mémorise localement l'URL HTTPS d'une console MeshCentral et peut l'ouvrir dans le navigateur par défaut. Elle ne crée pas elle-même de session distante et ne génère pas encore de lien d'invitation. Le statut reste explicitement « En attente » tant que le serveur et les appareils ne sont pas configurés.

## Architecture recommandée

- **Ordinateurs Windows/Linux** : serveur MeshCentral public derrière HTTPS, avec un nom de domaine et un certificat TLS valide.
- **Appareils gérés** : agent MeshCentral officiel installé et rattaché au serveur par une personne autorisée.
- **Accès opérateur** : compte nominatif, authentification forte si disponible, permissions minimales, révocation immédiate des accès qui ne sont plus nécessaires.
- **Invitations** : générer les liens temporaires depuis les fonctions prévues par le serveur, puis les transmettre uniquement au destinataire prévu. Ne pas mettre de mot de passe ou de jeton durable dans une URL partagée.
- **Fichiers** : utiliser les fonctions de transfert de fichiers de la console après authentification et contrôle des droits.
- **Android** : traitement distinct. Un lien web ne contourne ni l'autorisation Android ni les limites d'API du système. Le débogage sans fil ADB ne doit pas être exposé directement à Internet.

## Mise en service

1. Choisir un hébergement maintenu et accessible depuis les deux réseaux (serveur public ou service d'hébergement adapté).
2. Déployer et mettre à jour MeshCentral en suivant sa documentation officielle. Configurer le domaine et HTTPS avant d'y rattacher des appareils.
3. Créer des comptes nominatifs et appliquer les permissions les plus restrictives possibles.
4. Installer l'agent officiel sur un ordinateur de test dont tu es propriétaire ou que tu es autorisé à administrer.
5. Depuis NEXUS CONTROL, ouvrir **Accès distant**, renseigner l'URL HTTPS de la console et cliquer sur **Ouvrir la console distante**.
6. Vérifier le contrôle d'écran et le transfert de fichiers sur ce seul appareil de test. Vérifier aussi que la révocation coupe l'accès.
7. Utiliser les invitations temporaires fournies par le serveur si un technicien doit recevoir un accès ponctuel.

## Contrôles de sécurité

- N'accepter que des URL HTTPS ; ne pas incorporer d'identifiants dans l'URL.
- Ne jamais ouvrir ADB, un terminal ou une API d'administration directement à Internet.
- Ne jamais accepter une connexion silencieusement sur l'appareil distant.
- Journaliser les connexions et les opérations sensibles dans la future intégration.
- Tester l'expiration, la révocation et les permissions avant une utilisation réelle.

## Ce qui reste à développer dans NEXUS CONTROL

L'écran actuel est une première étape de configuration, pas une intégration complète du protocole MeshCentral. Il reste à ajouter, puis à tester contre un serveur réel : détection de l'état du serveur, authentification/API officiellement prise en charge, liste des appareils distants, ouverture d'une session spécifique, création et révocation d'invitations temporaires et journalisation des actions. Le contrôle Android par Internet doit faire l'objet d'une intégration distincte.
