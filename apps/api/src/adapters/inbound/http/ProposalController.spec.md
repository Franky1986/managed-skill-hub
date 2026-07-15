# Spec: ProposalController (HTTP Adapter)

## Purpose

HTTP adapter for proposal operations.

## Scope

- `POST /proposals/check-duplicate`
- `POST /proposals`
- `PATCH /proposals/:proposalId`
- `DELETE /proposals/:proposalId`
- `POST /proposals/:id/files`
- `POST /proposals/:proposalId/validate-upload`
- `POST /proposals/:proposalId/finalize-upload`
- `GET /proposals/notice`
- `GET /proposals/:proposalId/status`

## Non-Scope

- Admin approval
- Proposal detail or proposal list for non-admins
- Showing judger results; see `JudgementController`
- API localization; backend responses remain English
- Admin session authentication

## Responsibilities

- Guard all proposal routes with `PROPOSAL_AUTH_MODE`.
- Rate-limit all proposal routes in-memory by authenticated proposal bearer
  actor when bearer auth is enabled, otherwise by request IP.
- Treat forwarded client addresses as request IPs only when the connecting
  proxy is listed in `API_TRUSTED_PROXIES`.
- Remove expired rate-limit buckets lazily and bound identity cardinality with
  `PROPOSAL_RATE_LIMIT_MAX_BUCKETS`.
- Use the authenticated proposal bearer actor as authoritative actor when
  proposal bearer auth is enabled; do not trust `X-Actor` in that mode.
- Accept multipart uploads.
- Accept JSON metadata updates for proposals that are still `in_upload`.
- Accept an optional multipart `path` field for proposal file uploads and use it
  as the relative in-package path when present.
- Enforce proposal upload/file limits and upload-open state through the command
  use case and mapped error codes.
- Forward `POST /proposals/check-duplicate` to
  `ProposalDuplicateCheckUseCase`.
- Accept only allowlisted metadata and optional file fingerprints for duplicate
  preflight; reject unknown fields, including any proposal ID, with `422`.
- Call `ProposalCommandPort`.
- Expose only aggregated proposal notices publicly.
- Do not deliver proposal details on public path.
- Return proposal creation responses that clearly state the upload is still
  incomplete until finalization.
- Return validate-upload responses that expose structured package-reference
  findings without finalizing, extracting, judging, or changing proposal
  status. Findings include `kind`, `severity`, `blocksFinalize`, `file`,
  `line`, `candidate`, and `suggestedReplacement`, including portable command
  guidance findings for runtime-specific command references.
- Allow submitters to abort and delete proposals while they are still
  `in_upload`; public deletion after finalization is blocked.
- Forward explicit upload completion to the command use case through
  `POST /proposals/:proposalId/finalize-upload`.
- Finalize-upload responses must distinguish upload finalization from
  auto-publish outcome, including disabled/skipped/published and blocked
  reason when automation was skipped.
- Finalize-upload `judgementStatus` must reflect the actual aggregate result:
  `completed`, `partial`, `unavailable`, or `failed`. Upload completion must
  never imply that automated judgement succeeded.
- Return errors through normalized JSON contract with `error`, `code`,
  `requestId`.
- Keep public proposal status guidance English-only; frontend may localize its
  presentation.

## Inputs / Outputs

- Inputs: HTTP request with JSON/multipart
- Outputs: JSON response

## Dependencies

- `ProposalCommandPort`
- `ProposalReadUseCase`

## Failure Modes

- Invalid input -> 400/422
- File too large -> 413
- Proposal file count exceeded -> 422
- Proposal upload path blocked -> 422
- Upload finalized/not open -> 409
- Proposal API rate limit exceeded -> 429
- Not found -> 404
- Public error responses do not contain internal original error message

## Acceptance Criteria

- Proposal upload creates UUID.
- Proposal upload starts in `in_upload` and is not judged immediately.
- Proposal metadata can be corrected while the upload is still `in_upload`.
- Files are correctly assigned to proposal.
- Relative subfolder paths such as `scripts/build.py` are preserved when the
  upload client sends multipart `path`.
- While a proposal is still `in_upload`, re-uploading the same relative `path`
  replaces that file in the open upload instead of requiring a new proposal.
- File attachments stop at the configured hard file-count limit.
- Final upload completion requires explicit `POST /proposals/:proposalId/finalize-upload`.
- Validate-only completion checks use `POST /proposals/:proposalId/validate-upload`.
- Finalize-upload validation failures return the same structured findings
  without truncating the list.
- Open proposal upload abortion uses `DELETE /proposals/:proposalId` and is
  limited to `in_upload`.
- Endpoints match OpenAPI spec.
- `GET /proposals/notice` returns only aggregated notice data.
- Proposal status follows `PROPOSAL_AUTH_MODE`; there is no separate proposal
  status auth mode.
- `GET /proposals/:proposalId/status` returns public status snapshot: title,
  status, upload-finalized state, auto-publish state, latest risk, rejection
  reason, converted published skill ID, and contentDigest. It excludes email,
  principal/subject identifiers, audit entries, uploader fields, and linked
  private proposal UUIDs.
- Under OIDC, any principal accepted by the proposal policy may read a known
  proposal UUID. Only the stable owning principal may upload, validate,
  finalize, patch, or delete an open proposal; a new token for the same human
  preserves ownership.
- `POST /proposals/check-duplicate` returns metadata/fingerprint exact duplicates,
  heuristic similarity matches, and skill-ID collisions without stored file reads
  or semantic judger calls.
- Proposal route bursts beyond the configured rate-limit window return `429`
  and do not reach the command use case.
- In-memory proposal rate-limit state remains within the configured bucket cap.
- OIDC rate-limit identity uses the bounded stable principal/client pair, so a
  refreshed token does not reset the request budget.

## Tests / Checks

- HTTP integration tests
- Multipart upload tests

## Agent Guardrails

- No business logic in controller.
