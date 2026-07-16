#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_ROOT="${MANAGED_SKILL_HUB_RUNTIME_ROOT:-${SCRIPT_PROJECT_ROOT}}"
LOG_DIR="${PROJECT_ROOT}/.tmp"
LOG_FILE="${LOG_DIR}/server.log"
API_PID_FILE="${LOG_DIR}/api.pid"
FRONTEND_PID_FILE="${LOG_DIR}/frontend.pid"
LEGACY_PID_FILE="${LOG_DIR}/server.pid"
START_IN_BACKGROUND="${START_IN_BACKGROUND:-1}"

# shellcheck source=./load-env.sh
source "${SCRIPT_DIR}/load-env.sh"
load_managed_skill_hub_env "${PROJECT_ROOT}"

FRONTEND_PORT="${FRONTEND_PORT:-3041}"
API_PORT="${API_PORT:-3040}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
API_START_MODE="${API_START_MODE:-dev}"
FRONTEND_START_MODE="${FRONTEND_START_MODE:-dev}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-45}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:${API_PORT}/api/health/ready}"
FRONTEND_HEALTH_URL="${FRONTEND_HEALTH_URL:-http://127.0.0.1:${FRONTEND_PORT}/frontend/}"

for numeric_setting in API_PORT FRONTEND_PORT STARTUP_TIMEOUT_SECONDS; do
  numeric_value="${!numeric_setting}"
  if [[ ! "$numeric_value" =~ ^[1-9][0-9]*$ ]]; then
    echo "Invalid ${numeric_setting}: ${numeric_value}. Use a positive integer." >&2
    exit 1
  fi
done

case "$API_START_MODE" in
  dev|production) ;;
  *)
    echo "Unsupported API_START_MODE: ${API_START_MODE}. Use dev or production." >&2
    exit 1
    ;;
esac

case "$FRONTEND_START_MODE" in
  dev|preview) ;;
  *)
    echo "Unsupported FRONTEND_START_MODE: ${FRONTEND_START_MODE}. Use dev or preview." >&2
    exit 1
    ;;
esac

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

verify_runtime_dependencies() {
  local node_version node_abi expected_node_major native_error

  command -v node >/dev/null 2>&1 || {
    echo "ERROR: node is required to start the stack." >&2
    return 1
  }
  command -v npm >/dev/null 2>&1 || {
    echo "ERROR: npm is required to start the stack." >&2
    return 1
  }

  node_version="$(node --version)"
  node_abi="$(node -p 'process.versions.modules')"
  expected_node_major=""
  if [[ -f "${PROJECT_ROOT}/.nvmrc" ]]; then
    expected_node_major="$(tr -d '[:space:]' < "${PROJECT_ROOT}/.nvmrc")"
  fi

  if [[ "$expected_node_major" =~ ^[0-9]+$ && "${node_version#v}" != "${expected_node_major}."* ]]; then
    log "INFO: active ${node_version} differs from the recommended Node ${expected_node_major} in .nvmrc."
  fi

  if [[ ! -d "${PROJECT_ROOT}/node_modules" ]]; then
    echo "ERROR: node_modules is missing. Run npm ci --legacy-peer-deps first." >&2
    return 1
  fi

  if ! native_error="$(
    cd "$PROJECT_ROOT"
    node -e "
      const { createRequire } = require('node:module');
      const requireFromApi = createRequire(process.cwd() + '/apps/api/package.json');
      const Database = requireFromApi('better-sqlite3');
      const database = new Database(':memory:');
      database.close();
    " 2>&1
  )"; then
    echo "ERROR: native runtime dependency check failed for ${node_version} (Node ABI ${node_abi})." >&2
    if [[ "$native_error" == *"NODE_MODULE_VERSION"* || "$native_error" == *"ERR_DLOPEN_FAILED"* ]]; then
      echo "The installed better-sqlite3 binary was built for a different Node.js runtime." >&2
      echo "Rebuild it for the active runtime with:" >&2
      echo "  npm rebuild better-sqlite3 --workspace=apps/api" >&2
      if [[ "$expected_node_major" =~ ^[0-9]+$ ]]; then
        echo "Alternatively, activate Node ${expected_node_major} from .nvmrc and run npm ci --legacy-peer-deps." >&2
      fi
    else
      echo "$native_error" >&2
      echo "Run npm ci --legacy-peer-deps before retrying." >&2
    fi
    return 1
  fi
}

