# EPIC-013: Use Skill Hub Bootstrap And Download Metadata

## Status

Implemented

## Objective

Make every ManagedSkillHub registry immediately usable by agents through a
downloadable `use-skill-hub` bootstrap skill and a generated
`skill-hub-meta.json` metadata file in every downloaded skill package.

The first user-facing flow should be simple:

```text
Set up https://skill-hub.example.com/api for agent use.
```

An agent should then be able to:

1. call `GET /discover` from the user's network context;
2. find the advertised `use-skill-hub` bootstrap skill;
3. either read it on demand or download it as a local package;
4. use live registry endpoints instead of stale hard-coded documentation;
5. later update or re-propose the local skill with metadata-aware, backup-aware
   behavior.

## Background

Google's Open Knowledge Format (OKF) uses Markdown documents plus structured
metadata such as `type`, `title`, `description`, `resource`, `tags`, and
`timestamp`. ManagedSkillHub adopts the useful metadata idea without rewriting
skill author content or colliding with existing skill frontmatter.

Instead of injecting YAML frontmatter into `SKILL.md`, the registry creates a
separate generated metadata file at download time:

```text
skill-hub-meta.json
```

This file is internal to the downloaded local package. It is not authored by
skill maintainers, must not be uploaded as proposal content, and must not be
stored as a regular managed skill artifact.

## Product Decisions

- `use-skill-hub` is the reserved bootstrap skill ID.
- The built-in fallback bootstrap skill version is `0.0.0-initial`.
- A real published `use-skill-hub` skill takes precedence over the built-in
  fallback.
- The fallback must be directly usable from a fresh system and directly
  downloadable through the normal public read package route.
- The fallback must not appear in normal `/skills`, `/skills/search`,
  `/categories`, or `/tags` results.
- `/discover` must always advertise a `bootstrapSkill` section.
- `skill-hub-meta.json` is generated for every package download.
- Download packages always use ZIP, including skills whose published version
  contains only `SKILL.md`.
- `SKILL.md` content is not rewritten at download time.
- Existing YAML frontmatter, raw tags, descriptions, comments, or local
  conventions inside `SKILL.md` remain untouched.
- `source_of_truth` is not a metadata field. Source-of-truth behavior belongs
  as text guidance in `use-skill-hub`, telling agents to re-read live endpoints
  when uncertain.
- `skill-hub-meta.json` is a reserved filename and proposal upload must reject
  it anywhere in the submitted package.
- Local edit markers such as `edited_locally` are guidance for agents, not a
  server-enforced state.
- Updates must always be local-change-aware and user-confirmed before replacing
  files.
- Auto-publish must remain blocked for bootstrap/system-managed skills.

## Non-Goals

- No mutation of published `SKILL.md` content during download.
- No automatic local update helper is required in the registry.
- No global requirement that authored skills use OKF YAML frontmatter.
- No hidden publication of the built-in fallback into the managed content
  store.
- No automatic overwrite of locally edited skills.
- No auto-publish path for `use-skill-hub` updates.

## User-Facing Behaviors

### First-Time Setup

When a user gives an agent a registry URL, the agent should use a local
network-capable HTTP client such as `curl`:

```bash
curl -sS "https://skill-hub.example.com/api/discover"
```

The discovery response contains `bootstrapSkill` with:

- `id`
- `title`
- `description`
- `available`
- `fallback`
- `version`
- `readUrl`
- `packageUrl`
- `manifestUrl`
- `versionsUrl`
- `recommended`
- `shortPath`

The agent can choose:

- one-off use: read `readUrl`;
- persistent local use: download `packageUrl`, because it includes
  `skill-hub-meta.json`.

### On-Demand Skill Use

For the single-skill-file use case, agents may read:

```text
GET /skills/use-skill-hub/files/SKILL.md
```

This does not create local metadata and is therefore suitable only for short,
one-off usage.

For anything persistent, the package download path is preferred:

```text
GET /skills/use-skill-hub/package
```

### Persistent Local Use

Every downloaded package contains:

```text
SKILL.md
skill-hub-meta.json
...
```

