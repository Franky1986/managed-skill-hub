import { FileScannerPort, ScannedContent } from '../../../application/ports/outbound/file-scanner.port';
import { UnsupportedFileTypeError } from '../../../domain/errors';
import { resolveArtifactMimeType } from '../../../domain/files/artifact-mime';

export class CompositeFileScanner implements FileScannerPort {
  constructor(private readonly scanners: FileScannerPort[]) {}

  supports(_mimeType: string): boolean {
    return true;
  }

  async scan(content: Buffer, mimeType: string, fileName?: string): Promise<ScannedContent> {
    const effectiveMimeType = fileName ? resolveArtifactMimeType(mimeType, fileName) : mimeType;
    for (const scanner of this.scanners) {
      if (scanner.supports(effectiveMimeType)) {
        return scanner.scan(content, effectiveMimeType, fileName);
      }
    }
    throw new UnsupportedFileTypeError(`No scanner available for MIME type: ${effectiveMimeType}`);
  }
}
