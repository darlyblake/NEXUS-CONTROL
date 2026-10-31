# NEXUS CONTROL — Feuille de route & Checklist des Fonctionnalités

Ce document recense l'ensemble des modules prévus pour faire de **NEXUS CONTROL** un écosystème complet de gestion et de contrôle multi-appareils, sécurisé et local-first.

---

## 📊 Légende
- [x] **Terminé & intégré** : Fonctionnalité implémentée, testée et disponible dans l'application.
- [~] **En cours d'implémentation** : Socle présent ou première tranche en cours de développement.
- [ ] **À faire** : Planifié selon les priorités définies.

---

## A. Continuité & Gestion au quotidien (Style "KDE Connect / Apple Continuity") — [FINALISÉ ✅]

- [x] **1. Presse-papiers partagé universel (Clipboard Sync)**
  - [x] Commandes Rust natives de lecture et écriture dans le presse-papiers système (`read_system_clipboard` et `write_system_clipboard`).
  - [x] Option d'écoute et synchronisation automatique en arrière-plan sans action manuelle.
  - [x] Chiffrement de session de bout en bout (AES-GCM).
  - [x] Historique local du presse-papiers avec copie en 1 clic et option de purge totale.
  - [x] Détection heuristique et masquage automatique des mots de passe, tokens et clés secrètes avec bouton œil pour démasquer.

- [x] **2. Synchronisation des notifications Android**
  - [x] Service natif Android `NexusNotificationListenerService.kt` déclaré dans `AndroidManifest.xml`.
  - [x] Centre de notifications en direct sur le PC avec filtres applicatifs (SMS, WhatsApp, alertes système, banques).
  - [x] Notifications natives sur le bureau (`send_system_notification` via `notify-send` / PowerShell).
  - [x] Réponse rapide (Quick Reply) directe depuis le bureau injectée via `adb_send_quick_reply`.
  - [x] Masquage automatique des notifications sensibles (banque, codes 2FA) avec bouton "Afficher".

