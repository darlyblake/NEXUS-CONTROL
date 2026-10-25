# Intégration scrcpy / ADB

Objectif : détecter un appareil Android autorisé et lancer scrcpy depuis Ubuntu.

Tests de base :

```bash
adb devices
scrcpy --version
```

Commencer par USB. Le débogage sans fil sera ajouté après validation du modèle de sécurité. Ne jamais ouvrir le port ADB sur Internet.

Source officielle : https://github.com/Genymobile/scrcpy
