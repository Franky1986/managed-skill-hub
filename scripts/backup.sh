#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ "${MSH_SKIP_ENV:-false}" != "true" ] && [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "${PROJECT_ROOT}/.env"
  set +a
fi

DATA_DIR="${DATA_DIR:-${PROJECT_ROOT}/data}"

if [ "${CONTENT_STORAGE_PROVIDER:-filesystem}" = "database" ] && [ "${CATALOG_PROVIDER:-sqlite}" = "mysql" ]; then
  echo "[ERROR] CONTENT_STORAGE_PROVIDER=database with CATALOG_PROVIDER=mysql stores managed content in MySQL." >&2
  echo "[ERROR] scripts/backup.sh only archives DATA_DIR and would be incomplete for this mode." >&2
  echo "[ERROR] Create a tested MySQL database dump before backing up filesystem-side operational files." >&2
  exit 1
fi
BACKUP_DIR="${DATA_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${BACKUP_DIR}/managed-skill-hub-data-${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "[INFO] Erstelle Backup: ${ARCHIVE}"

cd "$(dirname "$DATA_DIR")"
tar -czf "$ARCHIVE" "$(basename "$DATA_DIR")"

echo "[OK] Backup erstellt: ${ARCHIVE}"
