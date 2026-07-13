import crypto from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AdminSessionPort } from '../../../application/ports/outbound/admin-session.port';
import { PrincipalRepositoryPort } from '../../../application/ports/outbound/principal-repository.port';
import { AuthenticatedPrincipal } from '../../../application/security/authenticated-principal';
import { AppConfig } from '../../../infrastructure/config';
import { ADMIN_COOKIE } from './simple-admin-auth';
import { AdminAuthSession, OidcModeAdminAuth, validateAdminMutationOrigin } from './admin-auth';

export class OidcAdminAuth implements OidcModeAdminAuth {
  readonly mode = 'oidc' as const;
  readonly cookiePath: string;

  constructor(
    private readonly config: AppConfig,
    private readonly sessions: AdminSessionPort,
    private readonly principals: PrincipalRepositoryPort
  ) {
    // Root scope preserves identical authentication on the supported root and
    // API-prefix route aliases. The cookie is read only by administrator guards.
    this.cookiePath = '/';
  }

  async establish(principal: AuthenticatedPrincipal, reply: FastifyReply): Promise<AdminAuthSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlSeconds * 1000);
    const sessionId = crypto.randomBytes(32).toString('base64url');
    await this.sessions.create({
      sessionId,
      principalId: principal.principalId,
      roles: principal.roles,
      createdAt: now,
      expiresAt,
    });
    this.clearCookies(reply);
    reply.setCookie(ADMIN_COOKIE, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: this.cookiePath,
      expires: expiresAt,
    });
    return toAdminSession(principal, expiresAt);
  }

  async validate(request: FastifyRequest): Promise<AdminAuthSession | null> {
    const sessionId = request.cookies?.[ADMIN_COOKIE];
    if (!sessionId || sessionId.length > 512) {
      return null;
    }
    const now = new Date();
    const session = await this.sessions.resolve(sessionId, now);
    if (!session) {
      return null;
    }
    const principalRecord = await this.principals.findById(session.principalId);
    if (!principalRecord || principalRecord.disabledAt) {
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() >= 60_000) {
      await this.sessions.touch(sessionId, now);
    }
    const principal: AuthenticatedPrincipal = {
      principalId: principalRecord.id,
      kind: principalRecord.kind,
      externalSubject: null,
      issuer: this.config.oidcAdminIssuer,
      clientId: this.config.oidcAdminClientId,
      displayName: principalRecord.displayName,
      email: null,
      groups: [],
      roles: session.roles,
      scheme: 'session',
    };
    return toAdminSession(principal, session.expiresAt);
  }

  validateMutationOrigin(request: FastifyRequest): void {
    validateAdminMutationOrigin(request, this.config);
  }

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const sessionId = request.cookies?.[ADMIN_COOKIE];
    if (sessionId && sessionId.length <= 512) {
      await this.sessions.revoke(sessionId, new Date(), 'logout');
    }
    this.clearCookies(reply);
  }

  private clearCookies(reply: FastifyReply): void {
    const paths = new Set(['/', '/admin', this.cookiePath]);
    for (const path of paths) {
      reply.clearCookie(ADMIN_COOKIE, { path });
    }
  }
}

function toAdminSession(
  principal: AuthenticatedPrincipal,
  expiresAt: Date
): AdminAuthSession {
  return {
    username: principal.displayName ?? 'Authenticated administrator',
    principal,
    roles: principal.roles,
    expiresAt,
  };
}
