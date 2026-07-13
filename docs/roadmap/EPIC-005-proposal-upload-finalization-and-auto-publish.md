# EPIC-005: Proposal Upload Finalization, Hard Limits, And Optional Auto-Publish

## Status

Implemented

## Objective

Make proposal uploads deterministic and safer by introducing an explicit
upload-finalization step, hard configurable upload limits, and an optional
auto-publish path for fully green proposals.

The registry must no longer assume that a proposal is complete immediately after
`POST /proposals` plus one or more file uploads. Instead, the submitter's agent
must explicitly finalize the upload once the complete proposal package is
attached. Only then may the registry start final judgement evaluation and,
optionally, auto-publish.

## Why This Epic Exists

Current proposal submission allows file-by-file attachment without a strong
package completion contract. That leaves three problems:

1. The registry cannot reliably know when a proposal package is complete.
2. Local agents do not have a hard machine-readable limit for package size and
   file count before upload begins.
3. Auto-publish on fully green results cannot be implemented safely without a
   deterministic upload completion boundary.

This epic introduces that boundary and keeps all relevant rules in the central
API contract so local agents can preflight before sending the first file.

## Product Decisions

### Upload Completion

- A proposal starts in a new public/admin-visible state:

```text
in_upload
```

- `in_upload` means:
  - proposal metadata exists,
  - file uploads may continue,
  - the proposal is not complete yet,
  - final judgements and auto-publish must not run yet.

- The submitter's agent must explicitly finalize the upload through a dedicated
  endpoint.
- Finalization is resumable:
  - if the agent was interrupted, it may continue uploading files later,
  - it may also finalize later,
  - admins can filter for `in_upload` proposals to inspect incomplete uploads.
- There is no automatic timeout-based finalization in this epic.

### Hard Upload Limits

Proposal uploads use configurable hard limits from environment-backed central
API configuration.

Initial defaults:

```env
PROPOSAL_MAX_FILES=30
PROPOSAL_MAX_FILE_SIZE_BYTES=10485760
```

Rules:

- `PROPOSAL_MAX_FILES` applies to the total number of files attached to one
  proposal.
- Every uploaded file counts, including hidden files such as `.gitignore`,
  `.python-version`, `.env.example`, and similar.
- `PROPOSAL_MAX_FILE_SIZE_BYTES` applies per file, not per proposal total.
- The initial size default is binary 10 MiB:

```text
10 * 1024 * 1024 = 10485760 bytes
```

- Exceeding either limit is a hard rejection on the violating upload request.
- The API should reject the first additional file beyond the configured maximum.

### Hard Path Exclusions

The proposal upload path must hard-block initialized dependency trees and
similar runtime package snapshots, even when the file count stays below the
configured limit.

Initial disallowed path families:

- `node_modules/`
- `.venv/`
- `venv/`
- `vendor/`
- `dist-packages/`
- `site-packages/`

These rules should remain configurable later if needed, but this epic may
implement them first as a fixed list in application configuration plus API
contract output.

### Agent Contract

`GET /howToPropose` remains the canonical machine-readable upload contract.

It must expose:

- current `maxFiles`
- current `maxFileSizeBytes`
- disallowed path families
- the requirement to run a precheck before the first upload
- the requirement to explicitly finalize the upload
- the follow-up status polling expectation

If `AUTO_PUBLISH_ON_GREEN=true`, the contract must also tell local agents:

- after successful upload finalization, check the proposal status again after
  approximately one minute to see whether the proposal was auto-published

If auto-publish is disabled, that one-minute immediate follow-up hint should not
be emitted.

### Auto-Publish

Auto-publish is optional and controlled by configuration:

```env
AUTO_PUBLISH_ON_GREEN=false
```

If enabled, a finalized proposal may move directly to `published` without
manual admin review, but only when all of the following are true:

1. The upload was explicitly finalized.
2. No upload-limit or disallowed-path violations exist.
3. No duplicate or collision signal blocks the proposal.
4. No manual admin comment, reject action, or review flag blocks automation.
5. Every active judgement required by the current system is fully green.
6. Every judgable proposal file is fully green.
7. Category-based auto-publish exclusion does not trigger.
8. The category exclusion classifier succeeds deterministically enough to make
   a boolean decision; classifier failure must block auto-publish and fall back
   to normal admin review.

For this epic, "fully green" means:

- every judgement dimension is `low`
- this applies to proposal-level judgement and all judgable file-level
  judgements

### Auto-Publish Category Exclusions

Some coarse categories should never auto-publish, even if the safety and
quality judgements are fully green.

Configuration:

```env
AUTO_PUBLISH_EXCLUDED_CATEGORIES=security,automation,filesystem,network
```

Rules:

- Matching is coarse and approximate, not exact.
- The system should use an LLM-based boolean classification only when
  `AUTO_PUBLISH_ON_GREEN=true`.
- The classification input should consider both proposal metadata and judgable
  file content.
- Output needed in this epic:

```text
autopublishBlockedByCategory: boolean
```

- If the classifier blocks auto-publish, the proposal stays in the normal
  admin-review flow.
- If the classifier fails, times out, or is inconclusive, auto-publish must be
  skipped conservatively.

## State Model

Current model:

```text
draft -> in_review -> approved -> published -> deprecated
draft|in_review|approved -> rejected
```

Proposal-related extension in this epic:

```text
in_upload -> submitted -> judged -> converted/rejected
```

Suggested lifecycle interpretation:

1. `POST /proposals` creates proposal metadata in `in_upload`
2. `POST /proposals/{id}/files` attaches files while still `in_upload`
3. `POST /proposals/{id}/finalize-upload` transitions proposal to `submitted`
4. Proposal and file judgements run from finalized package contents
5. If auto-publish is disabled or blocked, the proposal continues through the
   existing admin review flow
6. If auto-publish is enabled and all rules pass, the proposal may be converted
   and published automatically

Exact downstream internal states may be refined during implementation, but the
public/admin distinction between `in_upload` and finalized proposal is required.

## Configuration Contract

Add to central API config in `apps/api/src/infrastructure/config.ts`:

```env
PROPOSAL_MAX_FILES=30
PROPOSAL_MAX_FILE_SIZE_BYTES=10485760
AUTO_PUBLISH_ON_GREEN=false
AUTO_PUBLISH_EXCLUDED_CATEGORIES=security,automation,filesystem,network
```

Rules:

- configuration is environment-backed through the existing central config
  object
- config parsing must validate numeric and boolean values
- `AUTO_PUBLISH_EXCLUDED_CATEGORIES` should parse into a normalized string list
- OpenAPI and agent-facing contract output must reflect the effective runtime
  values where relevant

## API Contract Changes

### 1. Proposal Creation

`POST /proposals`

- create proposal in `in_upload`
- response should make clear that the upload is incomplete until explicit
  finalization

### 2. File Upload

`POST /proposals/{id}/files`

- reject when `proposal.status !== in_upload`
- reject when `current_file_count >= PROPOSAL_MAX_FILES`
- reject when uploaded file size exceeds `PROPOSAL_MAX_FILE_SIZE_BYTES`
- reject when path belongs to disallowed dependency-tree family
- return structured error details with:
  - violated rule
  - file path if available
  - configured limit if applicable
  - concise recommendation for reducing the package

### 3. Finalize Upload

New endpoint:

```text
POST /proposals/{id}/finalize-upload
```

Responsibilities:

- only allowed while proposal is `in_upload`
- verify that the proposal contains at least the required finalized package
- transition proposal out of `in_upload`
- trigger proposal judgement + file judgements
- if configured and eligible, trigger auto-publish evaluation
- return a response that clearly distinguishes:
  - upload finalized
  - judgement pending/running
  - auto-publish pending/running
  - auto-publish skipped

### 4. Proposal Status

`GET /proposals/{id}/status`

Must reflect:

- `in_upload` as a public state
- whether the upload is finalized
- whether auto-publish is enabled for this environment
- whether the proposal is eligible for auto-publish
- if blocked, a coarse machine-readable reason

