# EPIC-007: Configurable Agent API Authentication

## Status

Implemented - static bearer phase

## Objective

Add configurable authentication for the agent-facing public read API and proposal
submission API while preserving the current open-by-default local development
experience.

The result should let operators choose, per deployment, whether agents can:

- read and download published skills without credentials
- submit proposals without credentials
- check duplicates and finalize uploads without credentials
- poll proposal status under the same proposal access policy

The implementation must keep admin authentication separate from agent/API
authentication.

## Why This Epic Exists

The MVP intentionally exposes published skill consumption and proposal
submission through open endpoints so local agents can integrate easily. That is
useful for trusted internal networks and local development, but some deployments
will need tighter controls:

- private skill registries where even published skills are not broadly readable
- proposal submission protected against spam or untrusted agents
- per-consumer bearer tokens for known agent runtimes
- audit attribution that is stronger than client-supplied `X-Actor`
- future migration toward OIDC/API gateway based authentication

This should be configurable rather than hard-coded. Different installations may
want different trust models. Consumers may also use several ManagedSkillHub
instances at the same time, for example one local sandbox, one team registry, and
one production registry under different URLs.

## Non-Goals

- Replacing admin session auth in this epic
- Implementing full RBAC or multi-tenant authorization
- Implementing OAuth/OIDC token validation directly in the application
- Adding user accounts for every agent or submitter
- Making local development require credentials by default
- Hiding admin-only draft/review data behind the public agent auth layer

## Authentication Model

Introduce a new inbound HTTP auth boundary for agent/public API access.

Admin auth remains separate:

- admin UI and admin API continue to use the existing admin session/cookie guard
- agent bearer tokens must not grant admin permissions
- admin session cookies must not be required for agent API routes

Agent API auth should start with static bearer-token support because it is easy
for local agents, CI jobs, and gateway deployments to use.

Future providers can be added behind the same boundary:

- API key header
- JWT/OIDC validation
- reverse-proxy asserted identity
- mTLS-provided identity

## Configuration Contract

Default behavior must preserve the current open API:

```env
REGISTRY_ID=local
REGISTRY_NAME=ManagedSkillHub Local
PUBLIC_API_BASE_URL=http://localhost:3040

PUBLIC_READ_AUTH_MODE=none
PUBLIC_READ_BEARER_TOKEN=

PROPOSAL_AUTH_MODE=none
PROPOSAL_BEARER_TOKEN=

DISCOVERY_AUTH_MODE=none
DISCOVERY_BEARER_TOKEN=
```

Supported initial values:

```text
none
bearer
```

`REGISTRY_ID`, `REGISTRY_NAME`, and `PUBLIC_API_BASE_URL` identify this
deployment in discovery responses and generated setup scripts. They are not
secrets. `PUBLIC_API_BASE_URL` must be the externally reachable API URL, not an
internal container hostname.

Recommended defaults:

| Area | Default | Rationale |
|---|---|---|
| Discovery | `none` | agents need to learn how to authenticate and which endpoints exist |
| Public read | `none` | preserves current local/internal default |
| Proposal | `none` | covers duplicate check, submission, upload finalization, notices, and status polling |

Production-like example:

```env
REGISTRY_ID=company-prod
REGISTRY_NAME=Company Production Skill Registry
PUBLIC_API_BASE_URL=https://skills.example.com/api

PUBLIC_READ_AUTH_MODE=bearer
PUBLIC_READ_BEARER_TOKEN=replace-with-read-token

PROPOSAL_AUTH_MODE=bearer
PROPOSAL_BEARER_TOKEN=replace-with-submit-token

DISCOVERY_AUTH_MODE=none
```

Fully protected agent API example:

```env
REGISTRY_ID=company-prod
REGISTRY_NAME=Company Production Skill Registry
PUBLIC_API_BASE_URL=https://skills.example.com/api

DISCOVERY_AUTH_MODE=bearer
DISCOVERY_BEARER_TOKEN=replace-with-discovery-token
PUBLIC_READ_AUTH_MODE=bearer
PUBLIC_READ_BEARER_TOKEN=replace-with-read-token
PROPOSAL_AUTH_MODE=bearer
PROPOSAL_BEARER_TOKEN=replace-with-submit-token
```

## Route Groups

### Discovery / Contract Routes

- `GET /discover`
- `GET /howToPropose`
- `GET /openapi.yaml`

Default: open.

