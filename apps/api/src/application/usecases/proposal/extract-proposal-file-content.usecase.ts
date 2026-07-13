import { NotFoundError } from '../../../domain/errors';
import { FileScannerPort, ScannedContent } from '../../ports/outbound/file-scanner.port';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { SkillFileStoragePort, StoredExtractedContent } from '../../ports/outbound/file-storage.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { isTextLikeArtifact } from '../skill/public-metadata';

export interface ExtractedProposalFileContent {
  text: string;
  extractedBy: string;
  metadata: Record<string, unknown>;
}

export class ExtractProposalFileContentUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly scanner: FileScannerPort,
    private readonly catalog?: SkillCatalogPort
  ) {}

  async execute(
    proposalId: string,
    filePath: string,
    options?: { forceRefresh?: boolean }
  ): Promise<ExtractedProposalFileContent> {
    await this.ensureProposalFileExists(proposalId, filePath);

    const stored = await this.storage.readProposalFile(proposalId, filePath);
    if (!stored) {
      throw new NotFoundError(`Proposal file ${filePath} not found`);
    }

    if (!options?.forceRefresh) {
      const cached = await this.storage.readProposalFileExtract(proposalId, filePath);
      if (cached) {
        return normalizeStoredExtract(cached);
      }
    }

    let extracted: ExtractedProposalFileContent;
    if (isTextLikeArtifact(stored.mimeType, filePath)) {
      extracted = {
        text: stored.content.toString('utf-8'),
        extractedBy: 'native',
        metadata: {
          mimeType: stored.mimeType,
          filePath,
          extractor: 'native',
        },
      };
    } else {
      const scanned = await this.scanner.scan(stored.content, stored.mimeType, filePath);
      extracted = normalizeScannedContent(scanned, stored.mimeType, filePath);
    }

    const persisted = await this.storage.storeProposalFileExtract(proposalId, filePath, extracted);
    return normalizeStoredExtract(persisted);
  }

  private async ensureProposalFileExists(proposalId: string, filePath: string): Promise<void> {
    if (this.catalog) {
      const proposal = await this.catalog.getProposal(proposalId);
      if (proposal) {
        const files = await this.catalog.listProposalFiles(proposalId);
        if (files.some((file) => file.path === filePath)) {
          return;
        }
      }
    }

    const proposal = await this.repo.findProposalById(proposalId);
    if (!proposal) {
      throw new NotFoundError(`Proposal ${proposalId} not found`);
    }
    if (!proposal.files.some((file) => file.path === filePath)) {
      throw new NotFoundError(`Proposal file ${filePath} not found`);
    }
  }
}

function normalizeStoredExtract(stored: StoredExtractedContent): ExtractedProposalFileContent {
  return {
    text: stored.text,
    extractedBy: stored.extractedBy,
    metadata: {
      ...stored.metadata,
      extractedAt: stored.extractedAt.toISOString(),
    },
  };
}

function normalizeScannedContent(
  scanned: ScannedContent,
  mimeType: string,
  filePath: string
): ExtractedProposalFileContent {
  return {
    text: scanned.text,
    extractedBy: scanned.extractedBy,
    metadata: {
      ...scanned.metadata,
      mimeType,
      filePath,
    },
  };
}
