#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
if [ "${MSH_SKIP_ENV:-false}" != "true" ]; then
  source "${PROJECT_ROOT}/scripts/lib/load-env.sh"
  load_managed_skill_hub_env "${PROJECT_ROOT}"
fi
: "${MYSQL_HOST:?MYSQL_HOST is required for MySQL migration backup}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE is required for MySQL migration backup}"
: "${MYSQL_USER:?MYSQL_USER is required for MySQL migration backup}"
command -v mysqldump >/dev/null 2>&1 || { echo "[ERROR] mysqldump is required for a MySQL migration backup." >&2; exit 1; }
DATA_DIR="${DATA_DIR:-${PROJECT_ROOT}/data}"
BACKUP_DIR="${DATA_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_PATH="${BACKUP_DIR}/managed-skill-hub-mysql-before-migration-${TIMESTAMP}.sql"
mkdir -p "$BACKUP_DIR"
umask 077
MYSQL_PWD="${MYSQL_PASSWORD:-}" mysqldump --single-transaction --routines --events --host="$MYSQL_HOST" --port="${MYSQL_PORT:-3306}" --user="$MYSQL_USER" "$MYSQL_DATABASE" > "$DUMP_PATH"
chmod 600 "$DUMP_PATH"
echo "[OK] MySQL migration backup created: $DUMP_PATH"
