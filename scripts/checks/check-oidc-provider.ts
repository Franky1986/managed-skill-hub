import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AuthentikAccessTokenVerifier } from '../../apps/api/src/adapters/outbound/identity/authentik-access-token.verifier';
import { SqliteIdentityPersistence } from '../../apps/api/src/adapters/outbound/identity/sqlite-identity.persistence';
import { AuthorizationPolicy } from '../../apps/api/src/application/security/authorization-policy';
import { PrincipalProjectionService } from '../../apps/api/src/application/security/principal-projection.service';
import { createScriptAppConfig } from '../lib/script-app-config';

type GeneratedKeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
type PublicJwk = Awaited<ReturnType<typeof exportJWK>> & {
  kid: string;
  alg: string;
  use: string;
};

interface ProviderState {
  keys: PublicJwk[];
  jwksOutage: boolean;
  discoveryRequests: number;
  jwksRequests: number;
}

interface ProofResult {
  result: 'PASS';
  discoveryRequests: number;
  jwksRequests: number;
  checks: string[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectRejected(action: Promise<unknown>, message: string): Promise<void> {
  try {
    await action;
  } catch {
    return;
  }
  throw new Error(message);
}

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function publicJwk(publicKey: GeneratedKeyPair['publicKey'], kid: string): Promise<PublicJwk> {
  const jwk = await exportJWK(publicKey);
  return { ...jwk, kid, alg: 'RS256', use: 'sig' };
}

async function signAccessToken(
  privateKey: GeneratedKeyPair['privateKey'],
  kid: string,
  issuer: string,
  clientId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    uid: `access-token-${kid}`,
    azp: clientId,
    scope: 'openid profile managedskillhub:proposals',
    managedskillhub_human: true,
    groups: [],
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'at+jwt' })
    .setIssuer(issuer)
    .setAudience(clientId)
    .setSubject('authentik-user-uuid-1')
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

async function signIdToken(
  privateKey: GeneratedKeyPair['privateKey'],
  kid: string,
  issuer: string,
  clientId: string,
  accessToken: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const digest = createHash('sha256').update(accessToken, 'ascii').digest();
  const atHash = digest.subarray(0, digest.length / 2).toString('base64url');
  return new SignJWT({
    azp: clientId,
    at_hash: atHash,
    scope: 'openid profile managedskillhub:proposals',
    managedskillhub_human: true,
    groups: [],
  })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(clientId)
    .setSubject('authentik-user-uuid-1')
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

async function run(): Promise<ProofResult> {
  const first = await generateKeyPair('RS256');
  const second = await generateKeyPair('RS256');
  const unavailable = await generateKeyPair('RS256');
  const state: ProviderState = {
    keys: [await publicJwk(first.publicKey, 'key-1')],
    jwksOutage: false,
    discoveryRequests: 0,
    jwksRequests: 0,
  };
  let issuer = '';
  const server = createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (requestPath.endsWith('/.well-known/openid-configuration')) {
      state.discoveryRequests += 1;
      return sendJson(response, 200, {
        issuer,
        authorization_endpoint: `${new URL(issuer).origin}/application/o/authorize/`,
        device_authorization_endpoint: `${new URL(issuer).origin}/application/o/device/`,
        token_endpoint: `${new URL(issuer).origin}/application/o/token/`,
        jwks_uri: `${issuer}jwks/`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (requestPath.endsWith('/jwks/')) {
      state.jwksRequests += 1;
      if (state.jwksOutage) return sendJson(response, 503, { error: 'temporarily_unavailable' });
      return sendJson(response, 200, { keys: state.keys });
    }
    return sendJson(response, 404, { error: 'not_found' });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string', 'Local OIDC provider did not expose a TCP address.');
  issuer = `http://127.0.0.1:${address.port}/application/o/agent/`;

  const directory = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-oidc-proof-'));
  const persistence = new SqliteIdentityPersistence(path.join(directory, 'catalog.db'));
  try {
    const clientId = 'managedskillhub-agent-device';
    const config = createScriptAppConfig({
      oidcAgentIssuer: issuer,
      oidcAgentClientId: clientId,
      oidcDiscoveryScope: 'managedskillhub:discovery',
      oidcPublicReadScope: 'managedskillhub:skills:read',
      oidcProposalScope: 'managedskillhub:proposals',
      oidcProposalAccess: 'all_authenticated_users',
      oidcProposalGroups: ['managedskillhub-submitters'],
      oidcPublicReadAccess: 'all_authenticated_users',
      oidcPublicReadGroups: ['managedskillhub-readers'],
      oidcAdminSubjects: [],
      oidcAdminGroups: ['managedskillhub-admins'],
      oidcReviewerGroups: ['managedskillhub-reviewers'],
      oidcPublisherGroups: ['managedskillhub-publishers'],
      oidcMaxTokenBytes: 16_384,
      oidcMaxGroups: 100,
      oidcHumanClaim: 'managedskillhub_human',
      oidcClockToleranceSeconds: 5,
      oidcHttpTimeoutMs: 1_000,
      oidcJwksCacheTtlSeconds: 300,
      oidcAccessTokenValidationMode: 'jwt_profile',
      oidcIntrospectionClientId: null,
      oidcIntrospectionClientSecret: null,
    });
    const policy = new AuthorizationPolicy(config);
    const verifier = new AuthentikAccessTokenVerifier(
      config,
      new PrincipalProjectionService(persistence, policy, config),
      policy
    );

    await verifier.initialize();
    const metadata = verifier.metadata();
    assert(metadata?.deviceAuthorizationEndpoint.endsWith('/application/o/device/'), 'Device endpoint missing.');

    const firstToken = await signAccessToken(first.privateKey, 'key-1', issuer, clientId);
    const firstPrincipal = await verifier.verifyAccessToken(firstToken, 'proposal');
    assert(firstPrincipal.kind === 'human', 'Valid access token did not resolve a human principal.');

    const idToken = await signIdToken(first.privateKey, 'key-1', issuer, clientId, firstToken);
    const idTokenEvidence = await verifier.verifyIdTokenEvidence(
      idToken,
      firstToken,
      firstPrincipal.externalSubject!
    );
    assert(idTokenEvidence.accessTokenBinding === 'at_hash', 'ID-token access-token binding was not validated.');
    await expectRejected(
      verifier.verifyAccessToken(idToken, 'proposal'),
      'An ID-token-shaped JWT was accepted as an API access token.'
    );

    state.keys = [await publicJwk(second.publicKey, 'key-2')];
    const rotatedToken = await signAccessToken(second.privateKey, 'key-2', issuer, clientId);
    const rotatedPrincipal = await verifier.verifyAccessToken(rotatedToken, 'proposal');
    assert(rotatedPrincipal.principalId === firstPrincipal.principalId, 'Key rotation changed principal ownership.');

    state.jwksOutage = true;
    const unavailableToken = await signAccessToken(unavailable.privateKey, 'key-3', issuer, clientId);
    await expectRejected(
      verifier.verifyAccessToken(unavailableToken, 'proposal'),
      'An unknown signing key was accepted while JWKS was unavailable.'
    );
    assert(state.discoveryRequests === 1, 'Provider discovery was not cached for the verifier lifetime.');
    assert(state.jwksRequests >= 3, 'JWKS initial load, rotation reload, and outage were not observed.');

    return {
      result: 'PASS',
      discoveryRequests: state.discoveryRequests,
      jwksRequests: state.jwksRequests,
      checks: [
        'loopback-http-discovery',
        'device-metadata',
        'authentik-access-token',
        'valid-oidc-id-token',
        'id-token-at-hash-binding',
        'valid-id-token-rejected-as-access-token',
        'unknown-kid-rotation',
        'jwks-outage-fail-closed',
        'stable-principal-across-rotation',
      ],
    };
  } finally {
    persistence.close();
    await rm(directory, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

await mkdir('.tmp', { recursive: true });
try {
  const result = await run();
  await writeFile('.tmp/oidc-provider.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  const output = [
    'oidc-provider-proof',
    `checks=${result.checks.join(',')}`,
    `discoveryRequests=${result.discoveryRequests}`,
    `jwksRequests=${result.jwksRequests}`,
    `RESULT=${result.result}`,
  ].join('\n');
  await writeFile('.tmp/oidc-provider.log', `${output}\n`, 'utf8');
  console.log(output);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const output = `oidc-provider-proof\nRESULT=FAIL\nerror=${message}`;
  await writeFile('.tmp/oidc-provider.log', `${output}\n`, 'utf8');
  console.error(output);
  process.exitCode = 1;
}
