import { describe, expect, it } from 'vitest';
import { Skill } from '../../../domain/skill/Skill';
import { SkillId } from '../../../domain/skill/SkillId';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import { Manifest } from '../../../domain/skill/Manifest';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { ManifestFile } from '../../../domain/skill/ManifestFile';
import { ExtractSkillFileContentUseCase } from './extract-skill-file-content.usecase';
import { CatalogSkillVersionRecord, SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { NotFoundError } from '../../../domain/errors';
import { Proposal } from '../../../domain/proposal/Proposal';
import { Judgement } from '../../../domain/judgement/Judgement';

describe('ExtractSkillFileContentUseCase', () => {
  it('returns utf-8 content directly for text files', async () => {
    const skill = createSkill('text-skill', SkillStatus.PUBLISHED, [
      ManifestFile.create({ path: 'README.md', role: 'entrypoint', mimeType: 'text/markdown', sha256: 'sha' }),
    ]);
    const repo = new Repo(skill);
    const storage = new Storage(
      new Map([
        ['text-skill:1.0.0:README.md', { content: Buffer.from('# Hello'), mimeType: 'text/markdown' }],
      ])
    );
    const scanner = new Scanner();

    const useCase = new ExtractSkillFileContentUseCase(repo, storage, scanner);
    const extracted = await useCase.execute('text-skill', 'README.md');

    expect(extracted.text).toBe('# Hello');
    expect(extracted.extractedBy).toBe('native');
    expect(storage.extracted.get('text-skill:1.0.0:README.md')?.text).toBe('# Hello');
  });

  it('uses the scanner for extractable binary files', async () => {
    const skill = createSkill('pdf-skill', SkillStatus.PUBLISHED, [
      ManifestFile.create({ path: 'guide.pdf', role: 'attachment', mimeType: 'application/pdf', sha256: 'sha' }),
    ]);
    const repo = new Repo(skill);
    const storage = new Storage(
      new Map([
        ['pdf-skill:1.0.0:guide.pdf', { content: Buffer.from('pdf-bytes'), mimeType: 'application/pdf' }],
      ])
    );
    const scanner = new Scanner('Extracted from PDF');

    const useCase = new ExtractSkillFileContentUseCase(repo, storage, scanner);
    const extracted = await useCase.execute('pdf-skill', 'guide.pdf');

    expect(extracted.text).toBe('Extracted from PDF');
    expect(extracted.extractedBy).toBe('stub-scanner');
  });

  it('reuses persisted extracts until forceRefresh is requested', async () => {
    const skill = createSkill('cached-skill', SkillStatus.PUBLISHED, [
      ManifestFile.create({ path: 'guide.pdf', role: 'attachment', mimeType: 'application/pdf', sha256: 'sha' }),
    ]);
    const repo = new Repo(skill);
    const storage = new Storage(
      new Map([
        ['cached-skill:1.0.0:guide.pdf', { content: Buffer.from('pdf-bytes'), mimeType: 'application/pdf' }],
      ])
    );
    const scanner = new Scanner('fresh extract');
    const extractedAt = new Date('2026-07-02T00:00:00.000Z');
    storage.extracted.set('cached-skill:1.0.0:guide.pdf', {
      text: 'cached extract',
      extractedBy: 'cached-scanner',
      metadata: { mimeType: 'application/pdf', filePath: 'guide.pdf', extractor: 'cached' },
      extractedAt,
    });

    const useCase = new ExtractSkillFileContentUseCase(repo, storage, scanner);

    const cached = await useCase.execute('cached-skill', 'guide.pdf');
    const refreshed = await useCase.execute('cached-skill', 'guide.pdf', { forceRefresh: true });

    expect(cached.text).toBe('cached extract');
    expect(cached.extractedBy).toBe('cached-scanner');
    expect(cached.metadata.extractedAt).toBe(extractedAt.toISOString());
    expect(scanner.calls).toBe(1);
    expect(refreshed.text).toBe('fresh extract');
    expect(refreshed.extractedBy).toBe('stub-scanner');
  });

  it('rejects unpublished versions on the public path', async () => {
    const skill = createSkill('draft-skill', SkillStatus.DRAFT, [
      ManifestFile.create({ path: 'README.md', role: 'entrypoint', mimeType: 'text/markdown', sha256: 'sha' }),
    ]);
    const repo = new Repo(skill);
    const storage = new Storage(
      new Map([
        ['draft-skill:1.0.0:README.md', { content: Buffer.from('# Draft'), mimeType: 'text/markdown' }],
      ])
    );
    const scanner = new Scanner();

    const useCase = new ExtractSkillFileContentUseCase(repo, storage, scanner);

    await expect(useCase.execute('draft-skill', 'README.md')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resolves published extracted-content reads against the sqlite catalog before falling back to the repository', async () => {
    const repo = new Repo(null);
    const storage = new Storage(
      new Map([
        ['catalog-skill:1.0.0:README.md', { content: Buffer.from('# Catalog'), mimeType: 'text/markdown' }],
      ])
    );
    const scanner = new Scanner();
    const catalog = new Catalog(createCatalogVersion({ status: SkillStatus.PUBLISHED }));

    const useCase = new ExtractSkillFileContentUseCase(repo, storage, scanner, catalog);
    const extracted = await useCase.execute('catalog-skill', 'README.md');

    expect(extracted.text).toBe('# Catalog');
    expect(storage.extracted.get('catalog-skill:1.0.0:README.md')?.text).toBe('# Catalog');
    expect(repo.findByIdCalls).toBe(0);
  });

  it('resolves unpublished admin extracted-content reads against the sqlite catalog before falling back to the repository', async () => {
    const repo = new Repo(null);
    const storage = new Storage(
      new Map([
        ['catalog-skill:1.0.1:README.md', { content: Buffer.from('# Draft Catalog'), mimeType: 'text/markdown' }],
      ])
    );
    const scanner = new Scanner();
    const catalog = new Catalog(
      createCatalogVersion({
        version: '1.0.1',
        status: SkillStatus.DRAFT,
        isLatestPublished: false,
        isLatestVersion: true,
        publishedAt: null,
      })
    );

    const useCase = new ExtractSkillFileContentUseCase(repo, storage, scanner, catalog);
    const extracted = await useCase.execute('catalog-skill', 'README.md', { includeUnpublished: true });

    expect(extracted.text).toBe('# Draft Catalog');
    expect(storage.extracted.get('catalog-skill:1.0.1:README.md')?.text).toBe('# Draft Catalog');
    expect(repo.findByIdCalls).toBe(0);
  });
});

class Repo implements SkillRepositoryPort {
  constructor(private readonly skill: Skill | null) {}

  findByIdCalls = 0;

  async save(): Promise<void> {}

  async findById(): Promise<Skill | null> {
    this.findByIdCalls += 1;
    return this.skill;
  }

  async findAll(): Promise<{ items: Skill[]; total: number }> {
    return this.skill ? { items: [this.skill], total: 1 } : { items: [], total: 0 };
  }

  async exists(): Promise<boolean> {
    return Boolean(this.skill);
  }

  async saveProposal(): Promise<void> {}

  async findProposalById() {
    return null;
  }

  async findProposals() {
    return { items: [], total: 0 };
  }

  async deleteProposal(): Promise<void> {}
}

class Storage implements SkillFileStoragePort {
  readonly extracted = new Map<string, StoredExtractedContent>();

  constructor(private readonly files: Map<string, { content: Buffer; mimeType: string }>) {}

  async storeSkillFile(): Promise<StoredFile> {
    throw new Error('not implemented');
  }

  async readSkillFile(skillId: string, version: string, path: string) {
    return this.files.get(`${skillId}:${version}:${path}`) ?? null;
  }

  async listSkillFiles(): Promise<StoredFile[]> {
    return [];
  }

  async storeSkillFileExtract(
    skillId: string,
    version: string,
    path: string,
    extracted: Omit<StoredExtractedContent, 'extractedAt'> & { extractedAt?: Date }
  ): Promise<StoredExtractedContent> {
    const stored = {
      text: extracted.text,
      extractedBy: extracted.extractedBy,
      metadata: extracted.metadata,
      extractedAt: extracted.extractedAt ?? new Date('2026-07-02T00:00:00.000Z'),
    };
    this.extracted.set(`${skillId}:${version}:${path}`, stored);
    return stored;
  }

  async readSkillFileExtract(skillId: string, version: string, path: string): Promise<StoredExtractedContent | null> {
    return this.extracted.get(`${skillId}:${version}:${path}`) ?? null;
  }

  async storeProposalFile(): Promise<StoredFile> {
    throw new Error('not implemented');
  }

  async readProposalFile() {
    return null;
  }

  async listProposalFiles(): Promise<StoredFile[]> {
    return [];
  }
}

class Scanner implements FileScannerPort {
  calls = 0;

  constructor(private readonly text = 'scanned text') {}

  supports(): boolean {
    return true;
  }

  async scan() {
    this.calls += 1;
    return {
      text: this.text,
      metadata: {},
      extractedBy: 'stub-scanner',
    };
  }
}

class Catalog implements SkillCatalogPort {
  constructor(private readonly version: CatalogSkillVersionRecord | null) {}

  async upsertSkill(): Promise<void> {}
  async upsertProposal(_proposal: Proposal): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async upsertSkillJudgement(_skillId: string, _version: string, _judgement: Judgement): Promise<void> {}
  async listJudgements() { return []; }
  async upsertAuditEntry() { return; }
  async listSkillHistory() { return []; }
  async listProposals() { return { items: [], total: 0 }; }
  async getProposal() { return null; }
  async listProposalFiles() { return []; }
  async listProposalJudgements() { return []; }
  async countPendingProposals() { return 0; }
  async rebuild(): Promise<void> {}
  async listCategories(): Promise<string[]> { return []; }
  async listLatestSkillVersions() { return { items: this.version ? [this.version] : [], total: this.version ? 1 : 0 }; }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getSkillVersion(_skillId: string, version: string): Promise<CatalogSkillVersionRecord | null> {
    return this.version?.version === version ? this.version : null;
  }
  async getLatestVersion(): Promise<CatalogSkillVersionRecord | null> { return this.version; }
  async getLatestPublishedVersion(): Promise<CatalogSkillVersionRecord | null> {
    return this.version?.status === SkillStatus.PUBLISHED ? this.version : null;
  }
  async listSkillVersions(): Promise<CatalogSkillVersionRecord[]> { return this.version ? [this.version] : []; }
  async listPublishedVersions(): Promise<CatalogSkillVersionRecord[]> {
    return this.version?.status === SkillStatus.PUBLISHED ? [this.version] : [];
  }
  async listVersionFiles() { return []; }
}

function createSkill(id: string, status: SkillStatus, files: ManifestFile[]): Skill {
  const skill = Skill.create({ id: SkillId.create(id), createdBy: 'seed' });
  const version = SkillVersion.create({
    skillId: skill.id,
    version: '1.0.0',
    createdBy: 'seed',
    manifest: Manifest.create({
      id,
      title: 'Skill',
      description: 'Desc',
      version: '1.0.0',
      status,
      category: 'automation',
      entrypoint: files[0]?.path ?? 'README.md',
      files,
    }),
  });
  skill.addVersion(version);
  if (status === SkillStatus.PUBLISHED) {
    skill.setLatestPublished(version.version);
  }
  return skill;
}

function createCatalogVersion(overrides: Partial<CatalogSkillVersionRecord>): CatalogSkillVersionRecord {
  return {
    skillId: 'catalog-skill',
    version: '1.0.0',
    title: 'Catalog Skill',
    description: 'Projected',
    category: 'automation',
    tags: ['agent'],
    capabilities: ['read'],
    useWhen: ['when useful'],
    doNotUseWhen: ['when unsafe'],
    entrypoint: 'README.md',
    status: SkillStatus.PUBLISHED,
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
