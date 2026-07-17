import { createRequire } from 'node:module';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { Proposal, ProposalFile } from '../../apps/api/src/domain/proposal/Proposal';
import { buildContainer } from '../../apps/api/src/infrastructure/container';
import { registerProposalRoutes } from '../../apps/api/src/adapters/inbound/http/proposal.controller';
import { normalizeRelativeArtifactPath } from '../../apps/api/src/domain/files/relative-artifact-path';
import { AgentApiAuth } from '../../apps/api/src/adapters/inbound/http/agent-api-auth';
import { registerApiErrorHandler } from '../../apps/api/src/adapters/inbound/http/error-response';
import { registerSkillReadRoutes } from '../../apps/api/src/adapters/inbound/http/skill-read.controller';
import type { AppConfig } from '../../apps/api/src/infrastructure/config';
import type { Container } from '../../apps/api/src/infrastructure/container';
import { createScriptAppConfig } from '../lib/script-app-config';

const requireFromScript = createRequire(import.meta.url);
const Fastify = requireFromScript('fastify') as typeof import('fastify');
const multipart = requireFromScript('@fastify/multipart') as typeof import('@fastify/multipart');

interface CheckResult {
  id: string;
  detail: string;
  result: 'PASS';
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isInvalidStateError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'InvalidStateError' || error.message.includes('Cannot '));
}

async function checkProposalStateGuards(): Promise<CheckResult[]> {
  const proposal = Proposal.create({
    id: 'proposal-concurrency-proof',
    title: 'Concurrency Proof',
    description: 'Validates repeated proposal state transitions.',
    category: 'testing',
    entrypoint: 'SKILL.md',
    submittedBy: 'agent:proof',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }).addFile(ProposalFile.create({
    id: 'SKILL.md',
    path: 'SKILL.md',
    mimeType: 'text/markdown',
    sizeBytes: 32,
    sha256: 'sha256-concurrency',
  }));

  const finalized = proposal.finalizeUpload();
  let doubleFinalizeBlocked = false;
  try {
    finalized.finalizeUpload();
  } catch (error) {
    doubleFinalizeBlocked = isInvalidStateError(error);
  }
  assert(doubleFinalizeBlocked, 'finalizeUpload must reject repeated finalization');

  let uploadAfterFinalizeBlocked = false;
  try {
    finalized.addFile(ProposalFile.create({
      id: 'extra.md',
      path: 'extra.md',
      mimeType: 'text/markdown',
      sizeBytes: 12,
      sha256: 'sha256-extra',
    }));
  } catch (error) {
    uploadAfterFinalizeBlocked = isInvalidStateError(error);
  }
  assert(uploadAfterFinalizeBlocked, 'addFile must reject uploads after finalization');

  const approved = finalized.approve();
  const converted = approved.convert();
  let doubleConvertBlocked = false;
  try {
    converted.convert();
  } catch (error) {
    doubleConvertBlocked = isInvalidStateError(error);
  }
  assert(doubleConvertBlocked, 'convert must reject repeated conversion');

  return [
    { id: 'double-finalize-blocked', detail: 'InvalidStateError', result: 'PASS' },
    { id: 'upload-after-finalize-blocked', detail: 'InvalidStateError', result: 'PASS' },
    { id: 'double-convert-blocked', detail: 'InvalidStateError', result: 'PASS' },
  ];
}

function checkPathNormalizer(): CheckResult[] {
  const invalid = ['../secret.txt', './SKILL.md', '/absolute/SKILL.md', String.raw`C:\temp\SKILL.md`, String.raw`\\server\share\SKILL.md`];
  for (const path of invalid) {
    let blocked = false;
    try {
      normalizeRelativeArtifactPath(path);
    } catch {
      blocked = true;
    }
    assert(blocked, 'path normalizer must reject ' + path);
  }
  const normalized = normalizeRelativeArtifactPath('scripts\\nested//run.py');
  assert(normalized === 'scripts/nested/run.py', 'path normalizer must normalize valid separators');
  return [
    { id: 'path-traversal-blocked', detail: invalid.join(','), result: 'PASS' },
    { id: 'valid-path-normalized', detail: normalized, result: 'PASS' },
  ];
}

function config(dataDir = '.tmp/concurrency-abuse-data', maxFiles = 30, maxFileSizeBytes = 10 * 1024 * 1024): AppConfig {
  return createScriptAppConfig({
    registryId: 'abuse-proof-registry',
    registryName: 'Abuse Proof Registry',
    publicApiBaseUrl: 'https://abuse.example.com/api',
    openapiYamlPath: 'packages/openapi/skill-registry.openapi.yaml',
    dataDir,
    jwtSecret: 'concurrency-abuse-secret',
    autoPublishExcludedCategories: ['security'],
    proposalMaxFiles: maxFiles,
    proposalMaxFileSizeBytes: maxFileSizeBytes,
    proposalDisallowedPaths: ['node_modules/'],
  });
}

