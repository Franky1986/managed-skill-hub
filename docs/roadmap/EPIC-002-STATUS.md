# EPIC-002 Status - Agent Workbench UI And Registry Hardening

## Purpose

This file summarizes the actually implemented state of EPIC-002. It complements:

- [docs/roadmap/EPIC-002-agent-workbench-ui.md](EPIC-002-agent-workbench-ui.md)
  for target state and requirements
- [docs/progress/CURRENT_STATUS.md](../progress/CURRENT_STATUS.md) for broader
  project state
- [docs/progress/NEXT_STEPS.md](../progress/NEXT_STEPS.md) for ongoing
  prioritization

State of this file: 2026-07-03.

## Short Conclusion

EPIC-002 is functionally complete. The epic acceptance criteria are fulfilled;
remaining items concern operational hardening, production readiness, and future
extensions outside the epic scope.

Reliably implemented:

- agent-relevant skill contract with UUIDs, digests, and file metadata
- public-vs-admin separation for skills, proposals, and judgements
- proposal submit for non-admins and admin review workbench
- skill viewer with folder structure, text viewer, invisible-character toggle,
  and `Extracted Content`
- rerun paths for `re-extract`, `re-judge`, and search reindex without executing
  skill code
- custom judger integration for the judger path with `stream: false`
- broad SQLite metadata projection as domain truth and read layer
- normalized error responses and an initial persisted observability baseline

Still open mostly:

- explicit agent bootstrap, such as an initial skill or small registry client
- deeper workbench support for file/folder operations and result presentation
- complete local end-to-end validation of custom judger in the running API server
- production work such as authentik, CI/CD, and operational hardening

## Target State Compared To Current State

### 1. Skill Contract And Sync Metadata

Status: largely implemented.

Available:

- `category` is required
- `skillUuid`, `versionUuid`, and `contentDigest` exist in the skill contract
- file metadata contains `artifactId`, `sha256`, `updatedAt`, `extractable`,
  `mimeType`, `size`
- `entrypoint`, `useWhen`, `doNotUseWhen`, `tags`, and `capabilities` are
  visible in retrieval/viewer context

Value:

- agents can deterministically detect changes on skill and file level
- viewer and admin workbench can display files with stable metadata

### 2. Categories And Discovery

Status: implemented.

Available:

- `GET /categories` returns known categories
- UI uses categories as suggestions while still allowing free text
- SQLite now treats categories as canonical metadata truth, including empty
  results

Open:

- no deeper admin normalization or governance for categories

### 3. Public Retrieval For Consumers And Agents

Status: largely implemented.

Available:

- public retrieval returns only `published` skills and published versions
- public detail/summary/version/history/file metadata reads prefer the SQLite
  catalog projection
- public proposal visibility is reduced to an aggregated notice
- downloads and file metadata remain available for `published` skills

Open:

- no dedicated agent onboarding path such as initial skill or registry client
- no semantic search

### 4. Viewer And Workbench UX

Status: functionally implemented, not deeply polished.

Available:

- public and admin skill viewers use a shared folder tree component
- text files can be read inline
- invisible characters can be made visible
- extractable files show initially collapsed `Extracted Content`
- non-text artifacts are downloadable
- admin viewer can also read unpublished versions
- admin file tree now has explicit folder context for upload and move targets

Open:

- batch/multi actions
- deeper folder operations
- richer result presentation for review/rerun actions
- stronger upload/submit guidance in public UX

### 5. Proposal Boundaries And Review

Status: largely implemented.

Available:

- proposal submit is possible without admin login
- proposal lists and details are admin-only
- non-admins only see an aggregated notice that new proposals exist
- admin proposal detail shows review metadata, file metadata, embedded reject
  form, and conversion preview
- proposal files can be read, extracted, and re-extracted

Open:

- non-admin proposal submission UX can still become more guided

### 6. custom judger Judgement

Status: functionally integrated, end-to-end not fully signed off.

Available:

- custom judger replaces OpenAI for the review/judger path
- adapter and local script follow:
  - `requestArgs.userPrompt`
  - `requestArgs.systemPrompt`
  - `stream: false`
  - response from `result.data.response`
- on-demand and stored judgement endpoints are admin-protected
- labels and review metadata are derived for proposals

Open:

- final manual end-to-end validation through the running API server outside the
  sandbox
- further hardening of production prompt/output contracts

### 7. Reruns, Error Model, And Observability

Status: core implemented.

Available:

- `re-extract`, `re-judge`, and search reindex exist as registry-internal
  follow-up processes
