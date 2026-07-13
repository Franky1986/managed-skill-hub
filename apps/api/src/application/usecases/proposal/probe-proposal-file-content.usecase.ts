import { NotFoundError } from '../../../domain/errors';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { ArtifactProbeResponse, probeArtifactContent } from '../artifact-probe';

export class ProbeProposalFileContentUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly catalog?: SkillCatalogPort
  ) {}

  async execute(
    proposalId: string,
    filePath: string
  ): Promise<ArtifactProbeResponse> {
    await this.ensureProposalFileExists(proposalId, filePath);

    const stored = await this.storage.readProposalFile(proposalId, filePath);
    if (!stored) {
      throw new NotFoundError(`Proposal file ${filePath} not found`);
    }

    return probeArtifactContent(stored.content, stored.mimeType, filePath);
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
