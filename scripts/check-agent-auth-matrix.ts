import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { AgentApiAuth } from '../apps/api/src/adapters/inbound/http/agent-api-auth';
import { registerApiErrorHandler } from '../apps/api/src/adapters/inbound/http/error-response';
import { registerProposalRoutes } from '../apps/api/src/adapters/inbound/http/proposal.controller';
import { registerSkillReadRoutes } from '../apps/api/src/adapters/inbound/http/skill-read.controller';
import type { AccessTokenVerifierPort, AgentTokenArea } from '../apps/api/src/application/ports/outbound/access-token-verifier.port';
import type { AuthenticatedPrincipal } from '../apps/api/src/application/security/authenticated-principal';
import type { AgentAuthMode, AppConfig } from '../apps/api/src/infrastructure/config';
import type { Container } from '../apps/api/src/infrastructure/container';
import { registerAgentSessionRoutes } from '../apps/api/src/adapters/inbound/http/agent-session.controller';
import { ValidateAgentSessionUseCase } from '../apps/api/src/application/usecases/agent-session/validate-agent-session.usecase';


const requireFromScript = createRequire(import.meta.url);
const Fastify = requireFromScript('fastify') as typeof import('fastify');

type MatrixArea = 'read' | 'proposal' | 'discovery';
type MatrixCase = Record<MatrixArea, AgentAuthMode>;

interface CaseResult {
  id: string;
  config: MatrixCase;
  discoveryStatus: { withoutCredential: number; withCredential: number };
  readStatus: { withoutCredential: number; withCredential: number | null };
  proposalStatus: { withoutCredential: number; withCredential: number | null };
  advertisedSchemes: string[];
  howToFirstStep: string;
  bearerSetup: { read: boolean; proposal: boolean };
  result: 'PASS';
}

const modes: AgentAuthMode[] = ['none', 'bearer', 'oidc'];
const cases: MatrixCase[] = modes.flatMap((read) =>
  modes.flatMap((proposal) => modes.map((discovery) => ({ read, proposal, discovery })))
);

function caseId(testCase: MatrixCase): string {
  return `read-${testCase.read}__proposal-${testCase.proposal}__discovery-${testCase.discovery}`;
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
  } as Container;
}

function verifier(): AccessTokenVerifierPort {
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
    verifyAccessToken: async (token, area) => {
      assert(token === `oidc-${area}`, `unexpected OIDC token for ${area}`);
      return oidcPrincipal(area);
    },
  };
}

function oidcPrincipal(area: AgentTokenArea): AuthenticatedPrincipal {
  return {
    principalId: 'matrix-principal',
    kind: 'human',
    externalSubject: 'matrix-user-uuid',
    issuer: 'https://auth.example.test/application/o/agent/',
    clientId: 'managedskillhub-agent-device',
    displayName: 'Matrix User',
    email: null,
    groups: [],
    roles: area === 'proposal' ? ['submitter'] : area === 'public-read' ? ['reader'] : [],
    scheme: 'oidc',
  };
}

class InMemoryAgentSessionRepository {
  private sessions: Array<{
    code: string;
    areas: string[];
    createdAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    lastUsedAt: Date | null;
    createdByIp: string | null;
    lastUsedIp: string | null;
    userAgent: string | null;
  }> = [];

  async create(session: { code: string; areas: string[]; createdAt: Date; expiresAt: Date; revokedAt: Date | null; lastUsedAt: Date | null; createdByIp: string | null; lastUsedIp: string | null; userAgent: string | null }): Promise<void> {
    this.sessions.push(session);
  }

  async findByCode(code: string) {
    return this.sessions.find((s) => s.code === code) ?? null;
  }

  async updateLastUsed(code: string, lastUsedAt: Date, lastUsedIp: string | null) {
    const session = this.sessions.find((s) => s.code === code);
    if (session) {
      session.lastUsedAt = lastUsedAt;
      session.lastUsedIp = lastUsedIp;
    }
  }

  async list() {
    return this.sessions;
  }

  async revoke(code: string, revokedAt: Date) {
    const session = this.sessions.find((s) => s.code === code);
    if (!session || session.revokedAt !== null) return false;
    session.revokedAt = revokedAt;
    return true;
  }

  async countActiveByIp() {
    return 0;
  }
}

async function buildApp(testCase: MatrixCase) {
  const app = Fastify({ logger: false });
  const c = container(testCase);
  c.agentSessionRepository = new InMemoryAgentSessionRepository() as unknown as Container['agentSessionRepository'];
  const validateUseCase = new ValidateAgentSessionUseCase(c.agentSessionRepository);
  const auth = new AgentApiAuth(c.config, verifier(), validateUseCase);
  registerSkillReadRoutes(app, c, auth);
  registerProposalRoutes(app, c, auth);
  registerAgentSessionRoutes(app, c, auth, {
    mode: 'simple',
    validate: async () => null,
    requireRole: async () => ({ principalId: 'admin', kind: 'human', externalSubject: null, issuer: null, clientId: null, displayName: 'Admin', email: null, groups: [], roles: ['admin'], scheme: 'session' }),
  } as unknown as import('../apps/api/src/adapters/inbound/http/admin-auth').AdminAuth);
  registerApiErrorHandler(app);
  return app;
}

