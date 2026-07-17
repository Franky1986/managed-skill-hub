#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/.tmp"
LOG_FILE="${LOG_DIR}/restart-all.log"
PID_FILE="${LOG_DIR}/restart-all.pid"
TMPDIR_TO_CLEAN="${TMPDIR:-/tmp} /private/tmp"

FRONTEND_PORT="${FRONTEND_PORT:-3041}"
API_PORT="${API_PORT:-3040}"
PORTS=("${API_PORT}" "${FRONTEND_PORT}")

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

load_env() {
  # shellcheck source=../lib/load-env.sh
  source "${PROJECT_ROOT}/scripts/lib/load-env.sh"
  load_managed_skill_hub_env "${PROJECT_ROOT}"
}

refresh_runtime_ports() {
  API_PORT="${API_PORT:-3040}"
  FRONTEND_PORT="${FRONTEND_PORT:-3041}"
  PORTS=("${API_PORT}" "${FRONTEND_PORT}")
}

validate_local_runtime() {
  if [ ! -f "${PROJECT_ROOT}/.env" ] && [ -z "${JUDGER_PROVIDER:-}" ]; then
    log "ERROR: Local configuration is missing."
    log "Create it with: cp .env.example.simple .env"
    return 1
  fi

  if [ -z "${JUDGER_PROVIDER:-}" ]; then
    log "ERROR: JUDGER_PROVIDER is not configured."
    log "Use JUDGER_PROVIDER=noop for the local simple profile."
    return 1
  fi

  if [ "${ADMIN_AUTH_MODE:-simple}" = "simple" ]; then
    if [ -z "${ADMIN_PASSWORD:-}" ] && [ -z "${ADMIN_PASSWORD_HASH:-}" ]; then
      log "ERROR: Simple admin auth requires ADMIN_PASSWORD or ADMIN_PASSWORD_HASH."
      log "Copy .env.secrets.example to .env.secrets and set one local credential."
      return 1
    fi
    if [ -z "${JWT_SECRET:-}" ]; then
      log "ERROR: Simple admin auth requires JWT_SECRET."
      log "Generate one with the command documented in .env.secrets.example."
      return 1
    fi
  fi
}

process_tree_is_running() {
  local pid="$1"
  kill -0 -- "-${pid}" 2>/dev/null || kill -0 "${pid}" 2>/dev/null
}

signal_process_tree() {
  local signal="$1"
  local pid="$2"
  kill "-${signal}" -- "-${pid}" 2>/dev/null || kill "-${signal}" "${pid}" 2>/dev/null || true
}

kill_named_processes() {
  local patterns=("tsx watch src/server.ts" "node dist/server.js" "vite --port" "vite")
  for pattern in "${patterns[@]}"; do
    local pids
    pids="$(pgrep -f "$pattern" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      log "Stopping processes for '${pattern}': ${pids}"
      for pid in $pids; do
        if [ -n "${pid:-}" ]; then
          kill -TERM "$pid" 2>/dev/null || true
        fi
      done
    fi
  done

  sleep 2

  for pattern in "${patterns[@]}"; do
    local pids
    pids="$(pgrep -f "$pattern" 2>/dev/null || true)"
    for pid in $pids; do
      if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
        log "Process ${pid} for '${pattern}' did not respond to TERM, using KILL"
        kill -KILL "$pid" 2>/dev/null || true
      fi
    done
  done
  sleep 1
}

kill_processes_on_ports() {
  local pids
  for port in "${PORTS[@]}"; do
    if command -v lsof >/dev/null 2>&1; then
      pids="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t || true)"
    else
      pids=""
    fi

    if [ -n "$pids" ]; then
      log "Stopping listeners on port ${port}: ${pids}"
      for pid in $pids; do
        if [ -n "${pid:-}" ]; then
          kill -TERM "$pid" 2>/dev/null || true
        fi
      done
      sleep 2

      for pid in $pids; do
        if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
          log "Port ${port} process ${pid} did not respond to TERM, using KILL"
          kill -KILL "$pid" 2>/dev/null || true
        fi
      done
      sleep 1
    fi
  done
}

stop_background_process_from_pidfile() {
  if [ ! -f "$PID_FILE" ]; then
    return
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  rm -f "$PID_FILE"

  if [ -z "$pid" ]; then
    return
  fi

  if process_tree_is_running "$pid"; then
    log "Stopping background process group from PID file: ${pid}"
    signal_process_tree TERM "$pid"
    sleep 1
    if process_tree_is_running "$pid"; then
      signal_process_tree KILL "$pid"
    fi
  fi
}

cleanup_stale_ipc() {
  local dir
  for dir in ${TMPDIR_TO_CLEAN}; do
    if [ -d "$dir" ]; then
      find "$dir" -maxdepth 3 -type p -name 'tsx-*' -user "$USER" -exec rm -f {} + 2>/dev/null || true
      find "$dir" -maxdepth 3 -type p -name 'tsx-*.sock' -user "$USER" -exec rm -f {} + 2>/dev/null || true
    fi
  done
}

