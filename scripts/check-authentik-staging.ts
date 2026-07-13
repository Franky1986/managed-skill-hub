import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AdminOidcIdentityProvider } from '../apps/api/src/adapters/outbound/identity/admin-oidc.identity-provider';
import { AuthentikAccessTokenVerifier } from '../apps/api/src/adapters/outbound/identity/authentik-access-token.verifier';
import { SqliteIdentityPersistence } from '../apps/api/src/adapters/outbound/identity/sqlite-identity.persistence';
import { AuthorizationPolicy } from '../apps/api/src/application/security/authorization-policy';
import { PrincipalProjectionService } from '../apps/api/src/application/security/principal-projection.service';
import { loadConfig } from '../apps/api/src/infrastructure/config';

const REQUIRED_EVIDENCE = [
  'adminLogin',
  'adminRoleBoundaries',
  'sessionExpiry',
  'logout',
  'noBrowserTokens',
  'reverseProxyCallback',
  'deviceFlow',
  'tokensFromSameTokenResponse',
  'accessIdTokenSeparation',
  'twoHumanStatusRead',
  'ownerMutationDenied',
  'sameHumanContinuation',
  'jwksRotation',
  'jwksOutageFailClosed',
  'rollbackRehearsed',
] as const;

interface StagingEvidence {
  schemaVersion: 2;
  environment: string;
  testedAt: string;
  checks: Record<string, boolean>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validateEvidence(value: unknown): StagingEvidence {
  assert(value !== null && typeof value === 'object', 'Staging evidence must be a JSON object.');
  const evidence = value as Partial<StagingEvidence>;
  assert(evidence.schemaVersion === 2, 'Staging evidence schemaVersion must be 2.');
  assert(
    typeof evidence.environment === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(evidence.environment),
    'Staging evidence environment must be a non-sensitive deployment label.'
  );
  assert(typeof evidence.testedAt === 'string', 'Staging evidence testedAt is required.');
  const testedAt = new Date(evidence.testedAt);
  assert(!Number.isNaN(testedAt.getTime()), 'Staging evidence testedAt must be an ISO timestamp.');
  const ageMs = Date.now() - testedAt.getTime();
  assert(ageMs >= -300_000 && ageMs <= 30 * 24 * 60 * 60 * 1000, 'Staging evidence must be no older than 30 days.');
  assert(evidence.checks !== null && typeof evidence.checks === 'object', 'Staging evidence checks are required.');
  for (const check of REQUIRED_EVIDENCE) {
    assert(evidence.checks[check] === true, `Staging evidence check '${check}' has not passed.`);
  }
  return evidence as StagingEvidence;
}

async function run(): Promise<void> {
  assert(process.env.RUN_AUTHENTIK_STAGING_CHECK === 'true', 'Set RUN_AUTHENTIK_STAGING_CHECK=true to run this gate.');
  const token = process.env.AUTHENTIK_STAGING_ACCESS_TOKEN;
  const idToken = process.env.AUTHENTIK_STAGING_ID_TOKEN;
  const evidencePath = process.env.AUTHENTIK_STAGING_EVIDENCE_FILE;
  assert(token && token.length <= 32_768, 'AUTHENTIK_STAGING_ACCESS_TOKEN is required and must be bounded.');
  assert(idToken && idToken.length <= 32_768, 'AUTHENTIK_STAGING_ID_TOKEN is required and must be bounded.');
  assert(evidencePath, 'AUTHENTIK_STAGING_EVIDENCE_FILE is required.');

  const evidence = validateEvidence(JSON.parse(await readFile(evidencePath, 'utf8')));
  const config = loadConfig();
  assert(config.adminAuthMode === 'oidc', 'The staging gate requires ADMIN_AUTH_MODE=oidc.');
  assert(config.proposalAuthMode === 'oidc', 'The staging gate requires PROPOSAL_AUTH_MODE=oidc.');

  const adminProvider = new AdminOidcIdentityProvider(config);
  await adminProvider.initialize();

  const directory = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-authentik-gate-'));
  const persistence = new SqliteIdentityPersistence(path.join(directory, 'identity.db'));
  try {
    const policy = new AuthorizationPolicy(config);
    const verifier = new AuthentikAccessTokenVerifier(
      config,
      new PrincipalProjectionService(persistence, policy, config),
      policy
    );
    await verifier.initialize();
    const principal = await verifier.verifyAccessToken(token, 'proposal');
    assert(principal.kind === 'human', 'The staging access token did not resolve to a human principal.');
    assert(principal.roles.includes('submitter'), 'The staging human is not allowed to submit proposals.');
    assert(principal.externalSubject, 'The staging access token did not expose a provider subject.');
    assert(verifier.metadata()?.deviceAuthorizationEndpoint, 'Device Authorization metadata is missing.');
    const idTokenEvidence = await verifier.verifyIdTokenEvidence(idToken, token, principal.externalSubject);
    let idTokenRejected = false;
    try {
      await verifier.verifyAccessToken(idToken, 'proposal');
    } catch {
      idTokenRejected = true;
    }
    assert(idTokenRejected, 'The staging ID token was incorrectly accepted as an API access token.');

    const result = {
      result: 'PASS',
      environment: evidence.environment,
      testedAt: evidence.testedAt,
      checkedAt: new Date().toISOString(),
      evidenceChecks: [...REQUIRED_EVIDENCE],
      liveChecks: [
        'admin-discovery',
        'agent-discovery',
        'device-metadata',
        'human-access-token',
        'id-token-signature-issuer-audience-expiry',
        'access-id-token-same-subject',
        idTokenEvidence.accessTokenBinding === 'at_hash'
          ? 'access-id-token-at-hash-binding'
          : 'access-id-token-same-response-operator-evidence',
        'valid-id-token-rejected-as-access-token',
      ],
      accessTokenBinding: idTokenEvidence.accessTokenBinding,
    };
    await mkdir('.tmp', { recursive: true });
    await writeFile('.tmp/authentik-staging-gate.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log('authentik-staging-gate');
    console.log(`environment=${result.environment}`);
    console.log(`evidenceChecks=${result.evidenceChecks.length}`);
    console.log(`liveChecks=${result.liveChecks.length}`);
    console.log('RESULT=PASS');
  } finally {
    persistence.close();
    await rm(directory, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  console.error('authentik-staging-gate');
  console.error('RESULT=FAIL');
  console.error(`error=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
