import { CatalogMigration } from './catalog-migration';

/** Final append-only repair for partially upgraded legacy catalogs. */
export const migration: CatalogMigration = {
  id: '2026082802_finalize_legacy_catalog_parity',
  description: 'Enforce frozen legacy catalog nullability and MySQL foreign-key parity.',
  async up(context) {
    if (context.provider === 'sqlite') {
      await context.executeSchema(`
        CREATE TABLE agent_sessions__msh_parity (session_id TEXT NOT NULL,code TEXT PRIMARY KEY,areas TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,last_used_at TEXT,created_by_ip TEXT,last_used_ip TEXT,user_agent TEXT);
        INSERT INTO agent_sessions__msh_parity (session_id,code,areas,created_at,expires_at,revoked_at,last_used_at,created_by_ip,last_used_ip,user_agent) SELECT session_id,code,areas,created_at,expires_at,revoked_at,last_used_at,created_by_ip,last_used_ip,user_agent FROM agent_sessions;
        DROP TABLE agent_sessions;
        ALTER TABLE agent_sessions__msh_parity RENAME TO agent_sessions;
      `);
      await context.addIndexIfMissing('agent_sessions', 'uq_agent_sessions_session_id', ['session_id'], true);
      await context.addIndexIfMissing('agent_sessions', 'idx_agent_sessions_expiry', ['expires_at', 'code'], false);
      await context.addIndexIfMissing('agent_sessions', 'idx_agent_sessions_revoked', ['revoked_at', 'code'], false);
      return;
    }
    for (const [table, constraint, columns, parent, parentColumns, onDelete] of [
      ['skill_catalog_version_tags', 'fk_version_tags', ['skill_id', 'version'], 'skill_catalog_versions', ['skill_id', 'version'], 'CASCADE'],
      ['skill_catalog_files', 'fk_skill_files', ['skill_id', 'version'], 'skill_catalog_versions', ['skill_id', 'version'], 'CASCADE'],
      ['skill_catalog_proposal_files', 'fk_proposal_files', ['proposal_id'], 'skill_catalog_proposals', ['id'], 'CASCADE'],
      ['identity_external_subjects', 'fk_identity_external_principal', ['principal_id'], 'identity_principals', ['id'], 'RESTRICT'],
      ['admin_sessions', 'fk_admin_session_principal', ['principal_id'], 'identity_principals', ['id'], 'RESTRICT'],
    ] as Array<[string, string, string[], string, string[], 'CASCADE' | 'RESTRICT']>) await context.addForeignKeyIfMissing(table, constraint, columns, parent, parentColumns, onDelete);
  },
};
