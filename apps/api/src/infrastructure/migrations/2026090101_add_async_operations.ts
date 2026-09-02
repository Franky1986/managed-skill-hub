import { CatalogMigration } from './catalog-migration';

/** Durable review operations; state is shared by SQLite and MySQL deployments. */
export const migration: CatalogMigration = {
  id: '2026090101_add_async_operations',
  description: 'Add durable asynchronous review-operation progress records.',
  async up(context) {
    await context.executeSchema(context.provider === 'sqlite' ? SQLITE_SCHEMA : MYSQL_SCHEMA);
    await context.addIndexIfMissing('skill_catalog_operations', 'idx_skill_catalog_operations_state_created', ['state', 'created_at'], false);
    await context.addIndexIfMissing('skill_catalog_operations', 'idx_skill_catalog_operations_proposal', ['proposal_id', 'created_at'], false);
    await context.addIndexIfMissing('skill_catalog_operations', 'idx_skill_catalog_operations_skill', ['skill_id', 'skill_version', 'created_at'], false);
  },
};

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS skill_catalog_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  proposal_id TEXT,
  skill_id TEXT,
  skill_version TEXT,
  file_path TEXT,
  requested_by TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  phase TEXT NOT NULL,
  message TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  current_target TEXT,
  error_code TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);`;

const MYSQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS skill_catalog_operations (
  id CHAR(36) PRIMARY KEY,
  kind VARCHAR(64) NOT NULL,
  state VARCHAR(32) NOT NULL,
  proposal_id VARCHAR(64),
  skill_id VARCHAR(255),
  skill_version VARCHAR(64),
  file_path VARCHAR(1024),
  requested_by VARCHAR(512) NOT NULL,
  payload_json JSON NOT NULL,
  phase VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  completed INT NOT NULL DEFAULT 0,
  total INT NOT NULL DEFAULT 0,
  current_target VARCHAR(1024),
  error_code VARCHAR(128),
  lease_owner CHAR(36),
  lease_expires_at DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  started_at DATETIME(3),
  finished_at DATETIME(3),
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;`;
