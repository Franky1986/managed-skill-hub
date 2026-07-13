import Database from 'better-sqlite3';

export function ensureSqliteSearchSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_documents (
      skill_id TEXT NOT NULL,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      groups TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      body TEXT NOT NULL,
      published_at TEXT NOT NULL,
      PRIMARY KEY (skill_id, version)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      skill_id UNINDEXED,
      version UNINDEXED,
      title,
      description,
      groups,
      capabilities,
      body,
      content='search_documents',
      content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS search_documents_ai AFTER INSERT ON search_documents BEGIN
      INSERT INTO search_fts(rowid, skill_id, version, title, description, groups, capabilities, body)
      VALUES (new.rowid, new.skill_id, new.version, new.title, new.description, new.groups, new.capabilities, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS search_documents_ad AFTER DELETE ON search_documents BEGIN
      INSERT INTO search_fts(search_fts, rowid, skill_id, version, title, description, groups, capabilities, body)
      VALUES ('delete', old.rowid, old.skill_id, old.version, old.title, old.description, old.groups, old.capabilities, old.body);
    END;
  `);
}

