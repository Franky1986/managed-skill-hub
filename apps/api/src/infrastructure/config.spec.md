# Spec: AppConfig / Provider and Judger Selection

## Purpose

Central API server configuration, especially:

- resolution and validation of the `DATA_DIR` path,
- explicit catalog/search provider selection,
- explicit judger provider selection,
- built-in Vercel AI SDK settings and MySQL adapter settings.

## Scope

- Load environment variables from `.env` files.
- Resolve `DATA_DIR`, absolute or relative to the project root.
- Validate that the directory can be written.
- Parse `CATALOG_PROVIDER`, `SEARCH_PROVIDER`, and `JUDGER_PROVIDER`.
- Parse `AUTO_APPROVE_WITHOUT_JUDGER` and include it in app config.
- Parse and expose provider-neutral judger selection, built-in Vercel AI SDK
  settings, and MySQL settings.
- Leave custom adapter-specific environment parsing to the adapter module.
- Parse proposal API rate-limit settings and the explicit production override
  for open proposal APIs.
- Parse an explicit trusted-proxy allowlist used for forwarded client IPs.

## Non-Scope

- Business logic
- Frontend configuration

## Responsibilities

- `loadConfig()` reads environment variables from `.env` files and calls
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
- Trusted proxy handling defaults off and accepts explicit IP/CIDR entries from
  `API_TRUSTED_PROXIES`.
- Proposal API rate limiting has a finite in-memory identity-bucket cap.
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
