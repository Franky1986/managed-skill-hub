import { randomUUID } from 'node:crypto';
import { MysqlClient } from '../../apps/api/src/adapters/outbound/mysql/mysql.connection';
import { runCatalogMigrations } from '../../apps/api/src/infrastructure/migrations/run-catalog-migrations';
import { CatalogMigration } from '../../apps/api/src/infrastructure/migrations/catalog-migration';
import { catalogMigrations } from '../../apps/api/src/infrastructure/migrations/migrations';
import { createScriptAppConfig } from '../lib/script-app-config';

const historyTable = 'knex_migrations';
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function config() { return createScriptAppConfig({ catalogProvider: 'mysql', searchProvider: 'mysql', contentStorageProvider: 'database', mysqlHost: process.env.MYSQL_HOST ?? '127.0.0.1', mysqlPort: Number(process.env.MYSQL_PORT ?? 33307), mysqlDatabase: process.env.MYSQL_DATABASE ?? 'managed_skill_hub', mysqlUser: process.env.MYSQL_USER ?? 'managed_skill_hub', mysqlPassword: process.env.MYSQL_PASSWORD ?? 'valpass', mysqlSslMode: 'disabled' }); }
async function main(): Promise<void> {
  const appConfig = config(); const suffix = randomUUID().replace(/-/g, '').slice(0, 16); const successId = `test_mysql_migration_success_${suffix}`; const failureId = `test_mysql_migration_failure_${suffix}`; const lockId = `test_mysql_migration_lock_${suffix}`; const deleteRuleId = `test_mysql_migration_delete_rule_${suffix}`; const successColumn = `migration_success_${suffix}`; const failureColumn = `migration_failure_${suffix}`; const deleteRuleProposalId = `fk-delete-${suffix}`; let failAfterDdl = true; const client = new MysqlClient(appConfig);
  try {
    await runCatalogMigrations(appConfig);
    const success: CatalogMigration = { id: successId, description: 'MySQL integration success probe', async up(context) { await context.addColumnIfMissing('skill_catalog_judgements', successColumn, 'VARCHAR(8) NULL'); } };
    await runCatalogMigrations(appConfig, [...catalogMigrations, success]);
    assert((await client.query<{ name: string }>(`SELECT name FROM ${historyTable} WHERE name = ?`, [successId])).length === 1, 'successful MySQL migration was not recorded by Knex');
    const failure: CatalogMigration = { id: failureId, description: 'MySQL integration failure probe', async up(context) { await context.addColumnIfMissing('skill_catalog_judgements', failureColumn, 'VARCHAR(8) NULL'); if (failAfterDdl) throw new Error('intentional MySQL migration failure'); } };
    await runCatalogMigrations(appConfig, [...catalogMigrations, success, failure]).then(() => { throw new Error('failing MySQL migration unexpectedly completed'); }, (error: Error) => assert(error.message.includes('intentional MySQL migration failure'), 'unexpected MySQL migration failure'));
    assert((await client.query<{ name: string }>(`SELECT name FROM ${historyTable} WHERE name = ?`, [failureId])).length === 0, 'failed MySQL migration was recorded');
    failAfterDdl = false;
    await runCatalogMigrations(appConfig, [...catalogMigrations, success, failure]);
    assert((await client.query<{ name: string }>(`SELECT name FROM ${historyTable} WHERE name = ?`, [failureId])).length === 1, 'idempotent MySQL retry after DDL was not recorded');
    await client.execute('ALTER TABLE skill_catalog_proposal_files DROP FOREIGN KEY fk_proposal_files'); await client.execute('ALTER TABLE skill_catalog_proposal_files ADD CONSTRAINT fk_proposal_files_legacy FOREIGN KEY (proposal_id) REFERENCES skill_catalog_proposals(id) ON DELETE RESTRICT');
    const deleteRuleRepair: CatalogMigration = { id: deleteRuleId, description: 'MySQL foreign-key delete-rule repair probe', async up(context) { await context.addForeignKeyIfMissing('skill_catalog_proposal_files', 'fk_proposal_files', ['proposal_id'], 'skill_catalog_proposals', ['id'], 'CASCADE'); } };
    await runCatalogMigrations(appConfig, [...catalogMigrations, success, failure, deleteRuleRepair]);
    const deleteRules = await client.query<{ constraint_name: string; delete_rule: string }>('SELECT constraint_name AS constraint_name, delete_rule AS delete_rule FROM information_schema.referential_constraints WHERE constraint_schema = ? AND table_name = ? AND referenced_table_name = ? ORDER BY constraint_name', [appConfig.mysqlDatabase, 'skill_catalog_proposal_files', 'skill_catalog_proposals']);
    assert(deleteRules.length === 1 && deleteRules[0]?.constraint_name === 'fk_proposal_files' && deleteRules[0]?.delete_rule === 'CASCADE', 'foreign-key delete-rule/name mismatch was not repaired');
    await client.execute('INSERT INTO skill_catalog_proposals (id,title,description,category,tags,capabilities,entrypoint,status,submitted_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,NOW())', [deleteRuleProposalId, 'FK delete test', 'test', 'test', '[]', '[]', 'README.md', 'submitted', 'test']); await client.execute('INSERT INTO skill_catalog_proposal_files (proposal_id,id,path,mime_type,size_bytes) VALUES (?,?,?,?,?)', [deleteRuleProposalId, `file-${suffix}`, 'README.md', 'text/markdown', 1]); await client.execute('DELETE FROM skill_catalog_proposals WHERE id = ?', [deleteRuleProposalId]); assert((await client.query<{ count: number }>('SELECT COUNT(*) AS count FROM skill_catalog_proposal_files WHERE proposal_id = ?', [deleteRuleProposalId]))[0]?.count === 0, 'repaired CASCADE foreign key did not delete the child row');
    const lockProbe: CatalogMigration = { id: lockId, description: 'MySQL cutover lock probe', async up() {} };
    await client.withConnection(async (connection) => { const [lock] = await connection.query<{ acquired: number }>("SELECT GET_LOCK('managed-skill-hub-schema-migrations', 5) AS acquired"); assert(lock[0]?.acquired === 1, 'test could not acquire cutover lock'); const pending = runCatalogMigrations(appConfig, [...catalogMigrations, success, failure, deleteRuleRepair, lockProbe]); await new Promise((resolve) => setTimeout(resolve, 150)); await connection.query("SELECT RELEASE_LOCK('managed-skill-hub-schema-migrations')"); await pending; });
    assert((await client.query<{ name: string }>(`SELECT name FROM ${historyTable} WHERE name = ?`, [lockId])).length === 1, 'migration did not complete after cutover lock release');
    console.log('mysql-catalog-migrations\nchecks=knex-history,failure-unrecorded,idempotent-ddl-retry,foreign-key-delete-rule-repair,cutover-lock-contention\nRESULT=PASS');
  } finally { await client.execute(`ALTER TABLE skill_catalog_judgements DROP COLUMN IF EXISTS \`${successColumn}\``).catch(() => undefined); await client.execute(`ALTER TABLE skill_catalog_judgements DROP COLUMN IF EXISTS \`${failureColumn}\``).catch(() => undefined); await client.execute(`DELETE FROM ${historyTable} WHERE name IN (?, ?, ?, ?)`, [successId, failureId, deleteRuleId, lockId]).catch(() => undefined); await client.execute('DELETE FROM skill_catalog_proposals WHERE id = ?', [deleteRuleProposalId]).catch(() => undefined); await client.close(); }
}
main().catch((error) => { console.error('RESULT=FAIL'); console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
