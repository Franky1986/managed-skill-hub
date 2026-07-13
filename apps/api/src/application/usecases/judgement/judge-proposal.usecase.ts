import { NotFoundError } from '../../../domain/errors';
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

const MAX_PROPOSAL_FILE_TEXT_CHARS = 8000;

export class JudgeProposalUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly judger: SkillJudgerPort,
    private readonly audit: AuditLogPort,
    private readonly catalog?: SkillCatalogPort,
    private readonly storage?: SkillFileStoragePort,
    private readonly scanner?: FileScannerPort
  ) {}

  async execute(proposalId: string) {
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new NotFoundError(`Proposal ${proposalId} not found`);
    }

    const judgement = await this.judger.judge({
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
    return judgement;
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
