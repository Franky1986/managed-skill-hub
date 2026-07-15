import { describe, expect, it } from 'vitest';
import { ReviewProposalUseCase } from './review-proposal.usecase';
import { Proposal } from '../../../domain/proposal/Proposal';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { CreateSkillUseCase } from '../skill/create-skill.usecase';
import { JudgeSkillVersionUseCase } from '../judgement/judge-skill-version.usecase';
import { Skill } from '../../../domain/skill/Skill';
import { Manifest } from '../../../domain/skill/Manifest';
import { SkillId } from '../../../domain/skill/SkillId';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { CatalogProposalRecord, CatalogSkillVersionRecord, SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';

describe('ReviewProposalUseCase', () => {
  it('rejects a proposal and persists the new status', async () => {
    const repo = new ReviewRepo();
    const storage = new ReviewStorage();
    const audit = new ReviewAudit();
    const createSkill = new StubCreateSkillUseCase();
    const useCase = new ReviewProposalUseCase(repo, storage, audit, createSkill);

    const proposal = Proposal.create({
      title: 'Proposal to reject',
      description: 'Needs more work',
      category: 'automation',
      submittedBy: 'agent',
    }).finalizeUpload();
    await repo.saveProposal(proposal);

    const rejected = await useCase.rejectProposal(proposal.id, 'admin', 'insufficient quality');

    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toBe('insufficient quality');
    expect((await repo.findProposalById(proposal.id))?.status).toBe('rejected');
    expect(audit.entries.some((entry) => entry.action === 'reject_proposal')).toBe(true);
  });

  it('converts a proposal into a new draft skill and marks the proposal converted', async () => {
    const repo = new ReviewRepo();
    const storage = new ReviewStorage();
    const audit = new ReviewAudit();
    const createSkill = new StubCreateSkillUseCase();
    const judgeSkillVersion = new StubJudgeSkillVersionUseCase();
    const useCase = new ReviewProposalUseCase(repo, storage, audit, createSkill, judgeSkillVersion);

    let proposal = Proposal.create({
      title: 'Create Skill From Proposal',
      description: 'This should become a skill',
      category: 'automation',
      entrypoint: 'README.md',
      submittedBy: 'agent',
    });
    proposal = proposal.addFile({
      id: 'README.md',
      path: 'README.md',
      mimeType: 'text/markdown',
      sizeBytes: 8,
      sha256: null,
    });
    proposal = proposal.finalizeUpload();
    await repo.saveProposal(proposal);
    storage.files.set(`${proposal.id}:README.md`, { content: Buffer.from('# Skill'), mimeType: 'text/markdown' });

    const skill = await useCase.convertProposal(proposal.id, 'admin');

    expect(skill.id.toString()).toBe('create-skill-from-proposal');
    expect(skill.getAllVersions()).toHaveLength(1);
    expect(skill.getAllVersions()[0]?.status).toBe(SkillStatus.DRAFT);
    expect((await repo.findProposalById(proposal.id))?.status).toBe('converted');
    expect(judgeSkillVersion.calls).toHaveLength(1);
    expect(judgeSkillVersion.calls[0]?.version).toBe('1.0.0');
    expect(audit.entries.some((entry) => entry.action === 'convert_proposal')).toBe(true);
  });

  it('converts a proposal with existing skillId into a new draft skill version', async () => {
    const repo = new ReviewRepo();
    const storage = new ReviewStorage();
    const audit = new ReviewAudit();
    const createSkill = new StubCreateSkillUseCase();
    const judgeSkillVersion = new StubJudgeSkillVersionUseCase();
    const useCase = new ReviewProposalUseCase(repo, storage, audit, createSkill, judgeSkillVersion);

    const existingSkill = createExistingSkill('existing-skill');
    await repo.save(existingSkill);

    let proposal = Proposal.create({
      skillId: 'existing-skill',
      title: 'Existing skill proposal',
      description: 'Should become 1.0.1',
      category: 'automation',
      entrypoint: 'README.md',
      submittedBy: 'agent',
    });
    proposal = proposal.addFile({
      id: 'README.md',
      path: 'README.md',
      mimeType: 'text/markdown',
      sizeBytes: 8,
      sha256: null,
    });
    proposal = proposal.finalizeUpload();
    await repo.saveProposal(proposal);
    storage.files.set(`${proposal.id}:README.md`, { content: Buffer.from('# Skill v2'), mimeType: 'text/markdown' });

    const skill = await useCase.convertProposal(proposal.id, 'admin');

    expect(skill.id.toString()).toBe('existing-skill');
    expect(skill.getAllVersions()).toHaveLength(2);
    expect(skill.getAllVersions()[1]?.version).toBe('1.0.1');
    expect(skill.getAllVersions()[1]?.status).toBe(SkillStatus.DRAFT);
    expect(judgeSkillVersion.calls).toHaveLength(1);
    expect(judgeSkillVersion.calls[0]?.version).toBe('1.0.1');
    expect(audit.entries.some((entry) => entry.action === 'create_skill_version_from_proposal')).toBe(true);
  });

  it('loads an existing target skill for proposal conversion from the sqlite catalog when available', async () => {
    const repo = new ReviewRepo();
    const storage = new ReviewStorage();
    const audit = new ReviewAudit();
    const createSkill = new StubCreateSkillUseCase();
    const catalog = new ReviewCatalog(createCatalogVersion('existing-skill'));
    const judgeSkillVersion = new StubJudgeSkillVersionUseCase();
    const useCase = new ReviewProposalUseCase(repo, storage, audit, createSkill, judgeSkillVersion, catalog);

    let proposal = Proposal.create({
      skillId: 'existing-skill',
      title: 'Existing skill proposal',
      description: 'Should become 1.0.1',
      category: 'automation',
      entrypoint: 'README.md',
      submittedBy: 'agent',
    });
    proposal = proposal.addFile({
      id: 'README.md',
      path: 'README.md',
      mimeType: 'text/markdown',
      sizeBytes: 8,
      sha256: null,
    });
    proposal = proposal.finalizeUpload();
    await repo.saveProposal(proposal);
    storage.files.set(`${proposal.id}:README.md`, { content: Buffer.from('# Skill v2'), mimeType: 'text/markdown' });

    const skill = await useCase.convertProposal(proposal.id, 'admin');

    expect(repo.findByIdCalls).toBe(0);
    expect(catalog.listSkillVersionsCalls).toBe(1);
    expect(skill.id.toString()).toBe('existing-skill');
    expect(skill.getAllVersions()).toHaveLength(2);
    expect(skill.getAllVersions()[1]?.version).toBe('1.0.1');
  });

  it('falls back to the sqlite catalog for reject when the repository has no proposal aggregate', async () => {
    const repo = new ReviewRepo();
    const storage = new ReviewStorage();
    const audit = new ReviewAudit();
    const createSkill = new StubCreateSkillUseCase();
    const catalog = new ReviewCatalog(createCatalogVersion('existing-skill'), createCatalogProposal('proposal-1'));
    const judgeSkillVersion = new StubJudgeSkillVersionUseCase();
    const useCase = new ReviewProposalUseCase(repo, storage, audit, createSkill, judgeSkillVersion, catalog);

    const rejected = await useCase.rejectProposal('proposal-1', 'admin', 'insufficient quality');

    expect(repo.findProposalByIdCalls).toBe(1);
    expect(catalog.getProposalCalls).toBe(1);
    expect(rejected.status).toBe('rejected');
    expect(rejected.judgements).toHaveLength(1);
    expect((await repo.findProposalById('proposal-1'))?.status).toBe('rejected');
  });

  it('audits a duplicate warning during conversion but still converts the proposal', async () => {
    const repo = new ReviewRepo();
    const storage = new ReviewStorage();
    const audit = new ReviewAudit();
    const createSkill = new StubCreateSkillUseCase();
    const catalog = new ReviewCatalog(createCatalogVersion('existing-skill'));
    catalog.findPublishedSkillByContentDigest = async () => ({ skillId: 'existing-skill', version: '1.0.0' });
    const judgeSkillVersion = new StubJudgeSkillVersionUseCase();
    const useCase = new ReviewProposalUseCase(repo, storage, audit, createSkill, judgeSkillVersion, catalog);

    let proposal = Proposal.create({
      title: 'Create Skill From Proposal',
      description: 'This should become a skill',
      category: 'automation',
      entrypoint: 'README.md',
      submittedBy: 'agent',
    });
    proposal = proposal.addFile({
      id: 'README.md',
      path: 'README.md',
      mimeType: 'text/markdown',
      sizeBytes: 8,
      sha256: null,
    });
    proposal = proposal.finalizeUpload();
    proposal = Proposal.rehydrate({
      ...proposal,
      contentDigest: 'duplicate-digest',
    });
    await repo.saveProposal(proposal);
    storage.files.set(`${proposal.id}:README.md`, { content: Buffer.from('# Skill'), mimeType: 'text/markdown' });

    const skill = await useCase.convertProposal(proposal.id, 'admin');

    expect(skill.id.toString()).toBe('create-skill-from-proposal');
    expect(audit.entries.some((entry) => entry.action === 'convert_proposal_duplicate_warning')).toBe(true);
    expect(audit.entries.find((entry) => entry.action === 'convert_proposal_duplicate_warning')?.after).toMatchObject({
      type: 'duplicate_skill',
      duplicateSkillId: 'existing-skill',
    });
  });
});

class ReviewRepo implements SkillRepositoryPort {
  readonly proposals = new Map<string, Proposal>();
  readonly skills = new Map<string, Skill>();
  findByIdCalls = 0;
  findProposalByIdCalls = 0;

  async save(skill: Skill): Promise<void> {
    this.skills.set(skill.id.toString(), skill);
  }
  async findById(id: string): Promise<Skill | null> {
    this.findByIdCalls += 1;
    return this.skills.get(id) ?? null;
  }
  async findAll(): Promise<{ items: Skill[]; total: number }> {
    const items = [...this.skills.values()];
    return { items, total: items.length };
  }
  async exists(id: string): Promise<boolean> {
    return this.skills.has(id);
  }
  async saveProposal(proposal: Proposal): Promise<void> {
    this.proposals.set(proposal.id, proposal);
  }
  async findProposalById(id: string): Promise<Proposal | null> {
    this.findProposalByIdCalls += 1;
    return this.proposals.get(id) ?? null;
  }
  async findProposals(): Promise<{ items: Proposal[]; total: number }> {
    const items = [...this.proposals.values()];
    return { items, total: items.length };
  }
  async deleteProposal(id: string): Promise<void> {
    this.proposals.delete(id);
  }
}

class ReviewStorage implements SkillFileStoragePort {
  readonly files = new Map<string, { content: Buffer; mimeType: string }>();

  async storeSkillFile(skillId: string, version: string, path: string, content: Buffer, mimeType: string): Promise<StoredFile> {
    this.files.set(`${skillId}:${version}:${path}`, { content, mimeType });
    return { path, mimeType, sizeBytes: content.length, sha256: 'sha256', updatedAt: new Date('2026-07-02T00:00:00.000Z') };
  }
  async readSkillFile(): Promise<null> {
    return null;
  }
  async listSkillFiles(): Promise<StoredFile[]> {
    return [];
  }
  async storeSkillFileExtract(): Promise<StoredExtractedContent> {
    throw new Error('not implemented');
  }
  async readSkillFileExtract(): Promise<StoredExtractedContent | null> {
    return null;
  }
  async storeProposalFile(proposalId: string, path: string, content: Buffer, mimeType: string): Promise<StoredFile> {
    this.files.set(`${proposalId}:${path}`, { content, mimeType });
    return { path, mimeType, sizeBytes: content.length, sha256: 'sha256', updatedAt: new Date('2026-07-02T00:00:00.000Z') };
  }
  async readProposalFile(proposalId: string, path: string): Promise<{ content: Buffer; mimeType: string } | null> {
    return this.files.get(`${proposalId}:${path}`) ?? null;
  }
  async listProposalFiles(): Promise<StoredFile[]> {
    return [];
  }
}

class ReviewAudit implements AuditLogPort {
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

class StubJudgeSkillVersionUseCase extends JudgeSkillVersionUseCase {
  readonly calls: Array<{ skillId: string; version: string; contextText?: string; actor?: string }> = [];

  constructor() {
    const repo = new ReviewRepo();
    const audit = new ReviewAudit();
    super(
      repo,
      {
        async judge() {
          return Judgement.create({
            targetType: 'skill',
            targetId: 'stub:version',
            dimensions: {
              harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'stub' },
              promptInjection: { risk: JudgementRisk.LOW, score: 0, reason: 'stub' },
              dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'stub' },
              policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'stub' },
            },
          });
        },
      },
      audit
    );
  }

  override async execute(
    skillId: string,
    version: string,
    options?: { contextText?: string; contextMetadata?: Record<string, unknown>; actor?: string }
  ) {
    this.calls.push({
      skillId,
      version,
      contextText: options?.contextText,
      actor: options?.actor,
    });
    return {
      id: 'judge-from-proposal',
      targetType: 'skill',
      targetId: `${skillId}:${version}`,
      overallRisk: JudgementRisk.LOW,
      summary: options?.contextText ?? '',
      dimensions: {
        harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'low risk' },
        promptInjection: { risk: JudgementRisk.LOW, score: 0, reason: 'low risk' },
        dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'low risk' },
        policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'low risk' },
      },
      createdAt: new Date('2026-07-02T12:00:00.000Z'),
      model: null,
    };
  }
}

