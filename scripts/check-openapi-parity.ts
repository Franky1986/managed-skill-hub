import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const requireFromScript = createRequire(import.meta.url);
const yaml = requireFromScript('js-yaml') as typeof import('js-yaml');

type HttpMethod = 'get' | 'post';

interface RouteExpectation {
  path: string;
  method: HttpMethod;
  operationId: string;
  auth: 'none' | 'discovery' | 'public-read' | 'proposal';
  requireUsableSuccess?: boolean;
}

const expectations: RouteExpectation[] = [
  { path: '/api/health', method: 'get', operationId: 'getHealth', auth: 'none' },
  { path: '/discover', method: 'get', operationId: 'discover', auth: 'discovery', requireUsableSuccess: true },
  { path: '/howToPropose', method: 'get', operationId: 'getHowToPropose', auth: 'discovery', requireUsableSuccess: true },
  { path: '/openapi.yaml', method: 'get', operationId: 'getOpenApiYaml', auth: 'discovery' },
  { path: '/agent-sessions', method: 'post', operationId: 'createAgentSession', auth: 'none', requireUsableSuccess: true },
  { path: '/skills/suggest-name', method: 'get', operationId: 'suggestSkillName', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills', method: 'get', operationId: 'listSkills', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/search', method: 'get', operationId: 'searchSkills', auth: 'public-read', requireUsableSuccess: true },
  { path: '/categories', method: 'get', operationId: 'listCategories', auth: 'public-read', requireUsableSuccess: true },
  { path: '/tags', method: 'get', operationId: 'listTags', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/package', method: 'get', operationId: 'downloadSkillPackage', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}', method: 'get', operationId: 'getSkill', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/manifest', method: 'get', operationId: 'getSkillManifest', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/files', method: 'get', operationId: 'listSkillFiles', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/judgements', method: 'get', operationId: 'listSkillPublicJudgements', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/files/{fileId}', method: 'get', operationId: 'getSkillFile', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/files/{fileId}/judgements', method: 'get', operationId: 'listSkillFilePublicJudgements', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/files/{fileId}/extracted-content', method: 'get', operationId: 'getSkillFileExtractedContent', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/files/{fileId}/probe', method: 'get', operationId: 'getSkillFileProbe', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/versions', method: 'get', operationId: 'listSkillVersions', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/history', method: 'get', operationId: 'getSkillHistory', auth: 'public-read', requireUsableSuccess: true },
  { path: '/skills/{skillId}/deprecation', method: 'get', operationId: 'getSkillDeprecation', auth: 'public-read', requireUsableSuccess: true },
  { path: '/proposals/check-duplicate', method: 'post', operationId: 'checkDuplicateProposal', auth: 'proposal', requireUsableSuccess: true },
  { path: '/proposals', method: 'post', operationId: 'submitProposal', auth: 'proposal' },
  { path: '/proposals/notice', method: 'get', operationId: 'getProposalNotice', auth: 'proposal', requireUsableSuccess: true },
  { path: '/proposals/{proposalId}/status', method: 'get', operationId: 'getProposalStatus', auth: 'proposal', requireUsableSuccess: true },
  { path: '/proposals/{proposalId}/files', method: 'post', operationId: 'attachProposalFile', auth: 'proposal' },
  { path: '/proposals/{proposalId}/finalize-upload', method: 'post', operationId: 'finalizeProposalUpload', auth: 'proposal', requireUsableSuccess: true },
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function responseHasUsableSuccess(operation: any): boolean {
  const response = operation?.responses?.['200'] ?? operation?.responses?.['201'];
  return Boolean(response && typeof response === 'object' && typeof response.description === 'string' && response.description.length > 0);
}

function assertRuntimeSecurity(operation: any, auth: Exclude<RouteExpectation['auth'], 'none'>, path: string): void {
  const security = operation.security as Array<Record<string, string[]>> | undefined;
  assert(Array.isArray(security), path + ' must declare runtime-selectable security');
  assert(
    !security.some((requirement) => Object.keys(requirement).length === 0),
    path + ' must not claim unconditional anonymous access'
  );
  const bearerScheme = auth === 'discovery'
    ? 'discoveryBearer'
    : auth === 'public-read'
      ? 'publicReadBearer'
      : 'proposalBearer';
  assert(security.some((requirement) => bearerScheme in requirement), path + ' must document ' + bearerScheme);
  assert(security.some((requirement) => 'agentOidc' in requirement), path + ' must document agentOidc');
}

async function main(): Promise<void> {
  const source = await readFile('packages/openapi/skill-registry.openapi.yaml', 'utf8');
  const doc = yaml.load(source) as any;
  const paths = doc.paths ?? {};
  assert(
    doc['x-managed-skill-hub-runtime-auth']?.selectors?.discovery === 'DISCOVERY_AUTH_MODE'
      && doc['x-managed-skill-hub-runtime-auth']?.selectors?.publicRead === 'PUBLIC_READ_AUTH_MODE'
      && doc['x-managed-skill-hub-runtime-auth']?.selectors?.proposal === 'PROPOSAL_AUTH_MODE',
    'OpenAPI must declare the runtime auth mode selectors'
  );
  const results = [];

  for (const expected of expectations) {
    const operation = paths[expected.path]?.[expected.method];
    assert(operation, expected.method.toUpperCase() + ' ' + expected.path + ' missing from OpenAPI');
    assert(operation.operationId === expected.operationId, expected.path + ' operationId mismatch');
    if (expected.auth !== 'none') {
      assert(operation.responses?.['401'], expected.path + ' must document 401 UnauthorizedError');
      assertRuntimeSecurity(operation, expected.auth, expected.path);
    }
    if (expected.requireUsableSuccess) {
      assert(responseHasUsableSuccess(operation), expected.path + ' must document a usable 200/201 response');
    }
    results.push({ ...expected, passed: true });
  }

  assert(!paths['/agent-credentials/setup.sh'], 'legacy credential setup route must not be documented');

  const unauthorized = doc.components?.responses?.UnauthorizedError;
  assert(unauthorized, 'components.responses.UnauthorizedError missing');
  const errorResponse = doc.components?.schemas?.ErrorResponse;
  assert(errorResponse, 'components.schemas.ErrorResponse missing');
  const errorResponseJson = JSON.stringify(errorResponse);
  for (const token of ['authRequired', 'authArea', 'authScheme', 'discoverUrl', 'agentSessionUrl', 'sessionAreas']) {
    assert(errorResponseJson.includes(token), 'ErrorResponse missing auth details.' + token);
  }

  const report = {
    name: 'openapi-parity',
    totalRoutes: expectations.length,
    passedRoutes: results.length,
    failedRoutes: 0,
    results,
  };
  const lines = [
    'openapi-parity',
    'totalRoutes=' + report.totalRoutes,
    'passedRoutes=' + report.passedRoutes,
    'failedRoutes=' + report.failedRoutes,
    ...results.map((result) => 'PASS ' + result.method.toUpperCase() + ' ' + result.path + ' auth=' + result.auth),
    'RESULT=PASS',
  ];

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/openapi-parity.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/openapi-parity.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
