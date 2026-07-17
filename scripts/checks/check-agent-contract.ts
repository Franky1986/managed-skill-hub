import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { AgentApiAuth } from '../../apps/api/src/adapters/inbound/http/agent-api-auth';
import { registerApiErrorHandler } from '../../apps/api/src/adapters/inbound/http/error-response';
import { registerProposalRoutes } from '../../apps/api/src/adapters/inbound/http/proposal.controller';
import { registerSkillReadRoutes } from '../../apps/api/src/adapters/inbound/http/skill-read.controller';
import { registerAgentSessionRoutes } from '../../apps/api/src/adapters/inbound/http/agent-session.controller';
import type { AppConfig } from '../../apps/api/src/infrastructure/config';
import type { Container } from '../../apps/api/src/infrastructure/container';
import { createScriptAppConfig } from '../lib/script-app-config';

const requireFromScript = createRequire(import.meta.url);
const Fastify = requireFromScript('fastify') as typeof import('fastify');

type AuthProfile = 'open' | 'proposal-auth';

interface CheckResult {
  id: string;
  passed: true;
  checks: Record<string, boolean>;
}

function config(profile: AuthProfile): AppConfig {
  return createScriptAppConfig({
    registryId: 'agent-contract-registry',
    registryName: 'Agent Contract Registry',
    publicApiBaseUrl: 'https://contract.example.com/api',
    proposalAuthMode: profile === 'proposal-auth' ? 'bearer' : 'none',
    proposalBearerToken: profile === 'proposal-auth' ? 'proposal-token' : null,
    openapiYamlPath: 'packages/openapi/skill-registry.openapi.yaml',
    agentSessionEnabled: true,
    agentSessionMaxActive: null,
  });
}

function container(profile: AuthProfile): Container {
  return {
    config: config(profile),
    nameSuggestion: {
      suggestSkillId: async () => ({ suggestion: 'contract-skill', alternatives: [], isAvailable: true }),
    } as unknown as Container['nameSuggestion'],
    skillQuery: {
      listCategories: async () => ['automation'],
      listTags: async () => ['agent'],
    } as unknown as Container['skillQuery'],
    proposalRead: {
      getNotice: async () => ({
        hasNewProposals: false,
        totalPending: 0,
        counts: { in_upload: 0, submitted: 0, judged: 0, converted: 0 },
      }),
    } as unknown as Container['proposalRead'],
  } as Container;
}

async function buildApp(profile: AuthProfile) {
  const app = Fastify({ logger: false });
  const c = container(profile);
  const auth = new AgentApiAuth(c.config);
  registerSkillReadRoutes(app, c, auth);
  registerProposalRoutes(app, c, auth);
  if (profile === 'proposal-auth') {
    c.agentSessionRepository = {
      create: async () => undefined,
    } as unknown as Container['agentSessionRepository'];
    registerAgentSessionRoutes(app, c, auth, {
      mode: 'simple',
      validate: async () => null,
      requireRole: async () => null,
    } as unknown as import('../../apps/api/src/adapters/inbound/http/admin-auth').AdminAuth);
  }
  registerApiErrorHandler(app);
  return app;
}

