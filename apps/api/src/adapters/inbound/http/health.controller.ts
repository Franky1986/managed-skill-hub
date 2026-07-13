import { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/health/live', async () => ({ status: 'ok' }));

  app.get('/api/health/ready', async () => {
    // For MVP always return ok; later check DB/search connectivity
    return { status: 'ok', ready: true };
  });
}
