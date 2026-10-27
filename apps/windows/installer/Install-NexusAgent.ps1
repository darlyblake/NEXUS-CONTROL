[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$PublishDirectory,
    [string]$RelayUrl,
    [string]$PairCode,
    [switch]$EnableRemoteShell
)

$ErrorActionPreference = 'Stop'
$serviceName = 'NexusControlAgent'
$displayName = 'NEXUS CONTROL Agent'
$installDirectory = Join-Path $env:ProgramFiles 'NEXUS CONTROL\Agent'
$configDirectory = Join-Path $env:ProgramData 'NEXUS CONTROL\Agent'
$configPath = Join-Path $configDirectory 'agent.json'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ouvre PowerShell en tant qu-administrateur pour installer le service.'
}

$source = (Resolve-Path -LiteralPath $PublishDirectory).Path
$executable = Join-Path $source 'NexusAgent.exe'
$companionSource = Join-Path $source 'companion\NexusControlCompanion.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "NexusAgent.exe introuvable dans : $source"
}
if (-not (Test-Path -LiteralPath $companionSource -PathType Leaf)) {
    throw "NexusControlCompanion.exe introuvable dans : $companionSource. Télécharge l'artefact complet du workflow Windows Agent."
}

Write-Host ''
Write-Host 'NEXUS CONTROL Agent Windows' -ForegroundColor Cyan
Write-Host 'Cet agent fonctionnera comme service Windows et se reconnectera au relais configuré.'
Write-Host 'Le code d-association autorise ce PC à rejoindre une session NEXUS CONTROL.'
$consent = Read-Host 'Confirme que tu es autorisé à administrer ce PC et que tu veux associer cet appareil (tape OUI)'
if ($consent -cne 'OUI') { throw 'Installation annulée : consentement local non confirmé.' }

if (-not $RelayUrl) { $RelayUrl = Read-Host 'URL HTTPS du relais NEXUS CONTROL' }
try { $relayUri = [Uri]$RelayUrl } catch { throw 'URL du relais invalide.' }
if ($relayUri.Scheme -ne 'https' -or -not $relayUri.Host) {
    throw 'Le relais doit utiliser HTTPS avec un certificat TLS valide. HTTP est interdit pour cette installation.'
}
$RelayUrl = $RelayUrl.TrimEnd('/')

if (-not $PairCode) { $PairCode = Read-Host 'Code d-association affiché dans NEXUS CONTROL (valide 5 minutes)' }
$PairCode = $PairCode.Trim().ToUpperInvariant()
if ($PairCode -notmatch '^[A-HJ-NP-Z2-9]{10}$') { throw 'Format de code d-association invalide.' }

if (-not $EnableRemoteShell) {
    $shellConsent = Read-Host 'Autoriser les commandes PowerShell distantes (risque élevé, exécutées avec les droits du service) ? Tape ACTIVER pour accepter, sinon appuie sur Entrée'
    if ($shellConsent -ceq 'ACTIVER') { $EnableRemoteShell = $true }
}
if ($EnableRemoteShell) {
    Write-Warning 'PowerShell distant activé : les scripts seront exécutés avec l-identité du service Windows, généralement SYSTEM. N-active cette option que pour ton propre appareil.'
}

Write-Host "Source : $source"
Write-Host "Installation : $installDirectory"
Write-Host "Configuration protégée : $configPath"
Write-Host "Service : $displayName (démarrage automatique)"
if (-not $PSCmdlet.ShouldProcess($installDirectory, 'Installer et associer NEXUS CONTROL Agent')) { return }