wait_for_ports_freed() {
  local timeout=15
  for port in "${PORTS[@]}"; do
    local retries=0
    while :; do
      if command -v lsof >/dev/null 2>&1 && [ -z "$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t || true)" ]; then
        log "Port ${port} is free."
        break
      fi
      sleep 1
      retries=$((retries + 1))
      if [ "$retries" -ge "$timeout" ]; then
        log "WARN: Port ${port} did not become free within ${timeout}s. Another process may still be running."
        log "WARN: Check manually: lsof -i :${port} && kill -9 <PID>"
        break
      fi
    done
  done
}

wait_for_ports_ready() {
  local timeout="${STARTUP_TIMEOUT_SECONDS:-45}"
  log "Waiting for API and frontend ..."
  for port in "${API_PORT}" "${FRONTEND_PORT}"; do
    local retries=0
    while :; do
      if command -v nc >/dev/null 2>&1; then
        if nc -z 127.0.0.1 "$port" 2>/dev/null; then
          log "Port ${port} is ready."
          break
        fi
      elif command -v lsof >/dev/null 2>&1; then
        if [ -n "$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t || true)" ]; then
          log "Port ${port} is listening."
          break
        fi
      fi
      sleep 1
      retries=$((retries + 1))
      if [ "$retries" -ge "$timeout" ]; then
        log "ERROR: Port ${port} was not ready within ${timeout}s."
        return 1
      fi
    done
  done
}

http_status() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true
    return
  fi

  node -e 'fetch(process.argv[1]).then((response) => process.stdout.write(String(response.status))).catch(() => process.stdout.write("000"))' "$url"
}

wait_for_http_status() {
  local label="$1"
  local url="$2"
  local timeout="${STARTUP_TIMEOUT_SECONDS:-45}"
  local retries=0
  local status

  while :; do
    status="$(http_status "$url")"
    case "$status" in
      2??|401|403)
        log "${label} is ready (${status})."
        return 0
        ;;
    esac

    sleep 1
    retries=$((retries + 1))
    if [ "$retries" -ge "$timeout" ]; then
      log "ERROR: ${label} did not become ready at ${url} (last status: ${status:-000})."
      return 1
    fi
  done
}

wait_for_stack_ready() {
  wait_for_ports_ready
  wait_for_http_status "API health" "http://127.0.0.1:${API_PORT}/api/health"
  if [ "${VITE_USE_API_PROXY:-true}" != "false" ]; then
    wait_for_http_status "Frontend API proxy" "http://127.0.0.1:${FRONTEND_PORT}/api/discover"
  fi
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local timeout="${3:-30}"
  local retries=0
  while :; do
    if command -v nc >/dev/null 2>&1; then
      if nc -z "${host}" "${port}" 2>/dev/null; then
        return 0
      fi
    elif (echo > /dev/tcp/"${host}"/"${port}") >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
    retries=$((retries + 1))
    if [ "${retries}" -ge "${timeout}" ]; then
      return 1
    fi
  done
}

ensure_local_mysql_or_fail() {
  if [[ "${CATALOG_PROVIDER:-sqlite}" != "mysql" && "${SEARCH_PROVIDER:-sqlite}" != "mysql" ]]; then
    return 0
  fi

  local mysql_host="${MYSQL_HOST:-127.0.0.1}"
  local mysql_port="${MYSQL_PORT:-3306}"
  if [[ "${mysql_host}" != "127.0.0.1" && "${mysql_host}" != "localhost" ]]; then
    log "MySQL is configured for remote host '${mysql_host}', skipping local stack startup."
    return 0
  fi

  if wait_for_port "${mysql_host}" "${mysql_port}" 30; then
    log "Local MySQL connectivity check passed."
    return 0
  fi

  log "MySQL is not reachable at ${mysql_host}:${mysql_port}; starting local stack..."
  if ! start_mysql_stack; then
    return 1
  fi

  if ! wait_for_port "${mysql_host}" "${mysql_port}" 60; then
    log "MySQL still not reachable at ${mysql_host}:${mysql_port} after stack startup."
    log "Start the MySQL stack manually with: bash scripts/development/start-mysql-stack.sh up"
    return 1
  fi

  log "Local MySQL connectivity check passed."
}

check_mysql_connectivity() {
  if [[ "${CATALOG_PROVIDER:-sqlite}" != "mysql" && "${SEARCH_PROVIDER:-sqlite}" != "mysql" ]]; then
    return 0
  fi

  local mysql_host="${MYSQL_HOST:-127.0.0.1}"
  local mysql_port="${MYSQL_PORT:-3306}"
  if [[ "${mysql_host}" != "127.0.0.1" && "${mysql_host}" != "localhost" ]]; then
    log "MySQL is configured for remote host '${mysql_host}', skipping local connectivity preflight."
    return 0
  fi

  if wait_for_port "${mysql_host}" "${mysql_port}" "${1:-30}"; then
    log "Local MySQL connectivity check passed."
    return 0
  fi
  log "MySQL is not reachable at ${mysql_host}:${mysql_port} after ${1:-30}s."
  return 1
}