function authHeader(area: MatrixArea, mode: AgentAuthMode): Record<string, string> | undefined {
  if (mode === 'none') return undefined;
  if (mode === 'bearer') return { authorization: `Bearer ${area}-token` };
  return { authorization: `Bearer oidc-${area === 'read' ? 'public-read' : area}` };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  assert(actual === expected, `${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function runArea(
  app: Awaited<ReturnType<typeof buildApp>>,
  testCase: MatrixCase,
  area: 'read' | 'proposal',
  url: string
): Promise<{ withoutCredential: number; withCredential: number | null }> {
  const mode = testCase[area];
  const withoutCredential = await app.inject({ method: 'GET', url });
  assertEqual(withoutCredential.statusCode, mode === 'none' ? 200 : 401, `${caseId(testCase)} ${area} unauthenticated`);
  if (mode === 'none') return { withoutCredential: 200, withCredential: null };
  const details = withoutCredential.json().details;
  assertEqual(details.authArea, area === 'read' ? 'public-read' : 'proposal', `${caseId(testCase)} ${area} auth area`);
  assertEqual(details.authScheme, mode, `${caseId(testCase)} ${area} auth scheme`);
  const withCredential = await app.inject({ method: 'GET', url, headers: authHeader(area, mode) });
  assertEqual(withCredential.statusCode, 200, `${caseId(testCase)} ${area} authenticated`);
  return { withoutCredential: 401, withCredential: 200 };
}

async function runCase(testCase: MatrixCase): Promise<CaseResult> {
  const app = await buildApp(testCase);
  const id = caseId(testCase);
  const anyBearer = Object.values(testCase).includes('bearer');
  const anyOidc = Object.values(testCase).includes('oidc');
  const anyAuth = anyBearer || anyOidc;

  const discoveryWithoutCredential = await app.inject({ method: 'GET', url: '/discover' });
  assertEqual(discoveryWithoutCredential.statusCode, testCase.discovery === 'none' ? 200 : 401, `${id} discovery unauthenticated`);
  const discoveryWithCredential = testCase.discovery === 'none'
    ? discoveryWithoutCredential
    : await app.inject({ method: 'GET', url: '/discover', headers: authHeader('discovery', testCase.discovery) });
  assertEqual(discoveryWithCredential.statusCode, 200, `${id} discovery authenticated`);
  const discovery = discoveryWithCredential.json();
  assertEqual(discovery.readAuthRequired, testCase.read !== 'none', `${id} readAuthRequired`);
  assertEqual(discovery.proposalAuthRequired, testCase.proposal !== 'none', `${id} proposalAuthRequired`);
  assertEqual(discovery.discoveryAuthRequired, testCase.discovery !== 'none', `${id} discoveryAuthRequired`);
  assertEqual(Boolean(discovery.credentialSetupScriptUrl), anyBearer, `${id} bearer setup URL`);
  const oidcScheme = discovery.authSchemes.find((scheme: { type: string }) => scheme.type === 'oauth2');
  assertEqual(Boolean(oidcScheme), anyOidc, `${id} OIDC scheme`);
  if (oidcScheme) {
    assertEqual(oidcScheme.metadata?.deviceAuthorizationEndpoint, 'https://auth.example.test/application/o/device/', `${id} device endpoint`);
    assertEqual(oidcScheme.metadata?.tokenEndpoint, 'https://auth.example.test/application/o/token/', `${id} token endpoint`);
  }

  const howTo = await app.inject({ method: 'GET', url: '/howToPropose', headers: authHeader('discovery', testCase.discovery) });
  assertEqual(howTo.statusCode, 200, `${id} how-to status`);
  const howToPayload = howTo.json();
  const expectedFirstStep = anyOidc
    ? 'Authorize the agent through the human login link'
    : anyBearer
      ? 'Handle registry authentication outside chat'
      : 'Read this workflow first';
  assertEqual(howToPayload.requiredSteps[0].title, expectedFirstStep, `${id} how-to first step`);
  assertEqual(Boolean(howToPayload.apiNotes.authSetupFlow), anyAuth, `${id} auth setup guidance`);

  const readStatus = await runArea(app, testCase, 'read', '/categories');
  const proposalStatus = await runArea(app, testCase, 'proposal', '/proposals/notice');

  // Agent session delegation assertions.
  const hasAgentSessionScheme = discovery.authSchemes.some(
    (scheme: { type: string }) => scheme.type === 'agent-session'
  );
  assertEqual(hasAgentSessionScheme, anyBearer, `${id} agent-session scheme advertised`);

  if (anyBearer) {
    const sessionCode = await createAgentSession(app, testCase);
    if (testCase.read === 'bearer') {
      const readWithSession = await app.inject({ method: 'GET', url: '/categories', headers: { authorization: `AgentSession ${sessionCode}` } });
      assertEqual(readWithSession.statusCode, 200, `${id} read with agent session`);
    }
    if (testCase.proposal === 'bearer') {
      const proposalWithSession = await app.inject({ method: 'GET', url: '/proposals/notice', headers: { authorization: `AgentSession ${sessionCode}` } });
      assertEqual(proposalWithSession.statusCode, 200, `${id} proposal with agent session`);
    }
    if (testCase.read === 'bearer' && testCase.proposal === 'bearer') {
      const readOnlyCode = await createAgentSessionForArea(app, 'public-read', testCase);
      const cross = await app.inject({ method: 'GET', url: '/proposals/notice', headers: { authorization: `AgentSession ${readOnlyCode}` } });
      assertEqual(cross.statusCode, 401, `${id} cross-area isolation read-only session on proposal`);
    }
  }
  const setup = await app.inject({ method: 'GET', url: '/agent-credentials/setup.sh' });
  assertEqual(setup.statusCode, 200, `${id} setup script status`);
  const setupRead = setup.payload.includes("MSH_REQUIRE_READ='true'");
  const setupProposal = setup.payload.includes("MSH_REQUIRE_PROPOSAL='true'");
  assertEqual(setupRead, testCase.read === 'bearer', `${id} setup read bearer`);
  assertEqual(setupProposal, testCase.proposal === 'bearer', `${id} setup proposal bearer`);

  await app.close();
  return {
    id,
    config: testCase,
    discoveryStatus: {
      withoutCredential: discoveryWithoutCredential.statusCode,
      withCredential: discoveryWithCredential.statusCode,
    },
    readStatus,
    proposalStatus,
    advertisedSchemes: discovery.authSchemes.map((scheme: { id: string }) => scheme.id),
    howToFirstStep: expectedFirstStep,
    bearerSetup: { read: setupRead, proposal: setupProposal },
    result: 'PASS',
  };
}



async function createAgentSession(app: Awaited<ReturnType<typeof buildApp>>, testCase: MatrixCase): Promise<string> {
  const headers: Record<string, string> = {};
  const areas: string[] = [];
  if (testCase.discovery === 'bearer') { headers['X-Agent-Discovery-Token'] = 'discovery-token'; areas.push('discovery'); }
  if (testCase.read === 'bearer') { headers['X-Agent-Read-Token'] = 'read-token'; areas.push('public-read'); }
  if (testCase.proposal === 'bearer') { headers['X-Agent-Proposal-Token'] = 'proposal-token'; areas.push('proposal'); }
  const response = await app.inject({ method: 'POST', url: '/agent-sessions', headers, payload: { areas } });
  assertEqual(response.statusCode, 201, 'create agent session');
  return response.json().code;
}

async function createAgentSessionForArea(app: Awaited<ReturnType<typeof buildApp>>, area: 'discovery' | 'public-read' | 'proposal', testCase: MatrixCase): Promise<string> {
  const headers: Record<string, string> = {};
  const tokenByArea: Record<'discovery' | 'public-read' | 'proposal', string | undefined> = {
    discovery: testCase.discovery === 'bearer' ? 'discovery-token' : undefined,
    'public-read': testCase.read === 'bearer' ? 'read-token' : undefined,
    proposal: testCase.proposal === 'bearer' ? 'proposal-token' : undefined,
  };
  const headerByArea: Record<'discovery' | 'public-read' | 'proposal', string> = {
    discovery: 'X-Agent-Discovery-Token',
    'public-read': 'X-Agent-Read-Token',
    proposal: 'X-Agent-Proposal-Token',
  };
  const token = tokenByArea[area];
  assert(token, `area ${area} not bearer-enabled`);
  headers[headerByArea[area]] = token;
  const response = await app.inject({ method: 'POST', url: '/agent-sessions', headers, payload: { areas: [area] } });
  assertEqual(response.statusCode, 201, 'create single-area agent session');
  return response.json().code;
}
async function main(): Promise<void> {
  assertEqual(cases.length, 27, 'matrix case count');
  const results: CaseResult[] = [];
  for (const testCase of cases) results.push(await runCase(testCase));
  const report = { name: 'agent-auth-matrix', total: results.length, passed: results.length, failed: 0, results };
  const lines = [
    'agent-auth-matrix',
    `total=${report.total}`,
    `passed=${report.passed}`,
    `failed=${report.failed}`,
    ...results.map((result) => `PASS ${result.id}`),
    'RESULT=PASS',
  ];
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/agent-auth-matrix.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/agent-auth-matrix.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
