# Spec: SkillFileStoragePort (Outbound Port)

## Purpose

Stores and loads files that belong to a `SkillVersion`.

## Scope

- `storeFile(skillId, version, path, content, mimeType)`
- `readFile(skillId, version, path)`
- `deleteFile(skillId, version, path)`
- `listFiles(skillId, version)`
- `storeSkillFileExtract(skillId, version, path, extractedContent)`
- `readSkillFileExtract(skillId, version, path)`

## Non-Scope

- Search index
- Skill metadata
- Published manifest/version metadata for list and detail reads when already
  delivered from the SQLite catalog projection

## Responsibilities

- Atomic writes through temp file plus rename.
- Streaming for large files.
- Checksum calculation when needed.
- Keep persisted derived artifacts such as `Extracted Content` versioned next
  to original files.

## Inputs / Outputs

- Inputs: file path, content as buffer/stream, MIME type
- Outputs: file metadata such as size and SHA-256
- Inputs for extracts: text, extractor name, extract metadata
- Outputs for extracts: persisted text plus `extractedAt`

## Dependencies

- No domain dependencies

## Failure Modes

- Storage exhausted -> `StorageError`
- File not found -> `NotFoundError`
- Partial write -> recovery through temp mechanism

## Acceptance Criteria

- A file is visible only after the write completed successfully.
- Redeploys do not delete persisted files.

## Tests / Checks

- Contract tests for local file storage
- Later for S3/MinIO

## Agent Guardrails

- Do not open files directly from domain/use-case code.
- Always use this port.
