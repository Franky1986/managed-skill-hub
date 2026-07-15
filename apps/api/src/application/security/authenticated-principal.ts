export type PrincipalKind = 'human' | 'service' | 'technical' | 'anonymous';
export type PrincipalRole = 'submitter' | 'reader' | 'reviewer' | 'publisher' | 'admin';
export type AuthenticationScheme = 'none' | 'bearer' | 'oidc' | 'session';

export interface AuthenticatedPrincipal {
  principalId: string;
  kind: PrincipalKind;
  externalSubject: string | null;
  issuer: string | null;
  clientId: string | null;
  displayName: string | null;
  email: string | null;
  groups: string[];
  roles: PrincipalRole[];
  scheme: AuthenticationScheme;
}

export function anonymousAgentPrincipal(): AuthenticatedPrincipal {
  return {
    principalId: 'anonymous-agent',
    kind: 'anonymous',
    externalSubject: null,
    issuer: null,
    clientId: null,
    displayName: null,
    email: null,
    groups: [],
    roles: [],
    scheme: 'none',
  };
}

export function staticBearerPrincipal(actor: string): AuthenticatedPrincipal {
  return {
    principalId: `legacy-bearer:${actor}`,
    kind: 'technical',
    externalSubject: null,
    issuer: null,
    clientId: null,
    displayName: actor,
    email: null,
    groups: [],
    roles: [],
    scheme: 'bearer',
  };
}

export function agentSessionPrincipal(sessionId: string, _areas: string[]): AuthenticatedPrincipal {
  return {
    principalId: sessionId,
    kind: 'service',
    externalSubject: null,
    issuer: null,
    clientId: null,
    displayName: 'Agent session',
    email: null,
    groups: [],
    roles: [],
    scheme: 'session',
  };
}
