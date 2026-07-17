import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContainer } from '../../apps/api/src/infrastructure/container';
import { AgentApiAuth } from '../../apps/api/src/adapters/inbound/http/agent-api-auth';
import { registerApiErrorHandler } from '../../apps/api/src/adapters/inbound/http/error-response';
import { registerSkillReadRoutes } from '../../apps/api/src/adapters/inbound/http/skill-read.controller';
import type { CatalogProvider, SearchProvider } from '../../apps/api/src/infrastructure/config';
import type { Container } from '../../apps/api/src/infrastructure/container';
import { createScriptAppConfig } from '../lib/script-app-config';

const requireFromScript = createRequire(import.meta.url);
const Fastify = requireFromScript('fastify') as typeof import('fastify');

type FastifyInstance = import('fastify').FastifyInstance;
type ProviderCaseId = 'sqlite-sqlite' | 'mysql-mysql' | 'sqlite-mysql' | 'mysql-sqlite';

interface ProviderCase { id: ProviderCaseId; catalogProvider: CatalogProvider; searchProvider: SearchProvider; requiresMysql: boolean; }
interface CaseResult { id: ProviderCaseId; catalogProvider: CatalogProvider; searchProvider: SearchProvider; checks: Record<string, boolean>; normalized: NormalizedPublicSurface; result: 'PASS'; }
interface NormalizedPublicSurface {
  discoverEntrypoints: string[];
  skills: Array<{ id: string; title: string; version: string | null; category: string; tags: string[] }>;
  search: Array<{ id: string; title: string; version: string | null; category: string; tags: string[] }>;
  categories: string[];
  tags: string[];
  manifest: { id: string; title: string; version: string; status: string; entrypoint: string; files: string[] };
  files: string[];
  skillFileContainsFixture: boolean;
  packageContentType: string;
  packageEntries: string[];
  rebuild: { skills: number; proposals: number; publishedVersions: number };
}

const allCases: ProviderCase[] = [
  { id: 'sqlite-sqlite', catalogProvider: 'sqlite', searchProvider: 'sqlite', requiresMysql: false },
  { id: 'mysql-mysql', catalogProvider: 'mysql', searchProvider: 'mysql', requiresMysql: true },
  { id: 'sqlite-mysql', catalogProvider: 'sqlite', searchProvider: 'mysql', requiresMysql: true },
  { id: 'mysql-sqlite', catalogProvider: 'mysql', searchProvider: 'sqlite', requiresMysql: true },
];

const skillId = 'provider-matrix-proof-skill';
const fixtureText = 'Provider matrix deterministic fixture body';

function includeMysql(): boolean { return process.env.PROVIDER_MATRIX_INCLUDE_MYSQL === 'true' || process.env.RUN_MYSQL_FULL_CHECK === 'true'; }
function selectedCases(): ProviderCase[] { return includeMysql() ? allCases : allCases.filter((candidate) => !candidate.requiresMysql); }
function mysqlConfig() { return { host: process.env.MYSQL_HOST ?? '127.0.0.1', port: Number(process.env.MYSQL_PORT ?? 33307), database: process.env.MYSQL_DATABASE ?? 'managed_skill_hub', user: process.env.MYSQL_USER ?? 'managed_skill_hub', password: process.env.MYSQL_PASSWORD ?? 'valpass' }; }

function config(providerCase: ProviderCase, dataDir: string) {
  const mysql = mysqlConfig();
  return createScriptAppConfig({
    dataDir,
    registryId: 'provider-matrix-registry',
    registryName: 'Provider Matrix Registry',
    publicApiBaseUrl: 'https://provider.example.com/api',
    jwtSecret: 'provider-matrix-secret',
    catalogProvider: providerCase.catalogProvider,
    searchProvider: providerCase.searchProvider,
    mysqlHost: mysql.host,
    mysqlPort: mysql.port,
    mysqlDatabase: mysql.database,
    mysqlUser: mysql.user,
    mysqlPassword: mysql.password,
    mysqlSslMode: 'disabled',
    proposalMaxFiles: 5,
    proposalMaxFileSizeBytes: 1024 * 1024,
    oidcAgentIssuer: 'https://auth.example.test/application/o/agent/',
    oidcAdminIssuer: 'https://auth.example.test/application/o/admin/',
    oidcAgentClientId: 'managedskillhub-agent-device',
    oidcAdminClientId: 'managedskillhub-admin-web',
    oidcProposalAccess: 'all_authenticated_users',
    oidcProposalGroups: ['managedskillhub-submitters'],
    oidcPublicReadAccess: 'all_authenticated_users',
    oidcPublicReadGroups: ['managedskillhub-readers'],
    oidcAdminSubjects: [],
    oidcAdminGroups: ['managedskillhub-admins'],
    oidcReviewerGroups: ['managedskillhub-reviewers'],
    oidcPublisherGroups: ['managedskillhub-publishers'],
  });
}

