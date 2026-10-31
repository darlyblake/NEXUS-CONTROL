# NEXUS CONTROL — Journal des Modifications (Changelog)

Ce document enregistre de façon chronologique et détaillée toutes les modifications apportées au projet NEXUS CONTROL : ajouts de fonctionnalités, corrections de bugs, améliorations d'interface, et refactorisations.

---

## [Finalisation du Portail Mobile Companion & Connexion Express (USB / QR Code)] — 1er Novembre 2026

### 🎯 Objectif
Fournir une expérience d'appairage et de prise de contrôle instantanée en 1 clic pour n'importe quel smartphone, utilisable sans configuration manuelle :
1. **Par câble USB en 15 secondes chrono** : détection de l'appareil, passage automatique en mode sans fil ADB TCP/IP, récupération de l'IP Wi-Fi, push et installation de l'APK Agent NEXUS, et démarrage du service sans fil.
2. **Par Wi-Fi via QR Code / lien direct** : démarrage d'un mini-serveur HTTP local dans l'application Tauri sur le port 4242, génération d'un QR Code interactif et lien direct, ouvrant un portail mobile responsive sans aucune application à installer au préalable.

---

### 🚀 Fonctionnalités Finalisées et Intégrées

#### 1. Backend Rust (Serveur Companion & Séquenceur USB 15s)
- **Serveur HTTP Companion local (`start_companion_server`)** :
  - Démarre un `TcpListener` local sur `0.0.0.0:4242`.
  - Génère un jeton cryptographique UUID unique valable 5 minutes.
  - Distribue la page responsive `companion_portal.html` sur `GET /` et `GET /pair`.
  - Distribue directement l'APK de l'agent Android sur `GET /download-agent`.
  - Commande d'arrêt sécurisé (`stop_companion_server`).
- **Auto-connexion USB 15 secondes (`auto_connect_usb_android`)** :
  - `adb tcpip 5555` pour activer l'écoute réseau ADB.
  - Extraction automatique de l'IP du smartphone sur le sous-réseau local (`ip route` / `ip addr show wlan0`).
  - `adb connect <IP>:5555` pour basculer en mode sans fil.
  - Déploiement automatique de l'APK `app-debug.apk` vers `/data/local/tmp/nexus-agent.apk`.
  - Installation silencieuse avec `pm install -t -r`.
  - Lancement immédiat de l'agent avec `am start -n com.nexuscontrol.agent/.MainActivity`.
  - Émission d'une notification système native avec rapport complet des étapes validées.

#### 2. Frontend React (`CompanionPortal.tsx` & `CompanionPortal.css`)
- **Onglet Câble USB (15s Auto)** :
  - Détection automatique et sélection visuelle de l'appareil branché.
  - Bouton d'action "⚡ Configuration et Connexion Express (15s)".
  - Compte à rebours animé et jauge de progression en temps réel (0 à 100%).
  - Journal d'exécution des étapes horodaté.
  - Accès direct en 1 clic au streaming d'écran et à l'explorateur de fichiers.
- **Onglet Wi-Fi Direct (QR Code & Lien)** :
  - Démarrage et arrêt du serveur en 1 clic.
  - Génération dynamique du QR Code via `qrcode.react`.
  - Lien direct cliquable avec bouton de copie dans le presse-papiers.
  - Compte à rebours de validité du jeton avec barre de progression de sécurité.
  - Guide d'utilisation et présentation des fonctionnalités du portail mobile.

#### 3. Intégration globale dans l'application (`App.tsx`)
- Nouvel onglet de navigation permanent **"Appairage Express (QR/USB)"** avec icône éclair (`Zap`).
- Raccordement direct aux commandes natives de capture d'écran (`scrcpy`) et de transfert de fichiers.

---

## [Finalisation Complète du Pilier A : Continuité & Gestion au quotidien] — 31 Octobre 2026

