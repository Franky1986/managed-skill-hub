import { describe, expect, it, vi } from 'vitest';
import { ProposalDuplicateCheckUseCase } from './duplicate-check.usecase';
import { SkillCatalogPort, CatalogProposalRecord, CatalogSkillVersionRecord } from '../../ports/outbound/skill-catalog.port';
import { Proposal, ProposalFile } from '../../../domain/proposal/Proposal';
import { ProposalStatus } from '../../../domain/proposal/ProposalStatus';
import { JudgementRisk } from '../../../domain/judgement/Judgement';
import { Skill } from '../../../domain/skill/Skill';

class FakeCatalog implements SkillCatalogPort {
  proposals: CatalogProposalRecord[] = [];
  publishedSkills: CatalogSkillVersionRecord[] = [];
  latestVersions: Map<string, CatalogSkillVersionRecord> = new Map();
  findProposalByContentDigestMock: ((digest: string, excludeId?: string) => CatalogProposalRecord | null) | null = null;
  findPublishedSkillByContentDigestMock: ((digest: string) => { skillId: string; version: string } | null) | null = null;

  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: Proposal): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async upsertSkillJudgement(): Promise<void> {}
  async listJudgements() { return []; }
  async upsertAuditEntry() {}
  async listSkillHistory() { return []; }
  async listProposals() { return { items: this.proposals, total: this.proposals.length }; }
  async getProposal(proposalId: string) { return this.proposals.find((p) => p.id === proposalId) ?? null; }
  async listProposalFiles() { return []; }
  async listProposalJudgements() { return []; }
  async countPendingProposals() { return 0; }
  async countProposalsByStatus(): Promise<Record<ProposalStatus, number>> {
    return { in_upload: 0, submitted: 0, judged: 0, converted: 0 };
  }
  async rebuild() {}
  async listCategories() { return []; }
  async listLatestSkillVersions({ publishedOnly }: { publishedOnly?: boolean } = {}) {
    const items = publishedOnly ? this.publishedSkills.filter((s) => s.status === 'published') : this.publishedSkills;
    return { items, total: items.length };
  }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getSkillVersion() { return null; }
  async getLatestVersion(skillId: string) { return this.latestVersions.get(skillId) ?? null; }
  async getLatestPublishedVersion() { return null; }
  async listSkillVersions() { return []; }
  async listPublishedVersions() { return []; }
  async listVersionFiles() { return []; }
  async findProposalByContentDigest(digest: string, excludeId?: string) {
    return this.findProposalByContentDigestMock?.(digest, excludeId) ?? null;
  }
  async findPublishedSkillByContentDigest(digest: string) {
    return this.findPublishedSkillByContentDigestMock?.(digest) ?? null;
  }
}

function createProposalRecord(id: string, title: string, description: string, category = 'automation', skillId: string | null = null): CatalogProposalRecord {
  return {
    id,
    skillId,
    title,
    description,
    category,
    tags: ['agent'],
    capabilities: ['read'],
    entrypoint: 'SKILL.md',
    status: 'submitted',
    submittedBy: 'agent',
    createdAt: new Date(),
    rejectionReason: null,
    latestJudgementRisk: JudgementRisk.LOW,
    labels: [],
    latestJudgementId: null,
    latestJudgedAt: null,
    contentDigest: null,
  };
}

function createSkillVersionRecord(skillId: string, title: string, description: string, category = 'automation'): CatalogSkillVersionRecord {
  return {
    skillId,
    version: '1.0.0',
    title,
    description,
    category,
    tags: ['agent'],
    capabilities: ['read'],
    useWhen: [],
    doNotUseWhen: [],
    entrypoint: 'SKILL.md',
    status: 'published',
    skillUuid: 'uuid',
    versionUuid: 'vuuid',
    contentDigest: 'digest',
    createdAt: new Date(),
    approvedBy: 'admin',
    approvedAt: new Date(),
    publishedBy: 'admin',
    publishedAt: new Date(),
    updatedAt: new Date(),
    isLatestPublished: true,
    isLatestVersion: true,
    deprecatedBy: null,
    deprecatedAt: null,
    deprecationReason: null,
  };
}

