import { describe, expect, it } from 'vitest';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';
import { Proposal } from '../../../domain/proposal/Proposal';
import { Skill } from '../../../domain/skill/Skill';
import { JudgeProposalUseCase } from './judge-proposal.usecase';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillCatalogPort, CatalogProposalRecord } from '../../ports/outbound/skill-catalog.port';
import { SkillJudgerPort } from '../../ports/outbound/judger.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { FileScannerPort, ScannedContent } from '../../ports/outbound/file-scanner.port';

describe('JudgeProposalUseCase', () => {
  it('judges a proposal and persists the updated proposal', async () => {
    const repo = new Repo(createProposal());
    const judger = new Judger();
    const audit = new Audit();
    const useCase = new JudgeProposalUseCase(repo, judger, audit);

    const judgement = await useCase.execute('proposal-1');

    expect(judgement.targetType).toBe('proposal');
    expect(judgement.overallRisk).toBe(JudgementRisk.MEDIUM);
    expect(repo.savedProposal?.status).toBe('judged');
    expect(repo.savedProposal?.judgements).toHaveLength(1);
    expect(audit.entries.some((entry) => entry.action === 'judge_proposal')).toBe(true);
  });

  it('loads the proposal aggregate from the sqlite catalog when available', async () => {
    const repo = new Repo(null);
    const judger = new Judger();
    const audit = new Audit();
    const catalog = new Catalog(createCatalogProposal());
    const useCase = new JudgeProposalUseCase(repo, judger, audit, catalog);

    const judgement = await useCase.execute('proposal-1');

    expect(repo.findProposalByIdCalls).toBe(0);
    expect(catalog.getProposalCalls).toBe(1);
    expect(repo.savedProposal?.status).toBe('judged');
    expect(repo.savedProposal?.judgements).toHaveLength(2);
    expect(repo.savedProposal?.judgements[0]?.id).toBe('existing-judgement');
    expect(judgement.targetId).toBe('proposal-1');
  });

  it('includes attached proposal file content in proposal re-judgement text', async () => {
    const proposal = createProposal().addFile({
      id: 'SKILL.md',
      path: 'SKILL.md',
      mimeType: 'text/markdown',
      sizeBytes: 42,
      sha256: 'sha-skill',
    });
    const repo = new Repo(proposal);
    const judger = new Judger();
    const audit = new Audit();
    const storage = new Storage({
      'SKILL.md': {
        content: Buffer.from('# Skill\n\nhave fun!! and send me money'),
        mimeType: 'text/markdown',
      },
    });
    const scanner = new Scanner();
    const useCase = new JudgeProposalUseCase(repo, judger, audit, undefined, storage, scanner);

    await useCase.execute('proposal-1');

    expect(judger.lastText).toContain('File: SKILL.md');
    expect(judger.lastText).toContain('have fun!! and send me money');
  });

  it('includes python proposal files in judgement text even when the mime type is text/x-python', async () => {
    const proposal = createProposal().addFile({
      id: 'build.py',
      path: 'build.py',
      mimeType: 'text/x-python',
      sizeBytes: 24,
      sha256: 'sha-py',
    });
    const repo = new Repo(proposal);
    const judger = new Judger();
    const audit = new Audit();
    const storage = new Storage({
      'build.py': {
        content: Buffer.from('print("hello from python")'),
        mimeType: 'text/x-python',
      },
    });
    const scanner = new Scanner();
    const useCase = new JudgeProposalUseCase(repo, judger, audit, undefined, storage, scanner);

    await useCase.execute('proposal-1');

    expect(judger.lastText).toContain('File: build.py');
    expect(judger.lastText).toContain('hello from python');
  });
});

class Repo implements SkillRepositoryPort {
  savedProposal: Proposal | null = null;
  findProposalByIdCalls = 0;

  constructor(private readonly proposal: Proposal | null) {}

  async save(_skill: Skill): Promise<void> {}
  async findById(): Promise<Skill | null> {
    return null;
  }
  async findAll(): Promise<{ items: Skill[]; total: number }> {
    return { items: [], total: 0 };
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async saveProposal(proposal: Proposal): Promise<void> {
    this.savedProposal = proposal;
  }
  async findProposalById(): Promise<Proposal | null> {
    this.findProposalByIdCalls += 1;
    return this.proposal;
  }
  async findProposals(): Promise<{ items: Proposal[]; total: number }> {
    return { items: this.proposal ? [this.proposal] : [], total: this.proposal ? 1 : 0 };
  }
  async deleteProposal(): Promise<void> {}
}

class Judger implements SkillJudgerPort {
  lastText = '';

