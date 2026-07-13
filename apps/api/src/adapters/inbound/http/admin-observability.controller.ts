import { FastifyInstance } from 'fastify';
import { Container } from '../../../infrastructure/container';
import { SimpleAdminAuth, adminGuard } from './simple-admin-auth';
import { ObservabilityExportFormat } from '../../../application/usecases/observability/export-observability.usecase';

export function registerAdminObservabilityRoutes(
  app: FastifyInstance,
  container: Container,
  auth: SimpleAdminAuth
): void {
  const guard = { preHandler: adminGuard(auth) };

  app.get('/admin/observability/metrics', guard, async (_request, reply) => {
    return reply.send(container.readObservability.execute());
  });

  app.get('/admin/observability/metrics/export', guard, async (request, reply) => {
    const format = ((request.query as { format?: string } | undefined)?.format ?? 'json') as ObservabilityExportFormat;
    const selectedFormat: ObservabilityExportFormat = format === 'csv' ? 'csv' : 'json';
    const result = container.exportObservability.execute(selectedFormat);
    reply.header('content-type', result.contentType);
    reply.header('content-disposition', `attachment; filename="${result.fileName}"`);
    return reply.send(result.body);
  });
}
