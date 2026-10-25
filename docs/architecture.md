# Architecture initiale

## Composants

1. `apps/desktop` : interface Tauri 2 + React + TypeScript.
2. `services/api` : service local de coordination, ajouté progressivement.
3. `integrations/meshcentral` : notes et configuration d'intégration MeshCentral.
4. `integrations/scrcpy` : détection ADB et lancement scrcpy pour appareils explicitement autorisés.
5. `packages/device-protocol` : types communs d'appareil et capacités.
6. `packages/security` : validation des actions, permissions et journalisation.

## Principe d'intégration

NEXUS CONTROL ne doit pas exécuter de commandes arbitraires directement depuis l'interface. Les actions doivent passer par une couche d'intégration qui valide la cible, les capacités disponibles et les autorisations.

## Ordre de réalisation

1. Interface et inventaire local des outils disponibles.
2. Test indépendant de MeshCentral.
3. Test USB Android avec ADB et scrcpy.
4. API locale et modèle de données des appareils.
5. Intégration de l'état des connecteurs dans l'interface.
6. Accès distant via réseau privé après audit de sécurité.
