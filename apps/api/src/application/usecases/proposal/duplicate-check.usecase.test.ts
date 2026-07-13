import { describe, expect, it } from 'vitest';
import { ProposalDuplicateCheckUseCase } from './duplicate-check.usecase';
import { SkillCatalogPort, CatalogProposalRecord, CatalogSkillVersionRecord } from '../../ports/outbound/skill-catalog.port';
import { Proposal } from '../../../domain/proposal/Proposal';
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
    entrypoint: 'README.md',
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
    entrypoint: 'README.md',
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
    catalog.publishedSkills.push(createSkillVersionRecord('skill-a', 'Web scraping helper', 'Helps scraping web pages.', 'tooling'));
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
      expect.objectContaining({ strategy: 'create_new_version', suggestedSkillId: 'existing-skill' })
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
