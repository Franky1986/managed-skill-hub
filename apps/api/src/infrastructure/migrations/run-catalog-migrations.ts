import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureMysqlCatalogSchema } from '../../adapters/outbound/catalog/mysql/mysql.catalog-schema';
import { ensureSqliteCatalogSchema } from '../../adapters/outbound/catalog/sqlite/sqlite.catalog-schema';
import { MysqlClient } from '../../adapters/outbound/mysql/mysql.connection';
import { AppConfig, loadConfig } from '../config';
import { CatalogMigration, CatalogMigrationContext } from './catalog-migration';
import { catalogMigrations } from './migrations';

const MIGRATIONS_TABLE = 'managed_skill_hub_schema_migrations';
export interface CatalogMigrationPlan { provider: 'sqlite' | 'mysql'; pendingMigrationIds: string[]; requiresBackup: boolean; }
interface CatalogMigrationRunOptions { beforeApply?: (plan: CatalogMigrationPlan) => Promise<void>; }

export async function planCatalogMigrations(config: AppConfig, migrations: readonly CatalogMigration[] = catalogMigrations): Promise<CatalogMigrationPlan> {
  return config.catalogProvider === 'sqlite' ? planSqliteMigrations(config, migrations) : planMysqlMigrations(config, migrations);
}
export async function runCatalogMigrations(config: AppConfig, migrations: readonly CatalogMigration[] = catalogMigrations, options: CatalogMigrationRunOptions = {}): Promise<string[]> {
  return config.catalogProvider === 'sqlite' ? runSqliteMigrations(config, migrations, options) : runMysqlMigrations(config, migrations, options);
}
/** Backs up a pre-existing catalog exactly once, while the migration lock is held. */
export async function migrateCatalogWithBackup(config: AppConfig): Promise<string[]> {
  return runCatalogMigrations(config, catalogMigrations, { beforeApply: async (plan) => {
    if (plan.requiresBackup) await runBackupScript(plan.provider === 'mysql' ? 'scripts/operations/backup-mysql-for-migration.sh' : 'scripts/operations/backup.sh', config);
  }});
}

async function runSqliteMigrations(config: AppConfig, migrations: readonly CatalogMigration[], options: CatalogMigrationRunOptions): Promise<string[]> {
  const databasePath = path.join(config.dataDir, 'index', 'search.db'); mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  try {
    database.pragma('busy_timeout = 30000'); database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);`);
      const applied = readSqliteAppliedMigrations(database);
      const pendingMigrationIds = migrations.filter((migration) => !applied.has(migration.id)).map((migration) => migration.id);
      await options.beforeApply?.({ provider: 'sqlite', pendingMigrationIds, requiresBackup: pendingMigrationIds.length > 0 && sqliteTableExists(database, 'skill_catalog_versions') });
      const context: CatalogMigrationContext = {
        provider: 'sqlite', bootstrapLegacySchema: async () => ensureSqliteCatalogSchema(database, false),
        addColumnIfMissing: async (table, column, definition) => {
          const columns = new Set((database.prepare(`PRAGMA table_info(${assertIdentifier(table)})`).all() as Array<{ name: string }>).map((item) => item.name));
          if (!columns.has(column)) database.exec(`ALTER TABLE ${assertIdentifier(table)} ADD COLUMN ${assertIdentifier(column)} ${definition};`);
        },
      };
      const completed = await applyPendingMigrations(migrations, context, applied, (migration) => {
        database.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`).run(migration.id, new Date().toISOString());
      });
      database.exec('COMMIT;'); return completed;
    } catch (error) { database.exec('ROLLBACK;'); throw error; }
  } finally { database.close(); }
}

function planSqliteMigrations(config: AppConfig, migrations: readonly CatalogMigration[]): CatalogMigrationPlan {
  const databasePath = path.join(config.dataDir, 'index', 'search.db');
  if (!existsSync(databasePath)) return { provider: 'sqlite', pendingMigrationIds: migrations.map((migration) => migration.id), requiresBackup: false };
  const database = new Database(databasePath, { readonly: true });
  try {
    const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
    const applied = tables.has(MIGRATIONS_TABLE) ? readSqliteAppliedMigrations(database) : new Set<string>();
    const pendingMigrationIds = migrations.filter((migration) => !applied.has(migration.id)).map((migration) => migration.id);
    return { provider: 'sqlite', pendingMigrationIds, requiresBackup: pendingMigrationIds.length > 0 && tables.has('skill_catalog_versions') };
  } finally { database.close(); }
}

