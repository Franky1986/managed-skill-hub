import { describe, expect, it } from 'vitest';
import { ProposalReadUseCase } from './proposal-read.usecase';
import { ExtractProposalFileContentUseCase } from './extract-proposal-file-content.usecase';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillCatalogPort, CatalogProposalRecord } from '../../ports/outbound/skill-catalog.port';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { Proposal } from '../../../domain/proposal/Proposal';
import { ProposalStatus } from '../../../domain/proposal/ProposalStatus';
import { Skill } from '../../../domain/skill/Skill';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { Proposal as ProposalEntity } from '../../../domain/proposal/Proposal';

describe('ProposalReadUseCase', () => {
  it('prefers sqlite-projected proposal summaries when available', async () => {
    const proposal = createProposal();
    const repo = new ProposalRepo([proposal]);
    const storage = new ProposalStorage();
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      new FakeAudit(),
      new ProposalCatalog({
        pendingCount: 1,
        proposals: [
          {
            id: proposal.id,
            skillId: proposal.skillId,
            title: proposal.title,
            description: proposal.description,
            category: proposal.category,
            tags: proposal.tags,
            capabilities: proposal.capabilities,
            entrypoint: proposal.entrypoint,
            status: proposal.status,
            submittedBy: proposal.submittedBy,
            createdAt: proposal.createdAt,
            rejectionReason: proposal.rejectionReason,
            latestJudgementRisk: JudgementRisk.LOW,
            labels: ['safe'],
            latestJudgementId: 'judge-safe',
            latestJudgedAt: new Date('2026-07-02T09:00:00.000Z'),
          },
        ],
        judgements: [
          {
            id: 'judge-safe',
            targetType: 'proposal',
            targetId: proposal.id,
            proposalId: proposal.id,
            skillId: null,
            skillVersion: null,
            dimensions: {
              harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
              promptInjection: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
              dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
              policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
              qualityFit: { risk: JudgementRisk.LOW, score: 0, reason: 'complete enough' },
            },
            overallRisk: JudgementRisk.LOW,
            summary: 'Safe proposal',
            model: 'test-judger',
            createdAt: new Date('2026-07-02T09:00:00.000Z'),
          },
        ],
      })
    );

    const summaries = await useCase.listSummaries();
    const notice = await useCase.getNotice();

    expect(summaries.total).toBe(1);
    expect(summaries.items[0]?.latestJudgementRisk).toBe('low');
    expect(summaries.items[0]?.latestJudgement?.summary).toBe('Safe proposal');
    expect(summaries.items[0]?.latestJudgement?.dimensions.qualityFit?.risk).toBe('low');
    expect(summaries.items[0]?.labels).toContain('safe');
    expect(notice).toEqual({ hasNewProposals: true, totalPending: 1, counts: { in_upload: 0, submitted: 1, judged: 0, converted: 0 } });
  });

  it('uses catalog review metadata for detail reads when available', async () => {
    const proposal = createProposal();
    const repo = new ThrowingProposalRepo();
    const storage = new ProposalStorage();
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      new FakeAudit(),
      new ProposalCatalog({
        proposals: [
          {
            id: proposal.id,
            skillId: 'existing-skill',
            title: proposal.title,
            description: proposal.description,
            category: proposal.category,
            tags: proposal.tags,
            capabilities: proposal.capabilities,
            entrypoint: proposal.entrypoint,
            status: proposal.status,
            submittedBy: proposal.submittedBy,
            createdAt: proposal.createdAt,
            rejectionReason: proposal.rejectionReason,
            latestJudgementRisk: JudgementRisk.MEDIUM,
            labels: ['needs_review', 'prompt_injection_risk'],
            latestJudgementId: 'judge-1',
            latestJudgedAt: new Date('2026-07-02T12:00:00.000Z'),
          },
        ],
        files: [
          {
            proposalId: proposal.id,
            id: 'README.md',
            path: 'README.md',
            mimeType: 'text/markdown',
            sizeBytes: 128,
            sha256: 'sha-readme',
          },
        ],
        judgements: [
          {
            id: 'judge-1',
            targetType: 'proposal',
            targetId: proposal.id,
            proposalId: proposal.id,
            skillId: null,
            skillVersion: null,
            dimensions: {
              harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
              promptInjection: { risk: JudgementRisk.MEDIUM, score: 0.5, reason: 'possible hidden instruction' },
              dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
              policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
            },
            overallRisk: JudgementRisk.MEDIUM,
            summary: 'Needs review',
            model: 'sqlite-catalog',
            createdAt: new Date('2026-07-02T12:00:00.000Z'),
          },
        ],
        latestSkillVersions: {
          'existing-skill': createCatalogSkillVersion(),
        },
      })
    );

    const detail = await useCase.getDetail(proposal.id);

    expect(detail?.review.latestJudgementRisk).toBe('medium');
    expect(detail?.review.labels).toContain('needs_review');
    expect(detail?.review.latestJudgementId).toBe('judge-1');
    expect(detail?.files[0]?.path).toBe('README.md');
    expect(detail?.files[0]?.judgement.state).toBe('unavailable');
    expect(detail?.judgements[0]?.summary).toBe('Needs review');
    expect(detail?.judgement).toMatchObject({
      state: 'completed',
      attemptedAt: new Date('2026-07-02T12:00:00.000Z'),
    });
    expect(detail?.conversion).toMatchObject({
      mode: 'create_version',
      targetSkillId: 'existing-skill',
      targetSkillTitle: 'Existing Skill',
      targetSkillExists: true,
      currentLatestVersion: '1.2.3',
      nextVersion: '1.2.4',
      targetEntrypoint: 'README.md',
    });
  });

  it('falls back to repository-backed detail reads when the catalog is empty', async () => {
    const proposal = createProposal();
    const repo = new ProposalRepo([proposal]);
    const storage = new ProposalStorage();
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      new FakeAudit(),
      new ProposalCatalog()
    );

    const summaries = await useCase.listSummaries();
    const detail = await useCase.getDetail(proposal.id);
    const notice = await useCase.getNotice();

    expect(summaries).toEqual({ items: [], total: 0 });
    expect(detail?.title).toBe(proposal.title);
    expect(notice).toEqual({ hasNewProposals: false, totalPending: 0, counts: { in_upload: 0, submitted: 0, judged: 0, converted: 0 } });
    expect(detail?.review.labels).toContain('needs_review');
  });

  it('does not count in-upload proposals as pending admin review', async () => {
    const proposal = Proposal.create({
      title: 'Upload still running',
      description: 'This proposal has not been finalized yet.',
      category: 'automation',
      submittedBy: 'agent',
    });
    const repo = new ProposalRepo([proposal]);
    const storage = new ProposalStorage();
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      new FakeAudit()
    );

    const notice = await useCase.getNotice();

    expect(notice).toEqual({ hasNewProposals: false, totalPending: 0, counts: { in_upload: 1, submitted: 0, judged: 0, converted: 0 } });
  });

  it('returns only currently valid admin next steps for each proposal status', async () => {
    const upload = Proposal.create({
      title: 'Upload still running',
      description: 'This proposal has not been finalized yet.',
      category: 'automation',
      submittedBy: 'agent',
    });
    const submitted = createProposal();
    const judged = submitted.addJudgement(createLowRiskJudgement(submitted.id));
    const approved = createProposal().approve();
    const rejected = createProposal().reject('not suitable');
    const converted = createProposal().approve().convert();
    const cases = [
      {
        proposal: upload,
        expected: ['review incomplete upload', 'delete abandoned upload'],
      },
      {
        proposal: submitted,
        expected: ['review proposal details', 'convert proposal to skill', 'reject proposal with reason'],
      },
      {
        proposal: judged,
        expected: ['review proposal details', 'convert proposal to skill', 'reject proposal with reason'],
      },
      { proposal: approved, expected: [] },
      { proposal: rejected, expected: [] },
      { proposal: converted, expected: [] },
    ];

    for (const testCase of cases) {
      const audit = new FakeAudit();
      if (testCase.proposal.status === 'converted') {
        audit.entries.push(
          AuditEntry.create({
            proposalId: testCase.proposal.id,
            skillId: 'converted-skill',
            action: 'convert_proposal',
            actor: 'admin',
            after: { status: 'converted', skillId: 'converted-skill', version: '1.0.0' },
          })
        );
      }
      const repo = new ProposalRepo([testCase.proposal]);
      const storage = new ProposalStorage();
      const useCase = new ProposalReadUseCase(
        repo,
        storage,
        new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
        audit
      );

      const status = await useCase.getPublicStatus(testCase.proposal.id);

      expect(status?.adminOnlyNextSteps).toEqual(testCase.expected);
      if (testCase.proposal.status === 'converted') {
        expect(status?.convertedSkillId).toBe('converted-skill');
      }
    }
  });

  it('returns proposal lifecycle events from audit entries', async () => {
    const proposal = createProposal();
    const audit = new FakeAudit();
    audit.entries.push(
      AuditEntry.create({
        id: 'audit-convert',
        proposalId: proposal.id,
        skillId: 'catalog-proposal',
        skillVersion: '1.0.0',
        action: 'convert_proposal',
        actor: 'admin',
        before: { status: 'judged' },
        after: { status: 'converted', skillId: 'catalog-proposal', version: '1.0.0', comment: 'accepted' },
        createdAt: new Date(proposal.createdAt.getTime() + 1000),
      })
    );
    const repo = new ProposalRepo([proposal]);
    const storage = new ProposalStorage();
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      audit,
      new ProposalCatalog()
    );

    const detail = await useCase.getDetail(proposal.id);

    expect(detail?.lifecycle.map((event) => event.action)).toEqual(['upload_started', 'convert_proposal']);
    expect(detail?.lifecycle[1]).toMatchObject({
      actor: 'admin',
      fromStatus: 'judged',
      toStatus: 'converted',
      skillId: 'catalog-proposal',
      skillVersion: '1.0.0',
      comment: 'accepted',
    });
  });

  it('includes rejection time in proposal summaries', async () => {
    const proposal = createProposal().reject('not suitable');
    const rejectedAt = new Date(proposal.createdAt.getTime() + 2000);
    const audit = new FakeAudit();
    audit.entries.push(
      AuditEntry.create({
        id: 'audit-reject',
        proposalId: proposal.id,
        action: 'reject_proposal',
        actor: 'admin',
        before: { status: 'judged' },
        after: { status: 'rejected', reason: 'not suitable' },
        createdAt: rejectedAt,
      })
    );
    const repo = new ProposalRepo([proposal]);
    const storage = new ProposalStorage();
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      audit
    );

    const summaries = await useCase.listSummaries(undefined, 'rejected');

    expect(summaries.items[0]).toMatchObject({
      status: 'rejected',
      rejectedAt,
      rejectedBy: 'admin',
    });
  });

  it('treats empty catalog notice and summary reads as authoritative without repository fallback', async () => {
    const repo = new ThrowingProposalRepo();
    const storage = new ProposalStorage();
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      new FakeAudit(),
      new ProposalCatalog()
    );

    const summaries = await useCase.listSummaries();
    const notice = await useCase.getNotice();

    expect(summaries).toEqual({ items: [], total: 0 });
    expect(notice).toEqual({ hasNewProposals: false, totalPending: 0, counts: { in_upload: 0, submitted: 0, judged: 0, converted: 0 } });
  });

  it('reads proposal file content from storage', async () => {
    const proposal = createProposal();
    const storage = new ProposalStorage({
      [`${proposal.id}:README.md`]: {
        content: Buffer.from('# Proposal\n'),
        mimeType: 'text/markdown',
      },
    });
    const repo = new ProposalRepo([proposal]);
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      new FakeAudit(),
      new ProposalCatalog()
    );

    const file = await useCase.getFile(proposal.id, 'README.md');

    expect(file.mimeType).toBe('text/markdown');
    expect(file.content.toString('utf-8')).toContain('Proposal');
  });

  it('derives a new skill conversion preview from repository-backed proposal detail when no target skill exists', async () => {
    const proposal = createProposal();
    const repo = new ProposalRepo([proposal]);
    const storage = new ProposalStorage();
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      new FakeAudit(),
      new ProposalCatalog()
    );

    const detail = await useCase.getDetail(proposal.id);

    expect(detail?.entrypoint).toBeNull();
    expect(detail?.conversion).toMatchObject({
      mode: 'create_skill',
      targetSkillId: 'catalog-proposal',
      targetSkillExists: false,
      currentLatestVersion: null,
      nextVersion: '1.0.0',
      targetEntrypoint: 'README.md',
    });
  });

  it('does not expose private duplicate proposal IDs or submitter identity in public status', async () => {
    const proposal = createProposal();
    const duplicate: CatalogProposalRecord = {
      id: 'prop-duplicate',
      skillId: null,
      title: 'Duplicate',
      description: 'Same content',
      category: 'automation',
      tags: [],
      capabilities: [],
      entrypoint: null,
      status: 'submitted',
      submittedBy: 'agent',
      createdAt: new Date('2026-07-02T10:00:00.000Z'),
      rejectionReason: null,
      latestJudgementRisk: JudgementRisk.LOW,
      labels: [],
      latestJudgementId: null,
      latestJudgedAt: null,
      contentDigest: 'same-digest',
    };
    const catalog = new ProposalCatalog({
      proposals: [
        {
          id: proposal.id,
          skillId: proposal.skillId,
          title: proposal.title,
          description: proposal.description,
          category: proposal.category,
          tags: proposal.tags,
          capabilities: proposal.capabilities,
          entrypoint: proposal.entrypoint,
          status: proposal.status,
          submittedBy: proposal.submittedBy,
          createdAt: proposal.createdAt,
          rejectionReason: proposal.rejectionReason,
          latestJudgementRisk: JudgementRisk.LOW,
          labels: [],
          latestJudgementId: null,
          latestJudgedAt: null,
          contentDigest: 'same-digest',
        },
      ],
    });
    catalog.findProposalByContentDigest = async (_digest, excludeId) =>
      excludeId === proposal.id ? duplicate : null;

    const repo = new ThrowingProposalRepo();
    const storage = new ProposalStorage();
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      new FakeAudit(),
      catalog
    );

    const status = await useCase.getPublicStatus(proposal.id);

    expect(status?.contentDigest).toBe('same-digest');
    expect(status).not.toHaveProperty('duplicateOfProposalId');
    expect(status).not.toHaveProperty('submittedBy');
    expect(status?.duplicateOfSkillId).toBeNull();
  });

  it('returns duplicate skill id in public status when catalog detects a published skill duplicate', async () => {
    const proposal = createProposal();
    const catalog = new ProposalCatalog({
      proposals: [
        {
          id: proposal.id,
          skillId: proposal.skillId,
          title: proposal.title,
          description: proposal.description,
          category: proposal.category,
          tags: proposal.tags,
          capabilities: proposal.capabilities,
          entrypoint: proposal.entrypoint,
          status: proposal.status,
          submittedBy: proposal.submittedBy,
          createdAt: proposal.createdAt,
          rejectionReason: proposal.rejectionReason,
          latestJudgementRisk: JudgementRisk.LOW,
          labels: [],
          latestJudgementId: null,
          latestJudgedAt: null,
          contentDigest: 'skill-digest',
        },
      ],
    });
    catalog.findProposalByContentDigest = async () => null;
    catalog.findPublishedSkillByContentDigest = async () => ({ skillId: 'existing-skill', version: '1.0.0' });

    const repo = new ThrowingProposalRepo();
    const storage = new ProposalStorage();
    const useCase = new ProposalReadUseCase(
      repo,
      storage,
      new ExtractProposalFileContentUseCase(repo, storage, new Scanner()),
      new FakeAudit(),
      catalog
    );

    const status = await useCase.getPublicStatus(proposal.id);

    expect(status).not.toHaveProperty('duplicateOfProposalId');
    expect(status?.duplicateOfSkillId).toBe('existing-skill');
  });
});


