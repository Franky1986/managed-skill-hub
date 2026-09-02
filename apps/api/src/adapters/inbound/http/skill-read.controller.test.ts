import Fastify from 'fastify';
import os from 'os';
import path from 'path';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { registerSkillReadRoutes, SkillReadRouteContainer } from './skill-read.controller';
import { AgentApiAuth } from './agent-api-auth';
import { registerApiErrorHandler } from './error-response';
import { AdminAuth } from './admin-auth';
import { AuthenticatedPrincipal, PrincipalRole } from '../../../application/security/authenticated-principal';
import { AppConfig } from '../../../infrastructure/config';
import { createScriptAppConfig } from '../../../../../../scripts/lib/script-app-config';
import { Manifest } from '../../../domain/skill/Manifest';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import { computeContentDigest } from '../../../application/usecases/skill/public-metadata';

function testDouble<T extends object>(implementation: Partial<T> = {}): T {
  return new Proxy(implementation as T, {
    get(target, property, receiver) {
      if (property in target) {
        return Reflect.get(target, property, receiver);
      }
      if (typeof property === 'symbol') {
        return undefined;
      }
      return async () => {
        throw new Error(`Unexpected test-double call: ${String(property)}`);
      };
    },
  });
}

interface ProposalGuidanceStep {
  step: number;
  title: string;
  checks: string[];
}

function requireProposalGuidanceStep(steps: ProposalGuidanceStep[], title: string): ProposalGuidanceStep {
  const step = steps.find((candidate) => candidate.title === title);
  expect(step, `Expected proposal guidance step "${title}"`).toBeDefined();
  if (!step) {
    throw new Error(`Expected proposal guidance step "${title}"`);
  }
  return step;
}

function responseBuffer(response: { rawPayload?: Buffer; body: string | Buffer }): Buffer {
  if (Buffer.isBuffer(response.rawPayload)) return response.rawPayload;
  if (Buffer.isBuffer(response.body)) return response.body;
  return Buffer.from(response.body, 'binary');
}

function zipContents(input: Buffer | Uint8Array): Map<string, Buffer> {
  const buffer = Buffer.from(input);
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const contentStart = nameEnd + extraLength;
    const contentEnd = contentStart + compressedSize;
    entries.set(buffer.subarray(nameStart, nameEnd).toString('utf8'), buffer.subarray(contentStart, contentEnd));
    offset = nameEnd + extraLength + compressedSize;
  }
  return entries;
}

function buildTestContainer(overrides: {
  config?: Partial<AppConfig>;
  nameSuggestion?: Partial<SkillReadRouteContainer['nameSuggestion']>;
  skillQuery?: Partial<SkillReadRouteContainer['skillQuery']>;
  listJudgements?: Partial<SkillReadRouteContainer['listJudgements']>;
  extractSkillFileContent?: Partial<SkillReadRouteContainer['extractSkillFileContent']>;
  probeSkillFileContent?: Partial<SkillReadRouteContainer['probeSkillFileContent']>;
} = {}): SkillReadRouteContainer {
  return {
    config: createScriptAppConfig({
      openapiYamlPath: '/nonexistent/openapi.yaml',
      proposalMaxFiles: 30,
      proposalMaxFileSizeBytes: 10 * 1024 * 1024,
      proposalDisallowedPaths: ['node_modules/', '.venv/'],
      autoPublishOnGreen: false,
      ...overrides.config,
    }),
    nameSuggestion: testDouble<SkillReadRouteContainer['nameSuggestion']>({
      suggestSkillId: async () => ({ suggestion: 'test-skill', alternatives: [], isAvailable: true }),
      ...overrides.nameSuggestion,
    }),
    skillQuery: testDouble<SkillReadRouteContainer['skillQuery']>({
      getManifest: async () => null,
      listCategories: async () => [],
      listTags: async () => [],
      listVersions: async () => [],
      ...overrides.skillQuery,
    }),
    listJudgements: testDouble<SkillReadRouteContainer['listJudgements']>(overrides.listJudgements),
    extractSkillFileContent: testDouble<SkillReadRouteContainer['extractSkillFileContent']>(
      overrides.extractSkillFileContent
    ),
    probeSkillFileContent: testDouble<SkillReadRouteContainer['probeSkillFileContent']>(
      overrides.probeSkillFileContent
    ),
  };
}

