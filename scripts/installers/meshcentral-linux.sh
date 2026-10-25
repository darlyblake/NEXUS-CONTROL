#!/usr/bin/env bash
set -Eeuo pipefail

echo "=============================================="
echo " NEXUS CONTROL — Installation MeshCentral"
echo " Système détecté : Linux"
echo "=============================================="
echo
echo "Cette installation crée un serveur MeshCentral local dans :"
echo "${XDG_DATA_HOME:-$HOME/.local/share}/nexus-control/meshcentral"
echo "Le serveur sera lancé dans ce terminal sur le port 4430."
echo

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[ÉTAPE REQUISE] Node.js et npm sont nécessaires."
  echo "Sur Ubuntu, tu peux installer les paquets système avec :"
  echo "  sudo apt update && sudo apt install nodejs npm"
  echo "MeshCentral peut demander une version Node.js plus récente (20+)."
  echo "Vérifie ensuite avec : node --version && npm --version"
  echo "Si Node.js est inférieur à 20, installe une version LTS récente depuis https://nodejs.org/"
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[ERREUR] Node.js 20 ou plus récent est requis (version actuelle : $(node --version))."
  echo "Installe une version LTS récente depuis https://nodejs.org/ puis relance l'intégration."
  exit 1
fi

BASE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/nexus-control/meshcentral"
mkdir -p "$BASE_DIR"
cd "$BASE_DIR"

if [ ! -f package.json ]; then
  npm init -y
fi

echo
echo "[1/3] Installation du paquet MeshCentral dans le dossier utilisateur..."
npm install --save meshcentral

echo
echo "[2/3] Configuration du serveur local sur le port 4430..."
if [ ! -f config.json ]; then
  cat > config.json <<'JSON'
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
      "newAccounts": false,
      "localSessionRecording": false
    }
  }
}
JSON
else
  echo "config.json existe déjà : configuration conservée."
fi

echo
echo "[3/3] Démarrage de MeshCentral."
echo "Adresse locale : https://localhost:4430"
echo "N'utilise pas ce serveur sur Internet sans configurer TLS, comptes et pare-feu."
echo "Arrête le serveur avec Ctrl+C."
echo
npm exec -- meshcentral
