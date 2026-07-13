import { MysqlClient } from '../../mysql/mysql.connection';

export async function ensureMysqlSearchSchema(client: MysqlClient): Promise<void> {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS skill_search_documents (
      skill_id VARCHAR(255) NOT NULL,
      version VARCHAR(64) NOT NULL,
      title VARCHAR(1024) NOT NULL,
      description TEXT NOT NULL,
      category VARCHAR(255) NOT NULL,
      group_values TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      body LONGTEXT NOT NULL,
      published_at DATETIME NOT NULL,
      PRIMARY KEY (skill_id, version),
      KEY idx_skill_search_documents_skill (skill_id, version),
      FULLTEXT KEY ft_skill_search_documents
        (title, description, category, capabilities, group_values, body)
    ) ENGINE = InnoDB;

    CREATE TABLE IF NOT EXISTS skill_search_document_tags (
      skill_id VARCHAR(255) NOT NULL,
      version VARCHAR(64) NOT NULL,
      tag VARCHAR(255) NOT NULL,
      PRIMARY KEY (skill_id, version, tag),
      KEY idx_skill_search_document_tags_lookup (tag, skill_id, version),
      CONSTRAINT fk_search_doc_tags
        FOREIGN KEY (skill_id, version)
        REFERENCES skill_search_documents (skill_id, version)
        ON DELETE CASCADE
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
