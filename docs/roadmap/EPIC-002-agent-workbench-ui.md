# EPIC-002: Agent Workbench UI And Registry Hardening

Current implementation state and open points are additionally tracked in
[docs/roadmap/EPIC-002-STATUS.md](EPIC-002-STATUS.md).

## Goal

The skill registry evolves from a pure management and read surface into an
agent-capable workbench. Users, admins, and agents should be able to:

- intentionally find, read, and download `published` skills
- inspect skill files safely in the browser
- submit proposals for new or changed skills
- detect skill and artifact changes deterministically
- use a clear review and approval process with custom judger judgement and human
  decision

Core idea: the portal is registry, viewer, and review system. It does not
execute uploaded skill scripts, libraries, or other artifacts.

## Product Boundaries

- All non-admin roles are initially `Consumer`.
- `published` skills are visible through the public retrieval path.
- Public/anonymous actions are limited to retrieval/download of `published`
  skills and proposal submission.
- No further server-side actions on skill contents exist for non-admins.
- Non-admins may create proposals.
- Non-admins may not see proposal details.
- The system may only show non-admins that new proposals exist.
- Admins remain solely responsible for review, labels, and final approval.
- Agents use the registry themselves and decide locally which skills or
  artifacts to pull or use.
- Actual skill usage happens outside this portal, at the user or agent.

## Domain Model

### Skill Contract

Skills remain text/file-heavy, but get a stricter contract for categorization,
sync, and retrieval.

Required fields:

- `id` - readable skill ID
- `skillUuid` - stable technical UUID of the skill
- `title`
- `description`
- `category` - exactly one required category
- `entrypoint`
- `status`
- `version`
- `versionUuid` - new UUID per skill version
- `contentDigest` - digest over the published contents of the version
- `updatedAt`

Optional fields:

- `tags[]`
- `capabilities[]`
- `useWhen`
- `doNotUseWhen`

### Categories

- Creating a skill requires exactly one `category`.
- Before skill creation, UI and agents must be able to fetch currently known
  categories.
- The system returns known categories as suggestions.
- New categories may be created.
- SQLite maintains categories canonically as metadata/index truth.
- Later category normalization remains an admin topic.

### Artifacts / Files

Every skill file needs stable sync metadata:

- `artifactId` - stable technical UUID of the artifact inside the registered
  skill version
- `path`
- `sha256`
- `size`
- `mimeType`
- `updatedAt`
- `extractable`

Agents can make pull decisions on two levels:

- skill level: `versionUuid` or `contentDigest`
- file level: `sha256`

## Architecture Decisions

### No Server-Side Execution Of Skill Code

- Uploaded scripts, libraries, and artifacts are not executed on the portal.
- The system only renders, extracts, indexes, and serves files.
- Arbitrary shell, Python, Node, or other runtime execution from skill contents
  is excluded.
- Skills and scripts are intended for local use by the user or agent, not for a
  portal runtime.

### custom judger Only For Review/Judgement

- OpenAI is no longer used.
- LLM review runs through the existing custom judger.
- Relevant adapter contract:
  - `requestArgs.userPrompt`
  - `requestArgs.systemPrompt`
  - `stream: false`
  - result from `result.data.response`
- In this epic, custom judger serves the review/judgement process, not as runtime
  for skill files.

### Persistence Model

- The filesystem remains the physical storage for original skill files and
  downloads in the first iteration.
- SQLite is expanded in this epic into the domain truth and query layer for
  metadata, visibility, categories, sync states, and retrieval-relevant indexes.
- SQLite contains at least:
  - skills
  - skill versions
  - categories
  - proposal metadata
  - review/judgement data
  - file metadata
  - checksums
  - visibility status
  - search index
- The filesystem is therefore artifact/blob storage, not the only domain truth.
- This shift must be explicitly reflected in relevant persistence ADRs so
  roadmap and architecture decisions stay consistent.

### Observability And Error Model