The local agent reads `skill-hub-meta.json` for registry identity, URLs,
versions, content digest, proposal defaults, and update policy. The skill body
remains the behavior instruction.

### Local Updates

When the user asks whether a local skill has updates, the agent must:

1. read local `skill-hub-meta.json`;
2. use local `curl` or another network-capable client to fetch
   `links.versions` or `links.manifest`;
3. compare `version.version`, `version.versionUuid`, and
   `version.contentDigest`;
4. inspect local files for changes compared to the last downloaded state when
   possible;
5. explain the remote change and local-change risk;
6. ask the user before replacing files;
7. create a backup inside the skill folder, for example
   `backups/<old-version>-<timestamp>/`;
8. download and extract the selected package version only after confirmation;
9. preserve or migrate user edits when requested.

The agent must treat a missing `edited_locally` marker as insufficient proof
that no local edits exist. It still compares files when possible and asks before
destructive replacement.

### Re-Proposal From A Local Download

When the user edits a downloaded skill locally and asks to submit it back to the
registry, the agent must:

1. read `skill-hub-meta.json`;
2. remove `skill-hub-meta.json` from the proposal package;
3. read live `links.howToPropose`;
4. use `proposalDefaults.targetSkillId`;
5. prefer `proposalDefaults.resolution = create_new_version` for existing
   skill IDs;
6. run duplicate and package validation as described by `/howToPropose`;
7. explain that new versions and existing skill IDs cannot auto-publish and
   require admin conversion/review.

## API Contract Changes

### Discovery

Add `bootstrapSkill` to `GET /discover`.

Example when a published `use-skill-hub` exists:

```json
{
  "bootstrapSkill": {
    "id": "use-skill-hub",
    "available": true,
    "fallback": false,
    "title": "Use Skill Hub",
    "description": "Short bootstrap guide for using this registry.",
    "version": "1.0.0",
    "readUrl": "https://skill-hub.example.com/api/skills/use-skill-hub/files/SKILL.md",
    "packageUrl": "https://skill-hub.example.com/api/skills/use-skill-hub/package",
    "manifestUrl": "https://skill-hub.example.com/api/skills/use-skill-hub/manifest",
    "versionsUrl": "https://skill-hub.example.com/api/skills/use-skill-hub/versions",
    "recommended": "package",
    "shortPath": "For one-off use, read readUrl. For persistent local use, download packageUrl because it includes skill-hub-meta.json for updates."
  }
}
```

Example when only the built-in fallback exists:

```json
{
  "bootstrapSkill": {
    "id": "use-skill-hub",
    "available": true,
    "fallback": true,
    "title": "Use Skill Hub",
    "description": "Built-in initial bootstrap guide for using this registry.",
    "version": "0.0.0-initial",
    "readUrl": "https://skill-hub.example.com/api/skills/use-skill-hub/files/SKILL.md",
    "packageUrl": "https://skill-hub.example.com/api/skills/use-skill-hub/package",
    "manifestUrl": "https://skill-hub.example.com/api/skills/use-skill-hub/manifest",
    "versionsUrl": "https://skill-hub.example.com/api/skills/use-skill-hub/versions",
    "recommended": "package",
    "shortPath": "Download packageUrl for persistent local use. A published use-skill-hub version will replace this initial fallback once available."
  }
}
```

### Request-Aware URLs

Generated bootstrap and metadata links must reflect the URL context used by the
caller:

- preserve the `/api` prefix when the request is made through `/api/...`;
- prefer the configured public API base URL when it is explicitly set for the
  deployment;
- otherwise derive scheme, host, and prefix from the request;
- never embed a static template domain in fallback content or metadata.

### Public Read Fallback

The public read path must resolve the built-in fallback for the reserved skill
ID when no published skill exists:

```text
GET /skills/use-skill-hub
GET /skills/use-skill-hub/manifest
GET /skills/use-skill-hub/files
GET /skills/use-skill-hub/files/SKILL.md
GET /skills/use-skill-hub/package
GET /skills/use-skill-hub/versions
```

The fallback is not a normal catalog result:

```text
GET /skills
GET /skills/search
GET /categories
GET /tags
```

must not include it unless a real published `use-skill-hub` exists.

