import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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
});