function parseJson(payload: string): any {
  return payload ? JSON.parse(payload) : null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function runProfile(profile: AuthProfile): Promise<CheckResult> {
  const app = await buildApp(profile);
  const discoverResponse = await app.inject({ method: 'GET', url: '/discover' });
  const howToResponse = await app.inject({ method: 'GET', url: '/howToPropose' });
  const categoriesResponse = await app.inject({ method: 'GET', url: '/categories' });
  const legacySetupResponse = await app.inject({ method: 'GET', url: '/agent-credentials/setup.sh' });
  await app.close();

  assert(discoverResponse.statusCode === 200, profile + ' discover status');
  assert(howToResponse.statusCode === 200, profile + ' howToPropose status');
  assert(categoriesResponse.statusCode === 200, profile + ' categories status');
  assert(legacySetupResponse.statusCode === 404, profile + ' legacy setup route removed');

  const discover = parseJson(discoverResponse.payload);
  const howTo = parseJson(howToResponse.payload);
  const categories = parseJson(categoriesResponse.payload);
  const entrypointPaths = new Set((discover.entrypoints ?? []).map((entry: { path: string }) => entry.path));
  const hasAnyAuth = profile === 'proposal-auth';

  const checks = {
    registryIdentityPresent: discover.registryId === 'agent-contract-registry' && discover.apiBaseUrl === 'https://contract.example.com/api',
    publishedSkillDownloadEntrypoint: entrypointPaths.has('/skills/{skillId}/package'),
    proposalSubmitEntrypoint: entrypointPaths.has('/proposals'),
    proposalStatusEntrypoint: entrypointPaths.has('/proposals/:id/status'),
    howToEntrypoint: entrypointPaths.has('/howToPropose'),
    networkContextGuidancePresent: discover.agentHttpGuidance?.toolSelection?.includes('network context, not curl itself')
      && howTo.agentHttpGuidance?.toolSelection === discover.agentHttpGuidance?.toolSelection,
    retrievalSequencePresent: discover.agentHttpGuidance?.retrievalSequence?.some(
      (instruction: string) => instruction.includes('/skills/search')
    ) && discover.agentHttpGuidance?.retrievalSequence?.some(
      (instruction: string) => instruction.includes('/skills/{skillId}/package')
    ),
    endpointSpecificAuthDiagnosisPresent: discover.agentHttpGuidance?.authenticationDiagnosis?.some(
      (instruction: string) => instruction.includes('/admin/session')
    ) && discover.agentHttpGuidance?.authenticationDiagnosis?.some(
      (instruction: string) => instruction.includes('exact same URL')
    ),
    authorizationGuidanceMatchesProfile: discover.agentHttpGuidance?.authorization?.discovery?.required === false
      && discover.agentHttpGuidance?.authorization?.publicRead?.required === false
      && discover.agentHttpGuidance?.authorization?.proposal?.required === hasAnyAuth
      && howTo.agentHttpGuidance?.authorization?.proposal?.required === hasAnyAuth,
    curlExamplesCarryAuthArea: discover.agentHttpGuidance?.curlExamples?.search?.authArea === 'public-read'
      && discover.agentHttpGuidance?.curlExamples?.search?.authorizationRequired === false
      && discover.agentHttpGuidance?.curlExamples?.discover?.authArea === 'discovery',
    safeResponseHandlingPresent: discover.agentHttpGuidance?.responseHandling?.rules?.some(
      (instruction: string) => instruction.includes('curl -f')
    ) && discover.agentHttpGuidance?.responseHandling?.validationGate?.includes('canFinalize=true')
      && howTo.agentHttpGuidance?.responseHandling?.validationGate === discover.agentHttpGuidance?.responseHandling?.validationGate,
    proposalWorkflowMatches: discover.proposalWorkflow?.version === '1.1'
      && discover.proposalWorkflow?.executionMode === 'sequential_state_machine'
      && JSON.stringify(discover.proposalWorkflow) === JSON.stringify(howTo.proposalWorkflow)
      && discover.proposalWorkflow?.activeUploadInvariant?.maximumActiveProposalIdsPerIntent === 1
      && discover.proposalWorkflow?.activeUploadInvariant?.conflictCode === 'PROPOSAL_UPLOAD_ALREADY_OPEN'
      && discover.proposalWorkflow?.steps?.some(
        (step: { id?: string; success?: string }) => step.id === 'validate_upload' && step.success?.includes('blockingFindingCount=0')
      )
      && discover.proposalWorkflow?.steps?.some(
        (step: { id?: string; recovery?: string }) => step.id === 'create_proposal'
          && step.recovery?.includes('details.proposalId')
      ),
    categoryPolicyIsOpen: categories.policy === 'open'
      && categories.itemsAreSuggestions === true
      && categories.customCategoriesAllowed === true
      && categories.instruction?.includes('not an allowlist')
      && howTo.categoryPolicy?.customCategoriesAllowed === true,
    legacySetupUrlAbsent: discover.credentialSetupScriptUrl === undefined
      && howTo.apiNotes?.credentialSetupScriptUrl === undefined,
    agentSessionPresenceMatchesAuth: discover.authSchemes.some(
      (scheme: { type: string }) => scheme.type === 'agent-session'
    ) === hasAnyAuth,
    agentSessionUrlMatchesAuth: hasAnyAuth
      ? discover.authSchemes.some(
          (scheme: { type: string; url?: string }) => scheme.type === 'agent-session'
            && scheme.url === 'https://contract.example.com/frontend/agent-auth'
        )
      : true,
    howToFirstStepMatchesAuth: howTo.requiredSteps?.[0]?.title === (hasAnyAuth ? 'Delegate access through the agent-auth page' : 'Read this workflow first'),
    packageRulesPresent: JSON.stringify(howTo).includes('SKILL.md') && JSON.stringify(howTo).includes('finalize-upload'),
    preUploadPackageProofPresent: howTo.preUploadPackageProof?.requiredBeforeProposalCreation === true
      && JSON.stringify(howTo.preUploadPackageProof).includes('.cursor/skills/')
      && JSON.stringify(howTo.preUploadPackageProof).includes('POST /proposals'),
    outsideRootDecisionGatePresent: howTo.externalArtifactDecision?.requiredBeforeProposalCreation === true
      && JSON.stringify(howTo.externalArtifactDecision).includes('external_service_or_capability')
      && JSON.stringify(howTo.externalArtifactDecision).includes('local_portable_artifact')
      && JSON.stringify(howTo.externalArtifactDecision).includes('ambiguous_dependency')
      && JSON.stringify(howTo.externalArtifactDecision).includes('include_portably')
      && JSON.stringify(howTo.externalArtifactDecision).includes('keep_external_prerequisite')
      && JSON.stringify(howTo.externalArtifactDecision).includes('remove_or_rewrite_dependency')
      && JSON.stringify(howTo.externalArtifactDecision).includes('Figma')
      && howTo.requiredSteps?.some(
        (step: { title?: string; checks?: string[] }) => step.title === 'Resolve outside-root artifacts with the user'
          && step.checks?.some((check) => check.includes('Do not call POST /proposals'))
      ),
    legacySetupRouteRemoved: legacySetupResponse.statusCode === 404,
  };

  for (const [name, passed] of Object.entries(checks)) {
    assert(passed, profile + ' check failed: ' + name);
  }

  return { id: profile, passed: true, checks };
}

async function main(): Promise<void> {
  const bootstrap = await readFile('docs/product/AGENT_BOOTSTRAP.md', 'utf8');
  assert(bootstrap.includes('/discover'), 'agent bootstrap must reference /discover');
  assert(bootstrap.includes('/howToPropose'), 'agent bootstrap must reference /howToPropose');
  assert(bootstrap.includes('network context, not `curl` itself'), 'agent bootstrap must explain local network execution context');
  assert(bootstrap.includes('/admin/session'), 'agent bootstrap must reject unrelated admin-session auth inference');
  assert(bootstrap.includes('paste bearer tokens into chat') || bootstrap.includes('paste bearer tokens into normal chat') || bootstrap.includes('never paste bearer tokens'), 'agent bootstrap must warn against pasting bearer tokens into chat');
  assert(bootstrap.includes('Do not use `curl -f`'), 'agent bootstrap must preserve structured HTTP error bodies');
  assert(bootstrap.includes('not an allowlist'), 'agent bootstrap must explain the open category policy');
  assert(bootstrap.includes('PROPOSAL_UPLOAD_ALREADY_OPEN'), 'agent bootstrap must explain active-upload recovery');
  assert(bootstrap.includes('exactly one active proposal id'), 'agent bootstrap must require one active upload id');

  const results = [await runProfile('open'), await runProfile('proposal-auth')];
  const report = {
    name: 'agent-contract',
    totalProfiles: results.length,
    passedProfiles: results.length,
    failedProfiles: 0,
    results,
  };
  const lines = [
    'agent-contract',
    'totalProfiles=' + report.totalProfiles,
    'passedProfiles=' + report.passedProfiles,
    'failedProfiles=' + report.failedProfiles,
    ...results.map((result) => 'PASS ' + result.id + ' checks=' + Object.keys(result.checks).length),
    'RESULT=PASS',
  ];

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/agent-contract.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/agent-contract.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
