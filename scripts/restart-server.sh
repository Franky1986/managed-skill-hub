#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/.tmp"
LOG_FILE="${LOG_DIR}/server.log"
PID_FILE="${LOG_DIR}/server.pid"
START_IN_BACKGROUND="${START_IN_BACKGROUND:-1}"
TMPDIR_TO_CLEAN="${TMPDIR:-/tmp} /private/tmp"

# shellcheck source=./load-env.sh
source "${SCRIPT_DIR}/load-env.sh"
load_managed_skill_hub_env "${PROJECT_ROOT}"

FRONTEND_PORT="${FRONTEND_PORT:-3041}"
API_PORT="${API_PORT:-3040}"
PORTS=("${FRONTEND_PORT}" "${API_PORT}")

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

kill_named_processes() {
  local patterns=("tsx watch src/server.ts" "node dist/server.js" "vite --port" "vite")
  for pattern in "${patterns[@]}"; do
    local pids
    pids="$(pgrep -f "$pattern" || true)"
    if [ -n "$pids" ]; then
      log "Stoppe Prozesse fuer '${pattern}': ${pids}"
      while IFS= read -r pid; do
        if [ -n "${pid:-}" ]; then
          kill -TERM "$pid" 2>/dev/null || true
        fi
      done <<< "$pids"
    fi
  done

  sleep 1

  for pattern in "${patterns[@]}"; do
    local pids
    pids="$(pgrep -f "$pattern" || true)"
    for pid in $pids; do
      if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
    done
  done
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
      log "Stoppe Listener auf Port ${port}: ${pids}"
      while IFS= read -r pid; do
        if [ -n "${pid:-}" ]; then
          kill -TERM "$pid" 2>/dev/null || true
        fi
      done <<< "$pids"
      sleep 1

      for pid in $pids; do
        if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
          kill -KILL "$pid" 2>/dev/null || true
        fi
      done
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

  if kill -0 "$pid" 2>/dev/null; then
    log "Stoppe Hintergrundprozess aus PID-Datei: ${pid}"
    kill -TERM "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
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

wait_for_ports() {
  local port retries
  local timeout=10

  for port in "${PORTS[@]}"; do
    retries=0
    while :; do
      if command -v lsof >/dev/null 2>&1 && [ -z "$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t || true)" ]; then
        break
      fi
      sleep 1
      retries=$((retries + 1))
      if [ "$retries" -ge "$timeout" ]; then
        log "Port ${port} did not become free within ${timeout}s."
        return 1
      fi
    done
  done
}

start_services() {
  log "Starting project in ${PROJECT_ROOT}"
  log "Logs: ${LOG_FILE}"
  cd "$PROJECT_ROOT"
  if [ "$START_IN_BACKGROUND" = "1" ]; then
    : > "${LOG_FILE}"
    nohup env TMPDIR=/tmp FRONTEND_PORT="${FRONTEND_PORT}" API_PORT="${API_PORT}" npm run dev >"${LOG_FILE}" 2>&1 < /dev/null &
    printf '%s\n' "$!" > "${PID_FILE}"
    log "Server started (PID: $(cat "${PID_FILE}")), running in the background."
    log "Frontend: http://localhost:${FRONTEND_PORT}"
    log "API: http://localhost:${API_PORT}"
    log "Follow log: tail -f ${LOG_FILE}"
    log "Stoppen mit: ./scripts/restart-server.sh stop"
  else
    log "Im Vordergrund starten..."
    TMPDIR=/tmp FRONTEND_PORT="${FRONTEND_PORT}" API_PORT="${API_PORT}" npm run dev
  fi
}

stop_services() {
  stop_background_process_from_pidfile
  kill_named_processes
  kill_processes_on_ports
  cleanup_stale_ipc
  wait_for_ports
  log "Stack stopped."
}

if [ "${1:-}" = "stop" ]; then
  stop_services
  exit 0
fi

log "===== Restart script started ====="
stop_services
sleep 1
wait_for_ports

start_services
