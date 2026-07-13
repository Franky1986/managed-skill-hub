import { describe, expect, it } from 'vitest';
import { AdminSkillReadUseCase } from './admin-skill-read.usecase';
import { SkillCatalogPort, CatalogSkillVersionRecord } from '../../ports/outbound/skill-catalog.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { Skill } from '../../../domain/skill/Skill';
import { ExtractSkillFileContentUseCase, ExtractedSkillFileContent } from './extract-skill-file-content.usecase';
import { Proposal } from '../../../domain/proposal/Proposal';
import { Judgement } from '../../../domain/judgement/Judgement';

describe('AdminSkillReadUseCase', () => {
  it('serves admin summaries and detail from the sqlite catalog when available', async () => {
    const latestVersion = createCatalogVersion({
      version: '1.0.2',
      status: 'draft',
      isLatestPublished: false,
      isLatestVersion: true,
      publishedAt: null,
    });
    const latestPublished = createCatalogVersion({
      version: '1.0.1',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: false,
    });
    const catalog = new CatalogStub([latestPublished, latestVersion], latestPublished, latestVersion);
    const useCase = new AdminSkillReadUseCase(new RepoStub(), new StorageStub(), new ExtractorStub(), catalog);

    const summaries = await useCase.listSkillSummaries();
    const detail = await useCase.getSkillDetail('catalog-skill');
    const files = await useCase.listFiles('catalog-skill');

    expect(summaries.items[0]).toMatchObject({
      id: 'catalog-skill',
      version: '1.0.2',
      status: 'draft',
    });
    expect(detail).toMatchObject({
      id: 'catalog-skill',
      latestPublishedVersion: '1.0.1',
      title: 'Catalog Skill',
      entrypoint: 'README.md',
      useWhen: ['when useful'],
      doNotUseWhen: ['when unsafe'],
    });
    expect(detail.versions).toHaveLength(2);
    expect(detail.versions[1]?.version).toBe('1.0.2');
    expect(files[0]).toMatchObject({
      path: 'README.md',
      role: 'entrypoint',
      mimeType: 'text/markdown',
    });
  });

  it('builds an admin skill aggregate directly from the sqlite catalog when available', async () => {
    const latestVersion = createCatalogVersion({
      version: '1.0.2',
      status: 'draft',
      isLatestPublished: false,
      isLatestVersion: true,
      publishedAt: null,
    });
    const latestPublished = createCatalogVersion({
      version: '1.0.1',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: false,
    });
    const catalog = new CatalogStub([latestPublished, latestVersion], latestPublished, latestVersion, {
      'catalog-skill:1.0.1': latestPublished,
      'catalog-skill:1.0.2': latestVersion,
    });
    const repo = new RepoStub();
    const useCase = new AdminSkillReadUseCase(repo, new StorageStub(), new ExtractorStub(), catalog);

    const skill = await useCase.getSkill('catalog-skill');

    expect(skill.id.toString()).toBe('catalog-skill');
    expect(skill.getAllVersions()).toHaveLength(2);
    expect(skill.getLatestPublishedVersion()?.version).toBe('1.0.1');
    expect(repo.findByIdCalls).toBe(0);
  });

  it('resolves admin raw file reads against the sqlite catalog before reading storage', async () => {
    const latestVersion = createCatalogVersion({
      version: '1.0.2',
      status: 'draft',
      isLatestPublished: false,
      isLatestVersion: true,
      publishedAt: null,
    });
    const latestPublished = createCatalogVersion({
      version: '1.0.1',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: false,
    });
    const catalog = new CatalogStub([latestPublished, latestVersion], latestPublished, latestVersion, {
      'catalog-skill:1.0.2': latestVersion,
    });
    const repo = new RepoStub();
    const storage = new StorageStub({
      'catalog-skill:1.0.2:README.md': {
        content: Buffer.from('admin file'),
        mimeType: 'text/markdown',
      },
    });
    const useCase = new AdminSkillReadUseCase(repo, storage, new ExtractorStub(), catalog);

    const file = await useCase.getFile('catalog-skill', 'README.md', '1.0.2');

    expect(file.path).toBe('README.md');
    expect(file.mimeType).toBe('text/markdown');
    expect(file.content.toString('utf8')).toBe('admin file');
    expect(storage.readSkillFileCalls).toEqual([{ skillId: 'catalog-skill', version: '1.0.2', fileId: 'README.md' }]);
    expect(repo.findByIdCalls).toBe(0);
  });

  it('delegates admin extracted-content reads without an extra repository precheck', async () => {
    const latestVersion = createCatalogVersion({
      version: '1.0.2',
      status: 'draft',
      isLatestPublished: false,
      isLatestVersion: true,
      publishedAt: null,
    });
    const latestPublished = createCatalogVersion({
      version: '1.0.1',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: false,
    });
    const catalog = new CatalogStub([latestPublished, latestVersion], latestPublished, latestVersion, {
      'catalog-skill:1.0.2': latestVersion,
    });
    const repo = new RepoStub();
    const extractor = new RecordingExtractorStub();
    const useCase = new AdminSkillReadUseCase(repo, new StorageStub(), extractor, catalog);

    const extracted = await useCase.getExtractedContent('catalog-skill', 'README.md', '1.0.2');

    expect(extracted.text).toBe('delegated extract');
    expect(extractor.calls).toEqual([
      {
        skillId: 'catalog-skill',
        filePath: 'README.md',
        options: { version: '1.0.2', includeUnpublished: true },
      },
    ]);
    expect(repo.findByIdCalls).toBe(0);
  });
});

