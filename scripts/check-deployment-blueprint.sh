#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/managed-skill-hub-deployment-blueprint.XXXXXX")"
WORK_DIR="$(cd "$WORK_DIR" && pwd -P)"
DEPLOYMENT_ROOT="${WORK_DIR}/deployment"
SOURCE_DIR="${DEPLOYMENT_ROOT}/release"
STATE_FILE="${WORK_DIR}/state.log"
SCP_STATE_FILE="${WORK_DIR}/scp.log"
FAKE_BIN_DIR="${WORK_DIR}/bin"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "${SOURCE_DIR}/scripts" "${SOURCE_DIR}/.tmp" "$FAKE_BIN_DIR"
printf '%s\n' 'NODE_ENV=production' > "${SOURCE_DIR}/.env"
printf '%s\n' "JWT_SECRET='not-a-real-secret-value-for-test'" > "${DEPLOYMENT_ROOT}/persistent.secrets"

cat > "${SOURCE_DIR}/scripts/install_and_start.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf 'start:%s:%s:%s\n' \
  "$1" \
  "${MANAGED_SKILL_HUB_RUNTIME_ROOT}" \
  "${MANAGED_SKILL_HUB_SECRETS_FILE}" >> "${DEPLOYMENT_TEST_STATE_FILE}"
SCRIPT

cat > "${SOURCE_DIR}/scripts/restart-server.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf 'runtime:%s:%s:%s\n' \
  "$1" \
  "${MANAGED_SKILL_HUB_RUNTIME_ROOT}" \
  "${MANAGED_SKILL_HUB_SECRETS_FILE}" >> "${DEPLOYMENT_TEST_STATE_FILE}"
SCRIPT

chmod +x \
  "${SOURCE_DIR}/scripts/install_and_start.sh" \
  "${SOURCE_DIR}/scripts/restart-server.sh"
install -m 0700 "${ROOT}/scripts/deployment/service.sh" "${DEPLOYMENT_ROOT}/service.sh"

cat > "${FAKE_BIN_DIR}/scp" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '<%s>\n' "$@" >> "${DEPLOYMENT_TEST_SCP_STATE_FILE}"
SCRIPT
chmod +x "${FAKE_BIN_DIR}/scp"

cat > "${DEPLOYMENT_ROOT}/deployment.env" <<'ENV'
MSH_SOURCE_DIR=release
MSH_SECRETS_FILE=persistent.secrets
MSH_START_SCRIPT=release/scripts/install_and_start.sh
MSH_RUNTIME_SCRIPT=release/scripts/restart-server.sh
MSH_LOG_FILE=release/.tmp/server.log
ENV

config_output="$(bash "${DEPLOYMENT_ROOT}/service.sh" config)"
grep -Fq "sourceDir=${SOURCE_DIR}" <<< "$config_output"
grep -Fq "secretsFile=${DEPLOYMENT_ROOT}/persistent.secrets" <<< "$config_output"

DEPLOYMENT_TEST_STATE_FILE="$STATE_FILE" bash "${DEPLOYMENT_ROOT}/service.sh" status
DEPLOYMENT_TEST_STATE_FILE="$STATE_FILE" bash "${DEPLOYMENT_ROOT}/service.sh" start

grep -Fq "runtime:status:${SOURCE_DIR}:${DEPLOYMENT_ROOT}/persistent.secrets" "$STATE_FILE"
grep -Fq "start:start:${SOURCE_DIR}:${DEPLOYMENT_ROOT}/persistent.secrets" "$STATE_FILE"

if bash "${ROOT}/scripts/deployment/upload.sh" "${WORK_DIR}/missing-profile.env" "${DEPLOYMENT_ROOT}/service.sh" >/dev/null 2>&1; then
  echo "ERROR: upload helper accepted a missing profile." >&2
  exit 1
fi

cat > "${WORK_DIR}/upload.env" <<'ENV'
DEPLOY_REMOTE_HOST="${PROJECT_ROOT:+skills.example.com}"
DEPLOY_REMOTE_USER=deploy
DEPLOY_REMOTE_DIR=/srv/managed-skill-hub
ENV
printf '%s\n' 'artifact' > "${WORK_DIR}/-v"
: > "$SCP_STATE_FILE"
(
  cd "$WORK_DIR"
  PATH="${FAKE_BIN_DIR}:${PATH}" \
    DEPLOYMENT_TEST_SCP_STATE_FILE="$SCP_STATE_FILE" \
    bash "${ROOT}/scripts/deployment/upload.sh" "${WORK_DIR}/upload.env" ./-v
)
grep -Fq "<${WORK_DIR}/-v>" "$SCP_STATE_FILE"
grep -Fq '<deploy@skills.example.com:/srv/managed-skill-hub/>' "$SCP_STATE_FILE"
if grep -Fq '<-v>' "$SCP_STATE_FILE"; then
  echo "ERROR: upload helper passed an option-like artifact path to scp." >&2
  exit 1
fi

cat > "${WORK_DIR}/upload-with-port.env" <<'ENV'
DEPLOY_REMOTE_HOST=skills.example.com
DEPLOY_REMOTE_USER=deploy
DEPLOY_REMOTE_DIR=/srv/managed-skill-hub
DEPLOY_SSH_PORT=2222
ENV
: > "$SCP_STATE_FILE"
PATH="${FAKE_BIN_DIR}:${PATH}" \
  DEPLOYMENT_TEST_SCP_STATE_FILE="$SCP_STATE_FILE" \
  bash "${ROOT}/scripts/deployment/upload.sh" \
    "${WORK_DIR}/upload-with-port.env" \
    "${DEPLOYMENT_ROOT}/service.sh"
