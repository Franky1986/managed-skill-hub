# Spec: restart-server.sh

## Purpose

Start, restart, stop, and inspect the server-style API/frontend stack without
terminating unrelated processes.

## Scope

- Layered environment loading from the selected runtime project root.
- `API_START_MODE=dev|production`.
- `FRONTEND_START_MODE=dev|preview`.
- Separate API and frontend PID files.
- Local HTTP readiness checks before reporting startup success.
- Compatibility stop support for the former combined `server.pid`.

## Non-Scope

- Dependency installation and production builds.
- Reverse-proxy configuration.
- Local MySQL orchestration; use `restart-all.sh` for the development stack.

## Responsibilities

- Production API mode runs `node apps/api/dist/server.js`.
- Preview frontend mode serves the built Vite bundle.
- Stop only a PID whose working directory is the selected project root or one
  of its descendants.
- Stop descendants of a verified recorded PID, then remove its PID file.
- Refuse to kill an unverified process or an unknown listener occupying the API
  or frontend port.
- Require API and frontend HTTP healthchecks to pass within
  `STARTUP_TIMEOUT_SECONDS`; stop both recorded processes if either check fails.
- Require positive integer API port, frontend port, and startup timeout values.
- Check native runtime dependencies before starting either process and fail
  immediately with a rebuild command when `better-sqlite3` was installed for a
  different Node ABI.
- Treat `.nvmrc` as the recommended local runtime and report a version mismatch
  without blocking another otherwise supported Node.js release.
- Collect process trees without Bash-version-specific helpers unavailable on
  the default macOS Bash.
- Support `start`, `restart`, `stop`, and `status`.

## Inputs / Outputs

- Inputs: layered environment, optional `MANAGED_SKILL_HUB_RUNTIME_ROOT`,
  process modes, ports, hosts, timeout, and healthcheck URLs.
- Outputs: `.tmp/api.pid`, `.tmp/frontend.pid`, and `.tmp/server.log` under the
  selected runtime project root.

## Failure Modes

- Missing production build -> fail before process start.
- Recorded PID belongs to another working directory -> fail without signaling it.
- Unknown process occupies a configured port -> fail and require manual
  operator inspection.
- API or frontend exits or misses its HTTP healthcheck -> stop recorded
  processes and fail.
- Invalid numeric process settings -> fail before changing processes.
- Missing dependencies or a native Node ABI mismatch -> fail before starting
  API/frontend processes and identify the required reinstall/rebuild action.

## Acceptance Criteria

- Production deployment does not run the API through TSX watch mode.
- Restart does not use global `pgrep -f` patterns or terminate arbitrary port
  listeners.
- Both healthchecks pass before startup is reported successful.
- Stop and status remain usable for server operations and deployment rollback.
- Status reports absent PID files cleanly without shell redirection errors.
- `bash -n scripts/deployment/restart-server.sh` passes and `./scripts/check.sh` verifies
  that the script remains executable.
