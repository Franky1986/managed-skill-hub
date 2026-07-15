# Spec: AppConfig / Provider and Judger Selection

## Purpose

Central API server configuration, especially:

- resolution and validation of the `DATA_DIR` path,
- explicit catalog/search provider selection,
- explicit judger provider selection,
- built-in Vercel AI SDK settings and MySQL adapter settings.

## Scope

- Load non-secret configuration from `.env` and local secrets from
  `.env.secrets`, with exported process variables taking precedence.
- Resolve `DATA_DIR`, absolute or relative to the project root.
- Validate that the directory can be written.
- Parse `CATALOG_PROVIDER`, `SEARCH_PROVIDER`, and `JUDGER_PROVIDER`.
- Parse `AUTO_APPROVE_WITHOUT_JUDGER` and include it in app config.
- Parse `AUTO_PUBLISH_SIMILARITY_THRESHOLD` as a bounded number from `0` to `1`
  with a default of `0.5`.
- Parse and expose provider-neutral judger selection, built-in Vercel AI SDK
  settings, and MySQL settings.
- Leave custom adapter-specific environment parsing to the adapter module.
- Parse proposal API rate-limit settings and the explicit production override
  for open proposal APIs.
- Parse an explicit trusted-proxy allowlist used for forwarded client IPs.
- Parse `simple|oidc` admin auth and independent `none|bearer|oidc` discovery,
  published-read, and proposal auth modes.
- Parse OIDC issuers, clients, scopes, group policies, role mappings, callback
  and UI paths, protocol timeouts, token/group limits, cache lifetimes, and the
  strict-JWT-profile versus authenticated-introspection validation mode.
- Parse bounded simple-admin login rate-limit settings.

## Non-Scope

- Business logic
- Frontend configuration

## Responsibilities

- `loadConfig()` loads `.env.secrets` before `.env` so the Node loader applies
  `process environment > secrets > config`, then calls
  `resolveDataDir()`.
- `resolveDataDir()` keeps absolute paths and resolves relative paths against
  the project root.
- `validateDataDir()` checks whether the directory can be created and written.
- `parseCatalogProvider()` defaults missing `CATALOG_PROVIDER` to `sqlite`.
- `parseSearchProvider()` defaults missing `SEARCH_PROVIDER` to `sqlite`.
- `parseJudgerProvider()` allows `noop`, `vercel-ai-sdk`, and custom provider identifiers.
- `parseMySqlSslMode()` accepts `preferred`, `required`, `disabled`,
  `verify_ca`, and `verify_identity`.

## Inputs / Outputs

- Inputs: environment variables.
- Outputs: `AppConfig` with catalog/search/judger and MySQL configuration.

## Failure Modes

- Missing `JUDGER_PROVIDER` -> `ConfigurationError`.
- Unsupported `CATALOG_PROVIDER` or `SEARCH_PROVIDER` values -> `ConfigurationError`.
- Unknown `JUDGER_PROVIDER` values are accepted; custom providers require a valid `JUDGER_ADAPTER_PATH`.
- `VERCEL_AI_SDK_MODEL` missing while `JUDGER_PROVIDER=vercel-ai-sdk` ->
  startup validation failure.
- Missing or `false` by default for `AUTO_APPROVE_WITHOUT_JUDGER` prevents auto-
  publish when `JUDGER_PROVIDER=noop`.
- Invalid `MYSQL_SSL_MODE` -> `ConfigurationError`.
- Missing MySQL identity settings when a MySQL provider is active ->
  startup validation failure.
- `NODE_ENV=production` with `PROPOSAL_AUTH_MODE=none` and no explicit
  `ALLOW_OPEN_PROPOSALS_IN_PRODUCTION=true` -> startup validation failure.
- An OIDC-selected area without exact issuer, client ID, or area scope ->
  startup validation failure.
- Authentik introspection mode without confidential checker credentials ->
  startup validation failure.
- OIDC admin mode without confidential client settings, exact callback,
  `openid`, and a subject/group admin bootstrap -> startup validation failure.
- OIDC admin mode with explicitly configured simple credentials -> startup
  validation failure; there is no implicit password fallback.
- Non-HTTPS issuer/callback URLs outside explicit localhost development,
  unsafe URL components, unknown access policies, or empty required groups ->
  startup validation failure.
- Production simple mode requires a strong `JWT_SECRET`, password hash, and no
  plaintext password. OIDC mode uses opaque server-side sessions and does not
  require local credentials or `JWT_SECRET`.
- Production static bearer mode requires at least 32 UTF-8 bytes and rejects
  known example/default values.
- Production confidential OIDC admin and introspection secrets require at least
  32 UTF-8 bytes and reject known example/default values.
- Session TTL, OIDC clock tolerance, transaction/JWKS lifetimes, HTTP timeout,
  token size, and group count outside their finite ranges -> startup failure.
- `DATA_DIR` is not writable -> `ConfigurationError` with clear hint to the
  environment variable.
- `DATA_DIR` is a relative path -> resolved against project root.

## Acceptance Criteria

- `./data` resolves to `<repo-root>/data`.
- `/tmp/managed-skill-hub/data` remains unchanged.
- Unsupported provider values are rejected for catalog and search.
- `JUDGER_PROVIDER` supports custom adapter-backed values.
- MySQL provider selection validates required settings.
- `CATALOG_PROVIDER` and `SEARCH_PROVIDER` default to `sqlite`.
- Startup checks whether `DATA_DIR` is writable.
- Production startup fails for open proposal APIs unless explicitly allowed.
- Proposal API rate-limit settings default to a finite window and request cap.
- Auto-publish similarity defaults to `0.5` when no environment override is set.
- Trusted proxy handling defaults off and accepts explicit IP/CIDR entries from
  `API_TRUSTED_PROXIES`.
- Proposal API rate limiting has a finite in-memory identity-bucket cap.
- All 27 agent-area auth combinations parse independently.
- OIDC protocol size, timeout, clock, transaction, and JWKS-cache bounds have
  finite defaults and reject invalid integers.
- With non-writable `DATA_DIR`, server does not start and returns a
  `CONFIGURATION_ERROR` response.

## Tests / Checks

- Unit tests for `resolveDataDir`: absolute, relative, trim.
- Unit tests for `parseCatalogProvider`, `parseSearchProvider`, and
  `parseJudgerProvider` with valid/invalid values.
- Integration test: server does not start when `DATA_DIR` points to a
  non-writable directory.

## Agent Guardrails

- No business logic in config.
- Do not assume current working directory.
- Do not add custom adapter transport fields to `AppConfig`.
