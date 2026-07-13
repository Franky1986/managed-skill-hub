import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AgentApiAuth } from '../apps/api/src/adapters/inbound/http/agent-api-auth';
import { registerApiErrorHandler } from '../apps/api/src/adapters/inbound/http/error-response';
import { registerSkillReadRoutes } from '../apps/api/src/adapters/inbound/http/skill-read.controller';
import { buildContainer } from '../apps/api/src/infrastructure/container';
import { MysqlClient } from '../apps/api/src/adapters/outbound/mysql/mysql.connection';
import type { AppConfig, CatalogProvider, SearchProvider } from '../apps/api/src/infrastructure/config';

const requireFromScript = createRequire(import.meta.url);
const Fastify = requireFromScript('fastify') as typeof import('fastify');

type StorageMode = 'filesystem' | 'database';

interface MatrixCase {
  id: string;
  storageMode: StorageMode;
  catalogProvider: CatalogProvider;
  searchProvider: SearchProvider;
}

interface CaseResult {
  id: string;
  mode: StorageMode;
  catalogProvider: CatalogProvider;
  searchProvider: SearchProvider;
  checks: Record<string, unknown>;
  packageSha256: string;
  directFileSha256: string;
  noManagedFilesystemContent: boolean | null;
}

function config(testCase: MatrixCase, dataDir: string): AppConfig {
  return {
    dataDir,
    openapiYamlPath: path.resolve('packages/openapi/skill-registry.openapi.yaml'),
    registryId: 'content-storage-' + testCase.id,
    registryName: 'Content Storage ' + testCase.id,
    publicApiBaseUrl: 'https://content-storage.example.com/api',
    apiHost: '127.0.0.1',
    apiPort: 3040,
    adminUser: 'admin',
    adminPassword: 'admin',
    adminPasswordHash: '',
    jwtSecret: 'content-storage-secret',
    sessionTtlSeconds: 3600,
    judgerProvider: 'noop',
    judgerAdapterPath: null,
    vercelAiSdkModel: null,
    vercelAiSdkTimeoutMs: 30000,
    vercelAiSdkMaxTextChars: 12000,
    vercelAiSdkMaxRetries: 0,
    catalogProvider: testCase.catalogProvider,
    searchProvider: testCase.searchProvider,
    contentStorageProvider: testCase.storageMode,
    mysqlHost: process.env.MYSQL_HOST ?? '127.0.0.1',
    mysqlPort: Number(process.env.MYSQL_PORT ?? 33307),
    mysqlDatabase: process.env.MYSQL_DATABASE ?? 'managed_skill_hub',
    mysqlUser: process.env.MYSQL_USER ?? 'managed_skill_hub',
    mysqlPassword: process.env.MYSQL_PASSWORD ?? 'valpass',
    mysqlSslMode: 'preferred',
    mysqlConnectTimeoutMs: 10000,
    mysqlQueryTimeoutMs: 30000,
    proposalMaxFiles: 10,
    proposalMaxFileSizeBytes: 1024 * 1024,
    proposalDisallowedPaths: ['node_modules/'],
    autoPublishOnGreen: false,
    autoPublishExcludedCategories: ['security'],
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

async function runCase(testCase: MatrixCase, skillId: string): Promise<CaseResult> {
  const mode = testCase.storageMode;
  const dataDir = path.resolve('.tmp/content-storage-' + testCase.id);
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  const appConfig = config(testCase, dataDir);
  if (testCase.catalogProvider === 'mysql' || testCase.searchProvider === 'mysql') {
    await resetMysqlTables(appConfig);
  }
  const container = await buildContainer(appConfig);
  const app = Fastify({ logger: false });
  registerSkillReadRoutes(app, container, new AgentApiAuth(container.config));
  registerApiErrorHandler(app);

  try {
    await container.createSkill.createSkill({
      id: skillId,
      title: 'Content Storage Proof',
      description: 'Deterministic proof that content storage mode is externally invisible.',
      category: 'operations',
      tags: ['storage', 'proof'],
      capabilities: ['download', 'search'],
      entrypoint: 'SKILL.md',
      files: [
        {
          path: 'SKILL.md',
          role: 'entrypoint',
          mimeType: 'text/markdown',
          content: Buffer.from('# Content Storage Proof\n\nUse this skill to validate storage parity.\n'),
        },
        {
          path: 'docs/guide.md',
          role: 'knowledge',
          mimeType: 'text/markdown',
          content: Buffer.from('# Guide\n\nThis file must be present in every storage mode.\n'),
        },
      ],
    }, 'storage-proof-admin');
    await container.reviewSkill.submitForReview(skillId, '1.0.0', 'storage-proof-admin');
    await container.reviewSkill.approve(skillId, '1.0.0', 'storage-proof-admin');
    await container.reviewSkill.publish(skillId, '1.0.0', 'storage-proof-admin');

    const proposal = await container.proposalCommand.submitProposal({
      title: 'OIDC attribution storage proof',
      description: 'Preserves stable human and agent-client attribution across content storage adapters.',
      category: 'operations',
      tags: ['identity', 'proof'],
      capabilities: ['attribution'],
      entrypoint: 'SKILL.md',
    }, {
      label: 'Storage Proof User',
      principalId: 'principal-storage-proof',
      clientId: 'managedskillhub-agent-device',
    });
    const rehydratedProposal = await container.skillRepository.findProposalById(proposal.id);
    const proposalAudit = await container.auditLog.findByProposalId(proposal.id);
    assert(
      rehydratedProposal?.submittedByPrincipalId === 'principal-storage-proof',
      mode + ' proposal principal attribution must survive rehydration'
    );
    assert(
      rehydratedProposal?.submittedViaClientId === 'managedskillhub-agent-device',
      mode + ' proposal client attribution must survive rehydration'
    );
    assert(
      proposalAudit.some((entry) => (
        entry.actorPrincipalId === 'principal-storage-proof'
        && entry.actorClientId === 'managedskillhub-agent-device'
      )),
      mode + ' audit principal/client attribution must survive persistence'
    );

    const checks: Record<string, unknown> = {};
    checks.proposalPrincipalAttribution = true;
    checks.proposalClientAttribution = true;
    checks.auditPrincipalClientAttribution = true;
    for (const [id, url] of Object.entries({
      list: '/skills',
      search: '/skills/search?q=storage&mode=keyword',
      detail: '/skills/' + skillId,
      manifest: '/skills/' + skillId + '/manifest?version=1.0.0',
      files: '/skills/' + skillId + '/files?version=1.0.0',
      categories: '/categories',
      tags: '/tags',
      history: '/skills/' + skillId + '/history',
    })) {
      const response = await app.inject({ method: 'GET', url });
      assert(response.statusCode === 200, mode + ' ' + id + ' status ' + response.statusCode);
      checks[id] = scrubJson(JSON.parse(response.payload));
    }

    const direct = await app.inject({ method: 'GET', url: '/skills/' + skillId + '/files/SKILL.md?version=1.0.0' });
    assert(direct.statusCode === 200, mode + ' direct file status ' + direct.statusCode);
    const directBuffer = responseBuffer(direct);

    const pack = await app.inject({ method: 'GET', url: '/skills/' + skillId + '/package?version=1.0.0' });
    assert(pack.statusCode === 200, mode + ' package status ' + pack.statusCode);
    const packageBuffer = responseBuffer(pack);

    return {
      id: testCase.id,
      mode,
      catalogProvider: testCase.catalogProvider,
      searchProvider: testCase.searchProvider,
      checks,
      directFileSha256: sha256(directBuffer),
      packageSha256: sha256(packageBuffer),
      noManagedFilesystemContent: mode === 'database'
        ? !(await exists(path.join(dataDir, 'skills'))) && !(await exists(path.join(dataDir, 'proposals'))) && (testCase.catalogProvider === 'mysql' || await exists(path.join(dataDir, 'index', 'search.db')))
        : null,
    };
  } finally {
    await app.close();
    await container.shutdown();
  }
}

async function resetMysqlTables(appConfig: AppConfig): Promise<void> {
  const client = new MysqlClient(appConfig);
  const statements = [
    'DELETE FROM content_audit_entries',
    'DELETE FROM content_skill_file_extracts',
    'DELETE FROM content_proposal_file_extracts',
    'DELETE FROM content_skill_files',
    'DELETE FROM content_proposal_files',
    'DELETE FROM content_skill_aggregates',
    'DELETE FROM content_proposal_aggregates',
    'DELETE FROM skill_search_document_tags',
    'DELETE FROM skill_search_documents',
    'DELETE FROM skill_catalog_audit_entries',
    'DELETE FROM skill_catalog_judgements',
    'DELETE FROM skill_catalog_proposal_files',
    'DELETE FROM skill_catalog_proposals',
    'DELETE FROM skill_catalog_files',
    'DELETE FROM skill_catalog_version_tags',
    'DELETE FROM skill_catalog_versions',
  ];
  try {
    for (const statement of statements) {
      try {
        await client.execute(statement);
      } catch {
        // Tables are created lazily; missing tables are fine before the first run.
      }
    }
  } finally {
    await client.close();
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await import('node:fs/promises').then((fs) => fs.stat(filePath));
    return true;
  } catch {
    return false;
  }
}

function responseBuffer(response: { rawPayload?: Buffer; body: string | Buffer; payload: string }): Buffer {
  if (Buffer.isBuffer(response.rawPayload)) return response.rawPayload;
  if (Buffer.isBuffer(response.body)) return response.body;
  return Buffer.from(response.payload, 'binary');
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function scrubJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrubJson);
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && isDynamicString(value) ? '<dynamic>' : value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (['id', 'createdAt', 'updatedAt', 'publishedAt', 'approvedAt', 'rejectedAt', 'deprecatedAt'].includes(key) && typeof raw === 'string' && isDynamicString(raw)) {
      output[key] = '<dynamic>';
      continue;
    }
    if (key === 'score' && typeof raw === 'number') {
      output[key] = '<score>';
      continue;
    }
    if (key === 'registryId' || key === 'registryName') {
      output[key] = '<registry>';
      continue;
    }
    output[key] = scrubJson(raw);
  }
  return output;
}

