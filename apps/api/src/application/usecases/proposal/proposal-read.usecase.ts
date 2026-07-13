import { ProposalStatus } from '../../../domain/proposal/ProposalStatus';
import { JudgementOverallRisk } from '../../../domain/judgement/Judgement';
import { ProposalDetailDto, ProposalLifecycleEventDto, ProposalPublicStatusDto, ProposalSummaryDto } from '../../dtos/proposal.dto';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { NotFoundError } from '../../../domain/errors';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { AutoPublishBlockedReason } from './auto-publish-proposal.usecase';
import {
  ExtractProposalFileContentUseCase,
  ExtractedProposalFileContent,
} from './extract-proposal-file-content.usecase';
import {
  mapCatalogProposalToDetail,
  mapCatalogProposalToSummary,
  mapCatalogProposalToReview,
  mapProposalToDetail,
  mapProposalToSummary,
} from './mappers/proposal.mapper';

export interface ProposalNoticeDto {
  hasNewProposals: boolean;
  totalPending: number;
}

export class ProposalReadUseCase {

  async getPublicStatus(proposalId: string): Promise<ProposalPublicStatusDto | null> {
    let proposal: {
      id: string;
      skillId: string | null;
      title: string;
      status: string;
      createdAt: Date;
      submittedBy: string;
      rejectionReason: string | null;
      latestJudgementRisk: JudgementOverallRisk | null;
      contentDigest: string | null;
      convertedSkillId?: string | null;
    } | null = null;

    if (this.catalog) {
      const row = await this.catalog.getProposal(proposalId);
      if (row) {
        proposal = {
          id: row.id,
          skillId: row.skillId,
          title: row.title,
          status: row.status,
          createdAt: row.createdAt,
          submittedBy: row.submittedBy,
          rejectionReason: row.rejectionReason,
          latestJudgementRisk: row.latestJudgementRisk,
          contentDigest: row.contentDigest,
        };
      }
    }

    if (!proposal) {
      const found = await this.repo.findProposalById(proposalId);
      if (!found) {
        return null;
      }
      proposal = {
        id: found.id,
        skillId: found.skillId,
        title: found.title,
        status: found.status,
        createdAt: found.createdAt,
        submittedBy: found.submittedBy,
        rejectionReason: found.rejectionReason,
        latestJudgementRisk: found.judgements[found.judgements.length - 1]?.overallRisk ?? null,
        contentDigest: found.contentDigest,
      };
    }

    const after = await this.audit.findByProposalId(proposalId);
    const autoPublishState = deriveAutoPublishState(after, this.autoPublishOnGreen, proposal.status as ProposalStatus);
    const converted = after.find((entry) => entry.action === 'convert_proposal');
    let convertedSkillId: string | null = null;
    if (converted?.after) {
      if (typeof converted.after === 'object' && 'skillId' in converted.after && converted.after.skillId) {
        convertedSkillId = String(converted.after.skillId);
      } else if (converted.skillId) {
        // Audit entry may store skillId in the top-level skillId field rather than in after.
        convertedSkillId = String(converted.skillId);
      }
    }
    const adminReviewDone = proposal.status === 'approved' || proposal.status === 'rejected' || proposal.status === 'converted' || convertedSkillId !== null;
    const uploadFinalized = proposal.status !== ProposalStatus.IN_UPLOAD;

    let duplicateOfProposalId: string | null = null;
    let duplicateOfSkillId: string | null = null;
    if (this.catalog && proposal.contentDigest) {
      const duplicateProposal = await this.catalog.findProposalByContentDigest(proposal.contentDigest, proposalId);
      if (duplicateProposal) {
        duplicateOfProposalId = duplicateProposal.id;
      } else {
        const duplicateSkill = await this.catalog.findPublishedSkillByContentDigest(proposal.contentDigest);
        if (duplicateSkill) {
          duplicateOfSkillId = duplicateSkill.skillId;
        }
      }
    }

    return {
      id: proposal.id,
      skillId: proposal.skillId,
      title: proposal.title,
      status: proposal.status as ProposalStatus,
      createdAt: proposal.createdAt,
      submittedBy: proposal.submittedBy,
      latestJudgementRisk: proposal.latestJudgementRisk,
      rejectionReason: proposal.rejectionReason,
      convertedSkillId,
      contentDigest: proposal.contentDigest,
      duplicateOfProposalId,
      duplicateOfSkillId,
      uploadFinalized,
      finalizeRequired: !uploadFinalized,
      autoPublishEnabled: autoPublishState.enabled,
      autoPublishEligible: autoPublishState.eligible,
      autoPublishBlockedReason: autoPublishState.blockedReason,
      reviewNote: !uploadFinalized
        ? 'This proposal upload is still open. The submitter must finish attaching files and explicitly finalize the upload before review can continue.'
        : adminReviewDone
        ? 'Admin review has been completed for this proposal.'
        : 'This proposal is awaiting admin review. Automatic judgement is performed, but only an admin can approve, reject or convert it into a published skill.',
      nextStepForSubmitter: !uploadFinalized
        ? 'Continue attaching files if needed, then call POST /proposals/{id}/finalize-upload when the package is complete. After finalization, poll this endpoint again.'
        : adminReviewDone
        ? 'No further action from the submitter is possible. Check convertedSkillId or rejectionReason for the outcome.'
        : 'Poll this endpoint periodically. Once an admin reviews the proposal, convertedSkillId or rejectionReason will be populated.',
      adminOnlyNextSteps: ['review proposal details', 'convert proposal to skill', 'reject proposal with reason'],
    };
  }

  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly extractor: ExtractProposalFileContentUseCase,
    private readonly audit: AuditLogPort,
    private readonly catalog?: SkillCatalogPort,
    private readonly autoPublishOnGreen = false,
    private readonly proposalMaxFiles = 30,
    private readonly proposalMaxFileSizeBytes = 10 * 1024 * 1024,
    private readonly proposalDisallowedPaths: string[] = []
  ) {}

  async getNotice(): Promise<ProposalNoticeDto> {
    if (this.catalog) {
      const totalPending = await this.catalog.countPendingProposals();
      return {
        hasNewProposals: totalPending > 0,
        totalPending,
      };
    }

    const result = await this.repo.findProposals();
    const totalPending = result.items.filter(
      (proposal) =>
        proposal.status === 'submitted' || proposal.status === 'judged'
    ).length;
    return {
      hasNewProposals: totalPending > 0,
      totalPending,
    };
  }

  async listSummaries(skillId?: string, status?: string): Promise<{ items: ProposalSummaryDto[]; total: number }> {
    if (this.catalog) {
      const catalog = this.catalog;
      const result = await catalog.listProposals({ skillId, status });
      const itemsWithConversion = await Promise.all(
        result.items.map(async (proposal) => {
          const [conversion, auditEntries, proposalJudgements] = await Promise.all([
            this.buildConversionPreview({
              skillId: proposal.skillId,
              title: proposal.title,
              entrypoint: proposal.entrypoint,
              filePaths: [],
            }),
            this.audit.findByProposalId(proposal.id),
            catalog.listProposalJudgements(proposal.id),
          ]);
          const proposalLevelJudgements = proposalJudgements
            .filter((judgement) => judgement.targetType === 'proposal')
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          return mapCatalogProposalToSummary(
            proposal,
            conversion,
            buildProposalLifecycle({
              id: proposal.id,
              createdAt: proposal.createdAt,
              submittedBy: proposal.submittedBy,
            }, auditEntries),
            proposalLevelJudgements[proposalLevelJudgements.length - 1] ?? null
          );
        })
      );
      return {
        items: itemsWithConversion,
        total: result.total,
      };
    }

    const result = await this.repo.findProposals({ skillId, status });
    const items = await Promise.all(
      result.items.map(async (proposal) => {
        const [conversion, auditEntries] = await Promise.all([
          this.buildConversionPreview({
            skillId: proposal.skillId,
            title: proposal.title,
            entrypoint: proposal.entrypoint,
            filePaths: proposal.files.map((file) => file.path),
          }),
          this.audit.findByProposalId(proposal.id),
        ]);
        return mapProposalToSummary(
          proposal,
          conversion,
          buildProposalLifecycle({
            id: proposal.id,
            createdAt: proposal.createdAt,
            submittedBy: proposal.submittedBy,
          }, auditEntries)
        );
      })
    );
    return { items, total: result.total };
  }

  async getDetail(proposalId: string): Promise<ProposalDetailDto | null> {
    const auditEntries = await this.audit.findByProposalId(proposalId);
    if (this.catalog) {
      const proposal = await this.catalog.getProposal(proposalId);
      if (proposal) {
        const autoPublishState = deriveAutoPublishState(auditEntries, this.autoPublishOnGreen, proposal.status);
        const [files, judgements] = await Promise.all([
          this.catalog.listProposalFiles(proposalId),
          this.catalog.listProposalJudgements(proposalId),
        ]);
        return mapCatalogProposalToDetail(
          proposal,
          files,
          judgements,
          await this.buildConversionPreview({
            skillId: proposal.skillId,
            title: proposal.title,
            entrypoint: proposal.entrypoint,
            filePaths: files.map((file) => file.path),
          }),
          buildProposalLifecycle({
            id: proposal.id,
            createdAt: proposal.createdAt,
            submittedBy: proposal.submittedBy,
          }, auditEntries),
          {
            uploadFinalized: proposal.status !== ProposalStatus.IN_UPLOAD,
            fileCount: files.length,
            maxFiles: this.proposalMaxFiles,
            maxFileSizeBytes: this.proposalMaxFileSizeBytes,
            disallowedPaths: this.proposalDisallowedPaths,
            autoPublishState,
          }
        );
      }
    }

    const proposal = await this.repo.findProposalById(proposalId);
    if (!proposal) {
      return null;
    }
    const autoPublishState = deriveAutoPublishState(auditEntries, this.autoPublishOnGreen, proposal.status);
    const catalogProposal = this.catalog ? await this.catalog.getProposal(proposalId) : null;
    return mapProposalToDetail(
      proposal,
      catalogProposal ? mapCatalogProposalToReview(catalogProposal) : undefined,
      await this.buildConversionPreview({
        skillId: proposal.skillId,
        title: proposal.title,
        entrypoint: proposal.entrypoint,
        filePaths: proposal.files.map((file) => file.path),
      }),
      buildProposalLifecycle({
        id: proposal.id,
        createdAt: proposal.createdAt,
        submittedBy: proposal.submittedBy,
      }, auditEntries),
      {
        uploadFinalized: proposal.status !== ProposalStatus.IN_UPLOAD,
        fileCount: proposal.files.length,
        maxFiles: this.proposalMaxFiles,
        maxFileSizeBytes: this.proposalMaxFileSizeBytes,
        disallowedPaths: this.proposalDisallowedPaths,
        autoPublishState,
      }
    );
  }

  async getFile(proposalId: string, filePath: string): Promise<{ path: string; mimeType: string; content: Buffer }> {
    const file = await this.storage.readProposalFile(proposalId, filePath);
    if (!file) {
      throw new NotFoundError(`Proposal file ${filePath} not found`);
    }
    return {
      path: filePath,
      mimeType: file.mimeType,
      content: file.content,
    };
  }

  async getExtractedContent(proposalId: string, filePath: string): Promise<ExtractedProposalFileContent> {
    return this.extractor.execute(proposalId, filePath);
  }

  private async buildConversionPreview(input: {
    skillId: string | null;
    title: string;
    entrypoint: string | null;
    filePaths: string[];
  }) {
    const targetSkillId = input.skillId ?? slugify(input.title);
    const targetEntrypoint = input.entrypoint ?? input.filePaths[0] ?? 'README.md';

    if (!targetSkillId) {
      return {
        mode: 'create_skill' as const,
        targetSkillId: 'unresolved-skill-id',
        targetSkillTitle: null,
        targetSkillExists: false,
        currentLatestVersion: null,
        nextVersion: '1.0.0',
        targetEntrypoint,
      };
    }

    const existingTarget = await this.loadTargetSkill(targetSkillId);
    if (!existingTarget) {
      return {
        mode: 'create_skill' as const,
        targetSkillId,
        targetSkillTitle: null,
        targetSkillExists: false,
        currentLatestVersion: null,
        nextVersion: '1.0.0',
        targetEntrypoint,
      };
    }

    return {
      mode: 'create_version' as const,
      targetSkillId,
      targetSkillTitle: existingTarget.title,
      targetSkillExists: true,
      currentLatestVersion: existingTarget.currentLatestVersion,
      nextVersion: existingTarget.currentLatestVersion
        ? bumpPatchVersion(existingTarget.currentLatestVersion)
        : '1.0.0',
      targetEntrypoint,
    };
  }

  private async loadTargetSkill(skillId: string): Promise<{ title: string | null; currentLatestVersion: string | null } | null> {
    if (this.catalog) {
      const latestVersion = await this.catalog.getLatestVersion(skillId);
      if (latestVersion) {
        return {
          title: latestVersion.title,
          currentLatestVersion: latestVersion.version,
        };
      }
    }

    const skill = await this.repo.findById(skillId);
    if (!skill) {
      return null;
    }
    const latestVersion = skill.getAllVersions()[skill.getAllVersions().length - 1] ?? null;
    return {
      title: latestVersion?.manifest.title ?? skill.getLatestPublishedVersion()?.manifest.title ?? skillId,
      currentLatestVersion: latestVersion?.version ?? null,
    };
  }
}

