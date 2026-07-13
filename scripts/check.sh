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

# Check central documents.
for file in README.md AGENTS.md .env.example; do
  if [[ ! -f "$file" ]]; then
    log_error "Missing: $file"
  fi
done

# Check documentation structure.
for dir in docs/architecture docs/decisions docs/howTo docs/product docs/progress docs/roadmap docs/setup; do
  if [[ ! -d "$dir" ]]; then
    log_error "Missing directory: $dir"
  fi
done

# Check required baseline documents.
for file in \
  docs/roadmap/MASTER_PLAN.md \
  docs/progress/CURRENT_STATUS.md \
  docs/progress/NEXT_STEPS.md \
  docs/progress/CHANGELOG_INTERNAL.md \
  docs/architecture/SYSTEM_OVERVIEW.md \
  docs/decisions/ADR-001-architecture-and-stack.md \
  docs/decisions/ADR-002-spec-driven-development.md \
  docs/decisions/ADR-003-simple-admin-auth.md \
  docs/decisions/ADR-004-deployment-and-backup.md \
  docs/decisions/ADR-005-filebased-storage.md \
  docs/decisions/ADR-006-proposals-and-judgements.md \
  docs/decisions/ADR-007-no-namespace-groups.md \
  docs/decisions/ADR-008-search-strategy.md \
  docs/decisions/ADR-009-llm-judger-port.md \
  docs/decisions/ADR-010-large-file-upload.md \
  docs/decisions/ADR-011-skill-id-rules.md \
  docs/decisions/ADR-012-content-extraction-strategy.md \
  docs/decisions/ADR-013-sqlite-metadata-truth.md \
  docs/decisions/ADR-014-database-backed-content-storage.md \
  docs/setup/BUILD_AND_CHECKS.md \
  docs/setup/DEPLOYMENT.md \
  docs/setup/BACKUP_AND_RESTORE.md \
  docs/setup/ENVIRONMENT.md \
  docs/setup/NGINX.md \
  docs/setup/NPM_VERIFICATION.md \
  docs/setup/DEPENDENCY_UPDATE_LOG.md \
  docs/architecture/SKILL_ID_RULES.md \
  docs/architecture/GROUPS.md \
  docs/architecture/SUPPORTED_FILE_TYPES.md \
  docs/index.md
do
  if [[ ! -f "$file" ]]; then
    log_error "Missing: $file"
  fi
done

# Count .spec.md files, excluding node_modules and .tmp.
SPEC_COUNT=$(find . \
  -type d \( -name node_modules -o -name .tmp -o -name dist \) -prune \
  -o -type f -name '*.spec.md' -print \
  | wc -l)
log_info "Found .spec.md files: $SPEC_COUNT"

# Check important scripts.
for script in \
  scripts/prepare-deploy.sh \
  scripts/install_and_start.sh \
  scripts/restart-server.sh \
  scripts/restart-all.sh \
  scripts/backup.sh \
  scripts/restore.sh \
  scripts/check-agent-auth-matrix.ts \
  scripts/check-authentik-staging.ts \
  scripts/check-oidc-provider.ts \
  scripts/check-agent-contract.ts \
  scripts/check-admin-ui-smoke.ts \
  scripts/check-openapi-parity.ts \
  scripts/check-provider-matrix.ts \
  scripts/check-content-storage-matrix.ts \
  scripts/check-content-migration.ts \
  scripts/export-content-filesystem.ts \
  scripts/check-content-export.ts \
  scripts/check-provider-cutover.ts \
  scripts/check-public-release-hygiene.sh \
  scripts/check-judger-autopublish-matrix.ts \
  scripts/check-skill-package-downloads.ts \
  scripts/check-concurrency-abuse.ts \
  scripts/check-proposal-lifecycle.ts \
  scripts/check-backup-restore.ts \
  scripts/check-observability-audit.ts \
  scripts/full-check.sh; do
  if [[ ! -x "$script" ]]; then
    log_error "Not executable or missing: $script"
  fi
done

# Check build tooling configuration files.
for file in apps/api/vitest.config.ts apps/web/vitest.config.ts apps/web/vite.config.ts; do
  if [[ ! -f "$file" ]]; then
    log_error "Missing: $file"
  fi
done

# Run lint, typecheck, and tests.
log_info "Starting lint ..."
if ! npm run lint >".tmp/lint.log" 2>&1; then
  log_error "npm run lint failed (see .tmp/lint.log)"
fi

log_info "Starting typecheck ..."
if ! npm run typecheck >".tmp/typecheck.log" 2>&1; then
  log_error "npm run typecheck failed (see .tmp/typecheck.log)"
fi
if ! npx tsc -p apps/web/tsconfig.test.json >".tmp/typecheck-tests.log" 2>&1; then
  log_error "Web test typecheck failed (see .tmp/typecheck-tests.log)"
fi

log_info "Starting tests ..."
if ! npm run test >".tmp/test.log" 2>&1; then
  log_error "npm run test failed (see .tmp/test.log)"
fi

