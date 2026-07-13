# Spec: SubmitProposalUseCase (Application)

## Purpose

Allows submission of new proposals, attaching proposal files, and deleting
unprocessed proposals, including explicit upload finalization.

## Scope

- `submitProposal(draft, actor)`
- `updateProposalMetadata(proposalId, update, actor)`
- `attachFile(proposalId, file, actor)`
- `validateUpload(proposalId, actor)`
- `finalizeUpload(proposalId, actor)`
- `deleteProposal(proposalId, actor)`

## Non-Scope

- Admin review/approval of proposals
- Skill conversion
- UI/HTTP-specific error presentation

## Submission Rules

- Optional `skillId` in submit request is normalized (trim, lowercase) and
  validated against skill ID rules. Invalid IDs produce `VALIDATION_ERROR`.
- Proposals with same or similar `skillId`, same title, or same category are
  not blocked. Multiple submissions are explicitly allowed; admins decide
  during conversion.
- On every attached file, proposal `contentDigest` is recalculated from
  proposal metadata and SHA-256 checksums of files. This enables later duplicate
  detection.

## Responsibilities

- Create and persist new proposal in domain terms.
- Attempt initial proposal judgement without losing the proposal on judger
  errors.
- Store proposal files, extend proposal aggregate, and optionally attach file
  judgements.
- Update proposal metadata while the upload is still `in_upload` so submitters
  can correct title, description, category, tags, capabilities, or entrypoint
  before finalization.
- Validate proposal package references while the upload is still `in_upload`
  without finalizing, extracting, judging, or mutating the proposal.
- While a proposal is still `in_upload`, attaching a file with an already used
  relative path replaces that proposal file so submitter-side post-check fixes
  can be uploaded without creating another proposal.
- Recalculate proposal `contentDigest` after every file attachment so duplicates
  are detectable.
- Before `finalizeUpload`, deterministically validate that text-file artifact
  references match the uploaded package structure and do not still point to
  outside-root workspace, IDE, agent, command, or generated-output paths.
- During `finalizeUpload`, persist extracted content for every extractable
  proposal artifact before running file judgements so extracted binary content
  such as `.pptx` is immediately available to the UI and the file judge.
- For mutating proposal operations, load the repository aggregate first because
  it is the source of truth. Catalog projection may only be used as a fallback
  when the repository has no aggregate.
- Delete only proposals in status `in_upload`; after finalization public
  deletion is blocked.
- Write audit entries for submit, file attachment, delete, and judger errors.

## Inputs / Outputs

- Inputs: proposal draft, `proposalId`, file content, `actor`
- Outputs: updated `Proposal` or no return value for delete

## Dependencies

- `SkillRepositoryPort`
- optional `SkillCatalogPort`
- `SkillFileStoragePort`
- `AuditLogPort`
- `SkillJudgerPort`
- `FileScannerPort`

## Failure Modes

- Proposal not found -> `ValidationError`
- File larger than 5 MB -> `ValidationError`
- Finalize-upload with inconsistent package references -> `ValidationError`
- Delete on non-deletable status -> `ValidationError`
- Judger/scanner error during automatic proposal or file judgement -> proposal
  remains stored and error is audited

## Acceptance Criteria

- Submit persists proposal even when automatic proposal judgement fails; response
  contains UUID, `statusUrl`, and `checkUrl`.
- File attachment remains stored even when automatic file judgement fails.
- Metadata updates are rejected after upload finalization.
- File attachment in `in_upload` is an upsert by relative path: same path
  replaces the previous file metadata/content, new paths still count toward the
  configured file-count limit.
- Validate-upload returns all package-reference findings so agents can fix a
  temporary upload package before calling finalize-upload. Documentation-only
  external references and portable command guidance are warnings; outside-root
  package references and missing package references are blocking errors.
- Runtime-specific command references such as `.cursor/commands/foo.md`,
  `.codex/commands/foo.md`, and `.claude/commands/foo.md` are reported as
  portable command findings with `commands/foo.md` as suggested replacement.
- Packages that already contain command files under `commands/` should preserve
  those files. Missing `commands/manifest.json` is reported as a non-blocking
  warning so agents can add portable runtime mapping metadata.
- Finalize-upload rejects proposals whose text artifacts still reference
  outside-root workspace, IDE, agent, command, or generated-output paths instead
  of the uploaded package layout.
- Finalize-upload stores extracted content for extractable proposal artifacts
  before file judgements run.
- With catalog projection available, `attachFile`, `finalizeUpload`, and
  `deleteProposal` still prefer repository rehydration and only use catalog
  fallback when the repository has no proposal aggregate.
- Delete removes only proposals in status `in_upload`.
- `contentDigest` is updated after every file attachment and mirrored into the
  SQLite catalog projection.

## Tests / Checks

- Use-case tests for judger fallbacks, finalize-upload integrity checks,
  repository-first proposal loading, and catalog fallback loading
- `./scripts/check.sh`
