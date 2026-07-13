# Spec: restart-all.sh

## Purpose

Reliably stop and restart the complete local development stack (API and web
frontend) with one command.

## Scope

- Kill running API and frontend processes on ports `3040` and `3041`.
- Clean up orphaned tsx/Vite processes by command line.
- Clean up potentially orphaned Unix domain sockets under `TMPDIR`.
- Start `npm run dev` in the background.
- Wait until both ports are reachable again.
- Support the actions `start`, `restart`, `stop`, and `status`.

## Non-Scope

- Production-Deploy
- Backup creation (see `backup.sh`)
- Dependency installation (see `install_and_start.sh`)

## Responsibilities

- Read `.env` from repository root. `apps/api/.env` is no longer used by runtime.
- Stop processes on `API_PORT` (default 3040) and `FRONTEND_PORT` (default
  3041).
- For local MySQL setups (`CATALOG_PROVIDER=mysql` or `SEARCH_PROVIDER=mysql` with
  local host), ensure `bash scripts/start-mysql-stack.sh up` has been run when
  MySQL is not reachable, then wait until the local port is available.
- Start the stack in the background with `nohup npm run dev`.
- Write the PID to `.tmp/restart-all.pid`.
- Write combined logs to `.tmp/restart-all.log`.
- Wait up to 30 seconds until both ports are ready.
- Print local MySQL and phpMyAdmin URLs when a local MySQL provider is active.

## Inputs / Outputs

- Inputs: environment variables `API_PORT`, `FRONTEND_PORT`, `.env` files.
- Outputs: running API and web development servers, local MySQL/phpMyAdmin URLs when applicable, log file, PID file.

## Failure Modes

- Ports are blocked by other processes -> the script attempts to stop them.
- `npm run dev` does not start -> the log contains the error.
- Ports do not become ready -> the script logs a warning but does not fail.
- `CATALOG_PROVIDER=mysql` or `SEARCH_PROVIDER=mysql` with local host requires local
  MySQL on `MYSQL_HOST:MYSQL_PORT`; if MySQL is not reachable, the script attempts
  to start the MySQL stack automatically and fails only if startup does not bring the
  port up in time.

## Acceptance Criteria

- `./scripts/restart-all.sh` restarts API and frontend.
- `./scripts/restart-all.sh stop` reliably stops both services.
- `./scripts/restart-all.sh status` shows whether the background process is
  running.
- Frontend is reachable at `http://localhost:3041` after startup.
- API is reachable at `http://localhost:3040` after startup.
- If MySQL is required and configured as local, startup fails when the local
  stack still does not become reachable on `MYSQL_HOST:MYSQL_PORT`.
- If local MySQL is active, final startup output includes `phpMyAdmin: http://127.0.0.1:33308`.
- The script is listed in `scripts/check.sh` as an executable script.

## Tests / Checks

- Manual: `./scripts/restart-all.sh`, then
  `curl http://localhost:3040/api/health` and `curl http://localhost:3041`.
- `./scripts/check.sh` verifies that the script is executable.

## Agent Guardrails

- Do not write directly into `data/`.
- Do not assume fixed paths outside the project root.
