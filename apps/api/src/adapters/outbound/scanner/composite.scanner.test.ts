import { describe, expect, it, vi } from 'vitest';
import type { FileScannerPort } from '../../../application/ports/outbound/file-scanner.port';
import { CompositeFileScanner } from './composite.scanner';

describe('CompositeFileScanner', () => {
  it('resolves a generic octet-stream mime type from the file extension before dispatching', async () => {
    const delegated = {
      supports: vi.fn((mimeType: string) => mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      scan: vi.fn().mockResolvedValue({
        text: 'slides',
        metadata: {},
        extractedBy: 'stub',
      }),
    } satisfies FileScannerPort;

    const scanner = new CompositeFileScanner([delegated]);
    const result = await scanner.scan(
      Buffer.from('pptx'),
      'application/octet-stream',
      'templates/presentation-template.pptx'
    );

    expect(result.extractedBy).toBe('stub');
    expect(delegated.supports).toHaveBeenCalledWith(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    expect(delegated.scan).toHaveBeenCalledWith(
      expect.any(Buffer),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'templates/presentation-template.pptx'
    );
  });
});
