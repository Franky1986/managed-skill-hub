import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { type LanguageCode, normalizeLanguage, translate } from './messages';

const STORAGE_KEY = 'managed-skill-hub.language';

type LanguageContextValue = {
    language: LanguageCode;
    setLanguage: (language: LanguageCode) => void;
    t: (key: string, params?: Record<string, string | number | boolean | null | undefined>, fallback?: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function browserLanguage(): LanguageCode | null {
    if (typeof navigator === 'undefined') return null;
    return normalizeLanguage(navigator.language) ?? normalizeLanguage(navigator.languages?.[0]);
}

export function resolveLanguagePreference(options: {
    urlLanguage?: string | null;
    storedLanguage?: string | null;
    browserLanguage?: string | null;
}): LanguageCode {
    return (
        normalizeLanguage(options.urlLanguage) ??
        normalizeLanguage(options.storedLanguage) ??
        normalizeLanguage(options.browserLanguage) ??
        'en'
    );
}

export function resolveInitialLanguage(): LanguageCode {
    if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        return resolveLanguagePreference({
            urlLanguage: params.get('lang'),
            storedLanguage: window.localStorage.getItem(STORAGE_KEY),
            browserLanguage: navigator.language,
        });
    }

    return browserLanguage() ?? 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
    const [language, setLanguageState] = useState<LanguageCode>(() => resolveInitialLanguage());

    useEffect(() => {
        persistLanguagePreference(language);
        document.documentElement.lang = language;
    }, [language]);

    const setLanguage = useCallback((nextLanguage: LanguageCode) => {
        persistLanguagePreference(nextLanguage);
        setLanguageState(nextLanguage);
        const url = new URL(window.location.href);
        url.searchParams.set('lang', nextLanguage);
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }, []);

    const value = useMemo<LanguageContextValue>(() => ({
        language,
        setLanguage,
        t: (key, params, fallback) => translate(language, key, params, fallback),
    }), [language, setLanguage]);

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function persistLanguagePreference(language: LanguageCode): void {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(STORAGE_KEY, language);
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used inside LanguageProvider');
    }
    return context;
}