function buildProposalLifecycle(
  proposal: { id: string; createdAt: Date; submittedBy: string },
  auditEntries: AuditEntry[]
): ProposalLifecycleEventDto[] {
  const submittedEvent: ProposalLifecycleEventDto = {
    id: `${proposal.id}:upload_started`,
    action: 'upload_started',
    actor: proposal.submittedBy,
    at: proposal.createdAt,
    fromStatus: null,
    toStatus: 'in_upload',
    skillId: null,
    skillVersion: null,
    reason: null,
    comment: null,
  };

  const events = auditEntries
    .filter((entry) => isProposalLifecycleAction(entry.action))
    .map(mapAuditEntryToLifecycleEvent);

  return [submittedEvent, ...events]
    .filter((event, index, all) => all.findIndex((candidate) => candidate.id === event.id) === index)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function isProposalLifecycleAction(action: string): boolean {
  return [
    'submit_proposal',
    'finalize_proposal_upload',
    'update_proposal_metadata',
    'judge_proposal',
    'attach_proposal_file',
    'reject_proposal',
    'convert_proposal',
    'create_skill_version_from_proposal',
  ].includes(action);
}

function mapAuditEntryToLifecycleEvent(entry: AuditEntry): ProposalLifecycleEventDto {
  return {
    id: entry.id,
    action: entry.action,
    actor: entry.actor,
    at: entry.createdAt,
    fromStatus: readString(entry.before, 'status'),
    toStatus: readString(entry.after, 'status'),
    skillId: entry.skillId ?? readString(entry.after, 'skillId'),
    skillVersion: entry.skillVersion ?? readString(entry.after, 'version'),
    reason: readString(entry.after, 'reason'),
    comment: readString(entry.after, 'comment'),
  };
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readBoolean(source: Record<string, unknown> | null, key: string): boolean | null {
  const value = source?.[key];
  return typeof value === 'boolean' ? value : null;
}

function readBlockedReason(source: Record<string, unknown> | null, key: string): AutoPublishBlockedReason | null {
  const value = readString(source, key);
  if (
    value === 'incomplete_upload' ||
    value === 'duplicate_or_collision' ||
    value === 'non_green_judgement' ||
    value === 'category_blocked' ||
    value === 'classifier_failed' ||
    value === 'manual_review_required'
  ) {
    return value;
  }
  return null;
}

function deriveAutoPublishState(auditEntries: AuditEntry[], enabled: boolean, proposalStatus: ProposalStatus): {
  enabled: boolean;
  eligible: boolean | null;
  blockedReason: AutoPublishBlockedReason | null;
  blockedByCategory: boolean | null;
  classifierReason: string | null;
  matchedExcludedCategory: string | null;
  autoPublished: boolean;
  publishedSkillId: string | null;
  publishedVersion: string | null;
} {
  const evaluationEntry = [...auditEntries].reverse().find((entry) => entry.action === 'evaluate_auto_publish');
  const publishedEntry = [...auditEntries].reverse().find((entry) => entry.action === 'auto_publish_proposal');
  const failedEntry = [...auditEntries].reverse().find((entry) => entry.action === 'auto_publish_failed');
  const evaluationAfter = evaluationEntry?.after ?? null;
  const incompleteUpload = enabled && proposalStatus === ProposalStatus.IN_UPLOAD && !evaluationEntry && !publishedEntry;

  return {
    enabled,
    eligible: incompleteUpload ? false : failedEntry ? false : readBoolean(evaluationAfter, 'eligible'),
    blockedReason: incompleteUpload
      ? 'incomplete_upload'
      : failedEntry
      ? 'manual_review_required'
      : readBlockedReason(evaluationAfter, 'blockedReason'),
    blockedByCategory: readBoolean(evaluationAfter, 'blockedByCategory'),
    classifierReason: readString(evaluationAfter, 'classifierReason') ?? readString(failedEntry?.after ?? null, 'error'),
    matchedExcludedCategory: readString(evaluationAfter, 'matchedExcludedCategory'),
    autoPublished: Boolean(publishedEntry),
    publishedSkillId: publishedEntry?.skillId ?? readString(publishedEntry?.after ?? null, 'skillId'),
    publishedVersion: publishedEntry?.skillVersion ?? readString(publishedEntry?.after ?? null, 'version'),
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function bumpPatchVersion(version: string): string {
  const parts = version.split('.').map((part) => Number(part));
  const major = Number.isFinite(parts[0]) ? parts[0] : 1;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  const patch = (Number.isFinite(parts[2]) ? parts[2] : 0) + 1;
  return `${major}.${minor}.${patch}`;
}
