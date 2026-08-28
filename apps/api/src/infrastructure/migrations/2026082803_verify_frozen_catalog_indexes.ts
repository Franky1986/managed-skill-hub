import { CatalogMigration } from './catalog-migration';

/** Replays every named frozen index so legacy lookalikes are repaired by definition. */
export const migration: CatalogMigration = {
  id: '2026082803_verify_frozen_catalog_indexes',
  description: 'Repair missing or incorrectly defined frozen catalog indexes.',
  async up(context) {
    for (const [table, index, columns, unique] of [
      ['skill_catalog_versions', 'idx_skill_catalog_versions_published', ['status', 'is_latest_published', 'category', 'skill_id'], false],
      ['skill_catalog_versions', 'idx_skill_catalog_versions_latest', ['is_latest_version', 'skill_id'], false],
      ...(context.provider === 'mysql' ? [['skill_catalog_version_tags', 'idx_skill_catalog_tags_tag', ['tag', 'skill_id', 'version'], false] as [string, string, string[], boolean]] : []),
      ['skill_catalog_files', 'idx_skill_catalog_files_version', ['skill_id', 'version'], false],
      ['skill_catalog_judgements', 'idx_skill_catalog_judgements_target', ['target_type', 'target_id', 'created_at'], false],
      ['skill_catalog_judgements', 'idx_skill_catalog_judgements_proposal', ['proposal_id'], false],
      ['skill_catalog_proposals', 'idx_skill_catalog_proposals_status', ['status', 'created_at'], false],
      ['skill_catalog_proposals', 'idx_skill_catalog_proposals_skill', ['skill_id', 'created_at'], false],
      ['skill_catalog_proposals', 'idx_skill_catalog_proposals_content_digest', ['content_digest'], false],
      ['skill_catalog_proposal_files', 'idx_skill_catalog_proposal_files_proposal', ['proposal_id', 'path'], false],
      ['skill_catalog_audit_entries', 'idx_skill_catalog_audit_skill', ['skill_id', 'created_at'], false],
      ['skill_catalog_audit_entries', 'idx_skill_catalog_audit_proposal', ['proposal_id', 'created_at'], false],
      ['identity_principals', 'idx_identity_principals_last_seen', ['last_seen_at', 'id'], false],
      ['identity_external_subjects', 'idx_identity_external_principal', ['principal_id'], false],
      ['admin_sessions', 'idx_admin_sessions_expiry', ['expires_at', 'session_id_hash'], false],
      ['agent_sessions', 'uq_agent_sessions_session_id', ['session_id'], true],
      ['agent_sessions', 'idx_agent_sessions_expiry', ['expires_at', 'code'], false],
      ['agent_sessions', 'idx_agent_sessions_revoked', ['revoked_at', 'code'], false],
      ['oidc_login_transactions', 'idx_oidc_login_transactions_expiry', ['expires_at', 'state_hash'], false],
    ] as Array<[string, string, string[], boolean]>) await context.addIndexIfMissing(table, index, columns, unique);
  },
};
