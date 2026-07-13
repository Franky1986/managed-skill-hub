import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { FastifyRequest, FastifyReply } from 'fastify';
import { AppConfig } from '../../../infrastructure/config';
import { AdminAuth, AdminAuthSession, validateAdminMutationOrigin } from './admin-auth';
import { AuthenticatedPrincipal } from '../../../application/security/authenticated-principal';

export const ADMIN_COOKIE = 'skill_hub_session';
const ADMIN_COOKIE_PATHS = ['/', '/admin'] as const;
const ADMIN_COOKIE_PATH = '/';

interface SimpleAdminToken {
  username: string;
  iat: number;
  exp: number;
}

export class SimpleAdminAuth implements AdminAuth {
  readonly mode = 'simple' as const;

  constructor(private readonly config: AppConfig) {}

  async login(username: string, password: string, reply: FastifyReply): Promise<boolean> {
    if (username !== this.config.adminUser) {
      return false;
    }
    const valid = await this.validatePassword(password);
    if (!valid) {
      return false;
    }

    const token = jwt.sign({ username }, this.config.jwtSecret, {
      expiresIn: this.config.sessionTtlSeconds,
    });

    this.clearCookies(reply);

    reply.setCookie(ADMIN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: ADMIN_COOKIE_PATH,
      maxAge: this.config.sessionTtlSeconds * 1000,
    });

    return true;
  }

  private async validatePassword(password: string): Promise<boolean> {
    if (this.config.adminPassword) {
      return constantTimeEquals(password, this.config.adminPassword);
    }

    if (!this.config.adminPasswordHash) {
      return false;
    }

    return bcrypt.compare(password, this.config.adminPasswordHash);
  }

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  async logout(reply: FastifyReply): Promise<void>;
  async logout(requestOrReply: FastifyRequest | FastifyReply, maybeReply?: FastifyReply): Promise<void> {
    const reply = maybeReply ?? requestOrReply as FastifyReply;
    this.clearCookies(reply);
  }

  private clearCookies(reply: FastifyReply): void {
    for (const path of ADMIN_COOKIE_PATHS) {
      reply.clearCookie(ADMIN_COOKIE, { path });
    }
  }

  async validate(request: FastifyRequest): Promise<AdminAuthSession | null> {
    const token = request.cookies?.[ADMIN_COOKIE];
    if (!token) {
      return null;
    }
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as SimpleAdminToken;
      const principal: AuthenticatedPrincipal = {
        principalId: `simple-admin:${decoded.username}`,
        kind: 'human',
        externalSubject: null,
        issuer: null,
        clientId: null,
        displayName: decoded.username,
        email: null,
        groups: [],
        roles: ['admin', 'reviewer', 'publisher', 'reader', 'submitter'],
        scheme: 'session',
      };
      return {
        username: decoded.username,
        principal,
        roles: principal.roles,
        expiresAt: new Date(decoded.exp * 1000),
      };
    } catch {
      return null;
    }
  }

  validateMutationOrigin(request: FastifyRequest): void {
    validateAdminMutationOrigin(request, this.config);
  }
}

export { adminGuard } from './admin-auth';

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
