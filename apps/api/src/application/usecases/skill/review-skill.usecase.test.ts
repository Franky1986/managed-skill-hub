import { describe, expect, it } from 'vitest';
import { ReviewSkillUseCase } from './review-skill.usecase';
import { Skill } from '../../../domain/skill/Skill';
import { SkillId } from '../../../domain/skill/SkillId';
import { Manifest } from '../../../domain/skill/Manifest';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { ManifestFile } from '../../../domain/skill/ManifestFile';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { SkillSearchPort, SearchDocument, SearchEngineResult } from '../../ports/outbound/search.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { SkillCatalogPort, CatalogSkillVersionRecord } from '../../ports/outbound/skill-catalog.port';
import { Proposal } from '../../../domain/proposal/Proposal';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';
import { SkillJudgerPort, JudgementTarget } from '../../ports/outbound/judger.port';
import { JudgementRequiredError } from '../../../domain/errors';

describe('ReviewSkillUseCase', () => {
  it('indexes a version when it is published', async () => {
    const skill = createWorkflowSkill();
    const repo = new Repo(skill);
    const audit = new Audit();
    const storage = new Storage();
    const scanner = new Scanner();
    const search = new Search();
    const useCase = new ReviewSkillUseCase(repo, audit, storage, scanner, search);

    await useCase.publish(skill.id.toString(), '1.0.0', 'publisher');

    expect(search.indexed).toHaveLength(1);
    expect(search.indexed[0]?.skillVersion.version).toBe('1.0.0');
    expect(search.indexed[0]?.extractedText).toContain('# Published');
  });

  it('stores a judger-generated publish change note', async () => {
    const skill = createWorkflowSkill();
    const repo = new Repo(skill);
    const audit = new Audit();
    const storage = new Storage();
    const scanner = new Scanner();
    const search = new Search();
    const judger = new ChangeNoteJudger();
    const useCase = new ReviewSkillUseCase(repo, audit, storage, scanner, search, undefined, judger);

    await useCase.publish(skill.id.toString(), '1.0.0', 'publisher');

    expect(judger.targets[0]?.id).toBe('workflow-skill:1.0.0:change-note');
    expect(audit.entries.map((entry) => entry.action)).toEqual(['publish', 'publish_change_note']);
    expect(audit.entries[0]?.after).toMatchObject({
      previousPublishedVersion: null,
      newPublishedVersion: '1.0.0',
    });
    expect(audit.entries[1]?.after).toMatchObject({
      previousPublishedVersion: null,
      newPublishedVersion: '1.0.0',
      changeSummary: 'LLM change note',
    });
  });

  it('removes a version from the index when it is deprecated', async () => {
    const skill = createPublishedSkill();
    const repo = new Repo(skill);
    const audit = new Audit();
    const storage = new Storage();
    const scanner = new Scanner();
    const search = new Search();
    const useCase = new ReviewSkillUseCase(repo, audit, storage, scanner, search);

    await useCase.deprecate(skill.id.toString(), '1.0.0', 'admin');

    expect(search.removed).toEqual([{ skillId: 'published-skill', version: '1.0.0' }]);
  });

  it('rejects a review-stage version with an audit entry', async () => {
    const skill = createDraftSkill();
    const repo = new Repo(skill);
    const audit = new Audit();
    const storage = new Storage();
    const scanner = new Scanner();
    const search = new Search();
    const useCase = new ReviewSkillUseCase(repo, audit, storage, scanner, search);

    await useCase.reject(skill.id.toString(), '1.0.0', 'reviewer', 'Not specific enough');

    expect(repo.saved[0]?.getVersion('1.0.0').status).toBe(SkillStatus.REJECTED);
    expect(repo.saved[0]?.getVersion('1.0.0').rejectionReason).toBe('Not specific enough');
    expect(audit.entries[0]?.action).toBe('reject');
    expect(search.indexed).toHaveLength(0);
    expect(search.removed).toHaveLength(0);
  });

  it('loads the skill aggregate for publish from the sqlite catalog when available', async () => {
    const catalogVersion = createCatalogVersion({
      skillId: 'workflow-skill',
      version: '1.0.0',
      title: 'Workflow',
      description: 'Review flow',
      status: 'approved',
      publishedAt: null,
      publishedBy: null,
      isLatestPublished: false,
      isLatestVersion: true,
    });
    const repo = new Repo(null);
    const audit = new Audit();
    const storage = new Storage();
    const scanner = new Scanner();
    const search = new Search();
    const catalog = new CatalogStub(catalogVersion);
    const useCase = new ReviewSkillUseCase(repo, audit, storage, scanner, search, catalog);

    await useCase.publish('workflow-skill', '1.0.0', 'publisher');

    expect(repo.findByIdCalls).toBe(0);
    expect(repo.saved[0]?.getVersion('1.0.0').status).toBe(SkillStatus.PUBLISHED);
    expect(search.indexed).toHaveLength(1);
    expect(catalog.listSkillVersionsCalls).toBe(1);
  });

  it('blocks required publication when real skill and file judgements are missing', async () => {
    const skill = createWorkflowSkill();
    const repo = new Repo(skill);
    const audit = new Audit();
    const storage = new Storage();
    const useCase = new ReviewSkillUseCase(
      repo,
      audit,
      storage,
      new Scanner(),
      new Search(),
      new CatalogStub(createCatalogVersion({})),
      undefined,
      'required'
    );

    await expect(useCase.publish('workflow-skill', '1.0.0', 'publisher'))
      .rejects.toBeInstanceOf(JudgementRequiredError);
    expect(repo.saved).toHaveLength(0);
  });

  it('audits an administrator override of required publication judgements', async () => {
    const skill = createWorkflowSkill();
    const repo = new Repo(skill);
    const audit = new Audit();
    const useCase = new ReviewSkillUseCase(
      repo,
      audit,
      new Storage(),
      new Scanner(),
      new Search(),
      new CatalogStub(createCatalogVersion({})),
      undefined,
      'required'
    );

    await useCase.publish('workflow-skill', '1.0.0', 'admin', {
      judgementOverrideAllowed: true,
      judgementOverrideReason: 'Provider outage reviewed manually',
    });

    expect(audit.entries[0]?.action).toBe('publish_judgement_override');
    expect(audit.entries[0]?.after).toMatchObject({ reason: 'Provider outage reviewed manually' });
    expect(repo.saved[0]?.getVersion('1.0.0').status).toBe(SkillStatus.PUBLISHED);
  });
});

