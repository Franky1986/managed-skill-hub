#!/usr/bin/env bash
set -euo pipefail

# Backups can contain every catalog record. Create every temporary and final
# artifact private even when the calling process has a permissive umask.
umask 077

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
mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
# Reserve a random basename first. The completed dump is published with an
# atomic rename, so retries in the same second cannot overwrite each other or
# expose a partially-written SQL file.
TEMP_DUMP_PATH="$(mktemp "${BACKUP_DIR}/.managed-skill-hub-mysql-before-migration-${TIMESTAMP}-XXXXXX")"
TEMP_DUMP_BASENAME="${TEMP_DUMP_PATH##*/}"
DUMP_PATH="${BACKUP_DIR}/${TEMP_DUMP_BASENAME#.}.sql"
trap 'rm -f "$TEMP_DUMP_PATH"' EXIT
MYSQL_TLS_ARGS=()
case "${MYSQL_SSL_MODE:-preferred}" in
  disabled) MYSQL_TLS_ARGS+=(--ssl-mode=DISABLED) ;;
  preferred) MYSQL_TLS_ARGS+=(--ssl-mode=PREFERRED) ;;
  required) MYSQL_TLS_ARGS+=(--ssl-mode=REQUIRED) ;;
  verify_ca) MYSQL_TLS_ARGS+=(--ssl-mode=VERIFY_CA) ;;
  verify_identity) MYSQL_TLS_ARGS+=(--ssl-mode=VERIFY_IDENTITY) ;;
  *) echo "[ERROR] Unsupported MYSQL_SSL_MODE for MySQL migration backup." >&2; exit 1 ;;
esac
MYSQL_PWD="${MYSQL_PASSWORD:-}" mysqldump --single-transaction --routines --events "${MYSQL_TLS_ARGS[@]}" --host="$MYSQL_HOST" --port="${MYSQL_PORT:-3306}" --user="$MYSQL_USER" "$MYSQL_DATABASE" > "$TEMP_DUMP_PATH"
mv -n "$TEMP_DUMP_PATH" "$DUMP_PATH"
if [ -e "$TEMP_DUMP_PATH" ]; then
  echo "[ERROR] Refusing to overwrite existing MySQL migration backup: $DUMP_PATH" >&2
  exit 1
fi
trap - EXIT
chmod 600 "$DUMP_PATH"
echo "[OK] MySQL migration backup created: $DUMP_PATH"
