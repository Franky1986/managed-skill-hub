# Agent Bootstrap Guide

## Goal

Autonomous agents (Codex, Claude, OpenCode, Gemini, Cursor, Windsurf, ...) should be able to discover, read, download and submit skills to the `managed-skill-hub` registry without using the UI.

The registry is designed as a governed handoff point between autonomous agents
and human operators:

- agents consume only published skill versions through public read APIs
- agents submit normalized proposals with metadata and files, but do not need
  admin credentials
- agents run local preflight checks, including duplicate detection, file package
  validation, reference validation, and secret/PII scanning
- admins review, convert, approve, publish, reject, or deprecate
- optional real judgers can assess proposal risk, and configured auto-publish can
  publish eligible green proposals without manual conversion

## Review and publication boundary

The registry has a clear split of responsibilities:

- **Agents** can read published skills, download deterministic skill packages,
  submit proposals, attach files, finalize uploads, run duplicate checks, and
  poll proposal status.
- **Admins** can review, edit metadata, convert proposals into draft versions,
  approve, publish, reject, and deprecate skills.
- **Automation** can publish eligible green proposals only when a real judger is
  configured and `AUTO_PUBLISH_ON_GREEN=true`. Placeholder/noop judgements are
  treated as `no_judge_available` and do not auto-approve unless an operator
  explicitly sets `AUTO_APPROVE_WITHOUT_JUDGER=true`.

An agent that submits and finalizes a proposal has completed the write-side
handoff. It can poll the public status endpoint and explain next steps, but it
cannot force publication.

## Conversation language

All registry contracts and agent-facing instructions are written in English.
When communicating with the user, use the language the user is currently using
unless the user explicitly asks for another language.

Do not infer the user's conversation language from the API response language,
browser language, or UI language. The API is English-only by design.

## Base URL

Choose the correct base URL depending on how you reach the registry:

- Through the frontend dev server (Vite proxy): `http://localhost:3041/api`
- Directly to the backend: `http://localhost:3040`

The examples below use `http://localhost:3041/api`. Adjust the path prefix if you call the backend directly.

## HTTP client and network context

The decisive factor is the HTTP client's network context, not `curl` itself.
For an internal hostname, private DNS name, `localhost`, or a VPN-restricted
registry, execute requests through a client that runs inside the user's network
context. A local terminal command such as `curl` is the most portable example.
A remote web-fetch service may run outside that network and can therefore
return a gateway-generated `401`, `403`, DNS error, or connection error even
when the ManagedSkillHub endpoint is anonymously accessible from the user's
machine.

Diagnose authentication for the exact operation and endpoint:

- `/discover` returns registry metadata and endpoint URLs; it is not a skill
  search result or package download.
- Use `/skills/search` to resolve a user-facing name or title to the canonical
  `skillId` and published version.
- Use `/skills/{skillId}/package?version=<published-version>` for the actual
  download.
- Do not infer public-read authentication from `/admin/session`, an admin UI
  login, a frontend response, a redirect, or another endpoint.
- When `/discover` says an operation is open but one client receives `401` or
  `403`, retry the exact same URL with a local network-capable HTTP client
  before requesting credentials. A different result indicates a client,
  network, DNS, proxy, or remote-fetch context mismatch.

## Discovery

Every agent starts with `GET /discover`:

```bash
curl -s http://localhost:3041/api/discover | jq .
```

The response contains:

- `name`, `version`, `description`
- `registryId`, `registryName`, `apiBaseUrl`: identity and base URL for this registry instance
- `readAuthRequired`, `proposalAuthRequired`, `discoveryAuthRequired`: runtime auth requirements
- `authSchemes`: bearer schemes that apply to `public-read`, `proposal`, or `discovery`
- `documentation`: links to human-readable guide and OpenAPI spec
- `capabilities`: what the registry can do
- `entrypoints`: concrete endpoints with `id`, `name`, `description`, `methods`, `path` and `url`
- `workflowNotes`: hints about the read path and the proposal path, plus a list of admin-only actions
- `agentHttpGuidance`: machine-readable tool selection, retrieval order,
  endpoint-specific authentication diagnosis, per-area authorization flags,
  and local `curl` examples. Runtime responses use the configured canonical
  `apiBaseUrl`; static documentation examples use placeholders.

Use the `url` values from `entrypoints` directly so you do not have to guess paths or prefixes.

Before any proposal upload, the agent must read `GET /howToPropose`. This is not optional.

## Authenticated registries

