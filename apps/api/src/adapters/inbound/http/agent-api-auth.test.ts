import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AgentApiAuth } from './agent-api-auth';
import { registerApiErrorHandler } from './error-response';
import type { AppConfig } from '../../../infrastructure/config';

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
});
