# ENVIRONMENT

This repository uses two layered runtime files:

- `/.env` for non-secret configuration;
- `/.env.secrets` for local credentials, keys, and tokens.

Do not keep per-app `.env` files. Exported process variables have highest
precedence, followed by `.env.secrets`, then `.env`. This supports deployment
secret managers without duplicating the configuration model in JSON.

Available templates:

- `.env.example`: provider-neutral development template.
- `.env.example.simple`: complete simple-auth profile.
- `.env.example.authentik`: OIDC staging profile; production activation
  requires the real Authentik gate.
- `.env.secrets.example`: blank inventory of supported secret keys.

## Root `.env` (copy this first)

```bash
cp .env.example .env
cp .env.secrets.example .env.secrets
chmod 600 .env .env.secrets
```

For an explicit currently supported simple profile:

```bash
cp .env.example.simple .env
```

Agents may edit `.env` and tracked profile templates because they contain no
secret assignments. A human operator or deployment secret manager owns
`.env.secrets`; agents should not read it. Migrate an older mixed file with:

```bash
./node_modules/.bin/tsx scripts/migrate-env-layout.ts --check
./node_modules/.bin/tsx scripts/migrate-env-layout.ts --write
```

The migration reports key names only, moves secrets atomically, and appends
missing non-secret settings from `.env.example` without changing existing
values.

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

