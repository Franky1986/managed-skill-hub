#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p .tmp

ERRORS=0

log_error() {
  echo "[ERROR] $1"
  ERRORS=$((ERRORS + 1))
}

log_info() {
  echo "[INFO] $1"
}

run_step() {
  local name="$1"
  local log_file="$2"
  shift 2
  log_info "Starting $name ..."
  if ! "$@" >"$log_file" 2>&1; then
    log_error "$name failed (see $log_file)"
  fi
}

run_step "baseline check" ".tmp/full-check-baseline.log" env RUN_MYSQL_FULL_CHECK=false ./scripts/check.sh
run_step "backup/restore proof" ".tmp/full-check-backup-restore.log" ./node_modules/.bin/tsx scripts/checks/check-backup-restore.ts

if [ "${RUN_SMOKE_TEST:-false}" = "true" ]; then
  run_step "API smoke test" ".tmp/full-check-smoke.log" bash scripts/development/smoke-test.sh
else
  log_info "Skipping API smoke test (set RUN_SMOKE_TEST=true to enable)."
fi

if [ "${RUN_MYSQL_FULL_CHECK:-false}" = "true" ]; then
  if [ "${SKIP_MYSQL_STACK_START:-false}" = "true" ]; then
    log_info "Using pre-provisioned MySQL; skipping local stack startup."
  else
    run_step "MySQL stack startup" ".tmp/full-check-mysql-stack.log" bash scripts/development/start-mysql-stack.sh up
  fi
  if [ -x scripts/checks/check-provider-matrix.ts ]; then
    run_step "provider matrix" ".tmp/full-check-provider-matrix.log" env PROVIDER_MATRIX_INCLUDE_MYSQL=true ./node_modules/.bin/tsx scripts/checks/check-provider-matrix.ts
  else
    log_error "Provider matrix script is required by EPIC-008 but missing."
  fi
  if [ -x scripts/checks/check-provider-cutover.ts ]; then
    run_step "provider cutover" ".tmp/full-check-provider-cutover.log" ./node_modules/.bin/tsx scripts/checks/check-provider-cutover.ts
  else
    log_error "Provider cutover script is required by EPIC-008 but missing."
  fi

  if [ -x scripts/checks/check-content-storage-matrix.ts ]; then
    run_step "content storage matrix" ".tmp/full-check-content-storage-matrix.log" env CONTENT_STORAGE_MATRIX_INCLUDE_MYSQL=true ./node_modules/.bin/tsx scripts/checks/check-content-storage-matrix.ts
  else
    log_error "Content storage matrix script is required by EPIC-009 but missing."
  fi
else
  log_info "Skipping MySQL full checks (set RUN_MYSQL_FULL_CHECK=true to enable)."
fi

if [ "${RUN_AUTHENTIK_STAGING_CHECK:-false}" = "true" ]; then
  run_step "real Authentik staging gate" ".tmp/full-check-authentik-staging.log" ./node_modules/.bin/tsx scripts/checks/check-authentik-staging.ts
else
  log_info "Skipping real Authentik staging gate (set RUN_AUTHENTIK_STAGING_CHECK=true with a staging profile, token, and evidence file to enable)."
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "[FAIL] $ERRORS full-check errors found."
  exit 1
fi

echo "[OK] Full check completed for implemented gates. Optional MySQL and real Authentik gates are controlled by RUN_MYSQL_FULL_CHECK=true and RUN_AUTHENTIK_STAGING_CHECK=true."
