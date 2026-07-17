#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROUNDS="${BCRYPT_ROUNDS:-12}"

if ! [[ "$ROUNDS" =~ ^[0-9]+$ ]] || (( ROUNDS < 4 || ROUNDS > 31 )); then
  echo "ERROR: BCRYPT_ROUNDS must be an integer between 4 and 31." >&2
  exit 1
fi

cd "$PROJECT_ROOT"
if ! node -e "require('bcryptjs')" >/dev/null 2>&1; then
  echo "ERROR: bcryptjs is unavailable. Run npm install from the repository root first." >&2
  exit 1
fi

printf 'Admin password: ' >&2
IFS= read -r -s PASSWORD
printf '\nRepeat password: ' >&2
IFS= read -r -s CONFIRM_PASSWORD
printf '\n' >&2

if [[ -z "$PASSWORD" ]]; then
  echo "ERROR: password must not be empty." >&2
  exit 1
fi

if [[ "$PASSWORD" != "$CONFIRM_PASSWORD" ]]; then
  echo "ERROR: passwords do not match." >&2
  exit 1
fi

printf '%s' "$PASSWORD" | BCRYPT_ROUNDS="$ROUNDS" node -e '
const fs = require("node:fs");
const bcrypt = require("bcryptjs");
const password = fs.readFileSync(0, "utf8");
process.stdout.write(`${bcrypt.hashSync(password, Number(process.env.BCRYPT_ROUNDS))}\n`);
'

unset PASSWORD CONFIRM_PASSWORD
