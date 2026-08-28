import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppConfig } from '../config';
import { ensureSqliteCatalogSchema } from '../../adapters/outbound/catalog/sqlite/sqlite.catalog-schema';
import { migration as baselineLegacyCatalog } from './2026082600_baseline_legacy_catalog';
import { planCatalogMigrations, runCatalogMigrations } from './run-catalog-migrations';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('runCatalogMigrations', () => {
  it('backs up only when pending migrations change an existing catalog', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'catalog-migration-plan-')); directories.push(dataDir);
    const config = { catalogProvider: 'sqlite', dataDir } as AppConfig;
    await expect(planCatalogMigrations(config)).resolves.toMatchObject({ requiresBackup: false });
    expect(existsSync(path.join(dataDir, 'index'))).toBe(false);
    expect(existsSync(path.join(dataDir, 'index', 'search.db'))).toBe(false);
    mkdirSync(path.join(dataDir, 'index'), { recursive: true });
    const database = new Database(path.join(dataDir, 'index', 'search.db')); ensureSqliteCatalogSchema(database, false); database.close();
    await expect(planCatalogMigrations(config)).resolves.toMatchObject({ requiresBackup: true });
    await runCatalogMigrations(config);
    await expect(planCatalogMigrations(config)).resolves.toMatchObject({ requiresBackup: false, pendingMigrationIds: [] });
  });

  it('recovers a SQLite cutover lock left by a crashed process', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'catalog-stale-lock-')); directories.push(dataDir);
    const lockPath = path.join(dataDir, 'index', '.knex-migration-cutover.lock'); mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, acquiredAt: new Date(0).toISOString() }));
    const config = { catalogProvider: 'sqlite', dataDir } as AppConfig;
    const completed = await Promise.all([runCatalogMigrations(config, [baselineLegacyCatalog]), runCatalogMigrations(config, [baselineLegacyCatalog])]);
    expect(completed.flat()).toEqual(['2026082600_baseline_legacy_catalog']);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('reclaims a stale SQLite lock when its PID has been reused', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'catalog-reused-pid-lock-')); directories.push(dataDir);
    const lockPath = path.join(dataDir, 'index', '.knex-migration-cutover.lock'); mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, processStart: 'different-process-start', acquiredAt: new Date(0).toISOString() }));
    await expect(runCatalogMigrations({ catalogProvider: 'sqlite', dataDir } as AppConfig, [baselineLegacyCatalog])).resolves.toEqual(['2026082600_baseline_legacy_catalog']);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('records a migration only after its operation succeeds', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'catalog-migration-failure-')); directories.push(dataDir);
    const config = { catalogProvider: 'sqlite', dataDir } as AppConfig;
    await expect(runCatalogMigrations(config, [baselineLegacyCatalog, { id: 'failure_probe', description: 'test only', async up(context) {
      await context.addColumnIfMissing('skill_catalog_judgements', 'failure_probe', 'TEXT'); throw new Error('intentional failure');
    } }])).rejects.toThrow('intentional failure');
    const database = new Database(path.join(dataDir, 'index', 'search.db'));
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'managed_skill_hub_schema_migrations'").all()).toEqual([]);
    database.close();
  });

  it('adopts an already deployed legacy migration history without replaying it', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'catalog-knex-adoption-')); directories.push(dataDir);
    const databasePath = path.join(dataDir, 'index', 'search.db'); mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath); ensureSqliteCatalogSchema(database, false);
    database.exec('CREATE TABLE managed_skill_hub_schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    database.prepare('INSERT INTO managed_skill_hub_schema_migrations (id, applied_at) VALUES (?, ?)').run('2026082600_baseline_legacy_catalog', new Date().toISOString()); database.close();
    const config = { catalogProvider: 'sqlite', dataDir } as AppConfig;
    await expect(planCatalogMigrations(config, [baselineLegacyCatalog])).resolves.toMatchObject({ pendingMigrationIds: [], requiresBackup: false });
    const beforeRun = new Database(databasePath); expect(beforeRun.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knex_migrations'").all()).toEqual([]); beforeRun.close();
    await expect(runCatalogMigrations(config, [baselineLegacyCatalog])).resolves.toEqual([]);
    const verified = new Database(databasePath); expect(verified.prepare('SELECT name FROM knex_migrations').all()).toEqual([{ name: '2026082600_baseline_legacy_catalog' }]); verified.close();
  });

  it('normalizes a partial legacy SQLite catalog before recording history', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'catalog-partial-legacy-')); directories.push(dataDir);
    const databasePath = path.join(dataDir, 'index', 'search.db'); mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    database.exec(`CREATE TABLE skill_catalog_versions (skill_id TEXT NOT NULL, version TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL, capabilities TEXT NOT NULL, status TEXT NOT NULL, skill_uuid TEXT NOT NULL, version_uuid TEXT NOT NULL, content_digest TEXT NOT NULL, created_at TEXT NOT NULL, is_latest_published INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (skill_id, version)); CREATE TABLE agent_sessions (code TEXT PRIMARY KEY, areas TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);`);
    database.close();
    await runCatalogMigrations({ catalogProvider: 'sqlite', dataDir } as AppConfig);
    const verified = new Database(databasePath);
    const versionColumns = new Set((verified.prepare('PRAGMA table_info(skill_catalog_versions)').all() as Array<{ name: string }>).map((column) => column.name));
    const sessionInfo = verified.prepare('PRAGMA table_info(agent_sessions)').all() as Array<{ name: string; notnull: number }>;
    const sessionColumns = new Set(sessionInfo.map((column) => column.name));
    const indexes = verified.prepare('PRAGMA index_list(agent_sessions)').all() as Array<{ name: string }>;
    verified.close();
    expect([...versionColumns]).toEqual(expect.arrayContaining(['approved_by', 'use_when', 'do_not_use_when', 'entrypoint']));
    expect([...sessionColumns]).toEqual(expect.arrayContaining(['session_id', 'revoked_at', 'last_used_at']));
    expect(sessionInfo.find((column) => column.name === 'session_id')?.notnull).toBe(1);
    expect(indexes.some((index) => index.name === 'uq_agent_sessions_session_id')).toBe(true);
  });

});