class FakeAudit implements AuditLogPort {
  entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> { this.entries.push(entry); }
  async findBySkillId(): Promise<AuditEntry[]> { return []; }
  async findByProposalId(): Promise<AuditEntry[]> { return this.entries; }
  async findAll(): Promise<AuditEntry[]> { return this.entries; }
}

class ProposalRepo implements SkillRepositoryPort {
  constructor(
    private readonly proposals: Proposal[],
    private readonly skills: Skill[] = []
  ) {}

  async save(_skill: Skill): Promise<void> {}
  async findById(id: string): Promise<Skill | null> {
    return this.skills.find((skill) => skill.id.toString() === id) ?? null;
  }
  async findAll(): Promise<{ items: Skill[]; total: number }> { return { items: [], total: 0 }; }
  async exists(): Promise<boolean> { return false; }
  async saveProposal(_proposal: Proposal): Promise<void> {}
  async findProposalById(id: string): Promise<Proposal | null> {
    return this.proposals.find((proposal) => proposal.id === id) ?? null;
  }
  async findProposals(): Promise<{ items: Proposal[]; total: number }> {
    return { items: this.proposals, total: this.proposals.length };
  }
  async deleteProposal(): Promise<void> {}
}

class ThrowingProposalRepo extends ProposalRepo {
  constructor() {
    super([]);
  }

