import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContainer } from '../../apps/api/src/infrastructure/container';
import type { AppConfig } from '../../apps/api/src/infrastructure/config';
import { createScriptAppConfig } from '../lib/script-app-config';

const execFileAsync = promisify(execFile);

function config(dataDir: string, storage: 'filesystem' | 'database'): AppConfig {
  return createScriptAppConfig({
    dataDir,
    registryId: 'migration-proof',
    registryName: 'Migration Proof',
    publicApiBaseUrl: 'https://migration.example.com/api',
    jwtSecret: 'migration-secret',
    contentStorageProvider: storage,
    proposalMaxFiles: 10,
    proposalMaxFileSizeBytes: 1024 * 1024,
    proposalDisallowedPaths: ['node_modules/'],
    autoPublishExcludedCategories: ['security'],
  });
}

async function exists(filePath: string): Promise<boolean> {
  try { await stat(filePath); return true; } catch { return false; }
}

async function main(): Promise<void> {
  const dataDir = path.resolve('.tmp/content-migration-data');
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  const source = await buildContainer(config(dataDir, 'filesystem'));
  try {
    await source.createSkill.createSkill({
      id: 'migration-proof-skill',
      title: 'Migration Proof Skill',
      description: 'Validates filesystem to database migration.',
      category: 'operations',
      tags: ['migration'],
      capabilities: ['proof'],
      entrypoint: 'SKILL.md',
      files: [{ path: 'SKILL.md', role: 'entrypoint', mimeType: 'text/markdown', content: Buffer.from('# Migration Proof\n') }],
    }, 'migration-admin');
    await source.reviewSkill.submitForReview('migration-proof-skill', '1.0.0', 'migration-admin');
    await source.reviewSkill.approve('migration-proof-skill', '1.0.0', 'migration-admin');
    await source.reviewSkill.publish('migration-proof-skill', '1.0.0', 'migration-admin');
    const proposal = await source.proposalCommand.submitProposal({
      title: 'Migration Proposal',
      description: 'Proposal that must survive migration.',
      category: 'operations',
      tags: ['migration'],
      capabilities: ['proof'],
      entrypoint: 'SKILL.md',
    }, 'migration-agent');
    await source.proposalCommand.attachFile(proposal.id, { path: 'SKILL.md', content: Buffer.from('# Proposal Migration\n'), mimeType: 'text/markdown' }, 'migration-agent');
    await source.rebuildProjections.execute('migration-admin', { clearProjections: true });
  } finally {
    await source.shutdown();
  }

  const beforeSourceFile = path.join(dataDir, 'skills', 'migration-proof-skill', '1.0.0', 'SKILL.md');
  if (!(await exists(beforeSourceFile))) {
    throw new Error('source filesystem skill file missing before migration');
  }

  await execFileAsync('./node_modules/.bin/tsx', ['scripts/content/migrate-content-to-database.ts'], {
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      JUDGER_PROVIDER: 'noop',
      CATALOG_PROVIDER: 'sqlite',
      SEARCH_PROVIDER: 'sqlite',
      CONTENT_STORAGE_PROVIDER: 'database',
    },
  });

  const target = await buildContainer(config(dataDir, 'database'));
  try {
    const skill = await target.skillRepository.findById('migration-proof-skill');
    if (!skill?.getLatestPublishedVersion()) throw new Error('migrated skill missing latest published version');
    const file = await target.fileStorage.readSkillFile('migration-proof-skill', '1.0.0', 'SKILL.md');
    if (file?.content.toString('utf8') !== '# Migration Proof\n') throw new Error('migrated skill file mismatch');
    const proposals = await target.skillRepository.findProposals();
    if (!proposals.items.some((proposal) => proposal.title === 'Migration Proposal')) throw new Error('migrated proposal missing');
    const audits = await target.auditLog.findBySkillId('migration-proof-skill');
    if (!audits.some((entry) => entry.action === 'publish')) throw new Error('migrated publish audit missing');
    const allAudits = await target.auditLog.findAll();
    if (!allAudits.some((entry) => entry.action === 'rebuild_projections' && entry.skillId === null && entry.proposalId === null)) throw new Error('migrated global audit missing');
  } finally {
    await target.shutdown();
  }

  if (!(await exists(beforeSourceFile))) {
    throw new Error('migration deleted source filesystem file');
  }

  const report = {
    name: 'content-migration',
    result: 'PASS',
    dataDir,
    sourceFilePreserved: true,
  };
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/content-migration.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/content-migration.log', 'content-migration\nRESULT=PASS\n');
  console.log('content-migration\nRESULT=PASS');
}

main().catch(async (error) => {
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/content-migration.log', 'RESULT=FAIL\n' + ((error as Error).stack ?? error) + '\n');
  console.error((error as Error).stack ?? error);
  process.exit(1);
});
