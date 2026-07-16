#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"

if [[ "$#" -lt 2 ]]; then
  echo "Usage: bash scripts/deployment/upload.sh <profile.env> <artifact> [...]" >&2
  exit 2
fi

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

PROFILE_FILE="$1"
shift

[[ -f "$PROFILE_FILE" && ! -L "$PROFILE_FILE" ]] \
  || fail "deployment profile is missing or unsafe: ${PROFILE_FILE}"

# The profile is an operator-owned shell configuration file.
# PROJECT_ROOT is available for ignored overlays that reference local files.
# shellcheck disable=SC1090
source "$PROFILE_FILE"

: "${DEPLOY_REMOTE_HOST:?DEPLOY_REMOTE_HOST is required}"
: "${DEPLOY_REMOTE_USER:?DEPLOY_REMOTE_USER is required}"
: "${DEPLOY_REMOTE_DIR:?DEPLOY_REMOTE_DIR is required}"

[[ "$DEPLOY_REMOTE_USER" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
  || fail "DEPLOY_REMOTE_USER contains unsupported characters."
if [[ ! "$DEPLOY_REMOTE_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ \
  && ! "$DEPLOY_REMOTE_HOST" =~ ^\[[0-9A-Fa-f:]+\]$ ]]; then
  fail "DEPLOY_REMOTE_HOST must be a hostname, address, or bracketed IPv6 address."
fi
[[ "$DEPLOY_REMOTE_DIR" = /* ]] || fail "DEPLOY_REMOTE_DIR must be absolute."
[[ "$DEPLOY_REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]*$ ]] \
  || fail "DEPLOY_REMOTE_DIR contains unsupported characters."
case "$DEPLOY_REMOTE_DIR" in
  *'/../'*|*/..|..|../*) fail "DEPLOY_REMOTE_DIR must not contain parent traversal." ;;
esac

artifacts=()
for artifact in "$@"; do
  [[ -f "$artifact" && ! -L "$artifact" ]] \
    || fail "upload artifact is missing or unsafe: ${artifact}"
  case "$artifact" in
    */*)
      artifact_dir_input="${artifact%/*}"
      artifact_name="${artifact##*/}"
      [[ -n "$artifact_dir_input" ]] || artifact_dir_input="/"
      ;;
    *)
      artifact_dir_input="."
      artifact_name="$artifact"
      ;;
  esac
  artifact_dir="$(cd "$artifact_dir_input" && pwd -P)"
  artifact_path="${artifact_dir}/${artifact_name}"
  [[ -f "$artifact_path" && ! -L "$artifact_path" ]] \
    || fail "upload artifact is missing or unsafe after normalization: ${artifact}"
  artifacts+=("$artifact_path")
done

if [[ -n "${DEPLOY_SSH_PORT:-}" ]]; then
  [[ "$DEPLOY_SSH_PORT" =~ ^[1-9][0-9]*$ ]] \
    || fail "DEPLOY_SSH_PORT must be an integer between 1 and 65535."
  (( DEPLOY_SSH_PORT <= 65535 )) \
    || fail "DEPLOY_SSH_PORT must be an integer between 1 and 65535."
fi

command -v scp >/dev/null 2>&1 || fail "scp is required for deployment uploads."

destination="${DEPLOY_REMOTE_USER}@${DEPLOY_REMOTE_HOST}:${DEPLOY_REMOTE_DIR%/}/"
echo "Uploading ${#artifacts[@]} artifact(s) to ${DEPLOY_REMOTE_USER}@${DEPLOY_REMOTE_HOST}:${DEPLOY_REMOTE_DIR}/ ..."
if [[ -n "${DEPLOY_SSH_PORT:-}" ]]; then
  scp -P "$DEPLOY_SSH_PORT" "${artifacts[@]}" "$destination"
else
  scp "${artifacts[@]}" "$destination"
fi
echo "Upload completed."
