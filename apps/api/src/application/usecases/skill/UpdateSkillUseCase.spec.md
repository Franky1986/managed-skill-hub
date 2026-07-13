# Spec: UpdateSkillUseCase (Application)

## Purpose

Creates new draft patch versions for skill metadata and file mutations without
mutating existing versions in place.

## Scope

- `updateSkill(id, patch, actor)`
- `uploadFile(id, version, file, actor)`
- `moveFile(id, version, filePath, patch, actor)`
- `deleteFile(id, version, filePath, actor)`

## Non-Scope

- Initial skill creation
- Status transitions such as `approve` or `publish`
- UI/HTTP-specific error presentation

## Responsibilities

- Load skill aggregate for mutation path.
- When catalog projection exists, preferably hydrate skill directly from SQLite
  metadata plus projected file metadata.
- Always derive a new draft patch version from the target basis.
- Copy existing files from storage into the new version and apply optional
  overwrites.
- Enforce guardrails for file size, path conflicts, and entrypoint deletion
  protection.
- Persist updated skill aggregate through repository.
- Write audit entries for mutation.

## Inputs / Outputs

- Inputs: `skillId`, optional `version`, mutation data, `actor`
- Output: updated `Skill` aggregate with new draft version

## Dependencies

- `SkillRepositoryPort`
- optional `SkillCatalogPort`
- `SkillFileStoragePort`
- `AuditLogPort`

## Failure Modes

- Skill not found -> `NotFoundError`
- Missing version or file -> `NotFoundError`
- Invalid mutation such as empty target, path conflict, too-large file, or
  deleting entrypoint -> `ValidationError` or `ConflictError`

## Acceptance Criteria

- Every mutation creates a new draft patch version instead of mutating existing
  versions.
- With catalog projection available, the use case does not need repository
  rehydration for metadata basis.
- New version keeps unchanged files and relevant manifest metadata from basis
  version.
- Every successful mutation creates an audit entry.

## Tests / Checks

- Use-case tests for metadata update, upload, move, delete, and catalog-backed
  loading
- `./scripts/check.sh`
