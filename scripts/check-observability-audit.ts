import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContainer } from '../apps/api/src/infrastructure/container';
import { AgentApiAuth } from '../apps/api/src/adapters/inbound/http/agent-api-auth';
import { SimpleAdminAuth } from '../apps/api/src/adapters/inbound/http/simple-admin-auth';
import { registerAdminAuthRoutes } from '../apps/api/src/adapters/inbound/http/admin-auth.controller';
import { registerAdminObservabilityRoutes } from '../apps/api/src/adapters/inbound/http/admin-observability.controller';
import { registerAdminProposalRoutes } from '../apps/api/src/adapters/inbound/http/admin-proposal.controller';
import { registerAdminSkillRoutes } from '../apps/api/src/adapters/inbound/http/admin-skill.controller';
import { registerApiErrorHandler } from '../apps/api/src/adapters/inbound/http/error-response';
import { registerHttpObservability } from '../apps/api/src/adapters/inbound/http/http-observability';
import { registerProposalRoutes } from '../apps/api/src/adapters/inbound/http/proposal.controller';
import { registerSkillReadRoutes } from '../apps/api/src/adapters/inbound/http/skill-read.controller';
import type { AppConfig } from '../apps/api/src/infrastructure/config';
import type { Container } from '../apps/api/src/infrastructure/container';

const requireFromScript = createRequire(import.meta.url);
const Fastify = requireFromScript('fastify') as typeof import('fastify');
const multipart = requireFromScript('@fastify/multipart') as typeof import('@fastify/multipart');
const cookie = requireFromScript('@fastify/cookie') as typeof import('@fastify/cookie');

type FastifyInstance = import('fastify').FastifyInstance;

interface StepResult {
  id: string;
  status: number | 'file';
  passed: true;
  details?: Record<string, unknown>;
}

interface ObservabilitySnapshot {
  counters: Array<{ area: string; method: string; route: string; statusClass: string; count: number }>;
  areaSummaries: Array<{ area: string; totalRequests: number; errorRequests: number }>;
  recentRequests: Array<{ area: string; method: string; route: string; statusCode: number; proposalId?: string | null }>;
}

function config(dataDir: string): AppConfig {
  return {
    dataDir,
    openapiYamlPath: path.resolve('packages/openapi/skill-registry.openapi.yaml'),
    registryId: 'observability-audit-registry',
    registryName: 'Observability Audit Registry',
    publicApiBaseUrl: 'https://observability.example.com/api',
    apiHost: '127.0.0.1',
    apiPort: 3040,
    adminUser: 'admin',
    adminPassword: 'admin',
    adminPasswordHash: '',
    jwtSecret: 'observability-audit-secret',
    sessionTtlSeconds: 3600,
    judgerProvider: 'noop',
    judgerAdapterPath: null,
    vercelAiSdkModel: null,
    vercelAiSdkTimeoutMs: 30000,
    vercelAiSdkMaxTextChars: 12000,
    vercelAiSdkMaxRetries: 0,
    catalogProvider: 'sqlite',
    searchProvider: 'sqlite',
    mysqlHost: '127.0.0.1',
    mysqlPort: 3306,
    mysqlDatabase: 'managed_skill_hub',
    mysqlUser: 'managed_skill_hub',
    mysqlPassword: '',
    mysqlSslMode: 'preferred',
    mysqlConnectTimeoutMs: 10000,
    mysqlQueryTimeoutMs: 30000,
    proposalMaxFiles: 5,
    proposalMaxFileSizeBytes: 1024 * 1024,
    proposalDisallowedPaths: ['node_modules/', '.venv/', 'venv/'],
    autoPublishOnGreen: false,
    autoPublishExcludedCategories: ['security', 'network'],
    autoApproveWithoutJudger: false,
    publicReadAuthMode: 'none',
    publicReadBearerToken: null,
    publicReadBearerActor: 'read-agent',
    proposalAuthMode: 'none',
    proposalBearerToken: null,
    proposalBearerActor: 'proposal-agent',
    discoveryAuthMode: 'none',
    discoveryBearerToken: null,
    discoveryBearerActor: 'discovery-agent',
  };
}

