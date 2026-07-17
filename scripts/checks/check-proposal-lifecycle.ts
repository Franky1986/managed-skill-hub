import { createRequire } from 'node:module';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContainer } from '../../apps/api/src/infrastructure/container';
import { AgentApiAuth } from '../../apps/api/src/adapters/inbound/http/agent-api-auth';
import { SimpleAdminAuth } from '../../apps/api/src/adapters/inbound/http/simple-admin-auth';
import { registerApiErrorHandler } from '../../apps/api/src/adapters/inbound/http/error-response';
import { registerSkillReadRoutes } from '../../apps/api/src/adapters/inbound/http/skill-read.controller';
import { registerProposalRoutes } from '../../apps/api/src/adapters/inbound/http/proposal.controller';
import { registerAdminAuthRoutes } from '../../apps/api/src/adapters/inbound/http/admin-auth.controller';
import { registerAdminProposalRoutes } from '../../apps/api/src/adapters/inbound/http/admin-proposal.controller';
import { registerAdminSkillRoutes } from '../../apps/api/src/adapters/inbound/http/admin-skill.controller';
import type { AppConfig } from '../../apps/api/src/infrastructure/config';
import { createScriptAppConfig } from '../lib/script-app-config';

const requireFromApiWorkspace = createRequire(
  new URL('../../apps/api/package.json', import.meta.url),
);
const Fastify = requireFromApiWorkspace('fastify') as typeof import('fastify');
const multipart = requireFromApiWorkspace('@fastify/multipart') as typeof import('@fastify/multipart');
const cookie = requireFromApiWorkspace('@fastify/cookie') as import('fastify').FastifyPluginAsync;

interface StepResult {
  id: string;
  status: number;
  passed: true;
  details?: Record<string, unknown>;
}

function config(dataDir: string): AppConfig {
  return createScriptAppConfig({
    dataDir,
    registryId: 'proposal-lifecycle-registry',
    registryName: 'Proposal Lifecycle Registry',
    publicApiBaseUrl: 'https://proposal.example.com/api',
    jwtSecret: 'proposal-lifecycle-secret',
    proposalMaxFiles: 5,
    proposalMaxFileSizeBytes: 1024 * 1024,
    autoPublishExcludedCategories: ['security', 'network'],
  });
}

