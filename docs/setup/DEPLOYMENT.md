# Deployment

> Warning: production deployment is not automated. This document describes the
> manual process.

## Target Environment

```text
/path/to/deploy-root/
  src/    # project code, redeployed
  data/   # persistent, never deleted
```

## Server Prerequisites

- Node.js >= 20 LTS
- npm >= 10
- nginx; see `docs/setup/NGINX.md` for an example configuration
- SSH access with `REMOTE_HOST` / `REMOTE_USER` from your deployment environment.

## Local Preparation

1. Create the non-secret root config and local secret file:
   ```bash
   cp .env.example .env
   cp .env.secrets.example .env.secrets
   chmod 600 .env .env.secrets
   # For local/dev-like setups, ADMIN_PASSWORD can be set in .env.secrets.
   # For server-like setups, prefer:
   node -e "console.log(require('bcryptjs').hashSync('your-password', 10))"
   # For single-host deploys, set API_PREFIX=/api and VITE_API_BASE_URL=/api in .env.
   ```

   Production archives may contain the non-secret `.env` profile but must not
   contain `.env.secrets`. Provision secrets separately through the server
   environment, a secret manager, or a mode-`0600` server-side file.

2. Create the deploy archive:
   ```bash
   bash scripts/prepare-deploy.sh
   ```

   The script runs:
   - `./scripts/check.sh` for structure, lint, typecheck, and tests
   - `npm run build:prod`
   - creates `.tmp/deploy/managed-skill-hub-deploy.tar.gz`
   - excludes `data/` from the archive

3. Copy the archive to the server:
   ```bash
   scp .tmp/deploy/managed-skill-hub-deploy.tar.gz "${REMOTE_USER}@${REMOTE_HOST}:/path/to/deploy-root/"
   ```

## Server Setup: One-Time

```bash
ssh "${REMOTE_USER}@${REMOTE_HOST}"
sudo mkdir -p /path/to/deploy-root
sudo chown $(id -un):$(id -gn) /path/to/deploy-root
mkdir -p /path/to/deploy-root/data/{skills,proposals,index,audit,backups,uploads}
```

## Extract And Start

```bash
ssh "${REMOTE_USER}@${REMOTE_HOST}"
cd /path/to/deploy-root
tar -xzf managed-skill-hub-deploy.tar.gz -C src
bash src/scripts/install_and_start.sh
```

`install_and_start.sh` runs on the server:

- `npm install --legacy-peer-deps --no-audit --no-fund`
- `npm run build:prod`
- `bash scripts/restart-server.sh`

## Restart/Stop

```bash
bash /path/to/deploy-root/src/scripts/restart-server.sh
bash /path/to/deploy-root/src/scripts/restart-server.sh stop
```

## Data Directory

- `data/skills/` and `data/proposals/` survive deploys.
- `data/index/` can be reindexed when needed.
- `data/audit/` contains append-only logs.
- `data/backups/` contains backups; see `docs/setup/BACKUP_AND_RESTORE.md`.

## Database Provider Choice On Servers

SQLite is the simplest server mode and needs only persistent `DATA_DIR` storage:

```env
CATALOG_PROVIDER=sqlite
SEARCH_PROVIDER=sqlite
DATA_DIR=/path/to/deploy-root/data
```

MySQL server mode needs a reachable MySQL 8-compatible database and credentials:

```env
CATALOG_PROVIDER=mysql
SEARCH_PROVIDER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=managed_skill_hub
MYSQL_USER=managed_skill_hub
MYSQL_SSL_MODE=preferred
DATA_DIR=/path/to/deploy-root/data
```

Set `MYSQL_PASSWORD` through `.env.secrets` or the deployment secret manager.

The API creates provider tables on startup when it can connect. After switching
providers, rebuild projections through the admin endpoint documented in
`docs/setup/ENVIRONMENT.md` and validate `/discover`, `/skills`, and
`/skills/search`.

Custom or future database providers should follow the provider boundary described
in `docs/product/AGENT_OPERATIONS.md`.

## Agent API Auth On Servers

For explicitly open private-network deployments, proposal APIs may stay open only when
the deployment is protected by trusted network or reverse-proxy controls. In
production mode this requires an explicit override:

```env
REGISTRY_ID=team-private
REGISTRY_NAME=Team ManagedSkillHub
PUBLIC_API_BASE_URL=https://skills.example.com/api
API_TRUSTED_PROXIES=127.0.0.1,::1
PUBLIC_READ_AUTH_MODE=none
PROPOSAL_AUTH_MODE=none
ALLOW_OPEN_PROPOSALS_IN_PRODUCTION=true
DISCOVERY_AUTH_MODE=none
```

For protected consumption and proposal submission, enable bearer modes and
provide secrets through the server environment or secret manager. This is the
recommended production baseline:

```env
REGISTRY_ID=company-prod
REGISTRY_NAME=Company Production Skill Registry
PUBLIC_API_BASE_URL=https://skills.example.com/api
API_TRUSTED_PROXIES=127.0.0.1,::1
PUBLIC_READ_AUTH_MODE=bearer
PROPOSAL_AUTH_MODE=bearer
DISCOVERY_AUTH_MODE=none
PROPOSAL_RATE_LIMIT_WINDOW_MS=60000
PROPOSAL_RATE_LIMIT_MAX_REQUESTS=120
PROPOSAL_RATE_LIMIT_MAX_BUCKETS=10000
```

`API_TRUSTED_PROXIES` must contain only reverse proxies that connect directly
to the API. Keep it empty when clients connect to the API directly. The
in-process proposal limiter is a defense-in-depth control; every public or
multi-instance deployment must also enforce request, connection, and body-size
limits at nginx or the API gateway.

After deployment, validate `/discover`. It should return the expected
`registryId`, `apiBaseUrl`, auth flags, and active auth schemes. A
The `agent-session` URL is advertised when at least one area uses static bearer auth and agent sessions are enabled. OIDC consumers use the advertised Device Authorization metadata.

## Authentik/OIDC Deployment

The Authentik runtime profile is documented in
[`docs/setup/AUTHENTIK.md`](./AUTHENTIK.md) and
`.env.example.authentik`. It preserves independent `none`, `bearer`, and
`oidc` choices for discovery, published reads, and proposals. It also replaces
the password admin form with server-side Authorization Code login when
`ADMIN_AUTH_MODE=oidc`.

Run it in staging first. Production activation requires the real Authentik
gate, reverse-proxy callback proof, two-human ownership proof, key rotation,
provider-outage validation, and rollback rehearsal from
[`docs/setup/AUTHENTIK.md`](./AUTHENTIK.md). Keep the last proven simple/bearer
profile in the secret manager during the rollback window.

## nginx

An example nginx configuration is documented in `docs/setup/NGINX.md`. It must
be created manually on the server under
`/etc/nginx/sites-available/managed-skill-hub` and then enabled.