class Repo implements SkillRepositoryPort {
  constructor(private readonly skill: Skill | null) {}

  findByIdCalls = 0;
  saved: Skill[] = [];

  async save(skill: Skill): Promise<void> {
    this.saved.push(skill);
  }

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

class Storage implements SkillFileStoragePort {
  async storeSkillFile(): Promise<StoredFile> {
    throw new Error('not implemented');
  }

  async readSkillFile(_skillId: string, _version: string, path: string) {
    return {
      content: Buffer.from(path === 'README.md' ? '# Published' : 'ignored'),
      mimeType: 'text/markdown',
    };
  }

  async listSkillFiles(): Promise<StoredFile[]> {
    return [
      {
        path: 'README.md',
        mimeType: 'text/markdown',
        sizeBytes: 11,
        sha256: 'sha',
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
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
}

class Scanner implements FileScannerPort {
  supports(): boolean {
    return true;
  }

  async scan() {
    return {
      text: 'scanned content',
      metadata: {},
      extractedBy: 'stub',
    };
  }
}

class Search implements SkillSearchPort {
  readonly indexed: Array<{ skillVersion: SkillVersion; extractedText: string }> = [];
  readonly removed: Array<{ skillId: string; version: string }> = [];

  async search(): Promise<{ items: SearchEngineResult[]; total: number }> {
    return { items: [], total: 0 };
  }

  async indexVersion(skillVersion: SkillVersion, extractedText: string): Promise<void> {
    this.indexed.push({ skillVersion, extractedText });
  }

  async removeVersion(skillId: string, version: string): Promise<void> {
    this.removed.push({ skillId, version });
  }

  async reindexAll(_documents: SearchDocument[]): Promise<void> {}
}

class ChangeNoteJudger implements SkillJudgerPort {
  readonly targets: JudgementTarget[] = [];

  async judge(target: JudgementTarget): Promise<Judgement> {
    this.targets.push(target);
    return Judgement.create({
      targetType: target.type,
      targetId: target.id,
      dimensions: {
        qualityFit: { risk: JudgementRisk.LOW, score: 0, reason: 'Change note generated.' },
      },
      summary: 'LLM change note',
      skillPurposeSummary: 'Publishes a workflow skill.',
      model: 'test-judger',
    });
  }
}

class CatalogStub implements SkillCatalogPort {
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
  async rebuild(_skills: Skill[]): Promise<void> {}
  async listCategories(): Promise<string[]> { return []; }
  async listLatestSkillVersions() { return { items: [this.version], total: 1 }; }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getSkillVersion(skillId: string, version: string) {
    return this.version.skillId === skillId && this.version.version === version ? this.version : null;
  }
  async getLatestVersion() { return this.version; }
  async getLatestPublishedVersion() { return null; }
  async listSkillVersions(skillId: string) {
    this.listSkillVersionsCalls += 1;
    return this.version.skillId === skillId ? [this.version] : [];
  }
  async listPublishedVersions() { return []; }
  async listVersionFiles() {
    return [
      {
        skillId: this.version.skillId,
        version: this.version.version,
        path: 'README.md',
        artifactId: 'artifact-1',
        role: 'entrypoint',
        mimeType: 'text/markdown',
        sizeBytes: 11,
        sha256: 'sha',
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        extractable: true,
      },
    ];
  }
}

function createWorkflowSkill(): Skill {
  const skill = Skill.create({ id: SkillId.create('workflow-skill'), createdBy: 'seed' });
  skill.addVersion(
    SkillVersion.create({
      skillId: skill.id,
      version: '1.0.0',
      createdBy: 'seed',
      manifest: Manifest.create({
        id: 'workflow-skill',
        title: 'Workflow',
        description: 'Review flow',
        version: '1.0.0',
        status: SkillStatus.APPROVED,
        category: 'automation',
        entrypoint: 'README.md',
        files: [ManifestFile.create({ path: 'README.md', role: 'entrypoint', mimeType: 'text/markdown', sha256: 'sha' })],
      }),
    })
  );
  return skill;
}

function createDraftSkill(): Skill {
  const skill = Skill.create({ id: SkillId.create('draft-skill'), createdBy: 'seed' });
  skill.addVersion(
    SkillVersion.create({
      skillId: skill.id,
      version: '1.0.0',
      createdBy: 'seed',
      manifest: Manifest.create({
        id: 'draft-skill',
        title: 'Draft',
        description: 'Not live',
        version: '1.0.0',
        status: SkillStatus.DRAFT,
        category: 'automation',
        entrypoint: 'README.md',
        files: [ManifestFile.create({ path: 'README.md', role: 'entrypoint', mimeType: 'text/markdown', sha256: 'sha' })],
      }),
    })
  );
  return skill;
}

function createPublishedSkill(): Skill {
  const skill = Skill.create({ id: SkillId.create('published-skill'), createdBy: 'seed' });
  skill.addVersion(
    SkillVersion.create({
      skillId: skill.id,
      version: '1.0.0',
      createdBy: 'seed',
      manifest: Manifest.create({
        id: 'published-skill',
        title: 'Published',
        description: 'Already live',
        version: '1.0.0',
        status: SkillStatus.PUBLISHED,
        category: 'automation',
        entrypoint: 'README.md',
        files: [ManifestFile.create({ path: 'README.md', role: 'entrypoint', mimeType: 'text/markdown', sha256: 'sha' })],
      }),
    })
  );
  skill.setLatestPublished('1.0.0');
  return skill;
}

function createCatalogVersion(overrides: Partial<CatalogSkillVersionRecord>): CatalogSkillVersionRecord {
  return {
    skillId: 'workflow-skill',
    version: '1.0.0',
    title: 'Workflow',
    description: 'Review flow',
    category: 'automation',
    tags: [],
    capabilities: [],
    useWhen: [],
    doNotUseWhen: [],
    entrypoint: 'README.md',
    status: 'approved',
    skillUuid: 'skill-uuid',
    versionUuid: 'version-uuid',
    contentDigest: 'digest',
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    approvedBy: 'approver',
    approvedAt: new Date('2026-07-01T11:00:00.000Z'),
    publishedBy: null,
    publishedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    deprecatedBy: null,
    deprecatedAt: null,
    deprecationReason: null,
    updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    isLatestPublished: false,
    isLatestVersion: true,
    ...overrides,
  };
}
