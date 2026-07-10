#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRANSFER_DIR="$ROOT_DIR/_transfer"
STAMP="$(date +%Y%m%d-%H%M%S)"
ZIP_PATH="$TRANSFER_DIR/auto_YT-windows-transfer-$STAMP.zip"
MANIFEST_PATH="$TRANSFER_DIR/auto_YT-windows-transfer-$STAMP-manifest.txt"

mkdir -p "$TRANSFER_DIR"

cd "$ROOT_DIR"

cat > "$MANIFEST_PATH" <<MANIFEST
auto_YT Windows transfer package
Created: $STAMP

Included:
- Source code and project docs
- package.json and pnpm-lock.yaml files
- docker-compose.yml files
- .env.local files for web, web_2, and web_3

Excluded:
- .git
- node_modules
- .next
- dist/build output
- logs and cache folders
- previous _transfer packages

Important:
- This package contains .env.local secrets. Keep it private.
- Reinstall dependencies on Windows with pnpm install inside each app folder.
MANIFEST

zip -qr "$ZIP_PATH" . \
  -x '.git/*' \
  -x '_transfer/*' \
  -x 'data/chrome_user_data/*' \
  -x '.pytest_cache/*' \
  -x '__pycache__/*' \
  -x '*/__pycache__/*' \
  -x '*/.vercel/*' \
  -x '*/.DS_Store' \
  -x '.DS_Store' \
  -x '*/node_modules/*' \
  -x '*/.next/*' \
  -x '*/dist/*' \
  -x '*/build/*' \
  -x '*/.turbo/*' \
  -x '*/.cache/*' \
  -x '*.log' \
  -x '*/tsconfig.tsbuildinfo' \
  -x '*/.env.local.backup*'

printf 'Created transfer package:\n%s\n\nManifest:\n%s\n' "$ZIP_PATH" "$MANIFEST_PATH"
