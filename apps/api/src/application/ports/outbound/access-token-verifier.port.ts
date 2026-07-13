import { AuthenticatedPrincipal } from '../../security/authenticated-principal';

export type AgentTokenArea = 'discovery' | 'public-read' | 'proposal';

export interface AgentOidcMetadata {
  issuer: string;
  openIdConfigurationUrl: string;
  authorizationEndpoint: string;
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  clientId: string;
}

export interface AccessTokenVerifierPort {
  initialize(): Promise<void>;
  verifyAccessToken(token: string, area: AgentTokenArea): Promise<AuthenticatedPrincipal>;
  metadata(): AgentOidcMetadata | null;
}