start_mysql_stack() {
  local script="${SCRIPT_DIR}/start-mysql-stack.sh"
  if [ ! -x "$script" ]; then
    log "ERROR: ${script} is not executable."
    return 1
  fi

  log "Attempting to start local MySQL stack via: bash ${script} up"
  if ! bash "${script}" up; then
    log "ERROR: failed to start local MySQL stack."
    return 1
  fi

  return 0
}

stop_services() {
  stop_background_process_from_pidfile
  kill_named_processes
  kill_processes_on_ports
  cleanup_stale_ipc
  wait_for_ports_freed
  log "Stack stopped."
}

print_local_mysql_urls() {
  if [[ "${CATALOG_PROVIDER:-sqlite}" != "mysql" && "${SEARCH_PROVIDER:-sqlite}" != "mysql" ]]; then
    return 0
  fi

  local mysql_host="${MYSQL_HOST:-127.0.0.1}"
  local mysql_port="${MYSQL_PORT:-3306}"
  if [[ "${mysql_host}" != "127.0.0.1" && "${mysql_host}" != "localhost" ]]; then
    return 0
  fi

  log "MySQL: ${mysql_host}:${mysql_port}"
  log "phpMyAdmin: http://127.0.0.1:33308"
}

start_services() {
  local admin_ui_base_path="${ADMIN_UI_BASE_PATH:-/frontend/admin}"
  local stack_pid
  log "Starting project in ${PROJECT_ROOT}"
  log "Logs: ${LOG_FILE}"
  cd "$PROJECT_ROOT"
  stack_pid="$(env TMPDIR=/tmp FRONTEND_PORT="${FRONTEND_PORT}" API_PORT="${API_PORT}" node "${SCRIPT_DIR}/start-detached.mjs" "${LOG_FILE}" npm run dev)"
  if [ -z "$stack_pid" ]; then
    log "ERROR: Failed to start the detached development stack."
    return 1
  fi
  printf '%s\n' "$stack_pid" > "${PID_FILE}"
  log "Stack started (process group: ${stack_pid})."
  log "Frontend: http://localhost:${FRONTEND_PORT}"
  log "API: http://localhost:${API_PORT}"
  print_local_mysql_urls
  log "Admin login: http://localhost:${FRONTEND_PORT}${admin_ui_base_path}/login"
  log "Follow log: tail -f ${LOG_FILE}"
}

start_services_foreground() {
  local admin_ui_base_path="${ADMIN_UI_BASE_PATH:-/frontend/admin}"
  cd "$PROJECT_ROOT"
  printf '%s\n' "$$" > "${PID_FILE}"
  log "Starting stack in foreground mode (PID: $$)."
  log "Frontend: http://localhost:${FRONTEND_PORT}"
  log "API: http://localhost:${API_PORT}"
  log "Admin login: http://localhost:${FRONTEND_PORT}${admin_ui_base_path}/login"
  exec env TMPDIR=/tmp FRONTEND_PORT="${FRONTEND_PORT}" API_PORT="${API_PORT}" npm run dev
}

print_status() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && process_tree_is_running "$pid"; then
      log "Status: running (process group: ${pid})"
    else
      log "Status: PID file exists, but process is not active."
    fi
  else
    log "Status: not started"
  fi
}

check_data_dir() {
  local configured_dir="${DATA_DIR:-}"
  if [ -n "$configured_dir" ]; then
    if [[ "$configured_dir" == /var/www* ]]; then
      log "WARN: DATA_DIR points to a production path ($configured_dir), which is probably not locally writable."
      log "WARN: Set DATA_DIR to ./data for local operation, or ensure that $configured_dir is writable."
    fi
  fi
}

case "${1:-}" in
  stop)
    load_env
    refresh_runtime_ports
    stop_services
    exit 0
    ;;
  status)
    load_env
    refresh_runtime_ports
    print_status
    exit 0
    ;;
  foreground)
    load_env
    refresh_runtime_ports
    validate_local_runtime
    check_data_dir
    log "===== restart-all.sh foreground started ====="
    stop_services
    ensure_local_mysql_or_fail
    start_services_foreground
    ;;
  restart|""|start)
    load_env
    refresh_runtime_ports
    validate_local_runtime
    check_data_dir
    log "===== restart-all.sh started ====="
    stop_services
    sleep 1
    ensure_local_mysql_or_fail
    start_services
    wait_for_stack_ready
    if ! process_tree_is_running "$(cat "${PID_FILE}")"; then
      log "ERROR: The managed development process exited during startup."
      exit 1
    fi
    log "===== restart-all.sh finished ====="
    ;;
  *)
    echo "Unknown action: $1"
    echo "Usage: $0 [start|restart|foreground|stop|status]"
    exit 1
    ;;
esac