  async findProposalById(): Promise<Proposal | null> {
    throw new Error('repository should not be used for catalog-backed detail reads');
  }

  override async findProposals(): Promise<{ items: Proposal[]; total: number }> {
    throw new Error('repository should not be used for catalog-backed notice/list reads');
  }
}

class ProposalStorage implements SkillFileStoragePort {
  constructor(
    private readonly files: Record<string, { content: Buffer; mimeType: string }> = {}
  ) {}

  async storeSkillFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readSkillFile(): Promise<{ content: Buffer; mimeType: string } | null> { return null; }
  async listSkillFiles(): Promise<StoredFile[]> { return []; }
  async storeSkillFileExtract(): Promise<StoredExtractedContent> { throw new Error('not implemented'); }
  async readSkillFileExtract(): Promise<StoredExtractedContent | null> { return null; }
  async storeProposalFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readProposalFile(proposalId: string, path: string): Promise<{ content: Buffer; mimeType: string } | null> {
    return this.files[`${proposalId}:${path}`] ?? null;
  }
  async listProposalFiles(): Promise<StoredFile[]> { return []; }
  async storeProposalFileExtract(
    _proposalId: string,
    _path: string,
    extracted: Omit<StoredExtractedContent, 'extractedAt'> & { extractedAt?: Date }
  ): Promise<StoredExtractedContent> {
    return {
      text: extracted.text,
      extractedBy: extracted.extractedBy,
      metadata: extracted.metadata,
      extractedAt: extracted.extractedAt ?? new Date('2026-07-02T00:00:00.000Z'),
    };
  }
  async readProposalFileExtract(): Promise<StoredExtractedContent | null> { return null; }
}

