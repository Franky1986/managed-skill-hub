import { describe, expect, it } from 'vitest';
import { Proposal } from '../../../domain/proposal/Proposal';
import { ProposalFile } from '../../../domain/proposal/Proposal';
import { Skill } from '../../../domain/skill/Skill';
import { ExtractProposalFileContentUseCase } from './extract-proposal-file-content.usecase';
import { CatalogProposalRecord, SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { NotFoundError } from '../../../domain/errors';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';
import { AuditEntry } from '../../../domain/audit/AuditEntry';

describe('ExtractProposalFileContentUseCase', () => {
  it('returns utf-8 content directly for text proposal files', async () => {
    const proposal = createProposal([
      ProposalFile.create({ id: 'README.md', path: 'README.md', mimeType: 'text/markdown', sizeBytes: 8, sha256: 'sha' }),
    ]);
    const storage = new Storage(
      new Map([['proposal-1:README.md', { content: Buffer.from('# Hello'), mimeType: 'text/markdown' }]])
    );
    const useCase = new ExtractProposalFileContentUseCase(new Repo(proposal), storage, new Scanner());

    const extracted = await useCase.execute('proposal-1', 'README.md');

    expect(extracted.text).toBe('# Hello');
    expect(extracted.extractedBy).toBe('native');
    expect(storage.extracted.get('proposal-1:README.md')?.text).toBe('# Hello');
  });

  it('uses the scanner for extractable binary proposal files', async () => {
    const proposal = createProposal([
      ProposalFile.create({ id: 'brief.pdf', path: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: 8, sha256: 'sha' }),
    ]);
    const storage = new Storage(
      new Map([['proposal-1:brief.pdf', { content: Buffer.from('pdf-data'), mimeType: 'application/pdf' }]])
    );
    const useCase = new ExtractProposalFileContentUseCase(new Repo(proposal), storage, new Scanner('Extracted from PDF'));

    const extracted = await useCase.execute('proposal-1', 'brief.pdf');

    expect(extracted.text).toBe('Extracted from PDF');
    expect(extracted.extractedBy).toBe('stub-scanner');
  });

  it('reuses persisted proposal extracts until forceRefresh is requested', async () => {
    const proposal = createProposal([
      ProposalFile.create({ id: 'brief.pdf', path: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: 8, sha256: 'sha' }),
    ]);
    const storage = new Storage(
      new Map([['proposal-1:brief.pdf', { content: Buffer.from('pdf-data'), mimeType: 'application/pdf' }]])
    );
    storage.extracted.set('proposal-1:brief.pdf', {
      text: 'cached extract',
      extractedBy: 'cached-scanner',
      metadata: { mimeType: 'application/pdf', filePath: 'brief.pdf', extractor: 'cached' },
      extractedAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    const scanner = new Scanner('fresh extract');
    const useCase = new ExtractProposalFileContentUseCase(new Repo(proposal), storage, scanner);

    const cached = await useCase.execute('proposal-1', 'brief.pdf');
    const refreshed = await useCase.execute('proposal-1', 'brief.pdf', { forceRefresh: true });

    expect(cached.text).toBe('cached extract');
    expect(scanner.calls).toBe(1);
    expect(refreshed.text).toBe('fresh extract');
  });

  it('rejects missing proposals or files', async () => {
    const useCase = new ExtractProposalFileContentUseCase(new Repo(null), new Storage(new Map()), new Scanner());

    await expect(useCase.execute('proposal-1', 'README.md')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resolves proposal extracted-content reads against the sqlite catalog before falling back to the repository', async () => {
    const repo = new Repo(null);
    const storage = new Storage(
      new Map([['proposal-1:README.md', { content: Buffer.from('# Catalog Proposal'), mimeType: 'text/markdown' }]])
    );
    const catalog = new ProposalCatalog();
    const useCase = new ExtractProposalFileContentUseCase(repo, storage, new Scanner(), catalog);

    const extracted = await useCase.execute('proposal-1', 'README.md');

    expect(extracted.text).toBe('# Catalog Proposal');
    expect(repo.findProposalByIdCalls).toBe(0);
  });
});

class Repo implements SkillRepositoryPort {
  constructor(private readonly proposal: Proposal | null) {}
  findProposalByIdCalls = 0;
  async save(_skill: Skill): Promise<void> {}
  async findById(): Promise<Skill | null> { return null; }
  async findAll(): Promise<{ items: Skill[]; total: number }> { return { items: [], total: 0 }; }
  async exists(): Promise<boolean> { return false; }
  async saveProposal(): Promise<void> {}
  async findProposalById(): Promise<Proposal | null> {
    this.findProposalByIdCalls += 1;
    return this.proposal;
  }
  async findProposals() { return this.proposal ? { items: [this.proposal], total: 1 } : { items: [], total: 0 }; }
  async deleteProposal(): Promise<void> {}
}

class Storage implements SkillFileStoragePort {
  readonly extracted = new Map<string, StoredExtractedContent>();
  constructor(private readonly files: Map<string, { content: Buffer; mimeType: string }>) {}
  async storeSkillFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readSkillFile(): Promise<{ content: Buffer; mimeType: string } | null> { return null; }
  async listSkillFiles(): Promise<StoredFile[]> { return []; }
  async storeSkillFileExtract(): Promise<StoredExtractedContent> { throw new Error('not implemented'); }
  async readSkillFileExtract(): Promise<StoredExtractedContent | null> { return null; }
  async storeProposalFile(): Promise<StoredFile> { throw new Error('not implemented'); }
  async readProposalFile(proposalId: string, path: string) {
    return this.files.get(`${proposalId}:${path}`) ?? null;
  }
  async listProposalFiles(): Promise<StoredFile[]> { return []; }
  async storeProposalFileExtract(
    proposalId: string,
    path: string,
    extracted: Omit<StoredExtractedContent, 'extractedAt'> & { extractedAt?: Date }
  ): Promise<StoredExtractedContent> {
    const stored = {
      text: extracted.text,
      extractedBy: extracted.extractedBy,
      metadata: extracted.metadata,
      extractedAt: extracted.extractedAt ?? new Date('2026-07-02T00:00:00.000Z'),
    };
    this.extracted.set(`${proposalId}:${path}`, stored);
    return stored;
  }
  async readProposalFileExtract(proposalId: string, path: string): Promise<StoredExtractedContent | null> {
    return this.extracted.get(`${proposalId}:${path}`) ?? null;
  }
}

class Scanner implements FileScannerPort {
  calls = 0;
  constructor(private readonly text = 'scanned text') {}
  supports(): boolean { return true; }
  async scan() {
    this.calls += 1;
    return { text: this.text, metadata: {}, extractedBy: 'stub-scanner' };
  }
}

class ProposalCatalog implements SkillCatalogPort {
  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: Proposal): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async upsertSkillJudgement(_skillId: string, _version: string, _judgement: Judgement): Promise<void> {}
  async listJudgements() { return []; }
  async upsertAuditEntry(_entry: AuditEntry): Promise<void> {}
  async listSkillHistory() { return []; }
  async listProposals(): Promise<{ items: CatalogProposalRecord[]; total: number }> { return { items: [], total: 0 }; }
  async getProposal(proposalId: string): Promise<CatalogProposalRecord | null> {
    return {
      id: proposalId,
      skillId: null,
      title: 'Proposal',
      description: 'Desc',
      category: 'automation',
      tags: [],
      capabilities: [],
      entrypoint: 'README.md',
      status: 'submitted',
      submittedBy: 'agent',
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      rejectionReason: null,
      latestJudgementRisk: JudgementRisk.LOW,
      labels: ['safe'],
      latestJudgementId: null,
      latestJudgedAt: null,
    };
  }
  async listProposalFiles(proposalId: string) {
    return [
      {
        proposalId,
        id: 'README.md',
        path: 'README.md',
        mimeType: 'text/markdown',
        sizeBytes: 8,
        sha256: 'sha',
      },
    ];
  }
  async listProposalJudgements() { return []; }
  async countPendingProposals() { return 0; }
  async rebuild(): Promise<void> {}
  async listCategories(): Promise<string[]> { return []; }
  async listLatestSkillVersions() { return { items: [], total: 0 }; }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getSkillVersion() { return null; }
  async getLatestVersion() { return null; }
  async getLatestPublishedVersion() { return null; }
  async listSkillVersions() { return []; }
  async listPublishedVersions() { return []; }
  async listVersionFiles() { return []; }
}

function createProposal(files: ProposalFile[]): Proposal {
  return Proposal.rehydrate({
    id: 'proposal-1',
    title: 'Proposal',
    description: 'Desc',
    category: 'automation',
    files,
    status: 'submitted',
    submittedBy: 'agent',
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    rejectionReason: null,
    judgements: [],
  });
}
