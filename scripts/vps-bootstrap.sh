#!/usr/bin/env bash
# Setup inicial Contabo VPS — corre como root via SSH
set -euo pipefail

APP_DIR="/opt/ecoom-direct-ads"
REPO="https://github.com/joaoecoom/ecoom-direct-ads.git"

echo "=== Ecoom Direct ADS — VPS bootstrap ==="

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ffmpeg nginx ufw ca-certificates gnupg

if ! command -v node >/dev/null || [[ "$(node -v)" != v20* && "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

npm install -g pm2

mkdir -p "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
else
  cd "$APP_DIR" && git pull origin main
fi

cd "$APP_DIR"
npm install --omit=dev

mkdir -p output data/jobs data/projects data/assets/files

# Nginx reverse proxy
cat > /etc/nginx/sites-available/ecoom-ads <<'NGINX'
server {
    listen 80;
    server_name _;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 600s;
        proxy_connect_timeout 60s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/ecoom-ads /etc/nginx/sites-enabled/ecoom-ads
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

ufw --force enable
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp

echo "✅ Bootstrap concluído. Próximo: .env + gcp-sa.json + pm2 start"