async function buildApp(container: Container): Promise<FastifyInstance> { const app = Fastify({ logger: { level: 'error' } }); registerSkillReadRoutes(app, container, new AgentApiAuth(container.config)); registerApiErrorHandler(app); return app; }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function parseJson(payload: string): any { return JSON.parse(payload); }
function responseBuffer(response: { rawPayload?: Buffer; body: string | Buffer }): Buffer { if (Buffer.isBuffer(response.rawPayload)) return response.rawPayload; if (Buffer.isBuffer(response.body)) return response.body; return Buffer.from(response.body, 'binary'); }
function zipEntries(input: Buffer | Uint8Array): string[] {
  const buffer = Buffer.from(input); const entries: string[] = []; let offset = 0;
  while (offset + 30 <= buffer.length) { const signature = buffer.readUInt32LE(offset); if (signature !== 0x04034b50) break; const compressedSize = buffer.readUInt32LE(offset + 18); const fileNameLength = buffer.readUInt16LE(offset + 26); const extraLength = buffer.readUInt16LE(offset + 28); const nameStart = offset + 30; const nameEnd = nameStart + fileNameLength; entries.push(buffer.subarray(nameStart, nameEnd).toString('utf8')); offset = nameEnd + extraLength + compressedSize; }
  return entries.sort();
}
function normalizeSummaryItems(payload: any): NormalizedPublicSurface['skills'] { return (payload.items ?? []).map((item: any) => ({ id: item.id, title: item.title, version: item.version ?? item.latestPublishedVersion ?? null, category: item.category, tags: [...(item.tags ?? [])].sort() })).sort((left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id)); }

async function seedPublishedSkill(container: Container): Promise<{ skills: number; proposals: number; publishedVersions: number }> {
  await container.createSkill.createSkill({ id: skillId, title: 'Provider Matrix Proof Skill', description: 'Validates SQLite and MySQL provider parity for agent-facing read routes.', category: 'validation', tags: ['provider-proof', 'matrix'], capabilities: ['provider-parity'], entrypoint: 'SKILL.md', files: [ { path: 'SKILL.md', role: 'entrypoint', content: Buffer.from('# Provider Matrix Proof Skill\n\n' + fixtureText + '\n'), mimeType: 'text/markdown' }, { path: 'docs/guide.md', role: 'attachment', content: Buffer.from('# Provider Matrix Guide\n\nUse this file to validate package parity.\n'), mimeType: 'text/markdown' } ] }, 'provider-proof');
  await container.reviewSkill.submitForReview(skillId, '1.0.0', 'provider-proof');
  await container.reviewSkill.approve(skillId, '1.0.0', 'provider-proof');
  await container.reviewSkill.publish(skillId, '1.0.0', 'provider-proof');
  return container.rebuildProjections.execute('provider-proof', { clearProjections: true });
}

async function collectSurface(app: FastifyInstance, rebuild: { skills: number; proposals: number; publishedVersions: number }): Promise<NormalizedPublicSurface> {
  const discover = await app.inject({ method: 'GET', url: '/discover' }); const skills = await app.inject({ method: 'GET', url: '/skills?limit=20' }); const search = await app.inject({ method: 'GET', url: '/skills/search?q=Provider%20Matrix&mode=keyword&limit=20' }); const categories = await app.inject({ method: 'GET', url: '/categories' }); const tags = await app.inject({ method: 'GET', url: '/tags' }); const manifest = await app.inject({ method: 'GET', url: '/skills/' + skillId + '/manifest?version=1.0.0' }); const files = await app.inject({ method: 'GET', url: '/skills/' + skillId + '/files?version=1.0.0' }); const skillFile = await app.inject({ method: 'GET', url: '/skills/' + skillId + '/files/SKILL.md?version=1.0.0' }); const pkg = await app.inject({ method: 'GET', url: '/skills/' + skillId + '/package?version=1.0.0' });
  for (const [name, response] of Object.entries({ discover, skills, search, categories, tags, manifest, files, skillFile, pkg })) assert(response.statusCode === 200, name + ' status must be 200, got ' + response.statusCode + ': ' + response.payload);
  const manifestPayload = parseJson(manifest.payload); const filesPayload = parseJson(files.payload);
  return { discoverEntrypoints: (parseJson(discover.payload).entrypoints ?? []).map((entry: { path: string }) => entry.path).sort(), skills: normalizeSummaryItems(parseJson(skills.payload)), search: normalizeSummaryItems(parseJson(search.payload)), categories: [...(parseJson(categories.payload).items ?? [])].sort(), tags: [...(parseJson(tags.payload).items ?? [])].sort(), manifest: { id: manifestPayload.id, title: manifestPayload.title, version: manifestPayload.version, status: manifestPayload.status, entrypoint: manifestPayload.entrypoint, files: (manifestPayload.files ?? []).map((file: { path: string }) => file.path).sort() }, files: (filesPayload.items ?? []).map((file: { path: string }) => file.path).sort(), skillFileContainsFixture: skillFile.payload.includes(fixtureText), packageContentType: String(pkg.headers['content-type'] ?? ''), packageEntries: zipEntries(responseBuffer(pkg)), rebuild };
}