async function buildApp(dataDir: string): Promise<{ app: FastifyInstance; container: Container }> {
  const container = await buildContainer(config(dataDir));
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(multipart);
  registerHttpObservability(app, container.observability);

  const adminAuth = new SimpleAdminAuth(container.config);
  const agentAuth = new AgentApiAuth(container.config);
  registerSkillReadRoutes(app, container, agentAuth);
  registerProposalRoutes(app, container, agentAuth);
  registerAdminAuthRoutes(app, adminAuth);
  registerAdminProposalRoutes(app, container, adminAuth);
  registerAdminSkillRoutes(app, container, adminAuth);
  registerAdminObservabilityRoutes(app, container, adminAuth);
  registerApiErrorHandler(app);
  return { app, container };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function json(payload: string): any {
  return JSON.parse(payload);
}

function multipartPayload(pathValue: string, filename: string, contentType: string, content: string) {
  const boundary = '----msh-observability-audit-boundary';
  const payload = [
    '--' + boundary,
    'Content-Disposition: form-data; name="path"',
    '',
    pathValue,
    '--' + boundary,
    'Content-Disposition: form-data; name="file"; filename="' + filename + '"',
    'Content-Type: ' + contentType,
    '',
    content,
    '--' + boundary + '--',
    '',
  ].join('\r\n');
  return { payload, contentType: 'multipart/form-data; boundary=' + boundary };
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert(raw, 'admin login must set cookie');
  return raw.split(';')[0];
}

function requireAreas(snapshot: ObservabilitySnapshot, areas: string[]): Record<string, number> {
  const byArea = new Map(snapshot.areaSummaries.map((summary) => [summary.area, summary.totalRequests]));
  for (const area of areas) {
    assert((byArea.get(area) ?? 0) > 0, 'missing observability area: ' + area);
  }
  return Object.fromEntries(areas.map((area) => [area, byArea.get(area) ?? 0]));
}

async function readAuditActions(dataDir: string, proposalId: string): Promise<string[]> {
  const auditPath = path.join(dataDir, 'audit', proposalId + '.jsonl');
  const raw = await readFile(auditPath, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).action as string);
}

async function readAuditActionsForSkill(dataDir: string, skillId: string): Promise<string[]> {
  const auditPath = path.join(dataDir, 'audit', skillId + '.jsonl');
  const raw = await readFile(auditPath, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).action as string);
}

async function readGlobalAuditActions(dataDir: string): Promise<string[]> {
  const auditPath = path.join(dataDir, 'audit', 'global.jsonl');
  const raw = await readFile(auditPath, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).action as string);
}

async function createFinalizedProposal(app: FastifyInstance, title: string, actor: string): Promise<{ proposalId: string }> {
  const create = await app.inject({
    method: 'POST',
    url: '/proposals',
    headers: { 'x-actor': actor },
    payload: {
      title,
      description: 'Deterministic secondary proposal for observability audit proof.',
      category: 'operations',
      tags: ['proof', 'audit'],
      capabilities: ['validate-observability'],
      entrypoint: 'SKILL.md',
    },
  });
  assert(create.statusCode === 201, title + ' create status');
  const proposalId = json(create.payload).id as string;
  const upload = multipartPayload('SKILL.md', 'SKILL.md', 'text/markdown', '# ' + title + '\n\nSecondary proposal.');
  const uploaded = await app.inject({
    method: 'POST',
    url: '/proposals/' + proposalId + '/files',
    headers: { 'content-type': upload.contentType, 'x-actor': actor },
    payload: upload.payload,
  });
  assert(uploaded.statusCode === 200, title + ' upload status');
  const finalized = await app.inject({
    method: 'POST',
    url: '/proposals/' + proposalId + '/finalize-upload',
    headers: { 'x-actor': actor },
  });
  assert(finalized.statusCode === 200, title + ' finalize status');
  return { proposalId };
}

