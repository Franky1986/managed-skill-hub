import { MysqlClient } from '../../mysql/mysql.connection';

export async function ensureMysqlContentSchema(client: MysqlClient): Promise<void> {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS content_skill_aggregates (
      skill_id VARCHAR(255) PRIMARY KEY,
      aggregate_json JSON NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    ) ENGINE = InnoDB;

    CREATE TABLE IF NOT EXISTS content_proposal_aggregates (
      proposal_id VARCHAR(64) PRIMARY KEY,
      aggregate_json JSON NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    ) ENGINE = InnoDB;

    CREATE TABLE IF NOT EXISTS content_skill_files (
      skill_id VARCHAR(255) NOT NULL,
      version VARCHAR(64) NOT NULL,
      path VARCHAR(1024) NOT NULL,
      mime_type VARCHAR(255) NOT NULL,
      size_bytes BIGINT NOT NULL,
      sha256 CHAR(64) NOT NULL,
      updated_at VARCHAR(32) NOT NULL,
      content_blob LONGBLOB NOT NULL,
      PRIMARY KEY (skill_id, version, path(255)),
      KEY idx_content_skill_files_version (skill_id, version)
    ) ENGINE = InnoDB;

    CREATE TABLE IF NOT EXISTS content_proposal_files (
      proposal_id VARCHAR(64) NOT NULL,
      path VARCHAR(1024) NOT NULL,
      mime_type VARCHAR(255) NOT NULL,
      size_bytes BIGINT NOT NULL,
      sha256 CHAR(64) NOT NULL,
      updated_at VARCHAR(32) NOT NULL,
      content_blob LONGBLOB NOT NULL,
      PRIMARY KEY (proposal_id, path(255)),
      KEY idx_content_proposal_files_proposal (proposal_id)
    ) ENGINE = InnoDB;

    CREATE TABLE IF NOT EXISTS content_skill_file_extracts (
      skill_id VARCHAR(255) NOT NULL,
      version VARCHAR(64) NOT NULL,
      path VARCHAR(1024) NOT NULL,
      text LONGTEXT NOT NULL,
      extracted_by VARCHAR(255) NOT NULL,
      metadata_json JSON NOT NULL,
      extracted_at VARCHAR(32) NOT NULL,
      PRIMARY KEY (skill_id, version, path(255))
    ) ENGINE = InnoDB;

    CREATE TABLE IF NOT EXISTS content_proposal_file_extracts (
      proposal_id VARCHAR(64) NOT NULL,
      path VARCHAR(1024) NOT NULL,
      text LONGTEXT NOT NULL,
      extracted_by VARCHAR(255) NOT NULL,
      metadata_json JSON NOT NULL,
      extracted_at VARCHAR(32) NOT NULL,
      PRIMARY KEY (proposal_id, path(255))
    ) ENGINE = InnoDB;

    CREATE TABLE IF NOT EXISTS content_audit_entries (
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
      created_at VARCHAR(32) NOT NULL,
      KEY idx_content_audit_entries_skill (skill_id, created_at),
      KEY idx_content_audit_entries_proposal (proposal_id, created_at)
    ) ENGINE = InnoDB;
  `;
  const statements = schemaSql.split(';').map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) {
    await client.execute(statement + ';');
  }
  await ensureMysqlColumn(client, 'actor_principal_id', 'CHAR(36) NULL AFTER actor');
  await ensureMysqlColumn(client, 'actor_display_name', 'VARCHAR(512) NULL AFTER actor_principal_id');
  await ensureMysqlColumn(client, 'actor_client_id', 'VARCHAR(512) NULL AFTER actor_display_name');
}

async function ensureMysqlColumn(client: MysqlClient, column: string, definition: string): Promise<void> {
  const rows = await client.query<{ count: number | string }>(`
    SELECT COUNT(*) AS count FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'content_audit_entries' AND column_name = ?
  `, [column]);
  if (Number(rows[0]?.count ?? 0) === 0) {
    await client.execute(`ALTER TABLE content_audit_entries ADD COLUMN \`${column}\` ${definition}`);
  }
}
