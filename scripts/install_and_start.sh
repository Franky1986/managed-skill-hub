#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ACTION="${1:-all}"

# shellcheck source=./load-env.sh
source "${SCRIPT_DIR}/load-env.sh"
load_managed_skill_hub_env "${PROJECT_ROOT}"

log_step() {
  echo "[$1] $2"
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "ERROR: required command is unavailable: ${command_name}" >&2
    exit 1
  fi
}

require_minimum_major() {
  local command_name="$1"
  local required_major="$2"
  local version major
  version="$("$command_name" --version)"
  major="${version#v}"
  major="${major%%.*}"
  if [[ ! "$major" =~ ^[0-9]+$ ]] || (( major < required_major )); then
    echo "ERROR: ${command_name} ${required_major}+ is required; found ${version}." >&2
    exit 1
  fi
}

resolve_data_dir() {
  local configured="${DATA_DIR:-./data}"
  if [[ "$configured" = /* ]]; then
    printf '%s\n' "$configured"
  else
    printf '%s\n' "${PROJECT_ROOT}/${configured#./}"
  fi
}

prepare_release() {
  local data_dir
  data_dir="$(resolve_data_dir)"

  log_step "1/3" "Checking runtime prerequisites and layered environment ..."
  require_command node
  require_command npm
  require_minimum_major node 20
  require_minimum_major npm 10

  if [[ ! -f "${PROJECT_ROOT}/package-lock.json" ]]; then
    echo "ERROR: package-lock.json is required for a reproducible deployment." >&2
    exit 1
  fi
  if [[ ! -f "${PROJECT_ROOT}/.env" ]]; then
    echo "ERROR: .env is missing." >&2
    exit 1
  fi
  if [[ ! -f "${MANAGED_SKILL_HUB_SECRETS_FILE:-${PROJECT_ROOT}/.env.secrets}" ]]; then
    echo "INFO: no secrets file is present; required secrets must be exported by the deployment environment."
  fi

  mkdir -p \
    "${data_dir}/skills" \
    "${data_dir}/proposals" \
    "${data_dir}/index" \
    "${data_dir}/audit" \
    "${data_dir}/backups" \
    "${data_dir}/uploads"
  log_step "1/3" "Prerequisites, environment, and data directories are ready."
  echo ""

  log_step "2/3" "Installing the locked dependency graph ..."
  (
    cd "$PROJECT_ROOT"
    npm ci --include=dev --legacy-peer-deps --no-audit --no-fund
  )
  log_step "2/3" "Locked dependencies installed."
  echo ""

  log_step "3/3" "Creating production build ..."
  (
    cd "$PROJECT_ROOT"
    npm run build:prod
  )
  log_step "3/3" "Production build successful."
}

start_release() {
  echo "[start] Starting stack ..."
  (
    cd "$PROJECT_ROOT"
    NODE_ENV=production \
    API_START_MODE=production \
    FRONTEND_START_MODE=preview \
    bash scripts/restart-server.sh
  )
  echo "[start] Stack is healthy."
}

case "$ACTION" in
  prepare)
    echo "============================================"
    echo " managed-skill-hub Install and Build"
    echo "============================================"
    echo ""
    prepare_release
    ;;
  start)
    echo "============================================"
    echo " managed-skill-hub Start"
    echo "============================================"
    echo ""
    start_release
    ;;
  all)
    echo "============================================"
    echo " managed-skill-hub Install, Build, and Start"
    echo "============================================"
    echo ""
    prepare_release
    echo ""
    start_release
    ;;
  *)
    echo "ERROR: unsupported action '${ACTION}'. Use prepare, start, or all." >&2
    exit 1
    ;;
esac

echo ""
echo "Done."
