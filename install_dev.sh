#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}"
ENV_FILE="${PROJECT_ROOT}/.env"
SECRETS_FILE="${PROJECT_ROOT}/.env.secrets"
TMP_DIR="${PROJECT_ROOT}/.tmp"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "ERROR: required command '${cmd}' is not available in PATH."
    return 1
  fi
}

ensure_file_exists() {
  local source_file="$1"
  local target_file="$2"
  if [ ! -f "$target_file" ]; then
    cp "$source_file" "$target_file"
  fi
}

set_runtime_file_permissions() {
  chmod 600 "$ENV_FILE" "$SECRETS_FILE"
}

upsert_env_entry() {
  local file_path="$1"
  local key="$2"
  local value="$3"
  local tmp_file

  tmp_file="$(mktemp "${file_path}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    $0 ~ ("^" key "=") {
      print key "=" value
      found=1
      next
    }
    { print }
    END {
      if (found == 0) {
        print key "=" value
      }
    }
  ' "$file_path" > "$tmp_file"
  mv "$tmp_file" "$file_path"
}

upsert_secret_entry() {
  upsert_env_entry "$SECRETS_FILE" "$1" "$2"
}

upsert_env_var() {
  upsert_env_entry "$ENV_FILE" "$1" "$2"
}

load_current_env() {
  # shellcheck source=scripts/lib/load-env.sh
  source "${PROJECT_ROOT}/scripts/lib/load-env.sh"
  load_managed_skill_hub_env "${PROJECT_ROOT}"
}

generate_jwt_secret() {
  node -e 'const crypto=require("node:crypto");process.stdout.write(crypto.randomBytes(48).toString("base64url"));'
}

generate_password_hash() {
  local password="$1"
  BCRYPT_ROUNDS="${BCRYPT_ROUNDS:-12}" printf '%s' "$password" | node -e '
const fs = require("node:fs");
const bcrypt = require("bcryptjs");
const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
const password = fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
process.stdout.write(bcrypt.hashSync(password, rounds));
'
}

prompt_admin_password() {
  local admin_password
  local admin_password_confirm
  local hash

  read -r -s -p "Set ADMIN_PASSWORD for local simple auth: " admin_password
  echo
  if [ -z "$admin_password" ]; then
    log "ERROR: Admin password cannot be empty."
    return 1
  fi

  read -r -s -p "Repeat ADMIN_PASSWORD for local simple auth: " admin_password_confirm
  echo
  if [ "$admin_password" != "$admin_password_confirm" ]; then
    log "ERROR: Passwords do not match."
    return 1
  fi

  hash="$(generate_password_hash "$admin_password")"
  if [ -z "$hash" ]; then
    log "ERROR: failed to generate ADMIN_PASSWORD_HASH."
    return 1
  fi

  upsert_secret_entry "ADMIN_PASSWORD_HASH" "'$hash'"
  log "Stored ADMIN_PASSWORD_HASH in .env.secrets."
}

