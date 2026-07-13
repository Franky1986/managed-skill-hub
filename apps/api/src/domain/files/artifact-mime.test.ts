import { describe, expect, it } from 'vitest';
import { resolveArtifactMimeType } from './artifact-mime';

describe('resolveArtifactMimeType', () => {
  it('keeps a specific mime type when one is already present', () => {
    expect(resolveArtifactMimeType('text/markdown', 'SKILL.md')).toBe('text/markdown');
  });

  it('infers office mime types from file extension when upload metadata is generic', () => {
    expect(resolveArtifactMimeType('application/octet-stream', 'templates/deck.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    expect(resolveArtifactMimeType('application/octet-stream', 'guide.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(resolveArtifactMimeType('application/octet-stream', 'sheet.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });
});
