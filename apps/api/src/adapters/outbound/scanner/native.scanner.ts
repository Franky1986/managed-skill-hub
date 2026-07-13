import { FileScannerPort, ScannedContent } from '../../../application/ports/outbound/file-scanner.port';
import { UnsupportedFileTypeError } from '../../../domain/errors';

export class NativeFileScanner implements FileScannerPort {
  supports(mimeType: string): boolean {
    return [
      'text/plain',
      'text/markdown',
      'text/yaml',
      'application/x-yaml',
      'application/json',
      'text/csv',
      'text/html',
    ].includes(mimeType);
  }

  async scan(content: Buffer, mimeType: string, fileName?: string): Promise<ScannedContent> {
    if (!this.supports(mimeType)) {
      throw new UnsupportedFileTypeError(`Unsupported MIME type for native scanner: ${mimeType}`);
    }
    return {
      text: content.toString('utf-8'),
      metadata: { mimeType, fileName, extractor: 'native' },
      extractedBy: 'native',
    };
  }
}
