import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Container } from '../../../infrastructure/container';
import { sendApiError, sendMappedApiError } from './error-response';
import { AgentApiAuth } from './agent-api-auth';
import { AdminAuth, adminGuard } from './admin-auth';
import { CreateAgentSessionUseCase } from '../../../application/usecases/agent-session/create-agent-session.usecase';
import { ListAgentSessionsUseCase } from '../../../application/usecases/agent-session/list-agent-sessions.usecase';
import { RevokeAgentSessionUseCase } from '../../../application/usecases/agent-session/revoke-agent-session.usecase';
import { AgentSessionArea } from '../../../application/ports/outbound/agent-session.port';

const VALID_AREAS: AgentSessionArea[] = ['discovery', 'public-read', 'proposal'];

const AREA_TOKEN_HEADERS: Record<AgentSessionArea, string> = {
  discovery: 'x-agent-discovery-token',
  'public-read': 'x-agent-read-token',
  proposal: 'x-agent-proposal-token',
};

function isAgentSessionArea(value: unknown): value is AgentSessionArea {
  return typeof value === 'string' && VALID_AREAS.includes(value as AgentSessionArea);
}

/**
 * The agent-session creation endpoint must prove possession of the bearer token
 * for every area it asks to delegate. Because HTTP only allows a single
 * Authorization header, each area token is supplied in a dedicated header.
 */
function requireSessionCreationAuth(agentAuth: AgentApiAuth) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const body = request.body as { areas?: unknown[] };
    if (!Array.isArray(body.areas) || body.areas.length === 0) {
      return; // Let the route handler return the structured 422 response.
    }

    const areas = body.areas.filter(isAgentSessionArea);
    for (const area of areas) {
      const rawHeader = request.headers[AREA_TOKEN_HEADERS[area]];
      const token = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
      agentAuth.throwIfAreaBearerInvalid(area, token);
    }
  };
}

export function registerAgentSessionRoutes(
  app: FastifyInstance,
  container: Container,
  agentAuth: AgentApiAuth,
  adminAuth: AdminAuth
): void {
  const createUseCase = new CreateAgentSessionUseCase(container.agentSessionRepository, container.config);
  const listUseCase = new ListAgentSessionsUseCase(container.agentSessionRepository);
  const revokeUseCase = new RevokeAgentSessionUseCase(container.agentSessionRepository);

  // Public endpoint: create a session by presenting valid bearer tokens for the requested areas.
  app.post('/agent-sessions', { preHandler: requireSessionCreationAuth(agentAuth) }, async (request, reply) => {
    try {
      const body = request.body as {
        areas?: unknown[];
      };
      if (!Array.isArray(body.areas) || body.areas.length === 0) {
        return sendApiError(reply, request, {
          statusCode: 422,
          code: 'VALIDATION_ERROR',
          message: 'areas is required and must be a non-empty array',
        });
      }
      const areas = body.areas.filter(isAgentSessionArea);
      if (areas.length === 0 || areas.length !== body.areas.length) {
        return sendApiError(reply, request, {
          statusCode: 422,
          code: 'VALIDATION_ERROR',
          message: 'areas must contain only discovery, public-read, or proposal',
        });
      }

      const result = await createUseCase.execute({
        areas,
        createdByIp: request.ip ?? null,
        userAgent: request.headers['user-agent']?.toString() ?? null,
      });
      request.log.info({
        event: 'agent_session_created',
        code: result.code,
        areas: result.areas,
        expiresAt: result.expiresAt.toISOString(),
      }, 'Agent session created');
      return reply.status(201).send({
        code: result.code,
        areas: result.areas,
        expiresAt: result.expiresAt.toISOString(),
      });
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  // Admin: list sessions.
  app.get('/admin/agent-sessions', { preHandler: adminGuard(adminAuth, 'admin') }, async (request, reply) => {
    try {
      const query = request.query as { includeExpired?: string; includeRevoked?: string; limit?: string; offset?: string };
      const sessions = await listUseCase.execute({
        includeExpired: query.includeExpired === 'true',
        includeRevoked: query.includeRevoked === 'true',
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
      return reply.send({
        sessions: sessions.map((session) => ({
          code: session.code,
          areas: session.areas,
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          revokedAt: session.revokedAt?.toISOString() ?? null,
          lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
          createdByIp: session.createdByIp,
          lastUsedIp: session.lastUsedIp,
          userAgent: session.userAgent,
        })),
      });
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  // Admin: revoke a session.
  app.delete('/admin/agent-sessions/:code', { preHandler: adminGuard(adminAuth, 'admin') }, async (request, reply) => {
    try {
      const { code } = request.params as { code: string };
      const revoked = await revokeUseCase.execute(code);
      if (!revoked) {
        return sendApiError(reply, request, {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Session not found or already revoked',
        });
      }
      request.log.info({ event: 'agent_session_revoked', code }, 'Agent session revoked');
      return reply.status(204).send();
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });
}
