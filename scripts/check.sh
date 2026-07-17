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
for file in README.md AGENTS.md .env.example .env.secrets.example; do
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

# Keep tracked implementations out of the script root. Ignored operator-local
# helpers are intentionally outside this public repository contract.
while IFS= read -r root_script; do
  [[ -e "$root_script" ]] || continue
  case "$root_script" in
    scripts/README.md|scripts/check.sh|scripts/full-check.sh|scripts/full-check.spec.md|scripts/tsconfig.json)
      ;;
    *)
      log_error "Tracked script must be placed in a responsibility directory: $root_script"
      ;;
  esac
done < <(git ls-files --cached --others --exclude-standard 'scripts/*' | awk -F/ 'NF == 2')

# Check important scripts.
for script in \
  scripts/deployment/prepare-release.sh \
  scripts/deployment/service.sh \
  scripts/deployment/upload.sh \
  scripts/deployment/create-deploy-archive.sh \
  scripts/security/generate-admin-password-hash.sh \
  scripts/deployment/install_and_start.sh \
  scripts/deployment/restart-server.sh \
  scripts/development/restart-all.sh \
  scripts/development/smoke-test.sh \
  scripts/development/start-mysql-stack.sh \
  scripts/content/migrate-content-to-database.ts \
  scripts/content/migrate-env-layout.ts \
  scripts/operations/backup.sh \
  scripts/operations/restore.sh \
  scripts/lib/load-env.sh \
  scripts/lib/run-with-env.sh \
  scripts/checks/check-agent-auth-matrix.ts \
  scripts/checks/check-authentik-staging.ts \
  scripts/checks/check-oidc-provider.ts \
  scripts/checks/check-agent-contract.ts \
  scripts/checks/check-admin-ui-smoke.ts \
  scripts/checks/check-openapi-parity.ts \
  scripts/checks/check-provider-matrix.ts \
  scripts/checks/check-content-storage-matrix.ts \
  scripts/checks/check-content-migration.ts \
  scripts/content/export-content-filesystem.ts \
  scripts/checks/check-content-export.ts \
  scripts/checks/check-provider-cutover.ts \
  scripts/checks/check-deployment-blueprint.sh \
  scripts/checks/check-pinned-package-versions.mjs \
  scripts/checks/check-public-release-hygiene.sh \
  scripts/checks/check-judger-autopublish-matrix.ts \
  scripts/checks/check-skill-package-downloads.ts \
  scripts/checks/check-concurrency-abuse.ts \
  scripts/checks/check-proposal-lifecycle.ts \
  scripts/checks/check-backup-restore.ts \
  scripts/checks/check-observability-audit.ts \
  scripts/full-check.sh; do
  if [[ ! -x "$script" ]]; then
    log_error "Not executable or missing: $script"
  fi
done

# Check deterministic dependency declarations before running package tooling.
log_info "Checking pinned package versions ..."
if ! node scripts/checks/check-pinned-package-versions.mjs >".tmp/pinned-package-versions.check.log" 2>&1; then
  log_error "Pinned package version check failed (see .tmp/pinned-package-versions.check.log)"
fi

log_info "Starting generic deployment blueprint proof ..."
if ! bash scripts/checks/check-deployment-blueprint.sh >".tmp/deployment-blueprint.check.log" 2>&1; then
  log_error "Deployment blueprint proof failed (see .tmp/deployment-blueprint.check.log)"
fi

# Check build tooling configuration files.
for file in apps/api/vitest.config.ts apps/api/tsconfig.agent-contract-tests.json apps/web/vitest.config.ts apps/web/vite.config.ts apps/web/tsconfig.test.json scripts/tsconfig.json; do
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
if ! npx tsc -p apps/api/tsconfig.agent-contract-tests.json >".tmp/typecheck-api-agent-contract-tests.log" 2>&1; then
  log_error "API agent-contract test typecheck failed (see .tmp/typecheck-api-agent-contract-tests.log)"
fi
if ! npx tsc -p apps/web/tsconfig.test.json >".tmp/typecheck-web-tests.log" 2>&1; then
  log_error "Web test typecheck failed (see .tmp/typecheck-web-tests.log)"
fi

log_info "Starting tests ..."
if ! npm run test >".tmp/test.log" 2>&1; then
  log_error "npm run test failed (see .tmp/test.log)"
fi

