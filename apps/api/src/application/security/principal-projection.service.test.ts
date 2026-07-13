import { describe, expect, it, vi } from 'vitest';
import { PrincipalRepositoryPort, PrincipalRecord } from '../ports/outbound/principal-repository.port';
import { AppConfig } from '../../infrastructure/config';
import { AuthorizationPolicy } from './authorization-policy';
import { PrincipalProjectionService } from './principal-projection.service';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    oidcAgentIssuer: 'https://auth.example/application/o/agent/',
    oidcAdminIssuer: 'https://auth.example/application/o/admin/',
    oidcMaxGroups: 100,
    oidcProposalAccess: 'all_authenticated_users',
    oidcProposalGroups: ['managedskillhub-submitters'],
    oidcPublicReadAccess: 'all_authenticated_users',
    oidcPublicReadGroups: ['managedskillhub-readers'],
    oidcReviewerGroups: ['managedskillhub-reviewers'],
    oidcPublisherGroups: ['managedskillhub-publishers'],
    oidcAdminGroups: ['managedskillhub-admins'],
    oidcAdminSubjects: [],
    ...overrides,
  } as AppConfig;
}

function record(id: string): PrincipalRecord {
  return {
    id,
    kind: 'human',
    displayName: 'User',
    email: null,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    disabledAt: null,
  };
}

describe('PrincipalProjectionService', () => {
  it('links matching user UUIDs across configured providers on the same tenant', async () => {
    const events = vi.fn();
    const repository = {
      findByExternalSubject: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(record('principal-1')),
      upsertExternalPrincipal: vi.fn().mockResolvedValue(record('principal-1')),
    } as unknown as PrincipalRepositoryPort;
    const service = new PrincipalProjectionService(
      repository,
      new AuthorizationPolicy(config()),
      config(),
      events
    );

    const principal = await service.project({
      issuer: 'https://auth.example/application/o/agent/',
      subject: 'user-uuid-1',
      clientId: 'managedskillhub-agent-device',
      kind: 'human',
      displayName: 'User',
      email: 'user@example.test',
      groups: [],
    });

    expect(repository.upsertExternalPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ linkToPrincipalId: 'principal-1' })
    );
    expect(principal).toMatchObject({
      principalId: 'principal-1',
      scheme: 'oidc',
      roles: expect.arrayContaining(['submitter', 'reader']),
    });
    expect(events).toHaveBeenCalledWith({
      event: 'identity_principal_projection',
      outcome: 'linked',
      principalKind: 'human',
    });
  });

  it('does not correlate equal subjects across different tenant origins', async () => {
    const events = vi.fn();
    const differentTenantConfig = config({
      oidcAdminIssuer: 'https://other-auth.example/application/o/admin/',
    });
    const repository = {
      findByExternalSubject: vi.fn().mockResolvedValue(null),
      upsertExternalPrincipal: vi.fn().mockResolvedValue(record('principal-2')),
    } as unknown as PrincipalRepositoryPort;
    const service = new PrincipalProjectionService(
      repository,
      new AuthorizationPolicy(differentTenantConfig),
      differentTenantConfig,
      events
    );

    await service.project({
      issuer: differentTenantConfig.oidcAgentIssuer!,
      subject: 'user-uuid-1',
      clientId: 'agent',
      kind: 'human',
      displayName: null,
      email: null,
      groups: [],
    });

    expect(repository.findByExternalSubject).toHaveBeenCalledTimes(1);
    expect(repository.upsertExternalPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ linkToPrincipalId: undefined, stablePrincipalId: undefined })
    );
    expect(events).toHaveBeenCalledWith({
      event: 'identity_principal_projection',
      outcome: 'created',
      principalKind: 'human',
    });
  });

  it('uses one deterministic principal ID for simultaneous first logins across trusted issuers', async () => {
    const repository = {
      findByExternalSubject: vi.fn().mockResolvedValue(null),
      upsertExternalPrincipal: vi.fn().mockImplementation(async (input) => record(input.stablePrincipalId)),
    } as unknown as PrincipalRepositoryPort;
    const appConfig = config();
    const service = new PrincipalProjectionService(
      repository,
      new AuthorizationPolicy(appConfig),
      appConfig
    );
    const identity = {
      subject: 'user-uuid-race',
      kind: 'human' as const,
      displayName: null,
      email: null,
      groups: [],
    };

    const [agent, admin] = await Promise.all([
      service.project({
        ...identity,
        issuer: appConfig.oidcAgentIssuer!,
        clientId: 'managedskillhub-agent-device',
      }),
      service.project({
        ...identity,
        issuer: appConfig.oidcAdminIssuer!,
        clientId: 'managedskillhub-admin-web',
      }),
    ]);

    expect(agent.principalId).toBe(admin.principalId);
    expect(agent.principalId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports a profile refresh without exposing identity values', async () => {
    const events = vi.fn();
    const repository = {
      findByExternalSubject: vi.fn().mockResolvedValue(record('principal-3')),
      upsertExternalPrincipal: vi.fn().mockResolvedValue(record('principal-3')),
    } as unknown as PrincipalRepositoryPort;
    const service = new PrincipalProjectionService(
      repository,
      new AuthorizationPolicy(config()),
      config(),
      events
    );

    await service.project({
      issuer: 'https://auth.example/application/o/agent/',
      subject: 'private-user-uuid',
      clientId: 'managedskillhub-agent-device',
      kind: 'human',
      displayName: 'Private Name',
      email: 'private@example.test',
      groups: [],
    });

    expect(events).toHaveBeenCalledWith({
      event: 'identity_principal_projection',
      outcome: 'updated',
      principalKind: 'human',
    });
    expect(JSON.stringify(events.mock.calls)).not.toContain('private-user-uuid');
    expect(JSON.stringify(events.mock.calls)).not.toContain('private@example.test');
  });

  it('rejects excessive provider group claims before persistence', async () => {
    const limitedConfig = config({ oidcMaxGroups: 1 });
    const repository = {
      findByExternalSubject: vi.fn(),
      upsertExternalPrincipal: vi.fn(),
    } as unknown as PrincipalRepositoryPort;
    const service = new PrincipalProjectionService(
      repository,
      new AuthorizationPolicy(limitedConfig),
      limitedConfig
    );

    await expect(service.project({
      issuer: limitedConfig.oidcAgentIssuer!,
      subject: 'user-uuid-1',
      clientId: 'agent',
      kind: 'human',
      displayName: null,
      email: null,
      groups: ['one', 'two'],
    })).rejects.toThrow(/too many groups/);
    expect(repository.upsertExternalPrincipal).not.toHaveBeenCalled();
  });
});