### Package Download

`GET /skills/{skillId}/package` always returns a ZIP file.

The ZIP must contain:

- the published version files;
- generated `skill-hub-meta.json`;
- no generated rewrite of `SKILL.md`.

The previous direct single-file `SKILL.md` response is replaced by ZIP output
for package downloads. Direct one-off reads remain available through the file
endpoint.

### Reserved Metadata File

Proposal upload and validation must reject any submitted artifact whose basename
is:

```text
skill-hub-meta.json
```

Rationale:

- the file is generated by the registry for local consumers;
- it contains local download/update state;
- it must not be re-ingested as authored skill content;
- local re-proposals should use it as guidance and remove it from the upload
  package.

## `skill-hub-meta.json` Schema

Initial schema identifier:

```json
"managed-skill-hub.skill-meta.v1"
```

Example:

```json
{
  "schema": "managed-skill-hub.skill-meta.v1",
  "downloadedAt": "2026-08-12T12:00:00.000Z",
  "registry": {
    "id": "managed-skill-hub",
    "name": "ManagedSkillHub",
    "apiBaseUrl": "https://skill-hub.example.com/api"
  },
  "skill": {
    "id": "use-skill-hub",
    "title": "Use Skill Hub",
    "description": "Short bootstrap guide for using this registry.",
    "category": "registry-system",
    "tags": ["skill-hub", "bootstrap", "discovery", "curl", "proposal"],
    "capabilities": ["discover", "download", "propose"],
    "entrypoint": "SKILL.md",
    "skillUuid": "..."
  },
  "version": {
    "version": "0.0.0-initial",
    "versionUuid": "...",
    "contentDigest": "...",
    "publishedAt": null,
    "fallback": true
  },
  "links": {
    "discover": "https://skill-hub.example.com/api/discover",
    "howToPropose": "https://skill-hub.example.com/api/howToPropose",
    "skill": "https://skill-hub.example.com/api/skills/use-skill-hub",
    "manifest": "https://skill-hub.example.com/api/skills/use-skill-hub/manifest?version=0.0.0-initial",
    "versions": "https://skill-hub.example.com/api/skills/use-skill-hub/versions",
    "package": "https://skill-hub.example.com/api/skills/use-skill-hub/package?version=0.0.0-initial",
    "readEntrypoint": "https://skill-hub.example.com/api/skills/use-skill-hub/files/SKILL.md?version=0.0.0-initial",
    "proposals": "https://skill-hub.example.com/api/proposals"
  },
  "proposalDefaults": {
    "targetSkillId": "use-skill-hub",
    "resolution": "create_new_version",
    "entrypoint": "SKILL.md",
    "metadataSource": "skill-hub-meta.json",
    "excludeFromProposal": ["skill-hub-meta.json"]
  },
  "localUpdatePolicy": {
    "backupDirectory": "backups",
    "localEditMarker": "edited_locally",
    "requiresUserConfirmationBeforeReplace": true,
    "instruction": "Before replacing local files, compare local changes, create a backup inside the skill folder, and ask the user."
  }
}
```

Consumers must preserve unknown fields if they rewrite this file locally. The
registry owns the schema and may add fields in later versions.

## Built-In `use-skill-hub` Fallback Content

The fallback `SKILL.md` is short. It covers:

- use local `curl` or an equivalent local HTTP client when private DNS, VPN, or
  sandbox/network restrictions might matter;
- if an agent's sandbox blocks network access, request network permission or
  ask the user to run the shown `curl` command;
- start with `GET /discover`;
- use `GET /howToPropose` before any proposal;
- use `/skills/search`, `/skills/{id}/manifest`, `/skills/{id}/versions`, and
  `/skills/{id}/package`;
- for one-off usage, read `readUrl`;
- for persistent local usage, download `packageUrl`;
- `skill-hub-meta.json` is local metadata and must not be included in
  proposals;
- for updates, compare live versions/digests, back up locally, and ask the user
  before replacing files;
- when behavior seems stale or a request fails, re-read live `/discover`,
  `/howToPropose`, `/skills/{id}/manifest`, and `/skills/{id}/versions`.

