import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { AgentApiAuth } from '../apps/api/src/adapters/inbound/http/agent-api-auth';
import { registerApiErrorHandler } from '../apps/api/src/adapters/inbound/http/error-response';
import { registerSkillReadRoutes } from '../apps/api/src/adapters/inbound/http/skill-read.controller';
import type { AppConfig } from '../apps/api/src/infrastructure/config';
import type { Container } from '../apps/api/src/infrastructure/container';

const requireFromScript = createRequire(import.meta.url);
const Fastify = requireFromScript('fastify') as typeof import('fastify');

type VersionId = '1.0.0' | '1.1.0' | '2.0.0-draft';

interface VersionFixture {
  version: VersionId;
  status: 'published' | 'draft';
  files: Record<string, { mimeType: string; content: string }>;
}

const versions: Record<VersionId, VersionFixture> = {
  '1.0.0': {
    version: '1.0.0',
    status: 'published',
    files: {
      'SKILL.md': { mimeType: 'text/markdown', content: '# Package Proof v1\nSingle file.' },
    },
  },
  '1.1.0': {
    version: '1.1.0',
    status: 'published',
    files: {
      'SKILL.md': { mimeType: 'text/markdown', content: '# Package Proof v1.1\nMulti file.' },
      'scripts/run.py': { mimeType: 'text/x-python', content: 'print("package-proof")\n' },
      'docs/guide.md': { mimeType: 'text/markdown', content: '# Guide\nUse the script.' },
    },
  },
  '2.0.0-draft': {
    version: '2.0.0-draft',
    status: 'draft',
    files: {
      'SKILL.md': { mimeType: 'text/markdown', content: '# Draft\nMust not be public.' },
    },
  },
};

interface DownloadResult {
  id: string;
  statusCode: number;
  contentType: string;
  contentDisposition: string | undefined;
  bodyLength: number;
  zipEntries: string[];
  result: 'PASS';
}

function config(): AppConfig {
  return {
    registryId: 'package-proof-registry',
    registryName: 'Package Proof Registry',
    publicApiBaseUrl: 'https://package.example.com/api',
    publicReadAuthMode: 'none',
    publicReadBearerToken: null,
    publicReadBearerActor: 'read-agent',
    proposalAuthMode: 'none',
    proposalBearerToken: null,
    proposalBearerActor: 'proposal-agent',
    discoveryAuthMode: 'none',
    discoveryBearerToken: null,
    discoveryBearerActor: 'discovery-agent',
    openapiYamlPath: 'packages/openapi/skill-registry.openapi.yaml',
    proposalMaxFiles: 30,
    proposalMaxFileSizeBytes: 10 * 1024 * 1024,
    proposalDisallowedPaths: ['node_modules/'],
    autoPublishOnGreen: false,
  } as AppConfig;
}

function manifestFor(version: VersionFixture) {
  return {
    id: 'package-proof-skill',
    name: 'Package Proof Skill',
    title: 'Package Proof Skill',
    description: 'Deterministic package proof fixture.',
    version: version.version,
    status: version.status,
    entrypoint: 'SKILL.md',
    category: 'automation',
    tags: ['proof'],
    capabilities: ['download'],
    useWhen: [],
    doNotUseWhen: [],
    files: Object.entries(version.files).map(([path, file]) => ({ path, mimeType: file.mimeType, role: path === 'SKILL.md' ? 'entrypoint' : 'support' })),
    manifestChecksum: 'checksum-' + version.version,
  };
}

function container(): Container {
  const c = config();
  return {
    config: c,
    nameSuggestion: {} as Container['nameSuggestion'],
    skillQuery: {
      getManifest: async (skillId: string, requestedVersion?: string) => {
        if (skillId !== 'package-proof-skill') return null;
        const selectedVersion = (requestedVersion ?? '1.1.0') as VersionId;
        const version = versions[selectedVersion];
        if (!version || version.status !== 'published') return null;
        return manifestFor(version) as never;
      },
      listFiles: async (skillId: string, requestedVersion?: string) => {
        if (skillId !== 'package-proof-skill') return [];
        const version = versions[requestedVersion as VersionId];
        if (!version || version.status !== 'published') return [];
        return Object.entries(version.files).map(([path, file], index) => ({
          id: path,
          artifactId: 'artifact-' + index,
          path,
          role: path === 'SKILL.md' ? 'entrypoint' : 'support',
          mimeType: file.mimeType,
          sizeBytes: Buffer.byteLength(file.content),
          sha256: 'sha256-' + path.replace(/[^a-zA-Z0-9]+/g, '-'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          extractable: true,
        }));
      },
      getFile: async (skillId: string, fileId: string, requestedVersion?: string) => {
        if (skillId !== 'package-proof-skill') return null;
        const version = versions[requestedVersion as VersionId];
        const file = version?.files[fileId];
        if (!version || version.status !== 'published' || !file) return null;
        return { path: fileId, mimeType: file.mimeType, content: Buffer.from(file.content) };
      },
      listCategories: async () => ['automation'],
      listTags: async () => ['proof'],
    } as unknown as Container['skillQuery'],
  } as Container;
}

async function buildApp() {
  const app = Fastify({ logger: false });
  const c = container();
  registerSkillReadRoutes(app, c, new AgentApiAuth(c.config));
  registerApiErrorHandler(app);
  return app;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
    const name = buffer.subarray(nameStart, nameEnd).toString('utf8');
    entries.push(name);
    offset = nameEnd + extraLength + compressedSize;
  }
  return entries;
}