If protected, `/discover` must still return enough metadata when accessed with a
valid token for agents to understand the active auth mode.

### Public Read / Consumption Routes

- `GET /skills`
- `GET /skills/search`
- `GET /categories`
- `GET /tags`
- `GET /skills/:skillId`
- `GET /skills/:skillId/manifest`
- `GET /skills/:skillId/files`
- `GET /skills/:skillId/files/:fileId`
- `GET /skills/:skillId/files/:fileId/content`
- `GET /skills/:skillId/package`
- `GET /skills/:skillId/versions`
- `GET /skills/:skillId/history`

Guarded by `PUBLIC_READ_AUTH_MODE`.

### Proposal Routes

- `POST /proposals/check-duplicate`
- `POST /proposals`
- `POST /proposals/:proposalId/files`
- `POST /proposals/:proposalId/finalize-upload`
- `GET /proposals/:proposalId/status`
- `GET /proposals/notice`

Guarded by `PROPOSAL_AUTH_MODE`.

Proposal status intentionally uses the same proposal auth mode. This keeps the
mental model simple for users and agents: if proposal workflows are protected,
creating, uploading, finalizing, duplicate checking, notices, and status polling
all use the same proposal token.

When proposal auth is enabled, the application should derive the actor from the
auth context rather than trusting client-provided `X-Actor` alone.

## Actor And Audit Semantics

Current proposal routes fall back to `X-Actor` or `agent`. With authenticated
proposal access, actor attribution should become stronger:

- bearer token configuration may optionally define an actor label
- if no explicit label exists, use a stable default such as `agent-token`
- client-provided `X-Actor` may be recorded only as a requested/display actor,
  not as the authoritative identity
- audit entries should record the authenticated actor where available

Proposed future-compatible env shape:

```env
PROPOSAL_BEARER_TOKEN=replace-with-submit-token
PROPOSAL_BEARER_ACTOR=codex-submit-agent
PUBLIC_READ_BEARER_ACTOR=codex-read-agent
```

Multi-token support can follow later through a structured file or secret store;
this epic should not require it.

## Consumer Token Setup And Agent Bootstrap

Authenticated consumer workflows must not require users to paste bearer tokens into
normal agent conversation. This is especially important for PMs and other users who
do not have the ManagedSkillHub repository checked out locally and only consume the
hosted API.

The preferred consumer experience is a tiny local credential setup surface outside
the agent conversation:

- a small local setup page, CLI, native prompt, or agent-adjacent tool asks for:
  registry alias, registry URL, read token, and optional proposal token
- the user pastes the token into that input field, not into chat
- the tool writes credentials to a user-global secret location
- credentials are stored per registry URL or explicit alias, never as one global
  token for all ManagedSkillHub instances
- agents read the saved credential by registry alias or URL and never print the
  token
- OAuth/OIDC can later replace the token input with a browser login flow while
  preserving the same consumer-facing setup concept

Recommended user-global credential file for the simple bearer phase:

```text
macOS/Linux: ~/.managed-skill-hub/credentials.json
Windows:     %USERPROFILE%\.managed-skill-hub\credentials.json
```

Example shape:

```json
{
  "defaultRegistry": "company-prod",
  "registries": {
    "company-prod": {
      "url": "https://skills.example.com/api",
      "readToken": "replace-locally",
      "proposalToken": "replace-locally"
    },
    "company-sandbox": {
      "url": "https://sandbox.skills.example.com/api",
      "readToken": "replace-locally",
      "proposalToken": "replace-locally"
    },
    "local": {
      "url": "http://localhost:3041/api"
    }
  }
}
```

Registry aliases are user-local convenience names. The canonical identity for a
registry is the normalized API base URL returned by discovery. Helper tools should
warn before overwriting an existing alias that points to a different URL, and they
should support multiple aliases pointing to different ManagedSkillHub instances.

Recommended credential lookup order for agents and helper tools:

1. explicit runtime environment variables (`MANAGED_SKILL_HUB_*`)
2. user-global credential file (`~/.managed-skill-hub/credentials.json`)
3. OS keychain or OAuth token cache when implemented later
4. project-local `.env.agent.local` only for developer workflows, not as the
   default consumer path

Recommended setup UI behavior for bearer mode:

- show a simple form with `Registry alias`, `Registry URL`, `Read token`, and
  `Proposal token`
