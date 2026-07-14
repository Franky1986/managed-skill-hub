# Spec: SkillReadController (HTTP Adapter)

## Purpose

Expose the public read and discovery HTTP API. The controller translates HTTP
requests into inbound port calls and maps results back to JSON or file streams.

## Scope

- `GET /discover`
- `GET /howToPropose`
- `GET /skills`
- `GET /skills/search`
- `GET /categories`
- `GET /tags`
- `GET /skills/:id`
- `GET /skills/:id/manifest`
- `GET /skills/:id/files`
- `GET /skills/:id/judgements`
- `GET /skills/:id/files/:fileId`
- `GET /skills/:id/files/:fileId/judgements`
- `GET /skills/:id/files/:fileId/extracted-content`
- `GET /skills/:id/versions`
- `GET /skills/:id/history`

## Non-Scope

- Admin write operations
- Admin session establishment and admin write authorization
- German API responses
- Translating existing skill content or metadata

## Responsibilities

- `GET /discover` returns registry metadata: name, version, description,
  `registryId`, `registryName`, `apiBaseUrl`, runtime auth requirements,
  capabilities, documentation links, workflow notes, and concrete entrypoints.
- `GET /discover` is both human-readable and machine-readable. Agents should
  use the returned `entrypoints[].url` values directly instead of inferring
  paths or prefixes.
- `GET /discover` detects whether it was called through an `/api/` prefix and
  returns entrypoint URLs with that prefix when appropriate.
- `GET /discover` returns English-only agent-facing guidance.
- `GET /discover` exposes non-secret auth metadata and a credential setup script
  URL when any agent-facing auth mode is enabled.
- `GET /discover.workflowNotes.conversationLanguage` tells agents to communicate
  with the user in the language the user is currently using unless asked
  otherwise.
- `GET /howToPropose` returns the mandatory proposal preflight for agents,
  including the `SKILL.md` entrypoint rule, temporary normalization, self-
  contained reference checks, required-local-artifact identification,
  secrets/PII checks, installed-dependency exclusion rules, duplicate precheck
  order, and the same user-conversation-language rule.
- `GET /howToPropose.duplicateConfirmationRule` tells agents to stop before
  upload when duplicate/collision signals are present, summarize the duplicate
  candidate, core overlap, intended resolution, and concise metadata/file-
  fingerprint diff, then ask the user for explicit confirmation.
- `GET /howToPropose.metadataLanguageGuidance` recommends English for new
  proposal metadata while allowing uploaded content files in any language.
- `GET /howToPropose` includes an auth setup flow telling agents to use the
  advertised `agent-session` URL or OIDC Device Authorization flow, and never to
  request tokens in chat.
- `GET /howToPropose.packageHandling` tells agents to upload source artifacts
  and dependency manifests/lockfiles, never initialized package-manager
  outputs such as `node_modules/`, `.venv/`, `venv/`, `vendor/`,
  `dist-packages/`, or `site-packages/`, and not to omit required local
  templates/assets just because they are non-code or later-runtime inputs.
- Discovery routes are guarded by `DISCOVERY_AUTH_MODE`.
- Public read routes are guarded by `PUBLIC_READ_AUTH_MODE`.
- A valid admin browser session with the `reader` or `admin` role is accepted
  as an alternative credential on public read routes. This fallback does not
  apply to discovery or proposal routes and does not grant any write access.
- The controller follows the OpenAPI contract.
- Only `published` skills are reachable through the public read path.
- Categories and tags are exposed for retrieval and proposal preparation.
- `GET /skills` and `GET /skills/search` accept repeated `tag` query parameters
  and apply an AND filter across the latest published skill metadata.
- Empty category lists from the SQLite catalog projection are valid responses.
- Files are streamed correctly with `X-Content-Type-Options: nosniff` and a
  sandbox Content-Security-Policy.
- Active browser-renderable artifact types such as HTML, XHTML, SVG, and XML are
  served as attachment instead of inline from the API origin.
- Public file reads must first confirm that the requested file belongs to the
  selected published version's manifest/catalog file list before reading bytes
  from storage.
- Judgements are exposed read-only for published skill versions and published
  version files only.
- Extracted content is read-only and never executes skill code.
- Skill detail responses include agent-relevant contract fields such as
  `entrypoint`, `useWhen`, and `doNotUseWhen`.
- Errors use the normalized JSON contract with `error`, `code`, and `requestId`.
- Public skill summaries/details prefer the SQLite catalog projection.
- Public skill aggregates for internal read paths prefer SQLite when the
  projection is available.
- Search result metadata and published version resolution for downloads prefer
  SQLite.
- Manifest and file metadata lists for published versions prefer SQLite;
  original file content remains in storage.
- Published version resolution for extracted content prefers SQLite; original
  blobs and extraction cache remain storage/extractor concerns.
- Skill history prefers the SQLite projection but only exposes published-version
  history and skill-wide entries without a version reference.
- Empty SQLite history results are valid responses.

## Inputs / Outputs

- Inputs: HTTP requests
- Outputs: JSON responses or file streams

## Dependencies / Ports

- `SkillQueryPort`

## Failure Modes

- Invalid UUID or ID -> 400
- Not found -> 404
- Internal error -> 500
- Error responses contain at least `error`, `code`, and `requestId`.
- Public error responses do not expose internal original errors.

## Acceptance Criteria

- Endpoints match the OpenAPI specification.
- Response schemas are validated by tests.
- Protected public read routes accept either their configured agent credential
  or a reader-capable admin browser session; invalid sessions and admin sessions
  without `reader` or `admin` remain subject to configured agent auth.
- Agent-facing discovery and proposal guidance is English-only.
- Agent-facing guidance preserves the distinction between English contract
  language and the agent's obligation to answer the user in the user's current
  language.

## Tests / Checks

- HTTP controller tests
- OpenAPI generation/checks
- `./scripts/check.sh`

## Agent Guardrails

- Do not put business logic in the controller.
- Do not call outbound adapters directly from this controller.
- Do not add German variants to API responses; localize UI presentation on the
  frontend using stable error codes.
