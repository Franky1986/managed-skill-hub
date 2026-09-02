import { FastifyInstance } from 'fastify';
import { Container } from '../../../infrastructure/container';
import { AdminAuth, adminGuard } from './admin-auth';
import { NotFoundError } from '../../../domain/errors';
import { sendMappedApiError } from './error-response';
import { operationResponse } from './operation-response';

/** Admin-only read endpoint for durable review-operation progress. */
export function registerAdminOperationRoutes(app: FastifyInstance, container: Container, auth: AdminAuth): void {
  const guard = { preHandler: adminGuard(auth, ['reviewer', 'publisher']) };

  app.get('/admin/operations/:operationId', guard, async (request, reply) => {
    try {
      const { operationId } = request.params as { operationId: string };
      const operation = await container.operations.get(operationId);
      if (!operation) throw new NotFoundError(`Operation ${operationId} not found`);
      return reply.send(operationResponse(operation));
    } catch (error) {
      return sendMappedApiError(reply, request, error, { admin: true });
    }
  });
}
