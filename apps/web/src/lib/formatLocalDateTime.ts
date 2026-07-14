import { type LanguageCode, normalizeLanguage } from '../i18n/messages';

export function formatLocalDateTime(
    value: string | Date | null | undefined,
    language?: LanguageCode
): string {
    if (!value) {
        return '—';
    }

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return String(value);
    }

    const locale = normalizeLanguage(language ?? 'de') === 'de' ? 'de-DE' : 'en-US';
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'medium',
    }).format(parsed);
}