prompt_judger_profile() {
  local provider
  local current_provider="${JUDGER_PROVIDER:-}"

  if [ -n "$current_provider" ]; then
    log "JUDGER_PROVIDER already set to: ${current_provider}"
    return 0
  fi

  echo
  log "Optional local judger configuration (press Enter for default: noop)."
  echo "1) noop (default, no external credentials)"
  echo "2) vercel-ai-sdk (OpenAI via Vercel AI SDK)"
  echo "3) custom (your own provider/adapter)"
  read -r -p "Choose [1/2/3] (default 1): " provider

  case "$provider" in
    2|vercel|openai|sdk)
      upsert_env_var "JUDGER_PROVIDER" "vercel-ai-sdk"
      if [ -z "${OPENAI_API_KEY:-}" ]; then
        echo
        log "You selected vercel-ai-sdk. This stores OPENAI_API_KEY in .env.secrets."
        read -r -s -p "Paste OPENAI_API_KEY: " openai_api_key
        echo
        if [ -z "$openai_api_key" ]; then
          log "ERROR: OPENAI_API_KEY is required for vercel-ai-sdk."
          return 1
        fi
        upsert_secret_entry "OPENAI_API_KEY" "$openai_api_key"
      fi

      if [ -z "${VERCEL_AI_SDK_MODEL:-}" ]; then
        echo
        log "Default model: openai:gpt-4.1"
        log "Common alternatives: openai:gpt-4.1-mini, openai:gpt-4o, anthropic:claude-3-5-sonnet-20241022, openrouter:..."
        read -r -p "Use default model (openai:gpt-4.1)? [Y/n]: " use_default_model
        if [ "$use_default_model" = "n" ] || [ "$use_default_model" = "N" ]; then
          read -r -p "Set VERCEL_AI_SDK_MODEL (or keep empty to keep provider defaults): " model
          if [ -n "$model" ]; then
            upsert_env_var "VERCEL_AI_SDK_MODEL" "$model"
          fi
        else
          upsert_env_var "VERCEL_AI_SDK_MODEL" "openai:gpt-4.1"
        fi
      fi
      ;;
    3|custom)
      upsert_env_var "JUDGER_PROVIDER" "custom"
      if [ -z "${JUDGER_ADAPTER_PATH:-}" ]; then
        read -r -p "Set JUDGER_ADAPTER_PATH (example ./apps/api/src/adapters/llm/custom.judger.ts): " adapter_path
        if [ -z "$adapter_path" ]; then
          adapter_path="./apps/api/src/adapters/llm/custom.judger.ts"
        fi
        upsert_env_var "JUDGER_ADAPTER_PATH" "$adapter_path"
      fi
      log "Custom judger selected. Add your adapter implementation and required provider credentials in .env.secrets as needed."
      ;;
    *)
      upsert_env_var "JUDGER_PROVIDER" "noop"
      ;;
  esac
}

finalize_jwt() {
  if [ -z "${JWT_SECRET:-}" ]; then
    local jwt_secret
    jwt_secret="$(generate_jwt_secret)"
    if [ -z "$jwt_secret" ]; then
      log "ERROR: Failed to generate JWT_SECRET."
      return 1
    fi
    upsert_secret_entry "JWT_SECRET" "$jwt_secret"
    log "Stored JWT_SECRET in .env.secrets."
  fi
}

main() {
  require_command node
  require_command npm

  ensure_file_exists "${PROJECT_ROOT}/.env.example.simple" "$ENV_FILE"
  ensure_file_exists "${PROJECT_ROOT}/.env.secrets.example" "$SECRETS_FILE"
  set_runtime_file_permissions

  if [ ! -d "${PROJECT_ROOT}/node_modules" ] || [ -z "$(ls -A "${PROJECT_ROOT}/node_modules" 2>/dev/null || true)" ]; then
    log "Installing dependencies with npm ci --legacy-peer-deps ..."
    (cd "$PROJECT_ROOT" && npm ci --legacy-peer-deps)
  fi

  load_current_env

  if [ ! -d "${TMP_DIR}" ]; then
    mkdir -p "$TMP_DIR"
  fi

  if [ "${ADMIN_AUTH_MODE:-simple}" = "simple" ]; then
    if [ -z "${ADMIN_PASSWORD:-}" ] && [ -z "${ADMIN_PASSWORD_HASH:-}" ]; then
      if [ -t 0 ]; then
        log "Simple admin mode is enabled and no local admin credential is set yet."
        if ! prompt_admin_password; then
          return 1
        fi
      else
        log "ERROR: ADMIN_PASSWORD or ADMIN_PASSWORD_HASH must be set for simple local auth in non-interactive mode."
        log "Create .env.secrets with ADMIN_PASSWORD_HASH or ADMIN_PASSWORD and rerun install_dev.sh."
        return 1
      fi
    fi

    finalize_jwt
  fi

  prompt_judger_profile

  # Keep local startup aligned with Vite/API path assumptions in development profile.
  upsert_env_var "API_PREFIX" "/api"
  upsert_env_var "PUBLIC_API_BASE_URL" "http://localhost:3040/api"
  upsert_env_var "VITE_API_BASE_URL" "http://localhost:3040"
  upsert_env_var "VITE_USE_API_PROXY" "true"

  log "Environment prepared."
  log "Starting local development stack via ./scripts/development/restart-all.sh ..."
  log "(Stop with: ./scripts/development/restart-all.sh stop)"
  exec "${PROJECT_ROOT}/scripts/development/restart-all.sh"
}

main "$@"