describe('ProposalDuplicateCheckUseCase', () => {
  it('reports exact duplicate proposal by content digest', async () => {
    const catalog = new FakeCatalog();
    catalog.findProposalByContentDigestMock = () => createProposalRecord('prop-1', 'Same', 'Same description');
    const useCase = new ProposalDuplicateCheckUseCase(catalog);

    const result = await useCase.execute({
      title: 'Same',
      description: 'Same description',
      category: 'automation',
      files: [{ path: 'README.md', sha256: 'abc' }],
    });

    expect(result.exactDuplicateProposalId).toBe('prop-1');
    expect(result.exactDuplicateSkillId).toBeNull();
    expect(result.submittedContentDigest).toBeTruthy();
    expect(result.note).toContain('pre-submission hint');
  });

  it('reports exact duplicate skill by content digest', async () => {
    const catalog = new FakeCatalog();
    catalog.findProposalByContentDigestMock = () => null;
    catalog.findPublishedSkillByContentDigestMock = () => ({ skillId: 'existing-skill', version: '1.0.0' });
    const useCase = new ProposalDuplicateCheckUseCase(catalog);

    const result = await useCase.execute({
      title: 'Same',
      description: 'Same description',
      category: 'automation',
      files: [{ path: 'README.md', sha256: 'abc' }],
    });

    expect(result.exactDuplicateProposalId).toBeNull();
    expect(result.exactDuplicateSkillId).toBe('existing-skill');
  });

  it('reports skill id collision when target skill exists', async () => {
    const catalog = new FakeCatalog();
    catalog.latestVersions.set('existing-skill', createSkillVersionRecord('existing-skill', 'Existing', 'Desc'));
    const useCase = new ProposalDuplicateCheckUseCase(catalog);

    const result = await useCase.execute({
      skillId: 'existing-skill',
      title: 'New version',
      description: 'Different description',
      category: 'automation',
    });

    expect(result.skillIdCollision.exists).toBe(true);
    expect(result.skillIdCollision.existingSkillId).toBe('existing-skill');
  });

  it('returns similar proposals and skills ranked by score', async () => {
    const catalog = new FakeCatalog();
    catalog.proposals.push(createProposalRecord('prop-a', 'Web scraper agent', 'Scrapes web pages for data.', 'tooling'));
    catalog.publishedSkills.push(createSkillVersionRecord('skill-a', 'Web scraper helper', 'Scrapes web pages and extracts structured data.', 'tooling'));
    const useCase = new ProposalDuplicateCheckUseCase(catalog);

    const result = await useCase.execute({
      title: 'Web scraper',
      description: 'Scrape web pages and extract structured data.',
      category: 'tooling',
      tags: ['agent', 'web'],
      capabilities: ['read', 'scrape'],
      entrypoint: 'README.md',
    });

    expect(result.similarMatches.length).toBeGreaterThan(0);
    expect(result.similarMatches[0]?.similarityScore).toBeGreaterThan(0.2);
    expect(result.similarMatches[0]?.matchedOn.length).toBeGreaterThan(0);
    expect(result.similarMatches[0]?.differences.tags).toBeDefined();
    expect(result.similarMatches[0]?.differences.capabilities).toBeDefined();
  });

  it('returns no content digest when no file fingerprints are provided', async () => {
    const catalog = new FakeCatalog();
    const useCase = new ProposalDuplicateCheckUseCase(catalog);

    const result = await useCase.execute({
      title: 'No files',
      description: 'Just metadata',
      category: 'automation',
    });

    expect(result.submittedContentDigest).toBeNull();
    expect(result.similarMatches).toEqual([]);
    expect(result.resolutionOptions.length).toBe(1);
    expect(result.resolutionOptions[0]?.strategy).toBe('create_new_skill');
  });

  it('does not run similarity search when an exact duplicate is found', async () => {
    const catalog = new FakeCatalog();
    catalog.proposals.push(createProposalRecord('prop-other', 'Similar title', 'Similar description'));
    catalog.findProposalByContentDigestMock = () => createProposalRecord('prop-dup', 'Same', 'Same');
    const useCase = new ProposalDuplicateCheckUseCase(catalog);

    const result = await useCase.execute({
      title: 'Same',
      description: 'Same',
      category: 'automation',
      files: [{ path: 'README.md', sha256: 'x' }],
    });

    expect(result.exactDuplicateProposalId).toBe('prop-dup');
    expect(result.similarMatches.length).toBe(0);
  });

  it('offers create_new_version and request_admin_update when skillId collides', async () => {
    const catalog = new FakeCatalog();
    catalog.latestVersions.set('existing-skill', createSkillVersionRecord('existing-skill', 'Existing', 'Desc'));
    const useCase = new ProposalDuplicateCheckUseCase(catalog);

    const result = await useCase.execute({
      skillId: 'existing-skill',
      title: 'New version',
      description: 'Different description',
      category: 'automation',
    });

    expect(result.resolutionOptions).toContainEqual(
      expect.objectContaining({ strategy: 'create_new_version', suggestedSkillId: 'existing-skill', requiresAdminAction: true })
    );
    expect(result.resolutionOptions).toContainEqual(
      expect.objectContaining({ strategy: 'request_admin_update', suggestedSkillId: 'existing-skill', requiresAdminAction: true })
    );
    expect(result.resolutionOptions).toContainEqual(
      expect.objectContaining({ strategy: 'create_new_skill' })
    );
  });

  it('suggests a new slugified skillId when collision with existing skill', async () => {
    const catalog = new FakeCatalog();
    catalog.latestVersions.set('my-skill', createSkillVersionRecord('my-skill', 'My Skill', 'Desc'));
    catalog.latestVersions.set('my-skill-2', createSkillVersionRecord('my-skill-2', 'My Skill 2', 'Desc'));
    const useCase = new ProposalDuplicateCheckUseCase(catalog);

    const result = await useCase.execute({
      skillId: 'my-skill',
      title: 'My Skill',
      description: 'New content',
      category: 'automation',
    });

    const newSkillOption = result.resolutionOptions.find((option) => option.strategy === 'create_new_skill');
    expect(newSkillOption?.suggestedSkillId).toBe('my-skill-3');
    expect(newSkillOption?.label).toContain('different id');
  });
});

