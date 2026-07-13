import { afterEach, describe, expect, it } from 'vitest';
import { RebuildProjectionsUseCase } from './rebuild-projections.usecase';
import { Skill } from '../../../domain/skill/Skill';
import { SkillId } from '../../../domain/skill/SkillId';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { Manifest } from '../../../domain/skill/Manifest';
import { ManifestFile } from '../../../domain/skill/ManifestFile';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { Proposal } from '../../../domain/proposal/Proposal';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';
import type { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import type { AuditLogPort } from '../../ports/outbound/audit.port';
import type { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import type { SkillSearchPort } from '../../ports/outbound/search.port';
import type { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import type { FileScannerPort } from '../../ports/outbound/file-scanner.port';

describe('RebuildProjectionsUseCase', () => {
  const repo = new RepositoryStub();
  const audit = new AuditStub();
  const catalog = new CatalogStub();
  const search = new SearchStub();
  const storage = new StorageStub();
  const scanner = new ScannerStub();

  afterEach(() => {
    repo.reset();
    audit.reset();
    catalog.reset();
    search.reset();
    storage.reset();
    scanner.reset();
  });

  it('rebuilds only published versions and stores audit+judgement projection data', async () => {
    const useCase = new RebuildProjectionsUseCase(repo, audit, catalog, search, storage, scanner);
    const published = createSkill({
      id: 'published-skill',
      versions: [
        {
          version: '1.0.0',
          status: SkillStatus.PUBLISHED,
          files: [
            ManifestFile.create({
              path: 'README.md',
              role: 'entrypoint',
              mimeType: 'text/markdown',
              sha256: 'sha-readme',
            }),
          ],
          category: 'media',
          tags: ['video', 'ffmpeg'],
        },
        {
          version: '1.0.1',
          status: SkillStatus.DRAFT,
          files: [
            ManifestFile.create({
              path: 'DRAFT.md',
              role: 'attachment',
              mimeType: 'text/markdown',
              sha256: 'sha-draft',
            }),
          ],
          category: 'media',
          tags: ['video'],
        },
      ],
    });
    const proposalCandidate = createProposal({ id: 'pending-proposal' });

    repo.findAllResult = [published];
    repo.findProposalsResult = [proposalCandidate];
    storage.skillFiles = {
      'published-skill:1.0.0:README.md': { path: 'README.md', mimeType: 'text/markdown', content: Buffer.from('Guide') },
      'published-skill:1.0.1:DRAFT.md': { path: 'DRAFT.md', mimeType: 'text/markdown', content: Buffer.from('Draft') },
    };
    storage.skillFilesToList = {
      'published-skill:1.0.0': [
        { path: 'README.md', mimeType: 'text/markdown', sizeBytes: 32, sha256: 'sha-readme', updatedAt: null },
        { path: 'image.png', mimeType: 'image/png', sizeBytes: 11, sha256: null, updatedAt: null },
      ],
      'published-skill:1.0.1': [
        { path: 'DRAFT.md', mimeType: 'text/markdown', sizeBytes: 16, sha256: 'sha-draft', updatedAt: null },
      ],
    };
    audit.entries = [
      createAuditEntry({
        action: 'judge_skill_version',
        skillId: 'published-skill',
        skillVersion: '1.0.0',
        judgement: {
          targetType: 'skill',
          targetId: 'published-skill:1.0.0',
          summary: 'Published skill is safe',
        },
      }),
      createAuditEntry({
        action: 'judge_skill_file',
        skillId: 'published-skill',
        skillVersion: '1.0.0',
        judgement: {
          targetType: 'file',
          targetId: 'published-skill:1.0.0:README.md',
          summary: 'Readme is safe',
        },
      }),
      createAuditEntry({
        action: 'create_skill',
        skillId: 'published-skill',
        skillVersion: '1.0.0',
      }),
      createAuditEntry({
        id: 'proposal-entry-1',
        action: 'judge_skill_version',
        proposalId: proposalCandidate.id,
        judgement: {
          targetType: 'skill',
          targetId: 'published-skill:1.0.0',
          summary: 'Proposal-linked score',
        },
      }, null, proposalCandidate.id),
    ];

    const result = await useCase.execute('admin', { clearProjections: true });

    expect(result).toEqual({
      skills: 1,
      proposals: 1,
      publishedVersions: 1,
      skillJudgements: 2,
      auditEntries: 5,
    });
    expect(audit.appended.length).toBe(1);
    expect(catalog.rebuildCalls).toEqual([{ count: 1, clearProjections: true }]);
    expect(catalog.upsertProposalCalls).toEqual(['pending-proposal']);
    expect(catalog.upsertSkillJudgementCalls).toContainEqual({
      targetType: 'skill',
      skillId: 'published-skill',
      version: '1.0.0',
      id: expect.any(String),
    });
    expect(catalog.upsertAuditEntryCalls).toHaveLength(4);
    expect(search.reindexCalls).toEqual([
      {
        publishedVersions: 1,
      },
    ]);
  });

  it('skips malformed audit judgements but still records audit rows', async () => {
    const useCase = new RebuildProjectionsUseCase(repo, audit, catalog, search, storage, scanner);
    const published = createSkill({
      id: 'invalid-audit-skill',
      versions: [
        { version: '1.0.0', status: SkillStatus.PUBLISHED, files: [] },
      ],
    });
    repo.findAllResult = [published];
    repo.findProposalsResult = [];
    storage.skillFilesToList = { 'invalid-audit-skill:1.0.0': [] };
    audit.entries = [
      AuditEntry.create({
        id: 'bad',
        skillId: 'invalid-audit-skill',
        skillVersion: '1.0.0',
        action: 'judge_skill_version',
        actor: 'admin',
        after: { judgement: { targetType: 'skill' } },
        createdAt: new Date('2026-07-09T10:00:00.000Z'),
      }),
    ];

    const result = await useCase.execute('admin');

    expect(result.skillJudgements).toBe(0);
    expect(result.auditEntries).toBe(1);
    expect(catalog.upsertSkillJudgementCalls).toHaveLength(0);
    expect(catalog.upsertAuditEntryCalls).toHaveLength(1);
  });

  it('continues rebuilding when text extraction fails for a file', async () => {
    const useCase = new RebuildProjectionsUseCase(repo, audit, catalog, search, storage, scanner);
    const skill = createSkill({
      id: 'partial-index-skill',
      versions: [{ version: '1.0.0', status: SkillStatus.PUBLISHED }],
    });
    repo.findAllResult = [skill];
    repo.findProposalsResult = [];
    storage.skillFilesToList = {
      'partial-index-skill:1.0.0': [
        { path: 'README.md', mimeType: 'text/markdown', sizeBytes: 8, sha256: 'sha', updatedAt: null },
        { path: 'notes.bin', mimeType: 'application/pdf', sizeBytes: 8, sha256: 'sha', updatedAt: null },
      ],
    };
    storage.skillFiles = {
      'partial-index-skill:1.0.0:README.md': {
        path: 'README.md',
        mimeType: 'text/markdown',
        content: Buffer.from('readme content'),
      },
      'partial-index-skill:1.0.0:notes.bin': {
        path: 'notes.bin',
        mimeType: 'application/pdf',
        content: Buffer.from('notes'),
      },
    };
    scanner.setFailureForPath('notes.bin');

    const result = await useCase.execute('admin', { clearProjections: false });

    expect(result.publishedVersions).toBe(1);
    expect(search.lastReindexBody).toBeDefined();
    expect(search.lastReindexBody?.some((document) => document.skillId === 'partial-index-skill')).toBe(true);
    expect(typeof search.lastReindexBody?.[0]?.publishedAt.toISOString()).toBe('string');
    const body = search.lastReindexBody ?? [];
    expect(body).toHaveLength(1);
    expect(body[0]?.body).toContain('readme content');
    expect(scanner.scanCalls.some((call) => call.path === 'notes.bin')).toBe(true);
    expect(result.skillJudgements).toBe(0);
    expect(result.auditEntries).toBe(0);
  });
});

function createSkill({
  id,
  versions,
}: {
  id: string;
  versions: Array<{
    version: string;
    status: SkillStatus;
    files?: ManifestFile[];
    category?: string;
    tags?: string[];
  }>;
}) {
  const skill = Skill.create({ id: SkillId.create(id), createdBy: 'tester' });
  versions.forEach((versionSpec) => {
    const manifest = Manifest.create({
      id,
      title: `${id}-${versionSpec.version}`,
      description: `Version ${versionSpec.version}`,
      version: versionSpec.version,
      status: versionSpec.status,
      category: versionSpec.category ?? 'media',
      tags: versionSpec.tags ?? ['agent'],
      capabilities: ['search'],
      entrypoint: (versionSpec.files?.[0]?.path ?? 'README.md'),
      files: versionSpec.files ?? [],
    });
    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: versionSpec.version,
        createdBy: 'tester',
        manifest,
      })
    );
  });
  const latestPublished = versions.find((version) => version.status === SkillStatus.PUBLISHED);
  if (latestPublished) {
    skill.setLatestPublished(latestPublished.version);
  }
  return skill;
}

