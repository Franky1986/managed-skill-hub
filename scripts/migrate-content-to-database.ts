import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileSystemSkillRepository } from '../apps/api/src/adapters/outbound/persistence/filesystem/file-system.repository';
import { FileSystemSkillStorage } from '../apps/api/src/adapters/outbound/persistence/filesystem/file-system.storage';
import { FileSystemAuditLog } from '../apps/api/src/adapters/outbound/audit/filesystem/file-system.audit';
import { buildContainer } from '../apps/api/src/infrastructure/container';
import { loadConfig } from '../apps/api/src/infrastructure/config';

interface MigrationReport {
  name: string;
  source: 'filesystem';
  target: 'database';
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

async function main(): Promise<void> {
  const baseConfig = loadConfig();
  const targetConfig = { ...baseConfig, contentStorageProvider: 'database' as const };
  const sourceRepo = new FileSystemSkillRepository(baseConfig.dataDir);
  const sourceStorage = new FileSystemSkillStorage(baseConfig.dataDir);
  const sourceAudit = new FileSystemAuditLog(baseConfig.dataDir);
  const target = await buildContainer(targetConfig);

  const report: MigrationReport = {
    name: 'migrate-content-to-database',
    source: 'filesystem',
    target: 'database',
    skills: 0,
    skillVersions: 0,
    skillFiles: 0,
    skillExtracts: 0,
    proposals: 0,
    proposalFiles: 0,
    proposalExtracts: 0,
    auditEntries: 0,
    notes: [
      'Source filesystem content is copied, not deleted.',
      'All audit entries exposed by AuditLogPort.findAll() are copied, including global entries.',
    ],
  };

  try {
    const { items: skills } = await sourceRepo.findAll();
    for (const skill of skills) {
      await target.skillRepository.save(skill);
      report.skills += 1;
      for (const version of skill.getAllVersions()) {
        report.skillVersions += 1;
        const files = await sourceStorage.listSkillFiles(skill.id.toString(), version.version);
        for (const file of files) {
          const stored = await sourceStorage.readSkillFile(skill.id.toString(), version.version, file.path);
          if (!stored) continue;
          await target.fileStorage.storeSkillFile(skill.id.toString(), version.version, file.path, stored.content, stored.mimeType);
          report.skillFiles += 1;
          const extract = await sourceStorage.readSkillFileExtract(skill.id.toString(), version.version, file.path);
          if (extract) {
            await target.fileStorage.storeSkillFileExtract(skill.id.toString(), version.version, file.path, extract);
            report.skillExtracts += 1;
          }
        }
      }
      await target.skillRepository.save(skill);
    }

    for (const entry of await sourceAudit.findAll()) {
      await target.auditLog.append(entry);
      report.auditEntries += 1;
    }

    const { items: proposals } = await sourceRepo.findProposals();
    for (const proposal of proposals) {
      await target.skillRepository.saveProposal(proposal);
      report.proposals += 1;
      const files = await sourceStorage.listProposalFiles(proposal.id);
      for (const file of files) {
        const stored = await sourceStorage.readProposalFile(proposal.id, file.path);
        if (!stored) continue;
        await target.fileStorage.storeProposalFile(proposal.id, file.path, stored.content, stored.mimeType);
        report.proposalFiles += 1;
        const extract = await sourceStorage.readProposalFileExtract(proposal.id, file.path);
        if (extract) {
          await target.fileStorage.storeProposalFileExtract(proposal.id, file.path, extract);
          report.proposalExtracts += 1;
        }
      }
      await target.skillRepository.saveProposal(proposal);
    }
  } finally {
    await target.shutdown();
  }

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/migrate-content-to-database.json', JSON.stringify(report, null, 2) + '\n');
  const lines = [
    'migrate-content-to-database',
    'skills=' + report.skills,
    'skillVersions=' + report.skillVersions,
    'skillFiles=' + report.skillFiles,
    'proposals=' + report.proposals,
    'proposalFiles=' + report.proposalFiles,
    'auditEntries=' + report.auditEntries,
    'RESULT=PASS',
  ];
  await writeFile('.tmp/migrate-content-to-database.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));

}

main().catch(async (error) => {
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/migrate-content-to-database.log', 'RESULT=FAIL\n' + ((error as Error).stack ?? error) + '\n');
  console.error((error as Error).stack ?? error);
  process.exit(1);
});