Secret variables (`ADMIN_PASSWORD`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET`, bearer
tokens, OIDC client secrets, database passwords, and API keys) belong in
`.env.secrets` or an external secret manager. Their related modes, actors,
client IDs, issuers, scopes, and policies remain in `.env`.

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ADMIN_AUTH_MODE` | no | Select `simple` or `oidc`. | `simple` |
| `ADMIN_USER` | simple mode | Admin username for local login. | `admin` |
| `ADMIN_PASSWORD` | no | Plaintext admin password (local/dev). Takes precedence over hash. | `admin` |
| `ADMIN_PASSWORD_HASH` | no | BCrypt hash fallback when `ADMIN_PASSWORD` is not set. | `$2b$10$...` |
| `JWT_SECRET` | simple mode | Simple-session signing key; unused in OIDC mode. | `change-me-in-production` |
| `SESSION_TTL_SECONDS` | no | Admin session lifetime in seconds. | `86400` |
| `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS` | no | In-process simple-login attempt window per trusted client address. | `300000` |
| `ADMIN_LOGIN_RATE_LIMIT_MAX_REQUESTS` | no | Maximum simple-login attempts per window. | `10` |
| `ADMIN_LOGIN_RATE_LIMIT_MAX_BUCKETS` | no | Maximum tracked client-address buckets. | `10000` |
| `ADMIN_CSRF_ORIGIN_CHECK` | no | When enabled, authenticated admin mutations reject unexpected browser `Origin`/`Referer` origins. | `true` |
| `ADMIN_UI_BASE_PATH` | no | Relative path prefix accepted for post-OIDC-login redirects. | `/frontend/admin` |

When `NODE_ENV=production` and simple admin auth is active, startup fails if
`JWT_SECRET` is still the default or shorter than 32 characters, if
`ADMIN_PASSWORD` is set directly, or if `ADMIN_PASSWORD_HASH` is missing.
OIDC admin mode instead rejects any explicitly configured simple credentials
and requires its confidential client settings. All modes reject
`CORS_ALLOWED_ORIGINS=*` and reject
`PROPOSAL_AUTH_MODE=none` without explicitly setting
`ALLOW_OPEN_PROPOSALS_IN_PRODUCTION=true`. Use `ADMIN_PASSWORD` only for
local/dev-like setups.

`SESSION_TTL_SECONDS` is bounded to 5 minutes through 7 days. Simple password
login is also protected by the in-process
`ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS`, `ADMIN_LOGIN_RATE_LIMIT_MAX_REQUESTS`, and
`ADMIN_LOGIN_RATE_LIMIT_MAX_BUCKETS` limits. The reverse-proxy limiter remains a
second, deployment-level layer.

## Agent API Auth

Agent-facing auth is separate from admin session auth. Supported modes are
`none`, `bearer`, and `oidc`, independently per area. Defaults keep local
development open.

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `PUBLIC_READ_AUTH_MODE` | no | Auth for published-skill read/search/download endpoints. | `none`, `bearer`, or `oidc` |
| `PUBLIC_READ_BEARER_TOKEN` | when bearer | Read token for agents/clients; production requires at least 32 random bytes. | generated secret |
| `PUBLIC_READ_BEARER_ACTOR` | no | Audit/display actor for read bearer token. | `agent-read-token` |
| `PROPOSAL_AUTH_MODE` | no | Auth for duplicate check, proposal submit, upload, finalize, notice, and status. | `none`, `bearer`, or `oidc` |
| `PROPOSAL_BEARER_TOKEN` | when bearer | Proposal workflow token; production requires at least 32 random bytes. | generated secret |
| `PROPOSAL_BEARER_ACTOR` | no | Authoritative actor for proposal bearer token. | `agent-proposal-token` |
| `ALLOW_OPEN_PROPOSALS_IN_PRODUCTION` | no | Explicit override that permits `PROPOSAL_AUTH_MODE=none` in production. Keep `false` unless the deployment is intentionally open and protected by network/proxy controls. | `false` |
| `DISCOVERY_AUTH_MODE` | no | Auth for `/discover`, `/howToPropose`, and `/openapi.yaml`. | `none`, `bearer`, or `oidc` |
| `DISCOVERY_BEARER_TOKEN` | when bearer | Discovery token; production requires at least 32 random bytes. | generated secret |
| `DISCOVERY_BEARER_ACTOR` | no | Actor label for discovery bearer token. | `agent-discovery-token` |

When `PROPOSAL_AUTH_MODE=bearer`, the authenticated bearer actor is used for proposal submission/upload/finalization instead of trusting `X-Actor`. Proposal status uses the same proposal auth mode; there is no separate status token.

Static bearer credentials should be stored per registry alias/base URL outside
agent conversations, for example in `~/.managed-skill-hub/credentials.json`.
The generated setup script configures only areas that actually use bearer mode.
OIDC areas use the advertised Device Authorization linkout and do not write
tokens into this credential file.

Generate static production tokens from a cryptographic random source, for
example `openssl rand -base64 32`. `none` trusts the caller-provided `X-Actor`
label and therefore provides no verified identity or owner isolation. A static
bearer token provides one shared actor for every holder. Per-human ownership is
available only with OIDC.

The public React catalog does not store agent bearer/OIDC tokens. With
`PUBLIC_READ_AUTH_MODE=none`, it is anonymously browsable. With protected
public reads, an active admin browser session whose principal has `reader` or
`admin` may read the published catalog as an alternative to the configured
agent credential. This exception is read-only and does not apply to discovery
or proposal routes. The proposal badge uses `/admin/proposals/notice`.

Protected agent routes return `401` with machine-readable `details.authRequired`, `details.authArea`, `details.authScheme`, `details.discoverUrl`, and `details.credentialSetupScriptUrl` so agents can ask the user for setup-script confirmation instead of requesting tokens in chat.

### Agent Session Delegation

Short-lived, area-scoped agent sessions are available when at least one
agent-facing area uses `bearer`. A human enters area bearer tokens in the
browser at `/frontend/agent-auth` and receives an 8-character code the agent
can use as `Authorization: AgentSession <code>`.

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `AGENT_SESSION_ENABLED` | no | Feature toggle. Set `false` to disable agent sessions. | `true` |
| `AGENT_SESSION_TTL_SECONDS` | no | Default lifetime for a new agent session. | `10800` (3 hours) |
| `AGENT_SESSION_CODE_LENGTH` | no | Number of characters in a session code. | `8` |
| `AGENT_SESSION_CODE_CHARSET` | no | URL-safe, case-insensitive alphabet for codes. | `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` |
| `AGENT_SESSION_MAX_ACTIVE` | no | Optional per-IP cap on active sessions. `none`/`null`/`unlimited` disables the cap. | `10` |

The area bearer token values themselves remain in `.env.secrets` or a deployment
secret manager; the human receives them through a separate trusted channel.

## Authentik/OIDC Profile

[ADR-015](../decisions/ADR-015-authentik-oidc-and-delegated-agent-identity.md)
defines `oidc` for discovery, published reads, and proposals, plus
`ADMIN_AUTH_MODE=simple|oidc`. The runtime validates these combinations and
fails closed when selected OIDC settings are incomplete or unsafe.

The target profile is documented in `.env.example.authentik` and
[`docs/setup/AUTHENTIK.md`](./AUTHENTIK.md). Its principal settings are:

| Variable | Purpose |
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
| `OIDC_HUMAN_CLAIM` | Boolean Authentik access-token claim proving an interactive human. |
| `OIDC_LOGIN_TRANSACTION_TTL_SECONDS` | One-time admin callback transaction lifetime. |
| `OIDC_CLOCK_TOLERANCE_SECONDS` | Bounded JWT time-claim tolerance. |
| `OIDC_JWKS_CACHE_TTL_SECONDS` | Successful JWKS cache lifetime. |
| `OIDC_HTTP_TIMEOUT_MS` | Provider discovery/JWKS timeout. |
| `OIDC_MAX_TOKEN_BYTES` | Maximum accepted bearer token size. |
| `OIDC_MAX_GROUPS` | Maximum accepted group-claim cardinality. |
| `OIDC_ACCESS_TOKEN_VALIDATION_MODE` | `jwt_profile` requires RFC 9068 `at+jwt`; `authentik_introspection` additionally verifies Authentik `JWT` access tokens through authenticated introspection. |
| `OIDC_INTROSPECTION_CLIENT_ID` | Confidential checker client used only in Authentik introspection mode. |
| `OIDC_INTROSPECTION_CLIENT_SECRET` | Checker secret supplied through deployment secret management. |

Security-sensitive values have finite startup ranges: login transaction TTL
60-900 seconds, clock tolerance 0-300 seconds, JWKS cache 60-86400 seconds,
provider timeout 250-30000 ms, token size 1024-65536 bytes, and group count
1-500. Production admin and introspection client secrets must contain at least
32 bytes and must not be example values.

`OIDC_PROPOSAL_ACCESS=all_authenticated_users` allows every
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
| `PUBLISH_JUDGEMENT_POLICY` | no | Publication gate: `disabled` skips the check, `warn` records incomplete judgement and publishes, `required` blocks until every extractable file and the skill version have a real judgement. Administrators may override `required` with an audited reason. | `required` in production, otherwise `warn` |
| `VERCEL_AI_SDK_MODEL` | no | Active model with provider prefix. | `openai:gpt-4.1` |
| `OPENAI_API_KEY` | no | OpenAI key when VERCEL model uses OpenAI. | `sk-...` |
| `VERCEL_AI_SDK_TIMEOUT_MS` | no | Vercel timeout in ms. | `30000` |
| `VERCEL_AI_SDK_MAX_TEXT_CHARS` | no | Max chars per judgment request. | `12000` |
| `VERCEL_AI_SDK_MAX_RETRIES` | no | Retry count. | `0` |

Notes:

- `JUDGER_PROVIDER=noop` marks proposals as `overallRisk=no_judge_available` for proposal/file judgements. This is a clear signal that no real automated judgement was performed yet; auto-publish remains blocked unless `AUTO_APPROVE_WITHOUT_JUDGER=true`.
- `JUDGER_PROVIDER` can also be any custom identifier when `JUDGER_ADAPTER_PATH` points to a module implementing `SkillJudgerPort`.
- Built-in providers ignore `JUDGER_ADAPTER_PATH`. Development logs emit `judger_adapter_path_ignored`; production startup rejects this contradictory combination.
- Proposal details expose `not_started`, `completed`, `unavailable`, or `failed` judgement execution states for the proposal and each file. Provider errors remain server-side and are represented by a safe status message.
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

Use `.env.example.authentik` in staging first. Do not activate it in production
until the real Authentik gate and rollback rehearsal in
[`docs/setup/AUTHENTIK.md`](./AUTHENTIK.md) have current evidence.

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
