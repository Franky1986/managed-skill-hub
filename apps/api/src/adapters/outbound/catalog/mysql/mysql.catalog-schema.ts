import { MysqlClient } from '../../mysql/mysql.connection';

export async function ensureMysqlCatalogSchema(client: MysqlClient): Promise<void> {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS skill_catalog_versions (
      skill_id VARCHAR(255) NOT NULL,
      version VARCHAR(64) NOT NULL,
      title VARCHAR(1024) NOT NULL,
      description TEXT NOT NULL,
      category VARCHAR(255) NOT NULL,
      capabilities JSON NOT NULL,
      use_when JSON NOT NULL,
      do_not_use_when JSON NOT NULL,
      entrypoint VARCHAR(1024) NOT NULL,
      status VARCHAR(32) NOT NULL,
      skill_uuid CHAR(36) NOT NULL,
      version_uuid CHAR(36) NOT NULL,
      content_digest CHAR(64) NOT NULL,
      created_at DATETIME NOT NULL,
      approved_by VARCHAR(255) NULL,
      approved_at DATETIME NULL,
      published_by VARCHAR(255) NULL,
      published_at DATETIME NULL,
      rejected_by VARCHAR(255) NULL,
      rejected_at DATETIME NULL,
      rejection_reason TEXT NULL,
      deprecated_by VARCHAR(255) NULL,
      deprecated_at DATETIME NULL,
      deprecation_reason TEXT NULL,
      updated_at DATETIME NULL,
      is_latest_published TINYINT(1) NOT NULL DEFAULT 0,
      is_latest_version TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (skill_id, version),
      KEY idx_skill_catalog_versions_published (status, is_latest_published, category, skill_id),
      KEY idx_skill_catalog_versions_latest (is_latest_version, skill_id)
    ) ENGINE = InnoDB;
    CREATE TABLE IF NOT EXISTS skill_catalog_version_tags (
      skill_id VARCHAR(255) NOT NULL,
      version VARCHAR(64) NOT NULL,
      tag VARCHAR(255) NOT NULL,
      PRIMARY KEY (skill_id, version, tag),
      CONSTRAINT fk_version_tags
        FOREIGN KEY (skill_id, version)
        REFERENCES skill_catalog_versions (skill_id, version)
        ON DELETE CASCADE,
      KEY idx_skill_catalog_tags_tag (tag, skill_id, version)
    ) ENGINE = InnoDB;
    CREATE TABLE IF NOT EXISTS skill_catalog_files (
      skill_id VARCHAR(255) NOT NULL,
      version VARCHAR(64) NOT NULL,
      path VARCHAR(255) NOT NULL,
      artifact_id CHAR(36) NOT NULL,
      role VARCHAR(64) NOT NULL,
      mime_type VARCHAR(255) NOT NULL,
      size_bytes BIGINT NOT NULL,
      sha256 CHAR(64) NULL,
      updated_at DATETIME NULL,
      extractable TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (skill_id, version, path),
      KEY idx_skill_catalog_files_version (skill_id, version),
      CONSTRAINT fk_skill_files
        FOREIGN KEY (skill_id, version)
        REFERENCES skill_catalog_versions (skill_id, version)
        ON DELETE CASCADE
    ) ENGINE = InnoDB;
    CREATE TABLE IF NOT EXISTS skill_catalog_judgements (
      id CHAR(36) PRIMARY KEY,
      target_type VARCHAR(32) NOT NULL,
      target_id VARCHAR(255) NOT NULL,
      proposal_id VARCHAR(64) NULL,
      skill_id VARCHAR(255) NULL,
      skill_version VARCHAR(64) NULL,
      dimensions JSON NOT NULL,
      overall_risk VARCHAR(32) NOT NULL,
      summary TEXT NOT NULL,
      skill_purpose_summary TEXT NULL,
      model VARCHAR(255) NULL,
      created_at DATETIME NOT NULL,
      KEY idx_skill_catalog_judgements_target (target_type, target_id, created_at),
      KEY idx_skill_catalog_judgements_proposal (proposal_id)
    ) ENGINE = InnoDB;
    CREATE TABLE IF NOT EXISTS skill_catalog_proposals (
      id VARCHAR(64) PRIMARY KEY,
      skill_id VARCHAR(255) NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      category VARCHAR(255) NOT NULL,
      tags JSON NOT NULL,
      capabilities JSON NOT NULL,
      entrypoint VARCHAR(1024) NULL,
      status VARCHAR(32) NOT NULL,
      submitted_by VARCHAR(255) NOT NULL,
      submitted_by_principal_id CHAR(36) NULL,
      submitted_via_client_id VARCHAR(512) NULL,
      created_at DATETIME NOT NULL,
      rejection_reason TEXT NULL,
      latest_judgement_risk VARCHAR(32) NULL,
      review_labels JSON NOT NULL DEFAULT (JSON_ARRAY()),
      latest_judgement_id CHAR(36) NULL,
      latest_judged_at DATETIME NULL,
      content_digest CHAR(64) NULL,
      KEY idx_skill_catalog_proposals_status (status, created_at),
      KEY idx_skill_catalog_proposals_skill (skill_id, created_at),
      KEY idx_skill_catalog_proposals_content_digest (content_digest)
    ) ENGINE = InnoDB;
    CREATE TABLE IF NOT EXISTS skill_catalog_proposal_files (
      proposal_id VARCHAR(64) NOT NULL,
      id VARCHAR(255) NOT NULL,
      path VARCHAR(255) NOT NULL,
      mime_type VARCHAR(255) NOT NULL,
      size_bytes BIGINT NOT NULL,
      sha256 CHAR(64) NULL,
      PRIMARY KEY (proposal_id, path),
      KEY idx_skill_catalog_proposal_files (proposal_id, path),
      CONSTRAINT fk_proposal_files
        FOREIGN KEY (proposal_id)
        REFERENCES skill_catalog_proposals (id)
        ON DELETE CASCADE
    ) ENGINE = InnoDB;
    CREATE TABLE IF NOT EXISTS skill_catalog_audit_entries (
      id CHAR(36) PRIMARY KEY,
      skill_id VARCHAR(255) NULL,
      skill_version VARCHAR(64) NULL,
      proposal_id VARCHAR(64) NULL,
      action VARCHAR(255) NOT NULL,
      actor VARCHAR(255) NOT NULL,
      actor_principal_id CHAR(36) NULL,
      actor_display_name VARCHAR(512) NULL,
      actor_client_id VARCHAR(512) NULL,
      before_json JSON NULL,
      after_json JSON NULL,
      created_at DATETIME NOT NULL,
      KEY idx_skill_catalog_audit_skill (skill_id, created_at),
      KEY idx_skill_catalog_audit_proposal (proposal_id, created_at)
    ) ENGINE = InnoDB;
    CREATE TABLE IF NOT EXISTS identity_principals (
      id CHAR(36) PRIMARY KEY,
      kind VARCHAR(32) NOT NULL,
      display_name VARCHAR(512) NULL,
      email VARCHAR(512) NULL,
      first_seen_at DATETIME(3) NOT NULL,
      last_seen_at DATETIME(3) NOT NULL,
      disabled_at DATETIME(3) NULL,
      KEY idx_identity_principals_last_seen (last_seen_at, id)
    ) ENGINE = InnoDB;
    CREATE TABLE IF NOT EXISTS identity_external_subjects (
      issuer VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      external_subject VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
      principal_id CHAR(36) NOT NULL,
      provider_client_id VARCHAR(512) NOT NULL,
      first_seen_at DATETIME(3) NOT NULL,
      last_seen_at DATETIME(3) NOT NULL,
      UNIQUE KEY uq_identity_external_subject (issuer, external_subject),
      KEY idx_identity_external_principal (principal_id),
      CONSTRAINT fk_identity_external_principal
        FOREIGN KEY (principal_id) REFERENCES identity_principals (id)
        ON DELETE RESTRICT
    ) ENGINE = InnoDB;
    CREATE TABLE IF NOT EXISTS admin_sessions (
      session_id_hash CHAR(64) PRIMARY KEY,
      principal_id CHAR(36) NOT NULL,
      roles_json JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      last_seen_at DATETIME(3) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      revoked_at DATETIME(3) NULL,
      revoked_reason VARCHAR(512) NULL,
      KEY idx_admin_sessions_expiry (expires_at, session_id_hash),
      CONSTRAINT fk_admin_session_principal
        FOREIGN KEY (principal_id) REFERENCES identity_principals (id)
        ON DELETE RESTRICT
    ) ENGINE = InnoDB;

    CREATE TABLE IF NOT EXISTS agent_sessions (
      code VARCHAR(16) PRIMARY KEY,
      areas JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      revoked_at DATETIME(3) NULL,
      last_used_at DATETIME(3) NULL,
      created_by_ip VARCHAR(64) NULL,
      last_used_ip VARCHAR(64) NULL,
      user_agent TEXT NULL,
      KEY idx_agent_sessions_expiry (expires_at, code),
      KEY idx_agent_sessions_revoked (revoked_at, code)
    ) ENGINE = InnoDB;
    CREATE TABLE IF NOT EXISTS oidc_login_transactions (
      state_hash CHAR(64) PRIMARY KEY,
      nonce VARCHAR(512) NOT NULL,
      pkce_verifier VARCHAR(512) NOT NULL,
      redirect_uri VARCHAR(2048) NOT NULL,
      return_path VARCHAR(1024) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      consumed_at DATETIME(3) NULL,
      KEY idx_oidc_login_transactions_expiry (expires_at, state_hash)
    ) ENGINE = InnoDB;
  `;
  const statements = schemaSql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await client.execute(`${statement};`);
  }

  await ensureMysqlColumn(
    client,
    'skill_catalog_proposals',
    'submitted_by_principal_id',
    'CHAR(36) NULL AFTER submitted_by'
  );
  await ensureMysqlColumn(
    client,
    'skill_catalog_proposals',
    'submitted_via_client_id',
    'VARCHAR(512) NULL AFTER submitted_by_principal_id'
  );
  await ensureMysqlColumn(client, 'skill_catalog_audit_entries', 'actor_principal_id', 'CHAR(36) NULL AFTER actor');
  await ensureMysqlColumn(client, 'skill_catalog_audit_entries', 'actor_display_name', 'VARCHAR(512) NULL AFTER actor_principal_id');
  await ensureMysqlColumn(client, 'skill_catalog_audit_entries', 'actor_client_id', 'VARCHAR(512) NULL AFTER actor_display_name');
  await ensureMysqlColumn(client, 'agent_sessions', 'revoked_at', 'DATETIME(3) NULL AFTER expires_at');
  await ensureMysqlColumn(client, 'agent_sessions', 'last_used_at', 'DATETIME(3) NULL AFTER revoked_at');
  await ensureMysqlColumn(client, 'agent_sessions', 'created_by_ip', 'VARCHAR(64) NULL AFTER last_used_at');
  await ensureMysqlColumn(client, 'agent_sessions', 'last_used_ip', 'VARCHAR(64) NULL AFTER created_by_ip');
  await ensureMysqlColumn(client, 'agent_sessions', 'user_agent', 'TEXT NULL AFTER last_used_ip');
}

async function ensureMysqlColumn(
  client: MysqlClient,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const rows = await client.query<{ count: number | string }>(`
    SELECT COUNT(*) AS count
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
  `, [table, column]);
  if (Number(rows[0]?.count ?? 0) === 0) {
    await client.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}
