# Spec: ProposalCommandPort (Inbound Port)

## Purpose

Allows agents and humans to submit proposals and attach files. List, detail,
and notice reads remain outside this command path.

## Scope

- `submitProposal(dto)`
- `updateProposalMetadata(proposalId, update)`
- `attachFile(proposalId, file)`
- `validateUpload(proposalId)`
- `deleteProposal(proposalId)` only in status `in_upload`

## Non-Scope

- Approval decision; see `SkillCommandPort`
- Admin review UI logic
- API localization; backend proposal guidance remains English-only

## Response Contract

- The submit response contains `id`, `statusUrl`, `checkUrl`, and a `message`
  informing the submitter that automatic judgement and admin review follow and
  only admins can publish.
- `statusUrl` and `checkUrl` are prefix-aware: when called through an `/api/`
  proxy they contain `/api/...`; when called directly against the backend they
  do not.
- Agent-facing guidance remains English and instructs agents to communicate
  with users in the language the user is currently using unless asked
  otherwise.

## Responsibilities

- Enforce the centrally configured file-count, per-file-size, and disallowed-path
  limits.
- Validate and persist proposal.
- Require exactly one `category` per proposal.
- Allow submitters to correct proposal metadata while upload is still open.
- Attach files to the proposal.
- Validate an open upload without finalizing, extracting, judging, or changing
  proposal status.
- Delete only open `in_upload` proposals as an upload-abort operation.
- Require the authoritative actor to match `submittedBy` for metadata changes,
  file upserts, package validation, finalization, and deletion.
- After successful upload, automatically create judgements for proposal and
  every file.
- Call judger asynchronously or synchronously; MVP later uses custom-judger.

## Inputs / Outputs

- Inputs: proposal DTOs, files, submitter information
- Outputs: proposal DTOs

## Dependencies / Ports

- `ProposalRepositoryPort`
- `SkillJudgerPort`
- `FileScannerPort`
- `AuditLogPort`

## Failure Modes

- File larger than 5 MB -> `ValidationError`
- Invalid proposal -> `ValidationError`
- Judger error -> warning, proposal remains stored

## Acceptance Criteria

- Submission creates a UUID and stores the proposal physically.
- Multiple proposals under the same skill ID are possible.
- Files are assigned to the proposal.
- Metadata updates are accepted only while the proposal upload is still open.
- Validate-upload returns all package-reference findings, keeps the proposal in
  `in_upload`, and marks only `blocksFinalize=true` findings as finalization
  blockers.
- Delete removes only proposals that are still `in_upload`.
- Cross-actor access to an open proposal command returns `ForbiddenError`.
- On judger/scanner errors, the proposal or proposal file remains stored; the
  error is treated only as a warning.

## Tests / Checks

- Application tests with in-memory adapters
- File-upload tests

## Agent Guardrails

- Do not make auth decisions in the command port.
- Do not call storage directly outside ports.
