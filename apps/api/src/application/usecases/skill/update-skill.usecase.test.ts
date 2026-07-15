import { describe, expect, it } from 'vitest';
import { UpdateSkillUseCase } from './update-skill.usecase';
import { Skill } from '../../../domain/skill/Skill';
import { SkillId } from '../../../domain/skill/SkillId';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { Manifest } from '../../../domain/skill/Manifest';
import { ManifestFile } from '../../../domain/skill/ManifestFile';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { ValidationError } from '../../../domain/errors';
import { CatalogSkillVersionRecord, SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { Proposal } from '../../../domain/proposal/Proposal';
import { Judgement } from '../../../domain/judgement/Judgement';

describe('UpdateSkillUseCase', () => {
  it('creates a new draft patch version with copied files and patched metadata', async () => {
    const skill = createSkill();
    const repo = new Repo(skill);
    const storage = new Storage();
    const audit = new Audit();
    const useCase = new UpdateSkillUseCase(repo, storage, audit);

    const updated = await useCase.updateSkill(
      'update-skill',
      {
        title: 'Updated Title',
        category: 'review',
        tags: ['beta'],
      },
      'admin'
    );

    expect(updated.getAllVersions()).toHaveLength(2);
    expect(updated.getAllVersions()[1]?.version).toBe('1.0.1');
    expect(updated.getAllVersions()[1]?.manifest.title).toBe('Updated Title');
    expect(updated.getAllVersions()[1]?.manifest.category).toBe('review');
    expect(updated.getAllVersions()[1]?.manifest.tags).toEqual(['beta']);
    expect(storage.copiedPaths).toContain('update-skill:1.0.1:README.md');
    expect(audit.entries.some((entry) => entry.action === 'update_skill')).toBe(true);
  });

  it('creates a new draft patch version when uploading a file', async () => {
    const skill = createSkill();
    const repo = new Repo(skill);
    const storage = new Storage();
    const audit = new Audit();
    const useCase = new UpdateSkillUseCase(repo, storage, audit);

    const updated = await useCase.uploadFile(
      'update-skill',
      '1.0.0',
      {
        path: 'docs/guide.md',
        role: 'knowledge',
        content: Buffer.from('guide'),
        mimeType: 'text/markdown',
      },
      'admin'
    );

    expect(updated.getAllVersions()).toHaveLength(2);
    expect(updated.getAllVersions()[1]?.version).toBe('1.0.1');
    expect(updated.getAllVersions()[1]?.manifest.files.map((file) => file.path)).toContain('docs/guide.md');
    expect(storage.copiedPaths).toContain('update-skill:1.0.1:docs/guide.md');
    expect(audit.entries.some((entry) => entry.action === 'upload_skill_file')).toBe(true);
  });

  it('normalizes valid relative paths when uploading a skill file', async () => {
    const skill = createSkill();
    const repo = new Repo(skill);
    const storage = new Storage();
    const audit = new Audit();
    const useCase = new UpdateSkillUseCase(repo, storage, audit);

    const updated = await useCase.uploadFile(
      'update-skill',
      '1.0.0',
      {
        path: 'scripts\\\\nested//build.py',
        role: 'attachment',
        content: Buffer.from('print("hi")'),
        mimeType: 'text/x-python',
      },
      'admin'
    );

    expect(updated.getAllVersions()[1]?.manifest.files.map((file) => file.path)).toContain('scripts/nested/build.py');
    expect(storage.copiedPaths).toContain('update-skill:1.0.1:scripts/nested/build.py');
  });

  it('replaces existing file content while preserving the existing role', async () => {
    const skill = createSkill();
    const repo = new Repo(skill);
    const storage = new Storage();
    const audit = new Audit();
    const useCase = new UpdateSkillUseCase(repo, storage, audit);

    const updated = await useCase.uploadFile(
      'update-skill',
      '1.0.0',
      {
        path: 'docs/guide.md',
        content: Buffer.from('updated guide'),
        mimeType: 'text/markdown',
      },
      'admin'
    );

    const replaced = updated.getAllVersions()[1]?.manifest.files.find((file) => file.path === 'docs/guide.md');
    expect(replaced?.role).toBe('knowledge');
    expect(storage.copiedPaths).toContain('update-skill:1.0.1:docs/guide.md');
  });

  it('creates a new draft patch version when moving a file', async () => {
    const skill = createSkill();
    const repo = new Repo(skill);
    const storage = new Storage();
    const audit = new Audit();
    const useCase = new UpdateSkillUseCase(repo, storage, audit);

    const updated = await useCase.moveFile(
      'update-skill',
      '1.0.0',
      'docs/guide.md',
      { path: 'docs/archive/guide.md' },
      'admin'
    );

    expect(updated.getAllVersions()).toHaveLength(2);
    expect(updated.getAllVersions()[1]?.version).toBe('1.0.1');
    expect(updated.getAllVersions()[1]?.manifest.files.map((file) => file.path)).toContain('docs/archive/guide.md');
    expect(updated.getAllVersions()[1]?.manifest.files.map((file) => file.path)).not.toContain('docs/guide.md');
    expect(storage.copiedPaths).toContain('update-skill:1.0.1:docs/archive/guide.md');
    expect(audit.entries.some((entry) => entry.action === 'move_skill_file')).toBe(true);
  });

  it('rejects invalid target paths when moving a skill file', async () => {
    const skill = createSkill();
    const repo = new Repo(skill);
    const storage = new Storage();
    const audit = new Audit();
    const useCase = new UpdateSkillUseCase(repo, storage, audit);

    await expect(
      useCase.moveFile('update-skill', '1.0.0', 'docs/guide.md', { path: '../outside.md' }, 'admin')
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      useCase.moveFile('update-skill', '1.0.0', 'docs/guide.md', { path: 'C:\\temp\\guide.md' }, 'admin')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates a new draft patch version when deleting a non-entrypoint file', async () => {
    const skill = createSkill();
    const repo = new Repo(skill);
    const storage = new Storage();
    const audit = new Audit();
    const useCase = new UpdateSkillUseCase(repo, storage, audit);

    const updated = await useCase.deleteFile('update-skill', '1.0.0', 'docs/guide.md', 'admin');

    expect(updated.getAllVersions()).toHaveLength(2);
    expect(updated.getAllVersions()[1]?.version).toBe('1.0.1');
    expect(updated.getAllVersions()[1]?.manifest.files.map((file) => file.path)).not.toContain('docs/guide.md');
    expect(updated.getAllVersions()[1]?.manifest.files.map((file) => file.path)).toContain('README.md');
    expect(audit.entries.some((entry) => entry.action === 'delete_skill_file')).toBe(true);
  });

  it('rejects deleting the entrypoint file', async () => {
    const skill = createSkill();
    const repo = new Repo(skill);
    const storage = new Storage();
    const audit = new Audit();
    const useCase = new UpdateSkillUseCase(repo, storage, audit);

    await expect(useCase.deleteFile('update-skill', '1.0.0', 'README.md', 'admin')).rejects.toBeInstanceOf(ValidationError);
  });

  it('loads the skill aggregate for metadata updates from the sqlite catalog when available', async () => {
    const repo = new Repo(null);
    const storage = new Storage();
    const audit = new Audit();
    const catalog = new Catalog(createCatalogVersion());
    const useCase = new UpdateSkillUseCase(repo, storage, audit, catalog);

    const updated = await useCase.updateSkill(
      'update-skill',
      {
        title: 'Catalog Update',
      },
      'admin'
    );

    expect(repo.findByIdCalls).toBe(0);
    expect(catalog.listSkillVersionsCalls).toBe(1);
    expect(updated.getAllVersions()).toHaveLength(2);
    expect(updated.getVersion('1.0.1').manifest.title).toBe('Catalog Update');
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
  readonly copiedPaths: string[] = [];

  async storeSkillFile(skillId: string, version: string, path: string, content: Buffer, mimeType: string): Promise<StoredFile> {
    this.copiedPaths.push(`${skillId}:${version}:${path}`);
    return {
      path,
      mimeType,
      sizeBytes: content.length,
      sha256: 'sha-copied',
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    };
  }

  async readSkillFile(): Promise<{ content: Buffer; mimeType: string }> {
    return {
      content: Buffer.from('# copied'),
      mimeType: 'text/markdown',
    };
  }

  async listSkillFiles(): Promise<StoredFile[]> {
    return [
      {
        path: 'README.md',
        mimeType: 'text/markdown',
        sizeBytes: 8,
        sha256: 'sha-original',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      {
        path: 'docs/guide.md',
        mimeType: 'text/markdown',
        sizeBytes: 16,
        sha256: 'sha-guide',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ];
  }

  async storeSkillFileExtract(): Promise<StoredExtractedContent> {
    throw new Error('not implemented');
  }

  async readSkillFileExtract(): Promise<StoredExtractedContent | null> {
    return null;
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
  async storeProposalFileExtract(): Promise<StoredExtractedContent> {
    throw new Error('not implemented');
  }
  async readProposalFileExtract(): Promise<StoredExtractedContent | null> {
    return null;
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
  listSkillVersionsCalls = 0;

  constructor(private readonly version: CatalogSkillVersionRecord) {}

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
    return [
      {
        skillId: this.version.skillId,
        version: this.version.version,
        path: 'README.md',
        artifactId: 'artifact-readme',
        role: 'entrypoint',
        mimeType: 'text/markdown',
        sizeBytes: 8,
        sha256: 'sha-original',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        extractable: true,
      },
      {
        skillId: this.version.skillId,
        version: this.version.version,
        path: 'docs/guide.md',
        artifactId: 'artifact-guide',
        role: 'knowledge',
        mimeType: 'text/markdown',
        sizeBytes: 16,
        sha256: 'sha-guide',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        extractable: true,
      },
    ];
  }
}

function createSkill(): Skill {
  const skill = Skill.create({ id: SkillId.create('update-skill'), createdBy: 'seed' });
  skill.addVersion(
    SkillVersion.create({
      skillId: skill.id,
      version: '1.0.0',
      createdBy: 'seed',
      manifest: Manifest.create({
        id: 'update-skill',
        title: 'Original Title',
        description: 'Original description',
        version: '1.0.0',
        status: SkillStatus.PUBLISHED,
        category: 'automation',
        tags: ['stable'],
        entrypoint: 'README.md',
        files: [
          ManifestFile.create({
            path: 'README.md',
            role: 'entrypoint',
            mimeType: 'text/markdown',
            sha256: 'sha-original',
          }),
          ManifestFile.create({
            path: 'docs/guide.md',
            role: 'knowledge',
            mimeType: 'text/markdown',
            sha256: 'sha-guide',
          }),
        ],
      }),
    })
  );
  skill.setLatestPublished('1.0.0');
  return skill;
}

function createCatalogVersion(): CatalogSkillVersionRecord {
  return {
    skillId: 'update-skill',
    skillUuid: 'skill-uuid',
    version: '1.0.0',
    versionUuid: 'version-uuid',
    title: 'Original Title',
    description: 'Original description',
    category: 'automation',
    tags: ['stable'],
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
