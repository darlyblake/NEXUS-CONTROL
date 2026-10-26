[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$serviceName = 'NexusControlAgent'
$installDirectory = Join-Path $env:ProgramFiles 'NEXUS CONTROL\Agent'
$configDirectory = Join-Path $env:ProgramData 'NEXUS CONTROL\Agent'
$configPath = Join-Path $configDirectory 'agent.json'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ouvre PowerShell en tant qu’administrateur pour désinstaller le service.'
}

if (-not $PSCmdlet.ShouldProcess($serviceName, 'Arrêter et supprimer le service NEXUS CONTROL Agent')) {
    return
}

if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $serviceName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Échec de suppression du service (code $LASTEXITCODE)."
    }
}

# Revoke the pairing if the relay is reachable, then remove local credentials.
if (Test-Path -LiteralPath $configPath) {
    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if ($config.RelayUrl -and $config.DeviceToken) {
            Invoke-RestMethod -Method Post -Uri ($config.RelayUrl.TrimEnd('/') + '/api/revoke') -Headers @{ Authorization = "Bearer $($config.DeviceToken)" } -TimeoutSec 5 | Out-Null
            Write-Host 'Association révoquée côté relais.'
        }
    } catch {
        Write-Warning 'Le relais est injoignable ou la révocation a échoué. Les identifiants locaux seront quand même supprimés ; révoque cette association depuis NEXUS CONTROL si nécessaire.'
    }
    Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $configDirectory) {
    Remove-Item -LiteralPath $configDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Le service et les identifiants locaux ont été supprimés.'
Write-Host "Les fichiers du programme restent dans $installDirectory pour inspection ; supprime ce dossier manuellement si tu n’en as plus besoin."
