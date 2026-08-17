#!/usr/bin/env bash
# Deploy API na VPS (Ubuntu/Debian)
# Uso na VPS: bash scripts/deploy-vps.sh

set -e

APP_DIR="${APP_DIR:-/opt/ecoom-direct-ads}"
REPO_URL="${REPO_URL:-https://github.com/joaoecoom/ecoom-direct-ads.git}"
BRANCH="${BRANCH:-main}"

echo "=== Ecoom Direct ADS — Deploy VPS ==="

if ! command -v node >/dev/null; then
  echo "A instalar Node 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs ffmpeg
fi

if ! command -v ffmpeg >/dev/null; then
  sudo apt-get update && sudo apt-get install -y ffmpeg
fi

if ! command -v pm2 >/dev/null; then
  sudo npm install -g pm2
fi

sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER:$USER" "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

npm install --omit=dev

if [ ! -f .env ]; then
  echo "⚠️  Cria .env a partir de .env.example"
  cp .env.example .env
fi

if [ -z "$GOOGLE_APPLICATION_CREDENTIALS" ] && [ ! -f gcp-sa.json ]; then
  echo "⚠️  Na VPS precisas de service account GCP:"
  echo "   1. GCP Console → IAM → Service Accounts → Create key (JSON)"
  echo "   2. Copia para $APP_DIR/gcp-sa.json"
  echo "   3. Adiciona ao .env: GOOGLE_APPLICATION_CREDENTIALS=$APP_DIR/gcp-sa.json"
fi

pm2 startOrRestart ecosystem.config.cjs
pm2 save

echo ""
echo "✅ API no ar — porta ${PORT:-8787}"
echo "   Teste: curl http://localhost:8787/health"
echo "   Logs: pm2 logs ecoom-ads-api"
