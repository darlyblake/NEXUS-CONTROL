# Intégration scrcpy / ADB

Objectif : détecter un appareil Android autorisé et lancer scrcpy depuis Ubuntu ou un autre poste compatible.

## Test manuel

```bash
adb devices
scrcpy --version
```

Commencer par USB. Le téléphone doit autoriser le débogage USB pour l'ordinateur.

## Depuis NEXUS CONTROL

Dans la version native, la page « Mes appareils » appelle ADB pour lister les appareils. Le bouton « Écran distant » lance scrcpy uniquement si :

- scrcpy est disponible dans le PATH ;
- l'appareil est encore présent dans la liste ADB ;
- son état est `device`, donc qu'il a autorisé le débogage.

Le connecteur ne démarre pas de session si l'appareil est absent ou non autorisé.

Le débogage sans fil sera ajouté après validation du modèle de sécurité. Ne jamais exposer le port ADB directement sur Internet.

Source officielle : https://github.com/Genymobile/scrcpy
