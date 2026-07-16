#!/usr/bin/env tsx
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContainer, type Container } from '../apps/api/src/infrastructure/container';
import { AgentApiAuth } from '../apps/api/src/adapters/inbound/http/agent-api-auth';
import { registerApiErrorHandler } from '../apps/api/src/adapters/inbound/http/error-response';
import { registerSkillReadRoutes } from '../apps/api/src/adapters/inbound/http/skill-read.controller';
import type { CatalogProvider, SearchProvider } from '../apps/api/src/infrastructure/config';
import { createScriptAppConfig } from './script-app-config';

const requireFromScript = createRequire(import.meta.url);
const Fastify = requireFromScript('fastify') as typeof import('fastify');
type FastifyInstance = import('fastify').FastifyInstance;

type ProviderStage = 'sqlite-baseline' | 'mysql-cutover' | 'mysql-new-writes' | 'sqlite-rollback';

interface SurfaceSkill {
  id: string;
  title: string;
  version: string | null;
  category: string;
  tags: string[];
}

interface PublicSurface {
  stage: ProviderStage;
  skills: SurfaceSkill[];
  search: SurfaceSkill[];
  categories: string[];
  tags: string[];
  manifest: { id: string; version: string; status: string; files: string[] };
  files: string[];
  packageEntries: string[];
  packageContentType: string;
  skillFileContainsFixture: boolean;
  rebuild: { skills: number; proposals: number; publishedVersions: number };
}

interface StageResult {
  stage: ProviderStage;
  catalogProvider: CatalogProvider;
  searchProvider: SearchProvider;
  checks: Record<string, boolean>;
  surface: PublicSurface;
}

const actor = 'provider-cutover-proof';
const baseSkillId = 'provider-cutover-baseline-skill';
const newSkillId = 'provider-cutover-new-write-skill';
const baseFixtureText = 'Provider cutover baseline deterministic fixture body';
const newFixtureText = 'Provider cutover new MySQL write deterministic fixture body';

function mysqlConfig() {
  return {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 33307),
    database: process.env.MYSQL_DATABASE ?? 'managed_skill_hub',
    user: process.env.MYSQL_USER ?? 'managed_skill_hub',
    password: process.env.MYSQL_PASSWORD ?? 'valpass',
  };
}

function config(dataDir: string, catalogProvider: CatalogProvider, searchProvider: SearchProvider) {
  const mysql = mysqlConfig();
  return createScriptAppConfig({
    dataDir,
    registryId: 'provider-cutover-registry',
    registryName: 'Provider Cutover Registry',
    publicApiBaseUrl: 'https://provider-cutover.example.com/api',
    jwtSecret: 'provider-cutover-secret',
    catalogProvider,
    searchProvider,
    mysqlHost: mysql.host,
    mysqlPort: mysql.port,
    mysqlDatabase: mysql.database,
    mysqlUser: mysql.user,
    mysqlPassword: mysql.password,
    mysqlSslMode: 'disabled',
    proposalMaxFiles: 5,
    proposalMaxFileSizeBytes: 1024 * 1024,
  });
}

async function buildApp(container: Container): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerSkillReadRoutes(app, container, new AgentApiAuth(container.config));
  registerApiErrorHandler(app);
  return app;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseJson(payload: string): any { return JSON.parse(payload); }
function responseBuffer(response: { rawPayload?: Buffer; body: string | Buffer }): Buffer {
  if (Buffer.isBuffer(response.rawPayload)) return response.rawPayload;
  if (Buffer.isBuffer(response.body)) return response.body;
  return Buffer.from(response.body, 'binary');
}

function zipEntries(input: Buffer | Uint8Array): string[] {
  const buffer = Buffer.from(input);
  const entries: string[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    entries.push(buffer.subarray(nameStart, nameEnd).toString('utf8'));
    offset = nameEnd + extraLength + compressedSize;
  }
  return entries.sort();
}

