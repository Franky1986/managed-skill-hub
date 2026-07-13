import { FileScannerPort, ScannedContent } from '../../../application/ports/outbound/file-scanner.port';
import { UnsupportedFileTypeError, ValidationError } from '../../../domain/errors';

const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DEFAULT_PARSE_TIMEOUT_MS = 15_000;

interface LiteParseParser {
  parse(content: Buffer): Promise<{ text?: unknown }>;
}

interface LiteParseScannerOptions {
  parseTimeoutMs?: number;
  createParser?: () => Promise<LiteParseParser>;
}

async function createLiteParseParser(): Promise<LiteParseParser> {
  const mod = await import('@llamaindex/liteparse');
  const LiteParse = (mod as Record<string, unknown>).LiteParse ?? (mod as Record<string, unknown>).default ?? mod;
  const Parser = LiteParse as new (config: { outputFormat: 'markdown' }) => LiteParseParser;
  return new Parser({ outputFormat: 'markdown' });
}

export class LiteParseFileScanner implements FileScannerPort {
  constructor(private readonly options: LiteParseScannerOptions = {}) {}

  supports(mimeType: string): boolean {
    return [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/html',
    ].includes(mimeType);
  }

  async scan(content: Buffer, mimeType: string, fileName?: string): Promise<ScannedContent> {
    if (!this.supports(mimeType)) {
      throw new UnsupportedFileTypeError(`Unsupported MIME type for liteparse: ${mimeType}`);
    }

    if (mimeType === PPTX_MIME_TYPE) {
      try {
        const text = await extractPptxText(content);
        return {
          text,
          metadata: { mimeType, fileName, extractor: 'pptx-ooxml' },
          extractedBy: 'pptx-ooxml',
        };
      } catch (error) {
        throw new ValidationError(`PPTX OOXML extraction failed: ${(error as Error).message}`);
      }
    }

    try {
      const parser = await (this.options.createParser ?? createLiteParseParser)();
      const result = await withTimeout(
        parser.parse(content),
        this.options.parseTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS
      );
      const text = result.text ?? '';
      return {
        text: String(text),
        metadata: { mimeType, fileName, extractor: '@llamaindex/liteparse' },
        extractedBy: '@llamaindex/liteparse',
      };
    } catch (err) {
      throw new ValidationError(`liteparse extraction failed: ${(err as Error).message}`);
    }
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`liteparse extraction timed out after ${timeoutMs}ms`)),
          Math.max(1, timeoutMs)
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function extractPptxText(content: Buffer): Promise<string> {
  const JSZipModule = await import('jszip');
  const JSZip = (JSZipModule as { default?: typeof import('jszip') }).default ?? JSZipModule;
  const zip = await JSZip.loadAsync(content);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => extractSlideNumber(left) - extractSlideNumber(right));

  const sections: string[] = [];
  for (const slideFile of slideFiles) {
    const xml = await zip.files[slideFile]?.async('string');
    if (!xml) {
      continue;
    }
    const texts = [...xml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/gsi)]
      .map((match) => decodeXmlText(match[1] ?? ''))
      .map((value) => value.trim())
      .filter(Boolean);
    if (texts.length === 0) {
      continue;
    }
    sections.push(`Slide ${extractSlideNumber(slideFile)}\n${texts.join('\n')}`);
  }

  return sections.join('\n\n');
}

function extractSlideNumber(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/i);
  return match ? Number.parseInt(match[1] ?? '0', 10) : 0;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
