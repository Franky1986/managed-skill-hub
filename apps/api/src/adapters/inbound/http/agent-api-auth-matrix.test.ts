import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AgentApiAuth } from './agent-api-auth';
import { registerApiErrorHandler } from './error-response';
import { registerProposalRoutes } from './proposal.controller';
import { registerSkillReadRoutes } from './skill-read.controller';
import type { AppConfig } from '../../../infrastructure/config';
import type { Container } from '../../../infrastructure/container';

type Area = 'read' | 'proposal' | 'discovery';
type MatrixCase = Record<Area, boolean>;

const cases: MatrixCase[] = [
  { read: false, proposal: false, discovery: false },
  { read: true, proposal: false, discovery: false },
  { read: false, proposal: true, discovery: false },
  { read: false, proposal: false, discovery: true },
  { read: true, proposal: true, discovery: false },
  { read: true, proposal: false, discovery: true },
  { read: false, proposal: true, discovery: true },
  { read: true, proposal: true, discovery: true },
];

function label(testCase: MatrixCase): string {
  return [
    testCase.read ? 'read=bearer' : 'read=none',
    testCase.proposal ? 'proposal=bearer' : 'proposal=none',
    testCase.discovery ? 'discovery=bearer' : 'discovery=none',
  ].join(', ');
}

function config(testCase: MatrixCase): AppConfig {
  return {
    registryId: 'matrix-registry',
    registryName: 'Matrix Registry',
    publicApiBaseUrl: 'https://matrix.example.com/api',
    publicReadAuthMode: testCase.read ? 'bearer' : 'none',
    publicReadBearerToken: testCase.read ? 'read-token' : null,
    publicReadBearerActor: 'read-agent',
    proposalAuthMode: testCase.proposal ? 'bearer' : 'none',
    proposalBearerToken: testCase.proposal ? 'proposal-token' : null,
    proposalBearerActor: 'proposal-agent',
    discoveryAuthMode: testCase.discovery ? 'bearer' : 'none',
    discoveryBearerToken: testCase.discovery ? 'discovery-token' : null,
    discoveryBearerActor: 'discovery-agent',
    openapiYamlPath: '/nonexistent/openapi.yaml',
    proposalMaxFiles: 30,
    proposalMaxFileSizeBytes: 10 * 1024 * 1024,
    proposalDisallowedPaths: ['node_modules/'],
    autoPublishOnGreen: false,
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

async function buildApp(testCase: MatrixCase) {
  const app = Fastify({ logger: false });
  const c = container(testCase);
  const auth = new AgentApiAuth(c.config);
  registerSkillReadRoutes(app, c, auth);
  registerProposalRoutes(app, c, auth);
  registerApiErrorHandler(app);
  return app;
}

function authHeader(area: Area): Record<string, string> {
  return { authorization: 'Bearer ' + area + '-token' };
}

describe('agent API auth matrix', () => {
  for (const testCase of cases) {
    it(label(testCase), async () => {
      const app = await buildApp(testCase);
      const anyAuth = testCase.read || testCase.proposal || testCase.discovery;

      const discoverWithoutAuth = await app.inject({ method: 'GET', url: '/discover' });
      const discover = testCase.discovery
        ? await app.inject({ method: 'GET', url: '/discover', headers: authHeader('discovery') })
        : discoverWithoutAuth;

      if (testCase.discovery) {
        expect(discoverWithoutAuth.statusCode).toBe(401);
        expect(JSON.parse(discoverWithoutAuth.payload).details).toMatchObject({ authArea: 'discovery' });
      }

      expect(discover.statusCode).toBe(200);
      const discoveryPayload = JSON.parse(discover.payload);
      expect(discoveryPayload).toMatchObject({
        readAuthRequired: testCase.read,
        proposalAuthRequired: testCase.proposal,
        discoveryAuthRequired: testCase.discovery,
      });
      if (anyAuth) {
        expect(discoveryPayload.credentialSetupScriptUrl).toBe('https://matrix.example.com/api/agent-credentials/setup.sh');
      } else {
        expect(discoveryPayload).not.toHaveProperty('credentialSetupScriptUrl');
      }

      const howTo = await app.inject({
        method: 'GET',
        url: '/howToPropose',
        headers: testCase.discovery ? authHeader('discovery') : undefined,
      });
      expect(howTo.statusCode).toBe(200);
      const howToPayload = JSON.parse(howTo.payload);
      expect(howToPayload.requiredSteps[0].title).toBe(
        anyAuth ? 'Handle registry authentication outside chat' : 'Read this workflow first'
      );
      if (anyAuth) {
        expect(howToPayload.apiNotes.credentialSetupScriptUrl).toBe('https://matrix.example.com/api/agent-credentials/setup.sh');
      } else {
        expect(howToPayload.apiNotes.credentialSetupScriptUrl).toBeUndefined();
        expect(howToPayload.apiNotes.authSetupFlow).toBeUndefined();
      }

      const categoriesWithoutAuth = await app.inject({ method: 'GET', url: '/categories' });
      if (testCase.read) {
        expect(categoriesWithoutAuth.statusCode).toBe(401);
        expect(JSON.parse(categoriesWithoutAuth.payload).details).toMatchObject({ authArea: 'public-read' });
        const categoriesWithAuth = await app.inject({ method: 'GET', url: '/categories', headers: authHeader('read') });
        expect(categoriesWithAuth.statusCode).toBe(200);
      } else {
        expect(categoriesWithoutAuth.statusCode).toBe(200);
      }

      const proposalNoticeWithoutAuth = await app.inject({ method: 'GET', url: '/proposals/notice' });
      if (testCase.proposal) {
        expect(proposalNoticeWithoutAuth.statusCode).toBe(401);
        expect(JSON.parse(proposalNoticeWithoutAuth.payload).details).toMatchObject({ authArea: 'proposal' });
        const proposalNoticeWithAuth = await app.inject({ method: 'GET', url: '/proposals/notice', headers: authHeader('proposal') });
        expect(proposalNoticeWithAuth.statusCode).toBe(200);
      } else {
        expect(proposalNoticeWithoutAuth.statusCode).toBe(200);
      }

      const setupScript = await app.inject({ method: 'GET', url: '/agent-credentials/setup.sh' });
      expect(setupScript.statusCode).toBe(200);
      expect(setupScript.payload).toContain("MSH_REQUIRE_READ='" + String(testCase.read) + "'");
      expect(setupScript.payload).toContain("MSH_REQUIRE_PROPOSAL='" + String(testCase.proposal) + "'");
      expect(setupScript.payload.includes('Read bearer token')).toBe(testCase.read);
      expect(setupScript.payload.includes('Proposal bearer token')).toBe(testCase.proposal);
      expect(setupScript.payload.includes('entry.readToken')).toBe(testCase.read);
      expect(setupScript.payload.includes('entry.proposalToken')).toBe(testCase.proposal);
    });
  }
});
