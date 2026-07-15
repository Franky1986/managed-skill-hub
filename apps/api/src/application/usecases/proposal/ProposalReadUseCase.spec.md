# Spec: ProposalReadUseCase

## Purpose

Reads proposal-related data for public notice reads and admin lists without
burdening command use cases or HTTP controllers with repository/SQLite fallback
logic.

## Scope

- aggregated proposal notice for `GET /proposals/notice`
- proposal summary list for `GET /admin/proposals`
- proposal detail read for `GET /admin/proposals/:proposalId`
- proposal summary list optionally includes `conversion` preview for admin
  lists: new skill vs. new version
- proposal file read for `GET /admin/proposals/:proposalId/files/:fileId`
- proposal file extract for
  `GET /admin/proposals/:proposalId/files/:fileId/extracted-content`
- public status read for `GET /proposals/:proposalId/status`

## Non-Scope

- Proposal submit
- File upload to proposals
- Reject / convert / delete
- Skill or file judgement logic

## Public Status Contract

- Public proposal status contains clear hints for submitters: `reviewNote`,
  `nextStepForSubmitter`, and `adminOnlyNextSteps`. This makes clear that
  agents can only poll status, while approval/publication are admin-only.
- `adminOnlyNextSteps` is status-dependent and lists only currently valid
  actions. Open uploads expose administrative inspection/cleanup, reviewable
  proposals expose convert/reject actions, and terminal states expose no stale
  lifecycle mutations.
- Public proposal status also exposes whether the upload has already been
  finalized or is still incomplete in `in_upload`.
- Public proposal status also exposes whether auto-publish is enabled,
  currently eligible, or blocked with a coarse reason.
- Status also contains `contentDigest`, `duplicateOfProposalId`, and
  `duplicateOfSkillId`. Duplicate content does not block submit; it only
  provides transparency for submitters and admins.

## Responsibilities

- Read proposal notice preferably from SQLite projection.
- Read proposal summaries preferably from SQLite projection.
- Include `submittedAt`, `rejectedAt`, and `rejectedBy` in proposal summaries
  so admin lists can show when proposals entered and left review.
- Include the latest proposal-level judgement in proposal summaries so admin
  lists can render overview risk and dimension badges without loading every
  proposal detail.
- Read proposal review metadata such as risk, labels, and latest judgement time
  preferably from SQLite projection. Risk summary reflects the highest observed
  proposal/file judgement risk, not merely the last judgement written.
- Read proposal file metadata and proposal/file judgements for detail reads
  preferably from SQLite projection.
- Include proposal lifecycle events in admin detail reads by combining the
  immutable submit timestamp with proposal audit entries such as metadata
  updates, judgement runs, file attachments, rejection, conversion, and draft
  version creation.
- Include proposal upload state and auto-publish evaluation state in admin
  detail reads so incomplete uploads and automation blockers are visible.
- Include an explicit judgement execution state for the proposal and each file,
  derived from persisted judgements and failure audit events. Absence of a
  result must not be presented as successful judgement.
- Derive conversion preview with target skill, mode, and next version for admin
  review flow.
- Treat empty proposal notice/summary results from SQLite as valid truth.
- Fall back to repository rehydration only where a concrete detail read has no
  usable SQLite projection.
- Read proposal details from repository only when no usable SQLite projection
  exists.
- Read proposal file extracts through dedicated extraction use case and resolve
  proposal/file existence preferably from SQLite projection.
- For the public status endpoint, check by `contentDigest` whether another
  proposal or published skill has identical content and return IDs.
- For incomplete uploads, expose that the submitter still needs to finalize the
  proposal upload before review continues.
- Treat `in_upload` as an incomplete submitter workflow state, not as an admin
  review-pending proposal. It must be visible only when explicitly filtering for
  upload drafts or all proposals.
- Encapsulate DTO mapping for summary/detail/status responses.

## Inputs / Outputs

- Inputs: optional filters `skillId`, `status`, proposal ID
- Outputs: `ProposalNoticeResponse`, `ProposalListResponse`,
  `ProposalResponse`, `ProposalPublicStatusResponse`, proposal file content,
  `ExtractedContentResponse`

## Dependencies

- `SkillRepositoryPort`
- `SkillFileStoragePort`
- `ExtractProposalFileContentUseCase`
- optional `SkillCatalogPort`

## Failure Modes

- Proposal not found -> `null` to controller
- Proposal file or proposal file extract not found -> `NotFoundError`
- Empty or stale SQLite projection -> fallback to repository

## Acceptance Criteria

- `GET /proposals/notice` can read aggregated pending counts from SQLite and
  excludes `in_upload` proposals.
- Notice output includes per-status counts for `in_upload`, `submitted`, `judged`,
  and `converted`; `totalPending` and `hasNewProposals` cover only submitted/judged.
- `GET /admin/proposals` can read proposal summaries from SQLite.
- `GET /admin/proposals` summaries expose submission time and rejection
  metadata where available.
- `GET /admin/proposals` summaries expose the latest proposal-level judgement
  with dimensions, model, summary, risk, and timestamp when one exists.
- Proposal detail can include persisted review metadata such as labels and
  latest judgement.
- Proposal detail can include file metadata and proposal/file judgements from
  SQLite.
- Proposal detail includes a chronological lifecycle list with actor, timestamp,
  action, status transition, and target skill/version where known.
- Proposal and file execution states distinguish `not_started`, `completed`,
  `unavailable`, and `failed`, include the configured provider and last attempt,
  and expose only safe error guidance.
- Proposal detail can provide admins with conversion preview for new skill vs.
  new draft version.
- Proposal file content remains readable for admin review directly from the
  blob/storage path.
- Proposal file extracts remain reachable through the same read use case for
  admin review.
- Proposal detail remains correctly readable even when only repository data is
  complete.
- `GET /proposals/:proposalId/status` returns `status = in_upload` and
  `uploadFinalized = false` for incomplete proposal uploads.
- `GET /proposals/:proposalId/status` returns proposal `contentDigest` and
  shows duplicates as `duplicateOfProposalId` or `duplicateOfSkillId` without
  blocking status.
- `GET /proposals/:proposalId/status` returns auto-publish enablement,
  eligibility, and blocked reason derived from the last automation evaluation
  or failure audit entry.
- `GET /proposals/:proposalId/status` does not advertise conversion or rejection
  after the proposal has reached `approved`, `rejected`, or `converted`.

## Tests / Checks

- Use-case tests for SQLite preference and repository fallback
- `./scripts/check.sh`