async function runMysqlMigrations(config: AppConfig, migrations: readonly CatalogMigration[], options: CatalogMigrationRunOptions): Promise<string[]> {
  const client = new MysqlClient(config);
  try { return await client.withConnection(async (connection) => {
    const [lock] = await connection.query<{ acquired: number | string | null }>(`SELECT GET_LOCK('managed-skill-hub-schema-migrations', 30) AS acquired`);
    if (String(lock[0]?.acquired) !== '1') throw new Error('Timed out while waiting for the MySQL schema migration lock.');
    try {
      const lockedClient = { execute: async (sql: string, params: unknown[] = []) => { await connection.execute(sql, params); },
        query: async <T = unknown>(sql: string, params: unknown[] = []) => (await connection.query<T>(sql, params))[0] };
      await lockedClient.execute(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id VARCHAR(191) PRIMARY KEY, applied_at DATETIME(3) NOT NULL) ENGINE = InnoDB;`);
      const applied = new Set((await lockedClient.query<{ id: string }>(`SELECT id FROM ${MIGRATIONS_TABLE}`)).map((row) => row.id));
      const pendingMigrationIds = migrations.filter((migration) => !applied.has(migration.id)).map((migration) => migration.id);
      const catalogTables = await lockedClient.query<{ TABLE_NAME: string }>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [config.mysqlDatabase, 'skill_catalog_versions']);
      await options.beforeApply?.({ provider: 'mysql', pendingMigrationIds, requiresBackup: pendingMigrationIds.length > 0 && catalogTables.length > 0 });
      const context: CatalogMigrationContext = { provider: 'mysql', bootstrapLegacySchema: async () => ensureMysqlCatalogSchema(lockedClient, false),
        addColumnIfMissing: async (table, column, definition) => {
          const rows = await lockedClient.query<{ COLUMN_NAME: string }>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [config.mysqlDatabase, table, column]);
          if (rows.length === 0) await lockedClient.execute(`ALTER TABLE ${assertIdentifier(table)} ADD COLUMN ${assertIdentifier(column)} ${definition}`);
        }};
      return await applyPendingMigrations(migrations, context, applied, async (migration) => {
        await lockedClient.execute(`INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, UTC_TIMESTAMP(3))`, [migration.id]);
      });
    } finally { await connection.query(`SELECT RELEASE_LOCK('managed-skill-hub-schema-migrations')`); }
  }); } finally { await client.close(); }
}

async function planMysqlMigrations(config: AppConfig, migrations: readonly CatalogMigration[]): Promise<CatalogMigrationPlan> {
  const client = new MysqlClient(config);
  try {
    const names = new Set((await client.query<{ TABLE_NAME: string }>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [config.mysqlDatabase])).map((table) => table.TABLE_NAME));
    const applied = new Set((names.has(MIGRATIONS_TABLE) ? await client.query<{ id: string }>(`SELECT id FROM ${MIGRATIONS_TABLE}`) : []).map((row) => row.id));
    const pendingMigrationIds = migrations.filter((migration) => !applied.has(migration.id)).map((migration) => migration.id);
    return { provider: 'mysql', pendingMigrationIds, requiresBackup: pendingMigrationIds.length > 0 && names.has('skill_catalog_versions') };
  } finally { await client.close(); }
}

async function applyPendingMigrations(migrations: readonly CatalogMigration[], context: CatalogMigrationContext, applied: Set<string>, recordApplied: (migration: CatalogMigration) => void | Promise<void>): Promise<string[]> {
  const completed: string[] = [];
  for (const migration of migrations) { if (!applied.has(migration.id)) { await migration.up(context); await recordApplied(migration); completed.push(migration.id); } }
  return completed;
}
function readSqliteAppliedMigrations(database: Database.Database): Set<string> { return new Set((database.prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`).all() as Array<{ id: string }>).map((row) => row.id)); }
function sqliteTableExists(database: Database.Database, table: string): boolean { return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)); }
function assertIdentifier(value: string): string { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe migration identifier: ${value}`); return value; }
async function runBackupScript(script: string, config: AppConfig): Promise<void> {
  await new Promise<void>((resolve, reject) => execFile('bash', [script], { cwd: process.cwd(), env: { ...process.env, DATA_DIR: config.dataDir, CATALOG_PROVIDER: config.catalogProvider, CONTENT_STORAGE_PROVIDER: config.contentStorageProvider, MYSQL_HOST: config.mysqlHost, MYSQL_PORT: String(config.mysqlPort), MYSQL_DATABASE: config.mysqlDatabase, MYSQL_USER: config.mysqlUser, MYSQL_PASSWORD: config.mysqlPassword } }, (error, _stdout, stderr) => error ? reject(new Error(`Pre-migration backup failed: ${stderr.trim() || error.message}`)) : resolve()));
}
async function main(): Promise<void> { if (process.argv.includes('--plan')) { console.log(JSON.stringify(await planCatalogMigrations(loadConfig()))); return; } const completed = await migrateCatalogWithBackup(loadConfig()); console.log(completed.length === 0 ? 'Catalog schema migrations are already current.' : `Applied catalog schema migrations: ${completed.join(', ')}`); }
if (require.main === module) main().catch((error) => { console.error(`Catalog schema migration failed: ${(error as Error).message}`); process.exitCode = 1; });
