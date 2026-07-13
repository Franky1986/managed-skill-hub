import { describe, expect, it, vi } from 'vitest';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticatedPrincipal, PrincipalRole } from '../../../application/security/authenticated-principal';
import { ForbiddenError } from '../../../domain/errors';
import { AdminAuth, AdminAuthSession, adminGuard } from './admin-auth';

function authWithRoles(roles: PrincipalRole[]): AdminAuth {
  const principal: AuthenticatedPrincipal = {
    principalId: 'principal-1',
    kind: 'human',
    externalSubject: 'subject-1',
    issuer: 'https://auth.example.test/application/o/admin/',
    clientId: 'managedskillhub-admin-web',
    displayName: 'Administrator',
    email: null,
    groups: [],
    roles,
    scheme: 'session',
  };
  const session: AdminAuthSession = {
    username: 'Administrator',
    principal,
    roles,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  };
  return {
    mode: 'oidc',
    validate: vi.fn().mockResolvedValue(session),
    validateMutationOrigin: vi.fn(),
    logout: vi.fn(),
  };
}

const request = {} as FastifyRequest;
const reply = {} as FastifyReply;

describe('adminGuard role authorization', () => {
  it('lets an administrator satisfy every specialized role', async () => {
    const auth = authWithRoles(['admin']);

    await expect(adminGuard(auth, 'reviewer')(request, reply)).resolves.toBeUndefined();
    await expect(adminGuard(auth, 'publisher')(request, reply)).resolves.toBeUndefined();
    await expect(adminGuard(auth)(request, reply)).resolves.toBeUndefined();
  });

  it('lets a reviewer review but not publish or perform admin-only operations', async () => {
    const auth = authWithRoles(['reviewer']);

    await expect(adminGuard(auth, 'reviewer')(request, reply)).resolves.toBeUndefined();
    await expect(adminGuard(auth, 'publisher')(request, reply)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(adminGuard(auth)(request, reply)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets a publisher publish but not review or perform admin-only operations', async () => {
    const auth = authWithRoles(['publisher']);

    await expect(adminGuard(auth, 'publisher')(request, reply)).resolves.toBeUndefined();
    await expect(adminGuard(auth, 'reviewer')(request, reply)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(adminGuard(auth)(request, reply)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('accepts either requested role without treating one as the other', async () => {
    await expect(
      adminGuard(authWithRoles(['reviewer']), ['reviewer', 'publisher'])(request, reply)
    ).resolves.toBeUndefined();
    await expect(
      adminGuard(authWithRoles(['publisher']), ['reviewer', 'publisher'])(request, reply)
    ).resolves.toBeUndefined();
  });
});
