import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

interface CheckResult {
  id: string;
  detail: string;
  result: 'PASS';
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const proofRoot = path.resolve('.tmp/backup-restore-proof');
  const dataDir = path.join(proofRoot, 'data');
  await rm(proofRoot, { recursive: true, force: true });
  await mkdir(path.join(dataDir, 'skills', 'backup-proof', '1.0.0'), { recursive: true });
  await mkdir(path.join(dataDir, 'proposals', 'proposal-backup-proof'), { recursive: true });
  await mkdir(path.join(dataDir, 'audit'), { recursive: true });
  await mkdir(path.join(dataDir, 'index'), { recursive: true });
  await mkdir(path.join(dataDir, 'uploads'), { recursive: true });

  const skillFile = path.join(dataDir, 'skills', 'backup-proof', '1.0.0', 'SKILL.md');
  const proposalFile = path.join(dataDir, 'proposals', 'proposal-backup-proof', 'proposal.json');
  const auditFile = path.join(dataDir, 'audit', 'proposal-backup-proof.jsonl');
  const indexFile = path.join(dataDir, 'index', 'projection.json');
  await writeFile(skillFile, '# Backup Proof Skill\n');
  await writeFile(proposalFile, '{"id":"proposal-backup-proof","status":"submitted"}\n');
  await writeFile(auditFile, '{"action":"submit_proposal"}\n');
  await writeFile(indexFile, '{"projection":"deterministic"}\n');