No static domain may be embedded in the fallback template. The API layer injects
request-aware URLs into generated metadata and any URL snippets that are served
as fallback file content.

## Auto-Publish Policy

Current auto-publish behavior already blocks proposals that target an existing
skill ID. That protects `use-skill-hub` updates once the skill exists.

The implementation also has an explicit system-managed blocker as defense in
depth:

- category `registry-system`; or
- tag `system-managed`; or
- reserved skill ID `use-skill-hub`; or
- a missing-`skillId` proposal title that would derive the reserved
  `use-skill-hub` ID during conversion.

The public proposal guidance must explain that updating `use-skill-hub` creates
a draft/new-version review path and cannot auto-publish.

## Frontend Requirements

The frontend exposes a first-run "Use Skill Hub" entry point.

When `discover.bootstrapSkill.available = true`:

- show the title and description;
- show a package download action;
- show an on-demand read action for `SKILL.md`;
- explain that package download is recommended for persistent local use because
  it contains update metadata.

When `discover.bootstrapSkill.fallback = true`:

- explain that the registry is using the built-in `0.0.0-initial` bootstrap;
- show the same download/read actions;
- optionally show an admin-facing notice that publishing a managed
  `use-skill-hub` skill will replace the fallback.

When a real published `use-skill-hub` exists:

- show its published version;
- use the normal package/read URLs;
- do not show fallback wording.

## Implementation Process

This epic was implemented in the following sequence:

1. Added and reviewed this EPIC document to fix the product decisions before
   changing contracts.
2. Updated co-located specs for the public read controller, proposal upload
   controller, auto-publish use case, and package-download/content-storage
   proof scripts.
3. Extended the OpenAPI contract with `DiscoveryResponse.bootstrapSkill`,
   `BootstrapSkill`, and `SkillHubMeta`, and changed package downloads to
   document ZIP-only output.
4. Added the application-layer `skill-hub-meta` helper for reserved constants,
   reserved metadata filename detection, system-managed candidate detection,
   deterministic UUID/digest metadata, generated links, proposal defaults, and
   local update policy.
5. Integrated request-aware URL resolution into public read responses. Explicit
   non-default `PUBLIC_API_BASE_URL` wins; otherwise the controller uses
   Fastify's trusted request host/protocol and preserves the `/api` prefix.
6. Added the virtual `use-skill-hub@0.0.0-initial` fallback to public read
   detail, manifest, files, entrypoint-file, package, and versions routes while
   keeping it out of list/search/category/tag results.
7. Changed package downloads to always emit ZIP, add generated
   `skill-hub-meta.json`, keep authored `SKILL.md` unchanged, and use direct
   file reads for short one-off entrypoint usage.
8. Added proposal upload rejection for any submitted basename
   `skill-hub-meta.json`.
9. Added the auto-publish system-managed blocker for explicit `use-skill-hub`,
   category `registry-system`, and tag `system-managed`.
10. Added the frontend first-run entry point that reads
    `discover.bootstrapSkill` and exposes package download plus one-off read
    actions.
11. Updated agent-facing docs, progress docs, OpenAPI parity, package download
    proofs, provider/cutover proofs, content-storage parity proof, and auth
    matrix/agent-contract fixtures.
12. Ran review, then hardened the implementation:
    - request-aware fallback URLs no longer trust raw forwarded headers
      directly; they rely on Fastify's configured trust boundary;
    - real package metadata now carries `publishedAt` from the published
      version summary;
    - auto-publish now also blocks a new proposal whose title would derive
      `use-skill-hub`;
    - package metadata computes `contentDigest` from the same reserved-file
      filtered authored-file list that the ZIP actually delivers.

The final validation gates for the implementation were:

- `npm test --workspace=apps/api -- skill-read.controller.test.ts auto-publish-proposal.usecase.test.ts submit-proposal.usecase.test.ts`
- `npm run typecheck`
- `./scripts/check.sh`
- `npm run build:prod`
- `npm audit`

The production build still reports the known Vite chunk-size warning, but it is
not a build failure.

## Implementation Details

### 1. Specs And Contracts

