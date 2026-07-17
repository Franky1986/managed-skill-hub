# BUILD_AND_CHECKS

## Prerequisites

- Node.js >= 20
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
- exact dependency versions in every repository `package.json`
- presence of `vitest.config.ts`, `vite.config.ts`, and dedicated API
  agent-contract/web test TypeScript configurations
- `npm run lint` with ESLint flat config
- `npm run typecheck` across all workspaces and root-level TypeScript proof
  scripts
- dedicated strict TypeScript checks for API agent-contract controller tests
  and web test files
- `npm run test` across all workspaces

The push and pull-request workflow additionally runs the production build and
audits the locked dependency graph at moderate severity. Pull requests also run
the MySQL full validation gate against a runner-provisioned MySQL service.
Operators can request the same MySQL gate manually through `workflow_dispatch`.
There is no unattended scheduled workflow.

## Individual Checks

```bash
npm run lint
npm run typecheck
npm run typecheck:scripts
npm run test
npm run build:prod
node scripts/checks/check-pinned-package-versions.mjs
npm audit --audit-level=moderate --package-lock-only

# Requires Docker/OrbStack and runs the full SQLite/MySQL parity path.
RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh

# CI path when MySQL is already available on 127.0.0.1:33307.
RUN_MYSQL_FULL_CHECK=true \
SKIP_MYSQL_STACK_START=true \
./scripts/full-check.sh
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

1. Create the layered root environment:
   ```bash
   cp .env.example .env
   cp .env.secrets.example .env.secrets
   chmod 600 .env .env.secrets
   # For local simple auth, set ADMIN_PASSWORD in .env.secrets.
   ```

2. Development mode:
   ```bash
   # Start both apps from repository root:
   npm run dev
   ```

   Native modules such as `better-sqlite3` are built for the Node.js runtime
   active during installation. After switching Node.js major versions, run:

   ```bash
   npm rebuild better-sqlite3 --workspace=apps/api
   ```

   A complete `npm ci --legacy-peer-deps` under the active runtime is the
   reproducible alternative.

3. Or after a production build:
   ```bash
   npm run build:prod
   cd apps/api
   node dist/server.js
   ```

4. Or everything with one command in dev mode:
   ```bash
   ./scripts/development/restart-all.sh
   ```

   The script stops running processes, restarts API and frontend in the
   background, and waits until both ports are ready. Logs:
   `tail -f .tmp/restart-all.log`.

   Additional actions:
   ```bash
   ./scripts/development/restart-all.sh stop    # stop stack
   ./scripts/development/restart-all.sh status  # check status
   ./scripts/development/restart-all.sh restart # explicit restart
   ```

URLs:

- Frontend: http://localhost:3041
- API: http://localhost:3040
- Admin login: http://localhost:3041/admin/login

## Automated Testing

```bash
# Fast smoke test: starts the server, tests endpoints, stops the server
bash scripts/development/smoke-test.sh

# Manual API tests with curl and UI tests
# See docs/setup/TESTING.md
```

## Sandbox Limitations

- In some sandbox environments, `tsx watch` / `tsx` cannot create an IPC pipe.
- Binding to `127.0.0.1:3040` can be blocked in restrictive sandboxes.
- Starting locally on a developer machine or target server works without these
  restrictions.
- `scripts/development/smoke-test.sh` can also fail in the sandbox because it must start
  the server.

## Deployment

```bash
bash scripts/deployment/create-deploy-archive.sh
# Then manually extract and start on the server.
# See `docs/setup/DEPLOYMENT.md` and `docs/setup/NGINX.md`.
```

```text
/path/to/deploy-root/
  src/    # redeployed
  data/   # remains persistent
```

`data/` must never be deleted during deploys.
