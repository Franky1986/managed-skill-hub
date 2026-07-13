import type { FastifyReply } from 'fastify';
import path from 'path';

interface ArtifactResponseFile {
  path: string;
  mimeType: string;
  content: Buffer;
}

const ACTIVE_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/xml',
  'text/xml',
]);

export function sendArtifactResponse(reply: FastifyReply, file: ArtifactResponseFile): FastifyReply {
  return reply
    .header('Content-Type', file.mimeType)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'")
    .header('Content-Disposition', `${dispositionFor(file.mimeType)}; filename="${safeFilename(file.path)}"`)
    .send(file.content);
}

function dispositionFor(mimeType: string): 'attachment' | 'inline' {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return ACTIVE_MIME_TYPES.has(normalized) ? 'attachment' : 'inline';
}

function safeFilename(filePath: string): string {
  const filename = path.basename(filePath) || 'artifact';
  return filename.replace(/[\u0000-\u001f"\\]/g, '_');
}