- Updated `SkillReadController.spec.md` with `bootstrapSkill`, virtual fallback,
  request-aware URLs, always-ZIP package downloads, and reserved metadata file
  rules.
- Updated `ProposalController.spec.md` with `skill-hub-meta.json` rejection.
- Updated `AutoPublishProposalUseCase.spec.md` with the system-managed blocker.
- Updated OpenAPI schemas and examples:
  - `DiscoveryResponse.bootstrapSkill`;
  - `SkillHubMeta`;
  - package download response remains binary ZIP;
  - proposal upload validation error for reserved metadata file.
- Updated `docs/product/AGENT_BOOTSTRAP.md` with on-demand versus persistent
  usage and local update rules.

### 2. Metadata Builder

The application-layer helper builds `skill-hub-meta.json` from:

- request-aware API base URL;
- registry identity;
- skill manifest/version/file metadata;
- fallback flag;
- generated links;
- proposal defaults;
- local update policy.

The helper does not read or write files directly. It returns a JSON-serializable
object and a UTF-8 buffer for packaging.

### 3. Request-Aware URL Resolution

Centralize API URL generation for discovery, fallback metadata, and package
metadata so all generated links agree.

The resolver should account for:

- configured public API base URL;
- `/api` prefix detection;
- reverse proxy headers already trusted by the runtime configuration;
- local development paths.

### 4. Built-In Bootstrap Skill Provider

Add a virtual provider for `use-skill-hub@0.0.0-initial` that can supply:

- detail DTO;
- manifest;
- file list;
- `SKILL.md` file content;
- version list;
- content digest/version UUID values derived deterministically from the
  fallback template and metadata inputs.

The provider is only consulted when the normal public read path does not find a
published `use-skill-hub`.

### 5. Public Read Integration

Integrate the fallback into:

- `GET /discover`;
- `GET /skills/use-skill-hub`;
- `GET /skills/use-skill-hub/manifest`;
- `GET /skills/use-skill-hub/files`;
- `GET /skills/use-skill-hub/files/SKILL.md`;
- `GET /skills/use-skill-hub/package`;
- `GET /skills/use-skill-hub/versions`.

Do not integrate the fallback into:

- `GET /skills`;
- `GET /skills/search`;
- `GET /categories`;
- `GET /tags`;
- search index/projections.

### 6. Package Download

Package downloads now always emit ZIP:

- include all published files;
- add generated `skill-hub-meta.json`;
- exclude stored files whose basename is `skill-hub-meta.json`;
- compute generated metadata digests from the same filtered file list that is
  delivered in the ZIP;
- sort entries deterministically;
- keep safe relative ZIP paths;
- return the response as an attachment.

Direct single-file usage remains possible through file read endpoints.

### 7. Proposal Upload Guard

Submitted files named `skill-hub-meta.json` are rejected at upload time.

The error should be machine-readable and tell agents:

- this is a generated local metadata file;
- remove it from the proposal package;
- use it only to recover target skill ID, version URLs, and proposal defaults.

### 8. Auto-Publish Guard

The auto-publish gate fails closed for:

- `proposal.skillId === "use-skill-hub"`;
- a missing-`skillId` proposal title that slugifies to `use-skill-hub`;
- category `registry-system`;
- tag `system-managed`.

Return `manual_review_required` with a clear classifier/audit reason.

### 9. Frontend

The UI entry point reads `discover.bootstrapSkill` and renders:

- bootstrap title/description/version;
- fallback or published state;
- download button;
- one-off read link;
- concise explanation of package metadata and updates.

Admin-facing views may show a non-blocking notice when the fallback is active.

### 10. Documentation And Agent Guidance

Updated:

- `docs/product/AGENT_BOOTSTRAP.md`;
- OpenAPI examples;
- relevant progress docs.

The guidance must explicitly say:

- use local network-capable HTTP clients;
- do not treat remote fetcher failures as proof that the registry is protected;
- `skill-hub-meta.json` is local and must not be proposed;
- compare local files and back up before updates;
- ask the user before replacing or migrating local edits.

## Validation Coverage

### Unit Tests

- Metadata/package tests cover stable schema fields, generated links, published
  timestamps, proposal defaults, and filtered content digest behavior.