function createProposal({ id }: { id: string }) {
  return Proposal.create({
    id,
    title: 'Proposal for audit replay',
    description: 'Proposal description',
    category: 'media',
    submittedBy: 'agent',
  });
}

function createAuditEntry(
  props: {
    action: string;
    skillId: string;
    skillVersion: string;
    judgement?: {
      targetType: 'proposal' | 'skill' | 'file';
      targetId: string;
      summary: string;
    };
  },
  id: string = `audit-${Math.random()}`,
  proposalId?: string | null
) {
  return AuditEntry.create({
    id,
    skillId: props.skillId,
    skillVersion: props.skillVersion,
    proposalId,
    action: props.action,
    actor: 'admin',
    after: props.judgement
      ? {
        judgement: {
          id: `${props.action}-judgement`,
          targetType: props.judgement.targetType,
          targetId: props.judgement.targetId,
          summary: props.judgement.summary,
          skillPurposeSummary: null,
          model: 'spec-model',
          createdAt: '2026-07-09T10:00:00.000Z',
          dimensions: {
            harmful: {
              risk: JudgementRisk.LOW,
              score: 0,
              reason: 'safe',
            },
            promptInjection: {
              risk: JudgementRisk.LOW,
              score: 0,
              reason: 'safe',
            },
          },
        },
      }
      : undefined,
    createdAt: new Date('2026-07-09T10:00:00.000Z'),
  });
}

