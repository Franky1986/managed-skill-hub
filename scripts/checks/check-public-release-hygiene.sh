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

# Check that every file matching a glob is ignored by git.
check_ignored_glob() {
  local name="$1"
  local pattern="$2"
  local files
  files=$(ls $pattern 2>/dev/null || true)
  if [ -z "$files" ]; then
    # No files to check: the ignore rule is vacuously satisfied for this pattern.
    record_pass "$name"
    return
  fi
  local all_ignored=true
  while IFS= read -r file; do
    if [ -z "$file" ]; then
      continue
    fi
    if ! git check-ignore -q --no-index "$file"; then
      all_ignored=false
      echo "$file" >>"$LOG"
    fi
  done <<<"$files"
  if $all_ignored; then
    record_pass "$name"
  else
    record_fail "$name"
  fi
}

repository_files() {
  git ls-files --cached --others --exclude-standard "$@"
}

public_repository_files() {
  repository_files README.md README_de.md AGENTS.md .env.example .env.secrets.example 'docs/**' 'packages/**' 'apps/**' 'scripts/**' \
    | grep -v '^scripts/checks/check-public-release-hygiene\.sh$' \
    | grep -v '^scripts/checks/check-public-release-hygiene\.spec\.md$' \
    | grep -v '^docs/setup/.*INTERNAL.*\.md$'
}

check_private_denylist() {
  local denylist_file="${PUBLIC_RELEASE_DENYLIST_FILE:-.public-release-denylist}"
  local strict_mode="${PUBLIC_RELEASE_STRICT:-false}"

  if [ ! -f "$denylist_file" ]; then
    if [ "$strict_mode" = "1" ] || [ "$strict_mode" = "true" ]; then
      record_fail "private-denylist-present-in-strict-mode"
    else
      record_pass "private-denylist-optional-in-nonstrict-mode"
    fi
    return
  fi

  record_pass "private-denylist-present"

  local pattern
  local revision
  local file
  local pattern_count=0
  local current_match=false
  local history_match=false

  while IFS= read -r pattern || [ -n "$pattern" ]; do
    pattern="${pattern%$'\r'}"
    case "$pattern" in
      ''|'#'*) continue ;;
    esac

    pattern_count=$((pattern_count + 1))

    if git grep -I -q -i -E "$pattern" -- .; then
      current_match=true
    fi

    while IFS= read -r file; do
      if rg -I -q -i -e "$pattern" -- "$file" 2>/dev/null; then
        current_match=true
      fi
    done < <(git ls-files --others --exclude-standard)

    for revision in $(git rev-list --all); do
      if git grep -I -q -i -E "$pattern" "$revision" -- .; then
        history_match=true
        break
      fi
    done
  done <"$denylist_file"

  if [ "$pattern_count" -eq 0 ]; then
    record_fail "private-denylist-has-patterns"
    return
  fi
  record_pass "private-denylist-has-patterns"

  if $current_match; then
    record_fail "no-private-denylist-matches-current"
  else
    record_pass "no-private-denylist-matches-current"
  fi

  if $history_match; then
    record_fail "no-private-denylist-matches-history"
  else
    record_pass "no-private-denylist-matches-history"
  fi
}

for file in README.md README_de.md LICENSE NOTICE CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md .env.example .env.secrets.example .gitignore scripts/deployment/create-deploy-archive.sh; do
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

strict_mode="${PUBLIC_RELEASE_STRICT:-false}"
untracked_release_files="$(git ls-files --others --exclude-standard)"
if [ "$strict_mode" = "1" ] || [ "$strict_mode" = "true" ]; then
  if [ -z "$untracked_release_files" ]; then
    record_pass "no-untracked-release-files-in-strict-mode"
  else
    record_fail "no-untracked-release-files-in-strict-mode"
    echo "$untracked_release_files" >>"$LOG"
  fi
else
  record_pass "untracked-release-files-allowed-in-nonstrict-mode"
fi

check_no_output "no-public-provider-specific-custom-env" rg -n 'JUDGER_CUSTOM_(HOST|TOKEN|ALIAS|PROCEDURE|VERSION|ROUTE)' $(public_repository_files)
check_no_output "no-public-internal-adapter-paths" rg -n -i 'JUDGER_ADAPTER_PATH[[:space:]]*=[^[:space:]]*internal/adapter|apps/api/src/internal/adapter/' $(public_repository_files)
check_no_output "no-private-absolute-user-paths-in-docs" rg -n '/Users/frankrichter|/Users/[^/[:space:]]+/projects|/home/[^/[:space:]]+/projects' $(public_repository_files)
check_no_output "no-private-conversation-links" rg -n 'chatgpt\.com/c/' $(public_repository_files)
check_private_denylist

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
    git grep -I -l -E 'JUDGER_CUSTOM_(HOST|TOKEN|ALIAS|PROCEDURE|VERSION|ROUTE)|JUDGER_ADAPTER_PATH[[:space:]]*=[^[:space:]]*internal/adapter|apps/api/src/internal/adapter/|chatgpt\.com/c/|/Users/[^/[:space:]]+/projects' "$revision" -- . \
      ':(exclude).gitignore' \
      ':(exclude)scripts/check-public-release-hygiene.sh' \
      ':(exclude)scripts/check-public-release-hygiene.spec.md' \
      ':(exclude)scripts/checks/check-public-release-hygiene.sh' \
      ':(exclude)scripts/checks/check-public-release-hygiene.spec.md' \
      | sed "s#^#$revision:#"
  done
} || true)"
if [ -z "$history_private_references" ]; then
  record_pass "no-private-references-in-history"
else
  record_fail "no-private-references-in-history"
  echo "$history_private_references" >>"$LOG"
fi

check_ignored_glob "prepare-deploy-ignored" "scripts/prepare-deploy.sh"
check_ignored_glob "private-env-example-ignored" ".env.example.private"
check_ignored_glob "private-release-denylist-ignored" ".public-release-denylist"
check_ignored_glob "private-judger-helper-ignored" "scripts/call-*judger.sh"
check_ignored_glob "private-judger-doc-ignored" "docs/setup/*INTERNAL*.md"
check_ignored_glob "private-adapter-ignored" "apps/api/src/internal/adapter/*/*.judger.ts"

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
