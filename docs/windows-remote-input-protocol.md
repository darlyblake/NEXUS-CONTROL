# Protocole de contrôle souris/clavier Windows (proposition)

Ce protocole est volontairement basé sur le consentement local. Il n'est pas opérationnel tant que le compagnon Windows interactif et le routage authentifié du relais ne sont pas implémentés et testés.

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
- Entrée : `windows_remote_input` avec `controlId` et une action parmi `mouse_move`, `mouse_click`, `mouse_scroll`, `keyboard_text`.
- Arrêt : `windows_control_stop`; réponse `control_session_stopped`.

Les coordonnées souris sont normalisées entre 0 et 1 relativement à la surface affichée. Les actions doivent être limitées en fréquence et en taille. Le texte est limité à 2 000 caractères par commande. Le compagnon doit vérifier l'identifiant de session, l'autorisation active, l'horodatage et l'origine de chaque commande.

## État de réalisation

- Panneau React de demande de contrôle, surface souris, envoi de texte clavier et arrêt : interface préparatoire.
- Routage strict des actions dans le relais : à implémenter.
- Compagnon Windows interactif, consentement, indicateur persistant, gestion des sessions/verrouillages et injection d'entrée : à implémenter.
- Tests Windows de bout en bout : à exécuter.
- Ne pas annoncer la souris/clavier comme fonctionnels avant ces étapes.
