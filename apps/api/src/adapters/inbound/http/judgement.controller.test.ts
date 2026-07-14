import Fastify from 'fastify';
import { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { registerJudgementRoutes } from './judgement.controller';
import { ADMIN_COOKIE, SimpleAdminAuth } from './simple-admin-auth';
import { AppConfig } from '../../../infrastructure/config';
import { Container } from '../../../infrastructure/container';
import { Judgement } from '../../../domain/judgement/Judgement';
import { registerApiErrorHandler } from './error-response';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    dataDir: './data',
    openapiYamlPath: '/nonexistent/openapi.yaml',
    apiHost: '127.0.0.1',
    apiPort: 3040,
    adminUser: 'admin',
    adminPassword: 'admin',
    adminPasswordHash: '',
    jwtSecret: 'test-secret',
    sessionTtlSeconds: 3600,
    judgerProvider: 'noop',
    judgerAdapterPath: null,
    vercelAiSdkModel: null,
    vercelAiSdkTimeoutMs: 30000,
    vercelAiSdkMaxTextChars: 12000,
    vercelAiSdkMaxRetries: 0,
    ...overrides,
  };
}

function buildContainer(): Container {
  return {
    judgeProposal: {
      execute: async () =>
        Judgement.create({
          id: 'judgement-proposal',
          targetType: 'proposal',
          targetId: 'proposal-1',
          summary: 'proposal judgement',
          dimensions: {
            safety: {
              risk: 'low',
              score: 0.1,
              reason: 'safe',
            },
          },
        }),
      executeFile: async (_proposalId: string, fileId: string) =>
        Judgement.create({
          id: 'judgement-proposal-file',
          targetType: 'file',
          targetId: `proposal-1:${fileId}`,
          summary: 'proposal file judgement',
          dimensions: {
            safety: { risk: 'low', score: 0.1, reason: 'safe' },
          },
        }),
    },
    judgeSkillVersion: {
      execute: async () =>
        Judgement.create({
          id: 'judgement-skill',
          targetType: 'skill',
          targetId: 'skill-a:1.0.0',
          summary: 'skill judgement',
          dimensions: {
            safety: {
              risk: 'low',
              score: 0.1,
              reason: 'safe',
            },
          },
        }),
    },
    judgeFile: {
      execute: async () =>
        Judgement.create({
          id: 'judgement-file',
          targetType: 'file',
          targetId: 'README.md',
          summary: 'file judgement',
          dimensions: {
            safety: {
              risk: 'low',
              score: 0.1,
              reason: 'safe',
            },
          },
        }),
    },
    listJudgements: {
      execute: async () => [
        Judgement.create({
          id: 'judgement-1',
          targetType: 'skill',
          targetId: 'skill-a:1.0.0',
          summary: 'stored judgement',
          dimensions: {
            safety: {
              risk: 'low',
              score: 0.1,
              reason: 'safe',
            },
          },
        }),
      ],
    },
  } as unknown as Container;
}

function signAdminCookie(appConfig: AppConfig): string {
  const token = jwt.sign({ username: appConfig.adminUser }, appConfig.jwtSecret, {
    expiresIn: appConfig.sessionTtlSeconds,
  });
  return `${ADMIN_COOKIE}=${token}`;
}

async function buildApp(appConfig: AppConfig = config()): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  registerJudgementRoutes(app, buildContainer(), new SimpleAdminAuth(appConfig));
  registerApiErrorHandler(app);
  return app;
}

describe('registerJudgementRoutes', () => {
  it('requires an admin session for on-demand proposal judgements', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/proposals/proposal-1/judge',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
    });
  });

  it('requires an admin session for on-demand skill judgements', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/judge/skill/skill-a/version/1.0.0',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
    });
  });

  it('requires an admin session for direct file judgements', async () => {
    const app = Fastify();
    await app.register(cookie);
    await app.register(multipart);
    registerJudgementRoutes(app, buildContainer(), new SimpleAdminAuth(config()));
    registerApiErrorHandler(app);

    const response = await app.inject({
      method: 'POST',
      url: '/admin/judge/file',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
    });
  });

  it('requires an admin session for stored judgement reads', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/judgements/skill/skill-a%3A1.0.0',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
    });
  });

  it('returns stored judgements for authenticated admins', async () => {
    const appConfig = config();
    const app = await buildApp(appConfig);

    const response = await app.inject({
      method: 'GET',
      url: '/admin/judgements/skill/skill-a%3A1.0.0',
      headers: {
        cookie: signAdminCookie(appConfig),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          id: 'judgement-1',
          targetType: 'skill',
          targetId: 'skill-a:1.0.0',
          summary: 'stored judgement',
        },
      ],
    });
  });

  it('returns on-demand skill judgements for authenticated admins', async () => {
    const appConfig = config();
    const app = await buildApp(appConfig);

    const response = await app.inject({
      method: 'POST',
      url: '/admin/judge/skill/skill-a/version/1.0.0',
      headers: {
        cookie: signAdminCookie(appConfig),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'judgement-skill',
      targetType: 'skill',
      targetId: 'skill-a:1.0.0',
      summary: 'skill judgement',
    });
  });

  it('re-runs a stored proposal file judgement for authenticated admins', async () => {
    const appConfig = config();
    const app = await buildApp(appConfig);

    const response = await app.inject({
      method: 'POST',
      url: '/admin/proposals/proposal-1/files/SKILL.md/judge',
      headers: { cookie: signAdminCookie(appConfig) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'judgement-proposal-file',
      targetType: 'file',
      targetId: 'proposal-1:SKILL.md',
    });
  });
});
