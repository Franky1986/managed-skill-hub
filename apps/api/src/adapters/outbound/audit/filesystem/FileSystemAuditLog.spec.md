# Spec: FileSystemAuditLog (Outbound Adapter)

## Purpose

Writes audit entries as append-only JSONL files.

## Scope

- Append entry
- Read entries by skill
- Read entries by proposal
- Enumerate all entries for migration/export

## Non-Scope

- Tamper protection at operating-system level
- External audit systems

## Responsibilities

- Append every action as JSONL line to `data/audit/{skillId|proposalId|global}.jsonl`.
- Ensure timestamp, actor, action, before/after.
- Optionally mirror audit entries into SQLite read projection during writes.

## Inputs / Outputs

- Inputs: `AuditEntry`
- Outputs: `AuditEntry[]`

## Dependencies

- `DATA_DIR` from `.env`

## Failure Modes

- File not writable -> `AuditError`
- Rotating files -> add later

## Acceptance Criteria

- Entries are chronologically sorted when enumerated with `findAll()`.
- Log files are never overwritten.

## Tests / Checks

- Contract tests

## Agent Guardrails

- Always write append-only.
- Audit in the same work step as the action.
