import Database from 'better-sqlite3';

export function ensureSqliteContentSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_skill_aggregates (
      skill_id TEXT PRIMARY KEY,
      aggregate_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_proposal_aggregates (
      proposal_id TEXT PRIMARY KEY,
      aggregate_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_skill_files (
      skill_id TEXT NOT NULL,
      version TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      content_blob BLOB NOT NULL,
      PRIMARY KEY (skill_id, version, path)
    );
    CREATE INDEX IF NOT EXISTS idx_content_skill_files_version
      ON content_skill_files (skill_id, version, path);

    CREATE TABLE IF NOT EXISTS content_proposal_files (
      proposal_id TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      content_blob BLOB NOT NULL,
      PRIMARY KEY (proposal_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_content_proposal_files_proposal
      ON content_proposal_files (proposal_id, path);

    CREATE TABLE IF NOT EXISTS content_skill_file_extracts (
      skill_id TEXT NOT NULL,
      version TEXT NOT NULL,
      path TEXT NOT NULL,
      text TEXT NOT NULL,
      extracted_by TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      extracted_at TEXT NOT NULL,
      PRIMARY KEY (skill_id, version, path)
    );

    CREATE TABLE IF NOT EXISTS content_proposal_file_extracts (
      proposal_id TEXT NOT NULL,
      path TEXT NOT NULL,
      text TEXT NOT NULL,
      extracted_by TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      extracted_at TEXT NOT NULL,
      PRIMARY KEY (proposal_id, path)
    );

    CREATE TABLE IF NOT EXISTS content_audit_entries (
      id TEXT PRIMARY KEY,
      skill_id TEXT,
      skill_version TEXT,
      proposal_id TEXT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_principal_id TEXT,
      actor_display_name TEXT,
      actor_client_id TEXT,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_audit_entries_skill
      ON content_audit_entries (skill_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_content_audit_entries_proposal
      ON content_audit_entries (proposal_id, created_at);
  `);
  ensureAuditColumns(db);
}

function ensureAuditColumns(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(content_audit_entries)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('actor_principal_id')) {
    db.exec('ALTER TABLE content_audit_entries ADD COLUMN actor_principal_id TEXT;');
  }
  if (!names.has('actor_display_name')) {
    db.exec('ALTER TABLE content_audit_entries ADD COLUMN actor_display_name TEXT;');
  }
  if (!names.has('actor_client_id')) {
    db.exec('ALTER TABLE content_audit_entries ADD COLUMN actor_client_id TEXT;');
  }
}
