import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticatedPrincipal, PrincipalRole } from '../../../application/security/authenticated-principal';
import { ForbiddenError, UnauthorizedError } from '../../../domain/errors';
import { AppConfig } from '../../../infrastructure/config';

export interface AdminAuthSession {
  username: string;
  principal: AuthenticatedPrincipal;
  roles: PrincipalRole[];
  expiresAt: Date;
}

export interface AdminAuth {
  readonly mode: 'simple' | 'oidc';
  validate(request: FastifyRequest): Promise<AdminAuthSession | null>;
  validateMutationOrigin(request: FastifyRequest): void;
  logout(request: FastifyRequest, reply: FastifyReply): Promise<void>;
}

export interface AdminAuthContext {
  session: AdminAuthSession;
}

export function adminGuard(
  auth: AdminAuth,
  requiredRole: PrincipalRole | PrincipalRole[] = 'admin'
) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const session = await auth.validate(request);
    if (!session) {
      throw new UnauthorizedError('Unauthorized');
    }
    const acceptedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!session.roles.includes('admin') && !acceptedRoles.some((role) => session.roles.includes(role))) {
      throw new ForbiddenError(`One of the administrator roles '${acceptedRoles.join(', ')}' is required.`);
    }
    auth.validateMutationOrigin(request);
    (request as FastifyRequest & { adminAuth?: AdminAuthContext }).adminAuth = { session };
  };
}

export function adminActor(request: FastifyRequest): string {
  const session = getAdminAuthContext(request).session;
  return session.principal.issuer ? session.principal.principalId : session.username;
}

export function getAdminAuthContext(request: FastifyRequest): AdminAuthContext {
  const context = (request as FastifyRequest & { adminAuth?: AdminAuthContext }).adminAuth;
  if (!context) {
    throw new UnauthorizedError('Unauthorized');
  }
  return context;
}

export function validateAdminMutationOrigin(request: FastifyRequest, config: AppConfig): void {
  if (!config.adminCsrfOriginCheck || !isMutatingMethod(request.method)) {
    return;
  }

  const origin = request.headers.origin ?? originFromReferer(request.headers.referer);
  if (!origin) {
    return;
  }

  const allowedOrigins = new Set([
    requestOrigin(request),
    new URL(config.publicApiBaseUrl).origin,
    ...config.corsAllowedOrigins.map(normalizeOrigin),
  ]);

  if (!allowedOrigins.has(origin)) {
    throw new UnauthorizedError('Invalid admin request origin');
  }
}

function isMutatingMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function originFromReferer(referer: string | undefined): string | undefined {
  if (!referer) {
    return undefined;
  }
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function requestOrigin(request: FastifyRequest): string {
  const host = request.headers['x-forwarded-host'] ?? request.headers.host;
  const normalizedHost = Array.isArray(host) ? host[0] : host;
  const protocol = request.headers['x-forwarded-proto'];
  const normalizedProtocol = Array.isArray(protocol) ? protocol[0] : protocol;
  return `${normalizedProtocol ?? request.protocol}://${normalizedHost ?? ''}`;
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}
