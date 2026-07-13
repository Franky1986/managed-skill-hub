# ENVIRONMENT

This repository uses a single runtime configuration file:

- `/.env` in repository root

Do not keep per-app `.env` files anymore. Keep all configuration in repository
root `/.env`.

Available templates:

- `.env.example`: current provider-neutral development template.
- `.env.example.simple`: complete current-runtime simple-auth profile.
- `.env.example.authentik`: accepted ADR-015 target profile; OIDC runtime
  support is not implemented yet.

## Root `.env` (copy this first)

```bash
cp .env.example .env
```

For an explicit currently supported simple profile:

```bash
cp .env.example.simple .env
```

## Core Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | no | Runtime mode for scripts/build context. | `development` |
| `DATA_DIR` | no | Persistent repository data root. Relative paths resolve against repo root. | `./data` |
| `FRONTEND_PORT` | no | Vite dev port. | `3041` |
| `API_HOST` | no | Backend bind host. | `127.0.0.1` |
| `API_PORT` | no | Backend bind port. | `3040` |
| `API_TRUSTED_PROXIES` | no | Comma-separated IP/CIDR allowlist of reverse proxies whose forwarded client IP headers Fastify may trust. Keep empty for direct API access. | `127.0.0.1,::1` |
| `API_PREFIX` | no | Optional API path prefix for single-host deployments. | `` or `/api` |
| `REGISTRY_ID` | no | Stable local alias suggested to clients for this ManagedSkillHub instance. | `local` |
| `REGISTRY_NAME` | no | Human-readable registry name exposed by `/discover`. | `ManagedSkillHub Local` |
| `PUBLIC_API_BASE_URL` | no | Externally reachable API base URL used in discovery and generated setup scripts. | `http://localhost:3040` |
| `CORS_ALLOWED_ORIGINS` | no | Comma-separated browser origins allowed to call the API with credentials. Originless CLI/server requests are still allowed. | `http://localhost:3041,http://127.0.0.1:3041` |

