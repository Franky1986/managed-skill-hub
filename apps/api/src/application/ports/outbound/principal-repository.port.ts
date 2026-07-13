import { PrincipalKind } from '../../security/authenticated-principal';

export interface PrincipalRecord {
  id: string;
  kind: PrincipalKind;
  displayName: string | null;
  email: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  disabledAt: Date | null;
}

export interface ExternalSubjectRecord {
  principalId: string;
  issuer: string;
  externalSubject: string;
  providerClientId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface UpsertExternalPrincipalInput {
  issuer: string;
  externalSubject: string;
  providerClientId: string;
  kind: PrincipalKind;
  displayName: string | null;
  email: string | null;
  seenAt: Date;
  linkToPrincipalId?: string;
  stablePrincipalId?: string;
}

export interface PrincipalRepositoryPort {
  findById(principalId: string): Promise<PrincipalRecord | null>;
  findByExternalSubject(issuer: string, externalSubject: string): Promise<PrincipalRecord | null>;
  upsertExternalPrincipal(input: UpsertExternalPrincipalInput): Promise<PrincipalRecord>;
}