describe('SkillReadController /discover', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function buildApp(openapiYamlPath?: string) {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = buildTestContainer({
      config: {
        openapiYamlPath: openapiYamlPath ?? '/nonexistent/openapi.yaml',
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
      skillQuery: {
        listCategories: async () => [],
        listTags: async () => ['ffmpeg', 'video'],
      },
    });
    registerSkillReadRoutes(app, container);
    return app;
  }

  it('returns discovery metadata', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/discover' });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.name).toBe('managed-skill-hub');
    expect(payload.version).toBe('0.2.0');
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
    expect(payload.bootstrapSkill).toMatchObject({
      id: 'use-skill-hub',
      available: true,
      fallback: true,
      title: 'Use Skill Hub',
      version: '0.0.0-initial',
      recommended: 'package',
    });
    expect(payload.bootstrapSkill.readUrl).toContain('/skills/use-skill-hub/files/SKILL.md');
    expect(payload.bootstrapSkill.packageUrl).toContain('/skills/use-skill-hub/package');
    expect(payload.bootstrapSkill.shortPath).toContain('packageUrl');
    expect(payload.capabilities.length).toBeGreaterThan(0);
    expect(payload.workflowNotes.conversationLanguage).toContain('language the user is currently using');
    expect(payload.workflowNotes.proposalPath).toContain('Prefer English for proposal metadata');
    expect(payload.workflowNotes.proposalPath).toContain('Figma');
    expect(payload.workflowNotes.proposalPath).toContain('include_portably');
    expect(payload.workflowNotes.proposalPath).toContain('before any proposal write');
    expect(payload.agentHttpGuidance.discoveryPurpose).toContain('does not return skill search results');
    expect(payload.agentHttpGuidance.toolSelection).toContain('network context, not curl itself');
    expect(payload.agentHttpGuidance.retrievalSequence.join(' ')).toContain('/skills/search');
    expect(payload.agentHttpGuidance.retrievalSequence.join(' ')).toContain('/skills/{skillId}/package');
    expect(payload.agentHttpGuidance.authenticationDiagnosis.join(' ')).toContain('/admin/session');
    expect(payload.agentHttpGuidance.authenticationDiagnosis.join(' ')).toContain('local network-capable HTTP client');
    expect(payload.agentHttpGuidance.responseHandling.rules.join(' ')).toContain('Do not use curl -f');
    expect(payload.agentHttpGuidance.responseHandling.rules.join(' ')).toContain('lost response is not a reason');
    expect(payload.agentHttpGuidance.responseHandling.validationGate).toContain('canFinalize=true');
    expect(payload.proposalWorkflow).toMatchObject({
      version: '1.1',
      executionMode: 'sequential_state_machine',
      activeUploadInvariant: {
        maximumActiveProposalIdsPerIntent: 1,
        conflictCode: 'PROPOSAL_UPLOAD_ALREADY_OPEN',
      },
    });
    expect(payload.workflowNotes.proposalPath).toContain('check whether this conversation');
    expect(payload.workflowNotes.proposalPath).toContain('PROPOSAL_UPLOAD_ALREADY_OPEN');
    expect(payload.agentHttpGuidance.proposalExecution).toContain('exactly one active proposal id');
    expect(payload.agentHttpGuidance.authorization).toMatchObject({
      discovery: { required: false },
      publicRead: { required: false },
      proposal: { required: false },
    });
    expect(payload.agentHttpGuidance.curlExamples.download).toMatchObject({
      command: expect.stringContaining('curl -sSL -OJ'),
      authArea: 'public-read',
      authorizationRequired: false,
    });
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
    const container = buildTestContainer();
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
    expect(payload.bootstrapSkill.readUrl).toContain('/api/skills/use-skill-hub/files/SKILL.md');
    expect(payload.bootstrapSkill.packageUrl).toContain('/api/skills/use-skill-hub/package');
  });

  it('uses configured public API base URL before request host headers for bootstrap links', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = buildTestContainer({
      config: {
        publicApiBaseUrl: 'https://configured.example.com/api',
      },
    });
    registerSkillReadRoutes(app, container);

    const response = await app.inject({
      method: 'GET',
      url: '/discover',
      headers: {
        host: 'request-host.example.test',
        'x-forwarded-host': 'evil.example.test',
        'x-forwarded-proto': 'https',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.bootstrapSkill.readUrl).toBe('https://configured.example.com/api/skills/use-skill-hub/files/SKILL.md');
    expect(payload.bootstrapSkill.packageUrl).toBe('https://configured.example.com/api/skills/use-skill-hub/package');
    expect(JSON.stringify(payload.bootstrapSkill)).not.toContain('evil.example.test');
    expect(JSON.stringify(payload.bootstrapSkill)).not.toContain('request-host.example.test');
  });


  it('reports active auth metadata and serves a no-secret setup script', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = buildTestContainer({
      config: {
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
    });
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
    });
    expect(payload).not.toHaveProperty('credentialSetupScriptUrl');
    expect(payload.authSchemes.map((scheme: { id: string }) => scheme.id)).toEqual(['public-read-bearer', 'proposal-bearer']);
    expect(payload.agentHttpGuidance.authorization).toMatchObject({
      discovery: { required: false },
      publicRead: { required: true },
      proposal: { required: true },
    });
    expect(payload.agentHttpGuidance.curlExamples.search.authorizationRequired).toBe(true);
  });

  it('includes auth setup guidance when agent auth is active', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = buildTestContainer({
      config: {
        registryId: 'auth-guidance',
        registryName: 'Auth Guidance Registry',
        publicApiBaseUrl: 'https://skills.example.com/api',
        publicReadAuthMode: 'none',
        proposalAuthMode: 'bearer',
        proposalBearerToken: 'proposal-secret',
        discoveryAuthMode: 'none',
      },
    });
    registerSkillReadRoutes(app, container, new AgentApiAuth(container.config));

    const response = await app.inject({ method: 'GET', url: '/howToPropose' });
    const payload = JSON.parse(response.payload);

    expect(payload.requiredSteps[0].title).toBe('Handle registry authentication outside chat');
    expect(payload.requiredSteps[0].checks.join(' ')).toContain('Never paste it into chat');
    expect(payload.apiNotes.authSetupFlow).toContain('obtain the required bearer token from the administrator');
    expect(payload.apiNotes.credentialSetupScriptUrl).toBeUndefined();
    expect(payload.agentHttpGuidance.authorization.proposal.required).toBe(true);
  });

  it('guards public read endpoints when PUBLIC_READ_AUTH_MODE is bearer', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = buildTestContainer({
      config: {
        publicReadAuthMode: 'bearer',
        publicReadBearerToken: 'read-secret',
        publicReadBearerActor: 'read-agent',
        proposalAuthMode: 'none',
        discoveryAuthMode: 'none',
      },
      skillQuery: {
        listCategories: async () => ['automation'],
      },
    });
    registerSkillReadRoutes(app, container, new AgentApiAuth(container.config));

    const missing = await app.inject({ method: 'GET', url: '/categories' });
    const valid = await app.inject({ method: 'GET', url: '/categories', headers: { authorization: 'Bearer read-secret' } });

    expect(missing.statusCode).toBe(401);
    expect(valid.statusCode).toBe(200);
    expect(JSON.parse(valid.payload)).toMatchObject({
      items: ['automation'],
      policy: 'open',
      itemsAreSuggestions: true,
      customCategoriesAllowed: true,
    });
  });

  it('accepts a reader-capable admin session as alternative public read authentication', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = buildTestContainer({
      config: {
        publicReadAuthMode: 'bearer',
        publicReadBearerToken: 'read-secret',
        publicReadBearerActor: 'read-agent',
        proposalAuthMode: 'none',
        discoveryAuthMode: 'bearer',
        discoveryBearerToken: 'discovery-secret',
        discoveryBearerActor: 'discovery-agent',
      },
      skillQuery: {
        listCategories: async () => ['automation'],
      },
    });
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

  it('describes published categories as suggestions under an open category policy', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/categories' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({
      policy: 'open',
      itemsAreSuggestions: true,
      customCategoriesAllowed: true,
      source: 'published_skills',
      instruction: expect.stringContaining('not an allowlist'),
    });
  });

  it('returns proposal guidance on /howToPropose', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/howToPropose' });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    const requiredSteps = payload.requiredSteps as ProposalGuidanceStep[];
    expect(payload.id).toBe('how-to-propose');
    expect(payload.conversationLanguage).toContain('language the user is currently using');
    expect(payload.metadataLanguageGuidance).toContain('Proposal metadata should preferably be written in English');
    expect(payload.agentHttpGuidance.toolSelection).toContain('VPN-restricted');
    expect(payload.agentHttpGuidance.proposalExecution).toContain('GET /howToPropose');
    expect(payload.agentHttpGuidance.authenticationDiagnosis.join(' ')).toContain('exact requested endpoint');
    expect(payload.agentHttpGuidance.responseHandling.shellPattern).toContain('%{http_code}');
    expect(payload.proposalWorkflow.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'create_proposal', recovery: expect.stringContaining('PROPOSAL_UPLOAD_ALREADY_OPEN') }),
      expect.objectContaining({ id: 'validate_upload', success: expect.stringContaining('canFinalize=true') }),
      expect.objectContaining({ id: 'finalize_upload' }),
    ]));
    expect(payload.proposalWorkflow.activeUploadInvariant).toMatchObject({
      maximumActiveProposalIdsPerIntent: 1,
      conflictCode: 'PROPOSAL_UPLOAD_ALREADY_OPEN',
    });
    expect(payload.categoryPolicy).toMatchObject({
      policy: 'open',
      customCategoriesAllowed: true,
      instruction: expect.stringContaining('never treat GET /categories as an allowlist'),
    });
    expect(Array.isArray(requiredSteps)).toBe(true);
    expect(requiredSteps.length).toBeGreaterThan(0);
    expect(requiredSteps.some((step) => step.title === 'Use the user conversation language')).toBe(true);
    expect(requiredSteps.some((step) => step.title === 'Prefer English proposal metadata')).toBe(true);
    const intentStep = requireProposalGuidanceStep(
      requiredSteps,
      'Clarify the intended outcome and registry value'
    );
    expect(intentStep.checks.join(' ')).toContain('keep or install the artifact locally');
    expect(intentStep.checks.join(' ')).toContain('optional commands should be installed');
    const inspectStep = requireProposalGuidanceStep(requiredSteps, 'Inspect the local package');
    expect(intentStep.step).toBeLessThan(inspectStep.step);
    expect(inspectStep.checks.join(' ')).toContain('node_modules');
    expect(inspectStep.checks.join(' ')).toContain('commands/foo.md');
    expect(inspectStep.checks.join(' ')).toContain('commands/manifest.json');
    expect(inspectStep.checks.join(' ')).toContain('templates');
    expect(inspectStep.checks.join(' ')).toContain('PPTX');
    const duplicateStep = requireProposalGuidanceStep(requiredSteps, 'Run duplicate precheck');
    expect(duplicateStep.checks.join(' ')).toContain('concise metadata/file-fingerprint diff');
    expect(duplicateStep.checks.join(' ')).toContain('Using the published skill');
    expect(duplicateStep.checks.join(' ')).toContain('strong similarity threshold of 0.5');
    expect(duplicateStep.checks.join(' ')).toContain('exploratory context');
    expect(payload.proposalIntentDecision).toMatchObject({
      requiredBeforePackagePreparation: true,
      outcomes: expect.arrayContaining(['use_existing_skill', 'keep_local', 'install_local', 'propose_new_skill']),
      decisionRules: expect.arrayContaining([expect.stringContaining('Do not infer proposal intent')]),
      commandRules: expect.arrayContaining([expect.stringContaining('separate decisions')]),
    });
    expect(payload.externalArtifactDecision).toMatchObject({
      requiredBeforeProposalCreation: true,
      classifications: expect.arrayContaining([
        expect.objectContaining({ id: 'external_service_or_capability', action: expect.stringContaining('Do not copy') }),
        expect.objectContaining({ id: 'local_portable_artifact', action: expect.stringContaining('ask the user') }),
        expect.objectContaining({ id: 'ambiguous_dependency', action: expect.stringContaining('Stop and ask') }),
      ]),
      decisionOptions: expect.arrayContaining([
        expect.objectContaining({ id: 'include_portably' }),
        expect.objectContaining({ id: 'keep_external_prerequisite' }),
        expect.objectContaining({ id: 'remove_or_rewrite_dependency' }),
      ]),
    });
    expect(payload.externalArtifactDecision.confirmationRule).toContain('before POST /proposals');
    expect(payload.externalArtifactDecision.confirmationRule).toContain('Figma');
    expect(payload.externalArtifactDecision.requiredUserFacingProposal.join(' ')).toContain('package-relative destination');
    expect(payload.duplicateConfirmationRule.confirmationRequired).toContain('Do not call POST /proposals');
    expect(payload.duplicateConfirmationRule.confirmationRequired).toContain('proposal outcome');
    expect(payload.duplicateConfirmationRule.strongSimilarityThreshold).toBe(0.5);
    expect(payload.duplicateConfirmationRule.requiredUserFacingSummary.join(' ')).toContain('lower-scoring similar match');
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
    const normalizeStep = requireProposalGuidanceStep(requiredSteps, 'Normalize only when needed');
    const artifactDecisionStep = requireProposalGuidanceStep(
      requiredSteps,
      'Resolve outside-root artifacts with the user'
    );
    expect(inspectStep.step).toBeLessThan(artifactDecisionStep.step);
    expect(artifactDecisionStep.step).toBeLessThan(normalizeStep.step);
    expect(artifactDecisionStep.checks.join(' ')).toContain('Figma');
    expect(artifactDecisionStep.checks.join(' ')).toContain('commands/foo.md');
    expect(artifactDecisionStep.checks.join(' ')).toContain('include_portably');
    expect(artifactDecisionStep.checks.join(' ')).toContain('original upload request');
    expect(artifactDecisionStep.checks.join(' ')).toContain('Do not call POST /proposals');
    expect(normalizeStep.checks.join(' ')).toContain('commands/');
    expect(normalizeStep.checks.join(' ')).toContain('scripts/');
    expect(normalizeStep.checks.join(' ')).toContain('Adjust relative references');
    const proofStep = requireProposalGuidanceStep(
      requiredSteps,
      'Build and prove the final upload package before network upload'
    );
    expect(proofStep.checks.join(' ')).toContain('Before POST /proposals');
    expect(proofStep.checks.join(' ')).toContain('.cursor/skills/');
    expect(proofStep.checks.join(' ')).toContain('JSON path/source fields');
    expect(payload.preUploadPackageProof).toMatchObject({
      requiredBeforeProposalCreation: true,
      scanAllReadableFiles: true,
      finalPackageHashSource: 'temporary upload package after all normalization',
    });
    expect(payload.preUploadPackageProof.requiredLocalChecks.join(' ')).toContain('explicit user decision');
    expect(payload.preUploadPackageProof.requiredLocalChecks.join(' ')).toContain('Figma');
    expect(payload.preUploadPackageProof.forbiddenBeforeProof).toEqual(expect.arrayContaining(['POST /proposals']));
    const createStep = requireProposalGuidanceStep(
      requiredSteps,
      'Create proposal only after confirmation'
    );
    expect(createStep.checks.join(' ')).toContain('final temporary upload package');
    expect(createStep.checks.join(' ')).toContain('multipart path=<relative package path>');
    expect(createStep.checks.join(' ')).toContain('exactly one active proposal id');
    expect(createStep.checks.join(' ')).toContain('details.proposalId');
    expect(createStep.checks.join(' ')).toContain('Re-uploading all intended files');
    const downloadStep = requireProposalGuidanceStep(
      requiredSteps,
      'Download published skill packages per version'
    );
    expect(downloadStep.checks.join(' ')).toContain('GET /skills/{skillId}/package?version=<published-version>');
    expect(downloadStep.checks.join(' ')).toContain('commands/manifest.json');
    expect(payload.uploadGuardrails.join(' ')).toContain('installed dependency directories');
    expect(payload.uploadGuardrails.join(' ')).toContain('missing templates');
    expect(payload.uploadGuardrails.join(' ')).toContain('folder structure');
    const firstStep = requiredSteps[0];
    expect(firstStep).toBeDefined();
    if (!firstStep) {
      throw new Error('Expected at least one proposal guidance step');
    }
    expect(firstStep.title).toBe('Read this workflow first');
    expect(requiredSteps.some((step) => step.title === 'Handle registry authentication outside chat')).toBe(false);
    expect(payload.apiNotes.authSetupFlow).toBeUndefined();
    expect(payload.apiNotes.credentialSetupScriptUrl).toBeUndefined();
  });

  it('downloads published skill package with versioned and latest resolution', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const getFile = vi.fn(async (skillId: string, fileId: string, _version?: string) => {
      if (skillId !== 'download-skill') return null;
      if (fileId === 'SKILL.md') {
        return { path: fileId, mimeType: 'text/markdown', content: Buffer.from('id: download-skill') };
      }
      if (fileId === 'scripts/run.py') {
        return { path: fileId, mimeType: 'text/x-python', content: Buffer.from('print(\"run\")') };
      }
      throw new Error(`Unexpected file download: ${fileId}`);
    });
    const container = buildTestContainer({
      skillQuery: {
        getManifest: async (skillId: string, version?: string) => {
          if (skillId !== 'download-skill') return null;
          return Manifest.create({
            version: version ?? '1.2.0',
            status: SkillStatus.PUBLISHED,
            title: 'Download Skill',
            description: '...',
            id: skillId,
            entrypoint: 'SKILL.md',
            category: 'automation',
            tags: [],
            capabilities: [],
            useWhen: [],
            doNotUseWhen: [],
            files: [],
          });
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
            {
              id: 'nested/skill-hub-meta.json',
              artifactId: 'legacy-meta',
              path: 'nested/skill-hub-meta.json',
              role: 'metadata',
              mimeType: 'application/json',
              sizeBytes: 2,
              sha256: 'legacy-meta-digest',
              updatedAt: new Date(),
              extractable: true,
            },
          ];
        },
        getFile,
        listVersions: async (skillId: string) => {
          if (skillId !== 'download-skill') return [];
          return [
            {
              version: '1.0.0',
              versionUuid: 'version-1',
              contentDigest: 'digest-1',
              status: SkillStatus.PUBLISHED,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              approvedBy: null,
              approvedAt: null,
              publishedBy: 'publisher',
              publishedAt: new Date('2026-01-02T00:00:00.000Z'),
              rejectedBy: null,
              rejectedAt: null,
              rejectionReason: null,
              deprecatedBy: null,
              deprecatedAt: null,
              deprecationReason: null,
            },
          ];
        },
      },
    });
    registerSkillReadRoutes(app, container);

    const explicitVersionResponse = await app.inject({ method: 'GET', url: '/skills/download-skill/package?version=1.0.0' });
    expect(explicitVersionResponse.statusCode).toBe(200);
    expect(explicitVersionResponse.headers['content-type']).toContain('application/zip');
    expect(explicitVersionResponse.headers['content-disposition']).toBeDefined();
    const explicitArchive = zipContents(responseBuffer(explicitVersionResponse));
    expect([...explicitArchive.keys()].sort()).toEqual(['SKILL.md', 'skill-hub-meta.json']);
    expect(explicitArchive.get('SKILL.md')?.toString('utf8')).toContain('id: download-skill');
    const explicitMeta = JSON.parse(explicitArchive.get('skill-hub-meta.json')?.toString('utf8') ?? '{}');
    expect(explicitMeta).toMatchObject({
      schema: 'managed-skill-hub.skill-meta.v1',
      skill: {
        id: 'download-skill',
        entrypoint: 'SKILL.md',
      },
      version: {
        version: '1.0.0',
        publishedAt: '2026-01-02T00:00:00.000Z',
        fallback: false,
      },
      proposalDefaults: {
        targetSkillId: 'download-skill',
        excludeFromProposal: ['skill-hub-meta.json'],
      },
    });
    expect(explicitMeta.links.package).toContain('/skills/download-skill/package?version=1.0.0');

    const latestVersionResponse = await app.inject({ method: 'GET', url: '/skills/download-skill/package' });
    expect(latestVersionResponse.statusCode).toBe(200);
    expect(latestVersionResponse.headers['content-type']).toContain('application/zip');
    const latestArchive = zipContents(responseBuffer(latestVersionResponse));
    expect([...latestArchive.keys()].sort()).toEqual([
      'SKILL.md',
      'scripts/run.py',
      'skill-hub-meta.json',
    ]);
    expect(getFile).not.toHaveBeenCalledWith('download-skill', 'nested/skill-hub-meta.json', expect.anything());
    const latestMeta = JSON.parse(latestArchive.get('skill-hub-meta.json')?.toString('utf8') ?? '{}');
    expect(latestMeta.version.contentDigest).toBe(computeContentDigest(
      'download-skill',
      '1.2.0',
      'automation',
      [],
      [],
      'SKILL.md',
      [
        { path: 'SKILL.md', role: 'readme', mimeType: 'text/markdown', sha256: 'a1', sizeBytes: 12 },
        { path: 'scripts/run.py', role: 'source', mimeType: 'text/x-python', sha256: 'b1', sizeBytes: 9 },
      ]
    ));
  });

  it('serves built-in use-skill-hub fallback through public read endpoints', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = buildTestContainer({
      config: {
        registryId: 'testing-hub',
        registryName: 'Testing Skill Hub',
        publicApiBaseUrl: 'http://localhost:3040',
      },
      skillQuery: {
        getSkillDetail: async () => null,
        getManifest: async () => null,
        listFiles: async () => [],
        getFile: async () => null,
        listVersions: async () => [],
      },
    });
    registerSkillReadRoutes(app, container);

    const detailResponse = await app.inject({ method: 'GET', url: '/skills/use-skill-hub' });
    expect(detailResponse.statusCode).toBe(200);
    expect(JSON.parse(detailResponse.payload)).toMatchObject({
      id: 'use-skill-hub',
      category: 'registry-system',
      latestPublishedVersion: '0.0.0-initial',
    });

    const manifestResponse = await app.inject({ method: 'GET', url: '/skills/use-skill-hub/manifest' });
    expect(manifestResponse.statusCode).toBe(200);
    expect(JSON.parse(manifestResponse.payload)).toMatchObject({
      id: 'use-skill-hub',
      version: '0.0.0-initial',
      entrypoint: 'SKILL.md',
    });

    const fileResponse = await app.inject({
      method: 'GET',
      url: '/skills/use-skill-hub/files/SKILL.md',
      headers: {
        host: 'skill-hub.example.test',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example.test',
      },
    });
    expect(fileResponse.statusCode).toBe(200);
    expect(fileResponse.payload).toContain('curl -sS "http://skill-hub.example.test/discover"');
    expect(fileResponse.payload).not.toContain('evil.example.test');
    expect(fileResponse.payload).toContain('skill-hub-meta.json');

    const versionsResponse = await app.inject({ method: 'GET', url: '/skills/use-skill-hub/versions' });
    expect(versionsResponse.statusCode).toBe(200);
    expect(JSON.parse(versionsResponse.payload).items[0]).toMatchObject({
      version: '0.0.0-initial',
      status: 'published',
      publishedAt: null,
    });

    const packageResponse = await app.inject({
      method: 'GET',
      url: '/skills/use-skill-hub/package',
      headers: {
        host: 'skill-hub.example.test',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example.test',
      },
    });
    expect(packageResponse.statusCode).toBe(200);
    expect(packageResponse.headers['content-type']).toContain('application/zip');
    const archive = zipContents(responseBuffer(packageResponse));
    expect([...archive.keys()].sort()).toEqual(['SKILL.md', 'skill-hub-meta.json']);
    const meta = JSON.parse(archive.get('skill-hub-meta.json')?.toString('utf8') ?? '{}');
    expect(meta).toMatchObject({
      registry: {
        id: 'testing-hub',
        apiBaseUrl: 'http://skill-hub.example.test',
      },
      skill: {
        id: 'use-skill-hub',
      },
      version: {
        version: '0.0.0-initial',
        fallback: true,
      },
    });
    expect(JSON.stringify(meta)).not.toContain('evil.example.test');
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
    const container = buildTestContainer({
      config: {
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
      skillQuery: {
        listCategories: async () => [],
        listTags: async () => [],
      },
    });
    registerSkillReadRoutes(app, container);

    const response = await app.inject({ method: 'GET', url: '/discover' });
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    const sessionScheme = payload.authSchemes.find((s: { id: string }) => s.id === 'agent-session');
    expect(sessionScheme).toBeDefined();
    expect(sessionScheme.type).toBe('agent-session');
    expect(sessionScheme.appliesTo).toEqual(['public-read', 'proposal']);
    expect(sessionScheme.url).toBe('https://skills.example.com/frontend/agent-auth');
    expect(sessionScheme.instructions).toContain('session code');
  });

  it('rewrites local API port to frontend port in agent-session url', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);
    const container = buildTestContainer({
      config: {
        registryId: 'local-session-registry',
        registryName: 'Local Session Registry',
        publicApiBaseUrl: 'http://localhost:3040',
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
        apiHost: '127.0.0.1',
        apiPort: 3040,
      },
      skillQuery: {
        listCategories: async () => [],
        listTags: async () => [],
      },
    });
    registerSkillReadRoutes(app, container);

    const response = await app.inject({ method: 'GET', url: '/discover' });
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    const sessionScheme = payload.authSchemes.find((s: { id: string }) => s.id === 'agent-session');
    expect(sessionScheme).toBeDefined();
    expect(sessionScheme.url).toBe('http://localhost:3041/frontend/agent-auth');
  });

function adminAuthForCookieRoles(sessionRoles: Record<string, PrincipalRole[]>): AdminAuth {
  return {
    mode: 'simple',
    validate: async (request) => {
      const sessionId = request.headers.cookie?.match(/(?:^|;\s*)test_session=([^;]+)/)?.[1] ?? null;
      if (!sessionId) {
        return null;
      }
      const roles = sessionRoles[sessionId];
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