class ProposalCatalog implements SkillCatalogPort {
  constructor(
    private readonly state: {
      proposals?: CatalogProposalRecord[];
      files?: import('../../ports/outbound/skill-catalog.port').CatalogProposalFileRecord[];
      judgements?: import('../../ports/outbound/skill-catalog.port').CatalogJudgementRecord[];
      pendingCount?: number;
      latestSkillVersions?: Record<string, import('../../ports/outbound/skill-catalog.port').CatalogSkillVersionRecord>;
    } = {}
  ) {}

  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: ProposalEntity): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async findProposalByContentDigest(_contentDigest: string, _excludeId?: string): Promise<CatalogProposalRecord | null> { return null; }
  async findPublishedSkillByContentDigest(_contentDigest: string): Promise<{ skillId: string; version: string } | null> { return null; }
  async upsertSkillJudgement(_skillId: string, _version: string, _judgement: Judgement): Promise<void> {}
  async listJudgements() { return []; }
  async upsertAuditEntry(_entry: AuditEntry): Promise<void> {}
  async listSkillHistory() { return []; }
  async listProposals(): Promise<{ items: CatalogProposalRecord[]; total: number }> {
    const items = this.state.proposals ?? [];
    return { items, total: items.length };
  }
  async getProposal(proposalId: string): Promise<CatalogProposalRecord | null> {
    return (this.state.proposals ?? []).find((proposal) => proposal.id === proposalId) ?? null;
  }
  async listProposalFiles(proposalId: string) {
    return (this.state.files ?? []).filter((file) => file.proposalId === proposalId);
  }
  async listProposalJudgements(proposalId: string) {
    return (this.state.judgements ?? []).filter((judgement) => judgement.proposalId === proposalId);
  }
  async countPendingProposals(): Promise<number> {
    return this.state.pendingCount ?? 0;
  }
  async countProposalsByStatus(): Promise<Record<ProposalStatus, number>> {
    return { in_upload: 0, submitted: this.state.pendingCount ?? 0, judged: 0, converted: 0 };
  }
  async rebuild(_skills: Skill[]): Promise<void> {}
  async listCategories(): Promise<string[]> { return []; }
  async listLatestSkillVersions() { return { items: [], total: 0 }; }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getLatestVersion(skillId: string) { return this.state.latestSkillVersions?.[skillId] ?? null; }
  async getLatestPublishedVersion() { return null; }
  async listSkillVersions() { return []; }
  async listPublishedVersions() { return []; }
  async listVersionFiles() { return []; }
}