function normalizeSummaryItems(payload: any): SurfaceSkill[] {
  return (payload.items ?? [])
    .map((item: any) => ({
      id: item.id,
      title: item.title,
      version: item.version ?? item.latestPublishedVersion ?? null,
      category: item.category,
      tags: [...(item.tags ?? [])].sort(),
    }))
    .sort((left: SurfaceSkill, right: SurfaceSkill) => left.id.localeCompare(right.id));
}

async function publishSkill(container: Container, skillId: string, title: string, fixtureText: string): Promise<void> {
  await container.createSkill.createSkill({
    id: skillId,
    title,
    description: 'Deterministic provider cutover proof fixture.',
    category: 'provider-cutover',
    tags: ['provider-cutover', skillId.includes('new-write') ? 'mysql-write' : 'baseline'],
    capabilities: ['provider-cutover'],
    entrypoint: 'SKILL.md',
    files: [
      {
        path: 'SKILL.md',
        role: 'entrypoint',
        content: Buffer.from('# ' + title + '\n\n' + fixtureText + '\n'),
        mimeType: 'text/markdown',
      },
      {
        path: 'docs/guide.md',
        role: 'attachment',
        content: Buffer.from('# Cutover Guide\n\nThis file makes package downloads deterministic ZIPs.\n'),
        mimeType: 'text/markdown',
      },
    ],
  }, actor);
  await container.reviewSkill.submitForReview(skillId, '1.0.0', actor);
  await container.reviewSkill.approve(skillId, '1.0.0', actor);
  await container.reviewSkill.publish(skillId, '1.0.0', actor);
}

async function createProposal(container: Container): Promise<string> {
  const proposal = await container.proposalCommand.submitProposal({
    skillId: 'provider-cutover-proposed-skill',
    title: 'Provider Cutover Proposal',
    description: 'Proposal fixture used to verify proposal projection survives provider cutover rebuilds.',
    category: 'provider-cutover',
    tags: ['provider-cutover', 'proposal'],
    capabilities: ['provider-cutover'],
    entrypoint: 'SKILL.md',
  }, actor);
  await container.proposalCommand.attachFile(proposal.id, {
    path: 'SKILL.md',
    content: Buffer.from('# Provider Cutover Proposal\n\nProposal fixture.\n'),
    mimeType: 'text/markdown',
  }, actor);
  await container.proposalCommand.finalizeUpload(proposal.id, actor);
  return proposal.id;
}

async function collectSurface(app: FastifyInstance, stage: ProviderStage, rebuild: { skills: number; proposals: number; publishedVersions: number }, skillId: string, expectedText: string): Promise<PublicSurface> {
  const skills = await app.inject({ method: 'GET', url: '/skills?limit=20' });
  const search = await app.inject({ method: 'GET', url: '/skills/search?q=Provider%20Cutover&mode=keyword&limit=20' });
  const categories = await app.inject({ method: 'GET', url: '/categories' });
  const tags = await app.inject({ method: 'GET', url: '/tags' });
  const manifest = await app.inject({ method: 'GET', url: '/skills/' + skillId + '/manifest?version=1.0.0' });
  const files = await app.inject({ method: 'GET', url: '/skills/' + skillId + '/files?version=1.0.0' });
  const skillFile = await app.inject({ method: 'GET', url: '/skills/' + skillId + '/files/SKILL.md?version=1.0.0' });
  const pkg = await app.inject({ method: 'GET', url: '/skills/' + skillId + '/package?version=1.0.0' });
  for (const [name, response] of Object.entries({ skills, search, categories, tags, manifest, files, skillFile, pkg })) {
    assert(response.statusCode === 200, stage + ' ' + name + ' status must be 200, got ' + response.statusCode + ': ' + response.payload);
  }
  const manifestPayload = parseJson(manifest.payload);
  const filesPayload = parseJson(files.payload);
  return {
    stage,
    skills: normalizeSummaryItems(parseJson(skills.payload)),
    search: normalizeSummaryItems(parseJson(search.payload)),
    categories: [...(parseJson(categories.payload).items ?? [])].sort(),
    tags: [...(parseJson(tags.payload).items ?? [])].sort(),
    manifest: {
      id: manifestPayload.id,
      version: manifestPayload.version,
      status: manifestPayload.status,
      files: (manifestPayload.files ?? []).map((file: { path: string }) => file.path).sort(),
    },
    files: (filesPayload.items ?? []).map((file: { path: string }) => file.path).sort(),
    packageEntries: zipEntries(responseBuffer(pkg)),
    packageContentType: String(pkg.headers['content-type'] ?? ''),
    skillFileContainsFixture: skillFile.payload.includes(expectedText),
    rebuild,
  };
}