class ReviewCatalog implements SkillCatalogPort {
  listSkillVersionsCalls = 0;
  getProposalCalls = 0;

  constructor(
    private readonly version: CatalogSkillVersionRecord,
    private readonly proposal?: CatalogProposalRecord
  ) {}

  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: Proposal): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async findProposalByContentDigest(_contentDigest: string, _excludeId?: string): Promise<CatalogProposalRecord | null> { return null; }
  async findPublishedSkillByContentDigest(_contentDigest: string): Promise<{ skillId: string; version: string } | null> { return null; }
  async upsertSkillJudgement(_skillId: string, _version: string, _judgement: Judgement): Promise<void> {}
  async listJudgements() { return []; }
  async upsertAuditEntry() {}
  async listSkillHistory() { return []; }
  async listProposals() { return { items: [], total: 0 }; }
  async getProposal(proposalId: string) {
    this.getProposalCalls += 1;
    return this.proposal?.id === proposalId ? this.proposal : null;
  }
  async listProposalFiles() { return []; }
  async listProposalJudgements() {
    if (!this.proposal) {
      return [];
    }
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
            score: 0.1,
            reason: 'existing',
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
  async countProposalsByStatus(): Promise<Record<ProposalStatus, number>> {
    return { in_upload: 0, submitted: 0, judged: 0, converted: 0 };
  }
  async rebuild(_skills: Skill[]): Promise<void> {}
  async listCategories(): Promise<string[]> { return []; }
  async listLatestSkillVersions() { return { items: [this.version], total: 1 }; }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getSkillVersion(skillId: string, version: string): Promise<CatalogSkillVersionRecord | null> {
    return this.version.skillId === skillId && this.version.version === version ? this.version : null;
  }
  async getLatestVersion(skillId: string): Promise<CatalogSkillVersionRecord | null> {
    return this.version.skillId === skillId ? this.version : null;
  }
  async getLatestPublishedVersion(skillId: string): Promise<CatalogSkillVersionRecord | null> {
    return this.version.skillId === skillId && this.version.status === 'published' ? this.version : null;
  }
  async listSkillVersions(skillId: string): Promise<CatalogSkillVersionRecord[]> {
    this.listSkillVersionsCalls += 1;
    return this.version.skillId === skillId ? [this.version] : [];
  }
  async listPublishedVersions(skillId: string): Promise<CatalogSkillVersionRecord[]> {
    return this.version.skillId === skillId && this.version.status === 'published' ? [this.version] : [];
  }
  async listVersionFiles() {
    return [];
  }
}

