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
    const repository = {
      findByExternalSubject: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(record('principal-1')),
      upsertExternalPrincipal: vi.fn().mockResolvedValue(record('principal-1')),
    } as unknown as PrincipalRepositoryPort;
    const service = new PrincipalProjectionService(
      repository,
      new AuthorizationPolicy(config()),
      config()
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
  });

  it('does not correlate equal subjects across different tenant origins', async () => {
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
      differentTenantConfig
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
      expect.objectContaining({ linkToPrincipalId: undefined })
    );
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
