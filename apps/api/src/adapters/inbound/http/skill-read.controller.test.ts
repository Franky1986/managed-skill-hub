import Fastify from 'fastify';
import os from 'os';
import path from 'path';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { describe, expect, it, afterEach } from 'vitest';
import { registerSkillReadRoutes } from './skill-read.controller';
import { AgentApiAuth } from './agent-api-auth';
import { registerApiErrorHandler } from './error-response';
import { AdminAuth } from './admin-auth';
import { AuthenticatedPrincipal, PrincipalRole } from '../../../application/security/authenticated-principal';

describe('SkillReadController /discover', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function buildApp(openapiYamlPath?: string) {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = {
      config: {
        openapiYamlPath: openapiYamlPath ?? '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: ['node_modules/', '.venv/'],
        autoPublishOnGreen: false,
        registryId: 'local',
        registryName: 'ManagedSkillHub Local',
        publicApiBaseUrl: 'http://localhost:3040',
        publicReadAuthMode: 'none',
        publicReadBearerToken: null,
        publicReadBearerActor: 'read-agent',
        proposalAuthMode: 'none',
        proposalBearerToken: null,
        proposalBearerActor: 'proposal-agent',
        discoveryAuthMode: 'none',
        discoveryBearerToken: null,
        discoveryBearerActor: 'discovery-agent',
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {
        listCategories: async () => [],
        listTags: async () => ['ffmpeg', 'video'],
      } as unknown as import('../../../infrastructure/container').Container['skillQuery'],
    } as import('../../../infrastructure/container').Container;
    registerSkillReadRoutes(app, container);
    return app;
  }

  it('returns discovery metadata', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/discover' });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.name).toBe('managed-skill-hub');
    expect(payload.version).toBe('0.1.0');
    expect(payload.description).toContain('skill registry');
    expect(payload.registryId).toBe('local');
    expect(payload.apiBaseUrl).toBe('http://localhost:3040');
    expect(payload.readAuthRequired).toBe(false);
    expect(payload.proposalAuthRequired).toBe(false);
    expect(payload.discoveryAuthRequired).toBe(false);
    expect(payload).not.toHaveProperty('credentialSetupScriptUrl');
    expect(payload.documentation).toMatchObject({
      human: expect.stringContaining('AGENT_BOOTSTRAP'),
      openapi: '/openapi.yaml',
      frontend: '/frontend',
    });
    expect(payload.capabilities.length).toBeGreaterThan(0);
    expect(payload.workflowNotes.conversationLanguage).toContain('language the user is currently using');
    expect(payload.workflowNotes.proposalPath).toContain('Prefer English for proposal metadata');
    const skillEntry = payload.entrypoints.find((entry: { id: string }) => entry.id === 'skills');
    expect(skillEntry).toMatchObject({
      id: 'skills',
      name: 'Skills',
      methods: ['GET'],
      path: '/skills',
      url: '/skills',
    });
    const searchEntry = payload.entrypoints.find((entry: { id: string }) => entry.id === 'skills-search');
    expect(searchEntry).toMatchObject({
      id: 'skills-search',
      path: '/skills/search',
      url: '/skills/search',
    });
    const tagsEntry = payload.entrypoints.find((entry: { id: string }) => entry.id === 'tags');
    expect(tagsEntry).toMatchObject({
      id: 'tags',
      path: '/tags',
      url: '/tags',
    });
    const howToEntry = payload.entrypoints.find((entry: { id: string }) => entry.id === 'how-to-propose');
    expect(howToEntry).toMatchObject({
      id: 'how-to-propose',
      name: 'How To Propose',
      methods: ['GET'],
      path: '/howToPropose',
      url: '/howToPropose',
    });
    const packageEntry = payload.entrypoints.find((entry: { id: string }) => entry.id === 'skills-package');
    expect(packageEntry).toMatchObject({
      id: 'skills-package',
      methods: ['GET'],
      path: '/skills/{skillId}/package',
      url: '/skills/{skillId}/package',
    });
    const frontendEntry = payload.entrypoints.find((entry: { id: string }) => entry.id === 'frontend-ui');
    expect(frontendEntry).toMatchObject({
      id: 'frontend-ui',
      path: '/frontend',
      url: '/frontend',
    });
    expect(payload.workflowNotes.publishedSkillDownload).toContain('/skills/{skillId}/package');
  });

  it('detects /api/ prefix and returns prefixed URLs', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = {
      config: {
        openapiYamlPath: '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: ['node_modules/', '.venv/'],
        autoPublishOnGreen: false,
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {} as unknown as import('../../../infrastructure/container').Container['skillQuery'],
    } as import('../../../infrastructure/container').Container;
    await app.register(async (apiApp) => {
      registerSkillReadRoutes(apiApp, container);
    }, { prefix: '/api' });

    const response = await app.inject({ method: 'GET', url: '/api/discover' });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    const skillEntry = payload.entrypoints.find((entry: { id: string }) => entry.id === 'skills');
    expect(skillEntry).toMatchObject({
      id: 'skills',
      path: '/skills',
      url: '/api/skills',
    });
    expect(payload.documentation.openapi).toBe('/api/openapi.yaml');
    expect(payload.documentation.frontend).toBe('/frontend');
  });


  it('reports active auth metadata and serves a no-secret setup script', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = {
      config: {
        openapiYamlPath: '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: ['node_modules/'],
        autoPublishOnGreen: false,
        registryId: 'company-prod',
        registryName: 'Company Production Skill Registry',
        publicApiBaseUrl: 'https://skills.example.com/api',
        publicReadAuthMode: 'bearer',
        publicReadBearerToken: 'read-secret',
        publicReadBearerActor: 'read-agent',
        proposalAuthMode: 'bearer',
        proposalBearerToken: 'proposal-secret',
        proposalBearerActor: 'proposal-agent',
        discoveryAuthMode: 'none',
        discoveryBearerToken: null,
        discoveryBearerActor: 'discovery-agent',
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {} as unknown as import('../../../infrastructure/container').Container['skillQuery'],
    } as import('../../../infrastructure/container').Container;
    registerSkillReadRoutes(app, container, new AgentApiAuth(container.config));

    const discover = await app.inject({ method: 'GET', url: '/discover' });
    const payload = JSON.parse(discover.payload);
    expect(payload).toMatchObject({
      registryId: 'company-prod',
      registryName: 'Company Production Skill Registry',
      apiBaseUrl: 'https://skills.example.com/api',
      readAuthRequired: true,
      proposalAuthRequired: true,
      discoveryAuthRequired: false,
      credentialSetupScriptUrl: 'https://skills.example.com/api/agent-credentials/setup.sh',
    });
    expect(payload.authSchemes.map((scheme: { id: string }) => scheme.id)).toEqual(['public-read-bearer', 'proposal-bearer']);

    const script = await app.inject({ method: 'GET', url: '/agent-credentials/setup.sh' });
    expect(script.statusCode).toBe(200);
    expect(script.payload).toContain('REGISTRY_ID=');
    expect(script.payload).toContain('company-prod');
    expect(script.payload).toContain('MSH_REQUIRE_READ=');
    expect(script.payload).toContain('MSH_REQUIRE_PROPOSAL=');
    expect(script.payload).toContain('Default mode opens a local browser form');
    expect(script.payload).toContain('Use --terminal for terminal prompts');
    expect(script.payload).toContain('openBrowser(url)');
    expect(script.payload).toContain('.managed-skill-hub');
    expect(script.payload).not.toContain('read-secret');
    expect(script.payload).not.toContain('proposal-secret');
  });

  it('includes auth setup guidance when agent auth is active', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = {
      config: {
        openapiYamlPath: '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: [],
        autoPublishOnGreen: false,
        registryId: 'auth-guidance',
        registryName: 'Auth Guidance Registry',
        publicApiBaseUrl: 'https://skills.example.com/api',
        publicReadAuthMode: 'none',
        proposalAuthMode: 'bearer',
        proposalBearerToken: 'proposal-secret',
        discoveryAuthMode: 'none',
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {} as unknown as import('../../../infrastructure/container').Container['skillQuery'],
    } as import('../../../infrastructure/container').Container;
    registerSkillReadRoutes(app, container, new AgentApiAuth(container.config));

    const response = await app.inject({ method: 'GET', url: '/howToPropose' });
    const payload = JSON.parse(response.payload);

    expect(payload.requiredSteps[0].title).toBe('Handle registry authentication outside chat');
    expect(payload.requiredSteps[0].checks.join(' ')).toContain('Never ask the user to paste bearer tokens into chat');
    expect(payload.apiNotes.authSetupFlow).toContain('setup script opens a local browser form');
    expect(payload.apiNotes.credentialSetupScriptUrl).toBe('https://skills.example.com/api/agent-credentials/setup.sh');
  });

  it('customizes the setup script for proposal-only auth', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = {
      config: {
        openapiYamlPath: '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: [],
        autoPublishOnGreen: false,
        registryId: 'proposal-only',
        registryName: 'Proposal Only Registry',
        publicApiBaseUrl: 'https://skills.example.com/api',
        publicReadAuthMode: 'none',
        proposalAuthMode: 'bearer',
        proposalBearerToken: 'proposal-secret',
        discoveryAuthMode: 'none',
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {} as unknown as import('../../../infrastructure/container').Container['skillQuery'],
    } as import('../../../infrastructure/container').Container;
    registerSkillReadRoutes(app, container, new AgentApiAuth(container.config));

    const script = await app.inject({ method: 'GET', url: '/agent-credentials/setup.sh' });

    expect(script.payload).toContain("MSH_REQUIRE_READ='false'");
    expect(script.payload).toContain("MSH_REQUIRE_PROPOSAL='true'");
    expect(script.payload).toContain('Proposal bearer token');
    expect(script.payload).not.toContain('readToken) entry.readToken');
  });

  it('customizes the setup script for read-only auth', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = {
      config: {
        openapiYamlPath: '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: [],
        autoPublishOnGreen: false,
        registryId: 'read-only',
        registryName: 'Read Only Registry',
        publicApiBaseUrl: 'https://skills.example.com/api',
        publicReadAuthMode: 'bearer',
        publicReadBearerToken: 'read-secret',
        proposalAuthMode: 'none',
        discoveryAuthMode: 'none',
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {} as unknown as import('../../../infrastructure/container').Container['skillQuery'],
    } as import('../../../infrastructure/container').Container;
    registerSkillReadRoutes(app, container, new AgentApiAuth(container.config));

    const script = await app.inject({ method: 'GET', url: '/agent-credentials/setup.sh' });

    expect(script.payload).toContain("MSH_REQUIRE_READ='true'");
    expect(script.payload).toContain("MSH_REQUIRE_PROPOSAL='false'");
    expect(script.payload).toContain('Read bearer token');
    expect(script.payload).not.toContain('proposalToken) entry.proposalToken');
  });

  it('guards public read endpoints when PUBLIC_READ_AUTH_MODE is bearer', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = {
      config: {
        openapiYamlPath: '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: [],
        autoPublishOnGreen: false,
        publicReadAuthMode: 'bearer',
        publicReadBearerToken: 'read-secret',
        publicReadBearerActor: 'read-agent',
        proposalAuthMode: 'none',
        discoveryAuthMode: 'none',
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {
        listCategories: async () => ['automation'],
      } as unknown as import('../../../infrastructure/container').Container['skillQuery'],
    } as import('../../../infrastructure/container').Container;
    registerSkillReadRoutes(app, container, new AgentApiAuth(container.config));

    const missing = await app.inject({ method: 'GET', url: '/categories' });
    const valid = await app.inject({ method: 'GET', url: '/categories', headers: { authorization: 'Bearer read-secret' } });

    expect(missing.statusCode).toBe(401);
    expect(valid.statusCode).toBe(200);
    expect(JSON.parse(valid.payload)).toEqual({ items: ['automation'] });
  });

  it('accepts a reader-capable admin session as alternative public read authentication', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = {
      config: {
        openapiYamlPath: '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: [],
        autoPublishOnGreen: false,
        publicReadAuthMode: 'bearer',
        publicReadBearerToken: 'read-secret',
        publicReadBearerActor: 'read-agent',
        proposalAuthMode: 'none',
        discoveryAuthMode: 'bearer',
        discoveryBearerToken: 'discovery-secret',
        discoveryBearerActor: 'discovery-agent',
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {
        listCategories: async () => ['automation'],
      } as unknown as import('../../../infrastructure/container').Container['skillQuery'],
    } as import('../../../infrastructure/container').Container;
    const adminAuth = adminAuthForCookieRoles({
      'reader-session': ['reader'],
      'admin-session': ['admin'],
      'reviewer-session': ['reviewer'],
    });
    registerSkillReadRoutes(app, container, new AgentApiAuth(container.config), adminAuth);

    const reader = await app.inject({ method: 'GET', url: '/categories', headers: { cookie: 'test_session=reader-session' } });
    const admin = await app.inject({ method: 'GET', url: '/categories', headers: { cookie: 'test_session=admin-session' } });
    const reviewerOnly = await app.inject({ method: 'GET', url: '/categories', headers: { cookie: 'test_session=reviewer-session' } });
    const invalid = await app.inject({ method: 'GET', url: '/categories', headers: { cookie: 'test_session=invalid' } });
    const discovery = await app.inject({ method: 'GET', url: '/discover', headers: { cookie: 'test_session=reader-session' } });

    expect(reader.statusCode).toBe(200);
    expect(admin.statusCode).toBe(200);
    expect(reviewerOnly.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(discovery.statusCode).toBe(401);
  });

  it('returns known tags on /tags', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/tags' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ items: ['ffmpeg', 'video'] });
  });

  it('returns proposal guidance on /howToPropose', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/howToPropose' });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.id).toBe('how-to-propose');
    expect(payload.conversationLanguage).toContain('language the user is currently using');
    expect(payload.metadataLanguageGuidance).toContain('Proposal metadata should preferably be written in English');
    expect(Array.isArray(payload.requiredSteps)).toBe(true);
    expect(payload.requiredSteps.length).toBeGreaterThan(0);
    expect(payload.requiredSteps.some((step: { title: string }) => step.title === 'Use the user conversation language')).toBe(true);
    expect(payload.requiredSteps.some((step: { title: string }) => step.title === 'Prefer English proposal metadata')).toBe(true);
    const inspectStep = payload.requiredSteps.find((step: { title: string }) => step.title === 'Inspect the local package');
    expect(inspectStep.checks.join(' ')).toContain('node_modules');
    expect(inspectStep.checks.join(' ')).toContain('commands/foo.md');
    expect(inspectStep.checks.join(' ')).toContain('commands/manifest.json');
    expect(inspectStep.checks.join(' ')).toContain('templates');
    expect(inspectStep.checks.join(' ')).toContain('PPTX');
    const duplicateStep = payload.requiredSteps.find((step: { title: string }) => step.title === 'Run duplicate precheck');
    expect(duplicateStep.checks.join(' ')).toContain('concise metadata/file-fingerprint diff');
    expect(payload.duplicateConfirmationRule.confirmationRequired).toContain('Do not call POST /proposals');
    expect(payload.duplicateConfirmationRule.requiredUserFacingSummary.join(' ')).toContain('core overlap');
    expect(payload.escalationRule).toContain('referenced local artifacts are missing');
    expect(payload.normalizationRules).toMatchObject({
      entrypointFile: 'SKILL.md',
      normalizeOnlyWhenNeeded: true,
      transparentToSubmitter: true,
    });
    expect(payload.description).toContain('meaningful relative subfolders');
    expect(payload.packageHandling).toMatchObject({
      principle: expect.stringContaining('required local assets'),
      disallowedInstalledPaths: expect.arrayContaining(['node_modules/', '.venv/']),
    });
    expect(payload.uploadLimits).toMatchObject({
      maxFiles: 30,
      maxFileSizeBytes: 10 * 1024 * 1024,
      disallowedPaths: expect.arrayContaining(['node_modules/']),
    });
    expect(payload.uploadFinalization).toMatchObject({
      required: true,
      finalizeEndpoint: 'POST /proposals/{id}/finalize-upload',
    });
    const normalizeStep = payload.requiredSteps.find((step: { title: string }) => step.title === 'Normalize only when needed');
    expect(normalizeStep.checks.join(' ')).toContain('commands/');
    expect(normalizeStep.checks.join(' ')).toContain('scripts/');
    expect(normalizeStep.checks.join(' ')).toContain('Adjust relative references');
    const proofStep = payload.requiredSteps.find((step: { title: string }) =>
      step.title === 'Build and prove the final upload package before network upload'
    );
    expect(proofStep.checks.join(' ')).toContain('Before POST /proposals');
    expect(proofStep.checks.join(' ')).toContain('.cursor/skills/');
    expect(proofStep.checks.join(' ')).toContain('JSON path/source fields');
    expect(payload.preUploadPackageProof).toMatchObject({
      requiredBeforeProposalCreation: true,
      scanAllReadableFiles: true,
      finalPackageHashSource: 'temporary upload package after all normalization',
    });
    expect(payload.preUploadPackageProof.forbiddenBeforeProof).toEqual(expect.arrayContaining(['POST /proposals']));
    const createStep = payload.requiredSteps.find((step: { title: string }) => step.title === 'Create proposal only after confirmation');
    expect(createStep.checks.join(' ')).toContain('final temporary upload package');
    expect(createStep.checks.join(' ')).toContain('multipart path=<relative package path>');
    const downloadStep = payload.requiredSteps.find((step: { title: string }) =>
      step.title === 'Download published skill packages per version'
    );
    expect(downloadStep.checks.join(' ')).toContain('GET /skills/{skillId}/package?version=<published-version>');
    expect(downloadStep.checks.join(' ')).toContain('commands/manifest.json');
    expect(payload.uploadGuardrails.join(' ')).toContain('installed dependency directories');
    expect(payload.uploadGuardrails.join(' ')).toContain('missing templates');
    expect(payload.uploadGuardrails.join(' ')).toContain('folder structure');
    expect(payload.requiredSteps[0].title).toBe('Read this workflow first');
    expect(payload.requiredSteps.some((step: { title: string }) => step.title === 'Handle registry authentication outside chat')).toBe(false);
    expect(payload.apiNotes.authSetupFlow).toBeUndefined();
    expect(payload.apiNotes.credentialSetupScriptUrl).toBeUndefined();
  });

  it('downloads published skill package with versioned and latest resolution', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = {
      config: {
        openapiYamlPath: '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: ['node_modules/', '.venv/'],
        autoPublishOnGreen: false,
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {
        getManifest: async (skillId: string, version?: string) => {
          if (skillId !== 'download-skill') return null;
          return {
            version: version ?? '1.2.0',
            status: 'published',
            title: 'Download Skill',
            description: '...',
            id: skillId,
            name: 'Download Skill',
            entrypoint: 'SKILL.md',
            category: 'automation',
            tags: [],
            capabilities: [],
            useWhen: [],
            doNotUseWhen: [],
            files: [],
            manifestChecksum: 'x',
          } as any;
        },
        listFiles: async (skillId: string, version?: string) => {
          if (skillId !== 'download-skill') return [];
          if (version === '1.0.0') {
            return [
              {
                id: 'SKILL.md',
                artifactId: 'a',
                path: 'SKILL.md',
                role: 'readme',
                mimeType: 'text/markdown',
                sizeBytes: 12,
                sha256: 'a1',
                updatedAt: new Date(),
                extractable: true,
              },
            ];
          }
          return [
            {
              id: 'SKILL.md',
              artifactId: 'a',
              path: 'SKILL.md',
              role: 'readme',
              mimeType: 'text/markdown',
              sizeBytes: 12,
              sha256: 'a1',
              updatedAt: new Date(),
              extractable: true,
            },
            {
              id: 'scripts/run.py',
              artifactId: 'b',
              path: 'scripts/run.py',
              role: 'source',
              mimeType: 'text/x-python',
              sizeBytes: 9,
              sha256: 'b1',
              updatedAt: new Date(),
              extractable: true,
            },
          ];
        },
        getFile: async (skillId: string, fileId: string, _version?: string) => {
          if (skillId !== 'download-skill') return null;
          if (fileId === 'SKILL.md') {
            return { path: fileId, mimeType: 'text/markdown', content: Buffer.from('id: download-skill') };
          }
          if (fileId === 'scripts/run.py') {
            return { path: fileId, mimeType: 'text/x-python', content: Buffer.from('print(\"run\")') };
          }
          return null;
        },
      },
    } as import('../../../infrastructure/container').Container;
    registerSkillReadRoutes(app, container);

    const explicitVersionResponse = await app.inject({ method: 'GET', url: '/skills/download-skill/package?version=1.0.0' });
    expect(explicitVersionResponse.statusCode).toBe(200);
    expect(explicitVersionResponse.headers['content-type']).toContain('text/markdown');
    expect(explicitVersionResponse.headers['content-disposition']).toBeDefined();

    const latestVersionResponse = await app.inject({ method: 'GET', url: '/skills/download-skill/package' });
    expect(latestVersionResponse.statusCode).toBe(200);
    expect(latestVersionResponse.headers['content-type']).toContain('application/zip');
  });

  it('serves the OpenAPI YAML specification', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-openapi-'));
    tempDirs.push(dataDir);
    const openapiPath = path.join(dataDir, 'skill-registry.openapi.yaml');
    await writeFile(openapiPath, 'openapi: 3.1.0\ninfo:\n  title: Test\n');

    const app = await buildApp(openapiPath);
    const response = await app.inject({ method: 'GET', url: '/openapi.yaml' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/yaml');
    expect(response.payload).toContain('openapi: 3.1.0');
  });

  it('returns 404 when OpenAPI YAML is missing', async () => {
    const app = await buildApp('/nonexistent/openapi.yaml');
    const response = await app.inject({ method: 'GET', url: '/openapi.yaml' });

    expect(response.statusCode).toBe(404);
    const payload = JSON.parse(response.payload);
    expect(payload.code).toBe('NOT_FOUND');
  });
});

  it('advertises agent-session scheme with url when bearer and agent sessions are enabled', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = {
      config: {
        openapiYamlPath: '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: ['node_modules/', '.venv/'],
        autoPublishOnGreen: false,
        registryId: 'session-registry',
        registryName: 'Session Registry',
        publicApiBaseUrl: 'https://skills.example.com/api',
        publicReadAuthMode: 'bearer',
        publicReadBearerToken: 'read-secret',
        publicReadBearerActor: 'read-agent',
        proposalAuthMode: 'bearer',
        proposalBearerToken: 'proposal-secret',
        proposalBearerActor: 'proposal-agent',
        discoveryAuthMode: 'none',
        discoveryBearerToken: null,
        discoveryBearerActor: 'discovery-agent',
        agentSessionEnabled: true,
        agentSessionTtlSeconds: 10800,
        agentSessionCodeLength: 8,
        agentSessionCodeCharset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        agentSessionMaxActive: null,
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {
        listCategories: async () => [],
        listTags: async () => [],
      } as unknown as import('../../../infrastructure/container').Container['skillQuery'],
    } as import('../../../infrastructure/container').Container;
    registerSkillReadRoutes(app, container);

    const response = await app.inject({ method: 'GET', url: '/discover' });
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    const sessionScheme = payload.authSchemes.find((s: { id: string }) => s.id === 'agent-session');
    expect(sessionScheme).toBeDefined();
    expect(sessionScheme.type).toBe('agent-session');
    expect(sessionScheme.appliesTo).toEqual(['public-read', 'proposal']);
    expect(sessionScheme.url).toBe('https://skills.example.com/api/frontend/agent-auth');
    expect(sessionScheme.instructions).toContain('https://skills.example.com/api/frontend/agent-auth');
  });

function adminAuthForCookieRoles(sessionRoles: Record<string, PrincipalRole[]>): AdminAuth {
  return {
    mode: 'simple',
    validate: async (request) => {
      const sessionId = request.headers.cookie?.match(/(?:^|;\s*)test_session=([^;]+)/)?.[1];
      const roles = sessionId ? sessionRoles[sessionId] : undefined;
      if (!roles) {
        return null;
      }
      const principal: AuthenticatedPrincipal = {
        principalId: `test:${sessionId}`,
        kind: 'human',
        externalSubject: null,
        issuer: null,
        clientId: null,
        displayName: sessionId,
        email: null,
        groups: [],
        roles,
        scheme: 'session',
      };
      return {
        username: sessionId,
        principal,
        roles,
        expiresAt: new Date(Date.now() + 60_000),
      };
    },
    validateMutationOrigin: () => undefined,
    logout: async () => undefined,
  };
}
