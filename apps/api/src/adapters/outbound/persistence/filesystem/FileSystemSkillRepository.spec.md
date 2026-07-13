# Spec: FileSystemSkillRepository (Outbound Adapter)

## Purpose

Persists skills and skill versions as files on the filesystem.

## Scope

- Read/write skill metadata
- Read/write versions
- Atomic writes through temp file plus rename

## Non-Scope

- File contents; see file storage
- Search index

## Responsibilities

- Maintain skill folder structure in `data/skills/{namespace}/{skill}/`.
- Store manifest as YAML.
- Represent version history as subfolders or files.

## Inputs / Outputs

- Inputs: skill/version entities
- Outputs: skill/version entities

## Dependencies

- `DATA_DIR` from `.env`

## Failure Modes

- Filesystem full -> `StorageError`
- Concurrent write -> atomic rename prevents corruption
- Missing permissions -> `PermissionError`

## Acceptance Criteria

- A stored skill can be fully loaded again.
- Partial writes do not leave corrupted data.

## Tests / Checks

- Contract tests against temporary directory

## Agent Guardrails

- Never call `fs.writeFile` directly from domain/use cases.
- Always write atomically.
