import { FastifyInstance } from 'fastify';
import { Container } from '../../../infrastructure/container';
import { AdminAuth, adminGuard } from './admin-auth';
import { sendApiError, sendMappedApiError } from './error-response';
import { resolveArtifactMimeType } from '../../../domain/files/artifact-mime';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export function registerJudgementRoutes(
  app: FastifyInstance,
  container: Container,
  auth: AdminAuth
): void {
  const guard = { preHandler: adminGuard(auth, 'reviewer') };

  app.post('/admin/proposals/:proposalId/judge', guard, async (request, reply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const judgement = await container.judgeProposal.execute(proposalId);
      return reply.send(judgement);
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.post('/admin/proposals/:proposalId/files/:fileId/judge', guard, async (request, reply) => {
    try {
      const { proposalId, fileId } = request.params as { proposalId: string; fileId: string };
      const judgement = await container.judgeProposal.executeFile(proposalId, fileId);
      return reply.send(judgement);
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.post('/admin/judge/skill/:skillId/version/:version', guard, async (request, reply) => {
    try {
      const { skillId, version } = request.params as { skillId: string; version: string };
      const judgement = await container.judgeSkillVersion.execute(skillId, version);
      return reply.send(judgement);
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.post('/admin/judge/file', guard, async (request, reply) => {
    try {
      const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE } });
      if (!data) {
        return sendApiError(reply, request, {
          statusCode: 400,
          code: 'MISSING_UPLOAD',
          message: 'No file uploaded',
        });
      }
      const mimeType = resolveArtifactMimeType(data.mimetype, data.filename);
      const judgement = await container.judgeFile.execute({
        content: await data.toBuffer(),
        mimeType,
        fileName: data.filename,
      });
      return reply.send(judgement);
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.get('/admin/judgements/:targetType/:targetId', guard, async (request, reply) => {
    try {
      const { targetType, targetId } = request.params as {
        targetType: 'proposal' | 'skill' | 'file';
        targetId: string;
      };
      const judgements = await container.listJudgements.execute(targetType, targetId);
      return reply.send({ items: judgements });
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });
}