Deployments can protect read, proposal, or discovery endpoints with static
bearer auth or OIDC. Agents must not ask users to paste credentials or tokens
into normal chat. For static bearer modes, use the agent-session scheme advertised in
`/discover` whenever it is available: open the URL in a browser or browser tool,
let the user enter the bearer token, and use the returned short-lived session code
as `Authorization: AgentSession <code>`. In particular, agents must never ask users
to paste bearer tokens into chat.

The OIDC mode uses Authentik Device Authorization. When
`/discover` advertises an OIDC device scheme, agents must follow
[`AGENT_OIDC_DEVICE_FLOW.md`](./AGENT_OIDC_DEVICE_FLOW.md): show the human only
the trusted `verification_uri_complete` link, keep `device_code` secret, poll at
the advertised interval, and never request credentials or tokens in chat.
Agents must use only schemes that the live discovery response advertises.

Recommended lookup order for clients:

1. short-lived session codes created through the agent-session URL from `/discover`
2. explicit runtime env vars such as `MANAGED_SKILL_HUB_READ_TOKEN` and `MANAGED_SKILL_HUB_PROPOSAL_TOKEN`
3. OS keychain or OAuth cache when a client supports it
4. project-local developer-only files such as `.env.agent.local`

When `proposalAuthRequired=true`, use the proposal token for duplicate checks, proposal creation, file uploads, finalize-upload, notices, and status polling. Proposal status is not a separate auth domain. When `readAuthRequired=true`, use the read token for published skill listing, search, metadata, files, and package downloads.

When an endpoint returns `401` with `details.authRequired=true`, inspect
`details.authArea` and `details.discoverUrl`. Read `/discover` to find the
applicable auth scheme: use the `agent-session` URL when sessions are enabled, or
follow the OIDC Device Authorization flow when an `oauth2` scheme is advertised.
Only when no agent-session or OIDC scheme is available, obtain the bearer token
from the administrator through a separate trusted channel and use it directly in
the `Authorization: Bearer <token>` header. Never request tokens in chat.

Consumers may work with multiple ManagedSkillHub instances at the same time, for example `local`, `team-sandbox`, and `company-prod`. Always show or log the selected registry alias and URL, but never print full tokens.

## Typical agent read flow

```bash
# 1. Categories
GET /api/categories
GET /api/tags

# 2. Search or list published skills
GET /api/skills
GET /api/skills/search?q=webscraping&mode=keyword

# 3. Read proposal contract
GET /api/howToPropose

# 4. Skill detail
GET /api/skills/<skill-id>

# 5. Files
GET /api/skills/<skill-id>/files
```

Use version-aware package download to get a deterministic local artifact:

- `GET /api/skills/<skill-id>/package?version=<published-version>` for a specific version.
- Omit `version` to fetch the latest published version.
- After download, verify manifest entrypoint and all manifest file paths before executing locally.
- If only `SKILL.md` exists in that version, the response is returned directly as `SKILL.md`.

```bash
GET /api/skills/<skill-id>/package?version=1.2.3
```

## Contracts for agents

Use these fields to avoid unnecessary downloads:

- `skillUuid`: global, stable skill identifier.
- `versionUuid`: stable identifier of the published version.
- `contentDigest`: version-level digest – quick change detection.
- `artifactId` + `sha256`: per file – enables incremental pulls.

Only download artifacts whose checksums differ from your last local state.

## Mandatory proposal preflight

Local proposal agents must do more than `check-duplicate`:

1. `GET /howToPropose`
2. Communicate with the user in the language the user is currently using
3. Inspect the local files and determine the effective entrypoint
4. Normalize only when needed into a temporary upload package
5. Ensure the final package has `SKILL.md` in the package root
6. Prefer English for proposal metadata: title, description, category, tags,
   capabilities, `useWhen`, and `doNotUseWhen`
7. Keep uploaded content files in their original language; do not rewrite them
   solely for language reasons
8. Exclude initialized dependency directories such as `node_modules/`, `.venv/`,
   `venv/`, `vendor/`, `dist-packages/`, or `site-packages/`
9. Keep setup manifests and lockfiles such as `package.json`,
   `pnpm-lock.yaml`, `pyproject.toml`, or `requirements.txt` when they explain
   later initialization
10. Infer which local artifacts the skill actually depends on by reading
    `SKILL.md`, adjacent docs, scripts, examples, templates, assets, prompts,
    fixtures, and setup files together
11. Upload those required local artifacts as part of the proposal package;
    examples include templates, example manifests, images, PDFs, PPTX files,
    prompt files, and fixture data when the skill depends on them