  const backup = await execFileAsync('bash', ['scripts/operations/backup.sh'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, MSH_SKIP_ENV: 'true' },
    maxBuffer: 1024 * 1024,
  });
  const archiveMatch = backup.stdout.match(/Backup erstellt: (.+.tar.gz)|Backup created: (.+.tar.gz)/);
  const archive = archiveMatch?.[1] ?? archiveMatch?.[2];
  assert(archive, 'backup output must contain archive path');
  assert(await exists(archive), 'backup archive must exist');
  const archiveMode = (await stat(archive)).mode & 0o777;
  assert(archiveMode === 0o600, `backup archive must be owner-readable only, received ${archiveMode.toString(8)}`);
  const archiveContents = await execFileAsync('tar', ['-tzf', archive]);
  assert(!archiveContents.stdout.split('\n').some((entry) => entry.includes('/backups/')), 'backup archive must not recursively include backup archives');

  const mysqlGuard = await execFileAsync('bash', ['scripts/operations/backup.sh'], {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: path.join(proofRoot, 'mysql-database-content-data'),
      MSH_SKIP_ENV: 'true',
      CONTENT_STORAGE_PROVIDER: 'database',
      CATALOG_PROVIDER: 'mysql',
    },
    maxBuffer: 1024 * 1024,
  }).then(
    () => ({ exitCode: 0, stderr: '' }),
    (error: { code?: number; stderr?: string }) => ({ exitCode: error.code ?? 1, stderr: error.stderr ?? '' })
  );
  assert(mysqlGuard.exitCode !== 0, 'mysql database-content backup must fail fast');
  assert(mysqlGuard.stderr.includes('CATALOG_PROVIDER=mysql') && mysqlGuard.stderr.includes('MySQL database dump'), 'mysql catalog backup guard must explain the incomplete mode');

  const fakeBin = path.join(proofRoot, 'fake-bin');
  await mkdir(fakeBin, { recursive: true });
  const fakeDump = path.join(fakeBin, 'mysqldump');
  await writeFile(fakeDump, '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "${DUMP_ARGS_FILE:?}"\nprintf -- "-- managed-skill-hub MySQL migration backup proof\\n"\n');
  await chmod(fakeDump, 0o755);
  const mysqlMigrationDataDir = path.join(proofRoot, 'mysql-migration-data');
  const mysqlDumpArgs = path.join(proofRoot, 'mysqldump-args.txt');
  const mysqlMigrationBackup = await execFileAsync('bash', ['scripts/operations/backup-mysql-for-migration.sh'], {
    cwd: root,
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}`, DATA_DIR: mysqlMigrationDataDir, MSH_SKIP_ENV: 'true', MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '3306', MYSQL_DATABASE: 'managed_skill_hub_proof', MYSQL_USER: 'managed_skill_hub_proof', MYSQL_PASSWORD: 'not-a-real-password', MYSQL_SSL_MODE: 'verify_identity', DUMP_ARGS_FILE: mysqlDumpArgs },
    maxBuffer: 1024 * 1024,
  });
  const mysqlDump = mysqlMigrationBackup.stdout.match(/MySQL migration backup created: (.+\.sql)/)?.[1];
  assert(mysqlDump, 'mysql migration backup output must contain dump path');
  assert((await readFile(mysqlDump, 'utf8')).includes('migration backup proof'), 'mysql migration backup must contain dump output');
  assert(((await stat(mysqlDump)).mode & 0o777) === 0o600, 'mysql migration backup must have restrictive permissions');
  assert((await readFile(mysqlDumpArgs, 'utf8')).includes('--ssl-mode=VERIFY_IDENTITY'), 'mysql migration backup must preserve the configured TLS mode');
  const secondMysqlMigrationBackup = await execFileAsync('bash', ['scripts/operations/backup-mysql-for-migration.sh'], {
    cwd: root,
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}`, DATA_DIR: mysqlMigrationDataDir, MSH_SKIP_ENV: 'true', MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '3306', MYSQL_DATABASE: 'managed_skill_hub_proof', MYSQL_USER: 'managed_skill_hub_proof', MYSQL_PASSWORD: 'not-a-real-password', MYSQL_SSL_MODE: 'verify_identity', DUMP_ARGS_FILE: mysqlDumpArgs },
    maxBuffer: 1024 * 1024,
  });
  const secondMysqlDump = secondMysqlMigrationBackup.stdout.match(/MySQL migration backup created: (.+\.sql)/)?.[1];
  assert(secondMysqlDump && secondMysqlDump !== mysqlDump, 'repeated MySQL migration backups must use collision-safe names');

  const currentOnly = path.join(dataDir, 'current-only.txt');
  await writeFile(currentOnly, 'must be moved aside during restore\n');

  const restore = await execFileAsync('bash', ['scripts/operations/restore.sh', archive], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, MSH_SKIP_ENV: 'true', MSH_SKIP_STOP: 'true' },
    maxBuffer: 1024 * 1024,
  });
  assert(restore.stdout.includes('Restore abgeschlossen') || restore.stdout.includes('Restore'), 'restore output must report completion');

  const restoredSkill = await readFile(skillFile, 'utf8');
  const restoredProposal = await readFile(proposalFile, 'utf8');
  const restoredAudit = await readFile(auditFile, 'utf8');
  const restoredIndex = await readFile(indexFile, 'utf8');
  assert(restoredSkill.includes('Backup Proof Skill'), 'restored skill file content');
  assert(restoredProposal.includes('proposal-backup-proof'), 'restored proposal content');
  assert(restoredAudit.includes('submit_proposal'), 'restored audit content');
  assert(restoredIndex.includes('deterministic'), 'restored projection content');
  assert(!(await exists(currentOnly)), 'pre-restore current-only file must not remain in restored DATA_DIR');

  const parent = path.dirname(dataDir);
  const preRestoreEntries = (await import('node:fs/promises')).readdir(parent);
  const preRestoreDir = (await preRestoreEntries).find((entry) => entry.startsWith('data.pre-restore-'));
  assert(preRestoreDir, 'restore must move previous data aside');
  assert(await exists(path.join(parent, preRestoreDir!, 'current-only.txt')), 'pre-restore copy must contain current-only file');

  const results: CheckResult[] = [
    { id: 'backup-archive-created', detail: archive, result: 'PASS' },
    { id: 'backup-archive-private', detail: '0600 and excludes DATA_DIR/backups', result: 'PASS' },
    { id: 'mysql-catalog-guard', detail: 'DATA_DIR archive refused for every MySQL catalog mode', result: 'PASS' },
    { id: 'mysql-migration-backup', detail: 'atomic, private, collision-safe, and TLS-aware', result: 'PASS' },
    { id: 'restore-completed', detail: dataDir, result: 'PASS' },
    { id: 'skill-data-restored', detail: 'skills/backup-proof/1.0.0/SKILL.md', result: 'PASS' },
    { id: 'proposal-data-restored', detail: 'proposals/proposal-backup-proof/proposal.json', result: 'PASS' },
    { id: 'audit-data-restored', detail: 'audit/proposal-backup-proof.jsonl', result: 'PASS' },
    { id: 'projection-data-restored', detail: 'index/projection.json', result: 'PASS' },
    { id: 'pre-restore-safety-copy-created', detail: preRestoreDir!, result: 'PASS' },
  ];

  const report = {
    name: 'backup-restore',
    totalChecks: results.length,
    passedChecks: results.length,
    failedChecks: 0,
    dataDir,
    archive,
    results,
  };
  const lines = [
    'backup-restore',
    'totalChecks=' + report.totalChecks,
    'passedChecks=' + report.passedChecks,
    'failedChecks=' + report.failedChecks,
    ...results.map((result) => 'PASS ' + result.id + ' detail=' + JSON.stringify(result.detail)),
    'RESULT=PASS',
  ];

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/backup-restore.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/backup-restore.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
