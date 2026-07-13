import { FastifyInstance } from 'fastify';
import { Container } from '../../../infrastructure/container';
import { AdminAuth, adminActor, adminGuard } from './admin-auth';
import { mapSkillToAdminDetail } from '../../../application/usecases/skill/mappers/skill.mapper';
import { ProposalAdminUpdateRequestDto } from '../../../application/dtos/proposal.dto';
import { sendApiError, sendMappedApiError } from './error-response';
import { sendArtifactResponse } from './artifact-response';

export function registerAdminProposalRoutes(app: FastifyInstance, container: Container, auth: AdminAuth): void {
  const reviewGuard = { preHandler: adminGuard(auth, 'reviewer') };
  const detailGuard = { preHandler: adminGuard(auth, ['reviewer', 'publisher']) };
  const publishGuard = { preHandler: adminGuard(auth, 'publisher') };
  const adminOnlyGuard = { preHandler: adminGuard(auth) };

  app.get('/admin/proposals', reviewGuard, async (request, reply) => {
    const { skillId, status } = request.query as { skillId?: string; status?: string };
    return reply.send(await container.proposalRead.listSummaries(skillId, status));
  });

  app.get('/admin/proposals/notice', reviewGuard, async (_request, reply) => {
    return reply.send(await container.proposalRead.getNotice());
  });

  app.get('/admin/proposals/:proposalId', detailGuard, async (request, reply) => {
    const { proposalId } = request.params as { proposalId: string };
    const proposal = await container.proposalRead.getDetail(proposalId);
    if (!proposal) {
      return sendApiError(reply, request, {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Proposal not found',
      });
    }
    return reply.send(proposal);
  });

  app.get('/admin/proposals/:proposalId/files/:fileId', detailGuard, async (request, reply) => {
    try {
      const { proposalId, fileId } = request.params as { proposalId: string; fileId: string };
      const file = await container.proposalRead.getFile(proposalId, fileId);
      return sendArtifactResponse(reply, file);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.get('/admin/proposals/:proposalId/files/:fileId/extracted-content', detailGuard, async (request, reply) => {
    try {
      const { proposalId, fileId } = request.params as { proposalId: string; fileId: string };
      const extracted = await container.proposalRead.getExtractedContent(proposalId, fileId);
      return reply.send(extracted);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.get('/admin/proposals/:proposalId/files/:fileId/probe', detailGuard, async (request, reply) => {
    try {
      const { proposalId, fileId } = request.params as { proposalId: string; fileId: string };
      const response = await container.probeProposalFileContent.execute(proposalId, fileId);
      return reply.send(response);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });


  app.post('/admin/proposals/:proposalId/files/:fileId/re-extract', reviewGuard, async (request, reply) => {
    try {
      const { proposalId, fileId } = request.params as { proposalId: string; fileId: string };
      const extracted = await container.reextractProposalFile.execute(
        proposalId,
        fileId,
        adminActor(request)
      );
      return reply.send(extracted);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.post('/admin/proposals/:proposalId/convert', publishGuard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const body = (request.body as { comment?: string } | undefined) ?? {};
      const skill = await container.reviewProposal.convertProposal(proposalId, adminActor(request), body.comment);
      return reply.send(mapSkillToAdminDetail(skill));
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.post('/admin/proposals/:proposalId/reject', reviewGuard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const body = (request.body as { reason?: string; comment?: string } | undefined) ?? {};
      const proposal = await container.reviewProposal.rejectProposal(
        proposalId,
        adminActor(request),
        body.reason,
        body.comment
      );
      const detail = await container.proposalRead.getDetail(proposal.id);
      if (!detail) {
        return sendApiError(reply, request, {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Proposal not found',
        });
      }
      return reply.send(detail);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.delete('/admin/proposals/:proposalId', adminOnlyGuard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      await container.reviewProposal.deleteOpenProposal(proposalId, adminActor(request));
      return reply.code(204).send();
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.patch('/admin/proposals/:proposalId', adminOnlyGuard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const body = (request.body as ProposalAdminUpdateRequestDto | undefined) ?? {};
      if (Object.keys(body).length === 0) {
        return sendApiError(reply, request, {
          statusCode: 422,
          code: 'INVALID_REQUEST',
          message: 'No proposal fields provided for update',
        });
      }

      const proposal = await container.reviewProposal.updateProposalMetadata(
        proposalId,
        adminActor(request),
        body
      );
      const detail = await container.proposalRead.getDetail(proposal.id);
      if (!detail) {
        return sendApiError(reply, request, {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Proposal not found',
        });
      }
      return reply.send(detail);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });
}
