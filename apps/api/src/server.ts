import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { loadConfig } from './infrastructure/config';
import { buildContainer } from './infrastructure/container';
import { SimpleAdminAuth } from './adapters/inbound/http/simple-admin-auth';
import { AgentApiAuth } from './adapters/inbound/http/agent-api-auth';
import { registerHealthRoutes } from './adapters/inbound/http/health.controller';
import { registerSkillReadRoutes } from './adapters/inbound/http/skill-read.controller';
import { registerAdminSkillRoutes } from './adapters/inbound/http/admin-skill.controller';
import { createProposalRateLimiter, registerProposalRoutes } from './adapters/inbound/http/proposal.controller';
import { registerJudgementRoutes } from './adapters/inbound/http/judgement.controller';
import { createAdminLoginRateLimiter, registerAdminAuthRoutes } from './adapters/inbound/http/admin-auth.controller';
import { registerAdminProposalRoutes } from './adapters/inbound/http/admin-proposal.controller';
import { registerApiErrorHandler } from './adapters/inbound/http/error-response';
import { registerAdminObservabilityRoutes } from './adapters/inbound/http/admin-observability.controller';
import { registerHttpObservability } from './adapters/inbound/http/http-observability';
import { OidcAdminAuth } from './adapters/inbound/http/oidc-admin-auth';
import { AdminOidcIdentityProvider } from './adapters/outbound/identity/admin-oidc.identity-provider';
import { AdminAuth } from './adapters/inbound/http/admin-auth';
import { AuthentikAccessTokenVerifier } from './adapters/outbound/identity/authentik-access-token.verifier';

async function start() {
  const config = loadConfig();
  const app = Fastify({
    logger: true,
    trustProxy: config.apiTrustedProxies.length > 0 ? config.apiTrustedProxies : false,
  });
  app.log.info({
    event: 'authentication_modes_configured',
    admin: config.adminAuthMode,
    discovery: config.discoveryAuthMode,
    publicRead: config.publicReadAuthMode,
    proposal: config.proposalAuthMode,
  }, 'Authentication modes configured');
  const container = await buildContainer(config, {
    recordPrincipalProjectionEvent: (event) => app.log.info(event, 'OIDC security event'),
  });
  const auth: AdminAuth = config.adminAuthMode === 'oidc'
    ? new OidcAdminAuth(config, container.adminSessions, container.principalRepository)
    : new SimpleAdminAuth(config);
  const adminOidcProvider = config.adminAuthMode === 'oidc'
    ? new AdminOidcIdentityProvider(config)
    : undefined;
  await adminOidcProvider?.initialize();
  const oidcAdminRoutes = adminOidcProvider
    ? {
      config,
      provider: adminOidcProvider,
      transactions: container.oidcLoginTransactions,
      principalProjection: container.principalProjection,
    }
    : undefined;
  const agentTokenVerifier = [
    config.discoveryAuthMode,
    config.publicReadAuthMode,
    config.proposalAuthMode,
  ].includes('oidc')
    ? new AuthentikAccessTokenVerifier(
      config,
      container.principalProjection,
      container.authorizationPolicy,
      undefined,
      undefined,
      (event) => {
        const log = event.outcome === 'failure' ? app.log.warn.bind(app.log) : app.log.info.bind(app.log);
        log(event, 'OIDC security event');
      }
    )
    : undefined;
  await agentTokenVerifier?.initialize();
  const agentAuth = new AgentApiAuth(config, agentTokenVerifier);
  const proposalRateLimiter = createProposalRateLimiter(config);
  const adminLoginRateLimiter = createAdminLoginRateLimiter(config);

  app.log.info(
    {
      provider: config.judgerProvider,
      model: config.judgerProvider === 'vercel-ai-sdk' ? config.vercelAiSdkModel : undefined,
      adapterPath: config.judgerAdapterPath,
    },
    'Judger provider configured'
  );

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.corsAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin not allowed'), false);
    },
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart);
  registerHttpObservability(app, container.observability);

  // Optional: support serving the API under /api when the frontend and backend share one host.
  const apiPrefix = process.env.API_PREFIX ?? '';
  if (apiPrefix) {
    await app.register(async (apiApp) => {
      registerHealthRoutes(apiApp);
      registerSkillReadRoutes(apiApp, container, agentAuth);
      registerProposalRoutes(apiApp, container, agentAuth, proposalRateLimiter);
      registerJudgementRoutes(apiApp, container, auth);
      registerAdminAuthRoutes(apiApp, auth, oidcAdminRoutes, adminLoginRateLimiter);
      registerAdminSkillRoutes(apiApp, container, auth);
      registerAdminProposalRoutes(apiApp, container, auth);
      registerAdminObservabilityRoutes(apiApp, container, auth);
    }, { prefix: apiPrefix });
  }

  // Always register at root as well for direct API access and backward compatibility.
  registerHealthRoutes(app);
  registerSkillReadRoutes(app, container, agentAuth);
  registerProposalRoutes(app, container, agentAuth, proposalRateLimiter);
  registerJudgementRoutes(app, container, auth);
  registerAdminAuthRoutes(app, auth, oidcAdminRoutes, adminLoginRateLimiter);
  registerAdminSkillRoutes(app, container, auth);
  registerAdminProposalRoutes(app, container, auth);
  registerAdminObservabilityRoutes(app, container, auth);
  registerApiErrorHandler(app);

  try {
    await app.listen({ port: config.apiPort, host: config.apiHost });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