function assertSurface(surface: PublicSurface, expectedSkillIds: string[], expectedProposals: number): Record<string, boolean> {
  const checks: Record<string, boolean> = {
    expectedSkillsVisible: expectedSkillIds.every((skillId) => surface.skills.some((skill) => skill.id === skillId && skill.version === '1.0.0')),
    expectedSkillsSearchable: expectedSkillIds.every((skillId) => surface.search.some((skill) => skill.id === skillId && skill.version === '1.0.0')),
    categoryVisible: surface.categories.includes('provider-cutover'),
    tagsVisible: surface.tags.includes('provider-cutover'),
    manifestExactVersion: surface.manifest.version === '1.0.0' && surface.manifest.status === 'published',
    filesMatch: sameStringArray(surface.files, ['SKILL.md', 'docs/guide.md']),
    packageEntriesMatch: sameStringArray(surface.packageEntries, ['SKILL.md', 'docs/guide.md']),
    fileContentMatchesFixture: surface.skillFileContainsFixture,
    rebuildCountsMatch: surface.rebuild.skills === expectedSkillIds.length && surface.rebuild.publishedVersions === expectedSkillIds.length && surface.rebuild.proposals === expectedProposals,
  };
  for (const [name, passed] of Object.entries(checks)) assert(passed, surface.stage + ' check failed: ' + name);
  return checks;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function comparable(surface: PublicSurface): Omit<PublicSurface, 'stage' | 'packageContentType' | 'rebuild'> {
  return {
    skills: surface.skills,
    search: surface.search,
    categories: surface.categories,
    tags: surface.tags,
    manifest: surface.manifest,
    files: surface.files,
    packageEntries: surface.packageEntries,
    skillFileContainsFixture: surface.skillFileContainsFixture,
  };
}

async function assertParity(left: PublicSurface, right: PublicSurface, id: string): Promise<void> {
  const expected = comparable(left);
  const actual = comparable(right);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    await mkdir('.tmp', { recursive: true });
    await writeFile('.tmp/provider-cutover-mismatch-' + id + '.json', JSON.stringify({ id, expected, actual }, null, 2) + '\n');
    throw new Error('Provider cutover parity failed for ' + id + '; see .tmp/provider-cutover-mismatch-' + id + '.json');
  }
}

async function assertRestartScriptGuidance(): Promise<void> {
  const restartAll = await readFile('scripts/restart-all.sh', 'utf8');
  assert(restartAll.includes('ensure_local_mysql_or_fail'), 'restart-all must include MySQL startup/preflight');
  assert(restartAll.includes('start-mysql-stack.sh') && restartAll.includes(' up'), 'restart-all must start local MySQL stack automatically');
}

async function withContainer<T>(dataDir: string, catalogProvider: CatalogProvider, searchProvider: SearchProvider, handler: (container: Container, app: FastifyInstance) => Promise<T>): Promise<T> {
  const container = await buildContainer(config(dataDir, catalogProvider, searchProvider));
  const app = await buildApp(container);
  try {
    return await handler(container, app);
  } finally {
    await app.close();
    await container.shutdown();
  }
}