function assertSurface(surface: NormalizedPublicSurface): Record<string, boolean> {
  const checks = { discoverContainsReadRoutes: ['/skills', '/skills/search', '/categories', '/tags', '/skills/{skillId}/package'].every((route) => surface.discoverEntrypoints.includes(route)), listContainsSkill: surface.skills.some((item) => item.id === skillId && item.version === '1.0.0' && item.category === 'validation'), searchContainsSkill: surface.search.some((item) => item.id === skillId && item.version === '1.0.0'), categoriesContainValidation: surface.categories.includes('validation'), tagsContainProviderProof: surface.tags.includes('provider-proof') && surface.tags.includes('matrix'), manifestExactVersion: surface.manifest.id === skillId && surface.manifest.version === '1.0.0' && surface.manifest.status === 'published', filesContainExpectedPaths: sameStringArray(surface.files, ['SKILL.md', 'docs/guide.md']), packageContainsExpectedPaths: sameStringArray(surface.packageEntries, ['SKILL.md', 'docs/guide.md']), fileContentMatchesFixture: surface.skillFileContainsFixture, rebuildProjectedOnePublishedVersion: surface.rebuild.skills === 1 && surface.rebuild.publishedVersions === 1 };
  for (const [name, passed] of Object.entries(checks)) assert(passed, 'surface check failed: ' + name);
  return checks;
}
function sameStringArray(left: string[], right: string[]): boolean { return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort()); }
function comparable(surface: NormalizedPublicSurface): Omit<NormalizedPublicSurface, 'discoverEntrypoints' | 'packageContentType' | 'rebuild'> { return { skills: surface.skills, search: surface.search, categories: surface.categories, tags: surface.tags, manifest: surface.manifest, files: surface.files, skillFileContainsFixture: surface.skillFileContainsFixture, packageEntries: surface.packageEntries }; }
async function assertParity(actual: NormalizedPublicSurface, baseline: NormalizedPublicSurface, caseId: string): Promise<void> {
  const actualComparable = comparable(actual);
  const baselineComparable = comparable(baseline);
  if (JSON.stringify(actualComparable) !== JSON.stringify(baselineComparable)) {
    await mkdir('.tmp', { recursive: true });
    await writeFile(
      '.tmp/provider-matrix-mismatch-' + caseId + '.json',
      JSON.stringify({ caseId, expected: baselineComparable, actual: actualComparable }, null, 2) + '\n'
    );
    throw new Error(caseId + ' public surface differs from sqlite-sqlite baseline; see .tmp/provider-matrix-mismatch-' + caseId + '.json');
  }
}

async function runCase(providerCase: ProviderCase, baseline: NormalizedPublicSurface | null): Promise<CaseResult> {
  const dataDir = path.resolve('.tmp/provider-matrix-data', providerCase.id); await rm(dataDir, { recursive: true, force: true }); await mkdir(dataDir, { recursive: true });
  const container = await buildContainer(config(providerCase, dataDir));
  const app = await buildApp(container);
  try {
    const identityChecks = await proveIdentityPersistence(container, providerCase.id);
    const rebuild = await seedPublishedSkill(container);
    const surface = await collectSurface(app, rebuild);
    const checks = { ...assertSurface(surface), ...identityChecks };
    if (baseline) await assertParity(surface, baseline, providerCase.id);
    return { id: providerCase.id, catalogProvider: providerCase.catalogProvider, searchProvider: providerCase.searchProvider, checks, normalized: surface, result: 'PASS' };
  } finally {
    await app.close();
    await container.shutdown();
  }
}

