#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUTPUT_DIR="${DEPLOY_OUTPUT_DIR:-${PROJECT_ROOT}/.tmp/deploy}"
ARCHIVE_NAME="${DEPLOY_ARCHIVE_NAME:-managed-skill-hub-deploy.tar.gz}"
ARCHIVE_PATH="${OUTPUT_DIR}/${ARCHIVE_NAME}"
ARCHIVE_SHA_PATH="${ARCHIVE_PATH}.sha256"
SERVICE_PATH="${OUTPUT_DIR}/service.sh"
SERVICE_CONFIG_EXAMPLE_PATH="${OUTPUT_DIR}/deployment.env.example"

calculate_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    echo "ERROR: sha256sum or shasum is required." >&2
    exit 1
  fi
}

is_enabled() {
  case "$1" in
    1|true) return 0 ;;
    0|false) return 1 ;;
    *)
      echo "ERROR: expected true, false, 1, or 0; found '${1}'." >&2
      exit 1
      ;;
  esac
}

case "${DEPLOY_REQUIRE_CLEAN_TREE:-true}" in
  1|true)
    if [[ -n "$(git -C "$PROJECT_ROOT" status --short --untracked-files=all)" ]]; then
      echo "ERROR: non-ignored working-tree changes are present." >&2
      echo "Commit the reviewed release state before creating the archive." >&2
      git -C "$PROJECT_ROOT" status --short --untracked-files=all >&2
      exit 1
    fi
    ;;
  0|false) ;;
  *)
    echo "ERROR: DEPLOY_REQUIRE_CLEAN_TREE must be true, false, 1, or 0." >&2
    exit 1
    ;;
esac

cd "$PROJECT_ROOT"
mkdir -p "$OUTPUT_DIR"

if is_enabled "${DEPLOY_RUN_CHECKS:-true}"; then
  ./scripts/check.sh
fi
if is_enabled "${DEPLOY_RUN_BUILD:-true}"; then
  npm run build:prod
fi

rm -f "$ARCHIVE_PATH" "$ARCHIVE_SHA_PATH" "$SERVICE_PATH" "$SERVICE_CONFIG_EXAMPLE_PATH"
bash scripts/deployment/create-deploy-archive.sh "$ARCHIVE_PATH"

hash="$(calculate_sha256 "$ARCHIVE_PATH")"
printf '%s  %s\n' "$hash" "$(basename "$ARCHIVE_PATH")" > "$ARCHIVE_SHA_PATH"
install -m 0700 scripts/deployment/service.sh "$SERVICE_PATH"
install -m 0644 scripts/deployment/deployment.env.example "$SERVICE_CONFIG_EXAMPLE_PATH"

echo "Prepared public deployment artifacts:"
echo "  archive:  ${ARCHIVE_PATH}"
echo "  checksum: ${ARCHIVE_SHA_PATH}"
echo "  service:  ${SERVICE_PATH}"
echo "  config:   ${SERVICE_CONFIG_EXAMPLE_PATH}"