grep -Fq '<-P>' "$SCP_STATE_FILE"
grep -Fq '<2222>' "$SCP_STATE_FILE"

cat > "${WORK_DIR}/invalid-port.env" <<'ENV'
DEPLOY_REMOTE_HOST=skills.example.com
DEPLOY_REMOTE_USER=deploy
DEPLOY_REMOTE_DIR=/srv/managed-skill-hub
DEPLOY_SSH_PORT=65536
ENV
: > "$SCP_STATE_FILE"
if PATH="${FAKE_BIN_DIR}:${PATH}" \
  DEPLOYMENT_TEST_SCP_STATE_FILE="$SCP_STATE_FILE" \
  bash "${ROOT}/scripts/deployment/upload.sh" \
    "${WORK_DIR}/invalid-port.env" \
    "${DEPLOYMENT_ROOT}/service.sh" >/dev/null 2>&1; then
  echo "ERROR: upload helper accepted an out-of-range SSH port." >&2
  exit 1
fi
[[ ! -s "$SCP_STATE_FILE" ]]

cat > "${WORK_DIR}/unsafe-upload.env" <<'ENV'
DEPLOY_REMOTE_HOST=-oProxyCommand
DEPLOY_REMOTE_USER=deploy
DEPLOY_REMOTE_DIR=/srv/managed-skill-hub
ENV
if PATH="${FAKE_BIN_DIR}:${PATH}" \
  DEPLOYMENT_TEST_SCP_STATE_FILE="$SCP_STATE_FILE" \
  bash "${ROOT}/scripts/deployment/upload.sh" \
    "${WORK_DIR}/unsafe-upload.env" \
    "${DEPLOYMENT_ROOT}/service.sh" >/dev/null 2>&1; then
  echo "ERROR: upload helper accepted unsafe remote settings." >&2
  exit 1
fi

cat > "${WORK_DIR}/traversal-upload.env" <<'ENV'
DEPLOY_REMOTE_HOST=skills.example.com
DEPLOY_REMOTE_USER=deploy
DEPLOY_REMOTE_DIR=/srv/../outside
ENV
if PATH="${FAKE_BIN_DIR}:${PATH}" \
  DEPLOYMENT_TEST_SCP_STATE_FILE="$SCP_STATE_FILE" \
  bash "${ROOT}/scripts/deployment/upload.sh" \
    "${WORK_DIR}/traversal-upload.env" \
    "${DEPLOYMENT_ROOT}/service.sh" >/dev/null 2>&1; then
  echo "ERROR: upload helper accepted parent traversal in the remote directory." >&2
  exit 1
fi

ln -s "${DEPLOYMENT_ROOT}/service.sh" "${WORK_DIR}/service-link.sh"
if PATH="${FAKE_BIN_DIR}:${PATH}" \
  DEPLOYMENT_TEST_SCP_STATE_FILE="$SCP_STATE_FILE" \
  bash "${ROOT}/scripts/deployment/upload.sh" \
    "${WORK_DIR}/upload.env" \
    "${WORK_DIR}/service-link.sh" >/dev/null 2>&1; then
  echo "ERROR: upload helper accepted a symbolic-link artifact." >&2
  exit 1
fi

cat > "${DEPLOYMENT_ROOT}/unsafe.env" <<'ENV'
MSH_SOURCE_DIR=../outside
ENV
if MANAGED_SKILL_HUB_DEPLOYMENT_CONFIG="${DEPLOYMENT_ROOT}/unsafe.env" \
  bash "${DEPLOYMENT_ROOT}/service.sh" config >/dev/null 2>&1; then
  echo "ERROR: service controller accepted parent traversal." >&2
  exit 1
fi

ln -s "$SOURCE_DIR" "${DEPLOYMENT_ROOT}/linked-release"
cat > "${DEPLOYMENT_ROOT}/unsafe-symlink.env" <<'ENV'
MSH_SOURCE_DIR=linked-release
MSH_SECRETS_FILE=persistent.secrets
MSH_RUNTIME_SCRIPT=linked-release/scripts/restart-server.sh
ENV
if MANAGED_SKILL_HUB_DEPLOYMENT_CONFIG="${DEPLOYMENT_ROOT}/unsafe-symlink.env" \
  bash "${DEPLOYMENT_ROOT}/service.sh" status >/dev/null 2>&1; then
  echo "ERROR: service controller accepted a symbolic link in a path component." >&2
  exit 1
fi

cat > "${DEPLOYMENT_ROOT}/unsafe-health.env" <<'ENV'
MSH_API_HEALTH_URL=--config
ENV
if MANAGED_SKILL_HUB_DEPLOYMENT_CONFIG="${DEPLOYMENT_ROOT}/unsafe-health.env" \
  bash "${DEPLOYMENT_ROOT}/service.sh" config >/dev/null 2>&1; then
  echo "ERROR: service controller accepted an unsafe health URL." >&2
  exit 1
fi

echo "[OK] Generic deployment blueprint proof passed."
