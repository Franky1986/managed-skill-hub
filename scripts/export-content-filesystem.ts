#!/usr/bin/env tsx
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileSystemSkillRepository } from '../apps/api/src/adapters/outbound/persistence/filesystem/file-system.repository';
import { FileSystemSkillStorage } from '../apps/api/src/adapters/outbound/persistence/filesystem/file-system.storage';
import { FileSystemAuditLog } from '../apps/api/src/adapters/outbound/audit/filesystem/file-system.audit';
import { buildContainer } from '../apps/api/src/infrastructure/container';
import { loadConfig } from '../apps/api/src/infrastructure/config';

interface ExportReport {
  name: string;
  source: 'database';
  target: 'filesystem';
  sourceDataDir: string;
  targetDataDir: string;
  skills: number;
  skillVersions: number;
  skillFiles: number;
  skillExtracts: number;
  proposals: number;
  proposalFiles: number;
  proposalExtracts: number;
  auditEntries: number;
  notes: string[];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveTargetDataDir(sourceDataDir: string): string {
  const raw = process.env.CONTENT_EXPORT_DATA_DIR;
  if (!raw || !raw.trim()) {
    throw new Error('CONTENT_EXPORT_DATA_DIR is required and must point to a target filesystem data directory.');
  }
  const target = path.resolve(raw.trim());
  const source = path.resolve(sourceDataDir);
  if (target === source) {
    throw new Error('CONTENT_EXPORT_DATA_DIR must not equal DATA_DIR. Export writes to a separate directory.');
  }
  return target;
}

async function prepareTarget(targetDataDir: string): Promise<void> {
  if (await exists(targetDataDir)) {
    if (process.env.CONTENT_EXPORT_OVERWRITE !== 'true') {
      throw new Error('CONTENT_EXPORT_DATA_DIR already exists. Set CONTENT_EXPORT_OVERWRITE=true to replace it.');
    }
    await rm(targetDataDir, { recursive: true, force: true });
  }
  await mkdir(targetDataDir, { recursive: true });
}

async function main(): Promise<void> {
  const baseConfig = loadConfig();
  const sourceConfig = { ...baseConfig, contentStorageProvider: 'database' as const };
  const targetDataDir = resolveTargetDataDir(baseConfig.dataDir);
  await prepareTarget(targetDataDir);

  const source = await buildContainer(sourceConfig);
  const targetRepo = new FileSystemSkillRepository(targetDataDir);
  const targetStorage = new FileSystemSkillStorage(targetDataDir);
  const targetAudit = new FileSystemAuditLog(targetDataDir);

  const report: ExportReport = {
    name: 'export-content-filesystem',
    source: 'database',
    target: 'filesystem',
    sourceDataDir: path.resolve(baseConfig.dataDir),
    targetDataDir,
    skills: 0,
    skillVersions: 0,
    skillFiles: 0,
    skillExtracts: 0,
    proposals: 0,
    proposalFiles: 0,
    proposalExtracts: 0,
    auditEntries: 0,
    notes: [
      'Database content is copied into a separate filesystem data directory.',
      'The source database content is not deleted or modified.',
    ],
  };

  try {
    const { items: skills } = await source.skillRepository.findAll();
    for (const skill of skills) {
      await targetRepo.save(skill);
      report.skills += 1;
      for (const version of skill.getAllVersions()) {
        report.skillVersions += 1;
        const files = await source.fileStorage.listSkillFiles(skill.id.toString(), version.version);
        for (const file of files) {
          const stored = await source.fileStorage.readSkillFile(skill.id.toString(), version.version, file.path);
          if (!stored) continue;
          await targetStorage.storeSkillFile(skill.id.toString(), version.version, file.path, stored.content, stored.mimeType);
          report.skillFiles += 1;
          const extract = await source.fileStorage.readSkillFileExtract(skill.id.toString(), version.version, file.path);
          if (extract) {
            await targetStorage.storeSkillFileExtract(skill.id.toString(), version.version, file.path, extract);
            report.skillExtracts += 1;
          }
        }
      }
      await targetRepo.save(skill);
    }

    const { items: proposals } = await source.skillRepository.findProposals();
    for (const proposal of proposals) {
      await targetRepo.saveProposal(proposal);
      report.proposals += 1;
      const files = await source.fileStorage.listProposalFiles(proposal.id);
      for (const file of files) {
        const stored = await source.fileStorage.readProposalFile(proposal.id, file.path);
        if (!stored) continue;
        await targetStorage.storeProposalFile(proposal.id, file.path, stored.content, stored.mimeType);
        report.proposalFiles += 1;
        const extract = await source.fileStorage.readProposalFileExtract(proposal.id, file.path);
        if (extract) {
          await targetStorage.storeProposalFileExtract(proposal.id, file.path, extract);
          report.proposalExtracts += 1;
        }
      }
      await targetRepo.saveProposal(proposal);
    }

    for (const entry of await source.auditLog.findAll()) {
      await targetAudit.append(entry);
      report.auditEntries += 1;
    }
  } finally {
    await source.shutdown();
  }

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/export-content-filesystem.json', JSON.stringify(report, null, 2) + '\n');
  const lines = [
    'export-content-filesystem',
    'sourceDataDir=' + report.sourceDataDir,
    'targetDataDir=' + report.targetDataDir,
    'skills=' + report.skills,
    'skillVersions=' + report.skillVersions,
    'skillFiles=' + report.skillFiles,
    'proposals=' + report.proposals,
    'proposalFiles=' + report.proposalFiles,
    'auditEntries=' + report.auditEntries,
    'RESULT=PASS',
  ];
  await writeFile('.tmp/export-content-filesystem.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch(async (error) => {
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/export-content-filesystem.log', 'RESULT=FAIL\n' + ((error as Error).stack ?? error) + '\n');
  console.error((error as Error).stack ?? error);
  process.exit(1);
});
