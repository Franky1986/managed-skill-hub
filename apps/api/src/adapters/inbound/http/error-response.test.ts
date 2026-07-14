import { describe, expect, it, vi } from 'vitest';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AgentAuthRequiredError, ConfigurationError, ForbiddenError, JudgerUnavailableError, ValidationError } from '../../../domain/errors';
import { sendMappedApiError } from './error-response';

function createReplyStub() {
  const state: { statusCode?: number; payload?: unknown } = {};
  const reply = {
    code: vi.fn((statusCode: number) => {
      state.statusCode = statusCode;
      return reply;
    }),
    send: vi.fn((payload: unknown) => {
      state.payload = payload;
      return reply;
    }),
  } as unknown as FastifyReply;

  return { reply, state };
}

function createRequestStub(overrides: Partial<FastifyRequest> = {}) {
  return {
    id: 'req-123',
    url: '/skills/example',
    log: {
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  } as unknown as FastifyRequest;
}

describe('error-response', () => {
  it('maps known validation errors to normalized payloads', () => {
    const request = createRequestStub();
    const { reply, state } = createReplyStub();

    sendMappedApiError(reply, request, new ValidationError('title is required'));

    expect(state.statusCode).toBe(422);
    expect(state.payload).toEqual({
      error: 'title is required',
      code: 'VALIDATION_ERROR',
      requestId: 'req-123',
    });
    expect(request.log.warn).toHaveBeenCalled();
  });

  it('maps authenticated ownership failures to forbidden responses', () => {
    const request = createRequestStub();
    const { reply, state } = createReplyStub();

    sendMappedApiError(reply, request, new ForbiddenError('Proposal belongs to another actor'));

    expect(state.statusCode).toBe(403);
    expect(state.payload).toEqual({
      error: 'Proposal belongs to another actor',
      code: 'FORBIDDEN',
      requestId: 'req-123',
    });
  });

  it('hides original unexpected errors on public routes', () => {
    const request = createRequestStub();
    const { reply, state } = createReplyStub();

    sendMappedApiError(reply, request, new Error('database exploded'));

    expect(state.statusCode).toBe(500);
    expect(state.payload).toEqual({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId: 'req-123',
    });
    expect(request.log.error).toHaveBeenCalled();
  });

  it('includes original unexpected errors on admin routes', () => {
    const request = createRequestStub({ url: '/admin/skills/example' });
    const { reply, state } = createReplyStub();

    sendMappedApiError(reply, request, new Error('database exploded'), { admin: true });

    expect(state.statusCode).toBe(500);
    expect(state.payload).toEqual({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId: 'req-123',
      originalError: 'database exploded',
    });
  });

  it('maps agent-session area miss to a 401 with session context and auth URL', () => {
    const request = createRequestStub();
    const { reply, state } = createReplyStub();

    sendMappedApiError(
      reply,
      request,
      new AgentAuthRequiredError(
        'proposal',
        'bearer',
        'http://localhost:3040/discover',
        ['public-read'],
        'http://localhost:3041/frontend/agent-auth'
      )
    );

    expect(state.statusCode).toBe(401);
    expect(state.payload).toMatchObject({
      code: 'UNAUTHORIZED',
      details: {
        authRequired: true,
        authArea: 'proposal',
        authScheme: 'bearer',
        discoverUrl: 'http://localhost:3040/discover',
        sessionAreas: ['public-read'],
        agentSessionUrl: 'http://localhost:3041/frontend/agent-auth',
      },
    });
    expect((state.payload as Record<string, unknown>).details).toHaveProperty('recommendation');
  });

  it('maps plain agent auth required to a 401 without session context', () => {
    const request = createRequestStub();
    const { reply, state } = createReplyStub();

    sendMappedApiError(reply, request, new AgentAuthRequiredError('public-read', 'bearer', 'http://localhost:3040/discover', [], 'http://localhost:3041/frontend/agent-auth'));

    expect(state.statusCode).toBe(401);
    expect((state.payload as Record<string, unknown>).details).not.toHaveProperty('sessionAreas');
    expect((state.payload as Record<string, unknown>).details).toHaveProperty('agentSessionUrl');
  });

  it('does not expose raw provider failure details to admin clients', () => {
    const request = createRequestStub({ url: '/admin/proposals/proposal-1/judge' });
    const { reply, state } = createReplyStub();

    sendMappedApiError(
      reply,
      request,
      new JudgerUnavailableError('provider request failed with sensitive upstream details'),
      { admin: true }
    );

    expect(state.statusCode).toBe(503);
    expect(state.payload).toEqual({
      error: 'Judgement provider is unavailable or misconfigured',
      code: 'JUDGER_UNAVAILABLE',
      requestId: 'req-123',
    });
  });
});

describe('error-response configuration error mapping', () => {
  it('maps ConfigurationError to a normalized CONFIGURATION_ERROR payload', () => {
    const request = createRequestStub();
    const { reply, state } = createReplyStub();

    sendMappedApiError(reply, request, new ConfigurationError('DATA_DIR is not writable'));

    expect(state.statusCode).toBe(503);
    expect(state.payload).toEqual({
      error: 'DATA_DIR is not writable',
      code: 'CONFIGURATION_ERROR',
      requestId: 'req-123',
    });
    expect(request.log.error).toHaveBeenCalled();
  });
});