Suggested status fields:

- `uploadFinalized: boolean`
- `autoPublishEnabled: boolean`
- `autoPublishEligible: boolean | null`
- `autoPublishBlockedReason: string | null`

Suggested blocked reasons:

- `incomplete_upload`
- `duplicate_or_collision`
- `non_green_judgement`
- `category_blocked`
- `classifier_failed`
- `manual_review_required`

### 5. How To Propose

`GET /howToPropose`

Must add a structured upload-limits/finalization section, for example:

- `uploadLimits.maxFiles`
- `uploadLimits.maxFileSizeBytes`
- `uploadLimits.disallowedPaths`
- `uploadLimits.recommendations`
- `uploadFinalization.required`
- `uploadFinalization.finalizeEndpoint`
- `uploadFinalization.statusFollowUp`

## Admin UI Changes

### Proposal Lists

Add `in_upload` visibility and filtering:

- Open proposals list/filter must support `in_upload`
- Admins need a dedicated way to find incomplete uploads

### Proposal Detail

Expose upload-completion context:

- current upload state
- file count vs. limit
- path-blocking or limit violations when relevant
- whether auto-publish is enabled
- whether auto-publish is currently blocked and why

### Audit Visibility

If auto-publish happens automatically, admins must be able to see that clearly.

Required audit distinction:

- automatic publication by rule
- normal manual review/publication

## Application And Domain Changes

### Proposal Domain

Add/extend:

- `in_upload` lifecycle support
- explicit upload finalization transition
- validation that only `in_upload` proposals accept file attachments

### Submission Use Case

Split responsibilities more clearly:

- create proposal metadata in `in_upload`
- attach files with hard limit enforcement
- finalize upload explicitly

### Judgement Flow

Proposal judgement orchestration must run only after upload finalization.

This includes:

- proposal-level judgement
- all judgable file-level judgements
- result aggregation for auto-publish eligibility

### Auto-Publish Evaluator

Add a dedicated application-level evaluator instead of burying this logic in a
controller or review adapter.

Responsibilities:

- check config switch
- ensure duplicate/collision/manual blockers are absent
- confirm all required judgements are fully green
- run excluded-category boolean classifier when enabled
- produce a structured eligibility decision
- trigger automatic convert/publish flow only on positive eligibility

## LLM-Based Excluded Category Check

This classifier is not a replacement for the main judgement dimensions. It is a
separate policy gate used only for auto-publish.

Requirements:

- only run when `AUTO_PUBLISH_ON_GREEN=true`
- use proposal metadata plus judgable file text/content summaries
- return boolean only for the first implementation:

```text
blocked: boolean
```

- on failure, auto-publish must not proceed

This should be implemented as a separate contract/use case so it does not leak
provider-specific logic into proposal review orchestration.

## Error Handling

Hard upload-limit failures should use stable error codes.

Suggested codes:

- `PROPOSAL_FILE_LIMIT_EXCEEDED`
- `PROPOSAL_FILE_SIZE_LIMIT_EXCEEDED`
- `PROPOSAL_DISALLOWED_PATH`
- `PROPOSAL_UPLOAD_NOT_OPEN`
- `PROPOSAL_UPLOAD_NOT_FINALIZABLE`

Responses should include a concise recommendation, for example:

- remove dependency trees and upload only source files plus manifests
- split oversized assets out of the proposal
- keep the package under the configured file count

Recommendation text may adapt to the package type when the system can infer it
reliably, but this epic does not require complex language generation for those
messages.

## Implementation Plan

### 1. Extend Central Configuration

Files:

- `apps/api/src/infrastructure/config.ts`
- `apps/api/src/infrastructure/config.test.ts`
- `.env.example`
- `docs/setup/ENVIRONMENT.md`

Changes:

- add proposal upload limit config
- add auto-publish config
- add excluded categories config
- validate and normalize env values

### 2. Introduce `in_upload` Proposal Lifecycle

Files:

- proposal domain model/spec/tests
- proposal DTOs
- proposal mapper(s)
- proposal catalog projection
- proposal read model/tests

