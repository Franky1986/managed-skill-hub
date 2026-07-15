import { apiClient, buildApiUrl } from './client';
import type { JudgementRecord } from './judgements';

function buildDiscoveryParams(category?: string, tags: string[] = [], limit = 50, offset = 0): URLSearchParams {
    const params = new URLSearchParams();
    if (category) {
        params.set('category', category);
    }
    for (const tag of tags) {
        params.append('tag', tag);
    }
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return params;
}

export interface SkillSummary {
    id: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    skillUuid: string;
    versionUuid: string;
    contentDigest: string;
    version: string;
    publishedAt: string | null;
    status: string;
}

export interface SkillDetail {
    id: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    capabilities: string[];
    useWhen: string[];
    doNotUseWhen: string[];
    entrypoint: string;
    skillUuid: string;
    latestPublishedVersion: string | null;
    versions: Array<{
        version: string;
        versionUuid: string;
        contentDigest: string;
        status: string;
        createdAt: string;
        approvedBy: string | null;
        approvedAt: string | null;
        publishedBy: string | null;
        publishedAt: string | null;
        rejectedBy: string | null;
        rejectedAt: string | null;
        rejectionReason: string | null;
        deprecatedBy: string | null;
        deprecatedAt: string | null;
        deprecationReason: string | null;
    }>;
}

export type SkillVersionSummary = SkillDetail['versions'][number];

export interface SkillHistoryEntry {
    id: string;
    skillId: string | null;
    skillVersion: string | null;
    proposalId: string | null;
    action: string;
    actor: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    createdAt: string;
}

export interface SearchResult extends SkillSummary {
    score: number | null;
}

export interface SkillFile {
    id: string;
    artifactId: string;
    path: string;
    role: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string | null;
    updatedAt: string | null;
    extractable: boolean;
}

export interface ExtractedSkillFileContent {
    text: string;
    extractedBy: string;
    metadata: Record<string, unknown>;
}

export interface ArtifactProbeResponse {
    probedBy: string;
    tool: string;
    filePath: string;
    mimeType: string;
    summary: Record<string, unknown>;
    parsed: Record<string, unknown>;
    format: Record<string, unknown>;
    streams: Array<Record<string, unknown>>;
    rawOutput: string;
}

export const skillsApi = {
    discover: () => apiClient.get('/discover'),
    list: (category?: string, tags: string[] = [], limit = 50, offset = 0) =>
        apiClient.get('/skills', { params: buildDiscoveryParams(category, tags, limit, offset) }),
    search: (q: string, category?: string, tags: string[] = [], limit = 50, offset = 0) => {
        const params = buildDiscoveryParams(category, tags, limit, offset);
        params.set('q', q);
        return apiClient.get('/skills/search', { params });
    },
    listCategories: () => apiClient.get<{ items: string[] }>('/categories'),
    listTags: () => apiClient.get<{ items: string[] }>('/tags'),
    get: (id: string) => apiClient.get<SkillDetail>(`/skills/${id}`),
    listVersions: (id: string) => apiClient.get<{ items: SkillVersionSummary[] }>(`/skills/${id}/versions`),
    getHistory: (id: string) => apiClient.get<{ items: SkillHistoryEntry[] }>(`/skills/${id}/history`),
    getManifest: (id: string, version?: string) =>
        apiClient.get(`/skills/${id}/manifest`, { params: { version } }),
    listFiles: (id: string, version?: string) =>
        apiClient.get<{ items: SkillFile[] }>(`/skills/${id}/files`, { params: { version } }),
    getFileContent: (id: string, fileId: string, version?: string) =>
        apiClient.get<string>(`/skills/${id}/files/${encodeURIComponent(fileId)}`, {
            params: { version },
            responseType: 'text',
            transformResponse: [(value) => value],
        }),
    getDeprecationInfo: (id: string, version?: string) =>
        apiClient.get<{ skillId: string; version: string; status: string; deprecatedBy: string | null; deprecatedAt: string | null; reason: string | null }>(`/skills/${id}/deprecation`, { params: { version } }),
    listJudgements: (id: string, version?: string) =>
        apiClient.get<{ items: JudgementRecord[] }>(`/skills/${id}/judgements`, { params: { version } }),
    listFileJudgements: (id: string, fileId: string, version?: string) =>
        apiClient.get<{ items: JudgementRecord[] }>(`/skills/${id}/files/${encodeURIComponent(fileId)}/judgements`, {
            params: { version },
        }),
    getExtractedContent: (id: string, fileId: string, version?: string) =>
        apiClient.get<ExtractedSkillFileContent>(`/skills/${id}/files/${encodeURIComponent(fileId)}/extracted-content`, {
            params: { version },
        }),
    getFileProbe: (id: string, fileId: string, version?: string) =>
        apiClient.get<ArtifactProbeResponse>(`/skills/${id}/files/${encodeURIComponent(fileId)}/probe`, {
            params: { version },
        }),
    getFileUrl: (id: string, fileId: string, version?: string) => {
        const url = new URL(buildApiUrl(`/skills/${id}/files/${encodeURIComponent(fileId)}`));
        if (version) {
            url.searchParams.set('version', version);
        }
        return url.toString();
    },
    suggestName: (title: string, description?: string) =>
        apiClient.get('/skills/suggest-name', { params: { title, description } }),
};
