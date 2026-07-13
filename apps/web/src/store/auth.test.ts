import { describe, expect, it } from 'vitest';
import { hasAdminRole } from './auth';

describe('hasAdminRole', () => {
    it('treats admin as a super-role', () => {
        expect(hasAdminRole(['admin'], 'reviewer')).toBe(true);
        expect(hasAdminRole(['admin'], 'publisher')).toBe(true);
    });

    it('keeps reviewer and publisher permissions distinct', () => {
        expect(hasAdminRole(['reviewer'], 'reviewer')).toBe(true);
        expect(hasAdminRole(['reviewer'], 'publisher')).toBe(false);
        expect(hasAdminRole(['publisher'], 'publisher')).toBe(true);
        expect(hasAdminRole(['publisher'], 'reviewer')).toBe(false);
    });

    it('accepts any explicitly required role', () => {
        expect(hasAdminRole(['reviewer'], ['reviewer', 'publisher'])).toBe(true);
        expect(hasAdminRole(['publisher'], ['reviewer', 'publisher'])).toBe(true);
        expect(hasAdminRole([], ['reviewer', 'publisher'])).toBe(false);
    });
});
