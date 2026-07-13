import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AdminAuth, isOidcModeAdminAuth, isSimpleModeAdminAuth, OidcModeAdminAuth } from './admin-auth';
import { sendApiError } from './error-response';
import { IdentityProviderPort } from '../../../application/ports/outbound/identity-provider.port';
import { OidcLoginTransactionPort } from '../../../application/ports/outbound/oidc-login-transaction.port';
import { PrincipalProjectionService } from '../../../application/security/principal-projection.service';
import { AppConfig } from '../../../infrastructure/config';
import { UnauthorizedError } from '../../../domain/errors';

export interface OidcAdminRouteDependencies {
  config: AppConfig;
  provider: IdentityProviderPort;
  transactions: OidcLoginTransactionPort;
  principalProjection: PrincipalProjectionService;
}

export type AdminLoginRateLimiter = ReturnType<typeof createAdminLoginRateLimiter>;

export function registerAdminAuthRoutes(
  app: FastifyInstance,
  auth: AdminAuth,
  oidc?: OidcAdminRouteDependencies,
  loginRateLimiter = createAdminLoginRateLimiter(oidc?.config)
): void {
  app.get('/admin/auth/methods', async (_request, reply) => reply.send({
    mode: auth.mode,
    loginStartUrl: auth.mode === 'oidc'
      ? `${oidc?.config.publicApiBaseUrl ?? ''}/admin/auth/oidc/start`
      : null,
    adminUiBasePath: oidc?.config.adminUiBasePath ?? '/frontend/admin',
  }));

  app.get('/admin/session', async (request, reply) => {
    const session = await auth.validate(request);
    if (!session) {
      request.log.warn({
        event: 'admin_session_validation',
        outcome: 'failure',
        category: 'missing_expired_revoked_or_disabled',
      }, 'Administrator session rejected');
      return sendApiError(reply, request, {
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    }
    return reply.send({
      username: session.username,
      displayName: session.principal.displayName,
      roles: session.roles,
      mode: auth.mode,
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  if (isSimpleModeAdminAuth(auth)) {
    app.post('/admin/login', { preHandler: loginRateLimiter }, async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };
      const success = await auth.login(username, password, reply);
      if (!success) {
        request.log.warn({
          event: 'admin_login',
          outcome: 'failure',
          mode: 'simple',
          category: 'invalid_credentials',
        }, 'Administrator login denied');
        return sendApiError(reply, request, {
          statusCode: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials',
        });
      }
      request.log.info({ event: 'admin_login', outcome: 'success', mode: 'simple' }, 'Administrator login succeeded');
      return reply.send({ success: true });
    });
  }

  if (isOidcModeAdminAuth(auth) && oidc) {
    registerOidcRoutes(app, auth, oidc);
  }

  app.post('/admin/logout', async (request, reply) => {
    await auth.logout(request, reply);
    request.log.info({ event: 'admin_session_revocation', outcome: 'success', mode: auth.mode }, 'Administrator session cleared');
    return reply.send({ success: true });
  });
}

export function createAdminLoginRateLimiter(config?: AppConfig) {
  const windowMs = config?.adminLoginRateLimitWindowMs ?? 300_000;
  const maxRequests = config?.adminLoginRateLimitMaxRequests ?? 10;
  const maxBuckets = config?.adminLoginRateLimitMaxBuckets ?? 10_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
    const key = request.ip;
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= maxBuckets) {
        return reply.code(429).send({
          code: 'RATE_LIMITED',
          message: 'Administrator login is temporarily rate limited.',
        });
      }
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      reply.header('Retry-After', String(retryAfterSeconds));
      return reply.code(429).send({
        code: 'RATE_LIMITED',
        message: 'Administrator login is temporarily rate limited.',
      });
    }
  };
}

function registerOidcRoutes(
  app: FastifyInstance,
  auth: OidcModeAdminAuth,
  dependencies: OidcAdminRouteDependencies
): void {
  app.get('/admin/auth/oidc/start', async (request, reply) => {
    const returnPath = validateReturnPath(
      (request.query as { returnTo?: string }).returnTo,
      dependencies.config.adminUiBasePath
    );
    const prepared = await dependencies.provider.prepareAdminAuthorization({
      redirectUri: dependencies.config.oidcAdminRedirectUri!,
      scopes: dependencies.config.oidcAdminScopes,
    });
    const createdAt = new Date();
    await dependencies.transactions.create({
      state: prepared.state,
      nonce: prepared.nonce,
      pkceVerifier: prepared.pkceVerifier,
      redirectUri: dependencies.config.oidcAdminRedirectUri!,
      returnPath,
      createdAt,
      expiresAt: new Date(
        createdAt.getTime() + dependencies.config.oidcLoginTransactionTtlSeconds * 1000
      ),
    });
    request.log.info({
      event: 'admin_oidc_login_start',
      outcome: 'success',
    }, 'Administrator OIDC login started');
    return reply.redirect(prepared.authorizationUrl);
  });

  app.get('/admin/auth/oidc/callback', async (request, reply) => {
    const parameters = new URL(request.url, 'http://localhost').searchParams;
    const state = parameters.get('state');
    if (!state || state.length > 512) {
      throw new UnauthorizedError('OIDC callback state is missing or invalid.');
    }
    const consumed = await dependencies.transactions.consume(state, new Date());
    if (consumed.outcome !== 'consumed') {
      request.log.warn({
        event: 'admin_oidc_callback',
        outcome: 'failure',
        category: consumed.outcome,
      }, 'Administrator OIDC callback rejected');
      throw new UnauthorizedError('OIDC callback transaction is invalid, expired, or already used.');
    }
    let principal;
    try {
      const identity = await dependencies.provider.exchangeAdminAuthorization({
        callbackParameters: parameters,
        redirectUri: consumed.transaction.redirectUri,
        expectedState: state,
        expectedNonce: consumed.transaction.nonce,
        pkceVerifier: consumed.transaction.pkceVerifier,
      });
      principal = await dependencies.principalProjection.project(identity);
    } catch (error) {
      request.log.warn({
        event: 'admin_oidc_callback',
        outcome: 'failure',
        category: 'provider_validation_or_projection',
      }, 'Administrator OIDC callback rejected');
      throw error;
    }
    if (!principal.roles.some((role) => role === 'admin' || role === 'reviewer' || role === 'publisher')) {
      request.log.warn({
        event: 'admin_oidc_callback',
        outcome: 'failure',
        category: 'administrator_role_missing',
      }, 'Administrator OIDC callback rejected');
      throw new UnauthorizedError('The authenticated principal has no administrator role.');
    }
    await auth.establish(principal, reply);
    request.log.info({
      event: 'admin_oidc_callback',
      outcome: 'success',
      roles: principal.roles,
    }, 'Administrator OIDC login succeeded');
    return reply.redirect(consumed.transaction.returnPath);
  });
}

function validateReturnPath(value: string | undefined, allowedBasePath: string): string {
  if (!value) {
    return allowedBasePath;
  }
  if (
    !(value === allowedBasePath || value.startsWith(`${allowedBasePath}/`))
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new UnauthorizedError('Invalid administrator return path.');
  }
  const parsed = new URL(value, 'https://managed-skill-hub.invalid');
  if (
    parsed.origin !== 'https://managed-skill-hub.invalid'
    || !(parsed.pathname === allowedBasePath || parsed.pathname.startsWith(`${allowedBasePath}/`))
  ) {
    throw new UnauthorizedError('Invalid administrator return path.');
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
