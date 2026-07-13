# Spec: SkillRepositoryPort (Outbound Port)

## Purpose

Persists and loads skills and skill versions independently of concrete storage
technology.

## Scope

- `save(skill: Skill)`
- `findById(id)`
- `findByNamespace(namespace?)`
- `findPublishedVersions(skillId)`
- `findVersion(skillId, version)`

## Non-Scope

- File contents; see `SkillFileStoragePort`
- Search queries; see `SkillSearchPort`

## Responsibilities

- Read and write skill metadata and versions.
- Ensure consistent version history.

## Inputs / Outputs

- Inputs: skill entities
- Outputs: skill entities or null

## Dependencies

- Domain entities

## Failure Modes

- Duplicate ID -> `ConflictError`
- Storage medium unavailable -> `StorageError`

## Acceptance Criteria

- A stored skill can be fully loaded again.
- Concurrent writes do not produce corrupted data.

## Tests / Checks

- Contract tests for all repository implementations

## Agent Guardrails

- No infrastructure details in port interfaces.
- Never call filesystem APIs directly from domain or application layer.