class Scanner implements FileScannerPort {
  supports(): boolean { return true; }
  async scan() {
    return {
      text: 'scanned text',
      metadata: {},
      extractedBy: 'stub-scanner',
    };
  }
}

function createProposal(): Proposal {
  return Proposal.create({
    title: 'Catalog proposal',
    description: 'Projected proposal metadata with token handling',
    category: 'automation',
    submittedBy: 'agent',
  }).finalizeUpload();
}

function createLowRiskJudgement(targetId: string): Judgement {
  return Judgement.create({
    id: `judge-${targetId}`,
    targetType: 'proposal',
    targetId,
    dimensions: {
      harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
    },
    summary: 'Safe proposal',
    model: 'test-judger',
  });
}

function createCatalogSkillVersion(): import('../../ports/outbound/skill-catalog.port').CatalogSkillVersionRecord {
  return {
    skillId: 'existing-skill',
    version: '1.2.3',
    title: 'Existing Skill',
    description: 'Existing catalog skill',
    category: 'automation',
    tags: [],
    capabilities: ['read'],
    useWhen: [],
    doNotUseWhen: [],
    entrypoint: 'README.md',
    status: 'published',
    skillUuid: 'skill-uuid',
    versionUuid: 'version-uuid',
    contentDigest: 'digest',
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    approvedBy: 'admin',
    publishedBy: 'admin',
    publishedAt: new Date('2026-07-01T10:30:00.000Z'),
    updatedAt: new Date('2026-07-01T10:30:00.000Z'),
    isLatestPublished: true,
    isLatestVersion: true,
  };
}
