import { describe, expect, it } from 'vitest';
import { AppConfig } from '../../infrastructure/config';
import { AuthenticatedPrincipal } from './authenticated-principal';
import { AuthorizationPolicy } from './authorization-policy';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    oidcProposalAccess: 'all_authenticated_users',
    oidcProposalGroups: ['managedskillhub-submitters'],
    oidcPublicReadAccess: 'required_groups',
    oidcPublicReadGroups: ['managedskillhub-readers'],
    oidcReviewerGroups: ['managedskillhub-reviewers'],
    oidcPublisherGroups: ['managedskillhub-publishers'],
    oidcAdminGroups: ['managedskillhub-admins'],
    oidcAdminSubjects: [],
    ...overrides,
  } as AppConfig;
}

function principal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    principalId: 'principal-1',
    kind: 'human',
    externalSubject: 'user-uuid-1',
    issuer: 'https://auth.example/application/o/agent/',
    clientId: 'managedskillhub-agent-device',
    displayName: 'User',
    email: null,
    groups: [],
    roles: [],
    scheme: 'oidc',
    ...overrides,
  };
}

describe('AuthorizationPolicy', () => {
  it('allows every authenticated human to propose under the default policy', () => {
    const policy = new AuthorizationPolicy(config());
    expect(policy.canAccessArea(principal(), 'proposal')).toBe(true);
    expect(policy.resolveRoles(principal())).toContain('submitter');
  });

  it('requires configured groups when group policy is selected', () => {
    const policy = new AuthorizationPolicy(config({ oidcProposalAccess: 'required_groups' }));
    expect(policy.canAccessArea(principal(), 'proposal')).toBe(false);
    expect(policy.canAccessArea(principal({ groups: ['managedskillhub-submitters'] }), 'proposal')).toBe(true);
  });

  it('rejects service identities for human-delegated proposal access', () => {
    const policy = new AuthorizationPolicy(config());
    expect(policy.canAccessArea(principal({ kind: 'service' }), 'proposal')).toBe(false);
  });

  it('maps admin subjects and groups without using profile data', () => {
    const policy = new AuthorizationPolicy(config({ oidcAdminSubjects: ['user-uuid-1'] }));
    expect(policy.resolveRoles(principal({ email: 'changed@example.test' }))).toEqual(
      expect.arrayContaining(['admin', 'reviewer', 'publisher', 'reader', 'submitter'])
    );
  });

  it('does not grant OIDC roles to legacy technical identities', () => {
    const policy = new AuthorizationPolicy(config());
    expect(policy.resolveRoles(principal({ kind: 'technical', scheme: 'bearer' }))).toEqual([]);
  });
});