async function buildApp(dataDir: string) {
  const c = await buildContainer(config(dataDir));
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(multipart);
  const adminAuth = new SimpleAdminAuth(c.config);
  const agentAuth = new AgentApiAuth(c.config);
  registerSkillReadRoutes(app, c, agentAuth);
  registerProposalRoutes(app, c, agentAuth);
  registerAdminAuthRoutes(app, adminAuth);
  registerAdminProposalRoutes(app, c, adminAuth);
  registerAdminSkillRoutes(app, c, adminAuth);
  registerApiErrorHandler(app);
  return { app, container: c };
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
  const boundary = '----msh-proposal-lifecycle-boundary';
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

async function createFinalizedProposal(app: any, title: string, actor: string, skillId?: string): Promise<{ proposalId: string }> {
  const create = await app.inject({
    method: 'POST',
    url: '/proposals',
    headers: { 'x-actor': actor },
    payload: {
      ...(skillId ? { skillId } : {}),
      title,
      description: 'Deterministic secondary lifecycle proposal.',
      category: 'productivity',
      tags: ['proof'],
      capabilities: ['validate'],
      entrypoint: 'SKILL.md',
    },
  });
  assert(create.statusCode === 201, title + ' create status');
  const proposalId = json(create.payload).id as string;
  const upload = multipartPayload('SKILL.md', 'SKILL.md', 'text/markdown', '# ' + title + '\n\nLifecycle secondary proposal.');
  const uploaded = await app.inject({
    method: 'POST',
    url: '/proposals/' + proposalId + '/files',
    headers: { 'content-type': upload.contentType, 'x-actor': actor },
    payload: upload.payload,
  });
  assert(uploaded.statusCode === 200, title + ' upload status');
  const finalized = await app.inject({ method: 'POST', url: '/proposals/' + proposalId + '/finalize-upload', headers: { 'x-actor': actor } });
  assert(finalized.statusCode === 200, title + ' finalize status');
  return { proposalId };
}

async function createBrokenReferenceProposal(app: any): Promise<{ proposalId: string; finalizeStatus: number }> {
  const create = await app.inject({
    method: 'POST',
    url: '/proposals',
    headers: { 'x-actor': 'lifecycle-agent' },
    payload: {
      title: 'Broken Reference Lifecycle Skill',
      description: 'Contains a missing local reference.',
      category: 'productivity',
      tags: ['proof'],
      capabilities: ['validate'],
      entrypoint: 'SKILL.md',
    },
  });
  assert(create.statusCode === 201, 'broken reference proposal create status');
  const proposalId = json(create.payload).id as string;
  const upload = multipartPayload('SKILL.md', 'SKILL.md', 'text/markdown', '# Broken Reference\n\nSee [missing guide](docs/missing-guide.md).');
  const uploaded = await app.inject({
    method: 'POST',
    url: '/proposals/' + proposalId + '/files',
    headers: { 'content-type': upload.contentType, 'x-actor': 'lifecycle-agent' },
    payload: upload.payload,
  });
  assert(uploaded.statusCode === 200, 'broken reference upload status');
  const finalized = await app.inject({
    method: 'POST',
    url: '/proposals/' + proposalId + '/finalize-upload',
    headers: { 'x-actor': 'lifecycle-agent' },
  });
  assert(finalized.statusCode === 422, 'broken reference finalize must be blocked with 422');
  return { proposalId, finalizeStatus: finalized.statusCode };
}

async function main(): Promise<void> {
  const dataDir = path.resolve('.tmp/proposal-lifecycle-data');
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  const { app, container } = await buildApp(dataDir);
  const results: StepResult[] = [];

  await container.createSkill.createSkill({
    id: 'lifecycle-similar-skill',
    title: 'Lifecycle Proof Skill',
    description: 'Deterministic proposal lifecycle proof with similar metadata.',
    category: 'productivity',
    tags: ['proof'],
    capabilities: ['validate'],
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', role: 'entrypoint', content: Buffer.from('# Lifecycle Proof Skill\n\nSimilar duplicate fixture.'), mimeType: 'text/markdown' }],
  }, 'lifecycle-admin');
  await container.reviewSkill.submitForReview('lifecycle-similar-skill', '1.0.0', 'lifecycle-admin');
  await container.reviewSkill.approve('lifecycle-similar-skill', '1.0.0', 'lifecycle-admin');
  await container.reviewSkill.publish('lifecycle-similar-skill', '1.0.0', 'lifecycle-admin');
  await container.rebuildProjections.execute('lifecycle-admin', { clearProjections: true });

  const howTo = await app.inject({ method: 'GET', url: '/howToPropose' });
  assert(howTo.statusCode === 200, 'howToPropose status');
  assert(JSON.stringify(json(howTo.payload)).includes('finalize-upload'), 'howToPropose finalization guidance');
  results.push({ id: 'how-to-propose', status: howTo.statusCode, passed: true });

  const brokenReference = await createBrokenReferenceProposal(app);
  results.push({ id: 'broken-reference-finalize-blocked', status: brokenReference.finalizeStatus, passed: true, details: { proposalId: brokenReference.proposalId } });

  const duplicate = await app.inject({
    method: 'POST',
    url: '/proposals/check-duplicate',
    payload: {
      title: 'Lifecycle Proof Skill',
      description: 'Deterministic proposal lifecycle proof.',
      category: 'productivity',
      tags: ['proof'],
      files: [{ path: 'SKILL.md', sha256: 'sha-lifecycle' }],
    },
  });
  assert(duplicate.statusCode === 200, 'duplicate precheck status');
  const duplicateBody = json(duplicate.payload);
  assert(Array.isArray(duplicateBody.similarMatches) && duplicateBody.similarMatches.some((match: { kind: string; id: string }) => match.kind === 'skill' && match.id === 'lifecycle-similar-skill'), 'duplicate precheck must return deterministic similar skill candidate');
  results.push({ id: 'duplicate-precheck', status: duplicate.statusCode, passed: true, details: { similarMatches: duplicateBody.similarMatches.length } });

  const create = await app.inject({
    method: 'POST',
    url: '/proposals',
    headers: { 'x-actor': 'lifecycle-agent' },
    payload: {
      title: 'Lifecycle Proof Skill',
      description: 'Deterministic proposal lifecycle proof.',
      category: 'productivity',
      tags: ['proof'],
      capabilities: ['validate'],
      entrypoint: 'SKILL.md',
    },
  });
  assert(create.statusCode === 201, 'proposal create status');
  const created = json(create.payload);
  const proposalId = created.id as string;
  assert(proposalId && created.finalizeUploadUrl?.includes('/finalize-upload'), 'proposal create response');
  results.push({ id: 'create-proposal', status: create.statusCode, passed: true, details: { proposalId } });

  const crossActorUpdate = await app.inject({
    method: 'PATCH',
    url: '/proposals/' + proposalId,
    headers: { 'x-actor': 'other-agent' },
    payload: { title: 'Cross-actor overwrite attempt' },
  });
  assert(crossActorUpdate.statusCode === 403, 'cross-actor proposal update must be forbidden');
  assert(json(crossActorUpdate.payload).code === 'FORBIDDEN', 'cross-actor proposal error code');
  results.push({ id: 'cross-actor-update-blocked', status: crossActorUpdate.statusCode, passed: true });

  const blockedUpload = multipartPayload('node_modules/package/index.js', 'index.js', 'text/javascript', 'module.exports = {};');
  const blocked = await app.inject({
    method: 'POST',
    url: '/proposals/' + proposalId + '/files',
    headers: { 'content-type': blockedUpload.contentType, 'x-actor': 'lifecycle-agent' },
    payload: blockedUpload.payload,
  });
  assert(blocked.statusCode === 422, 'blocked upload status');
  results.push({ id: 'blocked-disallowed-path', status: blocked.statusCode, passed: true });

  const fileUpload = multipartPayload('SKILL.md', 'SKILL.md', 'text/markdown', '# Lifecycle Proof Skill\n\nUse this for deterministic validation.');
  const uploaded = await app.inject({
    method: 'POST',
    url: '/proposals/' + proposalId + '/files',
    headers: { 'content-type': fileUpload.contentType, 'x-actor': 'lifecycle-agent' },
    payload: fileUpload.payload,
  });
  assert(uploaded.statusCode === 200, 'file upload status');
  assert(json(uploaded.payload).files.some((file: { path: string }) => file.path === 'SKILL.md'), 'uploaded file path preserved');
  results.push({ id: 'upload-skill-file', status: uploaded.statusCode, passed: true });

  const openStatus = await app.inject({ method: 'GET', url: '/proposals/' + proposalId + '/status' });
  assert(openStatus.statusCode === 200, 'open status response');
  assert(json(openStatus.payload).finalizeRequired === true, 'open status finalizeRequired');
  results.push({ id: 'status-before-finalize', status: openStatus.statusCode, passed: true });

  const finalized = await app.inject({ method: 'POST', url: '/proposals/' + proposalId + '/finalize-upload', headers: { 'x-actor': 'lifecycle-agent' } });
  assert(finalized.statusCode === 200, 'finalize status');
  const finalizedBody = json(finalized.payload);
  assert(finalizedBody.uploadFinalized === true, 'finalize uploadFinalized');
  assert(finalizedBody.autoPublishStatus === 'disabled', 'auto publish disabled');
  results.push({ id: 'finalize-upload', status: finalized.statusCode, passed: true, details: { proposalStatus: finalizedBody.status } });

  const finalStatus = await app.inject({ method: 'GET', url: '/proposals/' + proposalId + '/status' });
  assert(finalStatus.statusCode === 200, 'final public status response');
  const finalStatusBody = json(finalStatus.payload);
  assert(finalStatusBody.finalizeRequired === false, 'final status finalizeRequired false');
  assert(finalStatusBody.latestJudgementRisk === 'no_judge_available', 'noop judgement public status');
  results.push({ id: 'status-after-finalize', status: finalStatus.statusCode, passed: true, details: { latestJudgementRisk: finalStatusBody.latestJudgementRisk } });

  const login = await app.inject({
    method: 'POST',
    url: '/admin/login',
    payload: { username: 'admin', password: 'admin' },
  });
  assert(login.statusCode === 200, `admin login status ${login.statusCode}: ${login.payload}`);
  const adminCookie = cookieHeader(login.headers['set-cookie']);
  results.push({ id: 'admin-login', status: login.statusCode, passed: true });

  const detail = await app.inject({ method: 'GET', url: '/admin/proposals/' + proposalId, headers: { cookie: adminCookie } });
  assert(detail.statusCode === 200, 'admin detail status');
  const detailBody = json(detail.payload);
  assert(detailBody.files.some((file: { path: string }) => file.path === 'SKILL.md'), 'admin detail file list');
  assert(detailBody.judgements.length >= 2, 'finalization must create proposal and file judgements');
  results.push({ id: 'admin-proposal-detail', status: detail.statusCode, passed: true, details: { judgements: detailBody.judgements.length } });

  const convert = await app.inject({
    method: 'POST',
    url: '/admin/proposals/' + proposalId + '/convert',
    headers: { cookie: adminCookie },
    payload: { comment: 'Deterministic lifecycle conversion.' },
  });
  assert(convert.statusCode === 200, 'admin convert status');
  const converted = json(convert.payload);
  assert(converted.id === 'lifecycle-proof-skill', 'converted skill id');
  results.push({ id: 'admin-convert-to-draft-skill', status: convert.statusCode, passed: true, details: { skillId: converted.id } });

  const publicConverted = await app.inject({ method: 'GET', url: '/skills/lifecycle-proof-skill' });
  assert(publicConverted.statusCode === 404, 'converted draft must not be public');
  results.push({ id: 'converted-draft-not-public', status: publicConverted.statusCode, passed: true });

  const submitSkill = await app.inject({ method: 'POST', url: '/admin/skills/lifecycle-proof-skill/submit-review?version=1.0.0', headers: { cookie: adminCookie } });
  assert(submitSkill.statusCode === 200, 'converted skill submit review status');
  const approveSkill = await app.inject({ method: 'POST', url: '/admin/skills/lifecycle-proof-skill/approve?version=1.0.0', headers: { cookie: adminCookie } });
  assert(approveSkill.statusCode === 200, 'converted skill approve status');
  const publishSkill = await app.inject({ method: 'POST', url: '/admin/skills/lifecycle-proof-skill/publish?version=1.0.0', headers: { cookie: adminCookie } });
  assert(publishSkill.statusCode === 200, 'converted skill publish status');
  const publicPublished = await app.inject({ method: 'GET', url: '/skills/lifecycle-proof-skill' });
  assert(publicPublished.statusCode === 200, 'published converted skill must be public');
  results.push({ id: 'admin-publish-converted-skill', status: publishSkill.statusCode, passed: true });

  const rejectedProposal = await createFinalizedProposal(app, 'Lifecycle Reject Skill', 'lifecycle-agent');
  const reject = await app.inject({ method: 'POST', url: '/admin/proposals/' + rejectedProposal.proposalId + '/reject', headers: { cookie: adminCookie }, payload: { reason: 'Lifecycle proof rejection.' } });
  assert(reject.statusCode === 200, 'admin reject status');
  results.push({ id: 'admin-reject-proposal', status: reject.statusCode, passed: true, details: { proposalId: rejectedProposal.proposalId } });

  const abandonedUpload = await app.inject({
    method: 'POST',
    url: '/proposals',
    headers: { 'x-actor': 'abandoned-upload-agent' },
    payload: {
      title: 'Abandoned Lifecycle Upload',
      description: 'Open upload created for deterministic administrative cleanup.',
      category: 'productivity',
    },
  });
  assert(abandonedUpload.statusCode === 201, 'abandoned proposal create status');
  const abandonedProposalId = json(abandonedUpload.payload).id as string;
  const deleteAbandoned = await app.inject({ method: 'DELETE', url: '/admin/proposals/' + abandonedProposalId, headers: { cookie: adminCookie } });
  assert(deleteAbandoned.statusCode === 204, 'admin must be able to delete an abandoned open upload');
  results.push({ id: 'admin-delete-open-upload', status: deleteAbandoned.statusCode, passed: true });

  const deleteConverted = await app.inject({ method: 'DELETE', url: '/admin/proposals/' + proposalId, headers: { cookie: adminCookie } });
  assert(deleteConverted.statusCode === 409 || deleteConverted.statusCode === 422, 'delete converted proposal must be blocked by state');
  results.push({ id: 'admin-delete-disallowed-state-blocked', status: deleteConverted.statusCode, passed: true });

  await app.close();

  const report = {
    name: 'proposal-lifecycle',
    totalSteps: results.length,
    passedSteps: results.length,
    failedSteps: 0,
    dataDir,
    results,
  };
  const lines = [
    'proposal-lifecycle',
    'totalSteps=' + report.totalSteps,
    'passedSteps=' + report.passedSteps,
    'failedSteps=' + report.failedSteps,
    ...results.map((result) => 'PASS ' + result.id + ' status=' + result.status),
    'RESULT=PASS',
  ];

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/proposal-lifecycle.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/proposal-lifecycle.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
