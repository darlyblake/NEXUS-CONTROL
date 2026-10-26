# NEXUS Agent (Android)

Application Android compagnon de NEXUS CONTROL. Elle propose une navigation latérale, une page Envoyer, une page Réception, les informations de l'appareil, la liste locale de confiance et les réglages de permissions.

## Build on Ubuntu

Install Android Studio or Android SDK command-line tools and JDK 17. Ensure Android SDK platform 35 and build-tools are installed, then run:

```bash
cd apps/android
gradle assembleDebug
```

The APK is generated at `app/build/outputs/apk/debug/app-debug.apk`. If Gradle is not installed globally, open `apps/android` in Android Studio and use **Build > Build APK(s)**.

## Transfert local de fichiers

Pour recevoir un fichier depuis le PC :
1. Connecte le PC et le téléphone au même Wi-Fi privé.
2. Ouvre **Réception** dans l'application Android et touche **Démarrer la réception**.
3. Copie l'adresse et le jeton affichés (le bouton de copie place les deux dans le presse-papiers).
4. Dans NEXUS CONTROL sur le PC, ouvre **Transfert de fichiers**, indique le chemin absolu du fichier PC, colle l'adresse et le jeton dans la section **Envoyer vers Android par Wi-Fi**, puis lance l'envoi.
5. Vérifie la page **Réception** sur Android ; les fichiers sont stockés dans le dossier privé de l'application sous Downloads/NexusReceived.
6. Arrête le récepteur quand le transfert est terminé.

Le transfert Wi-Fi utilise un récepteur HTTP local sur le port 8765 et un jeton aléatoire. Il est prévu pour un réseau privé de confiance, n'utilise pas HTTPS et ne doit jamais être exposé à Internet ou utilisé sur un Wi-Fi public. Pour un transfert USB, la page PC conserve également le connecteur ADB.

## Limites actuelles

Cette application ne constitue pas encore un système complet de contrôle distant. Le transfert Wi-Fi est local uniquement ; le contrôle multiplateforme par Internet nécessite un relais sécurisé, l'authentification des appareils, TLS, des jetons de session à durée limitée et un protocole partagé avec le client de bureau. Screen capture uses Android's system consent dialog; Android does not allow silent capture. Full touch control is not enabled by this scaffold: the declared Accessibility service is inert until a reviewed, authenticated session protocol is implemented. App inventory visibility is subject to Android/Google Play policy.

Trusted devices are stored locally on this phone and can be removed by the user. This local list alone is not proof of identity to a server; do not treat it as a completed authentication system.
