import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AccessTokenVerifierPort, AgentTokenArea } from '../../../application/ports/outbound/access-token-verifier.port';
import { AuthenticatedPrincipal } from '../../../application/security/authenticated-principal';
import type { AppConfig, AgentAuthMode } from '../../../infrastructure/config';
import type { Container } from '../../../infrastructure/container';
import { AgentApiAuth } from './agent-api-auth';
import { registerApiErrorHandler } from './error-response';
import { registerProposalRoutes } from './proposal.controller';
import { registerSkillReadRoutes } from './skill-read.controller';
import { registerAgentSessionRoutes } from './agent-session.controller';
import { AdminAuth } from './admin-auth';
import { ValidateAgentSessionUseCase } from '../../../application/usecases/agent-session/validate-agent-session.usecase';
import {
  AgentSession,
  AgentSessionArea,
  AgentSessionRepositoryPort,
} from '../../../application/ports/outbound/agent-session.port';

type MatrixArea = 'read' | 'proposal' | 'discovery';
type MatrixCase = Record<MatrixArea, AgentAuthMode>;

const modes: AgentAuthMode[] = ['none', 'bearer', 'oidc'];
const cases: MatrixCase[] = modes.flatMap((read) =>
  modes.flatMap((proposal) => modes.map((discovery) => ({ read, proposal, discovery })))
);

function label(testCase: MatrixCase): string {
  return `read=${testCase.read}, proposal=${testCase.proposal}, discovery=${testCase.discovery}`;
}

function config(testCase: MatrixCase): AppConfig {
  return {
    registryId: 'matrix-registry',
    registryName: 'Matrix Registry',
    publicApiBaseUrl: 'https://matrix.example.com/api',
    publicReadAuthMode: testCase.read,
    publicReadBearerToken: testCase.read === 'bearer' ? 'read-token' : null,
    publicReadBearerActor: 'read-agent',
    proposalAuthMode: testCase.proposal,
    proposalBearerToken: testCase.proposal === 'bearer' ? 'proposal-token' : null,
    proposalBearerActor: 'proposal-agent',
    discoveryAuthMode: testCase.discovery,
    discoveryBearerToken: testCase.discovery === 'bearer' ? 'discovery-token' : null,
    discoveryBearerActor: 'discovery-agent',
    oidcAgentIssuer: 'https://auth.example.test/application/o/agent/',
    oidcAgentClientId: 'managedskillhub-agent-device',
    oidcAgentBaseScopes: ['openid', 'profile', 'email'],
    oidcDiscoveryScope: 'managedskillhub:discovery',
    oidcPublicReadScope: 'managedskillhub:skills:read',
    oidcProposalScope: 'managedskillhub:proposals',
    openapiYamlPath: '/nonexistent/openapi.yaml',
    proposalMaxFiles: 30,
    proposalMaxFileSizeBytes: 10 * 1024 * 1024,
    proposalDisallowedPaths: ['node_modules/'],
    autoPublishOnGreen: false,
    agentSessionEnabled: true,
    agentSessionTtlSeconds: 10800,
    agentSessionCodeLength: 8,
    agentSessionCodeCharset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    agentSessionMaxActive: null,
  } as AppConfig;
}

function container(testCase: MatrixCase): Container {
  return {
    config: config(testCase),
    nameSuggestion: {
      suggestSkillId: async () => ({ suggestion: 'skill', alternatives: [], isAvailable: true }),
    } as unknown as Container['nameSuggestion'],
    skillQuery: {
      listCategories: async () => ['automation'],
      listTags: async () => ['agent'],
    } as unknown as Container['skillQuery'],
    proposalRead: {
      getNotice: async () => ({ hasNewProposals: false, totalPending: 0 }),
    } as unknown as Container['proposalRead'],
    agentSessionRepository: new InMemoryAgentSessionRepository(),
  } as Container;
}

async function buildApp(testCase: MatrixCase) {
  const app = Fastify({ logger: false });
  const c = container(testCase);
  const validateUseCase = new ValidateAgentSessionUseCase(c.agentSessionRepository);
  const auth = new AgentApiAuth(c.config, fakeOidcVerifier(), validateUseCase);
  registerSkillReadRoutes(app, c, auth);
  registerProposalRoutes(app, c, auth);
  registerAgentSessionRoutes(app, c, auth, fakeAdminAuth());
  registerApiErrorHandler(app);
  return app;
}


class InMemoryAgentSessionRepository implements AgentSessionRepositoryPort {
  private sessions: AgentSession[] = [];

  async create(session: AgentSession): Promise<void> {
    this.sessions.push(session);
  }

  async findByCode(code: string): Promise<AgentSession | null> {
    return this.sessions.find((s) => s.code === code) ?? null;
  }

