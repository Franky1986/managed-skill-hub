# Spec: SkillCommandPort (Inbound Port)

## Purpose

Defines all admin write operations for skills and their versions.

## Scope

- `createSkill(draft)`
- `updateSkill(id, draft)`
- `uploadFile(skillId, version, file)`
- `moveFile(skillId, version, fileId, patch)`
- `deleteFile(skillId, version, fileId)`
- `submitForReview(skillId, version)`
- `approve(skillId, version, actor)`
- `publish(skillId, version, actor)`
- `reject(skillId, version, actor, reason)`
- `deprecate(skillId, version, actor)`

## Non-Scope

- Read operations; see `SkillQueryPort`
- Authentication; checked in the HTTP adapter

## Responsibilities

- Apply domain rules.
- Create audit entries.
- Keep storage and search synchronized.
- When publishing, record the previous and new published versions and create a
  publish change-note audit entry. If a judger is configured, the change note is
  LLM-generated from the previous and new published contents.
- For `updateSkill`, create a new draft version instead of in-place mutation.
- For `uploadFile`, also create a new draft version instead of in-place
  mutation.
- For `moveFile`/`deleteFile`, also create a new draft version instead of
  in-place mutation.
- Entrypoint files must not be silently removed.

## Inputs / Outputs

- Inputs: command DTOs, actor
- Outputs: updated skill/version DTOs

## Dependencies / Ports

- `SkillRepositoryPort`
- `SkillFileStoragePort`
- `SkillSearchPort`
- `AuditLogPort`

## Failure Modes

- Invalid status transition -> `DomainError`
- Unauthorized actor -> `AuthorizationError`
- File too large -> `ValidationError`
- Target path collides with existing file -> `ConflictError`
- Deleting entrypoint file -> `ValidationError`

## Acceptance Criteria

- Every write operation creates an audit entry.
- Search index is consistent after successful write.
- Publish records `previousPublishedVersion`, `newPublishedVersion`, and a
  human-readable change summary for the published version.

## Tests / Checks

- Application tests with in-memory adapters

## Agent Guardrails

- Never set status directly; always use domain methods.
- Do not make auth decisions in the command port.
