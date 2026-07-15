import { describe, expect, it } from 'vitest';
import { SkillQueryAdapter } from './skill-query.adapter';
import { SkillCatalogPort, CatalogSkillVersionRecord } from '../../ports/outbound/skill-catalog.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillSearchPort } from '../../ports/outbound/search.port';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { Skill } from '../../../domain/skill/Skill';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { Proposal } from '../../../domain/proposal/Proposal';
import { Judgement } from '../../../domain/judgement/Judgement';

describe('SkillQueryAdapter', () => {
  it('uses sqlite catalog metadata for search results and avoids repository rehydration', async () => {
    const latestPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: true,
      tags: ['catalog-tag'],
      contentDigest: 'catalog-digest',
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestPublished,
      versions: [latestPublished],
      latestList: [latestPublished],
      versionByKey: {
        'catalog-skill:1.0.0': latestPublished,
      },
    });
    const repo = new RepoStub();
    const adapter = new SkillQueryAdapter(
      repo,
      new SearchStub({
        items: [
          {
            skillId: 'catalog-skill',
            version: '1.0.0',
            title: 'Catalog Skill',
            description: 'Search result',
            groups: ['search-category', 'search-tag'],
            publishedAt: new Date('2026-07-02T10:00:00.000Z'),
            score: 0.9,
          },
        ],
        total: 1,
      }),
      new StorageStub(),
      new AuditStub(),
      catalog
    );

    const result = await adapter.search({
      q: 'catalog',
      mode: 'keyword',
      limit: 20,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: 'catalog-skill',
      category: 'automation',
      tags: ['catalog-tag'],
      skillUuid: 'skill-uuid',
      versionUuid: 'version-uuid',
      contentDigest: 'catalog-digest',
    });
    expect(repo.findByIdCalls).toBe(0);
  });

  it('deduplicates public search results by skill and displays the latest published version', async () => {
    const previousPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: false,
      isLatestVersion: false,
      versionUuid: 'previous-version-uuid',
    });
    const latestPublished = createCatalogVersion({
      version: '1.0.1',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: true,
      versionUuid: 'latest-version-uuid',
      contentDigest: 'latest-digest',
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestPublished,
      versions: [previousPublished, latestPublished],
      latestList: [latestPublished],
      versionByKey: {
        'catalog-skill:1.0.0': previousPublished,
        'catalog-skill:1.0.1': latestPublished,
      },
    });
    const adapter = new SkillQueryAdapter(
      new RepoStub(),
      new SearchStub({
        items: [
          {
            skillId: 'catalog-skill',
            version: '1.0.0',
            title: 'Catalog Skill',
            description: 'Older match',
            groups: ['automation'],
            publishedAt: new Date('2026-07-02T10:00:00.000Z'),
            score: 0.2,
          },
          {
            skillId: 'catalog-skill',
            version: '1.0.1',
            title: 'Catalog Skill',
            description: 'Latest match',
            groups: ['automation'],
            publishedAt: new Date('2026-07-03T10:00:00.000Z'),
            score: 0.3,
          },
        ],
        total: 2,
      }),
      new StorageStub(),
      new AuditStub(),
      catalog
    );

    const result = await adapter.search({
      q: 'video',
      mode: 'keyword',
      limit: 20,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'catalog-skill',
      version: '1.0.1',
      versionUuid: 'latest-version-uuid',
      contentDigest: 'latest-digest',
      score: 0.3,
    });
  });

  it('serves public summaries and detail directly from the sqlite catalog when available', async () => {
    const latestPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: false,
      publishedAt: new Date('2026-07-02T10:00:00.000Z'),
    });
    const latestDraft = createCatalogVersion({
      version: '1.0.1',
      status: 'draft',
      isLatestPublished: false,
      isLatestVersion: true,
      publishedAt: null,
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestDraft,
      versions: [latestPublished],
      latestList: [latestPublished],
    });
    const adapter = new SkillQueryAdapter(new RepoStub(), new SearchStub(), new StorageStub(), new AuditStub(), catalog);

    const summaries = await adapter.listPublishedSummaries();
    const detail = await adapter.getSkillDetail('catalog-skill');
    const manifest = await adapter.getManifest('catalog-skill');
    const files = await adapter.listFiles('catalog-skill');

    expect(summaries.total).toBe(1);
    expect(summaries.items[0]).toMatchObject({
      id: 'catalog-skill',
      version: '1.0.0',
      status: 'published',
      title: 'Catalog Skill',
    });
    expect(detail).toMatchObject({
      id: 'catalog-skill',
      latestPublishedVersion: '1.0.0',
      title: 'Catalog Skill',
      entrypoint: 'README.md',
      useWhen: ['when useful'],
      doNotUseWhen: ['when unsafe'],
    });
    expect(detail?.versions).toHaveLength(1);
    expect(manifest?.entrypoint).toBe('README.md');
    expect(manifest?.useWhen).toEqual(['when useful']);
    expect(files[0]).toMatchObject({
      path: 'README.md',
      role: 'entrypoint',
      mimeType: 'text/markdown',
    });
  });

  it('builds a public skill aggregate directly from the sqlite catalog when available', async () => {
    const latestPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: true,
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestPublished,
      versions: [latestPublished],
      latestList: [latestPublished],
      versionByKey: {
        'catalog-skill:1.0.0': latestPublished,
      },
    });
    const repo = new RepoStub();
    const adapter = new SkillQueryAdapter(repo, new SearchStub(), new StorageStub(), new AuditStub(), catalog);

    const skill = await adapter.getSkill('catalog-skill');

    expect(skill?.id.toString()).toBe('catalog-skill');
    expect(skill?.getLatestPublishedVersion()?.version).toBe('1.0.0');
    expect(skill?.getLatestPublishedVersion()?.manifest.entrypoint).toBe('README.md');
    expect(repo.findByIdCalls).toBe(0);
  });

  it('serves skill history from the sqlite catalog when available', async () => {
    const latestPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: true,
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestPublished,
      versions: [latestPublished],
      latestList: [latestPublished],
      history: [
        AuditEntry.create({
          id: 'audit-1',
          skillId: 'catalog-skill',
          skillVersion: '1.0.0',
          action: 'publish_skill',
          actor: 'admin',
          createdAt: new Date('2026-07-02T12:00:00.000Z'),
        }),
      ],
    });
    const adapter = new SkillQueryAdapter(new RepoStub(), new SearchStub(), new StorageStub(), new AuditStub(), catalog);

    const history = await adapter.getHistory('catalog-skill');

    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe('audit-1');
    expect(history[0]?.action).toBe('publish_skill');
  });

  it('filters sqlite skill history to publicly visible published versions only', async () => {
    const published = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: false,
    });
    const draft = createCatalogVersion({
      version: '1.0.1',
      status: 'draft',
      isLatestPublished: false,
      isLatestVersion: true,
      publishedAt: null,
      publishedBy: null,
    });
    const catalog = new CatalogStub({
      latestPublished: published,
      latestVersion: draft,
      versions: [published, draft],
      latestList: [published],
      history: [
        AuditEntry.create({
          id: 'audit-skill',
          skillId: 'catalog-skill',
          skillVersion: null,
          action: 'create_skill',
          actor: 'admin',
          createdAt: new Date('2026-07-02T09:00:00.000Z'),
        }),
        AuditEntry.create({
          id: 'audit-published',
          skillId: 'catalog-skill',
          skillVersion: '1.0.0',
          action: 'publish_skill',
          actor: 'admin',
          createdAt: new Date('2026-07-02T10:00:00.000Z'),
        }),
        AuditEntry.create({
          id: 'audit-draft',
          skillId: 'catalog-skill',
          skillVersion: '1.0.1',
          action: 'update_skill',
          actor: 'admin',
          createdAt: new Date('2026-07-02T11:00:00.000Z'),
        }),
      ],
    });
    const adapter = new SkillQueryAdapter(new RepoStub(), new SearchStub(), new StorageStub(), new AuditStub(), catalog);

    const history = await adapter.getHistory('catalog-skill');

    expect(history.map((entry) => entry.id)).toEqual(['audit-skill', 'audit-published']);
  });

  it('returns empty public sqlite history for skills without a published version', async () => {
    const draft = createCatalogVersion({
      version: '1.0.1',
      status: 'draft',
      isLatestPublished: false,
      isLatestVersion: true,
      publishedAt: null,
      publishedBy: null,
    });
    const catalog = new CatalogStub({
      latestPublished: null,
      latestVersion: draft,
      versions: [draft],
      latestList: [],
      history: [
        AuditEntry.create({
          id: 'audit-draft',
          skillId: 'catalog-skill',
          skillVersion: '1.0.1',
          action: 'update_skill',
          actor: 'admin',
          createdAt: new Date('2026-07-02T11:00:00.000Z'),
        }),
      ],
    });
    const repo = new RepoStub();
    const audit = new AuditStub();
    const adapter = new SkillQueryAdapter(repo, new SearchStub(), new StorageStub(), audit, catalog);

    const history = await adapter.getHistory('catalog-skill');

    expect(history).toEqual([]);
    expect(repo.findByIdCalls).toBe(0);
    expect(audit.findBySkillIdCalls).toBe(0);
  });

  it('treats empty sqlite skill history as authoritative without audit or repository fallback', async () => {
    const latestPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: true,
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestPublished,
      versions: [latestPublished],
      latestList: [latestPublished],
      history: [],
    });
    const repo = new RepoStub();
    const audit = new AuditStub();
    const adapter = new SkillQueryAdapter(repo, new SearchStub(), new StorageStub(), audit, catalog);

    const history = await adapter.getHistory('catalog-skill');

    expect(history).toEqual([]);
    expect(repo.findByIdCalls).toBe(0);
    expect(audit.findBySkillIdCalls).toBe(0);
  });

  it('resolves public file downloads against the sqlite catalog before reading storage', async () => {
    const latestPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: true,
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestPublished,
      versions: [latestPublished],
      latestList: [latestPublished],
      versionByKey: {
        'catalog-skill:1.0.0': latestPublished,
      },
    });
    const repo = new RepoStub();
    const storage = new StorageStub({
      'catalog-skill:1.0.0:README.md': {
        content: Buffer.from('hello'),
        mimeType: 'text/markdown',
      },
    });
    const adapter = new SkillQueryAdapter(repo, new SearchStub(), storage, new AuditStub(), catalog);

    const file = await adapter.getFile('catalog-skill', 'README.md', '1.0.0');

    expect(file).toMatchObject({
      path: 'README.md',
      mimeType: 'text/markdown',
    });
    expect(file?.content.toString('utf8')).toBe('hello');
    expect(storage.readSkillFileCalls).toEqual([{ skillId: 'catalog-skill', version: '1.0.0', fileId: 'README.md' }]);
    expect(repo.findByIdCalls).toBe(0);
  });

  it('serves public version summaries from the sqlite catalog', async () => {
    const latestPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: true,
      publishedBy: 'admin',
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestPublished,
      versions: [latestPublished],
      latestList: [latestPublished],
      versionByKey: {
        'catalog-skill:1.0.0': latestPublished,
      },
    });
    const repo = new RepoStub();
    const adapter = new SkillQueryAdapter(repo, new SearchStub(), new StorageStub(), new AuditStub(), catalog);

    const versions = await adapter.listVersions('catalog-skill');

    expect(versions).toEqual([
      expect.objectContaining({
        version: '1.0.0',
        versionUuid: 'version-uuid',
        contentDigest: 'digest',
        status: 'published',
        approvedBy: 'admin',
        publishedBy: 'admin',
      }),
    ]);
    expect(repo.findByIdCalls).toBe(0);
  });

  it('builds published skill aggregates for listPublished directly from the sqlite catalog', async () => {
    const latestPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: true,
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestPublished,
      versions: [latestPublished],
      latestList: [latestPublished],
      versionByKey: {
        'catalog-skill:1.0.0': latestPublished,
      },
    });
    const repo = new RepoStub();
    const adapter = new SkillQueryAdapter(repo, new SearchStub(), new StorageStub(), new AuditStub(), catalog);

    const result = await adapter.listPublished();

    expect(result.total).toBe(1);
    expect(result.items[0]?.id.toString()).toBe('catalog-skill');
    expect(result.items[0]?.getLatestPublishedVersion()?.version).toBe('1.0.0');
    expect(repo.findByIdCalls).toBe(0);
  });

  it('treats an empty sqlite category list as authoritative without repository fallback', async () => {
    const latestPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: true,
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestPublished,
      versions: [latestPublished],
      latestList: [latestPublished],
      categories: [],
    });
    const repo = new RepoStub();
    const adapter = new SkillQueryAdapter(repo, new SearchStub(), new StorageStub(), new AuditStub(), catalog);

    const categories = await adapter.listCategories();

    expect(categories).toEqual([]);
    expect(repo.findAllCalls).toBe(0);
  });

  it('returns tag suggestions from the sqlite catalog without repository fallback', async () => {
    const latestPublished = createCatalogVersion({
      version: '1.0.0',
      status: 'published',
      isLatestPublished: true,
      isLatestVersion: true,
      tags: ['video', 'ffmpeg'],
    });
    const catalog = new CatalogStub({
      latestPublished,
      latestVersion: latestPublished,
      versions: [latestPublished],
      latestList: [latestPublished],
      tags: ['ffmpeg', 'video'],
    });
    const repo = new RepoStub();
    const adapter = new SkillQueryAdapter(repo, new SearchStub(), new StorageStub(), new AuditStub(), catalog);

    const tags = await adapter.listTags();

    expect(tags).toEqual(['ffmpeg', 'video']);
    expect(repo.findAllCalls).toBe(0);
  });
});

