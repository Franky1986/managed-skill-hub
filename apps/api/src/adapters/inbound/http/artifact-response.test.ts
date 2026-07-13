import { describe, expect, it, vi } from 'vitest';
import { sendArtifactResponse } from './artifact-response';
import type { FastifyReply } from 'fastify';

function replyStub(): FastifyReply {
  const reply = {
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe('sendArtifactResponse', () => {
  it('serves active browser content as attachment with hardening headers', () => {
    const reply = replyStub();

    sendArtifactResponse(reply, {
      path: 'docs/example.html',
      mimeType: 'text/html',
      content: Buffer.from('<script>alert(1)</script>'),
    });

    expect(reply.header).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'"
    );
    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="example.html"');
  });

  it('keeps passive content inline', () => {
    const reply = replyStub();

    sendArtifactResponse(reply, {
      path: 'README.md',
      mimeType: 'text/markdown',
      content: Buffer.from('# Readme'),
    });

    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'inline; filename="README.md"');
  });
});