## Auth / Security

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ADMIN_USER` | yes | Admin username for login. | `admin` |
| `ADMIN_PASSWORD` | no | Plaintext admin password (local/dev). Takes precedence over hash. | `admin` |
| `ADMIN_PASSWORD_HASH` | no | BCrypt hash fallback when `ADMIN_PASSWORD` is not set. | `$2b$10$...` |
| `JWT_SECRET` | yes | Session signing key. | `change-me-in-production` |
| `SESSION_TTL_SECONDS` | no | Admin session lifetime in seconds. | `86400` |
| `ADMIN_CSRF_ORIGIN_CHECK` | no | When enabled, authenticated admin mutations reject unexpected browser `Origin`/`Referer` origins. | `true` |

When `NODE_ENV=production`, startup fails if `JWT_SECRET` is still the default
or shorter than 32 characters, if `ADMIN_PASSWORD` is set directly, if
`ADMIN_PASSWORD_HASH` is missing, if `CORS_ALLOWED_ORIGINS` contains `*`, or if
`PROPOSAL_AUTH_MODE=none` without explicitly setting
`ALLOW_OPEN_PROPOSALS_IN_PRODUCTION=true`. Use `ADMIN_PASSWORD` only for
local/dev-like setups.

## Agent API Auth

Agent-facing auth is separate from admin session auth. Supported modes are `none` and `bearer`. Defaults keep local development open.

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `PUBLIC_READ_AUTH_MODE` | no | Auth for published-skill read/search/download endpoints. | `none` or `bearer` |
| `PUBLIC_READ_BEARER_TOKEN` | when bearer | Read token for agents/clients. | `read-token` |
| `PUBLIC_READ_BEARER_ACTOR` | no | Audit/display actor for read bearer token. | `agent-read-token` |
| `PROPOSAL_AUTH_MODE` | no | Auth for duplicate check, proposal submit, upload, finalize, notice, and status. | `none` or `bearer` |
| `PROPOSAL_BEARER_TOKEN` | when bearer | Proposal workflow token. | `proposal-token` |
| `PROPOSAL_BEARER_ACTOR` | no | Authoritative actor for proposal bearer token. | `agent-proposal-token` |
| `ALLOW_OPEN_PROPOSALS_IN_PRODUCTION` | no | Explicit override that permits `PROPOSAL_AUTH_MODE=none` in production. Keep `false` unless the deployment is intentionally open and protected by network/proxy controls. | `false` |
| `DISCOVERY_AUTH_MODE` | no | Auth for `/discover`, `/howToPropose`, and `/openapi.yaml`. | `none` or `bearer` |
| `DISCOVERY_BEARER_TOKEN` | when bearer | Discovery token. | `discovery-token` |
| `DISCOVERY_BEARER_ACTOR` | no | Actor label for discovery bearer token. | `agent-discovery-token` |

When `PROPOSAL_AUTH_MODE=bearer`, the authenticated bearer actor is used for proposal submission/upload/finalization instead of trusting `X-Actor`. Proposal status uses the same proposal auth mode; there is no separate status token.

Consumer credentials should be stored per registry alias/base URL outside agent conversations, for example in `~/.managed-skill-hub/credentials.json`. When any agent auth is enabled, `/discover` points to `/agent-credentials/setup.sh`, which generates a no-secret local setup script for this registry.

Protected agent routes return `401` with machine-readable `details.authRequired`, `details.authArea`, `details.authScheme`, `details.discoverUrl`, and `details.credentialSetupScriptUrl` so agents can ask the user for setup-script confirmation instead of requesting tokens in chat.

## Planned Authentik/OIDC Profile

[ADR-015](../decisions/ADR-015-authentik-oidc-and-delegated-agent-identity.md)
accepts `oidc` as a future third mode for discovery, published reads, and
proposals, plus `ADMIN_AUTH_MODE=simple|oidc`. This is a target contract, not a
current runtime feature. The current config parser rejects `oidc` for agent API
areas and still requires simple admin credentials in production.

The target profile is documented in `.env.example.authentik` and
[`docs/setup/AUTHENTIK.md`](./AUTHENTIK.md). Its principal settings are:

| Variable | Target purpose |
|---|---|
| `ADMIN_AUTH_MODE` | Select `simple` or OIDC admin login. |
| `OIDC_AGENT_ISSUER` | Exact issuer for the public authentik Device Authorization provider. |
| `OIDC_AGENT_CLIENT_ID` | Public device client ID; no client secret exists. |
| `OIDC_AGENT_BASE_SCOPES` | OIDC identity scopes requested by agents. |
| `OIDC_DISCOVERY_SCOPE` | API scope required only when discovery uses OIDC. |
| `OIDC_PUBLIC_READ_SCOPE` | API scope required for protected published reads. |
| `OIDC_PROPOSAL_SCOPE` | API scope required for proposal operations. |
| `OIDC_ADMIN_ISSUER` | Exact issuer for the admin web provider. |
| `OIDC_ADMIN_CLIENT_ID` | Confidential admin client ID. |
| `OIDC_ADMIN_CLIENT_SECRET` | Admin client secret supplied through deployment secret management. |
| `OIDC_ADMIN_REDIRECT_URI` | Exact server-side admin callback URI. |
| `OIDC_PROPOSAL_ACCESS` | `all_authenticated_users` or `required_groups`. |
| `OIDC_PROPOSAL_GROUPS` | Required proposal groups when group policy is selected. |
| `OIDC_PUBLIC_READ_ACCESS` | `all_authenticated_users` or `required_groups`. |
| `OIDC_PUBLIC_READ_GROUPS` | Required read groups when group policy is selected. |
| `OIDC_ADMIN_SUBJECTS` | Stable authentik user UUIDs for initial admin bootstrap. |
| `OIDC_ADMIN_GROUPS` | Admin group names, normally `managedskillhub-admins`. |
| `OIDC_REVIEWER_GROUPS` | Reviewer group names. |
| `OIDC_PUBLISHER_GROUPS` | Publisher group names. |

When implemented, `OIDC_PROPOSAL_ACCESS=all_authenticated_users` allows every
active interactive human accepted by the configured authentik application to
submit proposals and read status by a known proposal UUID. It does not expose a
proposal list and does not permit cross-owner mutation.

## Provider + Data

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `CATALOG_PROVIDER` | yes | Skill catalog backend. | `sqlite` |
| `SEARCH_PROVIDER` | yes | Search backend. | `sqlite` |
| `CONTENT_STORAGE_PROVIDER` | no | Physical storage for managed skill/proposal content (`filesystem` or `database`). `filesystem` is default. `database` follows `CATALOG_PROVIDER` and supports SQLite or MySQL content storage. | `filesystem` |
| `MYSQL_HOST` | no | Required if either provider is `mysql`. | `127.0.0.1` |
| `MYSQL_PORT` | no | MySQL TCP port. | `3306` |
| `MYSQL_DATABASE` | no | MySQL schema name. | `managed_skill_hub` |
| `MYSQL_USER` | no | MySQL user. | `managed_skill_hub` |
| `MYSQL_PASSWORD` | no | MySQL password. | *(empty)* |
| `MYSQL_SSL_MODE` | no | TLS behavior (`preferred|required|disabled|verify_ca|verify_identity`). | `preferred` |
| `MYSQL_CONNECT_TIMEOUT_MS` | no | MySQL connect timeout. | `10000` |
| `MYSQL_QUERY_TIMEOUT_MS` | no | MySQL per-query timeout. | `30000` |


### Content Storage Provider

`CONTENT_STORAGE_PROVIDER` is intentionally internal to persistence. Public APIs, admin APIs, frontend behavior, agent contracts, downloaded bytes, hashes, content digests, and artifact IDs must stay equivalent across storage providers.

Supported first-stage modes:

- `CONTENT_STORAGE_PROVIDER=filesystem`: default mode; managed content is stored under `DATA_DIR/skills`, `DATA_DIR/proposals`, and `DATA_DIR/audit`.
- `CONTENT_STORAGE_PROVIDER=database` with `CATALOG_PROVIDER=sqlite`: managed skill files, proposal files, extracts, aggregates, and audit entries are stored in SQLite content tables under `DATA_DIR/index/search.db`. This mode is covered by `scripts/check-content-storage-matrix.ts`.
- `CONTENT_STORAGE_PROVIDER=database` with `CATALOG_PROVIDER=mysql`: managed skill files, proposal files, extracts, aggregates, and audit entries are stored in MySQL content tables. This mode is covered by `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh`.

Backup note: `scripts/backup.sh` intentionally fails fast for MySQL database-content mode because a `DATA_DIR` archive alone is incomplete. Use a tested MySQL dump/restore procedure until dedicated backup automation is implemented.

Cutover note: filesystem-to-database migration should be copy-only and run during a maintenance window. Keep the original filesystem data until database-mode parity checks and at least one complete backup/restore cycle have been validated. See [EPIC-009](../roadmap/EPIC-009-database-backed-content-storage.md) for cutover and rollback guidance.

## Judger

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `JUDGER_PROVIDER` | yes | Judger backend selector (`noop`, `vercel-ai-sdk`) or custom provider key (`my-custom-judger`). | `noop` |
| `JUDGER_ADAPTER_PATH` | no | Required when `JUDGER_PROVIDER` is custom/non-built-in. | `./path/to/custom.adapter.ts` |
| `VERCEL_AI_SDK_MODEL` | no | Active model with provider prefix. | `openai:gpt-4.1` |
| `OPENAI_API_KEY` | no | OpenAI key when VERCEL model uses OpenAI. | `sk-...` |
| `VERCEL_AI_SDK_TIMEOUT_MS` | no | Vercel timeout in ms. | `30000` |
| `VERCEL_AI_SDK_MAX_TEXT_CHARS` | no | Max chars per judgment request. | `12000` |
| `VERCEL_AI_SDK_MAX_RETRIES` | no | Retry count. | `0` |

Notes:

- `JUDGER_PROVIDER=noop` marks proposals as `overallRisk=no_judge_available` for proposal/file judgements. This is a clear signal that no real automated judgement was performed yet; auto-publish remains blocked unless `AUTO_APPROVE_WITHOUT_JUDGER=true`.
- `JUDGER_PROVIDER` can also be any custom identifier when `JUDGER_ADAPTER_PATH` points to a module implementing `SkillJudgerPort`.
- For a complete example and export contract, see [`docs/setup/JUDGER_ADAPTERS.md`](./JUDGER_ADAPTERS.md).

## Proposal and Auto-Publish

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `PROPOSAL_MAX_FILES` | no | Upload cap per proposal. | `30` |
| `PROPOSAL_MAX_FILE_SIZE_BYTES` | no | Max bytes per upload file. | `10485760` |
| `PROPOSAL_DISALLOWED_PATHS` | no | Comma list of blocked paths. | `node_modules/,.venv/,venv/` |
| `PROPOSAL_RATE_LIMIT_WINDOW_MS` | no | In-memory proposal API rate-limit window per bearer actor or IP. | `60000` |
| `PROPOSAL_RATE_LIMIT_MAX_REQUESTS` | no | Max proposal API requests per window. Applies to create, patch, upload, validate, finalize, delete, notice, status, and duplicate check. | `120` |
| `PROPOSAL_RATE_LIMIT_MAX_BUCKETS` | no | Maximum in-memory identity buckets retained by one API process. Expired buckets are removed lazily; new identities receive `429` while all active buckets are occupied so existing limits cannot be reset through eviction. | `10000` |
| `AUTO_PUBLISH_ON_GREEN` | no | Automatically publish final green proposals. | `false` |
| `AUTO_APPROVE_WITHOUT_JUDGER` | no | If `true`, allows automatic publication even when only `noop` judgements are present. | `false` |
| `AUTO_PUBLISH_EXCLUDED_CATEGORIES` | no | Blocklist categories for auto-publish. | `security,automation` |

## Frontend

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VITE_API_BASE_URL` | yes | Backend base URL. | `http://localhost:3040` |
| `VITE_USE_API_PROXY` | no | Set `false` to bypass Vite proxy. | `true` |

