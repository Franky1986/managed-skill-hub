# Spec: ReviewProposalUseCase (Application)

## Purpose

Runs privileged admin actions on proposals: reject, convert into a skill, edit
metadata, and clean up abandoned uploads.

## Scope

- `rejectProposal(proposalId, actor, reason?, comment?)`
- `convertProposal(proposalId, actor, comment?)`
- `updateProposalMetadata(proposalId, actor, update)`
- `deleteOpenProposal(proposalId, actor)`

## Non-Scope

- Skill review/publish workflow after conversion

## Conversion Rules

- When converting a proposal without explicit `skillId`, the skill ID is
  derived automatically from the title. On collision with an existing skill ID,
  numbered variants (`title`, `title-2`, ... up to `title-100`) are tried before
  an error is thrown.
- When the proposal contains a `skillId` and the skill exists, the proposal is
  attached as a new draft version to the existing skill. If the skill does not
  exist yet, a new skill is created with this ID.
- Multiple proposals with the same title, category, or target skill ID are
  allowed at the same time. Admins resolve collisions during conversion.

## Responsibilities

- Load proposal and execute status transitions through domain.
- Load the proposal aggregate from the repository first because review actions
  mutate proposal state. Catalog projection may only be used as a fallback when
  the repository has no aggregate.
- On conversion, read proposal files and pass them to skill creation.
- With existing `proposal.skillId`, preferably hydrate the target skill basis
  directly from SQLite metadata when catalog projection exists.
- With existing `proposal.skillId`, create a new draft version for the skill.
- Write audit entries for reject/convert including optional review comment.
- Allow an authenticated admin to delete an abandoned `in_upload` proposal
  regardless of its submitting actor, without weakening public submitter
  ownership checks.

## Inputs / Outputs

- Input: proposal ID, actor, optional rejection reason
- Output: updated proposal or created skill

## Dependencies

- `SkillRepositoryPort`
- optional `SkillCatalogPort`
- `SkillFileStoragePort`
- `AuditLogPort`
- `CreateSkillUseCase`

## Failure Modes

- Proposal not found -> `NotFoundError`
- Missing proposal file -> `NotFoundError`
- Administrative delete for a finalized proposal ->
  `ProposalUploadNotOpenError`
- Target skill ID cannot be derived from title -> `ValidationError`

## Acceptance Criteria

- Reject sets proposal to `rejected` and stores reason.
- Convert creates draft version `1.0.0` for new skills.
- Convert into existing skill creates a new draft version with incremented patch
  version.
- With catalog projection available, the proposal review path still prefers
  repository rehydration and only falls back to catalog projection when the
  repository has no proposal aggregate.
- With catalog projection available, the existing-skill convert path does not
  need repository rehydration for skill basis.
- Proposal is stored as `converted` after successful conversion.
- Administrative cleanup deletes open uploads and refuses submitted, judged,
  rejected, converted, or otherwise finalized proposals.

## Tests / Checks

- Use-case tests for reject and convert flow

## Agent Guardrails

- No skill-creation logic in controller.
- No filesystem access outside ports.
