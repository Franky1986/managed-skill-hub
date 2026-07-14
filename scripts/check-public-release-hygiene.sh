#!/usr/bin/env bash
set -euo pipefail

mkdir -p .tmp
LOG=.tmp/public-release-hygiene.log
: >"$LOG"

ERRORS=0
PASS_COUNT=0

record_pass() {
  echo "PASS $1" >>"$LOG"
  PASS_COUNT=$((PASS_COUNT + 1))
}

record_fail() {
  echo "FAIL $1" >>"$LOG"
  ERRORS=$((ERRORS + 1))
}

check_no_output() {
  local name="$1"
  shift
  local output
  output="$("$@" 2>/dev/null || true)"
  if [ -z "$output" ]; then
    record_pass "$name"
  else
    record_fail "$name"
    echo "$output" >>"$LOG"
  fi
}

repository_files() {
  git ls-files --cached --others --exclude-standard "$@"
}

public_repository_files() {
  repository_files README.md README_DE.md AGENTS.md .env.example .env.secrets.example 'docs/**' 'packages/**' 'apps/**' 'scripts/**' \
    | grep -v '^scripts/check-public-release-hygiene\.sh$' \
    | grep -v '^scripts/check-public-release-hygiene\.spec\.md$' \
    | grep -v '^docs/setup/.*INTERNAL.*\.md$'
}

for file in README.md README_DE.md LICENSE NOTICE CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md .env.example .env.secrets.example .gitignore; do
  if [ -f "$file" ]; then
    record_pass "required-file:$file"
  else
    record_fail "required-file:$file"
  fi
done

tracked_env="$(git ls-files | rg '(^|/)\.env$|(^|/)\.env\.secrets$|apps/api/\.env|apps/web/\.env' || true)"
if [ -z "$tracked_env" ]; then
  record_pass "no-tracked-runtime-env-files"
else
  record_fail "no-tracked-runtime-env-files"
  echo "$tracked_env" >>"$LOG"
fi

check_no_output "no-obvious-secret-values" rg -n --hidden 'sk-[A-Za-z0-9_-]{20,}|[A-Z0-9_]*TOKEN=[A-Za-z0-9_./+=-]{32,}' $(repository_files)
check_no_output "no-tracked-private-release-files" bash -c 'git ls-files \
  "apps/api/src/internal/**" \
  "apps/api/src/**/*private*" \
  "docs/setup/*INTERNAL*" \
  "scripts/call-*judger.sh" \
  "scripts/prepare-deploy.sh"'
check_no_output "no-tracked-ignored-files" git ls-files -ci --exclude-standard
check_no_output "no-public-provider-specific-custom-env" rg -n 'JUDGER_CUSTOM_(HOST|TOKEN|ALIAS|PROCEDURE|VERSION|ROUTE)' $(public_repository_files)
check_no_output "no-private-absolute-user-paths-in-docs" rg -n '/Users/frankrichter|/Users/[^/[:space:]]+/projects|/home/[^/[:space:]]+/projects' $(public_repository_files)
check_no_output "no-private-conversation-links" rg -n 'chatgpt\.com/c/' $(public_repository_files)

history_private_files="$({
  for revision in $(git rev-list --all); do
    git ls-tree -r --name-only "$revision" \
      | rg '^(apps/api/src/internal/|.*\.private\.[^/]+$|docs/setup/[^/]*INTERNAL[^/]*$|scripts/call-[^/]*judger\.sh$|scripts/prepare-deploy\.sh$)' \
      | sed "s#^#$revision:#"
  done
} || true)"
if [ -z "$history_private_files" ]; then
  record_pass "no-private-files-in-history"
else
  record_fail "no-private-files-in-history"
  echo "$history_private_files" >>"$LOG"
fi

history_private_references="$({
  for revision in $(git rev-list --all); do
    git grep -I -l -E 'JUDGER_CUSTOM_(HOST|TOKEN|ALIAS|PROCEDURE|VERSION|ROUTE)|chatgpt\.com/c/|/Users/[^/[:space:]]+/projects' "$revision" -- . \
      ':(exclude).gitignore' \
      ':(exclude)scripts/check-public-release-hygiene.sh' \
      ':(exclude)scripts/check-public-release-hygiene.spec.md' \
      | sed "s#^#$revision:#"
  done
} || true)"
if [ -z "$history_private_references" ]; then
  record_pass "no-private-references-in-history"
else
  record_fail "no-private-references-in-history"
  echo "$history_private_references" >>"$LOG"
fi

if git check-ignore -q --no-index scripts/prepare-deploy.sh; then
  record_pass "prepare-deploy-ignored"
else
  record_fail "prepare-deploy-ignored"
fi

if git check-ignore -q --no-index .env.example.private; then
  record_pass "private-env-example-ignored"
else
  record_fail "private-env-example-ignored"
fi

if git check-ignore -q --no-index scripts/call-*judger.sh; then
  record_pass "private-judger-helper-ignored"
else
  record_fail "private-judger-helper-ignored"
fi

if git check-ignore -q --no-index docs/setup/*INTERNAL*.md; then
  record_pass "private-judger-doc-ignored"
else
  record_fail "private-judger-doc-ignored"
fi

if git check-ignore -q --no-index apps/api/src/internal/adapter/*/*.judger.ts; then
  record_pass "private-adapter-ignored"
else
  record_fail "private-adapter-ignored"
fi

{
  echo "public-release-hygiene"
  echo "passedChecks=$PASS_COUNT"
  echo "failedChecks=$ERRORS"
  if [ "$ERRORS" -eq 0 ]; then
    echo "RESULT=PASS"
  else
    echo "RESULT=FAIL"
  fi
} | cat - "$LOG" > .tmp/public-release-hygiene.log.next
mv .tmp/public-release-hygiene.log.next "$LOG"

node -e 'const fs=require("fs"); const log=fs.readFileSync(".tmp/public-release-hygiene.log","utf8").trim().split(/\n/); const failures=log.filter(line=>line.startsWith("FAIL ")).map(line=>line.slice(5)); const passed=log.filter(line=>line.startsWith("PASS ")).length; fs.writeFileSync(".tmp/public-release-hygiene.json", JSON.stringify({name:"public-release-hygiene", passedChecks: passed, failedChecks: failures.length, failures}, null, 2)+"\n");'
cat "$LOG"

if [ "$ERRORS" -gt 0 ]; then
  exit 1
fi
