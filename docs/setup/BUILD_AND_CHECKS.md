# BUILD_AND_CHECKS

## Prerequisites

- Node.js >= 20 LTS
- npm >= 10

## Initialize The Project

```bash
cd /path/to/managed-skill-hub
npm ci --legacy-peer-deps
```

## Structure

```text
apps/
  api/        Fastify backend, port 3040
  web/        React frontend, port 3041
packages/
  openapi/    OpenAPI spec plus generated clients
  shared/     technical shared types
data/
  skills/     published skills, source of truth
  proposals/  submitted proposals
  index/      SQLite FTS5 search index
  audit/      JSONL audit logs
  backups/    backup archives
```

## Checks

```bash
./scripts/check.sh
```

The script checks:

- presence of central documents: README, AGENTS, `.env.example`, ADRs, specs
- docs directory structure
- number of `.spec.md` files
- executable deployment, backup, and test scripts
- presence of `vitest.config.ts` and `vite.config.ts`
- `npm run lint` with ESLint flat config
- `npm run typecheck` across all workspaces
- `npm run test` across all workspaces

The pull-request workflow additionally runs the production build, audits the
locked dependency graph at moderate severity, and executes the Docker/MySQL full
validation gate.

## Individual Checks

```bash
npm run lint
npm run typecheck
npm run test
npm run build:prod
npm audit --audit-level=moderate --package-lock-only

# Requires Docker/OrbStack and runs the full SQLite/MySQL parity path.
RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh
```

## Production Build

```bash
npm run build:prod
```

The build creates:

- `apps/api/dist/server.js`
- `apps/web/dist/`
- `packages/shared/dist/`
- `packages/openapi/dist/skill-registry.d.ts`

## Local Start

1. Create root `.env`:
   ```bash
   cp .env.example .env
   # Local default: ADMIN_PASSWORD=admin
   ```

2. Development mode:
   ```bash
   # Start both apps from repository root:
   npm run dev
   ```

3. Or after a production build:
   ```bash
   npm run build:prod
   cd apps/api
   node dist/server.js
   ```

4. Or everything with one command in dev mode:
   ```bash
   ./scripts/restart-all.sh
   ```

   The script stops running processes, restarts API and frontend in the
   background, and waits until both ports are ready. Logs:
   `tail -f .tmp/restart-all.log`.

   Additional actions:
   ```bash
   ./scripts/restart-all.sh stop    # stop stack
   ./scripts/restart-all.sh status  # check status
   ./scripts/restart-all.sh restart # explicit restart
   ```

URLs:

- Frontend: http://localhost:3041
- API: http://localhost:3040
- Admin login: http://localhost:3041/admin/login

## Automated Testing

```bash
# Fast smoke test: starts the server, tests endpoints, stops the server
bash scripts/smoke-test.sh

# Manual API tests with curl and UI tests
# See docs/setup/TESTING.md
```

## Sandbox Limitations

- In some sandbox environments, `tsx watch` / `tsx` cannot create an IPC pipe.
- Binding to `127.0.0.1:3040` can be blocked in restrictive sandboxes.
- Starting locally on a developer machine or target server works without these
  restrictions.
- `scripts/smoke-test.sh` can also fail in the sandbox because it must start
  the server.

## Deployment

```bash
bash scripts/prepare-deploy.sh
# Then manually extract and start on the server.
# See `docs/setup/DEPLOYMENT.md` and `docs/setup/NGINX.md`.
```

```text
/path/to/deploy-root/
  src/    # redeployed
  data/   # remains persistent
```

`data/` must never be deleted during deploys.