class RepositoryStub implements SkillRepositoryPort {
  findAllResult: Skill[] = [];
  findProposalsResult: Proposal[] = [];

  async findAll() {
    return { items: this.findAllResult, total: this.findAllResult.length };
  }

  async findProposals() {
    return { items: this.findProposalsResult, total: this.findProposalsResult.length };
  }

  async findById(_id: string): Promise<Skill | null> {
    return null;
  }

  async save(_skill: Skill): Promise<void> {}

  async exists(_id: string): Promise<boolean> {
    return false;
  }

  async saveProposal(): Promise<void> {}

  async findProposalById(): Promise<Proposal | null> {
    return null;
  }

  async deleteProposal(): Promise<void> {}

  reset() {
    this.findAllResult = [];
    this.findProposalsResult = [];
  }
}

class AuditStub implements AuditLogPort {
  entries: AuditEntry[] = [];
  appended: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.appended.push(entry);
  }

  async findBySkillId(): Promise<AuditEntry[]> {
    return this.entries;
  }

  async findByProposalId(): Promise<AuditEntry[]> {
    return this.entries.filter((entry) => entry.proposalId != null);
  }

  async findAll(): Promise<AuditEntry[]> {
    return this.entries;
  }

  reset() {
    this.entries = [];
    this.appended = [];
  }
}

class CatalogStub implements SkillCatalogPort {
  rebuildCalls: Array<{ count: number; clearProjections: boolean }> = [];
  upsertProposalCalls: string[] = [];
  upsertSkillJudgementCalls: Array<{ targetType: string; skillId: string; version: string; id: string }> = [];
  upsertAuditEntryCalls: Array<{
    skillId: string | null;
    skillVersion: string | null;
    proposalId: string | null;
  }> = [];

  async rebuild(skills: Skill[], options?: { clearProjections?: boolean }): Promise<void> {
    this.rebuildCalls.push({ count: skills.length, clearProjections: options?.clearProjections ?? false });
  }
  async upsertProposal(proposal: Proposal): Promise<void> {
    this.upsertProposalCalls.push(proposal.id);
  }
  async upsertSkillJudgement(skillId: string, version: string, judgement: Judgement): Promise<void> {
    this.upsertSkillJudgementCalls.push({
      targetType: judgement.targetType,
      skillId,
      version,
      id: judgement.id,
    });
  }
  async listJudgements() { return []; }
  async upsertAuditEntry(entry: { skillId: string | null; skillVersion: string | null; proposalId: string | null }): Promise<void> {
    const typedEntry = entry as { skillId: string | null; skillVersion: string | null; proposalId: string | null };
    this.upsertAuditEntryCalls.push({
      skillId: typedEntry.skillId,
      skillVersion: typedEntry.skillVersion,
      proposalId: typedEntry.proposalId,
    });
  }
  async listSkillHistory() { return []; }
  async listProposals() { return { items: [], total: 0 }; }
  async getProposal() { return null; }
  async listProposalFiles() { return []; }
  async listProposalJudgements() { return []; }
  async countPendingProposals() { return 0; }
  async listCategories() { return []; }
  async listTags() { return []; }
  async listLatestSkillVersions() { return { items: [], total: 0 }; }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getSkillVersion() { return null; }
  async getLatestVersion() { return null; }
  async getLatestPublishedVersion() { return null; }
  async listSkillVersions() { return []; }
  async listPublishedVersions() { return []; }
  async listVersionFiles() { return []; }
  async findProposalByContentDigest() { return null; }
  async findPublishedSkillByContentDigest() { return null; }
  async deleteProposal() {}
  async rebuildJudgements() {}
  async listProposalsFiles?() {}

