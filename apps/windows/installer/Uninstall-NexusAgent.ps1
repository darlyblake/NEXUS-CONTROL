[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$serviceName = 'NexusControlAgent'
$installDirectory = Join-Path $env:ProgramFiles 'NEXUS CONTROL\Agent'

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

Write-Host "Le service a été supprimé. Les fichiers restent dans $installDirectory pour permettre une vérification avant suppression manuelle."