async function main(): Promise<void> {
  await mkdir('.tmp', { recursive: true });
  await assertRestartScriptGuidance();
  const dataDir = path.resolve('.tmp/provider-cutover-data');
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  let proposalId = '';
  const results: StageResult[] = [];

  const sqliteBaseline = await withContainer(dataDir, 'sqlite', 'sqlite', async (container, app) => {
    await publishSkill(container, baseSkillId, 'Provider Cutover Baseline Skill', baseFixtureText);
    proposalId = await createProposal(container);
    const rebuild = await container.rebuildProjections.execute(actor, { clearProjections: true });
    const surface = await collectSurface(app, 'sqlite-baseline', rebuild, baseSkillId, baseFixtureText);
    const checks = assertSurface(surface, [baseSkillId], 1);
    results.push({ stage: 'sqlite-baseline', catalogProvider: 'sqlite', searchProvider: 'sqlite', checks, surface });
    return surface;
  });

  const backupEvidence = {
    dataDir,
    proposalId,
    baselineSkillId: baseSkillId,
    capturedBeforeCutover: true,
  };
  await writeFile('.tmp/provider-cutover-backup-evidence.json', JSON.stringify(backupEvidence, null, 2) + '\n');

  const mysqlCutover = await withContainer(dataDir, 'mysql', 'mysql', async (container, app) => {
    const rebuild = await container.rebuildProjections.execute(actor, { clearProjections: true });
    const surface = await collectSurface(app, 'mysql-cutover', rebuild, baseSkillId, baseFixtureText);
    const checks = assertSurface(surface, [baseSkillId], 1);
    results.push({ stage: 'mysql-cutover', catalogProvider: 'mysql', searchProvider: 'mysql', checks, surface });
    return surface;
  });
  await assertParity(sqliteBaseline, mysqlCutover, 'sqlite-to-mysql');

  const mysqlAfterWrite = await withContainer(dataDir, 'mysql', 'mysql', async (container, app) => {
    await publishSkill(container, newSkillId, 'Provider Cutover New Write Skill', newFixtureText);
    const rebuild = await container.rebuildProjections.execute(actor, { clearProjections: true });
    const surface = await collectSurface(app, 'mysql-new-writes', rebuild, newSkillId, newFixtureText);
    const checks = assertSurface(surface, [baseSkillId, newSkillId], 1);
    results.push({ stage: 'mysql-new-writes', catalogProvider: 'mysql', searchProvider: 'mysql', checks, surface });
    return surface;
  });

  const sqliteRollback = await withContainer(dataDir, 'sqlite', 'sqlite', async (container, app) => {
    const rebuild = await container.rebuildProjections.execute(actor, { clearProjections: true });
    const surface = await collectSurface(app, 'sqlite-rollback', rebuild, newSkillId, newFixtureText);
    const checks = assertSurface(surface, [baseSkillId, newSkillId], 1);
    results.push({ stage: 'sqlite-rollback', catalogProvider: 'sqlite', searchProvider: 'sqlite', checks, surface });
    return surface;
  });
  await assertParity(mysqlAfterWrite, sqliteRollback, 'mysql-to-sqlite-rollback');

  const report = {
    name: 'provider-cutover',
    stages: results.length,
    proposalId,
    checks: {
      sqliteToMysqlParity: true,
      mysqlNewWritesVisible: true,
      mysqlToSqliteRollbackParity: true,
      restartScriptStartsMysql: true,
      backupEvidenceWritten: true,
    },
    results,
  };
  const lines = [
    'provider-cutover',
    'stages=' + results.length,
    'proposalId=' + proposalId,
    ...results.map((result) => 'PASS ' + result.stage + ' catalog=' + result.catalogProvider + ' search=' + result.searchProvider + ' checks=' + Object.keys(result.checks).length),
    'RESULT=PASS',
  ];
  await writeFile('.tmp/provider-cutover.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/provider-cutover.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  process.exit(0);
}

main().catch(async (error) => {
  await mkdir('.tmp', { recursive: true });
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await writeFile('.tmp/provider-cutover.log', 'provider-cutover\nRESULT=FAIL\n' + message + '\n');
  await writeFile('.tmp/provider-cutover.json', JSON.stringify({ name: 'provider-cutover', error: message }, null, 2) + '\n');
  console.error('RESULT=FAIL');
  console.error(message);
  process.exit(1);
});
