import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { FileSystemAuditLog } from './file-system.audit';
import { AuditEntry } from '../../../../domain/audit/AuditEntry';
import { SkillCatalogPort, CatalogAuditEntryRecord } from '../../../../application/ports/outbound/skill-catalog.port';
import { Skill } from '../../../../domain/skill/Skill';
import { Proposal } from '../../../../domain/proposal/Proposal';
import { Judgement } from '../../../../domain/judgement/Judgement';

describe('FileSystemAuditLog', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('mirrors appended skill audit entries into the sqlite catalog projection', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-audit-'));
    tempDirs.push(dataDir);
    const catalog = new CatalogStub();
    const audit = new FileSystemAuditLog(dataDir, catalog);
    const entry = AuditEntry.create({
      id: 'audit-1',
      skillId: 'history-skill',
      skillVersion: '1.0.0',
      action: 'publish_skill',
      actor: 'admin',
      after: { status: 'published' },
      createdAt: new Date('2026-07-02T12:00:00.000Z'),
    });

    await audit.append(entry);

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]?.id).toBe('audit-1');
    const loaded = await audit.findBySkillId('history-skill');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.action).toBe('publish_skill');
  });
  it('enumerates skill, proposal, and global audit entries in deterministic order', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-audit-'));
    tempDirs.push(dataDir);
    const audit = new FileSystemAuditLog(dataDir);
    await audit.append(AuditEntry.create({
      id: 'audit-skill',
      skillId: 'history-skill',
      skillVersion: '1.0.0',
      action: 'publish',
      actor: 'admin',
      createdAt: new Date('2026-07-02T12:00:00.000Z'),
    }));
    await audit.append(AuditEntry.create({
      id: 'audit-global',
      action: 'rebuild_projections',
      actor: 'admin',
      createdAt: new Date('2026-07-02T12:00:01.000Z'),
    }));
    await audit.append(AuditEntry.create({
      id: 'audit-proposal',
      proposalId: 'proposal-1',
      action: 'submit_proposal',
      actor: 'agent',
      createdAt: new Date('2026-07-02T12:00:02.000Z'),
    }));

    const loaded = await audit.findAll();

    expect(loaded.map((entry) => entry.id)).toEqual(['audit-skill', 'audit-global', 'audit-proposal']);
    expect(loaded.find((entry) => entry.id === 'audit-global')?.skillId).toBeNull();
    expect(loaded.find((entry) => entry.id === 'audit-global')?.proposalId).toBeNull();
  });
});

class CatalogStub implements SkillCatalogPort {
  readonly entries: CatalogAuditEntryRecord[] = [];

  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: Proposal): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async upsertSkillJudgement(_skillId: string, _version: string, _judgement: Judgement): Promise<void> {}
  async listJudgements() { return []; }
  async upsertAuditEntry(entry: AuditEntry): Promise<void> {
    this.entries.push({
      id: entry.id,
      skillId: entry.skillId,
      skillVersion: entry.skillVersion,
      proposalId: entry.proposalId,
      action: entry.action,
      actor: entry.actor,
      before: entry.before,
      after: entry.after,
      createdAt: entry.createdAt,
    });
  }
  async listSkillHistory(): Promise<CatalogAuditEntryRecord[]> { return this.entries; }
  async listProposals() { return { items: [], total: 0 }; }
  async getProposal() { return null; }
  async listProposalFiles() { return []; }
  async listProposalJudgements() { return []; }
  async countPendingProposals() { return 0; }
  async countProposalsByStatus(): Promise<Record<ProposalStatus, number>> {
    return { in_upload: 0, submitted: 0, judged: 0, converted: 0 };
  }
  async rebuild(_skills: Skill[]): Promise<void> {}
  async listCategories(): Promise<string[]> { return []; }
  async listLatestSkillVersions() { return { items: [], total: 0 }; }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getLatestVersion() { return null; }
  async getLatestPublishedVersion() { return null; }
  async listSkillVersions() { return []; }
  async listPublishedVersions() { return []; }
  async listVersionFiles() { return []; }
}