class StubCreateSkillUseCase extends CreateSkillUseCase {
  constructor() {
    super(new ReviewRepo(), new ReviewStorage(), new ReviewAudit());
  }

  override async createSkill(draft: {
    id: string;
    title: string;
    description: string;
    category: string;
    tags?: string[];
    capabilities?: string[];
    entrypoint: string;
  }, actor: string): Promise<Skill> {
    const skill = Skill.create({ id: SkillId.create(draft.id), createdBy: actor });
    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: '1.0.0',
        createdBy: actor,
        manifest: Manifest.create({
          id: draft.id,
          title: draft.title,
          description: draft.description,
          version: '1.0.0',
          status: SkillStatus.DRAFT,
          category: draft.category,
          tags: draft.tags,
          capabilities: draft.capabilities,
          entrypoint: draft.entrypoint,
          files: [],
        }),
      })
    );
    return skill;
  }
}

function createExistingSkill(id: string): Skill {
  const skill = Skill.create({ id: SkillId.create(id), createdBy: 'seed' });
  skill.addVersion(
    SkillVersion.create({
      skillId: skill.id,
      version: '1.0.0',
      createdBy: 'seed',
      manifest: Manifest.create({
        id,
        title: 'Existing Skill',
        description: 'Seed skill',
        version: '1.0.0',
        status: SkillStatus.PUBLISHED,
        category: 'automation',
        entrypoint: 'README.md',
        files: [],
      }),
    })
  );
  return skill;
}

function createCatalogVersion(skillId: string): CatalogSkillVersionRecord {
  return {
    skillId,
    skillUuid: 'skill-uuid',
    version: '1.0.0',
    versionUuid: 'version-uuid',
    title: 'Existing Skill',
    description: 'Seed skill',
    category: 'automation',
    tags: [],
    capabilities: [],
    entrypoint: 'README.md',
    useWhen: [],
    doNotUseWhen: [],
    status: 'published',
    contentDigest: 'digest',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    approvedBy: 'seed',
    approvedAt: new Date('2026-07-01T00:00:00.000Z'),
    publishedBy: 'seed',
    publishedAt: new Date('2026-07-01T00:00:00.000Z'),
    isLatestVersion: true,
    isLatestPublished: true,
  };
}

function createCatalogProposal(id: string): CatalogProposalRecord {
  return {
    id,
    skillId: null,
    title: 'Catalog proposal',
    description: 'Loaded from catalog',
    category: 'automation',
    tags: [],
    capabilities: [],
    entrypoint: null,
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