function isDynamicString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) || /^audit-/.test(value) || /^judge-/.test(value) || /^prop-/.test(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  await mkdir('.tmp', { recursive: true });
  const runId = String(Date.now());
  const skillId = 'content-storage-proof-' + runId;
  const cases: MatrixCase[] = [
    { id: 'filesystem-sqlite', storageMode: 'filesystem', catalogProvider: 'sqlite', searchProvider: 'sqlite' },
    { id: 'database-sqlite', storageMode: 'database', catalogProvider: 'sqlite', searchProvider: 'sqlite' },
  ];
  if (process.env.CONTENT_STORAGE_MATRIX_INCLUDE_MYSQL === 'true') {
    cases.push(
      { id: 'filesystem-mysql', storageMode: 'filesystem', catalogProvider: 'mysql', searchProvider: 'mysql' },
      { id: 'database-mysql', storageMode: 'database', catalogProvider: 'mysql', searchProvider: 'mysql' }
    );
  }

  const results: CaseResult[] = [];
  for (const testCase of cases) {
    results.push(await runCase(testCase, skillId));
  }

  const failures: string[] = [];
  const baselineByProvider = new Map<string, CaseResult>();
  for (const result of results) {
    const providerKey = result.catalogProvider + '/' + result.searchProvider;
    if (result.mode === 'filesystem') {
      baselineByProvider.set(providerKey, result);
    }
  }
  for (const result of results.filter((item) => item.mode === 'database')) {
    const providerKey = result.catalogProvider + '/' + result.searchProvider;
    const baseline = baselineByProvider.get(providerKey);
    if (!baseline) {
      failures.push(result.id + ': missing filesystem baseline for ' + providerKey);
      continue;
    }
    if (JSON.stringify(baseline.checks) !== JSON.stringify(result.checks)) {
      failures.push(result.id + ': public API JSON parity mismatch');
    }
    if (baseline.directFileSha256 !== result.directFileSha256) {
      failures.push(result.id + ': direct file bytes mismatch');
    }
    if (baseline.packageSha256 !== result.packageSha256) {
      failures.push(result.id + ': package bytes mismatch');
    }
    if (result.noManagedFilesystemContent !== true) {
      failures.push(result.id + ': database mode wrote managed skills/proposals filesystem content or missed content tables');
    }
  }
  const baseline = results[0];

  const report = {
    name: 'content-storage-matrix',
    cases: results,
    passedChecks: failures.length === 0 ? results.filter((item) => item.mode === 'database').length * 4 : 0,
    failedChecks: failures.length,
    failures,
  };
  const lines = [
    'content-storage-matrix',
    'cases=' + cases.map((item) => item.id).join(','),
    'directFileSha256=' + baseline.directFileSha256,
    'packageSha256=' + baseline.packageSha256,
    ...(failures.length === 0 ? ['RESULT=PASS'] : failures.map((failure) => 'FAIL ' + failure).concat('RESULT=FAIL')),
  ];
  await writeFile('.tmp/content-storage-matrix.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/content-storage-matrix.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(async (error) => {
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/content-storage-matrix.log', 'RESULT=FAIL\n' + (error as Error).stack + '\n');
  console.error((error as Error).stack ?? error);
  process.exit(1);
});