### 🎯 Objectif
Compléter et finaliser à 100% l'ensemble des fonctionnalités du **Pilier A (Continuité & Gestion au quotidien)** : presse-papiers partagé universel, synchronisation des notifications avec réponse rapide, et explorateur de fichiers distant double panneau avec drag & drop et aperçu direct.

---

### 🚀 Fonctionnalités Finalisées et Intégrées

#### 1. Presse-papiers partagé universel (Section A1)
- **Commandes Rust natives :**
  - `read_system_clipboard` : lecture du presse-papiers système (support de `wl-paste` sous Wayland, `xclip` sous X11 et `Get-Clipboard` sous Windows).
  - `write_system_clipboard` : écriture dans le presse-papiers système de l'OS avec gestion des pipes stdin.
- **Écoute automatique en arrière-plan :** case à cocher dans l'interface permettant de surveiller le presse-papiers local et de synchroniser automatiquement les nouveaux éléments sans clic manuel.
- **Sécurité & Confidentialité :**
  - Détection heuristique des mots de passe, jetons d'authentification (`bearer`, `token`), secrets et clés API.
  - Masquage automatique des données sensibles (`•••••••• (Secret masqué)`) avec bouton œil pour démasquer à la demande.
  - Bouton de purge intégrale de l'historique du presse-papiers.

