import { VerifiedExternalIdentity } from '../../security/principal-projection.service';

export interface PreparedAuthorizationRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
  pkceVerifier: string;
}

export interface AdminAuthorizationRequestInput {
  redirectUri: string;
  scopes: string[];
}

export interface AdminAuthorizationCallbackInput {
  callbackParameters: URLSearchParams;
  redirectUri: string;
  expectedState: string;
  expectedNonce: string;
  pkceVerifier: string;
}

export interface IdentityProviderPort {
  initialize(): Promise<void>;
  prepareAdminAuthorization(input: AdminAuthorizationRequestInput): Promise<PreparedAuthorizationRequest>;
  exchangeAdminAuthorization(input: AdminAuthorizationCallbackInput): Promise<VerifiedExternalIdentity>;
}