class CatalogStub implements SkillCatalogPort {
  constructor(
    private readonly versions: CatalogSkillVersionRecord[],
    private readonly latestPublished: CatalogSkillVersionRecord | null,
    private readonly latestVersion: CatalogSkillVersionRecord | null,
    private readonly versionByKey: Record<string, CatalogSkillVersionRecord> = {}
  ) {}

  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: Proposal): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async upsertSkillJudgement(_skillId: string, _version: string, _judgement: Judgement): Promise<void> {}
  async listJudgements() { return []; }
  async upsertAuditEntry() {}
  async listSkillHistory() { return []; }
  async listProposals() { return { items: [], total: 0 }; }
  async getProposal() { return null; }
  async listProposalFiles() { return []; }
  async listProposalJudgements() { return []; }
  async countPendingProposals() { return 0; }
  async rebuild(_skills: Skill[]): Promise<void> {}
  async listCategories(): Promise<string[]> { return ['automation']; }
  async listLatestSkillVersions(): Promise<{ items: CatalogSkillVersionRecord[]; total: number }> {
    return { items: this.latestVersion ? [this.latestVersion] : [], total: this.latestVersion ? 1 : 0 };
  }
  async listPublishedSkillRefs(): Promise<{ items: { skillId: string; version: string }[]; total: number }> {
    return { items: [], total: 0 };
  }
  async getSkillVersion(skillId: string, version: string): Promise<CatalogSkillVersionRecord | null> {
    return this.versionByKey[`${skillId}:${version}`] ?? null;
  }
  async getLatestVersion(): Promise<CatalogSkillVersionRecord | null> { return this.latestVersion; }
  async getLatestPublishedVersion(): Promise<CatalogSkillVersionRecord | null> { return this.latestPublished; }
  async listSkillVersions(): Promise<CatalogSkillVersionRecord[]> { return this.versions; }
  async listPublishedVersions(): Promise<CatalogSkillVersionRecord[]> {
    return this.versions.filter((version) => version.status === 'published');
  }
  async listVersionFiles() {
    return [
      {
        skillId: 'catalog-skill',
        version: '1.0.2',
        path: 'README.md',
        artifactId: 'artifact-1',
        role: 'entrypoint',
        mimeType: 'text/markdown',
        sizeBytes: 12,
        sha256: 'sha',
        updatedAt: new Date('2026-07-02T11:00:00.000Z'),
        extractable: true,
      },
    ];
  }
}

class RepoStub implements SkillRepositoryPort {
  findByIdCalls = 0;

  async save(_skill: Skill): Promise<void> {}
  async findById(): Promise<Skill | null> {
    this.findByIdCalls += 1;
    return null;
  }
  async findAll(): Promise<{ items: Skill[]; total: number }> { return { items: [], total: 0 }; }
  async exists(): Promise<boolean> { return false; }
  async saveProposal(): Promise<void> {}
  async findProposalById() { return null; }
  async findProposals() { return { items: [], total: 0 }; }
  async deleteProposal(): Promise<void> {}
}

class StorageStub implements SkillFileStoragePort {
  readSkillFileCalls: Array<{ skillId: string; version: string; fileId: string }> = [];

  constructor(
    private readonly files: Record<string, { content: Buffer; mimeType: string }> = {}
  ) {}

  async storeSkillFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readSkillFile(skillId: string, version: string, fileId: string): Promise<{ content: Buffer; mimeType: string } | null> {
    this.readSkillFileCalls.push({ skillId, version, fileId });
    return this.files[`${skillId}:${version}:${fileId}`] ?? null;
  }
  async listSkillFiles(): Promise<StoredFile[]> { return []; }
  async storeSkillFileExtract(): Promise<StoredExtractedContent> { throw new Error('not implemented'); }
  async readSkillFileExtract(): Promise<StoredExtractedContent | null> { return null; }
  async storeProposalFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readProposalFile(): Promise<{ content: Buffer; mimeType: string } | null> { return null; }
  async listProposalFiles(): Promise<StoredFile[]> { return []; }
}

class ExtractorStub extends ExtractSkillFileContentUseCase {
  constructor() {
    super(new RepoStub(), new StorageStub(), { supports: () => true, scan: async () => ({ text: '', metadata: {}, extractedBy: 'stub' }) });
  }
}

class RecordingExtractorStub extends ExtractSkillFileContentUseCase {
  calls: Array<{ skillId: string; filePath: string; options?: { version?: string; includeUnpublished?: boolean; forceRefresh?: boolean } }> = [];

  constructor() {
    super(new RepoStub(), new StorageStub(), { supports: () => true, scan: async () => ({ text: '', metadata: {}, extractedBy: 'stub' }) });
  }

  override async execute(
    skillId: string,
    filePath: string,
    options?: { version?: string; includeUnpublished?: boolean; forceRefresh?: boolean }
  ): Promise<ExtractedSkillFileContent> {
    this.calls.push({ skillId, filePath, options });
    return {
      text: 'delegated extract',
      extractedBy: 'recording-stub',
      metadata: {},
    };
  }
}

function createCatalogVersion(overrides: Partial<CatalogSkillVersionRecord>): CatalogSkillVersionRecord {
  return {
    skillId: 'catalog-skill',
    version: '1.0.1',
    title: 'Catalog Skill',
    description: 'Projected',
    category: 'automation',
    tags: ['agent'],
    capabilities: ['read'],
    useWhen: ['when useful'],
    doNotUseWhen: ['when unsafe'],
    entrypoint: 'README.md',
    status: 'published',
    skillUuid: 'skill-uuid',
    versionUuid: 'version-uuid',
    contentDigest: 'digest',
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    approvedBy: 'admin',
    publishedBy: 'admin',
    publishedAt: new Date('2026-07-02T10:00:00.000Z'),
    updatedAt: new Date('2026-07-02T11:00:00.000Z'),
    isLatestPublished: true,
    isLatestVersion: true,
    ...overrides,
  };
}