#### 2. Synchronisation des notifications Android & Réponse rapide (Section A2)
- **Service Android natif :**
  - Création de [`NexusNotificationListenerService.kt`](file:///home/freid-blake/NEXUS-CONTROL/apps/android/app/src/main/java/com/nexuscontrol/agent/NexusNotificationListenerService.kt) pour intercepter les notifications du système Android (titre, message, package applicatif, actions de réponse).
  - Déclaration du service dans [`AndroidManifest.xml`](file:///home/freid-blake/NEXUS-CONTROL/apps/android/app/src/main/AndroidManifest.xml) avec la permission `BIND_NOTIFICATION_LISTENER_SERVICE`.
- **Notifications natives sur le bureau :**
  - Ajout de la commande Tauri `send_system_notification` utilisant `notify-send` sur Linux et Windows Forms sur Windows.
- **Réponse Rapide (Quick Reply) :**
  - Ajout de la commande Tauri `adb_send_quick_reply` permettant d'injecter la réponse directement dans l'application active du smartphone.
- **Filtrage des notifications sensibles :** masquage des SMS bancaires et codes de vérification 2FA avec révélation sur clic explicite.

#### 3. Explorateur de fichiers distant double panneau (Section A3)
- **Commandes Rust d'exploration de répertoires réels :**
  - `list_local_directory` : explore les répertoires locaux de l'ordinateur (`fs::read_dir`), classe les dossiers en premier, extrait la taille et le type de fichier (images, vidéos, audio, archives, documents).
  - `adb_list_directory` : explore les répertoires réels du stockage Android via `adb shell ls -1F`.
- **Aperçu direct de fichier (sans téléchargement préalable) :**
  - Ajout d'un bouton d'inspection rapide (icône œil) sur chaque fichier.
  - Modal d'aperçu dédié affichant le type, le nom et le chemin complet.
- **Glisser-Déposer (Drag & Drop) interactif :**
  - Attributs `draggable` et gestionnaires `onDragOver` / `onDrop` intégrés sur les panneaux pour initier le transfert par simple glissement d'un panneau à l'autre.

---

### 📁 Fichiers Modifiés et Ajoutés

1. **Backend Rust (Tauri) :**
   - [`apps/desktop/src-tauri/src/main.rs`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src-tauri/src/main.rs) : Ajout et enregistrement des commandes `list_local_directory`, `adb_list_directory`, `read_system_clipboard`, `write_system_clipboard`, `send_system_notification` et `adb_send_quick_reply`.
2. **Frontend React / TypeScript :**
   - [`apps/desktop/src/components/DoublePanelFileExplorer.tsx`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/DoublePanelFileExplorer.tsx) : Intégration du chargement réel des dossiers locaux/Android, modal d'aperçu direct et drag & drop.
   - [`apps/desktop/src/components/ContinuityDashboard.tsx`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/ContinuityDashboard.tsx) : Intégration de l'écoute du presse-papiers système, masquage des secrets, notifications natives et réponse rapide ADB.
3. **Application Android :**
   - [`apps/android/app/src/main/java/com/nexuscontrol/agent/NexusNotificationListenerService.kt`](file:///home/freid-blake/NEXUS-CONTROL/apps/android/app/src/main/java/com/nexuscontrol/agent/NexusNotificationListenerService.kt) : Service d'écoute des notifications.
   - [`apps/android/app/src/main/AndroidManifest.xml`](file:///home/freid-blake/NEXUS-CONTROL/apps/android/app/src/main/AndroidManifest.xml) : Déclaration du service de notifications.
4. **Feuille de route & Documentation :**
   - [`docs/CHECKLIST_FONCTIONNALITES.md`](file:///home/freid-blake/NEXUS-CONTROL/docs/CHECKLIST_FONCTIONNALITES.md) : Section A validée et marquée comme terminée (`[FINALISÉ ✅]`).

---

### 🧪 Validation Technique
- Compilation Rust Tauri (`cargo check`) : validée avec succès en 24 secondes, aucune erreur.
- Compilation Frontend TypeScript / Vite (`npm run build`) : validée avec succès en 1 min 7 s, zéro erreur.

---

## [Finalisation Complète du Pilier B : Télémétrie & Surveillance en temps réel] — 31 Octobre 2026

### 🎯 Objectif
Surveiller en temps réel l'ensemble de la flotte d'appareils connectés (PC et smartphones Android) avec métriques matérielles en direct, estimations d'autonomie et alertes proactives configurables.

---

### 🚀 Fonctionnalités Finalisées et Intégrées

#### 1. Télémétrie de flotte en direct (Section B1)
- **Backend Rust natif (`get_fleet_telemetry`) :**
  - **RAM :** Extraction temps réel depuis `/proc/meminfo` (`MemTotal`, `MemAvailable`).
  - **CPU :** Charge système depuis `/proc/loadavg`.
  - **Température :** Lecture directe des capteurs thermiques matériels sous `/sys/class/thermal/thermal_zone*/temp`.
  - **Batterie :** Niveau (`capacity`), état de charge (`status`), et calcul de la durée restante estimée.
  - **Stockage :** Espace disque libre et occupé via `df -k /`.
  - **Wi-Fi :** Détection automatique du SSID réel (ex: `CANALBOX-5G`) via `nmcli`.
  - **Android ADB :** Télémétrie des smartphones Android via `dumpsys battery` et `df -k /data`.

#### 2. Alertes proactives et configuration des seuils (Section B2)
- **Panneau de configuration des seuils :**
  - Seuils ajustables : batterie faible (&le; 20%), batterie chargée (&ge; 80%), surchauffe (&ge; 45°C), stockage saturé (&ge; 85%).
  - Persistance locale des seuils dans `localStorage`.
- **Alertes visuelles et notifications système :**
  - Bannières d'avertissement contextuelles sur chaque carte d'appareil.
  - Envoi automatique de notifications de bureau natives (`send_system_notification`) avec anti-rebond.

---

## [Finalisation Complète du Pilier C : Accès distant mondial "Zéro Configuration"] — 31 Octobre 2026

### 🎯 Objectif
Offrir un accès distant sécurisé aux appareils à travers le monde sans ouvrir de port sur la box internet ni être bloqué par le CGNAT des opérateurs mobiles (4G/5G), et intégrer le streaming d'écran directement dans l'interface sans application tierce.

---

### 🚀 Fonctionnalités Finalisées et Intégrées

#### 1. Tunnel maillé P2P Zéro Configuration (Section C1)
- **Commandes Rust natives :**
  - `get_vpn_tunnel_status` : Détecte l'état du tunnel et les moteurs installés (`Tailscale`, `WireGuard`, `Netbird`).
    - Récupère l'IP maillée privée (ex: `100.98.48.61`), le nom MagicDNS et le compte authentifié.
    - Liste tous les appareils pairs du maillage avec leur OS, IP et statut en ligne.
  - `tailscale_ping_peer` : Exécute des tests de traversée NAT (STUN / DERP) et mesure la latence directe P2P en millisecondes.
- **Interface Réseau Maillé ([`RemoteAccessPanel.tsx`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/RemoteAccessPanel.tsx)) :**
  - Onglet dédié "Tunnel Maillé P2P" avec cartes d'état et badges d'activité en temps réel.
  - Copie instantanée en un clic de l'IP maillée ou du MagicDNS.
  - Testeur de liaison interactive avec diagnostic direct des routes réseau.
  - Grille des appareils distants enregistrés sur le maillage avec actions rapides.

#### 2. Streaming d'écran WebRTC et Télémaintenance (Section C2)
- **Streaming d'écran fluide intégré :**
  - Onglet "Streaming d'Écran" intégrant directement [`ScreenSharePanel.tsx`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/ScreenSharePanel.tsx) au cœur de la console (zéro fenêtre externe).
  - Contrôle de la résolution (HD, 720p, etc.) et de la fréquence d'images (FPS).
  - Protocole à consentement obligatoire côté hôte pour préserver la vie privée.
- **Relais Cloud & Télémaintenance de secours :**
  - Onglet "Relais Cloud" pour les appareils non équipés de VPN maillé.
  - Génération de code d'appairage temporaire à 6 chiffres.
  - Terminal d'administration PowerShell distant avec inspection d'état et processus.

---

### 📁 Fichiers Modifiés et Ajoutés
1. **Backend Rust (Tauri) :**
   - [`apps/desktop/src-tauri/src/main.rs`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src-tauri/src/main.rs) : Commandes `get_vpn_tunnel_status` et `tailscale_ping_peer`.
2. **Frontend React / TypeScript :**
   - [`apps/desktop/src/components/RemoteAccessPanel.tsx`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/RemoteAccessPanel.tsx) : Panneau multi-onglets complet pour le maillage, le streaming et le relais.
   - [`apps/desktop/src/components/RemoteAccessPanel.css`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/RemoteAccessPanel.css) : Styles réactifs et intégration dark-theme.
   - [`apps/desktop/src/App.tsx`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/App.tsx) : Remplacement de l'ancienne page distante par le nouveau `RemoteAccessPanel`.
3. **Documentation :**
   - [`docs/CHECKLIST_FONCTIONNALITES.md`](file:///home/freid-blake/NEXUS-CONTROL/docs/CHECKLIST_FONCTIONNALITES.md) : Pilier C marqué comme `[FINALISÉ ✅]`.

---

## [Finalisation Complète du Pilier D : Moteur d'Automatisations & Scénarios d'urgence] — 31 Octobre 2026

### 🎯 Objectif
Exécuter des scénarios matériels réels en tâche de fond et sur demande : sauvegarde automatique des photos DCIM, scénario départ/nuit, verrouillage d'urgence de sécurité, sonnerie d'appareil égaré et création de scénarios personnalisés.

---

### 🚀 Fonctionnalités Finalisées et Intégrées

#### 1. Moteur d'Exécution Matériel Rust (`run_automation_scenario`)
- **Sauvegarde auto Photos (`rule-backup-dcim`) :**
  - Interroge les terminaux Android connectés (USB ou Wi-Fi ADB).
  - Crée automatiquement le dossier cible `~/Sauvegardes/Photos`.
  - Déclenche `adb pull /sdcard/DCIM` et envoie une notification de confirmation sur le bureau une fois terminé.
  - Avertit l'utilisateur si aucun smartphone n'est appairé sans bloquer l'application.
- **Scénario Mode Nuit / Départ (`rule-night-mode`) :**
  - Verrouille immédiatement la session locale du PC (`loginctl lock-session` / `xdg-screensaver`).
  - Éteint et verrouille l'écran des smartphones Android connectés via l'événement ADB `KEYCODE_POWER` (`keyevent 26`).
  - Déclenche une notification système native d'activation.
- **Verrouillage à distance d'urgence (`rule-emergency-lock`) :**
  - Verrouillage instantané et sécurisé de tous les postes et téléphones connectés.
  - Alerte de sécurité critique émise sur le bureau.
- **Faire sonner l'appareil égaré (`rule-find-phone`) :**
  - Passe le volume sonore du smartphone à 100% (niveau 15) via `cmd media_session volume` et `media volume`.
  - Déclenche une vibration d'alerte (`cmd vibrator vibrate 5000`) et active la sonnerie d'alarme système.

#### 2. Interface Utilisateur & Scénarios Personnalisés ([`AutomationsEngine.tsx`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/AutomationsEngine.tsx))
- **Exécution interactive immédiate :** Bouton "Exécuter" avec feedback en temps réel, indicateur de chargement et notification visuelle.
- **Création de scénarios personnalisés :** Modal complet permettant à l'utilisateur de définir de nouvelles automatisations (Nom, Catégorie, Déclencheur, Action) persistées dans `localStorage`.
- **Journal d'exécution temps réel :** Tableau récapitulatif des actions passées avec horodatage, statut (`Succès`, `Attention`, `Erreur`), détails techniques et option pour vider l'historique.

---

### 📁 Fichiers Modifiés et Ajoutés
1. **Backend Rust (Tauri) :**
   - [`apps/desktop/src-tauri/src/main.rs`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src-tauri/src/main.rs) : Ajout et enregistrement de `run_automation_scenario`.
2. **Frontend React / TypeScript :**
   - [`apps/desktop/src/components/AutomationsEngine.tsx`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/AutomationsEngine.tsx) : Connexion au backend Rust via `invoke`, modal de création, persistance `localStorage` et gestion des logs.
3. **Documentation :**
   - [`docs/CHECKLIST_FONCTIONNALITES.md`](file:///home/freid-blake/NEXUS-CONTROL/docs/CHECKLIST_FONCTIONNALITES.md) : Pilier D marqué comme `[FINALISÉ ✅]`.

---

## [Finalisation Complète du Pilier E : Super-pouvoirs de l'Assistant IA Local & Tool Calling] — 31 Octobre 2026

### 🎯 Objectif
Transformer l'Assistant IA Ollama en un véritable **Opérateur Système** capable d'analyser la santé des appareils à partir de données de télémétrie réelles, d'utiliser des outils natifs (Tool Calling), et d'exécuter des actions sécurisées après confirmation explicite de l'utilisateur.

---

### 🚀 Fonctionnalités Finalisées et Intégrées

#### 1. Enregistrement des Outils Système Natifs (Tool Calling Rust)
- **Ajout des outils d'administration dans `execute_agent_tool` et `ollama_agent_chat` :**
  - `get_fleet_telemetry` : Lecture en temps réel des métriques système de la flotte (CPU, RAM, batterie, températures, stockage et SSID Wi-Fi).
  - `backup_photos` : Déclenche la synchronisation automatique des photos de l'appareil Android vers le PC.
  - `clean_temp_files` : Purge sécurisée des fichiers temporaires et caches d'applications pour libérer de l'espace.
  - `emergency_lock` : Verrouillage immédiat des postes et smartphones connectés.
  - `ring_device` : Fait sonner et vibrer le smartphone égaré au volume maximal.

#### 2. IA Opérateur Système Contextuelle ([`CreationChat.tsx`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/CreationChat.tsx))
- **Injection automatique de la télémétrie réelle :**
  - Dès qu'une question sur l'état, la batterie, le stockage ou la santé des appareils est posée, NEXUS interroge `get_fleet_telemetry` et injecte les données matérielles en direct dans le contexte du modèle local (zéro hallucination sur les pourcentages ou les températures).
- **Cartes de proposition d'action avec boîte de confirmation :**
  - Détection heuristique des demandes d'actions système (nettoyage de stockage, transfert de captures d'écran, sauvegarde DCIM, verrouillage, sonnerie).
  - Affichage d'un bloc visuel ambré contenant le descriptif de l'action et un bouton **"Confirmer et exécuter l'action"**.
  - Exécution en 1 clic via Tauri, retour d'état instantané dans le fil de discussion et notification bureau.
- **Raccourcis d'invites prédéfinis :**
  - *"IA, vérifie si tous mes appareils sont à jour et en ligne avec leur santé (batterie, stockage, CPU)."*
  - *"IA, dis-moi quel appareil consomme le plus de stockage et nettoie les fichiers temporaires."*
  - *"IA, transfère les dernières captures d'écran de mon téléphone vers mon dossier Téléchargements."*
  - *"IA, lance la sauvegarde des photos de mon smartphone vers mon PC."*

---

### 📁 Fichiers Modifiés et Ajoutés
1. **Backend Rust (Tauri) :**
   - [`apps/desktop/src-tauri/src/main.rs`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src-tauri/src/main.rs) : Ajout des outils système dans `execute_agent_tool` et déclaration des schémas d'outils dans `ollama_agent_chat`.
2. **Frontend React / TypeScript :**
   - [`apps/desktop/src/components/CreationChat.tsx`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/CreationChat.tsx) : Injection de la télémétrie en temps réel, cartes d'action proposée, fonction `handleExecuteAction` avec confirmation et boutons d'exemples d'opérateur système.
   - [`apps/desktop/src/components/CreationChat.css`](file:///home/freid-blake/NEXUS-CONTROL/apps/desktop/src/components/CreationChat.css) : Styles pour `.creation-action-proposal`, `.creation-action-buttons` et `.creation-action-executed`.
3. **Documentation :**
   - [`docs/CHECKLIST_FONCTIONNALITES.md`](file:///home/freid-blake/NEXUS-CONTROL/docs/CHECKLIST_FONCTIONNALITES.md) : Pilier E marqué comme `[FINALISÉ ✅]`.

---

## [Build de Production Ubuntu & Installation sur la Machine] — 31 Octobre 2026

### 🎯 Objectif
Compiler les paquets d'installation finaux pour Ubuntu (`.deb` et `.AppImage`) intégrant l'ensemble des 5 piliers (A, B, C, D, E) et installer l'application sur le système d'exploitation de l'utilisateur.

---

### 🚀 Résultats de la Compilation & Installation

#### 1. Compilation des paquets Tauri Release
- **Paquet Debian / Ubuntu (`.deb`) :**
  - Chemin : `apps/desktop/src-tauri/target/release/bundle/deb/NEXUS CONTROL_0.1.0_amd64.deb` (3.88 Mo).
- **Paquet universel AppImage (`.AppImage`) :**
  - Chemin : `apps/desktop/src-tauri/target/release/bundle/appimage/NEXUS CONTROL_0.1.0_amd64.AppImage` (80.80 Mo).
  - Rendu exécutable et disponible via `~/Applications/NEXUS_CONTROL.AppImage`.
- **Binaire compilé optimisé :**
  - Chemin : `apps/desktop/src-tauri/target/release/nexus-control-desktop`.

#### 2. Installation sur la machine
- **Binaire utilisateur :**
  - Installé dans `~/.local/bin/nexus-control-desktop` et lié à `~/.local/bin/nexus-control`.
- **Raccourci Bureau & Menu Applications (GNOME Dash) :**
  - Fichier de bureau installé dans `~/.local/share/applications/nexus-control.desktop`.
  - Icônes haute résolution installées dans `~/.local/share/icons/hicolor/`.
  - Base de données des applications de bureau mise à jour (`update-desktop-database`).
- **Compatibilité système :**
  - Toutes les dépendances dynamiques ont été vérifiées avec `ldd` : 100% résolues.



