import { FastifyInstance } from 'fastify';
import { Container } from '../../../infrastructure/container';
import { SimpleAdminAuth, adminGuard } from './simple-admin-auth';
import { sendApiError, sendMappedApiError } from './error-response';
import { ValidationError } from '../../../domain/errors';
import { sendArtifactResponse } from './artifact-response';

export function registerAdminSkillRoutes(app: FastifyInstance, container: Container, auth: SimpleAdminAuth): void {
  const guard = { preHandler: adminGuard(auth) };
  const maxFileSize = 5 * 1024 * 1024;

  app.get('/admin/skills', guard, async (_request, reply) => {
    const result = await container.adminSkillRead.listSkillSummaries();
    return reply.send(result);
  });

  app.get('/admin/skills/:skillId', guard, async (request, reply) => {
    try {
      const { skillId } = request.params as { skillId: string };
      const skill = await container.adminSkillRead.getSkillDetail(skillId);
      return reply.send(skill);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.get('/admin/skills/:skillId/files', guard, async (request, reply) => {
    try {
      const { skillId } = request.params as { skillId: string };
      const { version } = request.query as { version?: string };
      const files = await container.adminSkillRead.listFiles(skillId, version);
      return reply.send({ items: files });
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.get('/admin/skills/:skillId/files/:fileId', guard, async (request, reply) => {
    try {
      const { skillId, fileId } = request.params as { skillId: string; fileId: string };
      const { version } = request.query as { version?: string };
      const file = await container.adminSkillRead.getFile(skillId, fileId, version);
      return sendArtifactResponse(reply, file);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.patch('/admin/skills/:skillId/files/:fileId', guard, async (request, reply) => {
    try {
      const { skillId, fileId } = request.params as { skillId: string; fileId: string };
      const { version } = request.query as { version?: string };
      const body = request.body as { path?: string };
      const session = await auth.validate(request);
      const skill = await container.updateSkill.moveFile(
        skillId,
        version ?? '1.0.0',
        fileId,
        { path: body.path ?? '' },
        session?.username ?? 'admin'
      );
      const latest = skill.getAllVersions()[skill.getAllVersions().length - 1];
      return reply.send({ id: skill.id.toString(), version: latest?.version ?? version ?? '1.0.0' });
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.delete('/admin/skills/:skillId/files/:fileId', guard, async (request, reply) => {
    try {
      const { skillId, fileId } = request.params as { skillId: string; fileId: string };
      const { version } = request.query as { version?: string };
      const session = await auth.validate(request);
      const skill = await container.updateSkill.deleteFile(
        skillId,
        version ?? '1.0.0',
        fileId,
        session?.username ?? 'admin'
      );
      const latest = skill.getAllVersions()[skill.getAllVersions().length - 1];
      return reply.send({ id: skill.id.toString(), version: latest?.version ?? version ?? '1.0.0' });
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.put('/admin/skills/:skillId/files/:fileId/content', guard, async (request, reply) => {
    try {
      const { skillId, fileId } = request.params as { skillId: string; fileId: string };
      const { version } = request.query as { version?: string };
      const body = request.body as { content?: unknown; mimeType?: unknown };
      if (typeof body?.content !== 'string') {
        throw new ValidationError('Text file content must be provided as a string');
      }
      const session = await auth.validate(request);
      const skill = await container.updateSkill.uploadFile(
        skillId,
        version ?? '1.0.0',
        {
          path: fileId,
          content: Buffer.from(body.content, 'utf-8'),
          mimeType: typeof body.mimeType === 'string' && body.mimeType.trim().length > 0
            ? body.mimeType.trim()
            : 'text/plain',
        },
        session?.username ?? 'admin'
      );
      const latest = skill.getAllVersions()[skill.getAllVersions().length - 1];
      return reply.send({ id: skill.id.toString(), version: latest?.version ?? version ?? '1.0.0' });
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.get('/admin/skills/:skillId/files/:fileId/extracted-content', guard, async (request, reply) => {
    try {
      const { skillId, fileId } = request.params as { skillId: string; fileId: string };
      const { version } = request.query as { version?: string };
      const extracted = await container.adminSkillRead.getExtractedContent(skillId, fileId, version);
      return reply.send(extracted);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.get('/admin/skills/:skillId/files/:fileId/probe', guard, async (request, reply) => {
    try {
      const { skillId, fileId } = request.params as { skillId: string; fileId: string };
      const { version } = request.query as { version?: string };
      const response = await container.probeSkillFileContent.execute(skillId, fileId, {
        version,
        includeUnpublished: true,
      });
      return reply.send(response);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });


  app.post('/admin/skills/:skillId/files/:fileId/re-extract', guard, async (request, reply) => {
    try {
      const { skillId, fileId } = request.params as { skillId: string; fileId: string };
      const { version } = request.query as { version?: string };
      const session = await auth.validate(request);
      const extracted = await container.reextractSkillFile.execute(
        skillId,
        fileId,
        session?.username ?? 'admin',
        { version }
      );
      return reply.send(extracted);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.post('/admin/skills/:skillId/versions/:version/re-judge', guard, async (request, reply) => {
    try {
      const { skillId, version } = request.params as { skillId: string; version: string };
      const judgement = await container.judgeSkillVersion.execute(skillId, version);
      return reply.send(judgement);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.post('/admin/search/reindex', guard, async (request, reply) => {
    const session = await auth.validate(request);
    const result = await container.reindexSkillSearch.execute(session?.username ?? 'admin');
    return reply.send(result);
  });

  app.post('/admin/projections/rebuild', guard, async (request, reply) => {
    try {
      const { clearProjections } = request.query as { clearProjections?: string };
      const session = await auth.validate(request);
      const result = await container.rebuildProjections.execute(session?.username ?? 'admin', {
        clearProjections: parseBoolean(clearProjections),
      });
      return reply.send(result);
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.post('/admin/skills', guard, async (request, reply) => {
    const body = request.body as {
      id: string;
      title: string;
      description: string;
      category: string;
      tags?: string[];
      capabilities?: string[];
      entrypoint: string;
    };
    const session = await auth.validate(request);
    const skill = await container.createSkill.createSkill(
      {
        id: body.id,
        title: body.title,
        description: body.description,
        category: body.category,
        tags: body.tags,
        capabilities: body.capabilities,
        entrypoint: body.entrypoint,
        files: [],
      },
      session?.username ?? 'admin'
    );
    return reply.code(201).send({ id: skill.id.toString(), version: '1.0.0' });
  });

  app.post('/admin/skills/:skillId/files', guard, async (request, reply) => {
    try {
      const { skillId } = request.params as { skillId: string };
      const { version } = request.query as { version?: string };
      const session = await auth.validate(request);
      const data = await request.file({ limits: { fileSize: maxFileSize } });
      if (!data) {
        return sendApiError(reply, request, {
          statusCode: 400,
          code: 'MISSING_UPLOAD',
          message: 'No file uploaded',
        });
      }
      const resolvedPath = readMultipartFieldValue(data.fields.path) ?? data.filename;
      const role = readMultipartFieldValue(data.fields.role) ?? undefined;
      const skill = await container.updateSkill.uploadFile(
        skillId,
        version ?? '1.0.0',
        {
          path: resolvedPath,
          role,
          content: await data.toBuffer(),
          mimeType: data.mimetype,
        },
        session?.username ?? 'admin'
      );
      const latest = skill.getAllVersions()[skill.getAllVersions().length - 1];
      return reply.send({ id: skill.id.toString(), version: latest?.version ?? version ?? '1.0.0' });
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });

  app.patch('/admin/skills/:skillId', guard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const body = request.body as {
      title?: string;
      description?: string;
      category?: string;
      tags?: string[];
      capabilities?: string[];
    };
    const session = await auth.validate(request);
    const skill = await container.updateSkill.updateSkill(
      skillId,
      {
        title: body.title,
        description: body.description,
        category: body.category,
        tags: body.tags,
        capabilities: body.capabilities,
      },
      session?.username ?? 'admin'
    );
    const latest = skill.getAllVersions()[skill.getAllVersions().length - 1];
    return reply.send({ id: skill.id.toString(), version: latest?.version ?? '1.0.0' });
  });

  app.post('/admin/skills/:skillId/submit-review', guard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const { version } = request.query as { version?: string };
    const session = await auth.validate(request);
    const skill = await container.reviewSkill.submitForReview(
      skillId,
      version ?? '1.0.0',
      session?.username ?? 'admin'
    );
    return reply.send({ id: skill.id.toString() });
  });

  app.post('/admin/skills/:skillId/approve', guard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const { version } = request.query as { version?: string };
    const session = await auth.validate(request);
    const skill = await container.reviewSkill.approve(
      skillId,
      version ?? '1.0.0',
      session?.username ?? 'admin'
    );
    return reply.send({ id: skill.id.toString() });
  });

  app.post('/admin/skills/:skillId/publish', guard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const { version } = request.query as { version?: string };
    const session = await auth.validate(request);
    const skill = await container.reviewSkill.publish(
      skillId,
      version ?? '1.0.0',
      session?.username ?? 'admin'
    );
    return reply.send({ id: skill.id.toString() });
  });

  app.post('/admin/skills/:skillId/reject', guard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const { version } = request.query as { version?: string };
    const body = (request.body as { reason?: string } | undefined) ?? {};
    const session = await auth.validate(request);
    const skill = await container.reviewSkill.reject(
      skillId,
      version ?? '1.0.0',
      session?.username ?? 'admin',
      body.reason ?? ''
    );
    return reply.send({ id: skill.id.toString() });
  });

  app.post('/admin/skills/:skillId/deprecate', guard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const { version } = request.query as { version?: string };
    const body = (request.body as { reason?: string } | undefined) ?? {};
    const session = await auth.validate(request);
    const skill = await container.reviewSkill.deprecate(
      skillId,
      version ?? '1.0.0',
      session?.username ?? 'admin',
      body.reason
    );
    return reply.send({ id: skill.id.toString() });
  });
}

function readMultipartFieldValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const field = value as { value?: unknown };
  return typeof field.value === 'string' && field.value.trim().length > 0 ? field.value.trim() : null;
}

function parseBoolean(value?: string): boolean {
  if (value === undefined) {
    return false;
  }
  if (value.trim().toLowerCase() === 'true') {
    return true;
  }
  if (value.trim().toLowerCase() === 'false' || value.trim().length === 0) {
    return false;
  }
  throw new ValidationError('Invalid boolean query parameter clearProjections');
}
