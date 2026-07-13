import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import { normalizeRelativeArtifactPath } from './relative-artifact-path';

describe('normalizeRelativeArtifactPath', () => {
  it('normalizes valid relative paths', () => {
    expect(normalizeRelativeArtifactPath('scripts\\\\nested//build.py')).toBe('scripts/nested/build.py');
    expect(normalizeRelativeArtifactPath(' SKILL.md ')).toBe('SKILL.md');
  });

  it('rejects traversal and absolute roots by default', () => {
    expect(() => normalizeRelativeArtifactPath('../secret.txt')).toThrow(ValidationError);
    expect(() => normalizeRelativeArtifactPath('./SKILL.md')).toThrow(ValidationError);
    expect(() => normalizeRelativeArtifactPath('/SKILL.md')).toThrow(ValidationError);
    expect(() => normalizeRelativeArtifactPath('C:\\temp\\skill\\SKILL.md')).toThrow(ValidationError);
    expect(() => normalizeRelativeArtifactPath('\\\\server\\share\\skill\\SKILL.md')).toThrow(ValidationError);
  });

  it('can trim leading slashes for legacy-compatible proposal uploads only', () => {
    expect(
      normalizeRelativeArtifactPath('/scripts/build.py', {
        allowLeadingSlashTrim: true,
        fieldLabel: 'Proposal file path',
      })
    ).toBe('scripts/build.py');
  });
});