12. Detect references that point outside the effective skill root, such as
    parent-directory references, absolute local paths, IDE/agent workspace
    folders, command folders, generated-output folders, or other
    project-root-relative paths. If such a reference points to a required
    artifact, copy that artifact into the temporary upload package and rewrite
    the reference to its package-relative path before creating the proposal.
13. Do not treat a local artifact as proprietary, optional, or external unless
    the skill explicitly documents it as an external prerequisite and the
    uploaded package remains truthful and usable without it
14. Verify that relative references still resolve after normalization
15. Verify that no required artifact reference still resolves outside the
    temporary upload package root.
16. Verify that every required local artifact is either included or explicitly
    documented as an external prerequisite
17. Scan readable files for credentials, tokens, private keys and obvious PII
18. Build the final temporary upload package before any proposal network write
19. Recursively scan every readable file in that final package, not only
    `SKILL.md`
20. Compute SHA-256 values from the final temporary upload package after all
    normalization
21. Inspect `/tags` when choosing proposal metadata or discovery filters
22. Search `/skills/search` exploratively by title and short description intent
23. Run `POST /proposals/check-duplicate` using metadata and hashes from the
    final temporary upload package
24. Stop for explicit confirmation if duplicates, ambiguity, missing required artifacts, or sensitive content is detected
25. Keep the package within the runtime upload limits returned by
    `GET /howToPropose`
26. After the last file upload, call `POST /proposals/{id}/validate-upload`,
    fix every finding in the temporary upload package, upsert changed files,
    and repeat until `valid=true`
27. Then call `POST /proposals/{id}/finalize-upload` explicitly

The temporary normalization step is conditional:

- If the package is already valid, do not rewrite it.
- If the entrypoint has another filename or path, build a temporary upload package and map it to `SKILL.md`.
- Preserve meaningful relative subfolders such as `scripts/`, `docs/`,
  `commands/`, `templates/`, `examples/`, `assets/`, or `prompts/` when they
  are part of the usable skill package.
- If a runtime command path such as `.cursor/commands/foo.md`,
  `.codex/commands/foo.md`, or `.claude/commands/foo.md` is relevant to using
  the skill, copy or merge that command into `commands/foo.md`, rewrite active
  references to the package-relative command path, and add or merge
  `commands/manifest.json` with runtime target hints.
- If the source package already contains `commands/`, preserve existing command
  files. Compare collisions, merge manifest entries when safe, and stop for user
  input instead of silently overwriting command artifacts.
- Strip initialized dependency trees from that temporary upload package and keep
  only the skill sources, assets, and setup manifests/lockfiles needed to
  explain later installation.
- Preserve required local artifacts while trimming the package. Dependency
  trees are excluded, but templates, prompts, example inputs, fixtures, and
  other package-local runtime assets are not dependency trees and should not be
  dropped when the skill depends on them.
- Never rewrite the user workspace in place; only the temporary upload package may be changed.
- Do not call `POST /proposals` until the temporary upload package is final,
  recursively scanned, and hashed.
- Treat server-side `validate-upload` as a final server check after local
  package proof, not as the first path/reference scanner.
- Before proposal creation, scan all readable files in the final package for at
  least `.cursor/skills/`, `.cursor/commands/`, `.codex/commands/`,
  `.claude/commands/`, `CursorProjects/`, `/Users/`, parent-directory
  references such as `../`, absolute local paths, Markdown links, Markdown
  inline-code file paths, and JSON `path`/`source` fields.
- If a required artifact is missing, an outside-root reference is unexplained,
  or a command collision is unresolved, stop before `POST /proposals` and ask
  the user.
- The agent should tell the submitter what was normalized and what the final server-side package structure will be.
- The agent should also tell the submitter which local artifacts were treated as
  required and why, especially when non-code files such as `.pptx`, `.pdf`,
  images, templates, or fixture data are included.
- While the proposal is still `in_upload`, metadata corrections should be
  applied with `PATCH /proposals/{id}`. This is the correct path for correcting
  title, description, category, tags, capabilities, or entrypoint after
  submitter-side post-checks.
- While the proposal is still `in_upload`, the agent may abort the upload with
  `DELETE /proposals/{id}`. After `finalize-upload`, public proposal mutation
  and deletion are blocked.
- When uploading a file that belongs in a subfolder, the agent should send the
  relative package path in the multipart `path` field instead of flattening the
  file into the proposal root.