  async updateLastUsed(code: string, lastUsedAt: Date, lastUsedIp: string | null): Promise<void> {
    const session = this.sessions.find((s) => s.code === code);
    if (session) {
      session.lastUsedAt = lastUsedAt;
      session.lastUsedIp = lastUsedIp;
    }
  }

  async list(): Promise<AgentSession[]> {
    return this.sessions;
  }

  async revoke(code: string, revokedAt: Date): Promise<boolean> {
    const session = this.sessions.find((s) => s.code === code);
    if (!session || session.revokedAt !== null) return false;
    session.revokedAt = revokedAt;
    return true;
  }

  async countActiveByIp(): Promise<number> {
    return 0;
  }
}

function fakeAdminAuth(): AdminAuth {
  return {
    mode: 'simple',
    validate: async () => null,
    requireRole: async () => ({ principalId: 'admin', kind: 'human', externalSubject: null, issuer: null, clientId: null, displayName: 'Admin', email: null, groups: [], roles: ['admin'], scheme: 'session' }),
  } as unknown as AdminAuth;
}

function fakeOidcVerifier(): AccessTokenVerifierPort {
  return {
    initialize: async () => undefined,
    metadata: () => ({
      issuer: 'https://auth.example.test/application/o/agent/',
      openIdConfigurationUrl: 'https://auth.example.test/application/o/agent/.well-known/openid-configuration',
      authorizationEndpoint: 'https://auth.example.test/application/o/authorize/',
      deviceAuthorizationEndpoint: 'https://auth.example.test/application/o/device/',
      tokenEndpoint: 'https://auth.example.test/application/o/token/',
      jwksUri: 'https://auth.example.test/application/o/agent/jwks/',
      clientId: 'managedskillhub-agent-device',
    }),
    verifyAccessToken: async (token: string, area: AgentTokenArea) => {
      if (token !== `oidc-${area}`) throw new Error('invalid test token');
      return oidcPrincipal(area);
    },
  };
}

function oidcPrincipal(area: AgentTokenArea): AuthenticatedPrincipal {
  return {
    principalId: 'principal-1',
    kind: 'human',
    externalSubject: 'user-uuid-1',
    issuer: 'https://auth.example.test/application/o/agent/',
    clientId: 'managedskillhub-agent-device',
    displayName: 'Matrix User',
    email: null,
    groups: [],
    roles: area === 'proposal' ? ['submitter'] : area === 'public-read' ? ['reader'] : [],
    scheme: 'oidc',
  };
}

function authHeader(area: MatrixArea, mode: AgentAuthMode): Record<string, string> | undefined {
  if (mode === 'none') return undefined;
  if (mode === 'bearer') return { authorization: `Bearer ${area}-token` };
  const tokenArea = area === 'read' ? 'public-read' : area;
  return { authorization: `Bearer oidc-${tokenArea}` };
}