interface StoredFile {
  path: string;
  content: Buffer;
  mimeType: string;
}

class FakeStorage implements import('../../ports/outbound/file-storage.port').SkillFileStoragePort {
  private proposalFiles = new Map<string, StoredFile[]>();
  private skillFiles = new Map<string, StoredFile[]>();

  addProposalFile(proposalId: string, file: StoredFile) {
    const existing = this.proposalFiles.get(proposalId) ?? [];
    existing.push(file);
    this.proposalFiles.set(proposalId, existing);
  }

  addSkillFile(skillId: string, version: string, file: StoredFile) {
    const key = `${skillId}:${version}`;
    const existing = this.skillFiles.get(key) ?? [];
    existing.push(file);
    this.skillFiles.set(key, existing);
  }

  async readProposalFile(proposalId: string, path: string) {
    const file = (this.proposalFiles.get(proposalId) ?? []).find((f) => f.path === path);
    return file ? { content: file.content, mimeType: file.mimeType } : null;
  }

  async readSkillFile(skillId: string, version: string, path: string) {
    const file = (this.skillFiles.get(`${skillId}:${version}`) ?? []).find((f) => f.path === path);
    return file ? { content: file.content, mimeType: file.mimeType } : null;
  }

  async storeSkillFile() { throw new Error('not implemented'); }
  async listSkillFiles() { return []; }
  async storeSkillFileExtract() { throw new Error('not implemented'); }
  async readSkillFileExtract() { return null; }
  async storeProposalFile() { throw new Error('not implemented'); }
  async listProposalFiles() { return []; }
  async storeProposalFileExtract() { throw new Error('not implemented'); }
  async readProposalFileExtract() { return null; }
}

