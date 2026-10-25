# NEXUS Agent (Android)

Companion Android app for NEXUS CONTROL. This initial scaffold provides a device dashboard, local trust list with revocation, user-triggered screen-capture consent, file picker, installed-app inventory, and a user-controlled Accessibility settings shortcut.

## Build on Ubuntu

Install Android Studio or Android SDK command-line tools and JDK 17. Ensure Android SDK platform 35 and build-tools are installed, then run:

```bash
cd apps/android
gradle assembleDebug
```

The APK is generated at `app/build/outputs/apk/debug/app-debug.apk`. If Gradle is not installed globally, open `apps/android` in Android Studio and use **Build > Build APK(s)**.

## Current scope and limitations

This is a first Android-side MVP, not a complete remote-control system yet. It does **not** open a network listener or connect to a remote desktop server. Cross-network control requires a secure relay/signaling service, device authentication, TLS, replay-resistant session tokens, and a paired desktop client protocol. Screen capture uses Android's system consent dialog; Android does not allow silent capture. Full touch control is not enabled by this scaffold: the declared Accessibility service is inert until a reviewed, authenticated session protocol is implemented. App inventory visibility is subject to Android/Google Play policy.

Trusted devices are stored locally on this phone and can be removed by the user. This local list alone is not proof of identity to a server; do not treat it as a completed authentication system.
