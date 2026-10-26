[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$PublishDirectory
)

$ErrorActionPreference = 'Stop'
$serviceName = 'NexusControlAgent'
$displayName = 'NEXUS CONTROL Agent'
$installDirectory = Join-Path $env:ProgramFiles 'NEXUS CONTROL\Agent'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ouvre PowerShell en tant qu’administrateur pour installer le service.'
}

$source = (Resolve-Path -LiteralPath $PublishDirectory).Path
$executable = Join-Path $source 'NexusAgent.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "NexusAgent.exe introuvable dans : $source"
}

Write-Host "Agent : $executable"
Write-Host "Destination : $installDirectory"
Write-Host "Service : $displayName (démarrage automatique)"
if (-not $PSCmdlet.ShouldProcess($installDirectory, 'Installer NEXUS CONTROL Agent')) {
    return
}

if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $installDirectory -Recurse -Force

$installedExecutable = Join-Path $installDirectory 'NexusAgent.exe'
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    sc.exe config $serviceName binPath= "`"$installedExecutable`"" start= auto | Out-Null
} else {
    sc.exe create $serviceName binPath= "`"$installedExecutable`"" start= auto DisplayName= "`"$displayName`"" | Out-Null
}
if ($LASTEXITCODE -ne 0) {
    throw "Échec de configuration du service (code $LASTEXITCODE)."
}

Start-Service -Name $serviceName
Get-Service -Name $serviceName | Format-Table Name, Status, StartType
