# NEXUS Agent (Windows)

Agent Windows natif du projet principal NEXUS CONTROL. Il fonctionne comme **service Windows en arrière-plan**, sans fenêtre utilisateur permanente. Il se compile depuis le dépôt principal, au même titre que l'application Tauri et l'APK Android.

## Capacités de cette version

- Service Windows configuré pour démarrer automatiquement après installation.
- Connexion WSS sortante vers le relais configuré ; aucun port entrant d'administration n'est ouvert.
- Association par code temporaire à usage unique avec confirmation locale pendant l'installation.
- Actions distantes : état du PC, inventaire simple des processus et scripts PowerShell optionnels.
- Révocation de l'association pendant la désinstallation si le relais est joignable.
- Workflow GitHub Actions qui compile et publie l'agent Windows x64.

## Limites actuelles — à ne pas confondre avec les fonctions futures

Le contrôle souris/clavier, le streaming d'écran, le transfert de fichiers par le relais et l'installation automatique par simple découverte réseau ne sont pas encore intégrés. Le relais MVP garde ses associations en mémoire : un redémarrage du relais invalide les sessions et nécessite une nouvelle association. Les jetons d'accès sont temporaires ; cette version n'est pas encore un système RMM de production.

## Prérequis de développement

- Windows 10/11 x64 pour exécuter le service.
- .NET SDK 8.0.
- PowerShell lancé en administrateur uniquement pour installer/désinstaller le service.

## Compiler

Depuis la racine du dépôt, sur Windows ou un runner Windows :

    dotnet restore apps/windows/NexusAgent/NexusAgent.csproj
    dotnet build apps/windows/NexusAgent/NexusAgent.csproj -c Release
    dotnet publish apps/windows/NexusAgent/NexusAgent.csproj -c Release -r win-x64 --self-contained true -o artifacts/windows-agent

Le workflow **Windows Agent** publie également l'artefact `nexus-agent-windows-x64`. Le workflow desktop principal compile l'application NEXUS CONTROL pour Windows et Linux et publie l'agent Windows dans le même workflow.

## Installer et associer le service

1. Depuis Ubuntu, ouvre NEXUS CONTROL → Accès distant.
2. Saisis l'URL HTTPS/WSS du relais et clique sur **Créer un code d'association**.
3. Sur Windows, ouvre PowerShell en administrateur dans le dossier de l'artefact téléchargé depuis GitHub Actions (il contient NexusAgent.exe et les scripts). Lance :

    Set-ExecutionPolicy -Scope Process Bypass
    .\Install-NexusAgent.ps1 -PublishDirectory .

4. Confirme localement l'installation, saisis l'URL HTTPS du relais et le code d'association temporaire.
5. L'installateur te demande séparément si PowerShell distant doit être activé. Appuie sur Entrée pour le laisser désactivé ; tape exactement `ACTIVER` uniquement si tu acceptes ce risque.
6. Le service démarre automatiquement avec Windows. Le panneau Accès distant de NEXUS CONTROL affiche les commandes Windows lorsque l'agent est connecté.

Les identifiants sont stockés dans ProgramData avec des ACL limitées à SYSTEM et aux administrateurs. Le service initie une connexion WSS sortante et n'ajoute aucune règle de pare-feu entrant.

## PowerShell distant : avertissement important

Si le propriétaire active cette option, les scripts sont exécutés par le service Windows, généralement sous l'identité **LocalSystem**. Ils peuvent donc disposer de privilèges très élevés. Le panneau Ubuntu demande une confirmation avant chaque script et limite sa taille à 8000 caractères. N'active pas cette capacité sur une machine que tu n'administres pas.

## Installation distante depuis Ubuntu

Le bouton d'installation automatique sur un appareil découvert n'est pas encore implémenté. La découverte réseau ne donne pas les droits d'installation et ne contourne pas l'UAC. Un futur déploiement à distance devra utiliser un canal d'administration explicitement configuré (par exemple OpenSSH/WinRM) et demander les identifiants autorisés ; il ne devra jamais installer silencieusement un service.

## Désinstaller

Depuis PowerShell administrateur :

    .\apps\windows\installer\Uninstall-NexusAgent.ps1

Le script arrête et supprime le service, tente de révoquer l'association côté relais et supprime les identifiants locaux. Les fichiers du programme restent sur le disque pour inspection ; supprime-les manuellement si tu n'en as plus besoin.

## Sécurité prévue pour les prochaines étapes

- Identité d'appareil stable et révocable.
- Approbation locale claire et séparation des permissions.
- Journaux d'audit avec utilisateur, cible, heure et résultat.
- Contrôle graphique séparé via un protocole de bureau distant établi.
- Tests de sécurité du relais et gestion durable des associations avant usage de production.

Ne pas utiliser cet agent sur des appareils sans autorisation explicite de leur propriétaire.
