#!/usr/bin/env bash

# Source this file, then call load_managed_skill_hub_env with the repository root.
# Precedence is: exported process environment > secrets file > .env.
load_managed_skill_hub_env() {
  local project_root="${1:?project root is required}"
  local config_file="${project_root}/.env"
  local secrets_file="${MANAGED_SKILL_HUB_SECRETS_FILE:-${project_root}/.env.secrets}"
  local env_files=("${config_file}" "${secrets_file}")
  local captured_keys=()
  local captured_values=()
  local env_file line key existing captured index
  local allexport_was_enabled=false

  # Preserve values explicitly exported by the caller before local files load.
  for env_file in "${env_files[@]}"; do
    [ -f "${env_file}" ] || continue
    while IFS= read -r line || [ -n "${line}" ]; do
      if [[ "${line}" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
        key="${BASH_REMATCH[1]}"
        captured=false
        for existing in "${captured_keys[@]:-}"; do
          if [ "${existing}" = "${key}" ]; then
            captured=true
            break
          fi
        done
        if [ "${captured}" = false ] && declare -p "${key}" 2>/dev/null | grep -q '^declare -x'; then
          captured_keys+=("${key}")
          captured_values+=("${!key}")
        fi
      fi
    done < "${env_file}"
  done

  case "$-" in
    *a*) allexport_was_enabled=true ;;
  esac
  set -a
  if [ -f "${config_file}" ]; then
    # shellcheck source=/dev/null
    source "${config_file}"
  fi
  if [ -f "${secrets_file}" ]; then
    # shellcheck source=/dev/null
    source "${secrets_file}"
  fi
  if [ "${allexport_was_enabled}" = false ]; then
    set +a
  fi

  for ((index = 0; index < ${#captured_keys[@]}; index += 1)); do
    key="${captured_keys[index]}"
    printf -v "${key}" '%s' "${captured_values[index]}"
    export "${key}"
  done
}