describe('agent API auth matrix', () => {
  expect(cases).toHaveLength(27);

  for (const testCase of cases) {
    it(label(testCase), async () => {
      const app = await buildApp(testCase);
      const anyBearer = Object.values(testCase).includes('bearer');
      const anyOidc = Object.values(testCase).includes('oidc');
      const anyAuth = anyBearer || anyOidc;

      const discoverWithoutAuth = await app.inject({ method: 'GET', url: '/discover' });
      const discover = testCase.discovery === 'none'
        ? discoverWithoutAuth
        : await app.inject({
          method: 'GET',
          url: '/discover',
          headers: authHeader('discovery', testCase.discovery),
        });

      expect(discoverWithoutAuth.statusCode).toBe(testCase.discovery === 'none' ? 200 : 401);
      expect(discover.statusCode).toBe(200);
      const discoveryPayload = discover.json();
      expect(discoveryPayload).toMatchObject({
        readAuthRequired: testCase.read !== 'none',
        proposalAuthRequired: testCase.proposal !== 'none',
        discoveryAuthRequired: testCase.discovery !== 'none',
      });
      const oidcScheme = discoveryPayload.authSchemes.find((scheme: { type: string }) => scheme.type === 'oauth2');
      expect(Boolean(oidcScheme)).toBe(anyOidc);
      if (oidcScheme) {
        expect(oidcScheme).toMatchObject({
          flow: 'device_code',
          metadata: {
            deviceAuthorizationEndpoint: 'https://auth.example.test/application/o/device/',
            tokenEndpoint: 'https://auth.example.test/application/o/token/',
          },
        });
      }

      const howTo = await app.inject({
        method: 'GET',
        url: '/howToPropose',
        headers: authHeader('discovery', testCase.discovery),
      });
      expect(howTo.statusCode).toBe(200);
      const howToPayload = howTo.json();
      expect(howToPayload.requiredSteps[0].title).toBe(
        anyOidc
          ? 'Authorize the agent through the human login link'
          : anyBearer
            ? 'Delegate access through the agent-auth page'
            : 'Read this workflow first'
      );
      expect(Boolean(howToPayload.apiNotes.authSetupFlow)).toBe(anyAuth);
      if (anyOidc) {
        expect(howToPayload.apiNotes.authSetupFlow).toContain('Device Authorization');
      }

      await assertArea(app, '/categories', 'read', testCase.read);
      await assertArea(app, '/proposals/notice', 'proposal', testCase.proposal);

      // Agent session delegation: when bearer is enabled for an area, /discover advertises agent-session.
      const hasAgentSessionScheme = discoveryPayload.authSchemes.some(
        (scheme: { type: string; appliesTo?: string[] }) => scheme.type === 'agent-session'
      );
      expect(hasAgentSessionScheme).toBe(anyBearer);

      if (anyBearer) {
        const code = await createAgentSession(app, testCase);
        if (testCase.read === 'bearer') {
          const withSession = await app.inject({ method: 'GET', url: '/categories', headers: { authorization: `AgentSession ${code}` } });
          expect(withSession.statusCode).toBe(200);
        }
        if (testCase.proposal === 'bearer') {
          const withSession = await app.inject({ method: 'GET', url: '/proposals/notice', headers: { authorization: `AgentSession ${code}` } });
          expect(withSession.statusCode).toBe(200);
        }
        // Cross-area isolation: a session for read must not access a protected proposal area.
        if (testCase.read === 'bearer' && testCase.proposal === 'bearer') {
          const readOnlyCode = await createAgentSessionForArea(app, 'public-read', testCase);
          const cross = await app.inject({ method: 'GET', url: '/proposals/notice', headers: { authorization: `AgentSession ${readOnlyCode}` } });
          expect(cross.statusCode).toBe(401);
        }
      }


      await app.close();
    });
  }
});

async function assertArea(
  app: Awaited<ReturnType<typeof buildApp>>,
  url: string,
  area: 'read' | 'proposal',
  mode: AgentAuthMode
): Promise<void> {
  const unauthenticated = await app.inject({ method: 'GET', url });
  expect(unauthenticated.statusCode).toBe(mode === 'none' ? 200 : 401);
  if (mode !== 'none') {
    expect(unauthenticated.json().details).toMatchObject({
      authArea: area === 'read' ? 'public-read' : 'proposal',
      authScheme: mode,
    });
    const authenticated = await app.inject({ method: 'GET', url, headers: authHeader(area, mode) });
    expect(authenticated.statusCode).toBe(200);
  }
}

async function createAgentSession(app: Awaited<ReturnType<typeof buildApp>>, testCase: MatrixCase): Promise<string> {
  const headers: Record<string, string> = {};
  const areas: AgentSessionArea[] = [];
  if (testCase.discovery === 'bearer') {
    headers['X-Agent-Discovery-Token'] = 'discovery-token';
    areas.push('discovery');
  }
  if (testCase.read === 'bearer') {
    headers['X-Agent-Read-Token'] = 'read-token';
    areas.push('public-read');
  }
  if (testCase.proposal === 'bearer') {
    headers['X-Agent-Proposal-Token'] = 'proposal-token';
    areas.push('proposal');
  }
  const response = await app.inject({
    method: 'POST',
    url: '/agent-sessions',
    headers,
    payload: { areas },
  });
  expect(response.statusCode).toBe(201);
  return response.json().code;
}

async function createAgentSessionForArea(app: Awaited<ReturnType<typeof buildApp>>, area: AgentSessionArea, testCase: MatrixCase): Promise<string> {
  const headers: Record<string, string> = {};
  const tokenByArea: Record<AgentSessionArea, string | undefined> = {
    discovery: testCase.discovery === 'bearer' ? 'discovery-token' : undefined,
    'public-read': testCase.read === 'bearer' ? 'read-token' : undefined,
    proposal: testCase.proposal === 'bearer' ? 'proposal-token' : undefined,
  };
  const headerByArea: Record<AgentSessionArea, string> = {
    discovery: 'X-Agent-Discovery-Token',
    'public-read': 'X-Agent-Read-Token',
    proposal: 'X-Agent-Proposal-Token',
  };
  const token = tokenByArea[area];
  if (!token) throw new Error(`Area ${area} is not bearer-enabled in this test case`);
  headers[headerByArea[area]] = token;
  const response = await app.inject({
    method: 'POST',
    url: '/agent-sessions',
    headers,
    payload: { areas: [area] },
  });
  expect(response.statusCode).toBe(201);
  return response.json().code;
}