process_cwd() {
  local pid="$1"
  if [[ -e "/proc/${pid}/cwd" ]]; then
    readlink -f "/proc/${pid}/cwd" 2>/dev/null || true
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
  fi
}

pid_belongs_to_project() {
  local pid="$1"
  local cwd
  cwd="$(process_cwd "$pid")"
  [[ -n "$cwd" && ( "$cwd" == "$PROJECT_ROOT" || "$cwd" == "$PROJECT_ROOT/"* ) ]]
}

child_pids() {
  local pid="$1"
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -P "$pid" 2>/dev/null || true
  else
    ps -o pid= --ppid "$pid" 2>/dev/null | tr -d ' ' || true
  fi
}

collect_process_tree() {
  local pid="$1"
  local child
  while IFS= read -r child; do
    [[ -n "$child" ]] || continue
    collect_process_tree "$child"
  done < <(child_pids "$pid")
  printf '%s\n' "$pid"
}

stop_pid_file() {
  local pid_file="$1"
  local label="$2"
  local pid tree_pid
  local -a process_tree=()

  [[ -f "$pid_file" ]] || return 0
  pid="$(tr -d '[:space:]' < "$pid_file" 2>/dev/null || true)"
  if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
    echo "ERROR: invalid ${label} PID file: ${pid_file}" >&2
    return 1
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    return 0
  fi
  if ! pid_belongs_to_project "$pid"; then
    echo "ERROR: refusing to stop PID ${pid} from ${pid_file}; its working directory is outside ${PROJECT_ROOT}." >&2
    return 1
  fi

  log "Stopping ${label} process tree rooted at PID ${pid}."
  while IFS= read -r tree_pid; do
    [[ -n "$tree_pid" ]] && process_tree+=("$tree_pid")
  done < <(collect_process_tree "$pid")
  for tree_pid in "${process_tree[@]}"; do
    kill -TERM "$tree_pid" 2>/dev/null || true
  done

  local retries=0
  while kill -0 "$pid" 2>/dev/null && (( retries < 10 )); do
    sleep 1
    retries=$((retries + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    log "${label} PID ${pid} did not stop after TERM; using KILL for its recorded process tree."
    for tree_pid in "${process_tree[@]}"; do
      kill -KILL "$tree_pid" 2>/dev/null || true
    done
  fi
  rm -f "$pid_file"
}

port_is_open() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    (echo >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1
  fi
}

require_ports_free() {
  local port
  for port in "$API_PORT" "$FRONTEND_PORT"; do
    if port_is_open "$port"; then
      echo "ERROR: port ${port} is still occupied after stopping recorded project processes." >&2
      echo "Refusing to terminate an unverified listener. Inspect it manually with: sudo ss -ltnp | grep ':${port}\\b'" >&2
      return 1
    fi
  done
}

stop_services() {
  stop_pid_file "$API_PID_FILE" "API"
  stop_pid_file "$FRONTEND_PID_FILE" "frontend"
  stop_pid_file "$LEGACY_PID_FILE" "legacy stack"
  require_ports_free
  log "Stack stopped."
}

write_pid_file() {
  local pid_file="$1"
  local pid="$2"
  local temporary="${pid_file}.tmp.$$"
  printf '%s\n' "$pid" > "$temporary"
  mv "$temporary" "$pid_file"
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local pid="$3"
  local attempts=0

  while (( attempts < STARTUP_TIMEOUT_SECONDS )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "ERROR: ${label} process exited before becoming healthy." >&2
      return 1
    fi
    if curl -fsS --connect-timeout 2 --max-time 4 "$url" >/dev/null 2>&1; then
      log "${label} healthcheck passed: ${url}"
      return 0
    fi
    sleep 1
    attempts=$((attempts + 1))
  done

  echo "ERROR: ${label} did not become healthy within ${STARTUP_TIMEOUT_SECONDS}s: ${url}" >&2
  return 1
}

start_services() {
  local -a api_command frontend_command
  local api_pid frontend_pid

  command -v curl >/dev/null 2>&1 || {
    echo "ERROR: curl is required for startup healthchecks." >&2
    return 1
  }
  verify_runtime_dependencies

  if [[ "$API_START_MODE" == "production" ]]; then
    [[ -f "${PROJECT_ROOT}/apps/api/dist/server.js" ]] || {
      echo "ERROR: production API build is missing: apps/api/dist/server.js" >&2
      return 1
    }
    api_command=(node apps/api/dist/server.js)
  else
    api_command=(npm run dev --workspace=apps/api)
  fi

  if [[ "$FRONTEND_START_MODE" == "preview" ]]; then
    [[ -f "${PROJECT_ROOT}/apps/web/dist/index.html" ]] || {
      echo "ERROR: production frontend build is missing: apps/web/dist/index.html" >&2
      return 1
    }
    frontend_command=(npm run preview --workspace=apps/web -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT")
  else
    frontend_command=(npm run dev --workspace=apps/web -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT")
  fi

  : > "$LOG_FILE"
  cd "$PROJECT_ROOT"
  log "Starting API (${API_START_MODE}) and frontend (${FRONTEND_START_MODE}) in ${PROJECT_ROOT}."
  nohup env TMPDIR=/tmp "${api_command[@]}" >>"$LOG_FILE" 2>&1 < /dev/null &
  api_pid=$!
  write_pid_file "$API_PID_FILE" "$api_pid"

  nohup env TMPDIR=/tmp "${frontend_command[@]}" >>"$LOG_FILE" 2>&1 < /dev/null &
  frontend_pid=$!
  write_pid_file "$FRONTEND_PID_FILE" "$frontend_pid"

  if ! wait_for_http "API" "$API_HEALTH_URL" "$api_pid" \
    || ! wait_for_http "Frontend" "$FRONTEND_HEALTH_URL" "$frontend_pid"; then
    tail -80 "$LOG_FILE" >&2 || true
    stop_services || true
    return 1
  fi

  log "Stack started and healthy."
  log "API PID: ${api_pid}; frontend PID: ${frontend_pid}"
  log "Logs: ${LOG_FILE}"
  log "Stop with: bash scripts/restart-server.sh stop"

  if [[ "$START_IN_BACKGROUND" != "1" ]]; then
    trap 'stop_services' INT TERM EXIT
    wait "$api_pid" "$frontend_pid"
  fi
}

print_status() {
  local pid_file label pid
  for pid_file in "$API_PID_FILE" "$FRONTEND_PID_FILE"; do
    if [[ "$pid_file" == "$API_PID_FILE" ]]; then
      label="API"
    else
      label="frontend"
    fi
    if [[ -f "$pid_file" ]]; then
      pid="$(tr -d '[:space:]' < "$pid_file" 2>/dev/null || true)"
    else
      pid=""
    fi
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && pid_belongs_to_project "$pid"; then
      log "${label}: running (PID ${pid})"
    else
      log "${label}: not running"
    fi
  done
}

case "${1:-restart}" in
  start)
    require_ports_free
    start_services
    ;;
  restart|"")
    log "===== Restart started ====="
    stop_services
    start_services
    ;;
  stop)
    stop_services
    ;;
  status)
    print_status
    ;;
  *)
    echo "Usage: $0 [start|restart|stop|status]" >&2
    exit 1
    ;;
esac