class FakeScanner implements import('../../ports/outbound/file-scanner.port').FileScannerPort {
  supports() { return true; }
  async scan(content: Buffer, _mimeType: string, fileName?: string) {
    return {
      text: content.toString('utf-8'),
      metadata: { fileName: fileName ?? '' },
    };
  }
}

class FakeDuplicateJudger implements import('../../ports/outbound/judger.port').SkillJudgerPort {
  calls = 0;

  constructor(private readonly score: number, private readonly reason: string) {}

  async judge() {
    throw new Error('not implemented');
  }

  async assessDuplicateSimilarity() {
    this.calls += 1;
    return { similarityScore: this.score, reason: this.reason, model: 'fake-duplicate-model' };
  }
}

function createSemanticProposal(id: string, overrides: { skillId?: string; title?: string; description?: string } = {}): Proposal {
  return Proposal.create({
    id,
    skillId: overrides.skillId,
    title: overrides.title ?? 'Web scraper',
    description: overrides.description ?? 'Scrape web pages and extract structured data.',
    category: 'tooling',
    tags: ['agent', 'web'],
    capabilities: ['read', 'scrape'],
    entrypoint: 'SKILL.md',
    submittedBy: 'agent',
  }).addFile(ProposalFile.create({
    id: 'SKILL.md',
    path: 'SKILL.md',
    mimeType: 'text/markdown',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
  }));
}

