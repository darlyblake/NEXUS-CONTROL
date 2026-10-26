#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 user@windows-host https://relay.example CODE /path/to/extracted-windows-artifact" >&2
  exit 2
fi
target="$1"
relay_url="${2%/}"
pair_code="${3^^}"
artifact="$(realpath "$4")"

[[ "$target" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$ ]] || { echo "Cible SSH invalide (user@host requis)." >&2; exit 2; }
[[ "$relay_url" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?(/[a-zA-Z0-9._~:/?#@!\$\&'\(\)\*\+,;=%-]*)?$ ]] || { echo "L'URL du relais doit utiliser HTTPS." >&2; exit 2; }
[[ "$pair_code" =~ ^[A-HJ-NP-Z2-9]{10}$ ]] || { echo "Code d'association invalide." >&2; exit 2; }
[[ -f "$artifact/NexusAgent.exe" && -f "$artifact/Install-NexusAgent.ps1" ]] || { echo "Artefact Windows incomplet." >&2; exit 2; }
command -v ssh >/dev/null && command -v scp >/dev/null || { echo "Installe openssh-client : sudo apt install openssh-client" >&2; exit 2; }

echo "Ce script exige un compte Windows autorisé via OpenSSH et conservera la confirmation OUI interactive de l'installateur sur la cible."
read -r -p "Confirme que tu es autorisé à administrer $target (tape OUI) : " consent
[[ "$consent" == "OUI" ]] || { echo "Annulé."; exit 1; }

remote_dir='C:/ProgramData/NexusControlDeploy/payload'
ssh "$target" "powershell.exe -NoProfile -NonInteractive -Command \"New-Item -ItemType Directory -Force -Path '$remote_dir' | Out-Null\""
scp -r "$artifact/." "$target:$remote_dir/"
# -tt preserves the installer's interactive OUI and PowerShell-consent prompts on Windows.
ssh -tt "$target" "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"& '$remote_dir/Install-NexusAgent.ps1' -PublishDirectory '$remote_dir' -RelayUrl '$relay_url' -PairCode '$pair_code'\""
echo "Déploiement terminé si l'installateur confirme que le service a démarré."
