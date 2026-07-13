import { FastifyInstance } from 'fastify';
import { SimpleAdminAuth } from './simple-admin-auth';
import { sendApiError } from './error-response';

export function registerAdminAuthRoutes(app: FastifyInstance, auth: SimpleAdminAuth): void {
  app.get('/admin/session', async (request, reply) => {
    const session = await auth.validate(request);
    if (!session) {
      return sendApiError(reply, request, {
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    }
    return reply.send({ username: session.username });
  });

  app.post('/admin/login', async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string };
    const success = await auth.login(username, password, reply);
    if (!success) {
      return sendApiError(reply, request, {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }
    return reply.send({ success: true });
  });

  app.post('/admin/logout', async (request, reply) => {
    auth.logout(reply);
    return reply.send({ success: true });
  });
}
