import { PrincipalRepositoryPort } from '../ports/outbound/principal-repository.port';
import { AppConfig } from '../../infrastructure/config';
import { ForbiddenError, ValidationError } from '../../domain/errors';
import { AuthenticatedPrincipal, PrincipalKind } from './authenticated-principal';
import { AuthorizationPolicy } from './authorization-policy';

export interface VerifiedExternalIdentity {
  issuer: string;
  subject: string;
  clientId: string;
  kind: PrincipalKind;
  displayName: string | null;
  email: string | null;
  groups: string[];
}

export class PrincipalProjectionService {
  constructor(
    private readonly repository: PrincipalRepositoryPort,
    private readonly policy: AuthorizationPolicy,
    private readonly config: AppConfig
  ) {}

  async project(identity: VerifiedExternalIdentity, seenAt = new Date()): Promise<AuthenticatedPrincipal> {
    validateIdentity(identity, this.config.oidcMaxGroups);
    const exact = await this.repository.findByExternalSubject(identity.issuer, identity.subject);
    const linked = exact ?? await this.findConfiguredCounterpart(identity.issuer, identity.subject);
    const record = await this.repository.upsertExternalPrincipal({
      issuer: identity.issuer,
      externalSubject: identity.subject,
      providerClientId: identity.clientId,
      kind: identity.kind,
      displayName: identity.displayName,
      email: identity.email,
      seenAt,
      linkToPrincipalId: linked?.id,
    });
    if (record.disabledAt) {
      throw new ForbiddenError('The authenticated principal is disabled.');
    }

    return this.policy.withResolvedRoles({
      principalId: record.id,
      kind: record.kind,
      externalSubject: identity.subject,
      issuer: identity.issuer,
      clientId: identity.clientId,
      displayName: record.displayName,
      email: record.email,
      groups: [...identity.groups],
      roles: [],
      scheme: 'oidc',
    });
  }

  private async findConfiguredCounterpart(
    issuer: string,
    subject: string
  ) {
    const agentIssuer = this.config.oidcAgentIssuer;
    const adminIssuer = this.config.oidcAdminIssuer;
    if (!agentIssuer || !adminIssuer || !sameTenantOrigin(agentIssuer, adminIssuer)) {
      return null;
    }
    if (issuer === agentIssuer) {
      return this.repository.findByExternalSubject(adminIssuer, subject);
    }
    if (issuer === adminIssuer) {
      return this.repository.findByExternalSubject(agentIssuer, subject);
    }
    return null;
  }
}

function validateIdentity(identity: VerifiedExternalIdentity, maxGroups: number): void {
  if (!identity.issuer || !identity.subject || !identity.clientId) {
    throw new ValidationError('Verified identity issuer, subject, and client ID are required.');
  }
  if (identity.groups.length > maxGroups) {
    throw new ValidationError('Verified identity has too many groups.');
  }
  if (new Set(identity.groups).size !== identity.groups.length) {
    throw new ValidationError('Verified identity groups must be unique.');
  }
}

function sameTenantOrigin(left: string, right: string): boolean {
  return new URL(left).origin === new URL(right).origin;
}
