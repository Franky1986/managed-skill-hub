# Install And Start Script Spec

## Purpose

Prepare and start a reproducible production deployment from an extracted public
release archive.

## Scope

- `prepare` validates Node.js 20+, npm 10+, `package-lock.json`, and `.env`.
- Secrets may come from `.env.secrets`, an external
  `MANAGED_SKILL_HUB_SECRETS_FILE`, or the exported deployment environment.
- Dependencies are installed with
  `npm ci --include=dev --legacy-peer-deps`; build-time development
  dependencies remain available even though startup uses production mode.
- Production artifacts are built before startup.
- `start` launches the built API and frontend preview through
  `scripts/deployment/restart-server.sh`.
- `all` performs preparation and startup in sequence.

## Guardrails

- `DATA_DIR` is created but never deleted.
- Deployment preparation never uses an unlocked `npm install`.
- Production startup forces `NODE_ENV=production`,
  `API_START_MODE=production`, and `FRONTEND_START_MODE=preview`.
- Missing prerequisites or an unhealthy startup fail with a non-zero exit.

## Checks

- `bash -n scripts/deployment/install_and_start.sh`
- `./scripts/check.sh` verifies that the script remains executable.
