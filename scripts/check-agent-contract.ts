import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { AgentApiAuth } from '../apps/api/src/adapters/inbound/http/agent-api-auth';
import { registerApiErrorHandler } from '../apps/api/src/adapters/inbound/http/error-response';
import { registerProposalRoutes } from '../apps/api/src/adapters/inbound/http/proposal.controller';
import { registerSkillReadRoutes } from '../apps/api/src/adapters/inbound/http/skill-read.controller';
import type { AppConfig } from '../apps/api/src/infrastructure/config';
import type { Container } from '../apps/api/src/infrastructure/container';

const requireFromScript = createRequire(import.meta.url);
const Fastify = requireFromScript('fastify') as typeof import('fastify');

type AuthProfile = 'open' | 'proposal-auth';

interface CheckResult {
  id: string;
  passed: true;
  checks: Record<string, boolean>;
}

function config(profile: AuthProfile): AppConfig {
  return {
    registryId: 'agent-contract-registry',
    registryName: 'Agent Contract Registry',
    publicApiBaseUrl: 'https://contract.example.com/api',
    publicReadAuthMode: 'none',
    publicReadBearerToken: null,
    publicReadBearerActor: 'read-agent',
    proposalAuthMode: profile === 'proposal-auth' ? 'bearer' : 'none',
    proposalBearerToken: profile === 'proposal-auth' ? 'proposal-token' : null,
    proposalBearerActor: 'proposal-agent',
    discoveryAuthMode: 'none',
    discoveryBearerToken: null,
    discoveryBearerActor: 'discovery-agent',
    openapiYamlPath: 'packages/openapi/skill-registry.openapi.yaml',
    proposalMaxFiles: 30,
    proposalMaxFileSizeBytes: 10 * 1024 * 1024,
    proposalDisallowedPaths: ['node_modules/', '.venv/', 'venv/'],
    autoPublishOnGreen: false,
  } as AppConfig;
}

function container(profile: AuthProfile): Container {
  return {
    config: config(profile),
    nameSuggestion: {
      suggestSkillId: async () => ({ suggestion: 'contract-skill', alternatives: [], isAvailable: true }),
    } as unknown as Container['nameSuggestion'],
    skillQuery: {
      listCategories: async () => ['automation'],
      listTags: async () => ['agent'],
    } as unknown as Container['skillQuery'],
    proposalRead: {
      getNotice: async () => ({ hasNewProposals: false, totalPending: 0 }),
    } as unknown as Container['proposalRead'],
  } as Container;
}

async function buildApp(profile: AuthProfile) {
  const app = Fastify({ logger: false });
  const c = container(profile);
  const auth = new AgentApiAuth(c.config);
  registerSkillReadRoutes(app, c, auth);
  registerProposalRoutes(app, c, auth);
  registerApiErrorHandler(app);
  return app;
}

function parseJson(payload: string): any {
  return payload ? JSON.parse(payload) : null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function runProfile(profile: AuthProfile): Promise<CheckResult> {
  const app = await buildApp(profile);
  const discoverResponse = await app.inject({ method: 'GET', url: '/discover' });
  const howToResponse = await app.inject({ method: 'GET', url: '/howToPropose' });
  const setupResponse = await app.inject({ method: 'GET', url: '/agent-credentials/setup.sh' });
  await app.close();

  assert(discoverResponse.statusCode === 200, profile + ' discover status');
  assert(howToResponse.statusCode === 200, profile + ' howToPropose status');
  assert(setupResponse.statusCode === 200, profile + ' setup script status');

  const discover = parseJson(discoverResponse.payload);
  const howTo = parseJson(howToResponse.payload);
  const entrypointPaths = new Set((discover.entrypoints ?? []).map((entry: { path: string }) => entry.path));
  const hasAnyAuth = profile === 'proposal-auth';

  const checks = {
    registryIdentityPresent: discover.registryId === 'agent-contract-registry' && discover.apiBaseUrl === 'https://contract.example.com/api',
    publishedSkillDownloadEntrypoint: entrypointPaths.has('/skills/{skillId}/package'),
    proposalSubmitEntrypoint: entrypointPaths.has('/proposals'),
    proposalStatusEntrypoint: entrypointPaths.has('/proposals/:id/status'),
    howToEntrypoint: entrypointPaths.has('/howToPropose'),
    setupUrlPresenceMatchesAuth: Boolean(discover.credentialSetupScriptUrl) === hasAnyAuth,
    howToSetupPresenceMatchesAuth: Boolean(howTo.apiNotes?.credentialSetupScriptUrl) === hasAnyAuth,
    howToFirstStepMatchesAuth: howTo.requiredSteps?.[0]?.title === (hasAnyAuth ? 'Handle registry authentication outside chat' : 'Read this workflow first'),
    packageRulesPresent: JSON.stringify(howTo).includes('SKILL.md') && JSON.stringify(howTo).includes('finalize-upload'),
    preUploadPackageProofPresent: howTo.preUploadPackageProof?.requiredBeforeProposalCreation === true
      && JSON.stringify(howTo.preUploadPackageProof).includes('.cursor/skills/')
      && JSON.stringify(howTo.preUploadPackageProof).includes('POST /proposals'),
    setupScriptNoSecret: !setupResponse.payload.includes('proposal-token') && !setupResponse.payload.includes('read-token'),
    setupScriptConfigAware: profile === 'proposal-auth'
      ? setupResponse.payload.includes("MSH_REQUIRE_PROPOSAL='true'") && !setupResponse.payload.includes('Read bearer token')
      : setupResponse.payload.includes("MSH_REQUIRE_PROPOSAL='false'") && !setupResponse.payload.includes('Proposal bearer token'),
  };

  for (const [name, passed] of Object.entries(checks)) {
    assert(passed, profile + ' check failed: ' + name);
  }

  return { id: profile, passed: true, checks };
}

async function main(): Promise<void> {
  const bootstrap = await readFile('docs/product/AGENT_BOOTSTRAP.md', 'utf8');
  assert(bootstrap.includes('/discover'), 'agent bootstrap must reference /discover');
  assert(bootstrap.includes('/howToPropose'), 'agent bootstrap must reference /howToPropose');
  assert(bootstrap.includes('paste bearer tokens into chat') || bootstrap.includes('paste bearer tokens into normal chat') || bootstrap.includes('never paste bearer tokens'), 'agent bootstrap must warn against pasting bearer tokens into chat');

  const results = [await runProfile('open'), await runProfile('proposal-auth')];
  const report = {
    name: 'agent-contract',
    totalProfiles: results.length,
    passedProfiles: results.length,
    failedProfiles: 0,
    results,
  };
  const lines = [
    'agent-contract',
    'totalProfiles=' + report.totalProfiles,
    'passedProfiles=' + report.passedProfiles,
    'failedProfiles=' + report.failedProfiles,
    ...results.map((result) => 'PASS ' + result.id + ' checks=' + Object.keys(result.checks).length),
    'RESULT=PASS',
  ];

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/agent-contract.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/agent-contract.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
