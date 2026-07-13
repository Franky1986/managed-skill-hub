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
  const auth = new AgentApiAuth(c.config, fakeOidcVerifier());
  registerSkillReadRoutes(app, c, auth);
  registerProposalRoutes(app, c, auth);
  registerApiErrorHandler(app);
  return app;
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
      expect(Boolean(discoveryPayload.credentialSetupScriptUrl)).toBe(anyBearer);
      const oidcScheme = discoveryPayload.authSchemes.find((scheme: { type: string }) => scheme.type === 'oauth2');
      expect(Boolean(oidcScheme)).toBe(anyOidc);
      if (oidcScheme) {
        expect(oidcScheme).toMatchObject({
          flow: 'device_code',
          deviceAuthorizationEndpoint: 'https://auth.example.test/application/o/device/',
          tokenEndpoint: 'https://auth.example.test/application/o/token/',
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
            ? 'Handle registry authentication outside chat'
            : 'Read this workflow first'
      );
      expect(Boolean(howToPayload.apiNotes.credentialSetupScriptUrl)).toBe(anyBearer);
      expect(Boolean(howToPayload.apiNotes.authSetupFlow)).toBe(anyAuth);
      if (anyOidc) {
        expect(howToPayload.apiNotes.authSetupFlow).toContain('Device Authorization');
        expect(howToPayload.apiNotes.authSetupFlow).not.toContain('credentials.json');
      }

      await assertArea(app, '/categories', 'read', testCase.read);
      await assertArea(app, '/proposals/notice', 'proposal', testCase.proposal);

      const setupScript = await app.inject({ method: 'GET', url: '/agent-credentials/setup.sh' });
      expect(setupScript.statusCode).toBe(200);
      expect(setupScript.payload).toContain(`MSH_REQUIRE_READ='${testCase.read === 'bearer'}'`);
      expect(setupScript.payload).toContain(`MSH_REQUIRE_PROPOSAL='${testCase.proposal === 'bearer'}'`);
      expect(setupScript.payload.includes('Read bearer token')).toBe(testCase.read === 'bearer');
      expect(setupScript.payload.includes('Proposal bearer token')).toBe(testCase.proposal === 'bearer');

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
