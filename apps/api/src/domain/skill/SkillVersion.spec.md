# Spec: SkillVersion (Domain Entity)

## Purpose

A skill version is a concrete, immutable expression of a skill at one point in
time. Approvals and publications always refer to a version, never to the skill
itself.

## Scope

- Version number in SemVer form
- Manifest with metadata, capabilities, files, entrypoint
- SHA-256 checksum over content
- Creator, reviewer, approver, publisher with timestamps

## Non-Scope

- Later mutation of an already created version
- Delivery of file contents; that belongs to the storage port

## Responsibilities

- Immutable representation of a skill state
- Provide all information agents need for loading
- Integrity check through hash

## Inputs / Outputs

- Inputs: manifest, files, actor
- Outputs: `SkillVersion` entity with hash and timestamps

## Dependencies / Ports

- `SkillFileStoragePort` for file contents
- `SkillSearchPort` for indexing

## Failure Modes

- Invalid manifest -> `ValidationError`
- Hash collision/mismatch -> `IntegrityError`
- Missing entrypoint -> `ValidationError`

## Acceptance Criteria

- Every version has a version number unique per skill.
- The hash covers manifest and all referenced files.
- A version cannot be changed after creation.

## Tests / Checks

- Unit tests for hash calculation
- Unit tests for manifest validation

## Agent Guardrails

- Never mutate versions; create a new version instead.
- Do not open or write files directly in the domain layer.
