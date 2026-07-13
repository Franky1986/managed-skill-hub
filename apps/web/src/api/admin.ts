import { apiClient } from './client';
import { ArtifactProbeResponse, ExtractedSkillFileContent, SkillDetail, SkillFile } from './skills';
import { SkillSummary } from './skills';
import type { ProposalDetail, ProposalSummary, ProposalUpdatePayload } from './proposals';
export type { JudgementDimension, JudgementRecord } from './judgements';
import type { JudgementRecord } from './judgements';

export interface ObservabilityCounterRecord {
    name: string;
    area: string;
    method: string;
    route: string;
    statusClass: string;
    count: number;
    lastObservedAt: string;
}

export interface ObservabilityAreaSummary {
    area: string;
    totalRequests: number;
    errorRequests: number;
    avgDurationMs: number;
    p95DurationMs: number;
    maxDurationMs: number;
    lastObservedAt: string;
}

export interface ObservabilityTimelineBucket {
    bucketStart: string;
    bucketEnd: string;
    totalRequests: number;
    errorRequests: number;
}

export interface ObservabilityLatencyHistogramBucket {
    label: string;
    minDurationMs: number;
    maxDurationMs: number | null;
    count: number;
}

export interface ObservabilityHourlyRollup {
    bucketStart: string;
    bucketEnd: string;
    totalRequests: number;
    errorRequests: number;
    avgDurationMs: number;
    maxDurationMs: number;
}

export interface ObservabilityRequestRecord {
    traceId: string;
    method: string;
    route: string;
    url: string;
    statusCode: number;
    durationMs: number;
    area: string;
    timestamp: string;
    skillId?: string | null;
    proposalId?: string | null;
    fileId?: string | null;
    skillUuid?: string | null;
    versionUuid?: string | null;
    artifactId?: string | null;
}

export interface ObservabilitySnapshot {
    generatedAt: string;
    counters: ObservabilityCounterRecord[];
    areaSummaries: ObservabilityAreaSummary[];
    requestTimeline: ObservabilityTimelineBucket[];
    latencyHistogram: ObservabilityLatencyHistogramBucket[];
    hourlyRollups: ObservabilityHourlyRollup[];
    recentRequests: ObservabilityRequestRecord[];
    recentErrors: ObservabilityRequestRecord[];
}

export interface AdminSessionResponse {
    username: string;
    displayName: string | null;
    roles: AdminRole[];
    mode: AdminAuthMode;
    expiresAt: string;
}

export type AdminRole = 'submitter' | 'reader' | 'reviewer' | 'publisher' | 'admin';
export type AdminAuthMode = 'simple' | 'oidc';

export interface AdminAuthMethodsResponse {
    mode: AdminAuthMode;
    loginStartUrl: string | null;
}

