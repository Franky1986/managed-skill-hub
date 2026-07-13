#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [ -f ".env" ]; then
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
fi

API_URL="${API_URL:-http://localhost:3040}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
COOKIE_JAR="${PROJECT_ROOT}/.tmp/smoke-test-cookies.txt"
EXPECT_REAL_JUDGER="${EXPECT_REAL_JUDGER:-false}"
ERRORS=0

cd "$PROJECT_ROOT"

log_error() {
  echo "[ERROR] $1"
  ERRORS=$((ERRORS + 1))
}

log_info() {
  echo "[INFO] $1"
}

# Build production bundle.
log_info "Starting production build..."
npm run build:prod >".tmp/smoke-build.log" 2>&1
log_info "Production build OK."

# Ensure .env exists with admin credentials
if [ ! -f ".env" ]; then
  log_error ".env is missing. Create it first (see docs/setup/TESTING.md)."
  exit 1
fi

if ! grep -Eq "^ADMIN_PASSWORD=|^ADMIN_PASSWORD_HASH=" ".env"; then
  log_error "Neither ADMIN_PASSWORD nor ADMIN_PASSWORD_HASH is set in .env."
  exit 1
fi

# Start server in background
log_info "Starting API in the background..."
rm -f "$COOKIE_JAR"
mkdir -p "$(dirname "$COOKIE_JAR")"
DATA_DIR="${DATA_DIR:-./data}"
# DATA_DIR is resolved against the repository root, so ./data points to the project-root data directory.
env DATA_DIR="$DATA_DIR" nohup node apps/api/dist/server.js > .tmp/smoke-server.log 2>&1 &
echo $! > .tmp/smoke-server.pid

# Wait for server
log_info "Waiting for API..."
for i in {1..30}; do
  if curl -s "$API_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -s "$API_URL/api/health" >/dev/null 2>&1; then
  log_error "API is not reachable."
  cat .tmp/smoke-server.log
  exit 1
fi
log_info "API is reachable."

# Helper functions
http_status() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

http_body() {
  curl -s "$@"
}

post_json() {
  curl -s -X POST -H "Content-Type: application/json" -d "$2" "$1"
}

post_json_with_cookie() {
  curl -s -X POST -H "Content-Type: application/json" -b "$COOKIE_JAR" -c "$COOKIE_JAR" -d "$2" "$1"
}

get_with_cookie() {
  curl -s -b "$COOKIE_JAR" "$1"
}

post_with_cookie() {
  curl -s -X POST -b "$COOKIE_JAR" "$1"
}

# Test 1: Healthcheck
log_info "Testing healthcheck..."
if [ "$(http_status "$API_URL/api/health")" != "200" ]; then
  log_error "Healthcheck failed"
fi

# Test 2: Discovery
log_info "Testing /discover..."
if [ "$(http_status "$API_URL/discover")" != "200" ]; then
  log_error "/discover failed"
fi

# Test 3: Public skill list
log_info "Testing /skills (public)..."
if [ "$(http_status "$API_URL/skills")" != "200" ]; then
  log_error "/skills failed"
fi

# Test 4: Read example skill (if present in the dataset)
log_info "Testing /skills/how-to-create-a-skill..."
EXAMPLE_SKILL_STATUS="$(http_status "$API_URL/skills/how-to-create-a-skill")"
if [ "$EXAMPLE_SKILL_STATUS" != "200" ] && [ "$EXAMPLE_SKILL_STATUS" != "404" ]; then
  log_error "Example skill endpoint returned unexpected status"
fi

# Test 5: Search
log_info "Testing /skills/search..."
if [ "$(http_status "$API_URL/skills/search?q=skill")" != "200" ]; then
  log_error "/skills/search failed"
fi

