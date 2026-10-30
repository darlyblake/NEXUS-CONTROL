# Phase 4 — Connexion PC ↔ PC

## Objectif

Construire une connexion distante entre deux ordinateurs Windows/Linux, avec identité d'appareil, association explicite, authentification, transport WSS sortant et autorisations séparées. Cette phase ne doit pas assimiler une connexion au relais à une autorisation de contrôle complet.

## Socle déjà présent dans le dépôt

- Le relais attribue un code d'association à usage unique, valable cinq minutes.
- Le PC contrôleur et l'agent Windows s'authentifient avec des jetons distincts.
- L'agent Windows initie une connexion WSS sortante et n'ouvre pas de port entrant.
- Les commandes Windows sont limitées à une liste autorisée ; PowerShell distant reste désactivé par défaut et demande une confirmation côté contrôleur.
- Le relais transmet les messages sans interpréter les commandes.
- La première étape de cette phase ajoute un heartbeat WebSocket pour détecter les connexions mortes et un test d'intégration qui vérifie le cycle PC contrôleur → association Windows → authentification → commande autorisée → réponse.

## Livrables de cette étape

1. Heartbeat WebSocket (ping/pong toutes les 25 secondes) et fermeture des sockets qui ne répondent plus.
2. Test automatisé de bout en bout du protocole d'association Windows et du routage d'une commande en lecture seule.
3. Exécution de ce test dans GitHub Actions, indépendamment du build Tauri.

## Sécurité non négociable

- Association temporaire et saisie locale du code sur le PC cible.
- WSS obligatoire hors localhost.
- Aucun port entrant d'administration, aucun ADB exposé sur Internet.
- Liste blanche d'actions, horodatage, identifiant de commande et détection des doublons côté agent.
- PowerShell distant désactivé par défaut ; son activation reste un choix local explicite.
- Le partage d'écran et les actions de contrôle interactif doivent demander un consentement visible dans la session utilisateur Windows. Le service Windows en Session 0 ne doit jamais prétendre pouvoir capturer ou contrôler le bureau interactif.

## Travail restant avant de déclarer PC ↔ PC complet

- Créer un compagnon Windows dans la session interactive et un canal IPC authentifié avec le service pour présenter les demandes de consentement.
- Implémenter le partage d'écran avec capture dans la session utilisateur, indicateur visible et arrêt local immédiat.
- Ajouter le contrôle clavier/souris uniquement après consentement explicite, avec restrictions et journal d'audit.
- Ajouter un agent Linux et définir son modèle de permissions.
- Persister les associations et jetons dans un stockage sécurisé ; le relais MVP actuel garde les données en mémoire et un redémarrage révoque les associations.
- Ajouter les tests de révocation, expiration, reconnexion, rejeu et charge, puis réaliser un audit avant usage sur Internet.

## Critères d'acceptation

- Un code expiré ou déjà utilisé est rejeté.
- Un jeton invalide ou un appareil non associé ne peut pas s'authentifier.
- Une commande non autorisée, obsolète ou destinée à une autre plateforme est rejetée.
- Une déconnexion réseau est détectée par heartbeat et l'interface revient à un état non connecté.
- Aucune fonction d'écran/contrôle n'est présentée comme active sans accusé de réception réel de l'agent interactif.

## État

Cette étape fournit le heartbeat et un test d'intégration du protocole PC → Windows. Elle ne livre pas encore le partage d'écran, le contrôle clavier/souris ni un agent Linux.
