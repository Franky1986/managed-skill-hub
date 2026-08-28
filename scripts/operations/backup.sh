#!/usr/bin/env bash
set -euo pipefail

# Backups can contain skill content, audit records, and credentials embedded in
# configuration artifacts.  Do not rely on the caller's default umask.
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [ "${MSH_SKIP_ENV:-false}" != "true" ]; then
  # shellcheck source=../lib/load-env.sh
  source "${PROJECT_ROOT}/scripts/lib/load-env.sh"
  load_managed_skill_hub_env "${PROJECT_ROOT}"
fi

DATA_DIR="${DATA_DIR:-${PROJECT_ROOT}/data}"

if [ "${CATALOG_PROVIDER:-sqlite}" = "mysql" ]; then
  echo "[ERROR] CATALOG_PROVIDER=mysql stores the catalog in MySQL." >&2
  echo "[ERROR] scripts/operations/backup.sh only archives DATA_DIR and would be incomplete." >&2
  echo "[ERROR] Create a tested MySQL database dump before backing up filesystem-side operational files." >&2
  exit 1
fi
BACKUP_DIR="${DATA_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${BACKUP_DIR}/managed-skill-hub-data-${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "[INFO] Erstelle Backup: ${ARCHIVE}"

cd "$(dirname "$DATA_DIR")"
# The destination is below DATA_DIR.  Excluding it prevents the archive from
# recursively including itself (or older backup archives).
tar -czf "$ARCHIVE" --exclude="$(basename "$DATA_DIR")/backups" "$(basename "$DATA_DIR")"
chmod 600 "$ARCHIVE"

echo "[OK] Backup erstellt: ${ARCHIVE}"
