# Agent Operations Guide

This document is the local runbook for agent-aware testing and operation of
`managed-skill-hub` with different projection providers and automation modes.

## Scope

Use this guide when you need a deterministic local setup for:

- validating both SQLite and MySQL provider modes
- switching between provider variants for parity checks
- understanding proposal auto-publish behavior while running locally
- preparing a repeatable environment for agent workflows and manual checks

Prerequisites:

- Root `/.env` contains one complete non-secret admin/auth profile. Root
  `/.env.secrets` contains local credentials and keys. Simple mode needs
  `ADMIN_PASSWORD` locally or `ADMIN_PASSWORD_HASH` plus `JWT_SECRET` in
  production; OIDC mode needs the Authentik admin provider settings instead.
- Optional shared settings remain in `.env`; provider API keys belong in
  `.env.secrets` or a deployment secret manager.
- Build output exists (`npm run build:prod`) when using `node apps/api/dist/server.js`.

## Authentication Profiles

- `.env.example.simple` is the runnable simple-admin profile.
- `.env.example` remains the provider-neutral development template.
- `.env.example.authentik` is the runnable OIDC staging profile; production
  activation requires the real Authentik gate in the setup playbook.

For Authentik operator setup, cutover, and rollback, use
[`docs/setup/AUTHENTIK.md`](../setup/AUTHENTIK.md). For agent Device
Authorization behavior, use
[`docs/product/AGENT_OIDC_DEVICE_FLOW.md`](./AGENT_OIDC_DEVICE_FLOW.md).

Do not test OIDC by placing Authentik credentials or tokens into agent prompts.
Use the trusted clickable link and provider-defined polling. Normal CI uses
`scripts/checks/check-oidc-provider.ts`; real staging uses the explicit gate described
in the setup playbook.

## Provider Profiles

Control the backend behavior with:

- `CATALOG_PROVIDER=sqlite|mysql`
- `SEARCH_PROVIDER=sqlite|mysql`

Supported combinations:

| Profile | `CATALOG_PROVIDER` | `SEARCH_PROVIDER` | Use case |
|---|---|---|---|
| `sqlite-only` | `sqlite` | `sqlite` | default local development, no MySQL dependency |
| `mysql-only` | `mysql` | `mysql` | full MySQL end-to-end parity test |
| `mixed-catalog-mysql` | `mysql` | `sqlite` | stage-only migration with stable search fallback |
| `mixed-search-mysql` | `sqlite` | `mysql` | search-cutover experiments with file-backed catalog |

Important:

- `CATALOG_PROVIDER` and `SEARCH_PROVIDER` can be mixed, but both are read at startup.
- A MySQL schema is created automatically on first successful startup when a MySQL provider is selected.

## Judger Provider Profiles

Control automated judgement with `JUDGER_PROVIDER`:

| Profile | Required env | Use case |
|---|---|---|
| `noop` | `JUDGER_PROVIDER=noop` | local default; creates `no_judge_available` placeholders |
| `vercel-ai-sdk` | `JUDGER_PROVIDER=vercel-ai-sdk`, `VERCEL_AI_SDK_MODEL`, provider token such as `OPENAI_API_KEY` | public built-in LLM judgement path |
| custom adapter | any custom `JUDGER_PROVIDER`, `JUDGER_ADAPTER_PATH` | private or third-party judgement transport |

### OpenAI through Vercel AI SDK

```bash
JUDGER_PROVIDER=vercel-ai-sdk \
VERCEL_AI_SDK_MODEL=openai:gpt-4.1 \
OPENAI_API_KEY=sk-... \
node apps/api/dist/server.js
```

The built-in adapter lives in
`apps/api/src/adapters/outbound/judger/vercel-ai-sdk.judger.ts` and returns the
same `SkillJudgerPort` contract as every other judger.

### Custom Judger Adapter

```bash
JUDGER_PROVIDER=my-custom-judger \
JUDGER_ADAPTER_PATH=./apps/api/src/adapters/outbound/judger/my-custom.judger.ts \
node apps/api/dist/server.js
```