function unsafePackageContainer(): Container {
  const c = config();
  return {
    config: c,
    nameSuggestion: {} as Container['nameSuggestion'],
    skillQuery: {
      getManifest: async () => ({
        id: 'unsafe-package-skill',
        name: 'Unsafe Package Skill',
        title: 'Unsafe Package Skill',
        description: 'Adapter returned an unsafe path.',
        version: '1.0.0',
        status: 'published',
        entrypoint: 'SKILL.md',
        category: 'testing',
        tags: [],
        capabilities: [],
        useWhen: [],
        doNotUseWhen: [],
        files: [],
        manifestChecksum: 'checksum',
      } as never),
      listFiles: async () => [{
        id: '../evil.txt',
        artifactId: 'evil',
        path: '../evil.txt',
        role: 'support',
        mimeType: 'text/plain',
        sizeBytes: 4,
        sha256: 'evil',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        extractable: true,
      }],
      getFile: async () => ({ path: '../evil.txt', mimeType: 'text/plain', content: Buffer.from('evil') }),
      listCategories: async () => [],
      listTags: async () => [],
    } as unknown as Container['skillQuery'],
  } as Container;
}

function multipartPayload(pathValue: string, filename: string, contentType: string, content: string) {
  const boundary = '----msh-concurrency-abuse-boundary-' + Math.random().toString(36).slice(2);
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

async function buildProposalHttpApp(dataDir: string, maxFiles: number, maxFileSizeBytes: number) {
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  const container = await buildContainer(config(dataDir, maxFiles, maxFileSizeBytes));
  const app = Fastify({ logger: false });
  await app.register(multipart);
  registerProposalRoutes(app, container, new AgentApiAuth(container.config));
  registerApiErrorHandler(app);
  return { app, container };
}

async function createProposal(app: any, title: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/proposals',
    payload: {
      title,
      description: 'HTTP boundary proof proposal.',
      category: 'testing',
      tags: ['abuse'],
      capabilities: ['validate'],
      entrypoint: 'SKILL.md',
    },
  });
  assert(response.statusCode === 201, title + ' create status');
  return JSON.parse(response.payload).id as string;
}

async function checkHttpUploadBoundaries(): Promise<CheckResult[]> {
  const duplicateDataDir = '.tmp/concurrency-abuse-duplicate-data';
  const duplicateApp = await buildProposalHttpApp(duplicateDataDir, 3, 1024);
  const duplicateProposalId = await createProposal(duplicateApp.app, 'Duplicate Upload Boundary Skill');
  const first = multipartPayload('SKILL.md', 'SKILL.md', 'text/markdown', '# First\n');
  const firstResponse = await duplicateApp.app.inject({ method: 'POST', url: '/proposals/' + duplicateProposalId + '/files', headers: { 'content-type': first.contentType }, payload: first.payload });
  assert(firstResponse.statusCode === 200, 'first duplicate upload status');
  const second = multipartPayload('SKILL.md', 'SKILL.md', 'text/markdown', '# Second\n');
  const secondResponse = await duplicateApp.app.inject({ method: 'POST', url: '/proposals/' + duplicateProposalId + '/files', headers: { 'content-type': second.contentType }, payload: second.payload });
  assert(secondResponse.statusCode === 200, 'same-path upload must replace file while in_upload: ' + secondResponse.statusCode + ' ' + secondResponse.payload);
  const duplicateFiles = JSON.parse(secondResponse.payload).files as Array<{ path: string; sizeBytes: number }>;
  assert(duplicateFiles.length === 1, 'same-path replacement must keep one proposal file');
  assert(duplicateFiles[0]?.path === 'SKILL.md', 'same-path replacement must preserve relative path');
  assert(duplicateFiles[0]?.sizeBytes === 9, 'same-path replacement must expose replacement metadata');
  const finalizeDuplicate = await duplicateApp.app.inject({ method: 'POST', url: '/proposals/' + duplicateProposalId + '/finalize-upload' });
  assert(finalizeDuplicate.statusCode === 200, 'proposal remains finalizable after same-path replacement');
  await duplicateApp.app.close();

  const limitDataDir = '.tmp/concurrency-abuse-limit-data';
  const limitApp = await buildProposalHttpApp(limitDataDir, 1, 24);
  const limitProposalId = await createProposal(limitApp.app, 'Upload Limit Boundary Skill');
  const ok = multipartPayload('SKILL.md', 'SKILL.md', 'text/markdown', '# ok\n');
  const okResponse = await limitApp.app.inject({ method: 'POST', url: '/proposals/' + limitProposalId + '/files', headers: { 'content-type': ok.contentType }, payload: ok.payload });
  assert(okResponse.statusCode === 200, 'first limit upload status');
  const extra = multipartPayload('docs/extra.md', 'extra.md', 'text/markdown', '# extra\n');
  const extraResponse = await limitApp.app.inject({ method: 'POST', url: '/proposals/' + limitProposalId + '/files', headers: { 'content-type': extra.contentType }, payload: extra.payload });
  assert(extraResponse.statusCode === 422, 'file count boundary must return 422');
  assert(JSON.parse(extraResponse.payload).code === 'PROPOSAL_FILE_LIMIT_EXCEEDED', 'file count boundary code');

  const sizeProposalId = await createProposal(limitApp.app, 'Upload Size Boundary Skill');
  const tooLarge = multipartPayload('SKILL.md', 'SKILL.md', 'text/markdown', 'x'.repeat(64));
  const tooLargeResponse = await limitApp.app.inject({ method: 'POST', url: '/proposals/' + sizeProposalId + '/files', headers: { 'content-type': tooLarge.contentType }, payload: tooLarge.payload });
  assert(tooLargeResponse.statusCode === 413, 'file size boundary must return 413, got ' + tooLargeResponse.statusCode + ': ' + tooLargeResponse.payload);
  await limitApp.app.close();

  return [
    { id: 'same-path-file-upload-replaces-cleanly', detail: 'same path replaced with HTTP 200 and proposal remains finalizable', result: 'PASS' },
    { id: 'http-file-count-limit-enforced', detail: 'HTTP 422 PROPOSAL_FILE_LIMIT_EXCEEDED', result: 'PASS' },
    { id: 'http-file-size-limit-enforced', detail: 'HTTP 413', result: 'PASS' },
  ];
}

