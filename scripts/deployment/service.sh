#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
CONFIGURED_DEPLOYMENT_ROOT="${MANAGED_SKILL_HUB_DEPLOYMENT_ROOT:-${SCRIPT_DIR}}"
DEPLOYMENT_ROOT="$(cd "$CONFIGURED_DEPLOYMENT_ROOT" && pwd -P)"
CONFIG_FILE="${MANAGED_SKILL_HUB_DEPLOYMENT_CONFIG:-${DEPLOYMENT_ROOT}/deployment.env}"
ACTION="${1:-status}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_regular_file() {
  local file="$1"
  reject_symlink_components "$file"
  [[ -f "$file" && ! -L "$file" ]] || fail "required regular file is missing or unsafe: ${file}"
}

reject_symlink_components() {
  local path="$1"
  local component
  local current="/"
  local -a components=()

  [[ "$path" = /* ]] || fail "deployment paths must resolve to absolute paths: ${path}"
  IFS='/' read -r -a components <<< "$path"
  for component in "${components[@]}"; do
    case "$component" in
      ''|.) continue ;;
      ..) fail "deployment path contains parent traversal: ${path}" ;;
    esac
    if [[ "$current" = "/" ]]; then
      current="/${component}"
    else
      current="${current}/${component}"
    fi
    [[ ! -L "$current" ]] || fail "deployment path contains a symbolic link: ${current}"
  done
}

resolve_from_root() {
  local configured="$1"
  local resolved
  if [[ "$configured" = /* ]]; then
    resolved="$configured"
  else
    case "$configured" in
      ''|..|../*|*/..|*/../*)
        fail "relative deployment path escapes its root: ${configured}"
        ;;
    esac
    resolved="${DEPLOYMENT_ROOT}/${configured#./}"
  fi
  reject_symlink_components "$resolved"
  printf '%s\n' "$resolved"
}

if [[ -e "$CONFIG_FILE" || -L "$CONFIG_FILE" ]]; then
  require_regular_file "$CONFIG_FILE"
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

SOURCE_DIR="$(resolve_from_root "${MSH_SOURCE_DIR:-src}")"
SECRETS_FILE="$(resolve_from_root "${MSH_SECRETS_FILE:-.env.secrets}")"
START_SCRIPT="$(resolve_from_root "${MSH_START_SCRIPT:-src/scripts/install_and_start.sh}")"
RUNTIME_SCRIPT="$(resolve_from_root "${MSH_RUNTIME_SCRIPT:-src/scripts/restart-server.sh}")"
LOG_FILE="$(resolve_from_root "${MSH_LOG_FILE:-src/.tmp/server.log}")"
API_HEALTH_URL="${MSH_API_HEALTH_URL:-http://127.0.0.1:3040/api/health/ready}"
FRONTEND_HEALTH_URL="${MSH_FRONTEND_HEALTH_URL:-http://127.0.0.1:3041/frontend/}"

for health_url in "$API_HEALTH_URL" "$FRONTEND_HEALTH_URL"; do
  case "$health_url" in
    http://*|https://*) ;;
    *) fail "health URLs must use http or https: ${health_url}" ;;
  esac
done

require_active_source() {
  reject_symlink_components "$SOURCE_DIR"
  [[ -d "$SOURCE_DIR" && ! -L "$SOURCE_DIR" ]] \
    || fail "active source directory is missing or unsafe: ${SOURCE_DIR}"
  require_regular_file "${SOURCE_DIR}/.env"
}

run_with_runtime_environment() {
  exec env \
    MANAGED_SKILL_HUB_RUNTIME_ROOT="$SOURCE_DIR" \
    MANAGED_SKILL_HUB_SECRETS_FILE="$SECRETS_FILE" \
    "$@"
}

case "$ACTION" in
  start|restart)
    require_active_source
    require_regular_file "$SECRETS_FILE"
    require_regular_file "$START_SCRIPT"
    run_with_runtime_environment bash "$START_SCRIPT" start
    ;;
  stop|status)
    require_active_source
    require_regular_file "$SECRETS_FILE"
    require_regular_file "$RUNTIME_SCRIPT"
    run_with_runtime_environment bash "$RUNTIME_SCRIPT" "$ACTION"
    ;;
  health)
    command -v curl >/dev/null 2>&1 || fail "curl is required for health checks"
    curl -fsS -- "$API_HEALTH_URL"
    printf '\n'
    curl -fsS -- "$FRONTEND_HEALTH_URL" >/dev/null
    echo "Frontend: healthy"
    ;;
  logs)
    require_regular_file "$LOG_FILE"
    exec tail -n "${LOG_LINES:-200}" -f "$LOG_FILE"
    ;;
  config)
    printf 'deploymentRoot=%s\n' "$DEPLOYMENT_ROOT"
    printf 'sourceDir=%s\n' "$SOURCE_DIR"
    printf 'secretsFile=%s\n' "$SECRETS_FILE"
    printf 'apiHealthUrl=%s\n' "$API_HEALTH_URL"
    printf 'frontendHealthUrl=%s\n' "$FRONTEND_HEALTH_URL"
    printf 'logFile=%s\n' "$LOG_FILE"
    ;;
  *)
    echo "Usage: bash ./service.sh {start|restart|stop|status|health|logs|config}" >&2
    exit 2
    ;;
esac
