# Protocole de contrôle souris/clavier Windows (proposition)

Ce protocole est basé sur le consentement local. La branche contient le compagnon Windows interactif et un routage authentifié dédié ; le build et les tests de bout en bout restent à valider. Le retour vidéo n'est pas encore transporté par le relais dans cette branche, donc la souris reste désactivée tant qu'aucune trame écran n'arrive.

## Conditions obligatoires

- L'opérateur doit être associé au PC via le relais authentifié.
- Chaque session commence par `windows_control_request`; le compagnon affiche une boîte de dialogue locale et exige une approbation explicite.
- Aucun événement souris/clavier n'est accepté avant l'approbation et le message `control_session_started`.
- Le compagnon affiche un indicateur permanent, le nom de l'appareil distant et un bouton local d'arrêt.
- Ubuntu et Windows doivent pouvoir arrêter la session immédiatement.
- Arrêt automatique en cas de déconnexion, verrouillage de session, changement d'utilisateur, fin de session ou expiration.
- Aucune capture ni injection dans l'écran sécurisé/UAC; aucun fonctionnement caché.
- Le service en Session 0 ne doit pas appeler directement SendInput pour tenter de manipuler la session interactive. Utiliser un compagnon distinct lancé dans la session utilisateur active.

## Messages proposés

- Demande : `command / windows_control_request / requireLocalConsent=true`.
- Approbation : `control_session_started` avec un identifiant de session temporaire.
- Refus : `control_session_denied`.
- Entrée : `windows_remote_input` avec `controlId` et une action parmi `mouse_move`, `mouse_click`, `mouse_scroll`, `keyboard_text`. Le relais valide les coordonnées normalisées, limite le texte à 2 000 caractères et le défilement à ±1 200 unités.
- Arrêt : `windows_control_stop`; réponse `control_session_stopped`.

Les coordonnées souris sont normalisées entre 0 et 1 relativement à la surface affichée. Les actions doivent être limitées en fréquence et en taille. Le texte est limité à 2 000 caractères par commande. Le compagnon doit vérifier l'identifiant de session, l'autorisation active, l'horodatage et l'origine de chaque commande.

## État de réalisation

- Panneau React : demande de contrôle, saisie de texte, arrêt, et affichage de la dernière trame reçue pour mapper les clics sur l'image réelle.
- Relais : jeton séparé `windows_ui`, routage des commandes de contrôle et validation des bornes.
- Compagnon Windows : demande de consentement, indicateur visible permanent pendant la session, arrêt local, arrêt sur verrouillage/déconnexion, déplacement/clic, défilement et saisie Unicode.
- Retour vidéo et trames JPEG : non intégrés au relais dans cette branche ; sans image reçue, la souris reste désactivée pour éviter les clics à l'aveugle.
- Tests de compilation et de bout en bout : pas encore exécutés avec succès ; ne pas considérer la fonction comme prête avant validation.
