#!/usr/bin/env tsx
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContainer } from '../apps/api/src/infrastructure/container';
import type { AppConfig } from '../apps/api/src/infrastructure/config';

const execFileAsync = promisify(execFile);

function config(dataDir: string, storage: 'filesystem' | 'database'): AppConfig {
  return {
    dataDir,
    openapiYamlPath: path.resolve('packages/openapi/skill-registry.openapi.yaml'),
    registryId: 'export-proof',
    registryName: 'Export Proof',
    publicApiBaseUrl: 'https://export.example.com/api',
    apiHost: '127.0.0.1',
    apiPort: 3040,
    adminUser: 'admin',
    adminPassword: 'admin',
    adminPasswordHash: '',
    jwtSecret: 'export-secret',
    sessionTtlSeconds: 3600,
    judgerProvider: 'noop',
    judgerAdapterPath: null,
    vercelAiSdkModel: null,
    vercelAiSdkTimeoutMs: 30000,
    vercelAiSdkMaxTextChars: 12000,
    vercelAiSdkMaxRetries: 0,
    catalogProvider: 'sqlite',
    searchProvider: 'sqlite',
    contentStorageProvider: storage,
    mysqlHost: '127.0.0.1',
    mysqlPort: 3306,
    mysqlDatabase: 'managed_skill_hub',
    mysqlUser: 'managed_skill_hub',
    mysqlPassword: '',
    mysqlSslMode: 'preferred',
    mysqlConnectTimeoutMs: 10000,
    mysqlQueryTimeoutMs: 30000,
    proposalMaxFiles: 10,
    proposalMaxFileSizeBytes: 1024 * 1024,
    proposalDisallowedPaths: ['node_modules/'],
    autoPublishOnGreen: false,
    autoPublishExcludedCategories: ['security'],
    autoApproveWithoutJudger: false,
    publicReadAuthMode: 'none',
    publicReadBearerToken: null,
    publicReadBearerActor: 'read-agent',
    proposalAuthMode: 'none',
    proposalBearerToken: null,
    proposalBearerActor: 'proposal-agent',
    discoveryAuthMode: 'none',
    discoveryBearerToken: null,
    discoveryBearerActor: 'discovery-agent',
  };
}

async function exists(filePath: string): Promise<boolean> {
  try { await stat(filePath); return true; } catch { return false; }
}

