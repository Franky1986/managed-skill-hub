import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  HttpRequestObservation,
  ObservabilityArea,
  ObservabilityPort,
} from '../../../application/ports/outbound/observability.port';
import {
  computeArtifactId,
  computeSkillUuid,
  computeVersionUuid,
} from '../../../application/usecases/skill/public-metadata';

const requestStartKey = Symbol('requestStartNs');

type TimedRequest = FastifyRequest & { [requestStartKey]?: bigint };

export function registerHttpObservability(app: FastifyInstance, observability: ObservabilityPort): void {
  app.addHook('onRequest', async (request) => {
    (request as TimedRequest)[requestStartKey] = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const startedAt = (request as TimedRequest)[requestStartKey] ?? process.hrtime.bigint();
    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
    const observation = buildHttpRequestObservation(request, reply, durationMs);
    observability.recordHttpRequest(observation);

    request.log.info(
      {
        traceId: observation.traceId,
        method: observation.method,
        route: observation.route,
        statusCode: observation.statusCode,
        durationMs: observation.durationMs,
        area: observation.area,
        skillId: observation.skillId,
        proposalId: observation.proposalId,
        fileId: observation.fileId,
        skillUuid: observation.skillUuid,
        versionUuid: observation.versionUuid,
        artifactId: observation.artifactId,
      },
      'request completed'
    );
  });
}

export function buildHttpRequestObservation(
  request: FastifyRequest,
  reply: FastifyReply,
  durationMs: number
): HttpRequestObservation {
  const route = getRoutePattern(request);
  const params = getParams(request);
  const skillId = params.skillId ?? null;
  const proposalId = params.proposalId ?? null;
  const fileId = params.fileId ?? null;
  const version = params.version ?? getQueryVersion(request);

  return {
    traceId: request.id,
    method: request.method.toUpperCase(),
    route,
    url: request.url,
    statusCode: reply.statusCode,
    durationMs,
    area: classifyObservabilityArea(route, request.method),
    timestamp: new Date(),
    skillId,
    proposalId,
    fileId,
    skillUuid: skillId ? computeSkillUuid(skillId) : null,
    versionUuid: skillId && version ? computeVersionUuid(skillId, version) : null,
    artifactId: skillId && version && fileId ? computeArtifactId(skillId, version, fileId) : null,
  };
}

export function classifyObservabilityArea(route: string, method: string): ObservabilityArea {
  const normalizedMethod = method.toUpperCase();
  const normalizedRoute = route.toLowerCase();

  if (normalizedRoute.startsWith('/admin/login') || normalizedRoute.startsWith('/admin/logout')) {
    return 'auth';
  }
  if (normalizedRoute.startsWith('/admin/observability')) {
    return 'observability';
  }
  if (normalizedRoute.includes('/extracted-content') || normalizedRoute.includes('/re-extract') || normalizedRoute.startsWith('/admin/judge/file')) {
    return 'extraction';
  }
  if (normalizedRoute.includes('/publish') || normalizedRoute.includes('/deprecate')) {
    return 'publish';
  }
  if (
    normalizedRoute.includes('/submit-review') ||
    normalizedRoute.includes('/approve') ||
    normalizedRoute.includes('/re-judge') ||
    normalizedRoute.includes('/convert') ||
    normalizedRoute.includes('/reject') ||
    normalizedRoute.startsWith('/judgements')
  ) {
    return 'review';
  }
  if (normalizedRoute.startsWith('/proposals')) {
    return 'proposal';
  }
  if (normalizedRoute.startsWith('/admin/proposals')) {
    return normalizedMethod === 'GET' ? 'review' : 'proposal';
  }
  if (normalizedRoute.includes('/files/')) {
    return normalizedMethod === 'GET' ? 'viewer' : 'review';
  }
  if (
    normalizedRoute.startsWith('/discover') ||
    normalizedRoute.startsWith('/skills') ||
    normalizedRoute.startsWith('/categories')
  ) {
    return 'retrieval';
  }

  return 'other';
}

function getRoutePattern(request: FastifyRequest): string {
  const routeOptions = request.routeOptions as { url?: string } | undefined;
  return routeOptions?.url ?? request.url.split('?')[0] ?? request.url;
}

function getParams(request: FastifyRequest): Record<string, string | undefined> {
  if (!request.params || typeof request.params !== 'object') {
    return {};
  }
  return request.params as Record<string, string | undefined>;
}

function getQueryVersion(request: FastifyRequest): string | null {
  if (!request.query || typeof request.query !== 'object') {
    return null;
  }
  const query = request.query as Record<string, unknown>;
  return typeof query.version === 'string' && query.version.trim().length > 0 ? query.version.trim() : null;
}
