import { JudgementDto } from '../../../dtos/judgement.dto';
import { ProposalConversionPreviewDto, ProposalDetailDto, ProposalLifecycleEventDto, ProposalSummaryDto } from '../../../dtos/proposal.dto';
import {
  CatalogJudgementRecord,
  CatalogProposalFileRecord,
  CatalogProposalRecord,
} from '../../../ports/outbound/skill-catalog.port';
import { Proposal } from '../../../../domain/proposal/Proposal';
import { ProposalReviewMetadata, deriveProposalReviewMetadata } from '../review-metadata';
import { isExtractableArtifact } from '../../skill/public-metadata';

interface ProposalReadAugmentation {
  uploadFinalized: boolean;
  fileCount: number;
  maxFiles: number;
  maxFileSizeBytes: number;
  disallowedPaths: string[];
  autoPublishState: {
    enabled: boolean;
    eligible: boolean | null;
    blockedReason: string | null;
    blockedByCategory: boolean | null;
    classifierReason: string | null;
    matchedExcludedCategory: string | null;
    autoPublished: boolean;
    publishedSkillId: string | null;
    publishedVersion: string | null;
  };
}
export function mapProposalToSummary(
  proposal: Proposal,
  conversion?: ProposalConversionPreviewDto,
  lifecycle: ProposalLifecycleEventDto[] = []
): ProposalSummaryDto {
  const review = deriveReviewMetadata(proposal);
  const rejection = findLifecycleEvent(lifecycle, 'reject_proposal');
  return {
    id: proposal.id,
    skillId: proposal.skillId,
    title: proposal.title,
    status: proposal.status,
    createdAt: proposal.createdAt,
    submittedAt: proposal.createdAt,
    rejectedAt: rejection?.at ?? null,
    rejectedBy: rejection?.actor ?? null,
    latestJudgementRisk: review.latestJudgementRisk,
    latestJudgement: proposal.judgements[proposal.judgements.length - 1] ?? null,
    labels: review.labels,
    conversion,
  };
}

export function mapProposalToDetail(
  proposal: Proposal,
  review: ProposalReviewMetadata = deriveReviewMetadata(proposal),
  conversion: ProposalConversionPreviewDto,
  lifecycle: ProposalLifecycleEventDto[] = [],
  augmentation: ProposalReadAugmentation
): ProposalDetailDto {
  return {
    id: proposal.id,
    skillId: proposal.skillId,
    title: proposal.title,
    description: proposal.description,
    category: proposal.category,
    tags: proposal.tags,
    capabilities: proposal.capabilities,
    entrypoint: proposal.entrypoint,
    status: proposal.status,
    createdAt: proposal.createdAt,
    submittedBy: proposal.submittedBy,
    files: proposal.files.map((file) => ({
      id: file.id,
      path: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      extractable: isExtractableArtifact(file.mimeType, file.path),
    })),
    judgements: proposal.judgements,
    rejectionReason: proposal.rejectionReason,
    review,
    conversion,
    lifecycle,
    uploadFinalized: augmentation.uploadFinalized,
    fileCount: augmentation.fileCount,
    maxFiles: augmentation.maxFiles,
    maxFileSizeBytes: augmentation.maxFileSizeBytes,
    disallowedPaths: augmentation.disallowedPaths,
    autoPublishEnabled: augmentation.autoPublishState.enabled,
    autoPublishEligible: augmentation.autoPublishState.eligible,
    autoPublishBlockedReason: augmentation.autoPublishState.blockedReason,
    autoPublishBlockedByCategory: augmentation.autoPublishState.blockedByCategory,
    autoPublishClassifierReason: augmentation.autoPublishState.classifierReason,
    autoPublishMatchedExcludedCategory: augmentation.autoPublishState.matchedExcludedCategory,
    autoPublished: augmentation.autoPublishState.autoPublished,
    autoPublishedSkillId: augmentation.autoPublishState.publishedSkillId,
    autoPublishedVersion: augmentation.autoPublishState.publishedVersion,
  };
}

