import { FastifyInstance } from 'fastify';
import { AdminAuth } from './admin-auth';
import { SimpleAdminAuth } from './simple-admin-auth';
import { sendApiError } from './error-response';
import { IdentityProviderPort } from '../../../application/ports/outbound/identity-provider.port';
import { OidcLoginTransactionPort } from '../../../application/ports/outbound/oidc-login-transaction.port';
import { PrincipalProjectionService } from '../../../application/security/principal-projection.service';
import { AppConfig } from '../../../infrastructure/config';
import { OidcAdminAuth } from './oidc-admin-auth';
import { UnauthorizedError } from '../../../domain/errors';

export interface OidcAdminRouteDependencies {
  config: AppConfig;
  provider: IdentityProviderPort;
  transactions: OidcLoginTransactionPort;
  principalProjection: PrincipalProjectionService;
}

export function registerAdminAuthRoutes(
  app: FastifyInstance,
  auth: AdminAuth,
  oidc?: OidcAdminRouteDependencies
): void {
  app.get('/admin/auth/methods', async (_request, reply) => reply.send({
    mode: auth.mode,
    loginStartUrl: auth.mode === 'oidc'
      ? `${oidc?.config.publicApiBaseUrl ?? ''}/admin/auth/oidc/start`
      : null,
  }));

  app.get('/admin/session', async (request, reply) => {
    const session = await auth.validate(request);
    if (!session) {
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

  if (auth instanceof SimpleAdminAuth) {
    app.post('/admin/login', async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };
      const success = await auth.login(username, password, reply);
      if (!success) {
        return sendApiError(reply, request, {
          statusCode: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials',
        });
      }
      return reply.send({ success: true });
    });
  }

  if (auth instanceof OidcAdminAuth && oidc) {
    registerOidcRoutes(app, auth, oidc);
  }

  app.post('/admin/logout', async (request, reply) => {
    await auth.logout(request, reply);
    return reply.send({ success: true });
  });
}

function registerOidcRoutes(
  app: FastifyInstance,
  auth: OidcAdminAuth,
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
      throw new UnauthorizedError('OIDC callback transaction is invalid, expired, or already used.');
    }
    const identity = await dependencies.provider.exchangeAdminAuthorization({
      callbackParameters: parameters,
      redirectUri: consumed.transaction.redirectUri,
      expectedState: state,
      expectedNonce: consumed.transaction.nonce,
      pkceVerifier: consumed.transaction.pkceVerifier,
    });
    const principal = await dependencies.principalProjection.project(identity);
    if (!principal.roles.some((role) => role === 'admin' || role === 'reviewer' || role === 'publisher')) {
      throw new UnauthorizedError('The authenticated principal has no administrator role.');
    }
    await auth.establish(principal, reply);
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
