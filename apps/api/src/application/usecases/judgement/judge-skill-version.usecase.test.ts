import { describe, expect, it } from 'vitest';
import { JudgeSkillVersionUseCase } from './judge-skill-version.usecase';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillJudgerPort, JudgementTarget } from '../../ports/outbound/judger.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { SkillCatalogPort, CatalogSkillVersionRecord } from '../../ports/outbound/skill-catalog.port';
import { Skill } from '../../../domain/skill/Skill';
import { Proposal } from '../../../domain/proposal/Proposal';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { FileScannerPort, ScannedContent } from '../../ports/outbound/file-scanner.port';

describe('JudgeSkillVersionUseCase', () => {
  it('uses sqlite-projected skill version metadata when available', async () => {
    const catalogVersion = createCatalogVersion({
      version: '1.0.1',
      status: 'draft',
      isLatestPublished: false,
      isLatestVersion: true,
      publishedAt: null,
    });
    const repo = new RepoStub();
    const judger = new JudgerStub();
    const audit = new AuditStub();
    const catalog = new CatalogStub(catalogVersion);
    const useCase = new JudgeSkillVersionUseCase(repo, judger, audit, catalog);

    const judgement = await useCase.execute('catalog-skill', '1.0.1');

    expect(judgement.targetType).toBe('skill');
    expect(repo.findByIdCalls).toBe(0);
    expect(judger.targets).toHaveLength(1);
    expect(judger.targets[0]).toMatchObject({
      type: 'skill',
      id: 'catalog-skill:1.0.1',
      title: 'Catalog Skill',
      metadata: {
        skillId: 'catalog-skill',
        version: '1.0.1',
        groups: ['automation', 'agent'],
        capabilities: ['read'],
        status: 'draft',
      },
    });
    expect(judger.targets[0]?.text).toContain('"entrypoint": "README.md"');
    expect(audit.entries).toHaveLength(1);
    expect(catalog.upserted).toEqual([{ skillId: 'catalog-skill', version: '1.0.1', judgementId: judgement.id }]);
  });

  it('judges and stores individual skill files when storage and scanner are available', async () => {
    const catalogVersion = createCatalogVersion({ version: '1.0.1' });
    const repo = new RepoStub();
    const judger = new JudgerStub();
    const audit = new AuditStub();
    const catalog = new CatalogStub(catalogVersion);
    const storage = new StorageStub();
    const scanner = new ScannerStub();
    const useCase = new JudgeSkillVersionUseCase(repo, judger, audit, catalog, storage, scanner);

    await useCase.execute('catalog-skill', '1.0.1', { actor: 'admin' });

    expect(judger.targets.map((target) => target.id)).toEqual([
      'catalog-skill:1.0.1',
      'catalog-skill:1.0.1:README.md',
    ]);
    expect(catalog.upserted).toEqual([
      { skillId: 'catalog-skill', version: '1.0.1', judgementId: 'judge-skill' },
      { skillId: 'catalog-skill', version: '1.0.1', judgementId: 'judge-file' },
    ]);
    expect(audit.entries.some((entry) => entry.action === 'judge_skill_file')).toBe(true);
  });

  it('judges python files as text-like artifacts even when their mime type is text/x-python', async () => {
    const catalogVersion = createCatalogVersion({ version: '1.0.1' });
    const repo = new RepoStub();
    const judger = new JudgerStub();
    const audit = new AuditStub();
    const catalog = new CatalogStub(catalogVersion);
    const storage = new PythonStorageStub();
    const scanner = new ScannerStub();
    const useCase = new JudgeSkillVersionUseCase(repo, judger, audit, catalog, storage, scanner);

    await useCase.execute('catalog-skill', '1.0.1', { actor: 'admin' });

    expect(judger.targets.map((target) => target.id)).toEqual([
      'catalog-skill:1.0.1',
      'catalog-skill:1.0.1:build.py',
    ]);
    expect(judger.targets[1]?.text).toContain('python');
    expect(audit.entries.some((entry) => entry.action === 'judge_skill_file')).toBe(true);
  });
});

class RepoStub implements SkillRepositoryPort {
  findByIdCalls = 0;

  async save(_skill: Skill): Promise<void> {}
  async findById(): Promise<Skill | null> {
    this.findByIdCalls += 1;
    throw new Error('repository should not be used for catalog-backed judge-skill-version');
  }
  async findAll(): Promise<{ items: Skill[]; total: number }> { return { items: [], total: 0 }; }
  async exists(): Promise<boolean> { return false; }
  async saveProposal(): Promise<void> {}
  async findProposalById() { return null; }
  async findProposals() { return { items: [], total: 0 }; }
  async deleteProposal(): Promise<void> {}
}

