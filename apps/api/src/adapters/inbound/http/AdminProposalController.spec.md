# Spec: AdminProposalController (HTTP Adapter)

## Purpose

HTTP adapter for admin actions on proposals.

## Scope

- `GET /admin/proposals`
- `GET /admin/proposals/notice`
- `GET /admin/proposals/:proposalId`
- `GET /admin/proposals/:proposalId/files/:fileId`
- `GET /admin/proposals/:proposalId/files/:fileId/extracted-content`
- `POST /admin/proposals/:proposalId/files/:fileId/re-extract`
- `DELETE /admin/proposals/:proposalId`
- `POST /admin/proposals/:proposalId/reject`
- `POST /admin/proposals/:proposalId/convert`

## Non-Scope

- Public proposal submission
- Skill review/publish endpoints

## Responsibilities

- Enforce admin auth.
- Deliver proposal lists and details only on admin path.
- Deliver the reviewer navigation notice through the admin-session boundary;
  the web workbench must not call the independently protected agent proposal
  notice route.
- Deliver structured review metadata for proposal detail/list responses.
- Deliver guided conversion preview for target skill and next version.
- Deliver structured file and judgement metadata for proposal detail.
- Deliver proposal files for admin review as raw content/download.
- Deliver extracted proposal file content for admin review.
- Delegate `re-extract` for proposal files to matching use case.
- Delegate proposal `Extracted Content` preferably through catalog-backed
  proposal/file metadata to extractor.
- Pass request parameters, optional rejection reason, and optional review
  comment to use case.
- Return proposal responses or admin skill detail responses. Proposal conversion
  must include draft/in-review/rejected versions so the admin UI can continue
  review shortcuts against the version just created.

## Inputs / Outputs

- Inputs: proposal ID, file ID, session actor, optional `reason`, optional
  `comment`
- Outputs: `ProposalResponse`, admin `SkillResponse`, raw file content, or
  `ExtractedContentResponse`

## Dependencies

- `ProposalReadUseCase`
- `ProposalCommandPort`
- `ReviewProposalUseCase`
- `ReextractProposalFileUseCase`
- `SimpleAdminAuth`

## Failure Modes

- Not logged in -> `401`
- Proposal not found -> `404`
- Proposal file or extract not found -> `404`
- Forbidden status transition / validation error -> `409` or `422`

## Acceptance Criteria

- Reject updates status and reason.
- Convert creates a skill or new draft version and marks proposal as
  `converted`.
- Admin can read proposal files both raw and as `Extracted Content`.
- `re-extract` for proposal files does not change original file.
- Endpoints match OpenAPI spec.

## Tests / Checks

- Typecheck
- End-to-end checks through `./scripts/check.sh`

## Agent Guardrails

- No business logic in controller.