- Request-aware URL tests cover direct backend, `/api` prefix, configured public
  base URL, and spoofed forwarded-header inputs.
- Fallback tests cover deterministic `0.0.0-initial` manifest/version/file data.
- Auto-publish tests cover reserved bootstrap/system-managed proposals,
  including a title-derived `use-skill-hub` candidate with no explicit
  `skillId`.

### HTTP Tests

- `/discover` includes `bootstrapSkill` when no published skill exists.
- Fallback direct read returns `SKILL.md`.
- Fallback package returns ZIP with `SKILL.md` and `skill-hub-meta.json`.
- Normal single-file skill package returns ZIP with `SKILL.md` and
  `skill-hub-meta.json`.
- Normal multi-file skill package returns ZIP with all delivered authored files
  and `skill-hub-meta.json`.
- Legacy stored files named `skill-hub-meta.json` are excluded from package
  output and metadata digest calculation.
- Proposal file upload rejects `skill-hub-meta.json`.

### Deterministic Proof Scripts

Extend or add proof coverage for:

- skill package downloads;
- agent contract/discovery;
- proposal lifecycle upload validation;
- judger/auto-publish matrix.

### Manual Acceptance

1. Fresh registry with no `use-skill-hub` content:
   - call `/discover`;
   - download fallback package;
   - inspect generated URLs;
   - verify on-demand read works.
2. Publish a real `use-skill-hub`:
   - `/discover` points to the published version;
   - fallback no longer appears.
3. Edit a local downloaded skill:
   - agent detects update metadata;
   - backs up local files;
   - asks before replacing.
4. Re-propose a local downloaded skill:
   - agent removes `skill-hub-meta.json`;
   - uses `create_new_version`;
   - auto-publish remains blocked.

## Rollout Plan

1. Implement fallback and metadata generation behind tests.
2. Change package download to always ZIP.
3. Add reserved file rejection.
4. Extend discovery and OpenAPI.
5. Update frontend entry point.
6. Deploy to testing.
7. Verify first-time setup from the testing domain with an agent using local
   `curl`.
8. Publish or propose a real `use-skill-hub` version if the built-in fallback
   text needs registry-managed customization.

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Existing consumers expect direct `SKILL.md` from package downloads | Keep one-off direct file reads available and document the package route as ZIP-only |
| Generated metadata links use the wrong domain behind a proxy | Centralize request-aware URL resolution and test configured base URL plus prefix detection |
| Agents accidentally re-propose `skill-hub-meta.json` | Reject the reserved filename and document removal in the bootstrap skill |
| Local edits are overwritten | Require backup-aware, user-confirmed update instructions in `use-skill-hub` and metadata policy |
| Fallback looks like a real published skill | Exclude fallback from lists/search/tags/categories and expose `fallback=true` |
| System bootstrap updates auto-publish | Block reserved ID/category/tag in auto-publish |

## Open Questions

- Should the package endpoint offer a legacy `?format=entrypoint` option for
  direct `SKILL.md` downloads, or is the file endpoint sufficient for one-off
  use?
- Should a real published `use-skill-hub` be seeded during install, or should
  the built-in fallback remain the only initial source until an admin publishes
  a managed version?
- Should `skill-hub-meta.json` include a file-level snapshot of downloaded
  SHA-256 values to improve local edit detection without calling the manifest
  endpoint?
- Should future registry-managed metadata support a signed/trust envelope, or
  is HTTPS plus content digest sufficient for the initial release stage?

## Definition Of Done

- `GET /discover` advertises `bootstrapSkill`.
- A fresh registry can download `use-skill-hub@0.0.0-initial`.
- Every package download includes `skill-hub-meta.json`.
- Package downloads always return ZIP.
- Direct file read still supports on-demand single-file usage.
- Proposal upload rejects `skill-hub-meta.json`.
- Auto-publish blocks bootstrap/system-managed updates.
- Frontend exposes the Use Skill Hub entry point.
- OpenAPI and co-located specs are updated.
- Deterministic checks cover fallback, metadata, package downloads, proposal
  guardrails, and auto-publish blockers.
- `./scripts/check.sh` passes.
