#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "============================================"
echo " managed-skill-hub Install and Start"
echo "============================================"
echo ""

cd "$PROJECT_ROOT"

echo "[1/4] Checking .env and data directories..."
if [ ! -f ".env" ]; then
  echo "WARNING: .env is missing. Create it from .env.example."
  exit 1
fi
mkdir -p data/{skills,proposals,index,audit,backups,uploads}
echo "[1/4] .env and data directories OK."
echo ""

echo "[2/4] Installing dependencies ..."
npm install --legacy-peer-deps --no-audit --no-fund
echo "[2/4] Dependencies installed."
echo ""

echo "[3/4] Starting production build ..."
npm run build:prod
echo "[3/4] Build successful."
echo ""

echo "[4/4] Starting stack ..."
bash scripts/restart-server.sh
echo "[4/4] Stack started."
echo ""

echo "Done."
