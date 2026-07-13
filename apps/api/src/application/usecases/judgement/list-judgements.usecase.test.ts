import { describe, expect, it } from 'vitest';
import { ListJudgementsUseCase } from './list-judgements.usecase';
import { Proposal } from '../../../domain/proposal/Proposal';
import { ProposalFile } from '../../../domain/proposal/Proposal';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { Skill } from '../../../domain/skill/Skill';
import { Proposal as ProposalEntity } from '../../../domain/proposal/Proposal';

describe('ListJudgementsUseCase', () => {
  it('returns proposal judgements for a proposal target', async () => {
    const proposal = createProposalWithJudgements();
    const repo = new JudgementRepo([proposal]);
    const useCase = new ListJudgementsUseCase(repo, new JudgementAudit());

    const judgements = await useCase.execute('proposal', proposal.id);

    expect(judgements).toHaveLength(1);
    expect(judgements[0]?.targetType).toBe('proposal');
  });

  it('returns file judgements across proposals for a file target', async () => {
    const proposal = createProposalWithJudgements();
    const repo = new JudgementRepo([proposal]);
    const useCase = new ListJudgementsUseCase(repo, new JudgementAudit());

    const judgements = await useCase.execute('file', `${proposal.id}:README.md`);

    expect(judgements).toHaveLength(1);
    expect(judgements[0]?.targetType).toBe('file');
    expect(judgements[0]?.targetId).toBe(`${proposal.id}:README.md`);
  });

  it('returns stored skill judgements from audit entries', async () => {
    const targetId = 'how-to-create-a-skill:1.0.0';
    const repo = new JudgementRepo([]);
    const audit = new JudgementAudit([
      AuditEntry.create({
        skillId: 'how-to-create-a-skill',
        skillVersion: '1.0.0',
        action: 'judge_skill_version',
        actor: 'system',
        after: {
          targetId,
          judgement: {
            id: 'judge-skill',
            targetType: 'skill',
            targetId,
            dimensions: dimensions(),
            overallRisk: 'low',
            summary: 'skill judgement',
            model: 'custom-judger',
            createdAt: new Date('2026-07-01T00:00:00.000Z').toISOString(),
          },
        },
      }),
    ]);
    const useCase = new ListJudgementsUseCase(repo, audit);

    const judgements = await useCase.execute('skill', targetId);

    expect(judgements).toHaveLength(1);
    expect(judgements[0]?.targetType).toBe('skill');
    expect(judgements[0]?.targetId).toBe(targetId);
  });

  it('prefers sqlite-projected judgements when available', async () => {
    const proposal = createProposalWithJudgements();
    const repo = new JudgementRepo([proposal]);
    const catalog = new JudgementCatalog([
      {
        id: 'judge-proposal-catalog',
        targetType: 'proposal',
        targetId: proposal.id,
        proposalId: proposal.id,
        skillId: null,
        skillVersion: null,
        dimensions: dimensions(),
        overallRisk: 'low',
        summary: 'catalog judgement',
        model: 'sqlite-catalog',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    ]);
    const useCase = new ListJudgementsUseCase(repo, new JudgementAudit(), catalog);

    const judgements = await useCase.execute('proposal', proposal.id);

    expect(judgements).toHaveLength(1);
    expect(judgements[0]?.id).toBe('judge-proposal-catalog');
    expect(judgements[0]?.summary).toBe('catalog judgement');
  });

  it('treats empty sqlite judgement results as authoritative without repository fallback', async () => {
    const repo = new ThrowingJudgementRepo();
    const useCase = new ListJudgementsUseCase(repo, new ThrowingJudgementAudit(), new JudgementCatalog());

    const judgements = await useCase.execute('proposal', 'proposal-123');

    expect(judgements).toEqual([]);
  });
});

class JudgementRepo implements SkillRepositoryPort {
  constructor(private readonly proposals: Proposal[]) {}
  async save(): Promise<void> {}
  async findById(): Promise<null> {
    return null;
  }
  async findAll(): Promise<{ items: []; total: number }> {
    return { items: [], total: 0 };
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async saveProposal(): Promise<void> {}
  async findProposalById(id: string): Promise<Proposal | null> {
    return this.proposals.find((proposal) => proposal.id === id) ?? null;
  }
  async findProposals(): Promise<{ items: Proposal[]; total: number }> {
    return { items: this.proposals, total: this.proposals.length };
  }
  async deleteProposal(): Promise<void> {}
}

class ThrowingJudgementRepo extends JudgementRepo {
  constructor() {
    super([]);
  }

  override async findProposalById(): Promise<Proposal | null> {
    throw new Error('repository should not be used for catalog-backed empty judgement reads');
  }

  override async findProposals(): Promise<{ items: Proposal[]; total: number }> {
    throw new Error('repository should not be used for catalog-backed empty judgement reads');
  }
}

class JudgementAudit implements AuditLogPort {
  constructor(private readonly entries: AuditEntry[] = []) {}
  async append(): Promise<void> {}
  async findBySkillId(skillId: string): Promise<AuditEntry[]> {
    return this.entries.filter((entry) => entry.skillId === skillId);
  }
  async findByProposalId(): Promise<AuditEntry[]> {
    return [];
  }
  async findAll(): Promise<AuditEntry[]> {
    return this.entries;
  }
}

class ThrowingJudgementAudit extends JudgementAudit {
  override async findBySkillId(): Promise<AuditEntry[]> {
    throw new Error('audit should not be used for catalog-backed empty judgement reads');
  }
}

class JudgementCatalog implements SkillCatalogPort {
  constructor(private readonly judgements: Array<{
    id: string;
    targetType: 'proposal' | 'skill' | 'file';
    targetId: string;
    proposalId: string | null;
    skillId: string | null;
    skillVersion: string | null;
    dimensions: ReturnType<typeof dimensions>;
    overallRisk: string;
    summary: string;
    model: string | null;
    createdAt: Date;
  }> = []) {}
  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: ProposalEntity): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async upsertSkillJudgement(): Promise<void> {}
  async listJudgements(targetType: 'proposal' | 'skill' | 'file', targetId: string) {
    return this.judgements.filter((judgement) => judgement.targetType === targetType && judgement.targetId === targetId);
  }
  async upsertAuditEntry() {}
  async listSkillHistory() { return []; }
  async listProposals() { return { items: [], total: 0 }; }
  async getProposal() { return null; }
  async listProposalFiles() { return []; }
  async listProposalJudgements() { return []; }
  async countPendingProposals() { return 0; }
  async rebuild(_skills: Skill[]): Promise<void> {}
  async listCategories(): Promise<string[]> { return []; }
  async listLatestSkillVersions() { return { items: [], total: 0 }; }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getSkillVersion() { return null; }
  async getLatestVersion() { return null; }
  async getLatestPublishedVersion() { return null; }
  async listSkillVersions() { return []; }
  async listPublishedVersions() { return []; }
  async listVersionFiles() { return []; }
}

function createProposalWithJudgements(): Proposal {
  let proposal = Proposal.create({
    title: 'Judgement holder',
    description: 'Contains proposal and file judgements',
    category: 'automation',
    submittedBy: 'agent',
  });
  proposal = proposal.addFile(
    ProposalFile.create({
      id: 'README.md',
      path: 'README.md',
      mimeType: 'text/markdown',
      sizeBytes: 10,
      sha256: 'sha256',
    })
  );
  proposal = Proposal.rehydrate({
    id: proposal.id,
    skillId: proposal.skillId,
    title: proposal.title,
    description: proposal.description,
    category: proposal.category,
    tags: proposal.tags,
    capabilities: proposal.capabilities,
    entrypoint: proposal.entrypoint,
    files: proposal.files,
    judgements: [
      Judgement.create({
        id: 'judge-proposal',
        targetType: 'proposal',
        targetId: proposal.id,
        summary: 'proposal judgement',
        dimensions: dimensions(),
      }),
      Judgement.create({
        id: 'judge-file',
        targetType: 'file',
        targetId: `${proposal.id}:README.md`,
        summary: 'file judgement',
        dimensions: dimensions(),
      }),
    ],
    status: 'judged',
    submittedBy: proposal.submittedBy,
    createdAt: proposal.createdAt,
    rejectionReason: null,
  });
  return proposal;
}

function dimensions() {
  return {
    harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
    promptInjection: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
    dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
    policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
  };
}