async function main(): Promise<void> {
  const sourceDataDir = path.resolve('.tmp/content-export-source');
  const targetDataDir = path.resolve('.tmp/content-export-target');
  await rm(sourceDataDir, { recursive: true, force: true });
  await rm(targetDataDir, { recursive: true, force: true });
  await mkdir(sourceDataDir, { recursive: true });

  const source = await buildContainer(config(sourceDataDir, 'database'));
  let proposalId = "";
  try {
    await source.createSkill.createSkill({
      id: 'export-proof-skill',
      title: 'Export Proof Skill',
      description: 'Validates database to filesystem export.',
      category: 'operations',
      tags: ['export'],
      capabilities: ['proof'],
      entrypoint: 'SKILL.md',
      files: [
        { path: 'SKILL.md', role: 'entrypoint', mimeType: 'text/markdown', content: Buffer.from('# Export Proof\nSee docs/guide.md\n') },
        { path: 'docs/guide.md', role: 'knowledge', mimeType: 'text/markdown', content: Buffer.from('# Guide\n') },
      ],
    }, 'export-admin');
    await source.extractSkillFileContent.execute('export-proof-skill', 'SKILL.md', { version: '1.0.0', includeUnpublished: true });
    await source.reviewSkill.submitForReview('export-proof-skill', '1.0.0', 'export-admin');
    await source.reviewSkill.approve('export-proof-skill', '1.0.0', 'export-admin');
    await source.reviewSkill.publish('export-proof-skill', '1.0.0', 'export-admin');
    const proposal = await source.proposalCommand.submitProposal({
      title: 'Export Proposal',
      description: 'Proposal that must survive database to filesystem export.',
      category: 'operations',
      tags: ['export'],
      capabilities: ['proof'],
      entrypoint: 'SKILL.md',
    }, 'export-agent');
    proposalId = proposal.id;
    await source.proposalCommand.attachFile(proposal.id, { path: 'SKILL.md', content: Buffer.from('# Proposal Export\n'), mimeType: 'text/markdown' }, 'export-agent');
    await source.extractProposalFileContent.execute(proposal.id, 'SKILL.md');
    await source.rebuildProjections.execute('export-admin', { clearProjections: true });
  } finally {
    await source.shutdown();
  }

  if (await exists(path.join(sourceDataDir, 'skills'))) {
    throw new Error('database source unexpectedly created data/skills');
  }

  await execFileAsync('./node_modules/.bin/tsx', ['scripts/export-content-filesystem.ts'], {
    env: {
      ...process.env,
      DATA_DIR: sourceDataDir,
      CONTENT_EXPORT_DATA_DIR: targetDataDir,
      CONTENT_EXPORT_OVERWRITE: 'true',
      JUDGER_PROVIDER: 'noop',
      CATALOG_PROVIDER: 'sqlite',
      SEARCH_PROVIDER: 'sqlite',
      CONTENT_STORAGE_PROVIDER: 'database',
    },
  });

  const target = await buildContainer(config(targetDataDir, 'filesystem'));
  try {
    const skill = await target.skillRepository.findById('export-proof-skill');
    if (!skill?.getLatestPublishedVersion()) throw new Error('exported skill missing latest published version');
    const skillFile = await target.fileStorage.readSkillFile('export-proof-skill', '1.0.0', 'SKILL.md');
    if (skillFile?.content.toString('utf8') !== '# Export Proof\nSee docs/guide.md\n') throw new Error('exported skill file mismatch');
    const supportFile = await target.fileStorage.readSkillFile('export-proof-skill', '1.0.0', 'docs/guide.md');
    if (supportFile?.content.toString('utf8') !== '# Guide\n') throw new Error('exported nested skill file mismatch');
    const skillExtract = await target.fileStorage.readSkillFileExtract('export-proof-skill', '1.0.0', 'SKILL.md');
    if (!skillExtract?.text.includes('Export Proof')) throw new Error('exported skill extract missing');
    const proposal = await target.skillRepository.findProposalById(proposalId);
    if (!proposal || proposal.title !== 'Export Proposal') throw new Error('exported proposal missing');
    const proposalFile = await target.fileStorage.readProposalFile(proposalId, 'SKILL.md');
    if (proposalFile?.content.toString('utf8') !== '# Proposal Export\n') throw new Error('exported proposal file mismatch');
    const proposalExtract = await target.fileStorage.readProposalFileExtract(proposalId, 'SKILL.md');
    if (!proposalExtract?.text.includes('Proposal Export')) throw new Error('exported proposal extract missing');
    const audits = await target.auditLog.findAll();
    if (!audits.some((entry) => entry.action === 'publish' && entry.skillId === 'export-proof-skill')) throw new Error('exported skill audit missing');
    if (!audits.some((entry) => entry.action === 'rebuild_projections' && entry.skillId === null && entry.proposalId === null)) throw new Error('exported global audit missing');
  } finally {
    await target.shutdown();
  }

  const report = {
    name: 'content-export',
    result: 'PASS',
    sourceDataDir,
    targetDataDir,
    proposalId,
  };
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/content-export.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/content-export.log', 'content-export\nRESULT=PASS\n');
  console.log('content-export\nRESULT=PASS');
}

main().catch(async (error) => {
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/content-export.log', 'RESULT=FAIL\n' + ((error as Error).stack ?? error) + '\n');
  console.error((error as Error).stack ?? error);
  process.exit(1);
});
