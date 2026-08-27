import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfig } from '../config';
import { ensureSqliteCatalogSchema } from '../../adapters/outbound/catalog/sqlite/sqlite.catalog-schema';
import { MysqlClient } from '../../adapters/outbound/mysql/mysql.connection';
import { migration as baselineLegacyCatalog } from './2026082600_baseline_legacy_catalog';
import { planCatalogMigrations, runCatalogMigrations } from './run-catalog-migrations';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('runCatalogMigrations', () => {
  it('backs up only when pending migrations change an existing catalog', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'catalog-migration-plan-')); directories.push(dataDir);
    const config = { catalogProvider: 'sqlite', dataDir } as AppConfig;
    await expect(planCatalogMigrations(config)).resolves.toMatchObject({ requiresBackup: false });
    mkdirSync(path.join(dataDir, 'index'), { recursive: true });
    const database = new Database(path.join(dataDir, 'index', 'search.db')); ensureSqliteCatalogSchema(database, false); database.close();
    await expect(planCatalogMigrations(config)).resolves.toMatchObject({ requiresBackup: true });
    await runCatalogMigrations(config);
    await expect(planCatalogMigrations(config)).resolves.toMatchObject({ requiresBackup: false, pendingMigrationIds: [] });
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

  it('holds the MySQL advisory lock, records only after success, and releases it', async () => {
    const executed: string[] = [];
    const queried: string[] = [];
    vi.spyOn(MysqlClient.prototype, 'withConnection').mockImplementation(async (handler) => handler({
      execute: async (sql) => { executed.push(sql); return [[], undefined]; },
      query: async (sql) => {
        queried.push(sql);
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], undefined];
        if (sql.includes('SELECT id FROM')) return [[], undefined];
        if (sql.includes('information_schema.TABLES')) return [[], undefined];
        return [[], undefined];
      },
      beginTransaction: async () => undefined, commit: async () => undefined,
      rollback: async () => undefined, release: () => undefined,
    } as never));
    vi.spyOn(MysqlClient.prototype, 'close').mockResolvedValue();
    const config = { catalogProvider: 'mysql', mysqlDatabase: 'catalog' } as AppConfig;

    await expect(runCatalogMigrations(config, [{ id: 'mysql-success', description: 'test only', async up() {} }])).resolves.toEqual(['mysql-success']);

    expect(queried.some((sql) => sql.includes('GET_LOCK'))).toBe(true);
    expect(executed.some((sql) => sql.includes('INSERT INTO managed_skill_hub_schema_migrations'))).toBe(true);
    expect(queried.some((sql) => sql.includes('RELEASE_LOCK'))).toBe(true);
    vi.restoreAllMocks();
  });

  it('releases the MySQL advisory lock without recording a failed migration', async () => {
    const executed: string[] = [];
    const queried: string[] = [];
    vi.spyOn(MysqlClient.prototype, 'withConnection').mockImplementation(async (handler) => handler({
      execute: async (sql) => { executed.push(sql); return [[], undefined]; },
      query: async (sql) => {
        queried.push(sql);
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], undefined];
        return [[], undefined];
      },
      beginTransaction: async () => undefined, commit: async () => undefined,
      rollback: async () => undefined, release: () => undefined,
    } as never));
    vi.spyOn(MysqlClient.prototype, 'close').mockResolvedValue();
    const config = { catalogProvider: 'mysql', mysqlDatabase: 'catalog' } as AppConfig;

    await expect(runCatalogMigrations(config, [{ id: 'mysql-failure', description: 'test only', async up() { throw new Error('intentional failure'); } }])).rejects.toThrow('intentional failure');

    expect(executed.some((sql) => sql.includes('INSERT INTO managed_skill_hub_schema_migrations'))).toBe(false);
    expect(queried.some((sql) => sql.includes('RELEASE_LOCK'))).toBe(true);
    vi.restoreAllMocks();
  });
});
