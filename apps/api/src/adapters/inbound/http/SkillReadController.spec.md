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
- `GET /discover.agentHttpGuidance` distinguishes registry discovery metadata,
  public skill search, and version-aware package download. It tells agents that
  the HTTP client's network context is decisive for private DNS, localhost, and
  VPN-restricted registries; local terminal `curl` is an example, not a special
  protocol requirement.
- `GET /discover.agentHttpGuidance` tells agents to diagnose authentication on
  the exact requested operation and endpoint. A `401` from `/admin/session`, the
  frontend, a redirect, or another endpoint must not be treated as evidence that
  public read or proposal access requires authentication.
- When `/discover` advertises an operation as open but one client receives
  `401` or `403`, the guidance requires retrying the exact URL with a client in
  the user's network context before requesting credentials.
- The guidance exposes separate `required` flags and instructions for
  `discovery`, `public-read`, and `proposal`. Curl examples identify their auth
  area and whether authorization is required under the current runtime
  settings; no token value is embedded.
- `GET /discover` exposes non-secret auth metadata. When a bearer-protected area
  is enabled, it advertises the absolute agent-session URL; OIDC areas advertise
  Device Authorization metadata. No credential setup script is exposed.
- `GET /discover.workflowNotes.conversationLanguage` tells agents to communicate
  with the user in the language the user is currently using unless asked
  otherwise.
- `GET /howToPropose` returns the mandatory proposal preflight for agents,
  including an outcome and registry-value decision before package preparation,
  the `SKILL.md` entrypoint rule, temporary normalization, self-contained
  reference checks, required-local-artifact identification, secrets/PII checks,
  installed-dependency exclusion rules, duplicate precheck order, and the same
  user-conversation-language rule.
- `GET /howToPropose.proposalIntentDecision` prevents agents from inferring
  publication intent from requests to create or test a skill. Agents first
  distinguish using an existing skill, keeping or installing an artifact
  locally, improving an existing skill, and proposing reusable registry
  content.
- Portable command files remain optional artifacts inside the same skill
  package. Command installation into a runtime-specific folder is a separate
  user decision and command presence alone does not justify a proposal.
- `GET /howToPropose.duplicateConfirmationRule` tells agents to stop before
  upload when duplicate/collision signals are present, reconsider whether an
  existing or local outcome is more useful, summarize the duplicate candidate,
  core overlap, intended resolution, and concise metadata/file-fingerprint
  diff, then ask the user for explicit confirmation only when proposal intent
  remains confirmed.
- The duplicate rule exposes the configured strong-similarity threshold.
  Lower-scoring search matches are exploratory context and are not upload
  blockers by themselves.
- `GET /howToPropose.metadataLanguageGuidance` recommends English for new
  proposal metadata while allowing uploaded content files in any language.
- `GET /howToPropose` includes an auth setup flow telling agents to use the
  advertised `agent-session` URL or OIDC Device Authorization flow, and never to
  request tokens in chat.
- `GET /howToPropose.externalArtifactDecision` is a mandatory pre-proposal
  boundary decision. It distinguishes external services/capabilities, local
  portable artifacts, and ambiguous dependencies.
- Figma, Jira, MCP servers, remote APIs, credentials, and remote service data
  remain external prerequisites and are never copied into proposal packages.
- Outside-root local commands, references, templates, scripts, prompts,
  fixtures, and assets require a concrete package-relative proposal and an
  explicit user choice between portable inclusion, a truthfully documented
  external prerequisite, or removing/rewriting the dependency.
- Bare slash commands and other ambiguous dependency names require the same
  user decision; a general request to upload the skill is not authorization to
  choose silently. No proposal write may begin before every such dependency is
  resolved.
- `GET /howToPropose.agentHttpGuidance` repeats the same network-context,
  endpoint-isolation, and authentication-diagnosis rules so proposal agents do
  not depend on prior human documentation.
- Discovery and `/howToPropose` expose proposal workflow version `1.1` and a
  one-active-upload invariant. Agents must persist the first proposal id,
  status-check and validate that id after ambiguous responses, patch metadata
  and upsert files in place, and never create a new proposal merely because a
  later scan finds another file or correction.
- A create conflict with `PROPOSAL_UPLOAD_ALREADY_OPEN` is a recovery pointer,
  not permission to retry with a different idempotency key. Agents must use
  `details.proposalId` and the response's relative recovery paths.
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
- Request handlers use statically resolved application use cases; they do not
  perform relative runtime imports that depend on transpiler-specific module
  URLs.
- Only `published` skills are reachable through the public read path.
- Categories and tags are exposed for retrieval and proposal preparation.
  Category values are an open vocabulary: `/categories` returns suggestions
  derived from published skills and explicitly states that custom categories
  are allowed and the list is not an allowlist.
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
- Route registration accepts a boundary-specific container view containing only
  the configuration and use cases actually used by this controller. Tests build
  that view explicitly instead of casting incomplete objects to the full
  application `Container`.

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
- Agent-facing guidance preserves the distinction between an HTTP client's
  execution context and authentication. It must not claim that `curl` itself
  bypasses authentication; it explains that a local client may have network,
  DNS, or VPN access that a remote fetcher lacks.
- Discovery and `/howToPropose` expose the same versioned, sequential proposal
  state machine. It forbids one giant shell `&&` chain and permits finalization
  only after the parsed validation body reports `canFinalize=true` with zero
  blocking findings.
- HTTP guidance tells clients to capture status and body separately and not to
  use `curl -f` for JSON workflow endpoints, because structured non-2xx bodies
  contain the recovery instructions.

## Tests / Checks

- HTTP controller tests
- Strict TypeScript check through `apps/api/tsconfig.agent-contract-tests.json`
- Proposal guidance tests parse `requiredSteps` as a typed collection and use
  an existence-asserting lookup helper before accessing a named step, so IDE
  and command-line strict-null checks agree.
- OpenAPI generation/checks
- `./scripts/check.sh`

## Agent Guardrails

- Do not put business logic in the controller.
- Do not call outbound adapters directly from this controller.
- Do not add German variants to API responses; localize UI presentation on the
  frontend using stable error codes.
