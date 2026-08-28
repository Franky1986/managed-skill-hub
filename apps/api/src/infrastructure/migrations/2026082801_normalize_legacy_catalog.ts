import { CatalogMigration } from './catalog-migration';

/** Completes compatibility work for catalogs created before migration history. */
export const migration: CatalogMigration = {
  id: '2026082801_normalize_legacy_catalog',
  description: 'Normalize partial legacy catalog schemas to the frozen baseline.',
  async up(context) {
    const mysql = context.provider === 'mysql';
    const columns: Array<[string, string, string]> = [
      ['skill_catalog_versions', 'approved_by', mysql ? 'VARCHAR(255) NULL' : 'TEXT'], ['skill_catalog_versions', 'approved_at', mysql ? 'DATETIME NULL' : 'TEXT'],
      ['skill_catalog_versions', 'published_by', mysql ? 'VARCHAR(255) NULL' : 'TEXT'], ['skill_catalog_versions', 'rejected_by', mysql ? 'VARCHAR(255) NULL' : 'TEXT'],
      ['skill_catalog_versions', 'rejected_at', mysql ? 'DATETIME NULL' : 'TEXT'], ['skill_catalog_versions', 'rejection_reason', mysql ? 'TEXT NULL' : 'TEXT'],
      ['skill_catalog_versions', 'deprecated_by', mysql ? 'VARCHAR(255) NULL' : 'TEXT'], ['skill_catalog_versions', 'deprecated_at', mysql ? 'DATETIME NULL' : 'TEXT'],
      ['skill_catalog_versions', 'deprecation_reason', mysql ? 'TEXT NULL' : 'TEXT'], ['skill_catalog_versions', 'is_latest_version', mysql ? 'TINYINT(1) NOT NULL DEFAULT 0' : 'INTEGER NOT NULL DEFAULT 0'],
      ['skill_catalog_versions', 'use_when', mysql ? 'JSON NOT NULL DEFAULT (JSON_ARRAY())' : "TEXT NOT NULL DEFAULT '[]'"], ['skill_catalog_versions', 'do_not_use_when', mysql ? 'JSON NOT NULL DEFAULT (JSON_ARRAY())' : "TEXT NOT NULL DEFAULT '[]'"],
      ['skill_catalog_versions', 'entrypoint', mysql ? "VARCHAR(1024) NOT NULL DEFAULT ''" : "TEXT NOT NULL DEFAULT ''"], ['skill_catalog_judgements', 'skill_purpose_summary', mysql ? 'TEXT NULL' : 'TEXT'],
      ['skill_catalog_audit_entries', 'actor_principal_id', mysql ? 'CHAR(36) NULL' : 'TEXT'], ['skill_catalog_audit_entries', 'actor_display_name', mysql ? 'VARCHAR(512) NULL' : 'TEXT'], ['skill_catalog_audit_entries', 'actor_client_id', mysql ? 'VARCHAR(512) NULL' : 'TEXT'],
      ['skill_catalog_proposals', 'submitted_by_principal_id', mysql ? 'CHAR(36) NULL' : 'TEXT'], ['skill_catalog_proposals', 'submitted_via_client_id', mysql ? 'VARCHAR(512) NULL' : 'TEXT'],
      ['skill_catalog_proposals', 'review_labels', mysql ? 'JSON NOT NULL DEFAULT (JSON_ARRAY())' : "TEXT NOT NULL DEFAULT '[]'"], ['skill_catalog_proposals', 'latest_judgement_id', mysql ? 'CHAR(36) NULL' : 'TEXT'], ['skill_catalog_proposals', 'latest_judged_at', mysql ? 'DATETIME NULL' : 'TEXT'], ['skill_catalog_proposals', 'content_digest', mysql ? 'CHAR(64) NULL' : 'TEXT'],
      ['agent_sessions', 'session_id', mysql ? 'CHAR(36) NULL' : 'TEXT'], ['agent_sessions', 'revoked_at', mysql ? 'DATETIME(3) NULL' : 'TEXT'], ['agent_sessions', 'last_used_at', mysql ? 'DATETIME(3) NULL' : 'TEXT'], ['agent_sessions', 'created_by_ip', mysql ? 'VARCHAR(64) NULL' : 'TEXT'], ['agent_sessions', 'last_used_ip', mysql ? 'VARCHAR(64) NULL' : 'TEXT'], ['agent_sessions', 'user_agent', mysql ? 'TEXT NULL' : 'TEXT'],
    ];
    for (const [table, column, definition] of columns) await context.addColumnIfMissing(table, column, definition);
    await context.executeSchema(mysql ? `UPDATE agent_sessions SET session_id = UUID() WHERE session_id IS NULL OR session_id = ''; ALTER TABLE agent_sessions MODIFY COLUMN session_id CHAR(36) NOT NULL; ALTER TABLE agent_sessions MODIFY COLUMN code VARCHAR(32) NOT NULL;` : `UPDATE agent_sessions SET session_id = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))) WHERE session_id IS NULL OR trim(session_id) = '';`);
    for (const [table, index, columns, unique] of [
      ['skill_catalog_versions', 'idx_skill_catalog_versions_published', ['status', 'is_latest_published', 'category', 'skill_id'], false], ['skill_catalog_versions', 'idx_skill_catalog_versions_latest', ['is_latest_version', 'skill_id'], false],
      ['skill_catalog_files', 'idx_skill_catalog_files_version', ['skill_id', 'version'], false], ['skill_catalog_judgements', 'idx_skill_catalog_judgements_target', ['target_type', 'target_id', 'created_at'], false], ['skill_catalog_judgements', 'idx_skill_catalog_judgements_proposal', ['proposal_id'], false],
      ['skill_catalog_proposals', 'idx_skill_catalog_proposals_status', ['status', 'created_at'], false], ['skill_catalog_proposals', 'idx_skill_catalog_proposals_skill', ['skill_id', 'created_at'], false], ['skill_catalog_proposals', 'idx_skill_catalog_proposals_content_digest', ['content_digest'], false],
      ['skill_catalog_proposal_files', 'idx_skill_catalog_proposal_files_proposal', ['proposal_id', 'path'], false], ['skill_catalog_audit_entries', 'idx_skill_catalog_audit_entries_skill', ['skill_id', 'created_at'], false],
      ['identity_principals', 'idx_identity_principals_last_seen', ['last_seen_at', 'id'], false], ['identity_external_subjects', 'idx_identity_external_principal', ['principal_id'], false], ['admin_sessions', 'idx_admin_sessions_expiry', ['expires_at', 'session_id_hash'], false],
      ['agent_sessions', 'uq_agent_sessions_session_id', ['session_id'], true], ['agent_sessions', 'idx_agent_sessions_expiry', ['expires_at', 'code'], false], ['agent_sessions', 'idx_agent_sessions_revoked', ['revoked_at', 'code'], false], ['oidc_login_transactions', 'idx_oidc_login_transactions_expiry', ['expires_at', 'state_hash'], false],
    ] as Array<[string, string, string[], boolean]>) await context.addIndexIfMissing(table, index, columns, unique);
  },
};
