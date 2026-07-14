import { NotFoundError, ValidationError } from '../../../domain/errors';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillJudgerPort } from '../../ports/outbound/judger.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { Proposal } from '../../../domain/proposal/Proposal';
import { buildProposalAggregateFromCatalog } from '../proposal/catalog-proposal-hydrator';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { isTextLikeArtifact } from '../skill/public-metadata';
import { JudgementRuntimeEventSink, judgementErrorCategory } from './judgement-runtime-event';

const MAX_PROPOSAL_FILE_TEXT_CHARS = 8000;

export class JudgeProposalUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly judger: SkillJudgerPort,
    private readonly audit: AuditLogPort,
    private readonly catalog?: SkillCatalogPort,
    private readonly storage?: SkillFileStoragePort,
    private readonly scanner?: FileScannerPort,
    private readonly judgementEvents?: JudgementRuntimeEventSink
  ) {}

  async execute(proposalId: string) {
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new NotFoundError(`Proposal ${proposalId} not found`);
    }

    let judgement;
    try {
      judgement = await this.judger.judge({
        type: 'proposal',
        id: proposal.id,
        title: proposal.title,
        text: await this.buildProposalJudgementText(proposal),
        metadata: {
          groups: proposal.groups,
          capabilities: proposal.capabilities,
          files: proposal.files.map((file) => ({
            path: file.path,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
          })),
        },
      });
    } catch (error) {
      await this.audit.append(AuditEntry.create({
        proposalId,
        action: 'proposal_judgement_failed',
        actor: 'system',
        after: { errorCategory: judgementErrorCategory(error) },
      }));
      this.judgementEvents?.({
        event: 'judgement_execution',
        outcome: 'failure',
        operation: 'proposal',
        proposalId,
        errorCategory: judgementErrorCategory(error),
      });
      throw error;
    }

    const updated = proposal.addJudgement(judgement);
    await this.repo.saveProposal(updated);
    await this.audit.append(
      AuditEntry.create({
        proposalId: proposal.id,
        action: 'judge_proposal',
        actor: 'system',
        after: { judgementId: judgement.id, overallRisk: judgement.overallRisk },
      })
    );
    this.judgementEvents?.({
      event: 'judgement_execution',
      outcome: 'success',
      operation: 'proposal',
      proposalId,
    });
    return judgement;
  }

  async executeFile(proposalId: string, filePath: string) {
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new NotFoundError(`Proposal ${proposalId} not found`);
    }
    const file = proposal.files.find((candidate) => candidate.path === filePath || candidate.id === filePath);
    if (!file) {
      throw new NotFoundError(`Proposal file ${filePath} not found`);
    }
    if (!this.storage || !this.scanner) {
      throw new ValidationError('Proposal file judgement is not available without storage and scanner adapters.');
    }
    const stored = await this.storage.readProposalFile(proposal.id, file.path);
    if (!stored) {
      throw new NotFoundError(`Proposal file ${file.path} not found in storage`);
    }

    try {
      const scanned = isTextLikeArtifact(stored.mimeType, file.path)
        ? { text: stored.content.toString('utf-8'), extractedBy: 'native' }
        : await this.scanner.scan(stored.content, stored.mimeType, file.path);
      const judgement = await this.judger.judge({
        type: 'file',
        id: `${proposal.id}:${file.path}`,
        title: file.path,
        text: truncate(scanned.text, MAX_PROPOSAL_FILE_TEXT_CHARS),
        metadata: {
          mimeType: stored.mimeType,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          extractedBy: scanned.extractedBy,
        },
      });
      const updated = proposal.addJudgement(judgement);
      await this.repo.saveProposal(updated);
      await this.audit.append(AuditEntry.create({
        proposalId,
        action: 'judge_proposal_file',
        actor: 'system',
        after: { file: file.path, judgementId: judgement.id, overallRisk: judgement.overallRisk },
      }));
      this.judgementEvents?.({
        event: 'judgement_execution',
        outcome: 'success',
        operation: 'proposal_file',
        proposalId,
        filePath: file.path,
      });
      return judgement;
    } catch (error) {
      await this.audit.append(AuditEntry.create({
        proposalId,
        action: 'file_judgement_failed',
        actor: 'system',
        after: { file: file.path, error: (error as Error).message },
      }));
      this.judgementEvents?.({
        event: 'judgement_execution',
        outcome: 'failure',
        operation: 'proposal_file',
        proposalId,
        filePath: file.path,
        errorCategory: judgementErrorCategory(error),
      });
      throw error;
    }
  }

  private async loadProposal(proposalId: string): Promise<Proposal | null> {
    if (this.catalog) {
      const proposal = await buildProposalAggregateFromCatalog(this.catalog, proposalId);
      if (proposal) {
        return proposal;
      }
    }

    return this.repo.findProposalById(proposalId);
  }

  private async buildProposalJudgementText(proposal: Proposal): Promise<string> {
    const sections = [
      `Title: ${proposal.title}`,
      `Description:\n${proposal.description}`,
    ];

    const fileSections = await this.buildProposalFileSections(proposal);
    if (fileSections.length > 0) {
      sections.push(`Attached files:\n\n${fileSections.join('\n\n')}`);
    }

    return sections.join('\n\n');
  }

  private async buildProposalFileSections(proposal: Proposal): Promise<string[]> {
    if (!this.storage || !this.scanner) {
      return [];
    }

    const sections: string[] = [];
    for (const file of proposal.files) {
      const stored = await this.storage.readProposalFile(proposal.id, file.path);
      if (!stored) {
        sections.push(`File: ${file.path}\nMIME: ${file.mimeType}\n[FILE NOT FOUND IN STORAGE]`);
        continue;
      }

      try {
        const scanned = isTextLikeArtifact(stored.mimeType, file.path)
          ? {
              text: stored.content.toString('utf-8'),
              metadata: { mimeType: stored.mimeType, filePath: file.path, extractor: 'native' },
              extractedBy: 'native',
            }
          : await this.scanner.scan(stored.content, stored.mimeType, file.path);
        sections.push([
          `File: ${file.path}`,
          `MIME: ${stored.mimeType}`,
          `Size bytes: ${file.sizeBytes}`,
          'Content:',
          truncate(scanned.text, MAX_PROPOSAL_FILE_TEXT_CHARS),
        ].join('\n'));
      } catch (error) {
        sections.push([
          `File: ${file.path}`,
          `MIME: ${stored.mimeType}`,
          `Size bytes: ${file.sizeBytes}`,
          `[FILE CONTENT COULD NOT BE EXTRACTED: ${(error as Error).message}]`,
        ].join('\n'));
      }
    }
    return sections;
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n\n[TRUNCATED ${text.length - maxLength} CHARS]`;
}
