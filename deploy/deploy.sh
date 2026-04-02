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

echo "==> Running seed (idempotent)..."
pnpm seed

echo "==> Restarting PM2..."
pm2 restart ecosystem.config.cjs --env production
pm2 save

echo "==> Done!"
