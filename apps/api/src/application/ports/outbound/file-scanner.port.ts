export interface ScannedContent {
  text: string;
  metadata: Record<string, unknown>;
  extractedBy: string;
}

export interface FileScannerPort {
  scan(content: Buffer, mimeType: string, fileName?: string): Promise<ScannedContent>;
  supports(mimeType: string): boolean;
}