function assertSafeZipEntries(entries: string[]): void {
  for (const entry of entries) {
    assert(!entry.startsWith('/'), 'zip entry must be relative: ' + entry);
    assert(!entry.includes('..'), 'zip entry must not contain traversal: ' + entry);
    assert(!entry.includes('\\'), 'zip entry must not contain backslashes: ' + entry);
  }
}

async function main(): Promise<void> {
  const app = await buildApp();
  const results: DownloadResult[] = [];

  const single = await app.inject({ method: 'GET', url: '/skills/package-proof-skill/package?version=1.0.0' });
  assert(single.statusCode === 200, 'single file status');
  assert(String(single.headers['content-type']).includes('text/markdown'), 'single file content type');
  assert(String(single.headers['content-disposition']).includes('package-proof-skill-1.0.0-SKILL.md'), 'single file name');
  assert(single.body.toString('utf8').includes('Single file'), 'single file content');
  results.push({
    id: 'single-file-explicit-version',
    statusCode: single.statusCode,
    contentType: String(single.headers['content-type']),
    contentDisposition: single.headers['content-disposition'] as string | undefined,
    bodyLength: single.body.length,
    zipEntries: [],
    result: 'PASS',
  });

  const latest = await app.inject({ method: 'GET', url: '/skills/package-proof-skill/package' });
  assert(latest.statusCode === 200, 'latest package status');
  assert(String(latest.headers['content-type']).includes('application/zip'), 'latest package content type');
  assert(String(latest.headers['content-disposition']).includes('package-proof-skill-1.1.0.zip'), 'latest package file name');
  const latestBuffer = responseBuffer(latest);
  const entries = zipEntries(latestBuffer);
  assert(['SKILL.md', 'docs/guide.md', 'scripts/run.py'].every((entry) => entries.includes(entry)) && entries.length === 3, 'latest package complete entries');
  assertSafeZipEntries(entries);
  results.push({
    id: 'multi-file-latest-version',
    statusCode: latest.statusCode,
    contentType: String(latest.headers['content-type']),
    contentDisposition: latest.headers['content-disposition'] as string | undefined,
    bodyLength: latestBuffer.length,
    zipEntries: entries,
    result: 'PASS',
  });

  const draft = await app.inject({ method: 'GET', url: '/skills/package-proof-skill/package?version=2.0.0-draft' });
  assert(draft.statusCode === 404, 'draft version must not be public');
  results.push({
    id: 'draft-version-blocked',
    statusCode: draft.statusCode,
    contentType: String(draft.headers['content-type'] ?? ''),
    contentDisposition: draft.headers['content-disposition'] as string | undefined,
    bodyLength: draft.body.length,
    zipEntries: [],
    result: 'PASS',
  });

  const missing = await app.inject({ method: 'GET', url: '/skills/unknown-skill/package' });
  assert(missing.statusCode === 404, 'unknown skill must be 404');
  results.push({
    id: 'unknown-skill-blocked',
    statusCode: missing.statusCode,
    contentType: String(missing.headers['content-type'] ?? ''),
    contentDisposition: missing.headers['content-disposition'] as string | undefined,
    bodyLength: missing.body.length,
    zipEntries: [],
    result: 'PASS',
  });

  await app.close();

  const report = {
    name: 'skill-package-downloads',
    totalChecks: results.length,
    passedChecks: results.length,
    failedChecks: 0,
    results,
  };
  const lines = [
    'skill-package-downloads',
    'totalChecks=' + report.totalChecks,
    'passedChecks=' + report.passedChecks,
    'failedChecks=' + report.failedChecks,
    ...results.map((result) => [
      'PASS',
      result.id,
      'status=' + result.statusCode,
      'contentType=' + JSON.stringify(result.contentType),
      'zipEntries=' + (result.zipEntries.length ? result.zipEntries.join(',') : '-'),
    ].join(' ')),
    'RESULT=PASS',
  ];

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/skill-package-downloads.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/skill-package-downloads.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
