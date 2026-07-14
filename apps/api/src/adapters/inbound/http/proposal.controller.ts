import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Container } from '../../../infrastructure/container';
import { sendApiError, sendMappedApiError } from './error-response';
import { AgentApiAuth, getAgentAuthContext } from './agent-api-auth';
import { resolveArtifactMimeType } from '../../../domain/files/artifact-mime';
import { ProposalActor } from '../../../application/ports/inbound/proposal-command.port';
import { deriveFinalizeJudgementStatus } from '../../../application/usecases/judgement/judgement-execution-status';

export type ProposalRateLimiter = ReturnType<typeof createProposalRateLimiter>;

export function registerProposalRoutes(
  app: FastifyInstance,
  container: Container,
  agentAuth = new AgentApiAuth(container.config),
  proposalRateLimiter = createProposalRateLimiter(container.config)
): void {
  const proposalGuard = { preHandler: [agentAuth.guard('proposal'), proposalRateLimiter] };
  app.post('/proposals', proposalGuard, async (request, reply) => {
    try {
      const body = request.body as {
        skillId?: string;
        title: string;
        description: string;
        category: string;
        tags?: string[];
        capabilities?: string[];
        entrypoint?: string;
      };
      const actor = resolveProposalActor(request);
      const proposal = await container.proposalCommand.submitProposal(
        {
          skillId: body.skillId,
          title: body.title,
          description: body.description,
          category: body.category,
          tags: body.tags,
          capabilities: body.capabilities,
          entrypoint: body.entrypoint,
        },
        actor
      );
      const rawUrl = request.url ?? request.raw.url ?? '/proposals';
      const prefix = rawUrl.startsWith('/api/') ? '/api' : '';
      const statusPath = `${prefix}/proposals/${proposal.id}/status`;
      const finalizeUploadPath = `${prefix}/proposals/${proposal.id}/finalize-upload`;
      return reply.code(201).send({
        id: proposal.id,
        message:
          'Proposal upload opened. Attach all required files, then explicitly finalize the upload. Judgement and review start only after finalization.',
        statusUrl: statusPath,
        checkUrl: statusPath,
        finalizeUploadUrl: finalizeUploadPath,
      });
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.get('/proposals/notice', proposalGuard, async (_request, reply) => {
    const notice = await container.proposalRead.getNotice();
    return reply.send(notice);
  });

  app.get('/proposals/:proposalId/status', proposalGuard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const status = await container.proposalRead.getPublicStatus(proposalId);
      if (!status) {
        return sendApiError(reply, request, {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Proposal not found',
        });
      }
      return reply.send(status);
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.post('/proposals/check-duplicate', proposalGuard, async (request, reply) => {
    try {
      const body = request.body as {
        skillId?: string;
        title: string;
        description: string;
        category: string;
        tags?: string[];
        capabilities?: string[];
        entrypoint?: string;
        files?: Array<{ path: string; sha256?: string | null }>;
      };
      const result = await container.proposalDuplicateCheck.execute({
        skillId: body.skillId,
        title: body.title,
        description: body.description,
        category: body.category,
        tags: body.tags,
        capabilities: body.capabilities,
        entrypoint: body.entrypoint,
        files: body.files,
      });
      return reply.send(result);
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.patch('/proposals/:proposalId', proposalGuard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const actor = resolveProposalActor(request);
      const body = request.body as {
        title?: string;
        description?: string;
        category?: string;
        tags?: string[];
        capabilities?: string[];
        entrypoint?: string | null;
      };
      const proposal = await container.proposalCommand.updateProposalMetadata(
        proposalId,
        {
          title: body.title,
          description: body.description,
          category: body.category,
          tags: body.tags,
          capabilities: body.capabilities,
          entrypoint: body.entrypoint,
        },
        actor
      );
      return reply.send({
        id: proposal.id,
        status: proposal.status,
        title: proposal.title,
        description: proposal.description,
        category: proposal.category,
        tags: proposal.tags,
        capabilities: proposal.capabilities,
        entrypoint: proposal.entrypoint,
      });
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.post('/proposals/:proposalId/files', proposalGuard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const actor = resolveProposalActor(request);
      const data = await request.file({ limits: { fileSize: container.config.proposalMaxFileSizeBytes } });
      if (!data) {
        return sendApiError(reply, request, {
          statusCode: 400,
          code: 'MISSING_UPLOAD',
          message: 'No file uploaded',
        });
      }
      const buffer = await data.toBuffer();
      const mimeType = resolveArtifactMimeType(data.mimetype, data.filename);
      const resolvedPath = readMultipartFieldValue(data.fields.path) ?? data.filename;
      const proposal = await container.proposalCommand.attachFile(
        proposalId,
        {
          path: resolvedPath,
          content: buffer,
          mimeType,
        },
        actor
      );
      return reply.send({ id: proposal.id, files: proposal.files });
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.post('/proposals/:proposalId/validate-upload', proposalGuard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const actor = resolveProposalActor(request);
      const result = await container.proposalCommand.validateUpload(proposalId, actor);
      return reply.send(result);
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.post('/proposals/:proposalId/finalize-upload', proposalGuard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const actor = resolveProposalActor(request);
      const result = await container.proposalCommand.finalizeUpload(proposalId, actor);
      const proposal = result.proposal;
      const rawUrl = request.url ?? request.raw.url ?? `/proposals/${proposalId}/finalize-upload`;
      const prefix = rawUrl.startsWith('/api/') ? '/api' : '';
      const statusPath = `${prefix}/proposals/${proposal.id}/status`;
      const autoPublishStatus = !result.autoPublish.enabled
        ? 'disabled'
        : result.autoPublish.autoPublished
        ? 'published'
        : 'skipped';
      const judgementStatus = deriveFinalizeJudgementStatus(proposal);
      return reply.send({
        id: proposal.id,
        status: proposal.status,
        message: judgementStatus === 'completed'
          ? 'Proposal upload finalized and all automatic judgements completed.'
          : 'Proposal upload finalized, but one or more automatic judgements are unavailable or failed. Review the admin judgement status before publishing.',
        statusUrl: statusPath,
        checkUrl: statusPath,
        uploadFinalized: true,
        judgementStatus,
        autoPublishStatus,
        autoPublishBlockedReason: result.autoPublish.blockedReason,
      });
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.delete('/proposals/:proposalId', proposalGuard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const actor = resolveProposalActor(request);
      await container.proposalCommand.deleteProposal(proposalId, actor);
      return reply.code(204).send();
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });
}

export function createProposalRateLimiter(config: Container['config']) {
  const windowMs = config.proposalRateLimitWindowMs ?? 60_000;
  const maxRequests = config.proposalRateLimitMaxRequests ?? 120;
  const maxBuckets = config.proposalRateLimitMaxBuckets ?? 10_000;
  const buckets = new Map<string, { windowStart: number; count: number }>();
  let lastCleanupAt = 0;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    const key = proposalRateLimitKey(request);
    if (now - lastCleanupAt >= windowMs || buckets.size >= maxBuckets) {
      removeExpiredRateLimitBuckets(buckets, now, windowMs);
      lastCleanupAt = now;
    }

    const current = buckets.get(key);
    let bucket = current && now - current.windowStart < windowMs ? current : undefined;
    if (!bucket) {
      if (!current && buckets.size >= maxBuckets) {
        const retryAfterSeconds = retryAfterForOldestBucket(buckets, now, windowMs);
        return sendProposalRateLimitError(
          request,
          reply,
          'PROPOSAL_RATE_LIMIT_CAPACITY_EXCEEDED',
          'Proposal API rate-limit identity capacity is temporarily exhausted.',
          windowMs,
          maxRequests,
          retryAfterSeconds
        );
      }
      bucket = { windowStart: now, count: 0 };
    }
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count <= maxRequests) {
      return;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    return sendProposalRateLimitError(
      request,
      reply,
      'PROPOSAL_RATE_LIMIT_EXCEEDED',
      'Proposal API rate limit exceeded. Retry after the current window resets.',
      windowMs,
      maxRequests,
      retryAfterSeconds
    );
  };
}

function sendProposalRateLimitError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: 'PROPOSAL_RATE_LIMIT_EXCEEDED' | 'PROPOSAL_RATE_LIMIT_CAPACITY_EXCEEDED',
  message: string,
  windowMs: number,
  maxRequests: number,
  retryAfterSeconds: number
) {
  return reply
    .code(429)
    .header('Retry-After', String(retryAfterSeconds))
    .send({
      error: 'Too Many Requests',
      code,
      message,
      requestId: request.id,
      details: {
        windowMs,
        maxRequests,
        retryAfterSeconds,
      },
    });
}

function retryAfterForOldestBucket(
  buckets: Map<string, { windowStart: number; count: number }>,
  now: number,
  windowMs: number
): number {
  let earliestReset = now + windowMs;
  for (const bucket of buckets.values()) {
    earliestReset = Math.min(earliestReset, bucket.windowStart + windowMs);
  }
  return Math.max(1, Math.ceil((earliestReset - now) / 1000));
}

function removeExpiredRateLimitBuckets(
  buckets: Map<string, { windowStart: number; count: number }>,
  now: number,
  windowMs: number
): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }
}

function proposalRateLimitKey(request: FastifyRequest): string {
  const auth = getAgentAuthContext(request);
  if (auth?.scheme === 'bearer') {
    return `actor:${auth.actor}`;
  }
  if (auth?.scheme === 'oidc') {
    return `principal:${auth.principal.principalId}:client:${auth.principal.clientId ?? 'unknown'}`;
  }
  return `ip:${request.ip}`;
}

function readMultipartFieldValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item?.value === 'string') {
        const trimmed = item.value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }
  if (value && typeof value === 'object' && 'value' in value && typeof (value as { value?: unknown }).value === 'string') {
    const trimmed = ((value as { value: string }).value).trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function resolveProposalActor(request: import('fastify').FastifyRequest): ProposalActor {
  const context = getAgentAuthContext(request);
  if (context?.scheme === 'bearer') {
    return context.actor;
  }
  if (context?.scheme === 'oidc') {
    return {
      label: context.principal.displayName ?? 'Authenticated user',
      principalId: context.principal.principalId,
      clientId: context.principal.clientId,
    };
  }
  return (request.headers['x-actor'] as string) ?? 'agent';
}
