import { apiClient } from './client';
import type { JudgementRecord } from './judgements';

export interface ProposalSubmissionResponse {
    id: string;
    message: string;
    statusUrl: string;
    checkUrl: string;
    finalizeUploadUrl: string;
}

export interface ProposalFinalizeUploadResponse {
    id: string;
    status: string;
    message: string;
    statusUrl: string;
    checkUrl: string;
    uploadFinalized: boolean;
    judgementStatus: 'completed' | 'partial' | 'unavailable' | 'failed';
    autoPublishStatus: 'disabled' | 'skipped' | 'published';
    autoPublishBlockedReason: string | null;
}

export interface JudgementExecutionStatus {
    state: 'not_started' | 'completed' | 'unavailable' | 'failed';
    provider: string;
    attemptedAt: string | null;
    message: string | null;
}

export interface HowToProposeResponse {
    id: string;
    title: string;
    summary: string;
    description: string;
    conversationLanguage: string;
    metadataLanguageGuidance: string;
    requiredSteps: Array<{
        step: number;
        title: string;
        purpose: string;
        checks: string[];
    }>;
    escalationRule: string;
    normalizationRules: {
        entrypointFile: string;
        packageRoot: string;
        normalizeOnlyWhenNeeded: boolean;
        preserveUsefulSubfolders: boolean;
        transparentToSubmitter: boolean;
    };
    packageHandling: {
        principle: string;
        disallowedInstalledPaths: string[];
        allowedManifestFiles: string[];
        submitterResponsibility: string;
    };
    uploadLimits: {
        maxFiles: number;
        maxFileSizeBytes: number;
        disallowedPaths: string[];
        recommendations: string[];
    };
    uploadFinalization: {
        required: boolean;
        finalizeEndpoint: string;
        statusFollowUp: string;
    };
    uploadGuardrails: string[];
    apiNotes?: {
        signInRequiredForSubmitter?: boolean;
        publicOnly?: boolean;
        registryId?: string;
        registryName?: string;
        apiBaseUrl?: string;
        readAuthRequired?: boolean;
        proposalAuthRequired?: boolean;
        discoveryAuthRequired?: boolean;
        authorizationHeader?: string | null;
        authSetupFlow?: string;
        checkDuplicateNote?: string;
    };
}

export interface ProposalPublicStatus {
    id: string;
    skillId: string | null;
    title: string;
    status: string;
    createdAt: string;
    submittedBy: string;
    latestJudgementRisk: JudgementRecord['overallRisk'] | null;
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

export interface ProposalSummary {
    id: string;
    skillId: string | null;
    title: string;
    status: string;
    createdAt: string;
    submittedAt: string;
    rejectedAt: string | null;
    rejectedBy: string | null;
    latestJudgementRisk: JudgementRecord['overallRisk'] | null;
    latestJudgement: JudgementRecord | null;
    labels: string[];
    conversion?: {
        mode: 'create_skill' | 'create_version';
        targetSkillId: string;
        targetSkillTitle: string | null;
        targetSkillExists: boolean;
        currentLatestVersion: string | null;
        nextVersion: string;
        targetEntrypoint: string;
    };
}

export interface ProposalReview {
    latestJudgementRisk: JudgementRecord['overallRisk'] | null;
    labels: string[];
    latestJudgementId: string | null;
    latestJudgedAt: string | null;
}

export interface ProposalDetail {
    id: string;
    skillId: string | null;
    title: string;
    description: string;
    category: string;
    tags: string[];
    capabilities: string[];
    entrypoint: string | null;
    status: string;
    createdAt: string;
    submittedBy: string;
    files: Array<{
        id: string;
        path: string;
        mimeType: string;
        sizeBytes: number;
        sha256: string | null;
        extractable: boolean;
        judgement: JudgementExecutionStatus;
    }>;
    judgement: JudgementExecutionStatus;
    judgements: JudgementRecord[];
    rejectionReason: string | null;
    review: ProposalReview;
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
    conversion: {
        mode: 'create_skill' | 'create_version';
        targetSkillId: string;
        targetSkillTitle: string | null;
        targetSkillExists: boolean;
        currentLatestVersion: string | null;
        nextVersion: string;
        targetEntrypoint: string;
    };
    lifecycle: Array<{
        id: string;
        action: string;
        actor: string;
        at: string;
        fromStatus: string | null;
        toStatus: string | null;
        skillId: string | null;
        skillVersion: string | null;
        reason: string | null;
        comment: string | null;
    }>;
}

export interface ProposalUpdatePayload {
    title?: string;
    description?: string;
    category?: string;
    tags?: string[];
    capabilities?: string[];
    entrypoint?: string | null;
}

export interface DuplicateCheckResolutionOption {
    strategy: 'create_new_skill' | 'create_new_version' | 'request_admin_update';
    label: string;
    description: string;
    suggestedSkillId?: string;
    requiresAdminAction: boolean;
}

export interface DuplicateCheckResponse {
    submittedContentDigest: string | null;
    exactDuplicateProposalId: string | null;
    exactDuplicateSkillId: string | null;
    similarMatches: Array<{
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
        differences: Record<string, unknown>;
    }>;
    skillIdCollision: {
        exists: boolean;
        existingSkillId: string | null;
        note: string;
    };
    resolutionOptions: DuplicateCheckResolutionOption[];
    note: string;
}

export const proposalsApi = {
    howToPropose: () => apiClient.get<HowToProposeResponse>('/howToPropose'),
    status: (id: string, signal?: AbortSignal) => apiClient.get<ProposalPublicStatus>(`/proposals/${id}/status`, { signal }),
    notice: () => apiClient.get<{ hasNewProposals: boolean; totalPending: number }>('/proposals/notice'),
    checkDuplicate: (data: {
        skillId?: string;
        title: string;
        description: string;
        category: string;
        tags?: string[];
        capabilities?: string[];
        entrypoint?: string;
        files?: Array<{ path: string; sha256?: string | null }>;
    }) => apiClient.post<DuplicateCheckResponse>('/proposals/check-duplicate', data),
    submit: (data: {
        skillId?: string;
        title: string;
        description: string;
        category: string;
        tags?: string[];
        capabilities?: string[];
        entrypoint?: string;
    }) => apiClient.post<ProposalSubmissionResponse>('/proposals', data),
    attachFile: (id: string, file: File) => {
        const form = new FormData();
        form.append('file', file);
        return apiClient.post(`/proposals/${id}/files`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    finalizeUpload: (id: string) =>
        apiClient.post<ProposalFinalizeUploadResponse>(`/proposals/${id}/finalize-upload`, {}, {
            headers: { 'Content-Type': 'application/json' },
        }),
};
