# Spec: restart-all.sh

## Purpose

Reliably stop and restart the complete local development stack (API and web
frontend) with one command.

## Scope

- Kill running API and frontend processes on ports `3040` and `3041`.
- Clean up orphaned tsx/Vite processes by command line.
- Clean up potentially orphaned Unix domain sockets under `TMPDIR`.
- Start `npm run dev` in a detached process group or keep it attached in
  `foreground` mode.
- Wait until both ports are reachable again.
- Support the actions `start`, `restart`, `foreground`, `stop`, and `status`.

## Non-Scope

- Production-Deploy
- Backup creation (see `backup.sh`)
- Dependency installation (see `install_and_start.sh`)

## Responsibilities

- Read layered `.env` and `.env.secrets` files from repository root through
  `scripts/lib/load-env.sh`. `apps/api/.env` is no longer used by runtime.
- Stop processes on `API_PORT` (default 3040) and `FRONTEND_PORT` (default
  3041).
- For local MySQL setups (`CATALOG_PROVIDER=mysql` or `SEARCH_PROVIDER=mysql` with
  local host), ensure `bash scripts/development/start-mysql-stack.sh up` has been run when
  MySQL is not reachable, then wait until the local port is available.
- Fail with actionable setup guidance when required local configuration is missing.
- Fall back to `JUDGER_PROVIDER=noop` for local startup if `JUDGER_PROVIDER`
  is unset.
- Prompt for `ADMIN_PASSWORD` in interactive terminals when `ADMIN_PASSWORD`
  and `ADMIN_PASSWORD_HASH` are missing in local simple-auth mode, then persist
  `ADMIN_PASSWORD_HASH` to `.env.secrets`.
- In interactive local simple mode, generate and persist a local `JWT_SECRET`
  when missing in `.env.secrets`.
- Start the stack through `start-detached.mjs` so the managed PID is also the
  detached process-group leader.
- Write the PID to `.tmp/restart-all.pid`.
- Write combined logs to `.tmp/restart-all.log`.
- Wait up to `STARTUP_TIMEOUT_SECONDS` until both ports, API health, and the
  frontend `/api/discover` proxy are ready.
- Fail startup instead of reporting success when readiness does not complete or
  the managed process exits.
- Support `foreground` for supervised shells and agent sandboxes that terminate
  detached children when the command session ends.
- Print local MySQL and phpMyAdmin URLs when a local MySQL provider is active.

## Inputs / Outputs

- Inputs: environment variables `API_PORT`, `FRONTEND_PORT`, `.env`, and
  `.env.secrets`.
- Outputs: running API and web development servers, local MySQL/phpMyAdmin URLs when applicable, log file, PID file.

## Failure Modes

- Ports are blocked by other processes -> the script attempts to stop them.
- `npm run dev` does not start -> the log contains the error.
- Ports or HTTP routes do not become ready -> startup fails.
- `.env` or judgement configuration is missing -> the script prints setup
  guidance and fails before starting.
- Simple-admin local startup without terminal input can still fail fast with a
  clear instruction to populate `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`.
- `CATALOG_PROVIDER=mysql` or `SEARCH_PROVIDER=mysql` with local host requires local
  MySQL on `MYSQL_HOST:MYSQL_PORT`; if MySQL is not reachable, the script attempts
  to start the MySQL stack automatically and fails only if startup does not bring the
  port up in time.

## Acceptance Criteria

- `./scripts/development/restart-all.sh` restarts API and frontend.
- `./scripts/development/restart-all.sh stop` reliably stops both services.
- `./scripts/development/restart-all.sh status` shows whether the background process is
  running.
- `./scripts/development/restart-all.sh foreground` keeps the complete stack
  attached to the invoking session.
- Interactive local startup can bootstrap missing simple-auth values into
  `.env.secrets` (admin password hash + JWT secret) before starting.
- Frontend is reachable at `http://localhost:3041` after startup.
- API is reachable at `http://localhost:3040` after startup.
- Frontend proxy requests to `http://localhost:3041/api/discover` reach the API.
- If MySQL is required and configured as local, startup fails when the local
  stack still does not become reachable on `MYSQL_HOST:MYSQL_PORT`.
- If local MySQL is active, final startup output includes `phpMyAdmin: http://127.0.0.1:33308`.
- The script is listed in `scripts/check.sh` as an executable script.

## Tests / Checks

- Manual: `./scripts/development/restart-all.sh`, then
  `curl http://localhost:3040/api/health`,
  `curl http://localhost:3041/api/discover`, and `curl http://localhost:3041`.
- `./scripts/check.sh` verifies that the script is executable.

## Agent Guardrails

- Do not write directly into `data/`.
- Do not assume fixed paths outside the project root.
