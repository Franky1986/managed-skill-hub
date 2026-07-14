import { useEffect, useState } from 'react';
import { agentSessionsApi, AgentSessionArea } from '../api/agent-sessions';
import { handleApiError } from '../api/client';
import { Link } from 'react-router-dom';
import { hasAdminRole, useAuthStore } from '../store/auth';
import { useLanguage } from '../i18n';

interface AreaField {
    area: AgentSessionArea;
    labelKey: string;
    token: string;
}

const AREA_CONFIG: Record<AgentSessionArea, { header: string; labelKey: string }> = {
    discovery: { header: 'X-Agent-Discovery-Token', labelKey: 'agentAuth.discoveryToken' },
    'public-read': { header: 'X-Agent-Read-Token', labelKey: 'agentAuth.readToken' },
    proposal: { header: 'X-Agent-Proposal-Token', labelKey: 'agentAuth.proposalToken' },
};

export function AgentAuthPage() {
    const { language, t } = useLanguage();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [availableAreas, setAvailableAreas] = useState<AgentSessionArea[]>([]);
    const [fields, setFields] = useState<AreaField[]>([]);
    const [sessionCode, setSessionCode] = useState<string | null>(null);
    const [sessionAreas, setSessionAreas] = useState<AgentSessionArea[]>([]);
    const [expiresAt, setExpiresAt] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [copied, setCopied] = useState(false);
    const { isAuthenticated, roles } = useAuthStore();
    const isAdmin = isAuthenticated && hasAdminRole(roles, 'admin');

    useEffect(() => {
        setLoading(true);
        agentSessionsApi
            .discover()
            .then((response) => {
                const schemes = response.data.authSchemes ?? [];
                const sessionScheme = schemes.find((s) => s.type === 'agent-session');
                const areas = (sessionScheme?.appliesTo ?? []).filter(isAgentSessionArea);
                setAvailableAreas(areas);
                setFields(
                    areas.map((area) => ({
                        area,
                        labelKey: AREA_CONFIG[area].labelKey,
                        token: '',
                    }))
                );
            })
            .catch((err) => setError(handleApiError(err, language)))
            .finally(() => setLoading(false));
    }, [language]);

    function updateToken(area: AgentSessionArea, value: string) {
        setFields((prev) => prev.map((f) => (f.area === area ? { ...f, token: value } : f)));
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        setSessionCode(null);
        try {
            const areas: AgentSessionArea[] = [];
            const request: { discoveryToken?: string; readToken?: string; proposalToken?: string } = {};
            for (const field of fields) {
                if (field.token.trim()) {
                    areas.push(field.area);
                    request[`${field.area === 'discovery' ? 'discovery' : field.area === 'public-read' ? 'read' : 'proposal'}Token` as const] = field.token.trim();
                }
            }
            if (areas.length === 0) {
                setError(t('agentAuth.error.noArea'));
                return;
            }
            const response = await agentSessionsApi.createSession({ areas, ...request });
            setSessionCode(response.data.code);
            setSessionAreas(response.data.areas);
            setExpiresAt(response.data.expiresAt);
            setFields((prev) => prev.map((f) => ({ ...f, token: '' })));
        } catch (err) {
            setError(handleApiError(err, language));
        } finally {
            setSubmitting(false);
        }
    }

    async function copyToClipboard() {
        if (!sessionCode) return;
        try {
            await navigator.clipboard.writeText(sessionCode);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            // Ignore clipboard errors silently.
        }
    }

    if (loading) {
        return (
            <div className="py-12 text-center text-slate-500">
                {t('common.loading')}
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                {error}
            </div>
        );
    }

    if (availableAreas.length === 0) {
        return (
            <div className="rounded border bg-white p-6 text-sm text-slate-600">
                {t('agentAuth.noAgentSessionAuth')}
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <section className="rounded border bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                    <div>
                        <h1 className="text-2xl font-semibold mb-2">{t('agentAuth.title')}</h1>
                        <p className="text-sm text-slate-600">{t('agentAuth.instructions')}</p>
                    </div>
                    {isAdmin && (
                        <Link
                            to="/admin/agent-sessions"
                            className="inline-flex items-center rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                        >
                            {t('agentAuth.manageSessions')}
                        </Link>
                    )}
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {fields.map((field) => (
                        <div key={field.area}>
                            <label htmlFor={`token-${field.area}`} className="block text-sm font-medium text-slate-700 mb-1">
                                {t(field.labelKey)}
                            </label>
                            <input
                                id={`token-${field.area}`}
                                type="password"
                                autoComplete="off"
                                value={field.token}
                                onChange={(e) => updateToken(field.area, e.target.value)}
                                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder={t('agentAuth.tokenPlaceholder')}
                            />
                            <p className="mt-1 text-xs text-slate-500">
                                {t('agentAuth.areaHelp', { area: field.area })}
                            </p>
                        </div>
                    ))}
                    <button
                        type="submit"
                        disabled={submitting}
                        className="inline-flex items-center justify-center rounded bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:opacity-90 disabled:opacity-50"
                    >
                        {submitting ? t('common.loading') : t('agentAuth.createSession')}
                    </button>
                </form>
            </section>

            {sessionCode && (
                <section className="rounded border border-green-200 bg-green-50 p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-green-900 mb-2">{t('agentAuth.sessionCreated')}</h2>
                    <p className="text-sm text-green-800 mb-4">{t('agentAuth.copyInstructions')}</p>
                    <div className="flex flex-wrap items-center gap-3">
                        <code className="rounded bg-white border border-green-200 px-4 py-3 text-2xl font-mono tracking-widest text-green-900">
                            {sessionCode}
                        </code>
                        <button
                            type="button"
                            onClick={copyToClipboard}
                            className="rounded border border-green-300 bg-white px-3 py-2 text-sm text-green-800 hover:bg-green-100"
                        >
                            {copied ? t('agentAuth.copied') : t('agentAuth.copyCode')}
                        </button>
                    </div>
                    <div className="mt-4 space-y-1 text-sm text-green-800">
                        <p>
                            {t('agentAuth.areas')}:{' '}
                            <strong>{sessionAreas.join(', ')}</strong>
                        </p>
                        <p>
                            {t('agentAuth.expiresAt')}:{' '}
                            {expiresAt ? new Date(expiresAt).toLocaleString(language) : '-'}
                        </p>
                    </div>
                    <div className="mt-4 rounded bg-white border border-green-200 p-3 text-sm text-slate-700">
                        <p className="font-mono text-xs">{t('agentAuth.headerExample', { code: sessionCode })}</p>
                    </div>
                </section>
            )}
        </div>
    );
}

function isAgentSessionArea(value: unknown): value is AgentSessionArea {
    return value === 'discovery' || value === 'public-read' || value === 'proposal';
}
