import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { LiteParseFileScanner } from './liteparse.scanner';

describe('LiteParseFileScanner', () => {
  it('extracts pptx slide text directly without invoking liteparse or LibreOffice', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Agenda</a:t></a:r></a:p><a:p><a:r><a:t>Point A</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
    );
    zip.file(
      'ppt/slides/slide2.xml',
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Summary</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const createParser = vi.fn();
    const scanner = new LiteParseFileScanner({ createParser });

    const scanned = await scanner.scan(
      buffer,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'deck.pptx'
    );

    expect(scanned.extractedBy).toBe('pptx-ooxml');
    expect(scanned.text).toContain('Slide 1');
    expect(scanned.text).toContain('Agenda');
    expect(scanned.text).toContain('Point A');
    expect(scanned.text).toContain('Slide 2');
    expect(scanned.text).toContain('Summary');
    expect(createParser).not.toHaveBeenCalled();
  });

  it('keeps an empty pptx on the in-process extractor path', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld /></p:sld>'
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const createParser = vi.fn();
    const scanner = new LiteParseFileScanner({ createParser });

    const scanned = await scanner.scan(
      buffer,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'empty-deck.pptx'
    );

    expect(scanned).toMatchObject({ text: '', extractedBy: 'pptx-ooxml' });
    expect(createParser).not.toHaveBeenCalled();
  });

  it('rejects an invalid pptx without invoking liteparse or LibreOffice', async () => {
    const createParser = vi.fn();
    const scanner = new LiteParseFileScanner({ createParser });

    await expect(scanner.scan(
      Buffer.from('not a zip package'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'invalid.pptx'
    )).rejects.toThrow('PPTX OOXML extraction failed');
    expect(createParser).not.toHaveBeenCalled();
  });

  it('bounds liteparse extraction time for formats without a native extractor', async () => {
    const scanner = new LiteParseFileScanner({
      parseTimeoutMs: 10,
      createParser: async () => ({
        parse: async () => new Promise(() => undefined),
      }),
    });

    await expect(scanner.scan(Buffer.from('%PDF'), 'application/pdf', 'slow.pdf'))
      .rejects.toThrow('liteparse extraction timed out after 10ms');
  });
});