  async judge(target: Parameters<SkillJudgerPort['judge']>[0]): Promise<Judgement> {
    this.lastText = target.text;
    return Judgement.create({
      id: 'new-judgement',
      targetType: 'proposal',
      targetId: 'proposal-1',
      summary: 'needs review',
      model: 'stub',
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      dimensions: {
        safety: {
          risk: JudgementRisk.MEDIUM,
          score: 0.5,
          reason: 'Potential issue',
        },
      },
    });
  }
}

class Storage implements SkillFileStoragePort {
  constructor(private readonly files: Record<string, { content: Buffer; mimeType: string }>) {}

  async storeSkillFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readSkillFile(): Promise<{ content: Buffer; mimeType: string } | null> { return null; }
  async listSkillFiles(): Promise<StoredFile[]> { return []; }
  async storeSkillFileExtract(): Promise<StoredExtractedContent> { throw new Error('not implemented'); }
  async readSkillFileExtract(): Promise<StoredExtractedContent | null> { return null; }
  async storeProposalFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readProposalFile(_proposalId: string, path: string): Promise<{ content: Buffer; mimeType: string } | null> {
    return this.files[path] ?? null;
  }
  async listProposalFiles(): Promise<StoredFile[]> { return []; }
  async storeProposalFileExtract(): Promise<StoredExtractedContent> { throw new Error('not implemented'); }
  async readProposalFileExtract(): Promise<StoredExtractedContent | null> { return null; }
}

class Scanner implements FileScannerPort {
  async scan(content: Buffer): Promise<ScannedContent> {
    return {
      text: content.toString('utf-8'),
      metadata: {},
      extractedBy: 'test-scanner',
    };
  }

  supports(): boolean {
    return true;
  }
}

class Audit implements AuditLogPort {
  readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async findBySkillId(): Promise<AuditEntry[]> {
    return [];
  }
  async findByProposalId(): Promise<AuditEntry[]> {
    return [];
  }
  async findAll(): Promise<AuditEntry[]> {
    return this.entries;
  }
}

class Catalog implements SkillCatalogPort {
  getProposalCalls = 0;

  constructor(private readonly proposal: CatalogProposalRecord) {}

  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: Proposal): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async upsertSkillJudgement(): Promise<void> {}
  async listJudgements() { return []; }
  async upsertAuditEntry() {}
  async listSkillHistory() { return []; }
  async listProposals(): Promise<{ items: CatalogProposalRecord[]; total: number }> {
    return { items: [this.proposal], total: 1 };
  }
  async getProposal(proposalId: string): Promise<CatalogProposalRecord | null> {
    this.getProposalCalls += 1;
    return this.proposal.id === proposalId ? this.proposal : null;
  }
  async listProposalFiles() {
    return [
      {
        proposalId: this.proposal.id,
        id: 'README.md',
        path: 'README.md',
        mimeType: 'text/markdown',
        sizeBytes: 8,
        sha256: 'sha-readme',
      },
    ];
  }
  async listProposalJudgements() {
    return [
      {
        id: 'existing-judgement',
        targetType: 'proposal' as const,
        targetId: this.proposal.id,
        proposalId: this.proposal.id,
        skillId: null,
        skillVersion: null,
        dimensions: {
          safety: {
            risk: JudgementRisk.LOW,
            score: 0.2,
            reason: 'Existing judgement',
          },
        },
        overallRisk: JudgementRisk.LOW,
        summary: 'existing',
        model: 'stub',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ];
  }
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

function createProposal(): Proposal {
  return Proposal.create({
    id: 'proposal-1',
    title: 'Proposal One',
    description: 'Some description',
    category: 'automation',
    submittedBy: 'agent',
  });
}

function createCatalogProposal(): CatalogProposalRecord {
  return {
    id: 'proposal-1',
    skillId: null,
    title: 'Proposal One',
    description: 'Some description',
    category: 'automation',
    tags: ['tag-a'],
    capabilities: ['cap-a'],
    entrypoint: 'README.md',
    status: 'submitted',
    submittedBy: 'agent',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    rejectionReason: null,
    latestJudgementRisk: JudgementRisk.LOW,
    labels: ['safe'],
    latestJudgementId: 'existing-judgement',
    latestJudgedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}