export function mapCatalogProposalToSummary(
  proposal: CatalogProposalRecord,
  conversion?: ProposalConversionPreviewDto,
  lifecycle: ProposalLifecycleEventDto[] = [],
  latestJudgement: CatalogJudgementRecord | null = null
): ProposalSummaryDto {
  const rejection = findLifecycleEvent(lifecycle, 'reject_proposal');
  return {
    id: proposal.id,
    skillId: proposal.skillId,
    title: proposal.title,
    status: proposal.status,
    createdAt: proposal.createdAt,
    submittedAt: proposal.createdAt,
    rejectedAt: rejection?.at ?? null,
    rejectedBy: rejection?.actor ?? null,
    latestJudgementRisk: proposal.latestJudgementRisk,
    latestJudgement: latestJudgement ? mapCatalogJudgementToDto(latestJudgement) : null,
    labels: proposal.labels,
    conversion,
  };
}

function findLifecycleEvent(events: ProposalLifecycleEventDto[], action: string): ProposalLifecycleEventDto | null {
  return [...events].reverse().find((event) => event.action === action) ?? null;
}

export function mapCatalogProposalToReview(proposal: CatalogProposalRecord): ProposalReviewMetadata {
  return {
    latestJudgementRisk: proposal.latestJudgementRisk,
    labels: proposal.labels,
    latestJudgementId: proposal.latestJudgementId,
    latestJudgedAt: proposal.latestJudgedAt,
  };
}

export function mapCatalogProposalToDetail(
  proposal: CatalogProposalRecord,
  files: CatalogProposalFileRecord[],
  judgements: CatalogJudgementRecord[],
  conversion: ProposalConversionPreviewDto,
  lifecycle: ProposalLifecycleEventDto[] = [],
  augmentation: ProposalReadAugmentation
): ProposalDetailDto {
  return {
    id: proposal.id,
    skillId: proposal.skillId,
    title: proposal.title,
    description: proposal.description,
    category: proposal.category,
    tags: proposal.tags,
    capabilities: proposal.capabilities,
    entrypoint: proposal.entrypoint,
    status: proposal.status,
    createdAt: proposal.createdAt,
    submittedBy: proposal.submittedBy,
    files: files.map((file) => ({
      id: file.id,
      path: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      extractable: isExtractableArtifact(file.mimeType, file.path),
    })),
    judgements: judgements.map(mapCatalogJudgementToDto),
    rejectionReason: proposal.rejectionReason,
    review: mapCatalogProposalToReview(proposal),
    conversion,
    lifecycle,
    uploadFinalized: augmentation.uploadFinalized,
    fileCount: augmentation.fileCount,
    maxFiles: augmentation.maxFiles,
    maxFileSizeBytes: augmentation.maxFileSizeBytes,
    disallowedPaths: augmentation.disallowedPaths,
    autoPublishEnabled: augmentation.autoPublishState.enabled,
    autoPublishEligible: augmentation.autoPublishState.eligible,
    autoPublishBlockedReason: augmentation.autoPublishState.blockedReason,
    autoPublishBlockedByCategory: augmentation.autoPublishState.blockedByCategory,
    autoPublishClassifierReason: augmentation.autoPublishState.classifierReason,
    autoPublishMatchedExcludedCategory: augmentation.autoPublishState.matchedExcludedCategory,
    autoPublished: augmentation.autoPublishState.autoPublished,
    autoPublishedSkillId: augmentation.autoPublishState.publishedSkillId,
    autoPublishedVersion: augmentation.autoPublishState.publishedVersion,
  };
}

function mapCatalogJudgementToDto(judgement: CatalogJudgementRecord): JudgementDto {
  return {
    id: judgement.id,
    targetType: judgement.targetType,
    targetId: judgement.targetId,
    dimensions: judgement.dimensions,
    overallRisk: judgement.overallRisk,
    summary: judgement.summary,
    skillPurposeSummary: judgement.skillPurposeSummary,
    model: judgement.model,
    createdAt: judgement.createdAt,
  };
}

function deriveReviewMetadata(proposal: Proposal): ProposalReviewMetadata {
  return deriveProposalReviewMetadata({
    title: proposal.title,
    description: proposal.description,
    entrypoint: proposal.entrypoint,
    tags: proposal.tags,
    capabilities: proposal.capabilities,
    judgements: proposal.judgements,
    files: proposal.files.map((file) => ({ path: file.path, mimeType: file.mimeType })),
  });
}
