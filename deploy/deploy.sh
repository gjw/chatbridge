#!/usr/bin/env bash
set -euo pipefail

cd /root/chatbridge

export PATH="$HOME/.nodenv/bin:$PATH"
eval "$(nodenv init -)"

echo "==> Pulling latest..."
git pull

echo "==> Installing dependencies..."
corepack enable
pnpm install

echo "==> Building server..."
pnpm build:server

echo "==> Building frontend..."
NODE_OPTIONS="--max-old-space-size=4096" pnpm build:web

echo "==> Ensuring app directories are readable by nginx..."
chmod -R 755 apps/

echo "==> Updating nginx config (preserving certbot SSL)..."
NGINX_CONF="/etc/nginx/sites-enabled/chatbridge.foramerica.dev.conf"
if [ ! -f "$NGINX_CONF" ]; then
    cp deploy/chatbridge.foramerica.dev.conf "$NGINX_CONF"
    nginx -t && nginx -s reload
    certbot --nginx -d chatbridge.foramerica.dev --non-interactive
else
    # Config exists (with certbot SSL lines). Check if we added new location blocks
    # by comparing our deploy conf's location blocks against the live one.
    # If a location block is missing, warn but don't overwrite.
    for app_dir in apps/*/; do
        app_name=$(basename "$app_dir")
        if ! grep -q "/apps/${app_name}/" "$NGINX_CONF"; then
            echo "WARNING: /apps/${app_name}/ not in nginx config. Add manually and run: certbot --nginx -d chatbridge.foramerica.dev --non-interactive"
        fi
    done
    nginx -s reload
fi

echo "==> Running seed (idempotent)..."
export $(cat .env | grep -v "^#" | xargs)
pnpm seed

echo "==> Restarting PM2..."
pm2 restart ecosystem.config.cjs --env production
pm2 save

echo "==> Done!"
