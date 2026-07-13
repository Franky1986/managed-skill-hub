import Database from 'better-sqlite3';

export function ensureSqliteCatalogSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_catalog_versions (
      skill_id TEXT NOT NULL,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      use_when TEXT NOT NULL,
      do_not_use_when TEXT NOT NULL,
      entrypoint TEXT NOT NULL,
      status TEXT NOT NULL,
      skill_uuid TEXT NOT NULL,
      version_uuid TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_by TEXT,
      published_by TEXT,
      published_at TEXT,
      rejected_by TEXT,
      rejected_at TEXT,
      rejection_reason TEXT,
      deprecated_by TEXT,
      deprecated_at TEXT,
      deprecation_reason TEXT,
      updated_at TEXT,
      is_latest_published INTEGER NOT NULL DEFAULT 0,
      is_latest_version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (skill_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_skill_catalog_versions_published
      ON skill_catalog_versions (status, is_latest_published, category, skill_id);
    CREATE INDEX IF NOT EXISTS idx_skill_catalog_versions_latest
      ON skill_catalog_versions (is_latest_version, skill_id);

    CREATE TABLE IF NOT EXISTS skill_catalog_files (
      skill_id TEXT NOT NULL,
      version TEXT NOT NULL,
      path TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      role TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT,
      updated_at TEXT,
      extractable INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (skill_id, version, path)
    );
    CREATE INDEX IF NOT EXISTS idx_skill_catalog_files_version
      ON skill_catalog_files (skill_id, version);

    CREATE TABLE IF NOT EXISTS skill_catalog_judgements (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      proposal_id TEXT,
      skill_id TEXT,
      skill_version TEXT,
      dimensions TEXT NOT NULL,
      overall_risk TEXT NOT NULL,
      summary TEXT NOT NULL,
      skill_purpose_summary TEXT,
      model TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_skill_catalog_judgements_target
      ON skill_catalog_judgements (target_type, target_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_skill_catalog_judgements_proposal
      ON skill_catalog_judgements (proposal_id);

    CREATE TABLE IF NOT EXISTS skill_catalog_proposals (
      id TEXT PRIMARY KEY,
      skill_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      entrypoint TEXT,
      status TEXT NOT NULL,
      submitted_by TEXT NOT NULL,
      submitted_by_principal_id TEXT,
      submitted_via_client_id TEXT,
      created_at TEXT NOT NULL,
      rejection_reason TEXT,
      latest_judgement_risk TEXT,
      review_labels TEXT NOT NULL DEFAULT '[]',
      latest_judgement_id TEXT,
      latest_judged_at TEXT,
      content_digest TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_skill_catalog_proposals_status
      ON skill_catalog_proposals (status, created_at);
    CREATE INDEX IF NOT EXISTS idx_skill_catalog_proposals_skill
      ON skill_catalog_proposals (skill_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_skill_catalog_proposals_content_digest
      ON skill_catalog_proposals (content_digest);

    CREATE TABLE IF NOT EXISTS skill_catalog_proposal_files (
      proposal_id TEXT NOT NULL,
      id TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT,
      PRIMARY KEY (proposal_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_skill_catalog_proposal_files_proposal
      ON skill_catalog_proposal_files (proposal_id, path);

    CREATE TABLE IF NOT EXISTS skill_catalog_audit_entries (
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
    CREATE INDEX IF NOT EXISTS idx_skill_catalog_audit_entries_skill
      ON skill_catalog_audit_entries (skill_id, created_at);

    CREATE TABLE IF NOT EXISTS identity_principals (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      display_name TEXT,
      email TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      disabled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_identity_principals_last_seen
      ON identity_principals (last_seen_at, id);

    CREATE TABLE IF NOT EXISTS identity_external_subjects (
      issuer TEXT NOT NULL,
      external_subject TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      provider_client_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (issuer, external_subject)
    );
    CREATE INDEX IF NOT EXISTS idx_identity_external_principal
      ON identity_external_subjects (principal_id);

    CREATE TABLE IF NOT EXISTS admin_sessions (
      session_id_hash TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      roles_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
      ON admin_sessions (expires_at, session_id_hash);

    CREATE TABLE IF NOT EXISTS oidc_login_transactions (
      state_hash TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      pkce_verifier TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      return_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_oidc_login_transactions_expiry
      ON oidc_login_transactions (expires_at, state_hash);
  `);

  ensureJudgementColumns(db);
  ensureAuditColumns(db);
  ensureProposalColumns(db);
  ensureVersionColumns(db);
}

function ensureAuditColumns(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(skill_catalog_audit_entries)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('actor_principal_id')) {
    db.exec('ALTER TABLE skill_catalog_audit_entries ADD COLUMN actor_principal_id TEXT;');
  }
  if (!names.has('actor_display_name')) {
    db.exec('ALTER TABLE skill_catalog_audit_entries ADD COLUMN actor_display_name TEXT;');
  }
  if (!names.has('actor_client_id')) {
    db.exec('ALTER TABLE skill_catalog_audit_entries ADD COLUMN actor_client_id TEXT;');
  }
}

function ensureVersionColumns(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(skill_catalog_versions)`).all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('approved_by')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN approved_by TEXT;`);
  }
  if (!names.has('approved_at')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN approved_at TEXT;`);
  }
  if (!names.has('published_by')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN published_by TEXT;`);
  }
  if (!names.has('rejected_by')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN rejected_by TEXT;`);
  }
  if (!names.has('rejected_at')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN rejected_at TEXT;`);
  }
  if (!names.has('rejection_reason')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN rejection_reason TEXT;`);
  }
  if (!names.has('deprecated_by')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN deprecated_by TEXT;`);
  }
  if (!names.has('deprecated_at')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN deprecated_at TEXT;`);
  }
  if (!names.has('deprecation_reason')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN deprecation_reason TEXT;`);
  }
  if (!names.has('is_latest_version')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN is_latest_version INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!names.has('use_when')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN use_when TEXT NOT NULL DEFAULT '[]';`);
  }
  if (!names.has('do_not_use_when')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN do_not_use_when TEXT NOT NULL DEFAULT '[]';`);
  }
  if (!names.has('entrypoint')) {
    db.exec(`ALTER TABLE skill_catalog_versions ADD COLUMN entrypoint TEXT NOT NULL DEFAULT '';`);
  }
}

function ensureProposalColumns(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(skill_catalog_proposals)`).all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('review_labels')) {
    db.exec(`ALTER TABLE skill_catalog_proposals ADD COLUMN review_labels TEXT NOT NULL DEFAULT '[]';`);
  }
  if (!names.has('latest_judgement_id')) {
    db.exec(`ALTER TABLE skill_catalog_proposals ADD COLUMN latest_judgement_id TEXT;`);
  }
  if (!names.has('latest_judged_at')) {
    db.exec(`ALTER TABLE skill_catalog_proposals ADD COLUMN latest_judged_at TEXT;`);
  }
  if (!names.has('content_digest')) {
    db.exec(`ALTER TABLE skill_catalog_proposals ADD COLUMN content_digest TEXT;`);
  }
  if (!names.has('submitted_by_principal_id')) {
    db.exec(`ALTER TABLE skill_catalog_proposals ADD COLUMN submitted_by_principal_id TEXT;`);
  }
  if (!names.has('submitted_via_client_id')) {
    db.exec(`ALTER TABLE skill_catalog_proposals ADD COLUMN submitted_via_client_id TEXT;`);
  }
}

function ensureJudgementColumns(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(skill_catalog_judgements)`).all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('skill_purpose_summary')) {
    db.exec(`ALTER TABLE skill_catalog_judgements ADD COLUMN skill_purpose_summary TEXT;`);
  }
}