log_info "Starting agent auth matrix ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-agent-auth-matrix.ts >".tmp/agent-auth-matrix.check.log" 2>&1; then
  log_error "Agent auth matrix failed (see .tmp/agent-auth-matrix.check.log and .tmp/agent-auth-matrix.log)"
fi

log_info "Starting deterministic OIDC provider proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-oidc-provider.ts >".tmp/oidc-provider.check.log" 2>&1; then
  log_error "OIDC provider proof failed (see .tmp/oidc-provider.check.log and .tmp/oidc-provider.log)"
fi

log_info "Starting judger auto-publish matrix ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-judger-autopublish-matrix.ts >".tmp/judger-autopublish-matrix.check.log" 2>&1; then
  log_error "Judger auto-publish matrix failed (see .tmp/judger-autopublish-matrix.check.log and .tmp/judger-autopublish-matrix.log)"
fi

log_info "Starting agent contract proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-agent-contract.ts >".tmp/agent-contract.check.log" 2>&1; then
  log_error "Agent contract proof failed (see .tmp/agent-contract.check.log and .tmp/agent-contract.log)"
fi

log_info "Starting admin UI smoke proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-admin-ui-smoke.ts >".tmp/admin-ui-smoke.check.log" 2>&1; then
  log_error "Admin UI smoke proof failed (see .tmp/admin-ui-smoke.check.log and .tmp/admin-ui-smoke.log)"
fi

log_info "Starting OpenAPI parity proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-openapi-parity.ts >".tmp/openapi-parity.check.log" 2>&1; then
  log_error "OpenAPI parity proof failed (see .tmp/openapi-parity.check.log and .tmp/openapi-parity.log)"
fi

log_info "Starting provider matrix proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-provider-matrix.ts >".tmp/provider-matrix.check.log" 2>&1; then
  log_error "Provider matrix proof failed (see .tmp/provider-matrix.check.log and .tmp/provider-matrix.log)"
fi

log_info "Starting content storage matrix proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-content-storage-matrix.ts >".tmp/content-storage-matrix.check.log" 2>&1; then
  log_error "Content storage matrix proof failed (see .tmp/content-storage-matrix.check.log and .tmp/content-storage-matrix.log)"
fi

log_info "Starting content migration proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-content-migration.ts >".tmp/content-migration.check.log" 2>&1; then
  log_error "Content migration proof failed (see .tmp/content-migration.check.log and .tmp/content-migration.log)"
fi

log_info "Starting content export proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-content-export.ts >".tmp/content-export.check.log" 2>&1; then
  log_error "Content export proof failed (see .tmp/content-export.check.log and .tmp/content-export.log)"
fi

log_info "Starting skill package downloads proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-skill-package-downloads.ts >".tmp/skill-package-downloads.check.log" 2>&1; then
  log_error "Skill package downloads proof failed (see .tmp/skill-package-downloads.check.log and .tmp/skill-package-downloads.log)"
fi

log_info "Starting proposal lifecycle proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-proposal-lifecycle.ts >".tmp/proposal-lifecycle.check.log" 2>&1; then
  log_error "Proposal lifecycle proof failed (see .tmp/proposal-lifecycle.check.log and .tmp/proposal-lifecycle.log)"
fi

log_info "Starting observability and audit proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-observability-audit.ts >".tmp/observability-audit.check.log" 2>&1; then
  log_error "Observability and audit proof failed (see .tmp/observability-audit.check.log and .tmp/observability-audit.log)"
fi

log_info "Starting concurrency and abuse proof ..."
if ! ./node_modules/.bin/tsx scripts/checks/check-concurrency-abuse.ts >".tmp/concurrency-abuse.check.log" 2>&1; then
  log_error "Concurrency and abuse proof failed (see .tmp/concurrency-abuse.check.log and .tmp/concurrency-abuse.log)"
fi

log_info "Starting public release hygiene proof ..."
if ! bash scripts/checks/check-public-release-hygiene.sh >".tmp/public-release-hygiene.check.log" 2>&1; then
  log_error "Public release hygiene proof failed (see .tmp/public-release-hygiene.check.log and .tmp/public-release-hygiene.log)"
fi

if [[ $ERRORS -gt 0 ]]; then
  echo "[FAIL] $ERRORS errors found."
  exit 1
fi

echo "[OK] Project structure, documents, specs, scripts, lint, typecheck, and tests are healthy."
