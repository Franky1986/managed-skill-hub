import { apiClient } from './client';

export type AgentSessionArea = 'discovery' | 'public-read' | 'proposal';

export interface AgentSessionCreateRequest {
    areas: AgentSessionArea[];
    discoveryToken?: string;
    readToken?: string;
    proposalToken?: string;
}

export interface AgentSessionCreateResponse {
    code: string;
    areas: AgentSessionArea[];
    expiresAt: string;
}

export interface AgentSession {
    id: string;
    code: string;
    areas: AgentSessionArea[];
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
    lastUsedAt: string | null;
    createdByIp: string | null;
    lastUsedIp: string | null;
    userAgent: string | null;
}

export interface AgentSessionListResponse {
    sessions: AgentSession[];
}

export interface AdminAgentAuthToken {
    area: AgentSessionArea;
    value: string;
}

export interface AdminAgentAuthConfigResponse {
    tokens: AdminAgentAuthToken[];
}

export interface DiscoveryAuthScheme {
    id: string;
    type: 'bearer' | 'oauth2' | 'agent-session';
    appliesTo: AgentSessionArea[];
    instructions?: string;
    url?: string;
}

export interface DiscoveryResponse {
    registryId: string;
    registryName: string;
    apiBaseUrl: string;
    readAuthRequired: boolean;
    proposalAuthRequired: boolean;
    discoveryAuthRequired: boolean;
    authSchemes: DiscoveryAuthScheme[];
    agentHttpGuidance: AgentHttpGuidance;
    proposalWorkflow: ProposalWorkflow;
}

export interface ProposalWorkflow {
    version: string;
    executionMode: 'sequential_state_machine';
    rules: string[];
    steps: Array<{
        id: string;
        method: 'GET' | 'POST' | 'LOCAL';
        path: string | null;
        success: string;
        next: string | null;
        recovery?: string;
    }>;
}

export interface AgentHttpGuidance {
    discoveryPurpose: string;
    toolSelection: string;
    retrievalSequence: string[];
    proposalExecution: string;
    responseHandling: {
        required: boolean;
        rules: string[];
        shellPattern: string;
        validationGate: string;
    };
    authenticationDiagnosis: string[];
    authorization: {
        discovery: AgentHttpAuthorizationGuidance;
        publicRead: AgentHttpAuthorizationGuidance;
        proposal: AgentHttpAuthorizationGuidance;
    };
    curlExamples: {
        discover: AgentHttpCurlExample;
        search: AgentHttpCurlExample;
        download: AgentHttpCurlExample;
    };
}

export interface AgentHttpAuthorizationGuidance {
    required: boolean;
    instructions: string;
}

export interface AgentHttpCurlExample {
    command: string;
    authArea: AgentSessionArea;
    authorizationRequired: boolean;
}

export const agentSessionsApi = {
    discover: () => apiClient.get<DiscoveryResponse>('/discover'),

    createSession: (request: AgentSessionCreateRequest) => {
        const headers: Record<string, string> = {};
        if (request.discoveryToken) {
            headers['X-Agent-Discovery-Token'] = request.discoveryToken;
        }
        if (request.readToken) {
            headers['X-Agent-Read-Token'] = request.readToken;
        }
        if (request.proposalToken) {
            headers['X-Agent-Proposal-Token'] = request.proposalToken;
        }
        return apiClient.post<AgentSessionCreateResponse>('/agent-sessions', { areas: request.areas }, { headers });
    },

    listSessions: (signal?: AbortSignal) =>
        apiClient.get<AgentSessionListResponse>('/admin/agent-sessions', { signal }),

    revokeSession: (sessionId: string) =>
        apiClient.delete(`/admin/agent-sessions/${encodeURIComponent(sessionId)}`),

    getAdminAgentAuthConfig: () =>
        apiClient.get<AdminAgentAuthConfigResponse>('/admin/agent-auth-config'),
};
