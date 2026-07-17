import { describe, expect, it } from 'vitest';
import { normalizeApiPrefix, rewriteApiProxyPath } from '../../vite.config';

describe('Vite API proxy path mapping', () => {
  it('keeps /api when the backend uses the same prefix', () => {
    expect(rewriteApiProxyPath('/api/skills?limit=6', '/api')).toBe('/api/skills?limit=6');
  });

  it('removes /api when the backend is mounted at root', () => {
    expect(rewriteApiProxyPath('/api/discover', '')).toBe('/discover');
  });

  it('maps /api to a custom backend prefix', () => {
    expect(rewriteApiProxyPath('/api/admin/session', 'registry/')).toBe('/registry/admin/session');
  });

  it('normalizes empty and slash-only prefixes', () => {
    expect(normalizeApiPrefix(' / ')).toBe('');
    expect(rewriteApiProxyPath('/api', '')).toBe('/');
  });
});
