import { describe, expect, it, beforeEach, vi } from 'vitest';
import { normalizeLanguage, translate } from './messages';
import { persistLanguagePreference, resolveLanguagePreference } from './LanguageProvider';

describe('i18n language resolution', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('normalizes supported language values', () => {
        expect(normalizeLanguage('de-DE')).toBe('de');
        expect(normalizeLanguage('en-US')).toBe('en');
        expect(normalizeLanguage('fr-FR')).toBeNull();
    });

    it('prefers explicit URL language over stored preference', () => {
        expect(resolveLanguagePreference({ urlLanguage: 'en', storedLanguage: 'de', browserLanguage: 'de-DE' })).toBe('en');
    });

    it('uses localStorage before browser language', () => {
        expect(resolveLanguagePreference({ storedLanguage: 'de', browserLanguage: 'en-US' })).toBe('de');
    });

    it('persists explicit language changes in localStorage', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('window', {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => storage.set(key, value),
            },
        });

        persistLanguagePreference('de');

        expect(storage.get('managed-skill-hub.language')).toBe('de');
    });

    it('falls back to English for unsupported languages', () => {
        expect(resolveLanguagePreference({ browserLanguage: 'fr-FR' })).toBe('en');
    });

    it('translates catalog keys with fallback to English', () => {
        expect(translate('de', 'app.nav.search')).toBe('Suche');
        expect(translate('de', 'missing.key', {}, 'Fallback')).toBe('Fallback');
    });
});
