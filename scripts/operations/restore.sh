#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [ "${MSH_SKIP_ENV:-false}" != "true" ]; then
  # shellcheck source=../lib/load-env.sh
  source "${PROJECT_ROOT}/scripts/lib/load-env.sh"
  load_managed_skill_hub_env "${PROJECT_ROOT}"
fi

DATA_DIR="${DATA_DIR:-${PROJECT_ROOT}/data}"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <backup-tar.gz>"
  exit 1
fi

BACKUP="$1"

if [ ! -f "$BACKUP" ]; then
  echo "[ERROR] Backup not found: ${BACKUP}"
  exit 1
fi

validate_backup_archive() {
  local archive="$1"
  local entry

  while IFS= read -r entry; do
    case "$entry" in
      /*|../*|*/../*|*/..)
        echo "[ERROR] Backup contains unsafe path: ${entry}"
        exit 1
        ;;
    esac
  done < <(tar -tzf "$archive")

  if tar -tvzf "$archive" | awk '{ print substr($1, 1, 1) }' | grep -Eq '^[lh]$'; then
    echo "[ERROR] Backup contains symlinks or hardlinks and will not be restored."
    exit 1
  fi
}

RESTORE_BACKUP="$BACKUP"
case "$BACKUP" in
  "$DATA_DIR"/*)
    TEMP_BACKUP="$(mktemp "${TMPDIR:-/tmp}/managed-skill-hub-restore-XXXXXX")"
    cp "$BACKUP" "$TEMP_BACKUP"
    RESTORE_BACKUP="$TEMP_BACKUP"
    ;;
esac

validate_backup_archive "$RESTORE_BACKUP"

# Stop the stack if it is running, unless an isolated proof/test explicitly opts out.
if [ "${MSH_SKIP_STOP:-false}" != "true" ] && [ -x "${PROJECT_ROOT}/scripts/deployment/restart-server.sh" ]; then
  bash "${PROJECT_ROOT}/scripts/deployment/restart-server.sh" stop || true
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
PRE_RESTORE="${DATA_DIR}.pre-restore-${TIMESTAMP}"

echo "[INFO] Backing up current data/ to ${PRE_RESTORE}"
mkdir -p "$(dirname "$PRE_RESTORE")"
if [ -d "$DATA_DIR" ]; then
  mv "$DATA_DIR" "$PRE_RESTORE"
fi

echo "[INFO] Extracting backup: ${BACKUP}"
mkdir -p "$DATA_DIR"
tar -xzf "$RESTORE_BACKUP" -C "$(dirname "$DATA_DIR")"

echo "[OK] Restore abgeschlossen."
echo "[INFO] Altes data/ liegt unter ${PRE_RESTORE}"
echo "[INFO] Stack mit 'bash scripts/deployment/restart-server.sh' neu starten."
