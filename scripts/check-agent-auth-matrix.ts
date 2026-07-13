import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { AgentApiAuth } from '../apps/api/src/adapters/inbound/http/agent-api-auth';
import { registerApiErrorHandler } from '../apps/api/src/adapters/inbound/http/error-response';
import { registerProposalRoutes } from '../apps/api/src/adapters/inbound/http/proposal.controller';
import { registerSkillReadRoutes } from '../apps/api/src/adapters/inbound/http/skill-read.controller';
import type { AppConfig } from '../apps/api/src/infrastructure/config';
import type { Container } from '../apps/api/src/infrastructure/container';

const requireFromScript = createRequire(import.meta.url);
const Fastify = requireFromScript('fastify') as typeof import('fastify');

type Area = 'read' | 'proposal' | 'discovery';
type MatrixCase = Record<Area, boolean>;

interface CaseResult {
  id: string;
  config: {
    publicReadAuthMode: 'none' | 'bearer';
    proposalAuthMode: 'none' | 'bearer';
    discoveryAuthMode: 'none' | 'bearer';
  };
  discover: {
    unauthenticatedStatus: number;
    authenticatedStatus: number;
    readAuthRequired: boolean;
    proposalAuthRequired: boolean;
    discoveryAuthRequired: boolean;
    credentialSetupScriptUrlPresent: boolean;
  };
  howToPropose: {
    firstStepTitle: string;
    credentialSetupScriptUrlPresent: boolean;
    authSetupFlowPresent: boolean;
  };
  publicRead: {
    unauthenticatedStatus: number;
    authenticatedStatus: number | null;
    unauthorizedArea: string | null;
  };
  proposal: {
    unauthenticatedStatus: number;
    authenticatedStatus: number | null;
    unauthorizedArea: string | null;
  };
  setupScript: {
    requireRead: boolean;
    requireProposal: boolean;
    containsReadPrompt: boolean;
    containsProposalPrompt: boolean;
    persistsReadToken: boolean;
    persistsProposalToken: boolean;
  };
  result: 'PASS';
}

const cases: MatrixCase[] = [
  { read: false, proposal: false, discovery: false },
  { read: true, proposal: false, discovery: false },
  { read: false, proposal: true, discovery: false },
  { read: false, proposal: false, discovery: true },
  { read: true, proposal: true, discovery: false },
  { read: true, proposal: false, discovery: true },
  { read: false, proposal: true, discovery: true },
  { read: true, proposal: true, discovery: true },
];

function id(testCase: MatrixCase): string {
  return [
    testCase.read ? 'read-bearer' : 'read-none',
    testCase.proposal ? 'proposal-bearer' : 'proposal-none',
    testCase.discovery ? 'discovery-bearer' : 'discovery-none',
  ].join('__');
}

function config(testCase: MatrixCase): AppConfig {
  return {
    registryId: 'matrix-registry',
    registryName: 'Matrix Registry',
    publicApiBaseUrl: 'https://matrix.example.com/api',
    publicReadAuthMode: testCase.read ? 'bearer' : 'none',
    publicReadBearerToken: testCase.read ? 'read-token' : null,
    publicReadBearerActor: 'read-agent',
    proposalAuthMode: testCase.proposal ? 'bearer' : 'none',
    proposalBearerToken: testCase.proposal ? 'proposal-token' : null,
    proposalBearerActor: 'proposal-agent',
    discoveryAuthMode: testCase.discovery ? 'bearer' : 'none',
    discoveryBearerToken: testCase.discovery ? 'discovery-token' : null,
    discoveryBearerActor: 'discovery-agent',
    openapiYamlPath: '/nonexistent/openapi.yaml',
    proposalMaxFiles: 30,
    proposalMaxFileSizeBytes: 10 * 1024 * 1024,
    proposalDisallowedPaths: ['node_modules/'],
    autoPublishOnGreen: false,
  } as AppConfig;
}

