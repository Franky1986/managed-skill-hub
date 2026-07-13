import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { FastifyRequest, FastifyReply } from 'fastify';
import { AppConfig } from '../../../infrastructure/config';
import { UnauthorizedError } from '../../../domain/errors';

export const ADMIN_COOKIE = 'skill_hub_session';
const ADMIN_COOKIE_PATHS = ['/', '/admin'] as const;
const ADMIN_COOKIE_PATH = '/';

export interface AdminSession {
  username: string;
  iat: number;
  exp: number;
}

export class SimpleAdminAuth {
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

  logout(reply: FastifyReply): void {
    this.clearCookies(reply);
  }

  private clearCookies(reply: FastifyReply): void {
    for (const path of ADMIN_COOKIE_PATHS) {
      reply.clearCookie(ADMIN_COOKIE, { path });
    }
  }

  async validate(request: FastifyRequest): Promise<AdminSession | null> {
    const token = request.cookies?.[ADMIN_COOKIE];
    if (!token) {
      return null;
    }
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as AdminSession;
      return decoded;
    } catch {
      return null;
    }
  }

  validateMutationOrigin(request: FastifyRequest): void {
    if (!this.config.adminCsrfOriginCheck || !isMutatingMethod(request.method)) {
      return;
    }

    const origin = request.headers.origin ?? originFromReferer(request.headers.referer);
    if (!origin) {
      return;
    }

    const allowedOrigins = new Set([
      requestOrigin(request),
      this.config.publicApiBaseUrl,
      ...this.config.corsAllowedOrigins,
    ]);

    if (!allowedOrigins.has(origin)) {
      throw new UnauthorizedError('Invalid admin request origin');
    }
  }
}

export function adminGuard(auth: SimpleAdminAuth) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const session = await auth.validate(request);
    if (!session) {
      throw new UnauthorizedError('Unauthorized');
    }
    auth.validateMutationOrigin(request);
  };
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

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
