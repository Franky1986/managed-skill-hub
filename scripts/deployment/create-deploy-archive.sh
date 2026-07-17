#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

REVISION="$(git rev-parse --verify HEAD)"
SHORT_REVISION="$(git rev-parse --short "$REVISION")"
OUTPUT="${1:-.tmp/deploy/managed-skill-hub-deploy.tar.gz}"
mkdir -p "$(dirname "$OUTPUT")"

# Archive committed repository content only; ignored runtime data and secrets are excluded.
git archive \
  --format=tar.gz \
  --output="$OUTPUT" \
  "$REVISION"

echo "Created deployment archive from commit $SHORT_REVISION: $OUTPUT"