function container(testCase: MatrixCase): Container {
  return {
    config: config(testCase),
    nameSuggestion: {
      suggestSkillId: async () => ({ suggestion: 'skill', alternatives: [], isAvailable: true }),
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

async function buildApp(testCase: MatrixCase) {
  const app = Fastify({ logger: false });
  const c = container(testCase);
  const auth = new AgentApiAuth(c.config);
  registerSkillReadRoutes(app, c, auth);
  registerProposalRoutes(app, c, auth);
  registerApiErrorHandler(app);
  return app;
}

function authHeader(area: Area): Record<string, string> {
  return { authorization: 'Bearer ' + area + '-token' };
}

function parseJson(payload: string): any {
  return payload ? JSON.parse(payload) : null;
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(message + ". Expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

async function runCase(testCase: MatrixCase): Promise<CaseResult> {
  const app = await buildApp(testCase);
  const anyAuth = testCase.read || testCase.proposal || testCase.discovery;
  const caseId = id(testCase);

  const discoverWithoutAuth = await app.inject({ method: 'GET', url: '/discover' });
  const discoverWithAuth = testCase.discovery
    ? await app.inject({ method: 'GET', url: '/discover', headers: authHeader('discovery') })
    : discoverWithoutAuth;

  if (testCase.discovery) {
    assertEqual(discoverWithoutAuth.statusCode, 401, caseId + ' discovery without token status');
    assertEqual(parseJson(discoverWithoutAuth.payload).details.authArea, 'discovery', caseId + ' discovery authArea');
  }
  assertEqual(discoverWithAuth.statusCode, 200, caseId + ' discovery with expected auth status');
  const discoverPayload = parseJson(discoverWithAuth.payload);
  assertEqual(discoverPayload.readAuthRequired, testCase.read, caseId + ' discover readAuthRequired');
  assertEqual(discoverPayload.proposalAuthRequired, testCase.proposal, caseId + ' discover proposalAuthRequired');
  assertEqual(discoverPayload.discoveryAuthRequired, testCase.discovery, caseId + ' discover discoveryAuthRequired');
  assertEqual(Object.prototype.hasOwnProperty.call(discoverPayload, 'credentialSetupScriptUrl'), anyAuth, caseId + ' discover setup URL presence');

  const howTo = await app.inject({
    method: 'GET',
    url: '/howToPropose',
    headers: testCase.discovery ? authHeader('discovery') : undefined,
  });
  assertEqual(howTo.statusCode, 200, caseId + ' howToPropose status');
  const howToPayload = parseJson(howTo.payload);
  assertEqual(
    howToPayload.requiredSteps[0].title,
    anyAuth ? 'Handle registry authentication outside chat' : 'Read this workflow first',
    caseId + ' how-to first step'
  );
  assertEqual(Boolean(howToPayload.apiNotes.credentialSetupScriptUrl), anyAuth, caseId + ' how-to setup URL presence');
  assertEqual(Boolean(howToPayload.apiNotes.authSetupFlow), anyAuth, caseId + ' how-to setup flow presence');

  const publicReadWithoutAuth = await app.inject({ method: 'GET', url: '/categories' });
  let publicReadWithAuthStatus: number | null = null;
  let publicReadUnauthorizedArea: string | null = null;
  if (testCase.read) {
    assertEqual(publicReadWithoutAuth.statusCode, 401, caseId + ' public read without token status');
    publicReadUnauthorizedArea = parseJson(publicReadWithoutAuth.payload).details.authArea;
    assertEqual(publicReadUnauthorizedArea, 'public-read', caseId + ' public read authArea');
    const publicReadWithAuth = await app.inject({ method: 'GET', url: '/categories', headers: authHeader('read') });
    publicReadWithAuthStatus = publicReadWithAuth.statusCode;
    assertEqual(publicReadWithAuth.statusCode, 200, caseId + ' public read with token status');
  } else {
    assertEqual(publicReadWithoutAuth.statusCode, 200, caseId + ' public read open status');
  }

  const proposalWithoutAuth = await app.inject({ method: 'GET', url: '/proposals/notice' });
  let proposalWithAuthStatus: number | null = null;
  let proposalUnauthorizedArea: string | null = null;
  if (testCase.proposal) {
    assertEqual(proposalWithoutAuth.statusCode, 401, caseId + ' proposal without token status');
    proposalUnauthorizedArea = parseJson(proposalWithoutAuth.payload).details.authArea;
    assertEqual(proposalUnauthorizedArea, 'proposal', caseId + ' proposal authArea');
    const proposalWithAuth = await app.inject({ method: 'GET', url: '/proposals/notice', headers: authHeader('proposal') });
    proposalWithAuthStatus = proposalWithAuth.statusCode;
    assertEqual(proposalWithAuth.statusCode, 200, caseId + ' proposal with token status');
  } else {
    assertEqual(proposalWithoutAuth.statusCode, 200, caseId + ' proposal open status');
  }

  const setupScript = await app.inject({ method: 'GET', url: '/agent-credentials/setup.sh' });
  assertEqual(setupScript.statusCode, 200, caseId + ' setup script status');
  const setupPayload = setupScript.payload;
  const setup = {
    requireRead: setupPayload.includes("MSH_REQUIRE_READ='true'"),
    requireProposal: setupPayload.includes("MSH_REQUIRE_PROPOSAL='true'"),
    containsReadPrompt: setupPayload.includes('Read bearer token'),
    containsProposalPrompt: setupPayload.includes('Proposal bearer token'),
    persistsReadToken: setupPayload.includes('entry.readToken'),
    persistsProposalToken: setupPayload.includes('entry.proposalToken'),
  };
  assertEqual(setup.requireRead, testCase.read, caseId + ' setup requireRead');
  assertEqual(setup.requireProposal, testCase.proposal, caseId + ' setup requireProposal');
  assertEqual(setup.containsReadPrompt, testCase.read, caseId + ' setup read prompt');
  assertEqual(setup.containsProposalPrompt, testCase.proposal, caseId + ' setup proposal prompt');
  assertEqual(setup.persistsReadToken, testCase.read, caseId + ' setup read persistence');
  assertEqual(setup.persistsProposalToken, testCase.proposal, caseId + ' setup proposal persistence');

  await app.close();

  return {
    id: caseId,
    config: {
      publicReadAuthMode: testCase.read ? 'bearer' : 'none',
      proposalAuthMode: testCase.proposal ? 'bearer' : 'none',
      discoveryAuthMode: testCase.discovery ? 'bearer' : 'none',
    },
    discover: {
      unauthenticatedStatus: discoverWithoutAuth.statusCode,
      authenticatedStatus: discoverWithAuth.statusCode,
      readAuthRequired: discoverPayload.readAuthRequired,
      proposalAuthRequired: discoverPayload.proposalAuthRequired,
      discoveryAuthRequired: discoverPayload.discoveryAuthRequired,
      credentialSetupScriptUrlPresent: Object.prototype.hasOwnProperty.call(discoverPayload, 'credentialSetupScriptUrl'),
    },
    howToPropose: {
      firstStepTitle: howToPayload.requiredSteps[0].title,
      credentialSetupScriptUrlPresent: Boolean(howToPayload.apiNotes.credentialSetupScriptUrl),
      authSetupFlowPresent: Boolean(howToPayload.apiNotes.authSetupFlow),
    },
    publicRead: {
      unauthenticatedStatus: publicReadWithoutAuth.statusCode,
      authenticatedStatus: publicReadWithAuthStatus,
      unauthorizedArea: publicReadUnauthorizedArea,
    },
    proposal: {
      unauthenticatedStatus: proposalWithoutAuth.statusCode,
      authenticatedStatus: proposalWithAuthStatus,
      unauthorizedArea: proposalUnauthorizedArea,
    },
    setupScript: setup,
    result: 'PASS',
  };
}

async function main(): Promise<void> {
  const results: CaseResult[] = [];
  for (const testCase of cases) {
    results.push(await runCase(testCase));
  }

  await mkdir('.tmp', { recursive: true });
  const report = {
    name: 'agent-api-auth-matrix',
    totalPermutations: cases.length,
    passedPermutations: results.length,
    failedPermutations: 0,
    results,
  };

  const lines = [
    'agent-api-auth-matrix',
    'totalPermutations=' + report.totalPermutations,
    'passedPermutations=' + report.passedPermutations,
    'failedPermutations=' + report.failedPermutations,
    ...results.map((result) => [
      'PASS',
      result.id,
      'discover=' + result.discover.unauthenticatedStatus + '/' + result.discover.authenticatedStatus,
      'read=' + result.publicRead.unauthenticatedStatus + '/' + (result.publicRead.authenticatedStatus ?? '-'),
      'proposal=' + result.proposal.unauthenticatedStatus + '/' + (result.proposal.authenticatedStatus ?? '-'),
      'setupRead=' + result.setupScript.requireRead,
      'setupProposal=' + result.setupScript.requireProposal,
      'howToFirstStep=' + JSON.stringify(result.howToPropose.firstStepTitle),
    ].join(' ')),
    'RESULT=PASS',
  ];

  await writeFile('.tmp/agent-auth-matrix.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/agent-auth-matrix.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
