#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# shellcheck source=./load-env.sh
source "${SCRIPT_DIR}/load-env.sh"
load_managed_skill_hub_env "${PROJECT_ROOT}"

exec "$@"
