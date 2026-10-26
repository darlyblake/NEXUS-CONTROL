# NEXUS Agent (Windows)

Agent Windows natif du projet principal NEXUS CONTROL. Il est conçu comme un **service Windows en arrière-plan**, sans fenêtre utilisateur permanente. Il se compile depuis le dépôt principal, au même titre que l'application Tauri et l'APK Android.

## État de cette première fondation

- Projet .NET Worker ciblant Windows, configuré pour fonctionner comme service.
- Démarrage automatique via le gestionnaire de services Windows après installation.
- Journalisation du cycle de vie et arrêt propre du service.
- Script d'installation/désinstallation local, qui exige une console PowerShell élevée.
- Workflow GitHub Actions de compilation et de tests de compilation sur Windows.
- Aucun port réseau d'administration ouvert par défaut, aucune exécution de commandes reçues du réseau et aucune installation silencieuse sur un appareil découvert.

**Ce n'est pas encore un agent de contrôle distant complet.** Le transport avec le relais, l'association cryptographique, l'écran d'approbation locale, les transferts et les actions distantes doivent être implémentés et testés avant d'activer le contrôle.

## Prérequis de développement

- Windows 10/11 x64 pour exécuter le service.
- .NET SDK 8.0.
- PowerShell lancé en administrateur uniquement pour installer/désinstaller le service.

## Compiler

Depuis la racine du dépôt, sur Windows ou un runner Windows :

    dotnet restore apps/windows/NexusAgent/NexusAgent.csproj
    dotnet build apps/windows/NexusAgent/NexusAgent.csproj -c Release
    dotnet publish apps/windows/NexusAgent/NexusAgent.csproj -c Release -r win-x64 --self-contained true -o artifacts/windows-agent

Le dossier publié contient l'agent autonome. Le build ne l'installe pas automatiquement.

## Installer localement

1. Publier l'agent avec la commande ci-dessus.
2. Copier le dossier publié sur l'ordinateur cible par un moyen de confiance.
3. Ouvrir PowerShell **en tant qu'administrateur**.
4. Exécuter :

    Set-ExecutionPolicy -Scope Process Bypass
    .\apps\windows\installer\Install-NexusAgent.ps1 -PublishDirectory .\artifacts\windows-agent

Le script copie les fichiers dans Program Files et enregistre le service en démarrage automatique. Il ne configure aucun accès distant ni règle de pare-feu.

## Installation depuis NEXUS CONTROL

L'installation en un clic sur un appareil découvert n'est possible que si le propriétaire a préparé un mécanisme d'administration autorisé (par exemple WinRM/PowerShell Remoting avec authentification et droits administrateur) ou lance un installateur sur la machine cible. **La découverte réseau ne donne pas le droit d'installer un service** et ne contourne pas l'UAC. Le futur flux devra demander une approbation locale explicite et afficher l'identité du contrôleur.

## Sécurité prévue

- Identité unique par appareil, clés protégées par Windows DPAPI/CNG.
- Association à usage unique avec confirmation sur l'appareil cible.
- Transport TLS/WSS, jetons de session à durée limitée et révocation.
- Actions typées et permissions séparées (inventaire, fichiers, applications, bureau, administration).
- Journal d'audit et limites de débit.
- Pas de shell arbitraire exposé directement sur le réseau.
- Contrôle graphique séparé, utilisant un protocole de bureau distant établi et ses permissions système.

Ne pas utiliser cette fondation pour des appareils sans autorisation du propriétaire.