  reset() {
    this.rebuildCalls = [];
    this.upsertProposalCalls = [];
    this.upsertSkillJudgementCalls = [];
    this.upsertAuditEntryCalls = [];
  }
}

class SearchStub implements SkillSearchPort {
  reindexCalls: Array<{ publishedVersions: number }> = [];
  lastReindexBody: Array<{
    skillId: string;
    version: string;
    title: string;
    description: string;
    category: string;
    groups: string[];
    capabilities: string[];
    body: string;
    publishedAt: Date;
  }> | null = null;

  async search(): Promise<{ items: never[]; total: number }> {
    return { items: [], total: 0 };
  }

  async indexVersion(): Promise<void> {}
  async removeVersion(): Promise<void> {}

  async reindexAll(documents: Array<{ skillId: string; version: string; title: string; description: string; category: string; groups: string[]; capabilities: string[]; body: string; publishedAt: Date; }>) {
    this.reindexCalls.push({ publishedVersions: documents.length });
    this.lastReindexBody = [...documents];
  }

  get publishedVersions() {
    return this.lastReindexBody?.length ?? 0;
  }

  get reindexCallsPayload() {
    return { publishedVersions: this.publishedVersions };
  }

  get reindexCallsCount() {
    return this.reindexCalls.length;
  }

  reset() {
    this.reindexCalls = [];
    this.lastReindexBody = null;
  }
}

class StorageStub implements SkillFileStoragePort {
  skillFilesToList: Record<string, Array<{ path: string; mimeType: string; sizeBytes: number; sha256: string | null; updatedAt: Date | null }>> = {};
  skillFiles: Record<string, { path: string; mimeType: string; content: Buffer }> = {};
  listSkillFilesCalls: Array<{ skillId: string; version: string }> = [];
  readSkillFileCalls: Array<{ skillId: string; version: string; path: string }> = [];

  async listSkillFiles(skillId: string, version: string) {
    this.listSkillFilesCalls.push({ skillId, version });
    return this.skillFilesToList[`${skillId}:${version}`] ?? [];
  }

  async readSkillFile(skillId: string, version: string, path: string) {
    this.readSkillFileCalls.push({ skillId, version, path });
    return this.skillFiles[`${skillId}:${version}:${path}`] ?? null;
  }

  async storeSkillFile() { throw new Error('not implemented in test stub'); }
  async storeSkillFileExtract() { throw new Error('not implemented in test stub'); }
  async readSkillFileExtract() { return null; }
  async storeProposalFile() { throw new Error('not implemented in test stub'); }
  async readProposalFile() { return null; }
  async listProposalFiles() { return []; }
  async storeProposalFileExtract() { throw new Error('not implemented in test stub'); }
  async readProposalFileExtract() { return null; }

  reset() {
    this.skillFilesToList = {};
    this.skillFiles = {};
    this.listSkillFilesCalls = [];
    this.readSkillFileCalls = [];
  }
}

class ScannerStub implements FileScannerPort {
  scanCalls: Array<{ path: string; mimeType: string }> = [];
  failedPaths = new Set<string>();

  async scan(_content: Buffer, mimeType: string, fileName?: string) {
    const path = fileName ?? '';
    this.scanCalls.push({ path, mimeType });
    if (this.failedPaths.has(path)) {
      throw new Error(`scan failed for ${path}`);
    }
    return {
      text: path === 'notes.txt' ? 'notes' : `extracted-${path}`,
      metadata: {},
      extractedBy: 'test-scanner',
    };
  }

  supports(_mimeType: string): boolean {
    return true;
  }

  setFailureForPath(path: string): void {
    this.failedPaths.add(path);
  }

  reset() {
    this.scanCalls = [];
    this.failedPaths.clear();
  }
}
