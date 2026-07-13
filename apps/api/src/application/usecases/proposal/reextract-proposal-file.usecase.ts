import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import {
  ExtractProposalFileContentUseCase,
  ExtractedProposalFileContent,
} from './extract-proposal-file-content.usecase';

export class ReextractProposalFileUseCase {
  constructor(
    private readonly extractor: ExtractProposalFileContentUseCase,
    private readonly audit: AuditLogPort
  ) {}

  async execute(proposalId: string, filePath: string, actor: string): Promise<ExtractedProposalFileContent> {
    const extracted = await this.extractor.execute(proposalId, filePath, { forceRefresh: true });

    await this.audit.append(
      AuditEntry.create({
        proposalId,
        action: 'reextract_proposal_file',
        actor,
        after: {
          filePath,
          extractedBy: extracted.extractedBy,
        },
      })
    );

    return extracted;
  }
}