async function proveIdentityPersistence(
  container: Container,
  caseId: string
): Promise<Record<string, boolean>> {
  const subject = `provider-proof-${caseId}`;
  const identity = {
    issuer: container.config.oidcAgentIssuer!,
    subject,
    clientId: container.config.oidcAgentClientId!,
    kind: 'human' as const,
    displayName: 'Provider Matrix User',
    email: 'provider-matrix@example.test',
    groups: ['managedskillhub-admins'],
  };
  const first = await container.principalProjection.project(identity);
  const refreshed = await container.principalProjection.project({
    ...identity,
    displayName: 'Provider Matrix User Updated',
    email: 'updated-provider-matrix@example.test',
  });
  assert(first.principalId === refreshed.principalId, `${caseId} principal projection must remain stable`);
  assert(refreshed.displayName === 'Provider Matrix User Updated', `${caseId} principal display projection must refresh`);
  assert(refreshed.roles.includes('admin'), `${caseId} admin group must resolve admin role`);

  const now = new Date();
  const sessionId = `session-${randomUUID()}`;
  await container.adminSessions.create({
    sessionId,
    principalId: first.principalId,
    roles: refreshed.roles,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  const session = await container.adminSessions.resolve(sessionId, now);
  const expiredSession = await container.adminSessions.resolve(sessionId, new Date(now.getTime() + 60_001));
  assert(session?.principalId === first.principalId, `${caseId} session must resolve`);
  assert(expiredSession === null, `${caseId} expired session must fail closed`);

  const state = `state-${randomUUID()}`;
  await container.oidcLoginTransactions.create({
    state,
    nonce: `nonce-${randomUUID()}`,
    pkceVerifier: `verifier-${randomUUID()}`,
    redirectUri: 'https://skills.example.test/api/admin/auth/oidc/callback',
    returnPath: '/frontend/admin',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  const consumed = await container.oidcLoginTransactions.consume(state, now);
  const replay = await container.oidcLoginTransactions.consume(state, now);
  assert(consumed.outcome === 'consumed', `${caseId} OIDC state must be consumed once`);
  assert(replay.outcome === 'replayed', `${caseId} OIDC state replay must be rejected`);

  return {
    identityPrincipalStable: true,
    identityProjectionRefreshesMutableProfile: true,
    identityAdminGroupRole: true,
    identitySessionExpiry: true,
    identityOidcStateReplay: true,
  };
}

async function assertMysqlStartupGuidance(): Promise<void> { const restartAll = await readFile('scripts/development/restart-all.sh', 'utf8'); assert(restartAll.includes('ensure_local_mysql_or_fail'), 'restart-all must include MySQL auto-start preflight'); assert(restartAll.includes('start-mysql-stack.sh') && restartAll.includes(' up'), 'restart-all must start local MySQL stack automatically'); }

async function main(): Promise<void> {
  await assertMysqlStartupGuidance(); const cases = selectedCases(); const results: CaseResult[] = []; let baseline: NormalizedPublicSurface | null = null;
  for (const providerCase of cases) { const result = await runCase(providerCase, baseline); results.push(result); if (providerCase.id === 'sqlite-sqlite') baseline = result.normalized; }
  const skippedCases = allCases.filter((candidate) => !cases.some((selected) => selected.id === candidate.id)).map((candidate) => candidate.id); const report = { name: 'provider-matrix', mysqlIncluded: includeMysql(), totalCases: results.length, passedCases: results.length, failedCases: 0, skippedCases, results };
  const lines = ['provider-matrix', 'mysqlIncluded=' + String(report.mysqlIncluded), 'totalCases=' + report.totalCases, 'passedCases=' + report.passedCases, 'failedCases=' + report.failedCases, 'skippedCases=' + skippedCases.join(','), ...results.map((result) => 'PASS ' + result.id + ' catalog=' + result.catalogProvider + ' search=' + result.searchProvider + ' checks=' + Object.keys(result.checks).length), 'RESULT=PASS'];
  await mkdir('.tmp', { recursive: true }); await writeFile('.tmp/provider-matrix.json', JSON.stringify(report, null, 2) + '\n'); await writeFile('.tmp/provider-matrix.log', lines.join('\n') + '\n'); console.log(lines.join('\n')); process.exit(0);
}

main().catch((error) => { console.error('RESULT=FAIL'); console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
