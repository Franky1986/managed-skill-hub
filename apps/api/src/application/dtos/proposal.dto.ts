import { ProposalStatus } from '../../domain/proposal/ProposalStatus';
import { JudgementDto } from './judgement.dto';
import { JudgementOverallRisk } from '../../domain/judgement/Judgement';
import { ReviewLabel } from '../usecases/proposal/review-metadata';

export interface ProposalReviewDto {
  latestJudgementRisk: JudgementOverallRisk | null;
  labels: ReviewLabel[];
  latestJudgementId: string | null;
  latestJudgedAt: Date | null;
}

export interface ProposalLifecycleEventDto {
  id: string;
  action: string;
  actor: string;
  at: Date;
  fromStatus: string | null;
  toStatus: string | null;
  skillId: string | null;
  skillVersion: string | null;
  reason: string | null;
  comment: string | null;
}

export interface ProposalSummaryDto {
  id: string;
  skillId: string | null;
  title: string;
  status: ProposalStatus;
  createdAt: Date;
  submittedAt: Date;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  latestJudgementRisk: JudgementOverallRisk | null;
  latestJudgement: JudgementDto | null;
  labels: ReviewLabel[];
  conversion?: ProposalConversionPreviewDto;
}

export interface ProposalFileDto {
  id: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  extractable: boolean;
}

export interface ProposalConversionPreviewDto {
  mode: 'create_skill' | 'create_version';
  targetSkillId: string;
  targetSkillTitle: string | null;
  targetSkillExists: boolean;
  currentLatestVersion: string | null;
  nextVersion: string;
  targetEntrypoint: string;
}

export interface ProposalDetailDto {
  id: string;
  skillId: string | null;
  title: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  entrypoint: string | null;
  status: ProposalStatus;
  createdAt: Date;
  submittedBy: string;
  files: ProposalFileDto[];
  judgements: JudgementDto[];
  rejectionReason: string | null;
  review: ProposalReviewDto;
  conversion: ProposalConversionPreviewDto;
  lifecycle: ProposalLifecycleEventDto[];
  uploadFinalized: boolean;
  fileCount: number;
  maxFiles: number;
  maxFileSizeBytes: number;
  disallowedPaths: string[];
  autoPublishEnabled: boolean;
  autoPublishEligible: boolean | null;
  autoPublishBlockedReason: string | null;
  autoPublishBlockedByCategory: boolean | null;
  autoPublishClassifierReason: string | null;
  autoPublishMatchedExcludedCategory: string | null;
  autoPublished: boolean;
  autoPublishedSkillId: string | null;
  autoPublishedVersion: string | null;
}


export interface ProposalPublicStatusDto {
  id: string;
  skillId: string | null;
  title: string;
  status: ProposalStatus;
  createdAt: Date;
  submittedBy: string;
  latestJudgementRisk: JudgementOverallRisk | null;
  rejectionReason: string | null;
  convertedSkillId: string | null;
  contentDigest: string | null;
  duplicateOfProposalId: string | null;
  duplicateOfSkillId: string | null;
  uploadFinalized: boolean;
  finalizeRequired: boolean;
  autoPublishEnabled: boolean;
  autoPublishEligible: boolean | null;
  autoPublishBlockedReason: string | null;
  reviewNote: string;
  nextStepForSubmitter: string;
  adminOnlyNextSteps: string[];
}

export interface ProposalAdminUpdateRequestDto {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  capabilities?: string[];
  entrypoint?: string | null;
}

export interface ProposalSubmissionResponseDto {
  id: string;
  message: string;
  statusUrl: string;
  checkUrl: string;
  finalizeUploadUrl: string;
}

export interface ProposalFinalizeUploadResponseDto {
  id: string;
  status: ProposalStatus;
  message: string;
  statusUrl: string;
  checkUrl: string;
  uploadFinalized: boolean;
  judgementStatus: 'completed';
  autoPublishStatus: 'disabled' | 'skipped' | 'published';
  autoPublishBlockedReason: string | null;
}


export interface DuplicateCheckInputDto {
  skillId?: string;
  title: string;
  description: string;
  category: string;
  tags?: string[];
  capabilities?: string[];
  entrypoint?: string;
  files?: Array<{ path: string; sha256?: string | null }>;
}

export interface DuplicateCheckMatchDto {
  kind: 'proposal' | 'skill';
  id: string;
  skillId: string | null;
  title: string;
  description: string;
  category: string;
  version?: string;
  status?: string;
  similarityScore: number;
  matchedOn: string[];
  differences: {
    title?: string;
    description?: string;
    tags?: { shared: string[]; onlyInSubmitted: string[]; onlyInExisting: string[] };
    capabilities?: { shared: string[]; onlyInSubmitted: string[]; onlyInExisting: string[] };
    entrypoint?: string;
  };
}

export interface DuplicateCheckResolutionOptionDto {
  strategy: 'create_new_skill' | 'create_new_version' | 'request_admin_update';
  label: string;
  description: string;
  suggestedSkillId?: string;
  requiresAdminAction: boolean;
}

export interface DuplicateCheckResultDto {
  submittedContentDigest: string | null;
  exactDuplicateProposalId: string | null;
  exactDuplicateSkillId: string | null;
  similarMatches: DuplicateCheckMatchDto[];
  skillIdCollision: {
    exists: boolean;
    existingSkillId: string | null;
    note: string;
  };
  resolutionOptions: DuplicateCheckResolutionOptionDto[];
  note: string;
}