Changes:

- add `in_upload`
- expose it in admin/public status and list views
- enforce attach/finalize state transitions

### 3. Add Explicit Upload Finalization Endpoint

Files:

- proposal controller/spec/tests
- inbound port if needed
- proposal application use case(s)
- OpenAPI

Changes:

- add `POST /proposals/{id}/finalize-upload`
- make finalization resumable for interrupted agents
- ensure only finalized proposals continue to judgement/review

### 4. Enforce Hard Upload Limits And Disallowed Paths

Files:

- upload controller path
- proposal command use case(s)
- storage/repository integration tests
- error mapping

Changes:

- file-count limit
- per-file size limit
- disallowed dependency-tree path rejection
- structured error codes/messages

### 5. Extend `GET /howToPropose`

Files:

- `apps/api/src/adapters/inbound/http/skill-read.controller.ts`
- controller tests/spec
- `packages/openapi/skill-registry.openapi.yaml`
- `apps/web/src/api/proposals.ts`
- `apps/web/src/pages/HowToProposePage.tsx`
- `docs/product/AGENT_BOOTSTRAP.md`

Changes:

- expose runtime limits
- expose finalize-upload requirement
- expose poll-after-one-minute guidance only when auto-publish is enabled

### 6. Add Auto-Publish Eligibility Evaluator

Files:

- new proposal auto-publish use case/spec/tests
- proposal review/finalization orchestration
- audit integration

Changes:

- aggregate all required judgements
- verify duplicate/manual blockers
- return eligibility and blocked reason

### 7. Add Excluded-Category Boolean Classifier

Files:

- new outbound contract/spec/tests
- provider-neutral application contract
- selected judger/provider integration

Changes:

- classify coarse blocked-category match
- fail closed on classifier failure

### 8. Trigger Automatic Convert/Publish

Files:

- proposal review/finalization orchestration
- skill review/publish orchestration
- audit entries/tests

Changes:

- on positive eligibility, convert and publish automatically
- record clearly that publication was automatic

### 9. Extend Admin Proposal UX

Files:

- admin proposal lists/pages/tests
- admin dashboard links/filters if needed

Changes:

- filter/view `in_upload`
- surface auto-publish eligibility and blocked reason
- surface upload completion state

## Acceptance Criteria

- Proposal upload begins in `in_upload`.
- Agents must explicitly finalize proposal uploads.
- `GET /howToPropose` exposes runtime upload limits and finalization guidance.
- Uploads reject the first file beyond the configured maximum.
- Uploads reject files larger than the configured per-file size.
- Uploads reject disallowed dependency-tree paths.
- Interrupted submitter agents can resume and later finalize `in_upload`
  proposals.
- Admins can filter for `in_upload` proposals.
- Proposal judgement starts only after upload finalization.
- Auto-publish runs only when enabled and when all required checks pass.
- Fully green means every required proposal/file judgement dimension is `low`.
- Duplicate/collision/manual blockers prevent auto-publish.
- Excluded-category classifier can block auto-publish with boolean output only.
- Classifier failure blocks automation conservatively.
- Automatic publication is audited distinctly from manual publication.
- Public proposal status and admin UI expose enough state to understand why
  auto-publish did or did not happen.

## Non-Goals

- Do not add timeout-based implicit upload completion.
- Do not add multiple active judger providers in this epic.
- Do not auto-publish on later manual re-judgement runs.
- Do not implement a full policy engine for upload recommendations.
- Do not change existing published-skill read semantics outside what is needed
  for status/audit visibility.

## Risks

- Introducing `in_upload` touches domain state, persistence projection, public
  status, admin filters, and agent contract simultaneously.
- Auto-publish policy can become opaque without explicit blocked-reason
  visibility.
- If category blocking is too coarse, false positives may increase manual
  review load; if too weak, risky skills may publish automatically.

## Recommended Delivery Order

1. Hard upload lifecycle and limits
2. Agent-facing contract and UI exposure
3. Admin filters/status visibility
4. Auto-publish evaluator without category classifier
5. Category classifier and final auto-publish trigger