export const adminApi = {
    getAuthMethods: () =>
        apiClient.get<AdminAuthMethodsResponse>('/admin/auth/methods'),
    getSession: () =>
        apiClient.get<AdminSessionResponse>("/admin/session"),
    login: (username: string, password: string) =>
        apiClient.post('/admin/login', { username, password }),
    logout: () => apiClient.post('/admin/logout', {}, { headers: { 'Content-Type': 'application/json' } }),
    listSkills: () => apiClient.get<{ items: SkillSummary[]; total: number }>('/admin/skills'),
    getSkill: (id: string) => apiClient.get<SkillDetail>(`/admin/skills/${id}`),
    listSkillFiles: (id: string, version?: string) =>
        apiClient.get<{ items: SkillFile[] }>(`/admin/skills/${id}/files`, { params: { version } }),
    getSkillFileContent: (id: string, fileId: string, version?: string) =>
        apiClient.get<string>(`/admin/skills/${id}/files/${encodeURIComponent(fileId)}`, {
            params: { version },
            responseType: 'text',
            transformResponse: [(value) => value],
        }),
    getSkillFileUrl: (id: string, fileId: string, version?: string) => {
        const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3040';
        const url = new URL(`/admin/skills/${id}/files/${encodeURIComponent(fileId)}`, base);
        if (version) {
            url.searchParams.set('version', version);
        }
        return url.toString();
    },
    getSkillExtractedContent: (id: string, fileId: string, version?: string) =>
        apiClient.get<ExtractedSkillFileContent>(`/admin/skills/${id}/files/${encodeURIComponent(fileId)}/extracted-content`, {
            params: { version },
        }),
    getSkillFileProbe: (id: string, fileId: string, version?: string) =>
        apiClient.get<ArtifactProbeResponse>(`/admin/skills/${id}/files/${encodeURIComponent(fileId)}/probe`, {
            params: { version },
        }),
    uploadSkillFile: (id: string, version: string, file: File, path?: string, role?: string) => {
        const form = new FormData();
        form.append('file', file);
        if (path) {
            form.append('path', path);
        }
        if (role) {
            form.append('role', role);
        }
        return apiClient.post<{ id: string; version: string }>(`/admin/skills/${id}/files`, form, {
            params: { version },
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    moveSkillFile: (id: string, version: string, fileId: string, path: string) =>
        apiClient.patch<{ id: string; version: string }>(`/admin/skills/${id}/files/${encodeURIComponent(fileId)}`, {
            path,
        }, {
            params: { version },
        }),
    deleteSkillFile: (id: string, version: string, fileId: string) =>
        apiClient.delete<{ id: string; version: string }>(`/admin/skills/${id}/files/${encodeURIComponent(fileId)}`, {
            params: { version },
        }),
    updateSkillFileContent: (id: string, version: string, fileId: string, content: string, mimeType?: string) =>
        apiClient.put<{ id: string; version: string }>(`/admin/skills/${id}/files/${encodeURIComponent(fileId)}/content`, {
            content,
            mimeType,
        }, {
            params: { version },
        }),
    createSkill: (data: {
        id: string;
        title: string;
        description: string;
        category: string;
        tags?: string[];
        capabilities?: string[];
        entrypoint: string;
    }) => apiClient.post('/admin/skills', data),
    updateSkill: (id: string, data: {
        title?: string;
        description?: string;
        category?: string;
        tags?: string[];
        capabilities?: string[];
    }) => apiClient.patch<{ id: string; version: string }>(`/admin/skills/${id}`, data),
    submitForReview: (id: string, version: string) =>
        apiClient.post(`/admin/skills/${id}/submit-review`, {}, { params: { version }, headers: { 'Content-Type': 'application/json' } }),
    approve: (id: string, version: string) =>
        apiClient.post(`/admin/skills/${id}/approve`, {}, { params: { version }, headers: { 'Content-Type': 'application/json' } }),
    publish: (id: string, version: string) =>
        apiClient.post(`/admin/skills/${id}/publish`, {}, { params: { version }, headers: { 'Content-Type': 'application/json' } }),
    rejectSkillVersion: (id: string, version: string, reason: string) =>
        apiClient.post(`/admin/skills/${id}/reject`, { reason }, { params: { version }, headers: { 'Content-Type': 'application/json' } }),
    deprecate: (id: string, version: string, reason?: string) =>
        apiClient.post(`/admin/skills/${id}/deprecate`, reason ? { reason } : {}, { params: { version }, headers: { 'Content-Type': 'application/json' } }),
    reextractSkillFile: (id: string, fileId: string, version?: string) =>
        apiClient.post<ExtractedSkillFileContent>(`/admin/skills/${id}/files/${encodeURIComponent(fileId)}/re-extract`, {}, {
            params: { version },
            headers: { 'Content-Type': 'application/json' },
        }),
    rejudgeSkillVersion: (id: string, version: string) =>
        apiClient.post<JudgementRecord>(`/admin/skills/${id}/versions/${encodeURIComponent(version)}/re-judge`, {}, {
            headers: { 'Content-Type': 'application/json' },
        }),
    reindexSearch: () =>
        apiClient.post<{ indexedVersions: number }>('/admin/search/reindex', {}, { headers: { 'Content-Type': 'application/json' } }),
    getObservabilityMetrics: () =>
        apiClient.get<ObservabilitySnapshot>('/admin/observability/metrics'),
    getObservabilityExportUrl: (format: 'json' | 'csv' = 'json') => {
        const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3040';
        const url = new URL('/admin/observability/metrics/export', base);
        url.searchParams.set('format', format);
        return url.toString();
    },
    listJudgements: (targetType: 'proposal' | 'skill' | 'file', targetId: string) =>
        apiClient.get<{ items: JudgementRecord[] }>(`/admin/judgements/${targetType}/${encodeURIComponent(targetId)}`),
    judgeProposal: (proposalId: string) =>
        apiClient.post<JudgementRecord>(`/admin/proposals/${proposalId}/judge`, {}, { headers: { 'Content-Type': 'application/json' } }),
    listProposals: (skillId?: string, status?: string) =>
        apiClient.get<{ items: ProposalSummary[]; total: number }>('/admin/proposals', { params: { skillId, status } }),
    getProposal: (proposalId: string) =>
        apiClient.get<ProposalDetail>(`/admin/proposals/${proposalId}`),
    updateProposal: (proposalId: string, data: ProposalUpdatePayload) =>
        apiClient.patch<ProposalDetail>(`/admin/proposals/${proposalId}`, data),
    getProposalFileContent: (proposalId: string, fileId: string) =>
        apiClient.get<string>(`/admin/proposals/${proposalId}/files/${encodeURIComponent(fileId)}`, {
            responseType: 'text',
            transformResponse: [(value) => value],
        }),
    getProposalExtractedContent: (proposalId: string, fileId: string) =>
        apiClient.get<ExtractedSkillFileContent>(`/admin/proposals/${proposalId}/files/${encodeURIComponent(fileId)}/extracted-content`),
    getProposalFileProbe: (proposalId: string, fileId: string) =>
        apiClient.get<ArtifactProbeResponse>(`/admin/proposals/${proposalId}/files/${encodeURIComponent(fileId)}/probe`),
    reextractProposalFile: (proposalId: string, fileId: string) =>
        apiClient.post<ExtractedSkillFileContent>(`/admin/proposals/${proposalId}/files/${encodeURIComponent(fileId)}/re-extract`, {}, { headers: { 'Content-Type': 'application/json' } }),
    getProposalFileUrl: (proposalId: string, fileId: string) => {
        const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3040';
        return new URL(`/admin/proposals/${proposalId}/files/${encodeURIComponent(fileId)}`, base).toString();
    },
    deleteProposal: (proposalId: string) =>
        apiClient.delete(`/admin/proposals/${proposalId}`),
    convertProposal: (proposalId: string, comment?: string) =>
        apiClient.post<SkillDetail>(`/admin/proposals/${proposalId}/convert`, { comment }),
    rejectProposal: (proposalId: string, reason?: string, comment?: string) =>
        apiClient.post(`/admin/proposals/${proposalId}/reject`, { reason, comment }),
};
