# Spec: DatabaseAuditLog (Outbound Adapter)

## Purpose

Persists audit entries in database-backed content storage for `CONTENT_STORAGE_PROVIDER=database`.

## Scope

- Append skill-scoped, proposal-scoped, and global audit entries.
- Read entries by skill id.
- Read entries by proposal id.
- Enumerate all entries for migration, export, and operational proof scripts.
- Mirror audit entries into the catalog projection when a catalog adapter is supplied.

## Responsibilities

- Keep audit entries durable in `content_audit_entries`.
- Preserve idempotency by ignoring duplicate audit ids.
- Preserve chronological ordering by `created_at` and `id`.
- Keep database-specific SQL inside the adapter layer.

## Acceptance Criteria

- Database content mode does not write managed audit content to `DATA_DIR/audit`.
- `findAll()` includes global audit entries where `skillId` and `proposalId` are null.
- Filesystem-to-database migration and database-to-filesystem export can copy all audit entries without scope loss.
