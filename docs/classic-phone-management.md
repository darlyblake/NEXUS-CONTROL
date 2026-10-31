# Module Téléphones classiques

## Objectif

Ajouter à NEXUS CONTROL Desktop un connecteur USB Linux pour les téléphones à touches et autres appareils non Android : itel, Nokia, TECNO, Samsung, Maxcom et fabricants non identifiés.

## Architecture

- **Interface React** : `ClassicPhones.tsx` présente les appareils, protocoles, outils disponibles et limites.
- **Pont Tauri/Rust** : `classic_phones.rs` lit les attributs USB exposés par sysfs (`/sys/bus/usb/devices`) en lecture seule.
- **Détection de protocoles** : classes USB MTP/PTP (06/01/01), Mass Storage (08), Communications (02), CDC Data (0a) et Vendor Specific (ff).
- **Outils externes** : inventaire de présence uniquement pour lsusb, udevadm, libmtp, Gammu, ADB, Fastboot, Heimdall et spd_dump. NEXUS ne lance aucun flashage ni commande d'effacement depuis ce module.

## État de cette première livraison

- Implémenté : inventaire USB sysfs, VID/PID, fabricant/produit, bus/adresse, heuristique de marque, classification indicative des interfaces et vérification des outils installés.
- Fichiers : une interface MTP/PTP ou Mass Storage est signalée comme disponible, sans prétendre que le transfert est déjà implémenté.
- Contacts/SMS : une interface Communications/CDC est seulement un indice. Gammu et le protocole du modèle doivent être testés ; aucun accès aux données n'est supposé.
- Maintenance : non activée. Nécessite un adaptateur précis par chipset/modèle, firmware authentique et procédure de validation.
- La détection actuelle cible Linux. Les pilotes et modes USB peuvent varier selon le téléphone, son écran de configuration et le câble.

## Feuille de route

1. Ajouter les tests de parsing sysfs et une matrice de périphériques USB connus.
2. Connecteur MTP/libmtp pour navigation et copie après autorisation locale.
3. Connecteur Gammu par port modem/série, avec aperçu et consentement avant lecture/écriture des contacts et SMS.
4. Adaptateurs de maintenance uniquement pour modèles pris en charge, validation du hash/signature du firmware, alimentation stable et confirmation en deux étapes.
5. Ajouter Windows/macOS après implémentation de backends natifs distincts.

## Sécurité

- Ne jamais modifier IMEI, contourner verrouillage, FRP ou protection de compte.
- Ne pas afficher ni journaliser le numéro de série USB complet.
- Ne jamais envoyer une commande propriétaire inconnue.
- Pas d'écriture firmware si modèle, chipset, région et version ne concordent pas.
