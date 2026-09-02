import { FastifyInstance } from 'fastify';
import { Container } from '../../../infrastructure/container';
import { AdminAuth, adminActor, adminGuard } from './admin-auth';
import { sendApiError, sendMappedApiError } from './error-response';
import { resolveArtifactMimeType } from '../../../domain/files/artifact-mime';
import { NotFoundError } from '../../../domain/errors';
import { operationResponse } from './operation-response';

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
      if (!await container.proposalRead.getDetail(proposalId)) throw new NotFoundError(`Proposal ${proposalId} not found`);
      const operation = await container.operations.start({ kind: 'rejudge_proposal', proposalId, requestedBy: adminActor(request) });
      return reply.code(202).send(operationResponse(operation));
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.post('/admin/proposals/:proposalId/files/:fileId/judge', guard, async (request, reply) => {
    try {
      const { proposalId, fileId } = request.params as { proposalId: string; fileId: string };
      const proposal = await container.proposalRead.getDetail(proposalId);
      if (!proposal) throw new NotFoundError(`Proposal ${proposalId} not found`);
      if (!proposal.files.some((file) => file.path === fileId || file.id === fileId)) throw new NotFoundError(`Proposal file ${fileId} not found`);
      const operation = await container.operations.start({ kind: 'rejudge_proposal_file', proposalId, filePath: fileId, requestedBy: adminActor(request) });
      return reply.code(202).send(operationResponse(operation));
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.post('/admin/judge/skill/:skillId/version/:version', guard, async (request, reply) => {
    try {
      const { skillId, version } = request.params as { skillId: string; version: string };
      const skill = await container.adminSkillRead.getSkillDetail(skillId);
      if (!skill.versions.some((candidate) => candidate.version === version)) throw new NotFoundError(`Skill version ${version} not found`);
      const operation = await container.operations.start({ kind: 'rejudge_skill_version', skillId, skillVersion: version, requestedBy: adminActor(request) });
      return reply.code(202).send(operationResponse(operation));
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