- Structured logs with `traceId`, `skillId`, `skillUuid`, `versionUuid`,
  optional `artifactId`.
- Normalized user errors for UI and API.
- Original errors remain internal or admin-visible.
- Metrics for retrieval, viewer, proposal, review, publish, and extraction.

## User And Agent Flow

### Public Consumer

- search and read `published` skills
- view skill files
- download files
- read usage guidance
- submit proposals
- see notice about new proposals

### Admin

- inspect proposals
- set or confirm labels
- inspect KI judgements
- reject / convert / approve / publish / deprecate

### Agentic Retrieval

An agent should be able to use the registry path without special logic:

1. Read categories and discovery endpoints.
2. Search or directly resolve skills.
3. Compare `skillUuid`, `versionUuid`, `contentDigest`, and file checksums.
4. Pull only changed artifacts locally.
5. Use skill files locally.

The decision whether a skill or artifact is used locally belongs entirely to
the agent.

## Viewer And Workbench UX

### Skill View

A skill is displayed like a structured folder:

- left area: folder/file tree
- right area: file viewer

### Text Files

For text-based content:

- normal read view
- toggle for invisible Unicode/UTF characters
- display for:
  - spaces
  - tabs
  - line breaks
  - zero-width characters
  - BOM
  - bidi/control chars

### Extractable Files

Files with meaningfully extractable content:

- always downloadable
- additionally expose `Extracted Content`
- `Extracted Content` is collapsible
- initially collapsed

### Non-Extractable Files

- metadata and browser download only

### Artifact Rendering In First Iteration

- inline rendering only for text-based artifacts
- other artifacts only downloadable

## Proposal, Review, And Rerun Model

### Proposal

- Users may submit proposals without admin login.
- Proposal details remain admin-only.
- Non-admins see at most an aggregated notice that new proposals exist.

### Review

- KI judgement runs through custom judger.
- Result is normalized, enriched with labels, and shown in admin.
- Final approval remains a human admin decision.

### Labels

At least plan for:

- `safe`
- `needs_review`
- `contains_executable`
- `external_dependency`
- `sensitive_input`
- `prompt_injection_risk`
- `download_only`

### Reruns

In this epic, `rerun` does not mean execution of skill code. It means repeating
internal registry processes on unchanged skill/proposal data.

At least three rerun types are required:

- `re-extract`: run content extraction again for existing files
- `re-judge`: run KI judgement again for proposal, skill version, or file
- `re-index`: rebuild SQLite search index and retrieval metadata

Guardrails:

- Reruns do not mutate original files.
- Reruns do not execute skill scripts.
- Reruns only write new derived metadata, extracts, judgements, or index
  entries.
- Reruns must be auditable.

## Visibility And Permissions

### Public / Anonymous

- read `published` skills
- show or download skill files
- read categories
- submit proposals
- see aggregated proposal notice

### Non-Admin

- no proposal details
- no review labels
- no approval actions

### Admin

- proposal detail and review functionality
- inspect labels and judgements
- execute approval and status transitions

## API And Contract Consequences

The public contract needs at least:

- discovery of read paths
- retrieval only for `published`
- category fetch
- skill responses with `skillUuid`, `versionUuid`, `contentDigest`
- file responses with `artifactId`, `sha256`, `size`, `mimeType`, `updatedAt`,
  `extractable`
- public proposal submit path
- public proposal notice without proposal detail data

The admin contract needs at least:

- proposal detail and review data
- rerun endpoints for extraction, judgement, and reindex
- error responses with normalized user text plus internal original error trace

## Documentation And Maintenance Locations

This epic requires material updates in these documentation artifacts:

- `packages/openapi/skill-registry.openapi.yaml`
- co-located specs at affected HTTP, use-case, storage, and search boundaries
- relevant ADRs for persistence, proposal/review process, and auth boundaries
- `docs/progress/CURRENT_STATUS.md`
- `docs/progress/NEXT_STEPS.md`
- `docs/progress/CHANGELOG_INTERNAL.md`
- `docs/roadmap/EPIC-002-STATUS.md`