# Test 6: Admin login
log_info "Testing admin login..."
LOGIN_STATUS="$(http_status -X POST "$API_URL/admin/login" -H "Content-Type: application/json" -c "$COOKIE_JAR" -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASSWORD\"}")"
if [ "$LOGIN_STATUS" != "200" ]; then
  log_error "Admin login failed (HTTP $LOGIN_STATUS). Check ADMIN_PASSWORD or ADMIN_PASSWORD_HASH in .env."
fi

# Test 7: Create skill via admin
log_info "Testing admin skill creation..."
SKILL_ID="smoke-test-skill-$(date +%s%N)"
CREATE_STATUS="$(http_status -X POST "$API_URL/admin/skills" -H "Content-Type: application/json" -b "$COOKIE_JAR" -d "{\"id\":\"${SKILL_ID}\",\"title\":\"Smoke Test Skill\",\"description\":\"Created by smoke-test\",\"entrypoint\":\"README.md\",\"version\":\"1.0.0\",\"category\":\"media\",\"groups\":[\"test\"],\"capabilities\":[\"smoke\"]}")"
if [ "$CREATE_STATUS" != "201" ]; then
  log_error "Admin skill creation failed (HTTP $CREATE_STATUS)"
fi

# Test 8: Submit proposal
log_info "Testing proposal upload..."
PROPOSAL_RESPONSE="$(post_json "$API_URL/proposals" '{"title":"Smoke Proposal","description":"A smoke test proposal","category":"media","groups":["test"]}')"
PROPOSAL_ID="$(echo "$PROPOSAL_RESPONSE" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [ -z "$PROPOSAL_ID" ]; then
  log_error "Proposal could not be created"
  echo "$PROPOSAL_RESPONSE"
else
  log_info "Proposal created: $PROPOSAL_ID"
fi

# Test 9: Attach file to proposal
if [ -n "$PROPOSAL_ID" ]; then
  log_info "Testing proposal file upload..."
  echo "# Smoke Test File" > .tmp/smoke-file.md
  FILE_STATUS="$(http_status -X POST "$API_URL/proposals/$PROPOSAL_ID/files" -H "X-Actor: smoke-test" -F "file=@.tmp/smoke-file.md;filename=README.md")"
  if [ "$FILE_STATUS" != "200" ]; then
    log_error "File upload failed (HTTP $FILE_STATUS)"
  fi
fi

# Test 10: Optional real judger verification
if [ -n "$PROPOSAL_ID" ] && [ "$EXPECT_REAL_JUDGER" = "true" ]; then
  log_info "Testing real custom judger judger..."
  PROPOSAL_DETAIL="$(get_with_cookie "$API_URL/admin/proposals/$PROPOSAL_ID")"
  JUDGEMENT_COUNT="$(echo "$PROPOSAL_DETAIL" | jq '.judgements | length' 2>/dev/null || echo 0)"
  if [ "$JUDGEMENT_COUNT" -lt 1 ]; then
    log_error "Real judger expected, but proposal contains no judgements"
    echo "$PROPOSAL_DETAIL"
  fi

  PROPOSAL_JUDGEMENTS="$(http_body "$API_URL/admin/judgements/proposal/$PROPOSAL_ID")"
  PROPOSAL_JUDGEMENT_COUNT="$(echo "$PROPOSAL_JUDGEMENTS" | jq '.items | length' 2>/dev/null || echo 0)"
  if [ "$PROPOSAL_JUDGEMENT_COUNT" -lt 1 ]; then
    log_error "Real judger expected, but /judgements/proposal returns no entries"
    echo "$PROPOSAL_JUDGEMENTS"
  fi
fi

# Stop server
log_info "Stopping API..."
if [ -f .tmp/smoke-server.pid ]; then
  kill "$(cat .tmp/smoke-server.pid)" 2>/dev/null || true
  rm -f .tmp/smoke-server.pid
fi

if [[ $ERRORS -gt 0 ]]; then
  echo "[FAIL] $ERRORS smoke tests failed."
  echo "Server log:"
  cat .tmp/smoke-server.log
  exit 1
fi

echo "[OK] All smoke tests passed."