- [x] **3. Explorateur de fichiers distant double panneau**
  - [x] Interface double panneau (`DoublePanelFileExplorer.tsx`) : PC local (gauche) vs Appareil distant (droite).
  - [x] Navigation dans les vrais dossiers locaux (`list_local_directory`) et Android (`adb_list_directory`).
  - [x] Glisser-déposer (Drag & Drop) visuel de fichiers entre les deux panneaux.
  - [x] Boutons de transfert interactifs `Envoyer vers l'appareil →` et `← Récupérer sur le PC`.
  - [x] Barre de progression de transfert en temps réel avec pourcentage et confirmation visuelle.
  - [x] Aperçu direct des images et des fichiers texte sans téléchargement préalable (modal dédié d'inspection rapide).

---

## B. Télémétrie & Surveillance en temps réel (Monitoring de flotte) — [FINALISÉ ✅]

- [x] **1. Cartes d'état en direct pour chaque appareil**
  - [x] Commande native Tauri Rust `get_fleet_telemetry` interrogeant le système d'exploitation et les appareils connectés en direct.
  - [x] Indicateur de batterie en direct (%) avec détection de charge (secteur / décharge).
  - [x] Calcul de l'estimation du temps restant (~X h restantes d'autonomie ou ~X min jusqu'à pleine charge).
  - [x] Jauge de stockage : Go utilisés / totaux, pourcentage et espace restant avec alertes visuelles.
  - [x] Métriques système : charge CPU (%), RAM (%) et température matérielle en °C via sondes thermiques (`/sys/class/thermal`).
  - [x] Indicateur de connectivité réseau Wi-Fi avec SSID réel (ex: CANALBOX-5G) et force du signal.
  - [x] Rafraîchissement automatique continu toutes les 5 secondes et bouton d'actualisation manuelle.

- [x] **2. Alertes proactives et intelligentes**
  - [x] Panneau de configuration dédié aux seuils d'alertes proactives (bouton "Paramètres d'alertes").
  - [x] Seuil d'alerte batterie faible personnalisable (ex: &le; 20%) déclenchant une notification bureau.
  - [x] Seuil d'alerte batterie chargée personnalisable (ex: &ge; 80% ou 100%) pour préserver la durée de vie des accus.
  - [x] Seuil d'alerte de surchauffe personnalisable (ex: &ge; 45°C) avec notification critique.
  - [x] Seuil d'alerte de stockage saturé personnalisable (ex: &ge; 85%).
  - [x] Bannières d'avertissement contextuelles sur chaque carte d'appareil.
  - [x] Déclenchement automatique de notifications système natives OS (`send_system_notification`).

---

## C. Accès distant mondial "Zéro Configuration" (Sans ouverture de port) — [FINALISÉ ✅]

- [x] **1. Intégration d'un tunnel maillé (Tailscale / Netbird / WireGuard P2P)**
  - [x] Détection automatique de l'état du tunnel et des moteurs installés (Tailscale, Netbird, WireGuard) via la commande native `get_vpn_tunnel_status`.
  - [x] Connexion directe P2P NAT-traversal (STUN/DERP) pour traverser le CGNAT mobile 4G/5G sans ouvrir aucun port.
  - [x] IP de maillage sécurisée par appareil (100.x.y.z), domaine MagicDNS et compte utilisateur avec copie rapide.
  - [x] Liste en direct des pairs distants connectés avec système, IP maillée et statut en ligne.
  - [x] Test de latence et de traversée NAT en direct via la commande native `tailscale_ping_peer`.

- [x] **2. WebRTC & Streaming d'écran intégré**
  - [x] Panneau de streaming d'écran intégré accessible directement dans l'onglet dédié (`RemoteAccessPanel.tsx` & `ScreenSharePanel.tsx`).
  - [x] Streaming direct dans l'interface NEXUS (sans ouverture de fenêtre externe) avec réglages de résolution et FPS.
  - [x] Protocole à consentement obligatoire côté hôte distant pour garantir la sécurité.
  - [x] Relais cloud temporaire de secours (WSS/TLS) avec appairage par code à 6 chiffres et télémaintenance PowerShell.

---

## D. Moteur d'Automatisations (Tâches en arrière-plan) — [FINALISÉ ✅]

- [x] **1. Moteur d'automatisations & Scénarios prédéfinis (`AutomationsEngine.tsx`)**
  - [x] Commande native Tauri Rust `run_automation_scenario` orchestrant l'exécution matérielle réelle.
  - [x] Sauvegarde automatique des photos (DCIM -> ~/Sauvegardes/Photos) par synchronisation ADB dès que le téléphone est disponible.
  - [x] Scénario "Mode Départ / Nuit" : verrouillage simultané des sessions PC (`loginctl`) et mise en veille écran smartphone (`keyevent 26`).
  - [x] Scénario "Verrouillage à distance d'urgence" avec notification critique et verrouillage immédiat des terminaux.
  - [x] Scénario "Faire sonner l'appareil égaré" : augmentation du volume média au niveau maximal (15) avec vibreur et sonnerie d'alarme.
  - [x] Bouton d'exécution immédiate "Exécuter" avec retour d'état en temps réel et notification native.
  - [x] Interrupteurs d'activation/désactivation par scénario avec persistance locale (`localStorage`).
  - [x] Modal de création de scénarios personnalisés (Nom, Catégorie, Déclencheur, Action).
  - [x] Journal d'historique des exécutions avec horodatage, statuts (Succès, Attention, Erreur) et bouton pour vider le journal.

---

## E. Super-pouvoirs de l'Assistant IA Local — [FINALISÉ ✅]

- [x] **1. IA "Opérateur Système" (Tool Calling / Function Calling)**
  - [x] Outils système natifs enregistrés dans le backend Rust (`get_fleet_telemetry`, `backup_photos`, `emergency_lock`, `ring_device`, `clean_temp_files`).
  - [x] Injection dynamique des données de télémétrie matérielle réelles (CPU, RAM, batterie, températures, stockage) dans le contexte Ollama.
  - [x] Boîte de proposition d'action interactive avec confirmation explicite ("Confirmer et exécuter l'action") pour toute action système.
  - [x] Raccourcis d'invites réels configurés : "Vérifie si tous mes appareils sont en ligne", "Quel appareil consomme le plus de stockage et nettoie", "Transfère les dernières captures d'écran", "Lance la sauvegarde des photos".
  - [x] Exécution directe sécurisée par Tauri avec retour d'état immédiat dans le chat et notification de bureau native.