async function checkConcurrentProjectionRebuild(): Promise<CheckResult> {
  const dataDir = '.tmp/concurrency-abuse-rebuild-data';
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  const container = await buildContainer(config(dataDir, 30, 1024 * 1024));
  await container.createSkill.createSkill({
    id: 'concurrency-rebuild-skill',
    title: 'Concurrency Rebuild Skill',
    description: 'Projection rebuild concurrency proof.',
    category: 'testing',
    tags: ['abuse'],
    capabilities: ['validate'],
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', role: 'entrypoint', content: Buffer.from('# Rebuild\n'), mimeType: 'text/markdown' }],
  }, 'admin');
  await container.reviewSkill.submitForReview('concurrency-rebuild-skill', '1.0.0', 'admin');
  await container.reviewSkill.approve('concurrency-rebuild-skill', '1.0.0', 'admin');
  await container.reviewSkill.publish('concurrency-rebuild-skill', '1.0.0', 'admin');
  const [left, right] = await Promise.all([
    container.rebuildProjections.execute('admin', { clearProjections: true }),
    container.rebuildProjections.execute('admin', { clearProjections: true }),
  ]);
  assert(left.publishedVersions === 1 && right.publishedVersions === 1, 'concurrent rebuild published version counts');
  const categories = await container.skillQuery.listCategories();
  assert(categories.includes('testing'), 'concurrent rebuild must leave queryable projections');
  return { id: 'concurrent-projection-rebuild-stable', detail: 'two concurrent clear rebuilds preserve published projection', result: 'PASS' };
}

async function checkUnsafePackageDownload(): Promise<CheckResult> {
  const app = Fastify({ logger: false });
  const c = unsafePackageContainer();
  registerSkillReadRoutes(app, c, new AgentApiAuth(c.config));
  registerApiErrorHandler(app);
  const response = await app.inject({ method: 'GET', url: '/skills/unsafe-package-skill/package' });
  await app.close();
  assert(response.statusCode === 422, 'unsafe package path must be rejected with 422, got ' + response.statusCode);
  const payload = JSON.parse(response.payload);
  assert(payload.code === 'VALIDATION_ERROR', 'unsafe package path must return validation error');
  return { id: 'unsafe-package-path-rejected', detail: 'HTTP 422 VALIDATION_ERROR', result: 'PASS' };
}

async function main(): Promise<void> {
  const results: CheckResult[] = [
    ...(await checkProposalStateGuards()),
    ...checkPathNormalizer(),
    ...(await checkHttpUploadBoundaries()),
    await checkConcurrentProjectionRebuild(),
    await checkUnsafePackageDownload(),
  ];

  const report = {
    name: 'concurrency-abuse',
    totalChecks: results.length,
    passedChecks: results.length,
    failedChecks: 0,
    results,
  };
  const lines = [
    'concurrency-abuse',
    'totalChecks=' + report.totalChecks,
    'passedChecks=' + report.passedChecks,
    'failedChecks=' + report.failedChecks,
    ...results.map((result) => 'PASS ' + result.id + ' detail=' + JSON.stringify(result.detail)),
    'RESULT=PASS',
  ];

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/concurrency-abuse.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/concurrency-abuse.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
