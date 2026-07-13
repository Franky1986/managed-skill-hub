import { AppConfig } from '../../infrastructure/config';
import {
  AuthenticatedPrincipal,
  PrincipalRole,
} from './authenticated-principal';

export type AuthorizationArea = 'discovery' | 'public-read' | 'proposal';

export class AuthorizationPolicy {
  constructor(private readonly config: AppConfig) {}

  resolveRoles(principal: AuthenticatedPrincipal): PrincipalRole[] {
    if (principal.scheme !== 'oidc' && principal.scheme !== 'session') {
      return principal.roles;
    }

    const roles = new Set<PrincipalRole>(principal.roles);
    const isHuman = principal.kind === 'human';

    if (isHuman && this.matchesAccessPolicy(
      this.config.oidcProposalAccess,
      this.config.oidcProposalGroups,
      principal.groups
    )) {
      roles.add('submitter');
    }
    if (isHuman && this.matchesAccessPolicy(
      this.config.oidcPublicReadAccess,
      this.config.oidcPublicReadGroups,
      principal.groups
    )) {
      roles.add('reader');
    }
    if (hasAnyGroup(principal.groups, this.config.oidcReviewerGroups)) {
      roles.add('reviewer');
    }
    if (hasAnyGroup(principal.groups, this.config.oidcPublisherGroups)) {
      roles.add('publisher');
    }
    if (
      (principal.externalSubject !== null && this.config.oidcAdminSubjects.includes(principal.externalSubject))
      || hasAnyGroup(principal.groups, this.config.oidcAdminGroups)
    ) {
      roles.add('admin');
      roles.add('reviewer');
      roles.add('publisher');
      roles.add('reader');
      roles.add('submitter');
    }

    return [...roles];
  }

  withResolvedRoles(principal: AuthenticatedPrincipal): AuthenticatedPrincipal {
    return { ...principal, roles: this.resolveRoles(principal) };
  }

  canAccessArea(principal: AuthenticatedPrincipal, area: AuthorizationArea): boolean {
    if (principal.scheme === 'none' || principal.scheme === 'bearer') {
      return true;
    }
    if (principal.kind !== 'human') {
      return false;
    }
    const roles = this.resolveRoles(principal);
    switch (area) {
      case 'discovery':
        return true;
      case 'public-read':
        return roles.includes('reader') || roles.includes('admin');
      case 'proposal':
        return roles.includes('submitter') || roles.includes('admin');
    }
  }

  hasRole(principal: AuthenticatedPrincipal, required: PrincipalRole): boolean {
    const roles = this.resolveRoles(principal);
    return roles.includes('admin') || roles.includes(required);
  }

  private matchesAccessPolicy(
    policy: 'all_authenticated_users' | 'required_groups',
    requiredGroups: string[],
    principalGroups: string[]
  ): boolean {
    return policy === 'all_authenticated_users' || hasAnyGroup(principalGroups, requiredGroups);
  }
}

function hasAnyGroup(actual: string[], configured: string[]): boolean {
  const actualGroups = new Set(actual);
  return configured.some((group) => actualGroups.has(group));
}
