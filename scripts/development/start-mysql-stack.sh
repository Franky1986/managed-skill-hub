#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/.docker/mysql-stack.yml"
COMPOSE_CMD="${DOCKER_COMPOSE_CMD:-docker compose}"
MYSQL_HOST="127.0.0.1"
MYSQL_PORT="33307"
MYSQL_SERVICE="managed-skill-hub-mysql"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not on PATH."
  exit 1
fi

if ! ${COMPOSE_CMD} -f "${COMPOSE_FILE}" config >/dev/null 2>&1; then
  echo "Cannot validate compose file: ${COMPOSE_FILE}"
  exit 1
fi

wait_for_mysql() {
  local timeout=60
  local elapsed=0

  while [ "${elapsed}" -lt "${timeout}" ]; do
    if ! ${COMPOSE_CMD} -f "${COMPOSE_FILE}" ps --services --filter status=running | rg -q "^${MYSQL_SERVICE}$"; then
      sleep 1
      elapsed=$((elapsed + 1))
      continue
    fi

    if command -v nc >/dev/null 2>&1; then
      if nc -z "${MYSQL_HOST}" "${MYSQL_PORT}" >/dev/null 2>&1; then
        return 0
      fi
    elif (echo > /dev/tcp/"${MYSQL_HOST}"/"${MYSQL_PORT}") >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "MySQL container is running but port check (${MYSQL_HOST}:${MYSQL_PORT}) did not pass within ${timeout}s."
  echo "Check container logs: ${COMPOSE_CMD} -f ${COMPOSE_FILE} logs ${MYSQL_SERVICE}"
  return 1
}

ACTION="${1:-up}"

case "${ACTION}" in
  up)
    echo "Starting MySQL + phpMyAdmin stack..."
    ${COMPOSE_CMD} -f "${COMPOSE_FILE}" up -d

    echo "Waiting for MySQL to accept TCP connections..."
    if ! wait_for_mysql; then
      echo "Hint: If this persists, run 'docker ps --format {{.Names}} | grep managed-skill-hub-mysql' and restart the stack."
      exit 1
    fi

    echo "MySQL stack ready."
    echo "- MySQL: 127.0.0.1:33307"
    echo "- phpMyAdmin: http://127.0.0.1:33308"
    ;;

  down)
    echo "Stopping MySQL + phpMyAdmin stack..."
    ${COMPOSE_CMD} -f "${COMPOSE_FILE}" down
    ;;

  logs)
    ${COMPOSE_CMD} -f "${COMPOSE_FILE}" logs -f
    ;;

  status)
    ${COMPOSE_CMD} -f "${COMPOSE_FILE}" ps
    ;;

  *)
    echo "Unknown action: ${ACTION}"
    echo "Usage: $(basename "$0") [up|down|logs|status]"
    exit 1
    ;;
esac