New contractual rules must always land first or at the same time in spec and
OpenAPI, not later only in code.

## Work Packages

### AP-01: Harden Skill Contract For Categories And Sync

**Goal:** Complete skill, version, and artifact metadata for agent sync and
viewer.

**Deliverables:**

- `skillUuid`, `versionUuid`, `contentDigest`
- artifact metadata with `artifactId`, `sha256`, `updatedAt`, `extractable`
- `category` as required field
- `tags[]` as optional metadata
- category fetch and category storage model
- specs for skill/artifact contract

### AP-02: Expand SQLite As Metadata Truth

**Goal:** SQLite models domain state; filesystem serves as artifact storage.

**Deliverables:**

- SQLite schema for skills, versions, categories, files, proposals, reviews
- clear synchronization direction between filesystem and SQLite
- migration/reindex path
- specs for persistence boundaries

### AP-03: Extend Public Retrieval For Agents

**Goal:** Agents can detect changes efficiently and pull only what is needed.

**Deliverables:**

- retrieval responses with UUIDs, digests, checksums, and timestamps
- endpoints for categories
- endpoints for file metadata and downloads
- only `published` in public read path

### AP-04: Skill Viewer With Folder Tree And Text/Artifact View

**Goal:** Users can understand skills like a local folder.

**Deliverables:**

- folder tree UI
- file viewer for text files
- invisible-character toggle
- collapsible `Extracted Content`
- download for all files

### AP-05: Sharpen Proposal Visibility And Admin Boundaries

**Goal:** Proposal details remain admin functionality while general notices stay
possible.

**Deliverables:**

- clear public/admin separation for proposals
- aggregated notice/badge mechanism for new proposals
- admin guard in frontend and API
- specs for visibility and guards

### AP-06: Embed custom judger Judgement Into Review Process

**Goal:** Review labels and judgements are supported through custom judger.

**Deliverables:**

- custom judger adapter following `userPrompt` / `systemPrompt` / `stream:false`
- judgement prompts and output normalization
- label derivation
- admin view for review result and original errors
- specs for review/label process

### AP-07: Reruns, Observability, And Error Normalization

**Goal:** Registry-internal follow-up processes are repeatable and traceable.

**Deliverables:**

- rerun flows for extraction, judgement, and reindex
- auditability for reruns
- structured logs
- normalized user errors
- original errors for admin/debug
- metrics for core paths

## Epic Acceptance Criteria

- `published` skills are visible through public retrieval; others are not.
- A skill shows `skillUuid`, `versionUuid`, and file-level change metadata in
  the API contract.
- Agents can decide through digests and checksums whether a pull is needed.
- Creating a skill requires `category`.
- Categories can be fetched before creation.
- Viewer shows skills as folder structure.
- Text files have an invisible-character toggle.
- Extractable files show initially collapsed `Extracted Content`.
- Non-text artifacts are at least downloadable.
- Proposal details are not visible to non-admins.
- Proposal submit is possible without admin login.
- The system can show non-admins that new proposals exist.
- Review uses custom judger instead of OpenAI.
- Admins can inspect judgements and labels and make the final decision.
- Reruns do not execute skill files and do not mutate original artifacts.
- No skill script or artifact is executed on the portal.
- `./scripts/check.sh` passes.

## Explicitly Out Of Scope

- arbitrary server-side execution of skill scripts
- fully generic action-execution platform on the portal
- rendering non-text artifacts in the browser beyond download
- MCP server
- semantic search
- authentik integration
- complex RBAC

## Dependencies And Order

1. Harden skill/artifact contract and categories.
2. Update persistence and index model.
3. Lift public retrieval onto new sync metadata.
4. Adjust viewer and proposal visibility.
5. Integrate custom judger review and reruns.
6. Finalize observability and error paths.