class CatalogStub implements SkillCatalogPort {
  constructor(
    private readonly state: {
      latestPublished: CatalogSkillVersionRecord | null;
      latestVersion: CatalogSkillVersionRecord | null;
      versions: CatalogSkillVersionRecord[];
      latestList: CatalogSkillVersionRecord[];
      history?: AuditEntry[];
      versionByKey?: Record<string, CatalogSkillVersionRecord>;
      categories?: string[];
      tags?: string[];
    }
  ) {}

  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: Proposal): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async upsertSkillJudgement(_skillId: string, _version: string, _judgement: Judgement): Promise<void> {}
  async listJudgements() { return []; }
  async upsertAuditEntry(_entry: AuditEntry): Promise<void> {}
  async listProposals() { return { items: [], total: 0 }; }
  async getProposal() { return null; }
  async listProposalFiles() { return []; }
  async listProposalJudgements() { return []; }
  async countPendingProposals() { return 0; }
  async countProposalsByStatus(): Promise<Record<ProposalStatus, number>> {
    return { in_upload: 0, submitted: 0, judged: 0, converted: 0 };
  }
  async listSkillHistory() {
    return (this.state.history ?? []).map((entry) => ({
      id: entry.id,
      skillId: entry.skillId,
      skillVersion: entry.skillVersion,
      proposalId: entry.proposalId,
      action: entry.action,
      actor: entry.actor,
      before: entry.before,
      after: entry.after,
      createdAt: entry.createdAt,
    }));
  }
  async rebuild(_skills: Skill[]): Promise<void> {}
  async listCategories(): Promise<string[]> { return this.state.categories ?? ['automation']; }
  async listTags(): Promise<string[]> { return this.state.tags ?? ['catalog-tag']; }
  async listLatestSkillVersions(): Promise<{ items: CatalogSkillVersionRecord[]; total: number }> {
    return { items: this.state.latestList, total: this.state.latestList.length };
  }
  async listPublishedSkillRefs(): Promise<{ items: { skillId: string; version: string }[]; total: number }> {
    return { items: [], total: 0 };
  }
  async getSkillVersion(skillId: string, version: string): Promise<CatalogSkillVersionRecord | null> {
    return this.state.versionByKey?.[`${skillId}:${version}`] ?? null;
  }
  async getLatestVersion(): Promise<CatalogSkillVersionRecord | null> {
    return this.state.latestVersion;
  }
  async getLatestPublishedVersion(): Promise<CatalogSkillVersionRecord | null> {
    return this.state.latestPublished;
  }
  async listSkillVersions(): Promise<CatalogSkillVersionRecord[]> {
    return this.state.versions;
  }
  async listPublishedVersions(): Promise<CatalogSkillVersionRecord[]> {
    return this.state.versions.filter((version) => version.status === 'published');
  }
  async listVersionFiles() {
    return [
      {
        skillId: 'catalog-skill',
        version: '1.0.0',
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
  findAllCalls = 0;

  async save(_skill: Skill): Promise<void> {}
  async findById(): Promise<Skill | null> {
    this.findByIdCalls += 1;
    return null;
  }
  async findAll(): Promise<{ items: Skill[]; total: number }> {
    this.findAllCalls += 1;
    return { items: [], total: 0 };
  }
  async exists(): Promise<boolean> { return false; }
  async saveProposal(): Promise<void> {}
  async findProposalById() { return null; }
  async findProposals() { return { items: [], total: 0 }; }
  async deleteProposal(): Promise<void> {}
}

class SearchStub implements SkillSearchPort {
  constructor(
    private readonly result: {
      items: Array<{
        skillId: string;
        version: string;
        title: string;
        description: string;
        groups: string[];
        publishedAt: Date;
        score: number | null;
      }>;
      total: number;
    } = { items: [], total: 0 }
  ) {}

  async search() { return this.result; }
  async indexVersion(): Promise<void> {}
  async removeVersion(): Promise<void> {}
  async reindexAll(): Promise<void> {}
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

class AuditStub implements AuditLogPort {
  findBySkillIdCalls = 0;

  async append(_entry: AuditEntry): Promise<void> {}
  async findBySkillId(): Promise<AuditEntry[]> {
    this.findBySkillIdCalls += 1;
    return [];
  }
  async findByProposalId(): Promise<AuditEntry[]> { return []; }
  async findAll(): Promise<AuditEntry[]> { return []; }
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