async function main(): Promise<void> {
  const dataDir = path.resolve('.tmp/observability-audit-data');
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  const { app, container } = await buildApp(dataDir);
  const results: StepResult[] = [];

  const discover = await app.inject({ method: 'GET', url: '/discover' });
  assert(discover.statusCode === 200, 'discover status');
  results.push({ id: 'discover-recorded', status: discover.statusCode, passed: true });

  const create = await app.inject({
    method: 'POST',
    url: '/proposals',
    headers: { 'x-actor': 'observability-agent' },
    payload: {
      title: 'Observability Audit Proof Skill',
      description: 'Deterministic proof for observability metrics and audit trails.',
      category: 'operations',
      tags: ['proof', 'audit'],
      capabilities: ['validate-observability'],
      entrypoint: 'SKILL.md',
    },
  });
  assert(create.statusCode === 201, 'proposal create status');
  const proposalId = json(create.payload).id as string;
  assert(proposalId, 'proposal id returned');
  results.push({ id: 'proposal-created', status: create.statusCode, passed: true, details: { proposalId } });

  const fileUpload = multipartPayload('SKILL.md', 'SKILL.md', 'text/markdown', '# Observability Audit Proof Skill\n\nValidates audit and observability output.');
  const uploaded = await app.inject({
    method: 'POST',
    url: '/proposals/' + proposalId + '/files',
    headers: { 'content-type': fileUpload.contentType, 'x-actor': 'observability-agent' },
    payload: fileUpload.payload,
  });
  assert(uploaded.statusCode === 200, 'file upload status');
  results.push({ id: 'proposal-file-uploaded', status: uploaded.statusCode, passed: true });

  const finalized = await app.inject({
    method: 'POST',
    url: '/proposals/' + proposalId + '/finalize-upload',
    headers: { 'x-actor': 'observability-agent' },
  });
  assert(finalized.statusCode === 200, 'finalize status');
  results.push({ id: 'proposal-finalized', status: finalized.statusCode, passed: true });

  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'admin', password: 'admin' } });
  assert(login.statusCode === 200, `admin login status ${login.statusCode}: ${login.payload}`);
  const adminCookie = cookieHeader(login.headers['set-cookie']);
  results.push({ id: 'admin-login-recorded', status: login.statusCode, passed: true });

  const detail = await app.inject({ method: 'GET', url: '/admin/proposals/' + proposalId, headers: { cookie: adminCookie } });
  assert(detail.statusCode === 200, 'admin proposal detail status');
  results.push({ id: 'admin-review-recorded', status: detail.statusCode, passed: true });

  const converted = await app.inject({
    method: 'POST',
    url: '/admin/proposals/' + proposalId + '/convert',
    headers: { cookie: adminCookie },
    payload: { comment: 'Convert for observability audit proof.' },
  });
  assert(converted.statusCode === 200, 'admin convert status');
  const convertedSkillId = json(converted.payload).id as string;
  assert(convertedSkillId === 'observability-audit-proof-skill', 'converted skill id');
  results.push({ id: 'admin-convert-recorded', status: converted.statusCode, passed: true, details: { convertedSkillId } });

  const submitSkill = await app.inject({
    method: 'POST',
    url: '/admin/skills/' + convertedSkillId + '/submit-review?version=1.0.0',
    headers: { cookie: adminCookie },
  });
  assert(submitSkill.statusCode === 200, 'admin skill submit-review status');

  const approveSkill = await app.inject({
    method: 'POST',
    url: '/admin/skills/' + convertedSkillId + '/approve?version=1.0.0',
    headers: { cookie: adminCookie },
  });
  assert(approveSkill.statusCode === 200, 'admin skill approve status');

  const publish = await app.inject({
    method: 'POST',
    url: '/admin/skills/' + convertedSkillId + '/publish?version=1.0.0',
    headers: { cookie: adminCookie },
  });
  assert(publish.statusCode === 200, 'admin publish status');
  results.push({ id: 'admin-publish-recorded', status: publish.statusCode, passed: true });

  const rejectedProposal = await createFinalizedProposal(app, 'Observability Reject Proof Skill', 'observability-reject-agent');
  const rejected = await app.inject({
    method: 'POST',
    url: '/admin/proposals/' + rejectedProposal.proposalId + '/reject',
    headers: { cookie: adminCookie },
    payload: { reason: 'Deterministic rejection proof.', comment: 'Reject for observability audit proof.' },
  });
  assert(rejected.statusCode === 200, 'admin reject status');
  results.push({ id: 'admin-reject-recorded', status: rejected.statusCode, passed: true, details: { proposalId: rejectedProposal.proposalId } });

  const rebuild = await app.inject({
    method: 'POST',
    url: '/admin/projections/rebuild?clearProjections=true',
    headers: { cookie: adminCookie },
  });
  assert(rebuild.statusCode === 200, 'admin projection rebuild status');
  results.push({ id: 'projection-rebuild-recorded', status: rebuild.statusCode, passed: true });

  const firstMetrics = await app.inject({ method: 'GET', url: '/admin/observability/metrics', headers: { cookie: adminCookie } });
  assert(firstMetrics.statusCode === 200, 'first metrics status');
  results.push({ id: 'metrics-endpoint-recorded', status: firstMetrics.statusCode, passed: true });

  const metrics = await app.inject({ method: 'GET', url: '/admin/observability/metrics', headers: { cookie: adminCookie } });
  assert(metrics.statusCode === 200, 'metrics status');
  const snapshot = json(metrics.payload) as ObservabilitySnapshot;
  const areaCounts = requireAreas(snapshot, ['retrieval', 'proposal', 'auth', 'review', 'observability']);
  assert(snapshot.counters.some((counter) => counter.route.includes('/proposals') && counter.statusClass === '2xx'), 'proposal counter missing');
  assert(snapshot.recentRequests.some((request) => request.proposalId === proposalId), 'proposal id missing from recent requests');
  results.push({ id: 'metrics-areas-present', status: metrics.statusCode, passed: true, details: { areaCounts } });

  const jsonExport = await app.inject({ method: 'GET', url: '/admin/observability/metrics/export?format=json', headers: { cookie: adminCookie } });
  assert(jsonExport.statusCode === 200, 'json export status');
  assert(String(jsonExport.headers['content-type']).includes('application/json'), 'json export content type');
  assert(json(jsonExport.payload).areaSummaries.some((summary: { area: string }) => summary.area === 'proposal'), 'json export proposal area');
  results.push({ id: 'json-export-valid', status: jsonExport.statusCode, passed: true });

  const csvExport = await app.inject({ method: 'GET', url: '/admin/observability/metrics/export?format=csv', headers: { cookie: adminCookie } });
  assert(csvExport.statusCode === 200, 'csv export status');
  assert(String(csvExport.headers['content-type']).includes('text/csv'), 'csv export content type');
  assert(csvExport.payload.includes('section,name,area,method,route'), 'csv export header');
  assert(csvExport.payload.includes('area_summary,,proposal'), 'csv export proposal area');
  results.push({ id: 'csv-export-valid', status: csvExport.statusCode, passed: true });

  const auditActions = await readAuditActions(dataDir, proposalId);
  for (const action of ['submit_proposal', 'attach_proposal_file', 'finalize_proposal_upload']) {
    assert(auditActions.includes(action), 'missing proposal audit action: ' + action);
  }
  const rejectedAuditActions = await readAuditActions(dataDir, rejectedProposal.proposalId);
  assert(rejectedAuditActions.includes('reject_proposal'), 'missing proposal audit action: reject_proposal');
  const skillAuditActions = await readAuditActionsForSkill(dataDir, convertedSkillId);
  for (const action of ['convert_proposal', 'publish']) {
    assert(skillAuditActions.includes(action), 'missing skill audit action: ' + action);
  }
  const globalAuditActions = await readGlobalAuditActions(dataDir);
  assert(globalAuditActions.includes('rebuild_projections'), 'missing audit action: rebuild_projections');
  results.push({ id: 'audit-trail-present', status: 'file', passed: true, details: { auditActions, rejectedAuditActions, skillAuditActions, globalAuditActions } });

  const persisted = container.readObservability.execute();
  assert(persisted.areaSummaries.some((summary) => summary.area === 'proposal'), 'container snapshot proposal area');
  results.push({ id: 'container-snapshot-readable', status: 'file', passed: true });

  await app.close();

  const report = {
    name: 'observability-audit',
    totalSteps: results.length,
    passedSteps: results.length,
    failedSteps: 0,
    dataDir,
    proposalId,
    results,
  };
  const lines = [
    'observability-audit',
    'totalSteps=' + report.totalSteps,
    'passedSteps=' + report.passedSteps,
    'failedSteps=' + report.failedSteps,
    ...results.map((result) => 'PASS ' + result.id + ' status=' + result.status),
    'RESULT=PASS',
  ];

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/observability-audit.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/observability-audit.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