A custom adapter module must export an implementation of `SkillJudgerPort`, a
`SkillJudgerAdapter` class, or one of the documented factory functions. The full
contract is in `docs/setup/JUDGER_ADAPTERS.md`.

Auto-publish treats `noop` judgements as not judged by default. Keep
`AUTO_APPROVE_WITHOUT_JUDGER=false` unless an operator explicitly accepts that
risk.

Manual publication has a separate gate:

```bash
PUBLISH_JUDGEMENT_POLICY=required
```

- `required` blocks publication until the skill version and every extractable
  file have a real judgement. An administrator can override the block only with
  an audited reason.
- `warn` records missing targets in the audit log and continues publication.
- `disabled` skips the publication judgement gate.

Production defaults to `required`; other environments default to `warn`.


## SQLite-Only Local Setup

1. Keep provider variables in local env:

```bash
export CATALOG_PROVIDER=sqlite
export SEARCH_PROVIDER=sqlite
```

2. Optionally ensure a clean data area for repeatable tests:

```bash
rm -rf /tmp/msh-sqlite-test
mkdir -p /tmp/msh-sqlite-test
```

3. Start the API from repository root:

```bash
cd /path/to/managed-skill-hub
npm run build:prod
API_HOST=127.0.0.1 \
API_PORT=3040 \
DATA_DIR=/tmp/msh-sqlite-test \
CATALOG_PROVIDER=sqlite \
SEARCH_PROVIDER=sqlite \
AUTO_PUBLISH_ON_GREEN=false \
AUTO_APPROVE_WITHOUT_JUDGER=false \
JUDGER_PROVIDER=noop \
node apps/api/dist/server.js
```

## MySQL Local Setup

1. Start the shared MySQL + phpMyAdmin stack from this repo:

```bash
cd /path/to/managed-skill-hub
bash scripts/development/start-mysql-stack.sh up
```

2. Verify services are running:

```bash
bash scripts/development/start-mysql-stack.sh status
```

3. Configure env and start for full MySQL:

```bash
API_HOST=127.0.0.1 \
API_PORT=3040 \
DATA_DIR=/tmp/msh-mysql-test \
CATALOG_PROVIDER=mysql \
SEARCH_PROVIDER=mysql \
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=33307 \
MYSQL_DATABASE=managed_skill_hub \
MYSQL_USER=managed_skill_hub \
MYSQL_PASSWORD=valpass \
MYSQL_SSL_MODE=disabled \
AUTO_PUBLISH_ON_GREEN=false \
AUTO_APPROVE_WITHOUT_JUDGER=false \
JUDGER_PROVIDER=noop \
node apps/api/dist/server.js
```

4. Open phpMyAdmin at `http://127.0.0.1:33308` if you need DB visibility.

5. Start the API from the repository root with `node apps/api/dist/server.js` after
   `npm run build:prod` or with the standard workspace start flow `bash scripts/development/restart-all.sh`.

### Troubleshooting phpMyAdmin host errors

If phpMyAdmin shows an error like `getaddrinfo: stale-mysql-container`,
a stale/old container name is still being used. Recreate the shared stack:

```bash
docker rm -f $(docker ps -aq --filter "name=managed-skill-hub-mysql") || true
bash scripts/development/start-mysql-stack.sh up
```

If your environment still needs a custom database name, keep `MYSQL_DATABASE`
consistent between `.env` and `MYSQL_DATABASE` in this section.

## Mixed Modes for Migration Testing

Use mixed mode to separate projection and search concerns during transition:

### catalog mysql + search sqlite

```bash
CATALOG_PROVIDER=mysql
SEARCH_PROVIDER=sqlite
```

### catalog sqlite + search mysql

```bash
CATALOG_PROVIDER=sqlite
SEARCH_PROVIDER=mysql
```

For mixed mode switches, keep the same `DATA_DIR` and run projections rebuild after
admin login:

```bash
curl -b cookies.txt -X POST \
  "http://localhost:3040/admin/projections/rebuild?clearProjections=true"
```

The admin login flow is documented in `docs/setup/TESTING.md`.

## Adding Another Database Provider Later

Relational providers are intentionally selected through ports and env flags.
For a future provider, keep the same boundary shape:

- add a new `CATALOG_PROVIDER` / `SEARCH_PROVIDER` value in config parsing
- implement `SkillCatalogPort` and/or `SkillSearchPort` in an outbound adapter
- add explicit schema setup/migration logic in that adapter layer
- run the provider-neutral catalog/search contract tests against the new adapter
- update `docs/setup/ENVIRONMENT.md`, this runbook, and the relevant adapter spec

Do not put provider-specific SQL, ranking behavior, or schema assumptions into
Domain or Use Cases.


## Auto-Publish Matrix

`AUTO_PUBLISH_ON_GREEN`, `AUTO_APPROVE_WITHOUT_JUDGER`, and
`AUTO_PUBLISH_EXCLUDED_CATEGORIES` are global options:

```bash
AUTO_PUBLISH_ON_GREEN=false
AUTO_APPROVE_WITHOUT_JUDGER=false
AUTO_PUBLISH_EXCLUDED_CATEGORIES=security,automation,filesystem,network
```

Behavior:

- `AUTO_PUBLISH_ON_GREEN=false` (default): proposals move through normal admin review.
- `AUTO_PUBLISH_ON_GREEN=true`: eligible finalized proposals can convert + publish
  automatically after all green judgements.
- `AUTO_APPROVE_WITHOUT_JUDGER=false` (default): `JUDGER_PROVIDER=noop` blocks
  auto-publish because no real judgement provider is active.
- `AUTO_APPROVE_WITHOUT_JUDGER=true`: allows auto-publish when only noop
  judgements are present.
- `AUTO_PUBLISH_EXCLUDED_CATEGORIES` blocks auto-publish for matching categories
  even if judging is green.

After `POST /proposals/{id}/finalize-upload`, check:

```bash
curl -s http://localhost:3040/proposals/<proposal-id>/status | jq \
  '{autoPublishEnabled, autoPublishEligible, autoPublishBlockedReason}'
```

and

```bash
curl -s -X POST http://localhost:3040/proposals/<proposal-id>/finalize-upload | jq \
  '{autoPublishStatus, autoPublishBlockedReason}'
```

If auto-publish is enabled and no blocker exists, expect
`autoPublishStatus=published`; otherwise `autoPublishStatus=skipped` and
`autoPublishBlockedReason` will state which check failed.

## Quick Provider Parity Checks

For a full quick check in one mode, you can run:

```bash
bash scripts/development/smoke-test.sh
```

Then repeat for the second provider profile to compare:

- catalog/search responses in `/skills`, `/skills/search`, and `/discover`
- admin endpoints for login, create, review flow, and projections rebuild

The same smoke test can be run after changing env for a second provider mode without
reinstalling dependencies.

### Two-Mode Validation Recipe

From repository root:

```bash
cd /path/to/managed-skill-hub

# SQLite mode
API_URL=http://localhost:3040 \
CATALOG_PROVIDER=sqlite \
SEARCH_PROVIDER=sqlite \
DATA_DIR=/tmp/msh-sqlite-test \
bash scripts/development/smoke-test.sh

# MySQL mode
API_URL=http://localhost:3040 \
CATALOG_PROVIDER=mysql \
SEARCH_PROVIDER=mysql \
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=33307 \
MYSQL_DATABASE=managed_skill_hub \
MYSQL_USER=managed_skill_hub \
MYSQL_PASSWORD=valpass \
MYSQL_SSL_MODE=disabled \
DATA_DIR=/tmp/msh-mysql-test \
bash scripts/development/smoke-test.sh
```

Because `scripts/development/smoke-test.sh` starts/stops the API, run the second block after the first
command has completed.
