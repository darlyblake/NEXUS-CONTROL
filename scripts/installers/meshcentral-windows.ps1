$ErrorActionPreference = "Stop"

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " NEXUS CONTROL - Installation MeshCentral"
Write-Host " Système détecté : Windows"
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Cette installation crée un serveur MeshCentral local dans :"
$BaseDir = Join-Path $env:LOCALAPPDATA "NexusControl\meshcentral"
Write-Host $BaseDir
Write-Host "Le serveur sera lancé dans cette fenêtre sur le port 4430."
Write-Host ""

$Node = Get-Command node -ErrorAction SilentlyContinue
$Npm = Get-Command npm -ErrorAction SilentlyContinue

if (-not $Node -or -not $Npm) {
    $Winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $Winget) {
        Write-Host "[ÉTAPE REQUISE] Node.js LTS et npm sont nécessaires." -ForegroundColor Yellow
        Write-Host "Installe Node.js LTS depuis https://nodejs.org/ puis ferme et rouvre NEXUS CONTROL."
        exit 1
    }

    Write-Host "[1/3] Installation de Node.js LTS via winget..." -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
    Write-Host "Node.js a été demandé à winget. Ferme cette fenêtre, relance NEXUS CONTROL et reclique sur Installer MeshCentral pour actualiser le PATH." -ForegroundColor Yellow
    exit 0
}

$NodeVersionText = (& node -p "Number(process.versions.node.split('.')[0])").Trim()
$NodeMajor = [int]$NodeVersionText
if ($NodeMajor -lt 20) {
    Write-Host "[ERREUR] Node.js 20 ou plus récent est requis (version actuelle : $(& node --version))." -ForegroundColor Red
    Write-Host "Installe une version LTS récente depuis https://nodejs.org/ puis relance l'intégration."
    exit 1
}

New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null
Set-Location $BaseDir

if (-not (Test-Path (Join-Path $BaseDir "package.json"))) {
    & npm init -y
    if ($LASTEXITCODE -ne 0) { throw "npm init a échoué." }
}

Write-Host "[1/3] Installation du paquet MeshCentral..." -ForegroundColor Yellow
& npm install --save meshcentral
if ($LASTEXITCODE -ne 0) { throw "L'installation npm de MeshCentral a échoué." }

$ConfigPath = Join-Path $BaseDir "config.json"
if (-not (Test-Path $ConfigPath)) {
    $Config = @'
{
  "settings": {
    "cert": "localhost",
    "port": 4430,
    "redirPort": 0,
    "agentPort": 4431
  },
  "domains": {
    "": {
      "title": "NEXUS CONTROL - MeshCentral local",
      "newAccounts": true,
      "localSessionRecording": false
    }
  }
}
'@
    Set-Content -Path $ConfigPath -Value $Config -Encoding utf8
} else {
    Write-Host "config.json existe déjà : configuration conservée."
}

Write-Host ""
Write-Host "[3/3] Démarrage de MeshCentral." -ForegroundColor Green
Write-Host "Adresse locale : https://localhost:4430"
Write-Host "N'expose pas ce serveur sur Internet sans configurer TLS, comptes et pare-feu."
Write-Host "Arrête le serveur avec Ctrl+C."
Write-Host ""
& npm exec -- meshcentral
if ($LASTEXITCODE -ne 0) { throw "MeshCentral s'est arrêté avec une erreur." }
