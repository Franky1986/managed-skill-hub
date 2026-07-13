import { describe, expect, it } from 'vitest';
import { classifyObservabilityArea } from './http-observability';

describe('classifyObservabilityArea', () => {
  it('classifies retrieval, extraction and publish routes', () => {
    expect(classifyObservabilityArea('/skills/:skillId', 'get')).toBe('retrieval');
    expect(classifyObservabilityArea('/skills/:skillId/files/:fileId/extracted-content', 'get')).toBe('extraction');
    expect(classifyObservabilityArea('/admin/skills/:skillId/publish', 'post')).toBe('publish');
  });

  it('classifies review and proposal routes', () => {
    expect(classifyObservabilityArea('/admin/skills/:skillId/submit-review', 'post')).toBe('review');
    expect(classifyObservabilityArea('/proposals', 'post')).toBe('proposal');
    expect(classifyObservabilityArea('/admin/proposals/:proposalId', 'get')).toBe('review');
  });
});