describe('ProposalDuplicateCheckUseCase semantic similarity', () => {
  it('uses LLM similarity to raise the score when content is a near-duplicate', async () => {
    const catalog = new FakeCatalog();
    catalog.publishedSkills.push(createSkillVersionRecord('skill-a', 'Web scraper helper', 'Scrapes web pages and extracts structured data.', 'tooling'));
    const storage = new FakeStorage();
    storage.addProposalFile('prop-1', { path: 'SKILL.md', content: Buffer.from('# Web scraper\nScrape web pages.'), mimeType: 'text/markdown' });
    storage.addSkillFile('skill-a', '1.0.0', { path: 'SKILL.md', content: Buffer.from('# Web scraper\nScrape web pages and extract data.'), mimeType: 'text/markdown' });
    const judger = new FakeDuplicateJudger(0.85, 'Very similar content');
    const useCase = new ProposalDuplicateCheckUseCase(catalog, storage, new FakeScanner(), judger);

    const assessment = await useCase.executeForProposal(createSemanticProposal('prop-1'));

    expect(assessment.semanticCheck.status).toBe('completed');
    expect(assessment.result.similarMatches[0]?.semanticSimilarity?.score).toBe(0.85);
    expect(assessment.result.similarMatches[0]?.semanticSimilarity?.reason).toBe('Very similar content');
    expect(judger.calls).toBe(1);
  });

  it('keeps heuristic score when LLM score is lower', async () => {
    const catalog = new FakeCatalog();
    catalog.publishedSkills.push(createSkillVersionRecord('skill-a', 'Web scraper helper', 'Scrapes web pages and extracts structured data.', 'tooling'));
    const storage = new FakeStorage();
    storage.addProposalFile('prop-1', { path: 'SKILL.md', content: Buffer.from('# Web scraper\nScrape web pages.'), mimeType: 'text/markdown' });
    storage.addSkillFile('skill-a', '1.0.0', { path: 'SKILL.md', content: Buffer.from('# Different implementation'), mimeType: 'text/markdown' });
    const useCase = new ProposalDuplicateCheckUseCase(catalog, storage, new FakeScanner(), new FakeDuplicateJudger(0.1, 'Different content'));

    const assessment = await useCase.executeForProposal(createSemanticProposal('prop-1'));

    expect(assessment.semanticCheck.status).toBe('completed');
    expect(assessment.result.similarMatches[0]?.semanticSimilarity?.score).toBe(0.1);
    expect(assessment.result.similarMatches[0]?.similarityScore).toBeGreaterThan(0.4);
  });


  it('excludes the current proposal from exact-duplicate detection so similar matches are still scored', async () => {
    const catalog = new FakeCatalog();
    catalog.proposals.push(createProposalRecord('prop-self', 'Web scraper', 'Scrape web pages and extract structured data.', 'tooling'));
    catalog.proposals.push(createProposalRecord('prop-other', 'Web scraper helper', 'Scrapes web pages and extracts structured data.', 'tooling'));
    catalog.findProposalByContentDigestMock = (digest, excludeId) => {
      // Simulate a content digest that matches the current proposal itself; when excluded, no foreign duplicate exists.
      return excludeId === 'prop-self' ? null : createProposalRecord('prop-self', 'Same', 'Same description');
    };
    const storage = new FakeStorage();
    storage.addProposalFile('prop-self', { path: 'SKILL.md', content: Buffer.from('# Web scraper\nScrape web pages.'), mimeType: 'text/markdown' });
    storage.addProposalFile('prop-other', { path: 'SKILL.md', content: Buffer.from('# Web scraper helper\nScrapes web pages and extracts structured data.'), mimeType: 'text/markdown' });
    const useCase = new ProposalDuplicateCheckUseCase(catalog, storage, new FakeScanner(), new FakeDuplicateJudger(0.9, 'Very similar'));

    const assessment = await useCase.executeForProposal(createSemanticProposal('prop-self'));
    const result = assessment.result;

    expect(result.exactDuplicateProposalId).toBeNull();
    expect(result.similarMatches.length).toBeGreaterThan(0);
    expect(result.similarMatches[0].id).toBe('prop-other');
    expect(result.similarMatches.some((match) => match.id === 'prop-self')).toBe(false);
  });

  it('never reads stored content or invokes the judger on the public pre-submission path', async () => {
    const catalog = new FakeCatalog();
    catalog.publishedSkills.push(createSkillVersionRecord('skill-a', 'Web scraper helper', 'Scrapes web pages and extracts structured data.', 'tooling'));
    const storage = new FakeStorage();
    storage.addSkillFile('skill-a', '1.0.0', { path: 'SKILL.md', content: Buffer.from('# Web scraper'), mimeType: 'text/markdown' });
    const storageRead = vi.spyOn(storage, 'readSkillFile');
    const judger = new FakeDuplicateJudger(0.9, 'would match');
    const useCase = new ProposalDuplicateCheckUseCase(catalog, storage, new FakeScanner(), judger);

    const result = await useCase.execute({
      title: 'Web scraper',
      description: 'Scrape web pages and extract structured data.',
      category: 'tooling',
      tags: ['agent', 'web'],
      capabilities: ['read', 'scrape'],
      entrypoint: 'SKILL.md',
    });

    expect(result.similarMatches[0]?.semanticSimilarity).toBeUndefined();
    expect(storageRead).not.toHaveBeenCalled();
    expect(judger.calls).toBe(0);
  });

  it('marks a required semantic comparison unavailable when the judger does not support it', async () => {
    const catalog = new FakeCatalog();
    catalog.publishedSkills.push(createSkillVersionRecord('skill-a', 'Web scraper helper', 'Scrapes web pages and extracts structured data.', 'tooling'));
    const storage = new FakeStorage();
    storage.addProposalFile('prop-1', { path: 'SKILL.md', content: Buffer.from('# Web scraper'), mimeType: 'text/markdown' });
    storage.addSkillFile('skill-a', '1.0.0', { path: 'SKILL.md', content: Buffer.from('# Web scraper'), mimeType: 'text/markdown' });
    const useCase = new ProposalDuplicateCheckUseCase(catalog, storage, new FakeScanner(), { judge: async () => { throw new Error('noop'); } });

    const assessment = await useCase.executeForProposal(createSemanticProposal('prop-1'));

    expect(assessment.semanticCheck.status).toBe('unavailable');
    expect(assessment.result.similarMatches[0]?.semanticSimilarity).toBeUndefined();
  });
});
