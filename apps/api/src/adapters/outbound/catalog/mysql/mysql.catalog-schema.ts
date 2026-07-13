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
      before_json JSON NULL,
      after_json JSON NULL,
      created_at DATETIME NOT NULL,
      KEY idx_skill_catalog_audit_skill (skill_id, created_at),
      KEY idx_skill_catalog_audit_proposal (proposal_id, created_at)
    ) ENGINE = InnoDB;
  `;
  const statements = schemaSql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await client.execute(`${statement};`);
  }
}