- While the proposal is still `in_upload`, the same upload endpoint is an
  upsert by relative path. If post-checks find a file-level issue, fix the
  temporary upload package and re-upload the corrected file with the same
  multipart `path`; do not create another proposal just to replace an open
  upload file.
- Before finalization, call `POST /proposals/{id}/validate-upload`. It returns
  structured package-reference findings without extracting, judging,
  finalizing, or changing proposal status. Fix every finding where
  `blocksFinalize=true` in the temporary upload package, upsert changed files,
  and run validate-upload again until `valid=true`.
- Validate-upload findings include `kind`, `severity`, `blocksFinalize`,
  `file`, `line`, `candidate`, and `suggestedReplacement` so the temporary
  upload package can be edited surgically. Runtime-output examples that use
  variable placeholders such as `{output}/screenshots/{name}.png` and
  documentation-only external references are not hard-blocking package-file
  references. Portable command findings such as
  `portable_command_missing`, `portable_command_reference`,
  `portable_command_manifest_missing`, and
  `portable_command_manifest_invalid` are guidance for packaging optional
  command shortcuts.
- The agent should pre-check the configured maximum file count, file-size cap,
  and blocked dependency-tree paths from `GET /howToPropose` before the first
  upload request so the package fails locally, not halfway through upload.

## Pre-submission duplicate check (required for local upload flow)

Before creating a proposal, local agents should check whether identical or similar content already exists and stop for explicit confirmation
if there is a likely duplicate.

```bash
# Optional: compute local file SHA-256 values if you want exact content checks
shasum -a 256 SKILL.md

# Check for duplicates and similar existing skills
RESPONSE=$(curl -s -X POST http://localhost:3041/api/proposals/check-duplicate   -H 'Content-Type: application/json'   -d '{
    "skillId": "my-new-skill",
    "title": "My New Skill",
    "description": "What it does.",
    "category": "automation",
    "tags": ["agent"],
    "capabilities": ["read"],
    "entrypoint": "SKILL.md",
    "files": [
      { "path": "SKILL.md", "sha256": "OPTIONAL_LOCAL_SHA256" }
    ]
  }')

echo "$RESPONSE" | jq .
# Fields:
# - submittedContentDigest: only set if file fingerprints were provided
# - exactDuplicateProposalId / exactDuplicateSkillId: exact content matches
# - similarMatches: ranked list of similar proposals/skills with similarityScore and differences
# - skillIdCollision: whether the target skillId already exists
```

`check-duplicate` is informational on the API contract. A local submission flow should still apply a blocking confirmation rule:

- stop and ask the user when an exact duplicate is found
- stop and ask the user when a similar candidate crosses the threshold (default `0.62`) with matching title/description intent
- stop and ask the user when the chosen `skillId` already exists

Before asking, the agent must show enough context for the user to make the
decision:

- identify the duplicate candidate: `kind`, `id`, `skillId` or title,
  status/version when available, and similarity score for similar matches
- summarize the core overlap: matching title or intent, shared category, shared
  tags/capabilities, matching entrypoint, and exact content digest when
  available
- summarize what would change if uploaded: new skill, new draft version, admin
  update request, unchanged duplicate, changed metadata, changed
  tags/capabilities, changed entrypoint, added/removed files, or changed file
  fingerprints
- include a concise diff from `similarMatches[].differences` and the local file
  fingerprint comparison; if public APIs do not expose the duplicate file
  contents, say that only metadata and hashes were compared

The agent must not call `POST /proposals` until the user explicitly confirms
uploading despite the duplicate or chooses one of the returned
`resolutionOptions`.

The response contains `resolutionOptions` when there is a collision or exact duplicate. Each option has:

- `strategy`: `create_new_skill`, `create_new_version`, or `request_admin_update`
- `label`: human-readable action name
- `description`: what will happen if this option is chosen
- `suggestedSkillId`: the skillId to use for the proposal
- `requiresAdminAction`: whether this path needs an admin directly, not just proposal conversion

Example decision flow:

1. Call `POST /proposals/check-duplicate`.
2. If `exactDuplicateSkillId` is set, ask the user whether to create a new draft version of that skill (`create_new_version`) or request an admin update (`request_admin_update`).
3. If `skillIdCollision.exists` is true, ask the user whether to keep the id (new draft version), pick the auto-suggested new id (`create_new_skill`), or request an admin update.
4. Use the selected `suggestedSkillId` in `POST /proposals`.
5. Attach files and poll the status endpoint as usual.

## Submitting a proposal (agent side)

Agents can propose new skills or changes to existing skills without admin credentials:

```bash
# 1. Create proposal
RESPONSE=$(curl -s -X POST http://localhost:3041/api/proposals \
  -H 'Content-Type: application/json' \
  -d '{
    "skillId": "my-new-skill",
    "title": "My New Skill",
    "description": "What it does.",
    "category": "automation",
    "tags": ["agent"],
    "entrypoint": "README.md"
  }')

PROPOSAL_ID=$(echo "$RESPONSE" | jq -r '.id')
STATUS_URL=$(echo "$RESPONSE" | jq -r '.statusUrl')

# 2. Attach the final normalized package files
curl -s -X POST "http://localhost:3041/api${STATUS_URL%/status}/files" \
  -F "file=@SKILL.md"

# 3. Poll status
curl -s "http://localhost:3041/api${STATUS_URL}" | jq .
```

The submit response contains:

- `id`: proposal identifier
- `message`: confirmation and explanation of the admin-review boundary
- `statusUrl` / `checkUrl`: public status endpoint to poll

The status response contains:

- `status`, `latestJudgementRisk`, `rejectionReason`, `convertedSkillId`
- `contentDigest`: content-derived digest of the proposal metadata and attached file checksums
- `duplicateOfProposalId` / `duplicateOfSkillId`: set when identical content already exists elsewhere; the submit is not blocked
- `reviewNote`: whether admin review is still pending or completed
- `nextStepForSubmitter`: what the agent can do (poll only)
- `adminOnlyNextSteps`: what the agent cannot do (review, convert, publish)

## What agents can and cannot do

| Action | Agent | Admin |
|--------|-------|-------|
| Discover / list / search / read skills | ✅ | ✅ |
| Download skill files | ✅ | ✅ |
| Submit a proposal | ✅ | ✅ |
| Attach files to own proposal | ✅ | ✅ |
| Poll proposal status | ✅ | ✅ |
| Review / judge proposals manually | ❌ | ✅ |
| Convert proposal to skill | ❌ | ✅ |
| Approve / publish / deprecate skills | ❌ | ✅ |
| Read unpublished drafts | ❌ | ✅ |

Configured auto-publish is neither an agent permission nor an admin endpoint. It is
an operator-controlled runtime policy that can publish eligible green proposals
after real judgements.

## Reference skill

A minimal reference skill is published under `data/skills/registry-bootstrap/1.0.0/`:

- `README.md` – overview for agents
- `WORKFLOW.md` – concrete step-by-step curl examples

No standalone client is required. Agents use the API directly using the contract from `/discover` and the OpenAPI specification at `/openapi.yaml`.


## What if a proposal needs to be corrected?

An agent **cannot** update or delete an existing proposal. If the submitted proposal is incomplete or wrong, the agent can simply submit a new proposal. Only an admin decides which proposal to convert. The public status URL always reflects the exact proposal that was submitted.

## Duplicate names, categories or content

The registry exposes duplicate information so agents can make informed upload
decisions before creating noise for admins.

Local submission agents should call `POST /proposals/check-duplicate` before creating a
proposal. They should compare title, description intent, category, tags,
capabilities, target `skillId`, entrypoint, content digest, and file SHA-256
fingerprints when available.

The API does not hard-block every duplicate by itself because admins may still
want a new version, an update request, or a deliberately separate skill. The
agent-side flow must still stop and ask the user when it sees:

- exact content already published or proposed
- a `skillId` collision
- a similar match above the configured threshold
- ambiguous metadata where the agent cannot tell whether this is a new skill or
  an update to an existing one

The duplicate response includes ranked matches, differences, collision details,
and resolution options such as `create_new_skill`, `create_new_version`, or
`request_admin_update`. A well-behaved local agent summarizes those options and
uses the user-selected resolution in `POST /proposals`.

The public status endpoint exposes `duplicateOfProposalId` and
`duplicateOfSkillId` for transparency after submission. Duplicates are therefore
visible to agents and admins throughout the workflow.

## Legacy standalone client

The directory `agents/registry-bootstrap/` still contains an older TypeScript reference client. It is no longer the recommended integration path and is kept for reference only.

## OpenAPI

The machine-readable contract is available at:

```bash
GET /api/openapi.yaml
```

## References

- [`data/skills/registry-bootstrap/1.0.0/`](../../data/skills/registry-bootstrap/1.0.0/)
- [`packages/openapi/skill-registry.openapi.yaml`](../../packages/openapi/skill-registry.openapi.yaml)
- [`docs/roadmap/EPIC-002-agent-workbench-ui.md`](../../docs/roadmap/EPIC-002-agent-workbench-ui.md)
