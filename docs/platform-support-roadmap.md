# Architecture multiplateforme de NEXUS CONTROL

## Principe central

NEXUS CONTROL ne doit pas être limité à une connexion PC → Android. Le produit doit permettre à un appareil contrôleur de se connecter à un appareil distant de type différent, sous réserve des capacités techniques et des autorisations du système distant.

## Matrice cible

| Contrôleur | Appareil distant | Cible fonctionnelle |
|---|---|---|
| PC Windows/Linux | PC Windows/Linux | Affichage distant, clavier/souris, transfert de fichiers, presse-papiers lorsque pris en charge |
| PC Windows/Linux | Android | Partage d’écran, contrôle interactif si le modèle et les autorisations le permettent, transfert de fichiers |
| PC Windows/Linux | iPhone/iPad | Fonctions explicitement compatibles avec iOS/iPadOS ; ne pas promettre le contrôle complet de l’appareil |
| Android | PC Windows/Linux | Affichage distant et contrôle selon l’agent installé et les droits accordés |
| Android | Android | Assistance et partage d’écran selon les capacités Android et les autorisations |
| iPhone/iPad | PC ou appareil mobile | Fonctions compatibles avec iOS/iPadOS et les applications autorisées |

La matrice est une cible produit, pas une déclaration que toutes les fonctions sont déjà implémentées.

## Architecture à prévoir

1. **Identité d’appareil indépendante du type** : identifiant stable, nom lisible, plateforme, version du système, état de connexion et capacités annoncées.
2. **Rôles séparés** : contrôleur et appareil contrôlé. Un même appareil peut remplir l’un ou l’autre rôle si sa plateforme le permet.
3. **Agent par plateforme** : composants adaptés à Windows, Linux, Android et aux possibilités officiellement permises sur iOS/iPadOS.
4. **Relais de connexion sécurisé** : transport chiffré, authentification des deux côtés, approbation explicite de la session et jetons temporaires. Ne jamais exposer directement ADB ou un port de contrôle à Internet.
5. **Négociation des capacités** : afficher séparément écran, contrôle souris/clavier, transfert de fichiers, presse-papiers et audio. Désactiver les actions indisponibles au lieu de les simuler.
6. **Journal d’audit** : appareil source, appareil cible, utilisateur, heure, autorisations et opérations effectuées.
7. **Découverte locale séparée de l’accès distant** : scanner le réseau local aide à repérer les appareils, mais ne donne pas automatiquement le droit ni la capacité de les contrôler.

## État connu de l’implémentation actuelle

- L’application de bureau Tauri/React existe.
- Le connecteur ADB Android sert à découvrir les appareils ADB autorisés et à transférer des fichiers sur USB ou sur un réseau ADB déjà configuré.
- La page Accès distant permet de configurer une adresse de serveur et propose un lien vers RustDesk pour un essai externe.
- Le transfert de fichiers ADB n’est pas un transfert Internet.
- Le partage d’écran natif, le transport distant intégré et le contrôle multiplateforme complet restent à développer et à tester.
- Le contrôle complet d’un iPhone/iPad ne doit pas être promis : iOS/iPadOS limite ce qu’une application tierce peut contrôler.

## Ordre de réalisation recommandé

1. Définir le modèle commun des appareils et leurs capacités.
2. Fiabiliser la détection et l’identification des PC Windows/Linux et des appareils mobiles.
3. Ajouter une connexion PC ↔ PC avec authentification, consentement et transport sécurisé.
4. Ajouter un agent Android avec partage d’écran et transfert de fichiers, puis contrôle interactif lorsque les autorisations le permettent.
5. Définir pour iPhone/iPad une expérience réaliste et conforme aux possibilités d’iOS/iPadOS.
6. Ajouter les connexions initiées depuis Android, puis tester chaque paire de plateformes.
7. Ajouter des tests, des journaux et une documentation de sécurité avant toute utilisation sur Internet.

## Règle d’interface

Chaque session doit montrer clairement : **appareil contrôleur**, **appareil distant**, **plateforme**, **fonctions disponibles**, **autorisations nécessaires** et **état réel de la connexion**. Une action ne doit jamais être présentée comme réussie avant confirmation du connecteur.
