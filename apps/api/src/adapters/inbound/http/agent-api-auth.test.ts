import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AgentApiAuth } from './agent-api-auth';
import { registerApiErrorHandler } from './error-response';
import type { AppConfig } from '../../../infrastructure/config';
import { AccessTokenVerifierPort } from '../../../application/ports/outbound/access-token-verifier.port';

function config(overrides: Partial<AppConfig>): AppConfig {
  return {
    registryId: 'company-prod',
    registryName: 'Company Production Skill Registry',
    publicApiBaseUrl: 'https://skills.example.com/api',
    publicReadAuthMode: 'none',
    publicReadBearerToken: null,
    publicReadBearerActor: 'read-agent',
    proposalAuthMode: 'none',
    proposalBearerToken: null,
    proposalBearerActor: 'proposal-agent',
    discoveryAuthMode: 'none',
    discoveryBearerToken: null,
    discoveryBearerActor: 'discovery-agent',
    ...overrides,
  } as AppConfig;
}

describe('AgentApiAuth', () => {
  it('does not block when an area is configured with none mode', async () => {
    const auth = new AgentApiAuth(config({}));
    const app = Fastify({ logger: false });
    app.get('/skills', { preHandler: auth.guard('public-read') }, async () => ({ ok: true }));
    registerApiErrorHandler(app);

    const response = await app.inject({ method: 'GET', url: '/skills' });

    expect(response.statusCode).toBe(200);
  });

  it('creates provider-neutral principals for compatible none and bearer modes', async () => {
    const openAuth = new AgentApiAuth(config({}));
    const bearerAuth = new AgentApiAuth(config({
      proposalAuthMode: 'bearer',
      proposalBearerToken: 'proposal-secret',
    }));
    const openApp = Fastify({ logger: false });
    const bearerApp = Fastify({ logger: false });
    openApp.get('/context', { preHandler: openAuth.guard('proposal') }, async (request) => (
      (request as typeof request & { agentAuth: unknown }).agentAuth
    ));
    bearerApp.get('/context', { preHandler: bearerAuth.guard('proposal') }, async (request) => (
      (request as typeof request & { agentAuth: unknown }).agentAuth
    ));

    const openResponse = await openApp.inject({ method: 'GET', url: '/context' });
    const bearerResponse = await bearerApp.inject({
      method: 'GET',
      url: '/context',
      headers: { authorization: 'Bearer proposal-secret' },
    });

    expect(openResponse.json().principal).toMatchObject({ kind: 'anonymous', scheme: 'none' });
    expect(bearerResponse.json().principal).toMatchObject({
      principalId: 'legacy-bearer:proposal-agent',
      kind: 'technical',
      scheme: 'bearer',
      roles: [],
    });
  });

  it('rejects missing and invalid bearer tokens', async () => {
    const auth = new AgentApiAuth(config({ publicReadAuthMode: 'bearer', publicReadBearerToken: 'read-secret' }));
    const app = Fastify({ logger: false });
    app.get('/skills', { preHandler: auth.guard('public-read') }, async () => ({ ok: true }));
    registerApiErrorHandler(app);

    const missing = await app.inject({ method: 'GET', url: '/skills' });
    const invalid = await app.inject({ method: 'GET', url: '/skills', headers: { authorization: 'Bearer wrong' } });

    expect(missing.statusCode).toBe(401);
    const missingPayload = JSON.parse(missing.payload);
    expect(missingPayload.code).toBe('UNAUTHORIZED');
    expect(missingPayload.details).toMatchObject({
      authRequired: true,
      authArea: 'public-read',
      authScheme: 'bearer',
      discoverUrl: 'https://skills.example.com/api/discover',
      credentialSetupScriptUrl: 'https://skills.example.com/api/agent-credentials/setup.sh',
    });
    expect(missingPayload.details.recommendation).toContain('Do not paste bearer tokens');
    expect(invalid.statusCode).toBe(401);
  });

  it('accepts valid bearer tokens and exposes auth metadata', async () => {
    const auth = new AgentApiAuth(config({
      publicReadAuthMode: 'bearer',
      publicReadBearerToken: 'read-secret',
      proposalAuthMode: 'bearer',
      proposalBearerToken: 'proposal-secret',
    }));
    const app = Fastify({ logger: false });
    app.get('/skills', { preHandler: auth.guard('public-read') }, async () => ({ ok: true }));
    registerApiErrorHandler(app);

    const response = await app.inject({ method: 'GET', url: '/skills', headers: { authorization: 'Bearer read-secret' } });

    expect(response.statusCode).toBe(200);
    expect(auth.metadata()).toMatchObject({
      registryId: 'company-prod',
      apiBaseUrl: 'https://skills.example.com/api',
      readAuthRequired: true,
      proposalAuthRequired: true,
      credentialSetupScriptUrl: 'https://skills.example.com/api/agent-credentials/setup.sh',
    });
    expect(auth.metadata().authSchemes.map((scheme) => scheme.id)).toEqual(['public-read-bearer', 'proposal-bearer']);
  });

  it('fails closed when OIDC is selected but no verifier has authenticated the request', async () => {
    const auth = new AgentApiAuth(config({ proposalAuthMode: 'oidc' }));
    const app = Fastify({ logger: false });
    app.get('/proposals', { preHandler: auth.guard('proposal') }, async () => ({ ok: true }));
    registerApiErrorHandler(app);

    const response = await app.inject({
      method: 'GET',
      url: '/proposals',
      headers: { authorization: 'Bearer unverified-jwt' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().details).toMatchObject({
      authArea: 'proposal',
      authScheme: 'oidc',
    });
  });

  it('accepts a verifier-produced OIDC principal and exposes Device Flow metadata', async () => {
    const verifier = {
      initialize: async () => undefined,
      verifyAccessToken: async () => ({
        principalId: 'principal-1',
        kind: 'human' as const,
        externalSubject: 'user-uuid-1',
        issuer: 'https://auth.example/application/o/agent/',
        clientId: 'managedskillhub-agent-device',
        displayName: 'User',
        email: null,
        groups: [],
        roles: ['submitter' as const],
        scheme: 'oidc' as const,
      }),
      metadata: () => ({
        issuer: 'https://auth.example/application/o/agent/',
        openIdConfigurationUrl: 'https://auth.example/application/o/agent/.well-known/openid-configuration',
        authorizationEndpoint: 'https://auth.example/application/o/authorize/',
        deviceAuthorizationEndpoint: 'https://auth.example/application/o/device/',
        tokenEndpoint: 'https://auth.example/application/o/token/',
        jwksUri: 'https://auth.example/application/o/agent/jwks/',
        clientId: 'managedskillhub-agent-device',
      }),
    } satisfies AccessTokenVerifierPort;
    const auth = new AgentApiAuth(config({
      proposalAuthMode: 'oidc',
      oidcAgentIssuer: 'https://auth.example/application/o/agent/',
      oidcAgentClientId: 'managedskillhub-agent-device',
      oidcAgentBaseScopes: ['openid', 'profile'],
      oidcProposalScope: 'managedskillhub:proposals',
    }), verifier);
    const app = Fastify({ logger: false });
    app.get('/context', { preHandler: auth.guard('proposal') }, async (request) => (
      (request as typeof request & { agentAuth: unknown }).agentAuth
    ));

    const response = await app.inject({
      method: 'GET',
      url: '/context',
      headers: { authorization: 'Bearer verified-jwt' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      actor: 'principal-1',
      scheme: 'oidc',
      principal: { principalId: 'principal-1', kind: 'human' },
    });
    expect(auth.metadata().credentialSetupScriptUrl).toBeUndefined();
    expect(auth.metadata().authSchemes).toContainEqual(expect.objectContaining({
      id: 'agent-oidc-device',
      type: 'oauth2',
      flow: 'device_code',
      deviceAuthorizationEndpoint: 'https://auth.example/application/o/device/',
      scopes: ['openid', 'profile', 'managedskillhub:proposals'],
      appliesTo: ['proposal'],
    }));
  });
});