- guardrail applies throughout: no execution of skill code on the portal
- error responses are normalized: `error`, `code`, `requestId`, optional
  `details`, and admin-side `originalError`
- persisted observability snapshot with counters, area summaries, latest errors,
  histogram, timeline, and hourly rollups
- JSON/CSV export for observability exists

Open:

- broader filter/slice options in observability export
- more UI visibility for errors and rerun results

### 8. Persistence And Read Architecture

Status: far advanced.

Available:

- filesystem remains blob/artifact storage
- SQLite acts as domain metadata truth for large parts of retrieval, categories,
  versions, proposal metadata, judgements, history, and read hydration
- many use cases read directly from SQLite projection instead of repository
  rehydration when possible

Important:

- physical storage remains on the filesystem
- domain truth for many metadata and visibility decisions is effectively in
  SQLite now

Open:

- move remaining review/admin derivations further onto SQLite truth
- architecture/ADR follow-up for this shift can still be clearer

## Acceptance Criteria Check

### Proven Achieved

- `published` skills are visible through public retrieval; others are not
- skill contract contains `skillUuid`, `versionUuid`, and file-level change
  metadata
- categories can be fetched before creation
- viewer shows skills as folder structure
- text files have an invisible-character toggle
- extractable files show initially collapsed `Extracted Content`
- non-text artifacts are at least downloadable
- proposal details are not visible to non-admins
- proposal submit is possible without admin login
- non-admins can see that new proposals exist
- review uses custom judger instead of OpenAI
- admins can inspect judgements and make final decisions
- reruns do not execute skill files and do not mutate original artifacts
- `./scripts/check.sh` passes

### Mostly Achieved, Not Fully Operationalized

- Agents can use digests and checksums to decide whether a pull is needed.
  The contract exists, but an explicit repo-level agent bootstrap is still
  missing.
- Category is required when creating a skill.
  The contract is implemented; deeper operational category governance remains
  open.

### Do Not Count Fully Complete Yet

- complete agentic usage as a guided start path in the repo
- full local end-to-end acceptance of custom judger in a production-like server run
- final productionization of auth, operations, and CI/CD

## What Already Works For Users

### Public / Consumer

- search, filter, and read skills
- view or download published files
- read text-based content with invisible-character toggle
- submit proposals
- see notice about new proposals

### Admin

- maintain skill metadata
- read unpublished versions
- upload, move, delete files, and save text files as new draft versions
- run review status paths: `submit-review`, `approve`, `publish`, `deprecate`
- inspect or trigger skill, proposal, and file judgements
- handle proposal details with conversion preview and reject flow
- use `Extracted Content`, re-extract, and re-judge
- read observability snapshot and export

### Agent

- read public discovery and retrieval paths
- fetch categories and skill metadata
- compare skill/version/file metadata
- pull changed artifacts locally

Still missing:

- a dedicated documented start point for agents in the repo, for example an
  initial skill or small reference client

## Intentionally Not Done

- no server-side execution of skill scripts
- no general action-execution platform in the portal
- no browser rendering for non-text artifacts in the first iteration
- no MCP server in current scope
- no semantic search in current scope

## Open Points By Priority

### P1 - Rounded EPIC-002 Result: Done

- ~~Add agent bootstrap in the repo~~ - done:
  `agents/registry-bootstrap/` and `data/skills/registry-bootstrap/1.0.0/`.
- ~~Make public proposal submit UX more guided~~ - done:
  upload limits, validation, error/success presentation improved.
- Accept custom judger end-to-end locally against running API server - technically
  prepared, requires non-sandbox run.

### Follow-Up Work Outside EPIC-002

- deepen admin workbench:
  batch/multi actions, stronger folder actions, better result presentation for
  reruns and reviews

### P2 - Architecture And Operational Hardening

- move remaining read/review derivations further onto SQLite truth
- ~~Clarify architecture/ADR text for SQLite as metadata truth~~ - done:
  ADR-013 added.
- extend observability with more filters, slices, and admin error views
- expand smoke tests for more admin and judgement flows

### P3 - Productionization

- integrate authentik instead of simple login
- set up CI/CD
- complete dependency consolidation
- further harden deployment/operations path

## Local Verification

Code checks:

```bash
./scripts/check.sh
```

Local run:

```bash
npm run dev
```

Local ports:

- API: `http://localhost:3040`
- Web: `http://localhost:3041`

Further documentation:

- [docs/setup/TESTING.md](../setup/TESTING.md)
- [docs/progress/CURRENT_STATUS.md](../progress/CURRENT_STATUS.md)
- [docs/progress/NEXT_STEPS.md](../progress/NEXT_STEPS.md)