$deviceId = 'windows-' + $env:COMPUTERNAME + '-' + ([Guid]::NewGuid().ToString('N').Substring(0, 8))
$pairBody = @{
    pairCode = $PairCode
    deviceId = $deviceId
    platform = 'windows'
} | ConvertTo-Json
try {
    $pair = Invoke-RestMethod -Method Post -Uri ($RelayUrl + '/api/pair/redeem') -ContentType 'application/json' -Body $pairBody -TimeoutSec 15
} catch {
    throw "Association refusée. Vérifie l-URL, le code, son expiration et la connexion HTTPS. Détail : $($_.Exception.Message)"
}
if (-not $pair.deviceToken -or -not $pair.pairId -or -not $pair.companionToken -or -not $pair.companionDeviceId) {
    throw 'Le relais doit prendre en charge le jeton séparé du compagnon Windows interactif. Mets à jour le relais avant l’installation.'
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $installDirectory -Recurse -Force
$companionDirectory = Join-Path $installDirectory 'Companion'
New-Item -ItemType Directory -Path $companionDirectory -Force | Out-Null
Copy-Item -Path (Join-Path $source 'companion\*') -Destination $companionDirectory -Recurse -Force

# Restrict agent configuration to SYSTEM and local Administrators.
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$adminsSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
$inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagation = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, 'FullControl', $inheritance, $propagation, $allow)))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($adminsSid, 'FullControl', $inheritance, $propagation, $allow)))
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
# Permit directory traversal only; the service token file remains protected by its own ACL.
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($userSid, 'ReadAndExecute', 'None', 'None', $allow)))
Set-Acl -LiteralPath $configDirectory -AclObject $acl

$config = @{
    RelayUrl = $RelayUrl
    DeviceId = $deviceId
    DeviceToken = [string]$pair.deviceToken
    AllowRemoteShell = [bool]$EnableRemoteShell
    PairedAtUtc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json
[System.IO.File]::WriteAllText($configPath, $config, (New-Object System.Text.UTF8Encoding($false)))
$protectedFileAcl = Get-Acl -LiteralPath $configPath
$protectedFileAcl.SetAccessRuleProtection($true, $false)
$protectedFileAcl.SetOwner($adminsSid)
$protectedFileAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, 'FullControl', 'Allow')))
$protectedFileAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($adminsSid, 'FullControl', 'Allow')))
Set-Acl -LiteralPath $configPath -AclObject $protectedFileAcl

# Companion credentials are readable only by SYSTEM, administrators, and the installing user.
$companionConfigPath = Join-Path $configDirectory 'companion.json'
$companionConfig = @{
    RelayUrl = $RelayUrl
    DeviceId = [string]$pair.companionDeviceId
    DeviceToken = [string]$pair.companionToken
    PairId = [string]$pair.pairId
} | ConvertTo-Json
[System.IO.File]::WriteAllText($companionConfigPath, $companionConfig, (New-Object System.Text.UTF8Encoding($false)))
$companionAcl = Get-Acl -LiteralPath $companionConfigPath
$companionAcl.SetAccessRuleProtection($true, $false)
$companionAcl.SetOwner($adminsSid)
$companionAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, 'FullControl', 'Allow')))
$companionAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($adminsSid, 'FullControl', 'Allow')))
$companionAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($userSid, 'Read', 'Allow')))
Set-Acl -LiteralPath $companionConfigPath -AclObject $companionAcl

$installedExecutable = Join-Path $installDirectory 'NexusAgent.exe'
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    sc.exe config $serviceName binPath= "`"$installedExecutable`"" start= auto | Out-Null
} else {
    sc.exe create $serviceName binPath= "`"$installedExecutable`"" start= auto DisplayName= "`"$displayName`"" | Out-Null
}
if ($LASTEXITCODE -ne 0) {
    throw "Échec de configuration du service (code $LASTEXITCODE)."
}

# Recover automatically from unexpected service crashes.
sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
sc.exe failureflag $serviceName 1 | Out-Null

Start-Service -Name $serviceName

# Start the visible companion at the installing user's next sign-in. It is not a hidden service.
$companionExecutable = Join-Path $companionDirectory 'NexusControlCompanion.exe'
$runKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name 'NexusControlCompanion' -Value ('"' + $companionExecutable + '"')
if ([Environment]::UserInteractive) {
    Start-Process -FilePath $companionExecutable
}

Get-Service -Name $serviceName | Format-Table Name, Status, StartType
Write-Host "Appareil associé : $deviceId"
Write-Host "Compagnon interactif : $companionExecutable"
Write-Host "PowerShell distant : $EnableRemoteShell"
Write-Host 'Le service utilise WSS en sortie. Le compagnon affiche une demande locale et un indicateur visible pour toute session de contrôle.'
