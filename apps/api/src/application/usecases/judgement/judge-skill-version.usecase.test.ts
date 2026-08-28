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
import { buildGlobalJudgementTarget, withJudgementInputFingerprint } from './judgement-input';
import { judgementErrorCategory } from './judgement-runtime-event';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileSystemAuditLog } from '../../../adapters/outbound/audit/filesystem/file-system.audit';
import { DatabaseAuditLog } from '../../../adapters/outbound/audit/database/database.audit';
import { SqliteContentDb } from '../../../adapters/outbound/persistence/database/sqlite-content-db';

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
        scope: 'global-skill-assessment',
      },
    });
    expect(judger.targets[0]?.text).toContain('"entrypoint":"README.md"');
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

  it('continues judging later files when a catalogued file is absent from storage', async () => {
    const judger = new JudgerStub();
    const audit = new AuditStub();
    const useCase = new JudgeSkillVersionUseCase(
      new RepoStub(), judger, audit, new CatalogStub(createCatalogVersion({ version: '1.0.1' })), new MissingFirstStorageStub(), new ScannerStub()
    );

    await useCase.execute('catalog-skill', '1.0.1', { actor: 'admin' });

    expect(judger.targets.map((target) => target.id)).toEqual([
      'catalog-skill:1.0.1',
      'catalog-skill:1.0.1:present.md',
    ]);
    expect(audit.entries.filter((entry) => entry.action === 'judge_skill_file')).toHaveLength(1);
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

  it('audits and emits a safe event when the skill-version judge fails', async () => {
    const audit = new AuditStub();
    const events: Array<{ outcome: string; errorCategory?: string; proposalId?: string }> = [];
    const judger: SkillJudgerPort = {
      judge: async () => {
        throw new Error('provider response containing internal details');
      },
    };
    const useCase = new JudgeSkillVersionUseCase(
      new RepoStub(),
      judger,
      audit,
      new CatalogStub(createCatalogVersion({ version: '1.0.1' })),
      undefined,
      undefined,
      (event) => events.push(event)
    );

    await expect(useCase.execute('catalog-skill', '1.0.1', {
      contextMetadata: { proposalId: 'proposal-1' },
    })).rejects.toThrow('provider response');

    expect(audit.entries[0]?.action).toBe('judge_skill_version_failed');
    expect(audit.entries[0]?.after).toEqual({ errorCategory: 'Error' });
    expect(events).toEqual([{
      event: 'judgement_execution',
      outcome: 'failure',
      operation: 'skill_version',
      skillId: 'catalog-skill',
      version: '1.0.1',
      proposalId: 'proposal-1',
      errorCategory: 'Error',
    }]);
  });

  it('reuses a canonically matching proposal judgement during conversion without calling the provider', async () => {
    const catalogVersion = createCatalogVersion({ version: '1.0.1' });
    const reusableTarget = buildGlobalJudgementTarget({
      targetType: 'proposal',
      targetId: 'proposal-before-conversion',
      title: catalogVersion.title,
      description: catalogVersion.description,
      category: catalogVersion.category,
      tags: catalogVersion.tags,
      capabilities: catalogVersion.capabilities,
      useWhen: catalogVersion.useWhen,
      doNotUseWhen: catalogVersion.doNotUseWhen,
      entrypoint: catalogVersion.entrypoint,
      files: [{ path: 'README.md', role: 'entrypoint', mimeType: 'text/markdown', sizeBytes: 12, sha256: 'sha' }],
    });
    const proposalJudgement = withJudgementInputFingerprint(
      Judgement.create({
        id: 'proposal-global-judgement',
        targetType: 'proposal',
        targetId: reusableTarget.id,
        summary: 'reusable proposal judgement',
        model: 'stub-judger',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        dimensions: {
          harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
          promptInjection: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
          dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
          policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
        },
      }),
      reusableTarget
    );
    const judger: SkillJudgerPort = {
      modelIdentity: 'stub-judger',
      judge: async () => { throw new Error('provider must not run for a matching input'); },
    };
    const audit = new AuditStub();
    const useCase = new JudgeSkillVersionUseCase(new RepoStub(), judger, audit, new CatalogStub(catalogVersion));

    const judgement = await useCase.execute('catalog-skill', '1.0.1', { reuseJudgements: [proposalJudgement] });

    expect(judgement.targetType).toBe('skill');
    expect(judgement.targetId).toBe('catalog-skill:1.0.1');
    expect(judgement.summary).toBe('reusable proposal judgement');
    expect(audit.entries.some((entry) => entry.action === 'reuse_skill_judgement')).toBe(true);
  });

  it('does not persist a raw file-judge error in audit history', async () => {
    const audit = new AuditStub();
    const useCase = new JudgeSkillVersionUseCase(
      new RepoStub(),
      new JudgerStub(),
      audit,
      new CatalogStub(createCatalogVersion({ version: '1.0.1' })),
      new FailingFileStorageStub(),
      new FailingScannerStub()
    );

    await useCase.execute('catalog-skill', '1.0.1');

    const failed = audit.entries.find((entry) => entry.action === 'judge_skill_file_failed');
    expect(failed?.after).toEqual({ file: 'unsafe.pdf', errorCategory: 'UnexpectedError' });
    expect(JSON.stringify(failed)).not.toContain('sensitive-provider-detail');
    expect(JSON.stringify(failed)).not.toContain('SENTINEL_SECRET');
  });

  it('keeps a scanner sentinel out of the raw filesystem audit representation', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'judgement-audit-sentinel-'));
    try {
      const useCase = new JudgeSkillVersionUseCase(
        new RepoStub(), new JudgerStub(), new FileSystemAuditLog(dataDir),
        new CatalogStub(createCatalogVersion({ version: '1.0.1' })),
        new FailingFileStorageStub(), new FailingScannerStub()
      );
      await useCase.execute('catalog-skill', '1.0.1');
      const raw = readFileSync(path.join(dataDir, 'audit', 'catalog-skill.jsonl'), 'utf8');
      expect(raw).toContain('errorCategory');
      expect(raw).not.toContain('sensitive-provider-detail');
      expect(raw).not.toContain('SENTINEL_SECRET');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('keeps a scanner sentinel out of the raw database audit representation', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'judgement-db-audit-sentinel-'));
    const contentDb = new SqliteContentDb(path.join(dataDir, 'content.db'));
    try {
      const useCase = new JudgeSkillVersionUseCase(
        new RepoStub(), new JudgerStub(), new DatabaseAuditLog(contentDb),
        new CatalogStub(createCatalogVersion({ version: '1.0.1' })),
        new FailingFileStorageStub(), new FailingScannerStub()
      );
      await useCase.execute('catalog-skill', '1.0.1');
      const row = await contentDb.queryOne<{ after_json: string }>("SELECT after_json FROM content_audit_entries WHERE action = 'judge_skill_file_failed'");
      expect(row?.after_json).toContain('errorCategory');
      expect(row?.after_json).not.toContain('sensitive-provider-detail');
      expect(row?.after_json).not.toContain('SENTINEL_SECRET');
    } finally {
      contentDb.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('does not turn an adapter-controlled error name into persisted audit data', () => {
    const adapterError = Object.assign(new Error('sensitive-provider-detail'), { name: 'SENTINEL_SECRET' });

    expect(judgementErrorCategory(adapterError)).toBe('UnexpectedError');
    expect(judgementErrorCategory(adapterError)).not.toContain('SENTINEL_SECRET');
  });

  it('keeps legacy context text in the canonical target and therefore does not reuse a context-free judgement', async () => {
    const catalogVersion = createCatalogVersion({ version: '1.0.1' });
    const target = buildGlobalJudgementTarget({
      targetType: 'proposal', targetId: 'proposal-context-free', title: catalogVersion.title,
      description: catalogVersion.description, category: catalogVersion.category, tags: catalogVersion.tags,
      capabilities: catalogVersion.capabilities, useWhen: catalogVersion.useWhen,
      doNotUseWhen: catalogVersion.doNotUseWhen, entrypoint: catalogVersion.entrypoint,
      files: [{ path: 'README.md', role: 'entrypoint', mimeType: 'text/markdown', sizeBytes: 12, sha256: 'sha' }],
    });
    const sourceJudger = new JudgerStub();
    const reusable = withJudgementInputFingerprint(await sourceJudger.judge(target), target);
    const judger = new JudgerStub();
    const useCase = new JudgeSkillVersionUseCase(new RepoStub(), judger, new AuditStub(), new CatalogStub(catalogVersion));

    await useCase.execute('catalog-skill', '1.0.1', { contextText: 'legacy conversion context', reuseJudgements: [reusable] });

    expect(judger.targets).toHaveLength(1);
    expect(judger.targets[0]?.text).toContain('legacy conversion context');
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
  readonly modelIdentity = 'stub-judger';
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

class MissingFirstStorageStub extends StorageStub {
  override async readSkillFile(_skillId: string, _version: string, path: string): Promise<{ content: Buffer; mimeType: string } | null> {
    if (path === 'missing.md') return null;
    return { content: Buffer.from('# present\ncontent'), mimeType: 'text/markdown' };
  }

  override async listSkillFiles(): Promise<StoredFile[]> {
    return [
      { path: 'missing.md', mimeType: 'text/markdown', sizeBytes: 0, sha256: 'missing', updatedAt: null },
      { path: 'present.md', mimeType: 'text/markdown', sizeBytes: 17, sha256: 'present', updatedAt: null },
    ];
  }
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

class FailingFileStorageStub extends PythonStorageStub {
  async readSkillFile(): Promise<{ content: Buffer; mimeType: string } | null> {
    return { content: Buffer.from('binary'), mimeType: 'application/pdf' };
  }

  async listSkillFiles(): Promise<StoredFile[]> {
    return [{ path: 'unsafe.pdf', mimeType: 'application/pdf', sizeBytes: 6, sha256: 'unsafe', updatedAt: null }];
  }
}

class ScannerStub implements FileScannerPort {
  async scan(content: Buffer): Promise<ScannedContent> {
    return { text: content.toString('utf-8'), metadata: {}, extractedBy: 'scanner-stub' };
  }

  supports(): boolean {
    return true;
  }
}

class FailingScannerStub extends ScannerStub {
  async scan(): Promise<ScannedContent> {
    throw Object.assign(new Error('sensitive-provider-detail'), { name: 'SENTINEL_SECRET' });
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