## Environment switching
When switching environments, copy the template and update the required keys:

```bash
cp .env.example .env
```

Do not copy `.env.example.authentik` into an active deployment until the
ADR-015 implementation gate is complete. Follow
[`docs/setup/AUTHENTIK.md`](./AUTHENTIK.md) for staging proof and cutover.

Then restart the stack and check relevant endpoints (`/health`, `/discover`, `/skills`,
`/skills/search`) to validate the active provider, auth, and judger setup.

## Provider cutover checklist

1. Set both provider flags in `.env`:

```bash
CATALOG_PROVIDER=mysql
SEARCH_PROVIDER=mysql
```

2. Set MySQL credentials (`MYSQL_*`) and restart.
3. Run projection rebuild after login:

```bash
curl -b cookies.txt -X POST "http://localhost:3040/admin/projections/rebuild?clearProjections=true"
```

4. Validate `/discover`, `/skills`, and `/skills/search` parity.

## Security notes

- Never commit `.env`.
- `DATA_DIR` is resolved relative to repo root when relative.
- Prefer `ADMIN_PASSWORD` only for local/dev-like setups; use `ADMIN_PASSWORD_HASH`
  in long-running or shared environments.
- Configure `CORS_ALLOWED_ORIGINS` explicitly for every deployed frontend origin.
- Configure `API_TRUSTED_PROXIES` only for proxies that connect directly to the
  API; never trust arbitrary forwarded headers on a directly exposed API.
- Treat the in-memory proposal limiter as defense in depth. Public and
  multi-instance deployments also require reverse-proxy or API-gateway request,
  connection, and body-size limits.
- Artifact endpoints send `nosniff` and sandbox CSP headers; active browser
  artifact types are downloaded as attachments instead of being rendered inline.

For deployment checks, see [`docs/setup/DEPLOYMENT.md`](./DEPLOYMENT.md).

## Custom Judger Options

Provider-specific settings are owned and parsed by the custom adapter rather
than the ManagedSkillHub core. See
[`docs/setup/JUDGER_ADAPTERS.md`](./JUDGER_ADAPTERS.md).
