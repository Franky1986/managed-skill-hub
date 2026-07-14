import Fastify from 'fastify';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile, stat } from 'fs/promises';
import { registerSkillReadRoutes } from './skill-read.controller';
import { AgentApiAuth } from './agent-api-auth';
import { registerApiErrorHandler } from './error-response';

const execFileAsync = promisify(execFile);

describe('Agent credential setup script client flow', () => {
  const runDir = path.resolve('.tmp/setup-script-client-flow');
  const fakeHome = path.join(runDir, 'home');
  const scriptPath = path.join(runDir, 'setup-managed-skill-hub.sh');

  beforeEach(async () => {
    await mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it('generates a no-secret script, saves client-entered tokens, and the read token authenticates API calls', async () => {
    const app = Fastify({ logger: false });
    registerApiErrorHandler(app);

    // In a real deployment the operator configures the server with a token
    // and the agent/user enters the same token into the setup script. The
    // script itself never contains the server-side secret.
    const readToken = 'operator-shared-read-token-123';
    const proposalToken = 'operator-shared-proposal-token-456';

    const container = {
      config: {
        openapiYamlPath: '/nonexistent/openapi.yaml',
        proposalMaxFiles: 30,
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
        proposalDisallowedPaths: [],
        autoPublishOnGreen: false,
        registryId: 'setup-test',
        registryName: 'Setup Test Registry',
        publicApiBaseUrl: 'https://skills.example.com/api',
        publicReadAuthMode: 'bearer',
        publicReadBearerToken: readToken,
        publicReadBearerActor: 'test-read-agent',
        proposalAuthMode: 'bearer',
        proposalBearerToken: proposalToken,
        proposalBearerActor: 'test-proposal-agent',
        discoveryAuthMode: 'none',
      },
      nameSuggestion: {} as unknown as import('../../../infrastructure/container').Container['nameSuggestion'],
      skillQuery: {
        listPublishedSummaries: async () => [],
        listCategories: async () => [],
        listTags: async () => [],
      } as unknown as import('../../../infrastructure/container').Container['skillQuery'],
    } as import('../../../infrastructure/container').Container;

    registerSkillReadRoutes(app, container, new AgentApiAuth(container.config));

    const discover = await app.inject({ method: 'GET', url: '/discover' });
    const discoverPayload = JSON.parse(discover.payload);
    expect(discoverPayload.readAuthRequired).toBe(true);
    expect(discoverPayload.proposalAuthRequired).toBe(true);
    expect(discoverPayload.credentialSetupScriptUrl).toBe('https://skills.example.com/api/agent-credentials/setup.sh');
    expect(discoverPayload.authSchemes.map((s: { id: string }) => s.id)).toEqual(['public-read-bearer', 'proposal-bearer']);

    const scriptResponse = await app.inject({ method: 'GET', url: '/agent-credentials/setup.sh' });
    expect(scriptResponse.statusCode).toBe(200);
    expect(scriptResponse.headers['content-type']).toBe('text/x-shellscript');
    expect(String(scriptResponse.headers['content-disposition'])).toContain('attachment');

    const scriptContent = scriptResponse.payload;
    expect(scriptContent).toContain("MSH_REGISTRY_ID='setup-test'");
    expect(scriptContent).toContain("MSH_REQUIRE_READ='true'");
    expect(scriptContent).toContain("MSH_REQUIRE_PROPOSAL='true'");
    expect(scriptContent).toContain('Read bearer token');
    expect(scriptContent).toContain('Proposal bearer token');
    expect(scriptContent).not.toContain(readToken);
    expect(scriptContent).not.toContain(proposalToken);

    await rm(fakeHome, { recursive: true, force: true });
    await mkdir(fakeHome, { recursive: true, mode: 0o700 });
    await writeFile(scriptPath, scriptContent, { mode: 0o700 });

    const { stdout, stderr } = await execFileAsync('bash', [scriptPath, '--terminal'], {
      env: {
        ...process.env,
        HOME: fakeHome,
        MANAGED_SKILL_HUB_READ_TOKEN: readToken,
        MANAGED_SKILL_HUB_PROPOSAL_TOKEN: proposalToken,
      },
      timeout: 30000,
    });

    expect(stdout).toContain('Credentials saved for setup-test');
    expect(stderr).toBe('');

    const credentialsPath = path.join(fakeHome, '.managed-skill-hub', 'credentials.json');
    const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
    expect(credentials.defaultRegistry).toBe('setup-test');
    expect(credentials.registries['setup-test']).toMatchObject({
      url: 'https://skills.example.com/api',
      name: 'Setup Test Registry',
      readToken,
      proposalToken,
    });

    const credMode = (await stat(credentialsPath)).mode.toString(8);
    expect(credMode.endsWith('600')).toBe(true);
    const dirMode = (await stat(path.join(fakeHome, '.managed-skill-hub'))).mode.toString(8);
    expect(dirMode.endsWith('700')).toBe(true);

    // Prove the saved read token actually authenticates against the registry.
    const noAuthRead = await app.inject({ method: 'GET', url: '/skills' });
    expect(noAuthRead.statusCode).toBe(401);

    const withReadToken = await app.inject({
      method: 'GET',
      url: '/skills',
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(withReadToken.statusCode).toBe(200);

    const wrongToken = await app.inject({
      method: 'GET',
      url: '/skills',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(wrongToken.statusCode).toBe(401);
  });
});