class JudgerStub implements SkillJudgerPort {
  targets: JudgementTarget[] = [];

  async judge(target: JudgementTarget): Promise<Judgement> {
    this.targets.push(target);
    return Judgement.create({
      id: target.type === 'file' ? 'judge-file' : 'judge-skill',
      targetType: target.type,
      targetId: target.id,
      summary: 'catalog judgement',
      model: 'stub-judger',
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      dimensions: {
        harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
        promptInjection: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
        dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
        policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
      },
    });
  }
}

class StorageStub implements SkillFileStoragePort {
  async storeSkillFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readSkillFile(_skillId: string, _version: string, path: string): Promise<{ content: Buffer; mimeType: string } | null> {
    return { content: Buffer.from(`# ${path}\ncontent`), mimeType: 'text/markdown' };
  }
  async listSkillFiles(): Promise<StoredFile[]> {
    return [
      {
        path: 'README.md',
        mimeType: 'text/markdown',
        sizeBytes: 18,
        sha256: 'sha',
        updatedAt: null,
      },
    ];
  }
  async storeSkillFileExtract(): Promise<StoredExtractedContent> { throw new Error('not implemented'); }
  async readSkillFileExtract(): Promise<StoredExtractedContent | null> { return null; }
  async storeProposalFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readProposalFile(): Promise<{ content: Buffer; mimeType: string } | null> { return null; }
  async listProposalFiles(): Promise<StoredFile[]> { return []; }
  async storeProposalFileExtract(): Promise<StoredExtractedContent> { throw new Error('not implemented'); }
  async readProposalFileExtract(): Promise<StoredExtractedContent | null> { return null; }
}

class PythonStorageStub implements SkillFileStoragePort {
  async storeSkillFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readSkillFile(): Promise<{ content: Buffer; mimeType: string } | null> {
    return { content: Buffer.from('print("python")'), mimeType: 'text/x-python' };
  }
  async listSkillFiles(): Promise<StoredFile[]> {
    return [
      {
        path: 'build.py',
        mimeType: 'text/x-python',
        sizeBytes: 15,
        sha256: 'sha-py',
        updatedAt: null,
      },
    ];
  }
  async storeSkillFileExtract(): Promise<StoredExtractedContent> { throw new Error('not implemented'); }
  async readSkillFileExtract(): Promise<StoredExtractedContent | null> { return null; }
  async storeProposalFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readProposalFile(): Promise<{ content: Buffer; mimeType: string } | null> { return null; }
  async listProposalFiles(): Promise<StoredFile[]> { return []; }
  async storeProposalFileExtract(): Promise<StoredExtractedContent> { throw new Error('not implemented'); }
  async readProposalFileExtract(): Promise<StoredExtractedContent | null> { return null; }
}

class ScannerStub implements FileScannerPort {
  async scan(content: Buffer): Promise<ScannedContent> {
    return { text: content.toString('utf-8'), metadata: {}, extractedBy: 'scanner-stub' };
  }

  supports(): boolean {
    return true;
  }
}

class AuditStub implements AuditLogPort {
  entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async findBySkillId(): Promise<AuditEntry[]> { return []; }
  async findByProposalId(): Promise<AuditEntry[]> { return []; }
  async findAll(): Promise<AuditEntry[]> { return this.entries; }
}

class CatalogStub implements SkillCatalogPort {
  upserted: Array<{ skillId: string; version: string; judgementId: string }> = [];

  constructor(private readonly version: CatalogSkillVersionRecord) {}

  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: Proposal): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async upsertSkillJudgement(skillId: string, version: string, judgement: Judgement): Promise<void> {
    this.upserted.push({ skillId, version, judgementId: judgement.id });
  }
  async listJudgements() { return []; }
  async upsertAuditEntry() {}
  async listSkillHistory() { return []; }
  async listProposals() { return { items: [], total: 0 }; }
  async getProposal() { return null; }
  async listProposalFiles() { return []; }
  async listProposalJudgements() { return []; }
  async countPendingProposals() { return 0; }
  async rebuild(_skills: Skill[]): Promise<void> {}
  async listCategories(): Promise<string[]> { return []; }
  async listLatestSkillVersions() { return { items: [this.version], total: 1 }; }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getSkillVersion(skillId: string, version: string): Promise<CatalogSkillVersionRecord | null> {
    return this.version.skillId === skillId && this.version.version === version ? this.version : null;
  }
  async getLatestVersion() { return this.version; }
  async getLatestPublishedVersion() { return null; }
  async listSkillVersions() { return [this.version]; }
  async listPublishedVersions() { return []; }
  async listVersionFiles() {
    return [
      {
        skillId: 'catalog-skill',
        version: '1.0.1',
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