- default the alias from discovery metadata or the URL host, but allow changing it
- allow `Proposal token` to be empty for read-only consumers
- validate by calling `/discover` and one low-risk read endpoint
- store tokens with restrictive file permissions where the platform allows it
- display only masked token previews after saving
- provide a remove/rotate action
- never show the full token again after initial entry

Repository-provided templates should show variable names and file shapes, but never
contain real tokens. Generated helper scripts must read tokens from the credential
source; they must not embed tokens in source code, command history, logs, proposal
files, screenshots, or chat messages.

The `.gitignore` should cover local developer token files such as:

```gitignore
.env.agent.local
.env.*.local
```

Agent instructions should say:

- never ask the user to paste a token into chat when a setup UI, local credential
  file, OS keychain, or environment variable can be used
- if a token appears in chat, treat it as compromised and recommend rotation
- do not include Authorization headers in debug output
- redact tokens in generated logs and troubleshooting snippets
- prefer a short-lived or narrowly scoped proposal token for submission flows

This means agents may create local helper scripts, but only as deterministic
clients that read secrets from the runtime environment or user-global credential
store. A script that contains a literal bearer token is a bug.

### Downloadable Setup Script

For non-technical consumers, the preferred first implementation is a
downloadable shell setup script generated by the ManagedSkillHub server. The
script should be safe to inspect, contain no secrets, and already know the
registry URL and active auth requirements.

Planned endpoint shape:

Agent session delegation (see EPIC-012) is the preferred human-in-the-loop flow. The `/frontend/agent-auth` page opens in a browser, the user enters the bearer token for the requested area, and the agent receives an 8-character session code to use as `Authorization: AgentSession <code>`.

The auth setup flow must never ask users to paste tokens into chat.

For deployments where discovery is protected, the setup script endpoint may stay
open while containing no secret material. It only tells the user where the
registry lives, which alias should be suggested, and which token fields must be
entered locally.

The generated script must not echo entered token values. It should read tokens
using non-echoing terminal input where available and should avoid writing shell
history. If no TTY is available, it may accept tokens through environment
variables for CI/dev use.

Recommended generated prompt matrix:

| Active server config | Script asks for |
|---|---|
| `PUBLIC_READ_AUTH_MODE=none`, `PROPOSAL_AUTH_MODE=none` | no token; only writes URL/alias or exits with "no credentials required" |
| `PUBLIC_READ_AUTH_MODE=bearer`, `PROPOSAL_AUTH_MODE=none` | read token |
| `PUBLIC_READ_AUTH_MODE=none`, `PROPOSAL_AUTH_MODE=bearer` | proposal token |
| both bearer | read token and proposal token; allow reusing read token if operator says same-token mode is allowed |

The endpoint should be documented from `/discover` and `/howToPropose` when any
agent-facing auth mode is enabled.

## Discovery Contract Changes

`GET /discover` should expose active auth requirements and registry identity
without leaking secrets:

```json
{
  "registryId": "company-prod",
  "registryName": "Company Production Skill Registry",
  "apiBaseUrl": "https://skills.example.com/api",
  "readAuthRequired": true,
  "proposalAuthRequired": true,
  "authSchemes": [
    {
      "id": "public-read-bearer",
      "type": "bearer",
      "appliesTo": ["public-read"]
    },
    {
      "id": "proposal-bearer",
      "type": "bearer",
      "appliesTo": ["proposal"]
    }
  ]
}
```

`GET /howToPropose` should also explain whether proposal submission currently
requires an `Authorization: Bearer <token>` header and should reference the
registry alias/base URL agents must use when selecting local credentials.

## OpenAPI Contract Changes

Add reusable security schemes:

```yaml
components:
  securitySchemes:
    publicReadBearer:
      type: http
      scheme: bearer
    proposalBearer:
      type: http
      scheme: bearer
```

Because auth is runtime-configurable, route descriptions should mention the
runtime discovery contract rather than hard-coding every route as always secured.
If a generated client needs strict schemas, provide profile-specific docs later.

## Architecture Requirements

- Add a small inbound auth port/service for agent API auth, separate from
  `SimpleAdminAuth`.
- Keep use cases and domain auth-agnostic.
- Apply guards in HTTP route registration or route groups.
- Return normalized `401` JSON errors through existing error handling.
- Use constant-time token comparison.
- Do not log bearer tokens.
- Keep `none` mode fast and low-friction.

Suggested implementation shape:

```text
apps/api/src/adapters/inbound/http/agent-api-auth.ts
apps/api/src/adapters/inbound/http/agent-api-auth.test.ts
apps/api/src/adapters/inbound/http/AgentApiAuth.spec.md
```

## Acceptance Criteria

- Default `.env.example` keeps all agent/public auth modes set to `none` and
  includes non-secret registry identity/base URL examples.
- Public read endpoints remain open by default.
- Proposal endpoints remain open by default.
- With `PUBLIC_READ_AUTH_MODE=bearer`, public read endpoints return `401` when
  `Authorization` is missing or invalid and succeed with the configured token.
- With `PROPOSAL_AUTH_MODE=bearer`, proposal endpoints, including duplicate
  checks, uploads, finalization, notices, and status polling, return `401` when
  `Authorization` is missing or invalid and succeed with the configured token.
- With proposal auth enabled, persisted/audited actor attribution comes from the
  authenticated context, not from untrusted `X-Actor` alone.
- `/discover` reports active auth requirements, schemes, registry identity, and
  canonical API base URL.
- `/howToPropose` tells agents whether proposal auth is required and which
  registry alias/base URL should be used for credential lookup.
- `/discover` links to a generated credential setup script when agent auth is active.
- Admin routes keep their existing session/cookie behavior.
- OpenAPI includes reusable bearer security schemes and runtime-auth notes.
- `./scripts/check.sh` passes.

## Test Plan

### Unit / Adapter Tests

- Config parsing for registry identity/base URL and all auth modes
- Invalid auth mode fails fast
- Bearer token validation uses constant-time comparison
- Missing/malformed/invalid `Authorization` header returns unauthorized
- `none` mode never blocks a request
- Actor derivation from bearer config
- generated helper scripts never contain literal bearer tokens
- credential lookup selects the correct entry when multiple registry URLs are
  configured

### HTTP Integration Tests

- `/discover` reflects active auth modes and registry identity
- public read route open by default
- public read route guarded in bearer mode
- `POST /proposals/check-duplicate` guarded in bearer mode
- `POST /proposals` guarded in bearer mode
- `POST /proposals/:id/files` guarded in bearer mode
- `POST /proposals/:id/finalize-upload` guarded in bearer mode
- proposal status routes follow `PROPOSAL_AUTH_MODE`
- admin routes remain guarded by admin session auth only

### Documentation Tests / Checks

- `.env.example` contains the new variables with safe defaults, including
  non-secret registry identity/base URL settings
- Add consumer credential setup guidance/templates that use user-global
  per-registry credentials or env variables, not embedded tokens
- Add a generated setup script endpoint that prompts only for read/proposal
  tokens required by active auth config and updates only the matching registry
  entry
- `docs/setup/ENVIRONMENT.md` documents all auth modes
- `docs/product/AGENT_BOOTSTRAP.md` explains bearer header usage when required
- `docs/setup/DEPLOYMENT.md` includes server-side auth examples
- `docs/howTo/README.md` or a dedicated how-to links consumer credential setup guidance/templates
- generated setup script behavior is documented for PM/non-repo consumers

## Rollout Plan

1. Add config fields and docs with default `none` modes.
2. Implement `AgentApiAuth` guard with bearer support.
3. Apply guards to route groups behind feature flags.
4. Extend `/discover` and `/howToPropose` responses.
5. Update OpenAPI and tests.
6. Run local smoke tests in open mode and bearer-protected mode.

## Risks And Tradeoffs

- Protecting `/discover` makes agent bootstrap harder; keep it open by default.
- Static bearer tokens are simple but coarse-grained; use deployment secret
  hygiene and rotate manually until multi-token/OIDC exists.
- Multi-registry consumers can accidentally target the wrong registry if alias
  selection is ambiguous; tools should display alias and URL before writes.
- A single read token cannot distinguish individual consuming agents. Actor
  labels help audit but are not a full identity model.
- Protecting proposal status means submitter agents need the proposal token when
  polling the status URL. This is intentional for a simpler auth model.

## Documentation Updates Required During Implementation

- `.env.example`
- `docs/setup/ENVIRONMENT.md`
- `docs/product/AGENT_BOOTSTRAP.md`
- `docs/product/AGENT_OPERATIONS.md`
- `docs/setup/DEPLOYMENT.md`
- `packages/openapi/skill-registry.openapi.yaml`
- generated setup script endpoint docs and tests
- relevant co-located HTTP auth specs