log_info "Starting agent auth matrix ..."
if ! ./node_modules/.bin/tsx scripts/check-agent-auth-matrix.ts >".tmp/agent-auth-matrix.check.log" 2>&1; then
  log_error "Agent auth matrix failed (see .tmp/agent-auth-matrix.check.log and .tmp/agent-auth-matrix.log)"
fi

log_info "Starting deterministic OIDC provider proof ..."
if ! ./node_modules/.bin/tsx scripts/check-oidc-provider.ts >".tmp/oidc-provider.check.log" 2>&1; then
  log_error "OIDC provider proof failed (see .tmp/oidc-provider.check.log and .tmp/oidc-provider.log)"
fi

log_info "Starting judger auto-publish matrix ..."
if ! ./node_modules/.bin/tsx scripts/check-judger-autopublish-matrix.ts >".tmp/judger-autopublish-matrix.check.log" 2>&1; then
  log_error "Judger auto-publish matrix failed (see .tmp/judger-autopublish-matrix.check.log and .tmp/judger-autopublish-matrix.log)"
fi

log_info "Starting agent contract proof ..."
if ! ./node_modules/.bin/tsx scripts/check-agent-contract.ts >".tmp/agent-contract.check.log" 2>&1; then
  log_error "Agent contract proof failed (see .tmp/agent-contract.check.log and .tmp/agent-contract.log)"
fi

log_info "Starting admin UI smoke proof ..."
if ! ./node_modules/.bin/tsx scripts/check-admin-ui-smoke.ts >".tmp/admin-ui-smoke.check.log" 2>&1; then
  log_error "Admin UI smoke proof failed (see .tmp/admin-ui-smoke.check.log and .tmp/admin-ui-smoke.log)"
fi

log_info "Starting OpenAPI parity proof ..."
if ! ./node_modules/.bin/tsx scripts/check-openapi-parity.ts >".tmp/openapi-parity.check.log" 2>&1; then
  log_error "OpenAPI parity proof failed (see .tmp/openapi-parity.check.log and .tmp/openapi-parity.log)"
fi

log_info "Starting provider matrix proof ..."
if ! ./node_modules/.bin/tsx scripts/check-provider-matrix.ts >".tmp/provider-matrix.check.log" 2>&1; then
  log_error "Provider matrix proof failed (see .tmp/provider-matrix.check.log and .tmp/provider-matrix.log)"
fi

log_info "Starting content storage matrix proof ..."
if ! ./node_modules/.bin/tsx scripts/check-content-storage-matrix.ts >".tmp/content-storage-matrix.check.log" 2>&1; then
  log_error "Content storage matrix proof failed (see .tmp/content-storage-matrix.check.log and .tmp/content-storage-matrix.log)"
fi

log_info "Starting content migration proof ..."
if ! ./node_modules/.bin/tsx scripts/check-content-migration.ts >".tmp/content-migration.check.log" 2>&1; then
  log_error "Content migration proof failed (see .tmp/content-migration.check.log and .tmp/content-migration.log)"
fi

log_info "Starting content export proof ..."
if ! ./node_modules/.bin/tsx scripts/check-content-export.ts >".tmp/content-export.check.log" 2>&1; then
  log_error "Content export proof failed (see .tmp/content-export.check.log and .tmp/content-export.log)"
fi

log_info "Starting skill package downloads proof ..."
if ! ./node_modules/.bin/tsx scripts/check-skill-package-downloads.ts >".tmp/skill-package-downloads.check.log" 2>&1; then
  log_error "Skill package downloads proof failed (see .tmp/skill-package-downloads.check.log and .tmp/skill-package-downloads.log)"
fi

log_info "Starting proposal lifecycle proof ..."
if ! ./node_modules/.bin/tsx scripts/check-proposal-lifecycle.ts >".tmp/proposal-lifecycle.check.log" 2>&1; then
  log_error "Proposal lifecycle proof failed (see .tmp/proposal-lifecycle.check.log and .tmp/proposal-lifecycle.log)"
fi

log_info "Starting observability and audit proof ..."
if ! ./node_modules/.bin/tsx scripts/check-observability-audit.ts >".tmp/observability-audit.check.log" 2>&1; then
  log_error "Observability and audit proof failed (see .tmp/observability-audit.check.log and .tmp/observability-audit.log)"
fi

log_info "Starting concurrency and abuse proof ..."
if ! ./node_modules/.bin/tsx scripts/check-concurrency-abuse.ts >".tmp/concurrency-abuse.check.log" 2>&1; then
  log_error "Concurrency and abuse proof failed (see .tmp/concurrency-abuse.check.log and .tmp/concurrency-abuse.log)"
fi

log_info "Starting public release hygiene proof ..."
if ! bash scripts/check-public-release-hygiene.sh >".tmp/public-release-hygiene.check.log" 2>&1; then
  log_error "Public release hygiene proof failed (see .tmp/public-release-hygiene.check.log and .tmp/public-release-hygiene.log)"
fi

if [[ $ERRORS -gt 0 ]]; then
  echo "[FAIL] $ERRORS errors found."
  exit 1
fi

echo "[OK] Project structure, documents, specs, scripts, lint, typecheck, and tests are healthy."
