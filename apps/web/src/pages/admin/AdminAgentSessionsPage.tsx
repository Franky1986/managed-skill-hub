import { useCallback, useState } from 'react';
import { agentSessionsApi, AgentSession } from '../../api/agent-sessions';
import { handleApiError } from '../../api/client';
import { useLanguage } from '../../i18n';
import { useBackgroundPolling } from '../../hooks/useBackgroundPolling';
import { formatLocalDateTime } from '../../lib/formatLocalDateTime';

export function AdminAgentSessionsPage() {
    const { language, t } = useLanguage();
    const [sessions, setSessions] = useState<AgentSession[]>([]);
    const [message, setMessage] = useState<string | null>(null);
    const [revoking, setRevoking] = useState<Set<string>>(new Set());

    const refreshSessions = useCallback(async (signal: AbortSignal) => {
        try {
            const response = await agentSessionsApi.listSessions(signal);
            setSessions(response.data.sessions ?? []);
        } catch {
            if (!signal.aborted) {
                setSessions([]);
            }
        }
    }, []);

    useBackgroundPolling(refreshSessions, true);

    async function revoke(sessionId: string) {
        setRevoking((prev) => new Set(prev).add(sessionId));
        setMessage(null);
        try {
            await agentSessionsApi.revokeSession(sessionId);
            setSessions((prev) =>
                prev.map((s) =>
                    s.id === sessionId ? { ...s, revokedAt: new Date().toISOString() } : s
                )
            );
        } catch (err) {
            setMessage(handleApiError(err, language));
        } finally {
            setRevoking((prev) => {
                const next = new Set(prev);
                next.delete(sessionId);
                return next;
            });
        }
    }

    const activeSessions = sessions.filter((s) => !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now());
    const otherSessions = sessions.filter((s) => s.revokedAt || new Date(s.expiresAt).getTime() <= Date.now());

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">{t('adminAgentSessions.title')}</h1>
            </div>
            {message && (
                <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    {message}
                </div>
            )}
            <p className="text-sm text-slate-600">
                {t('adminAgentSessions.activeCount', { count: activeSessions.length })}
            </p>
            {sessions.length === 0 ? (
                <p className="rounded border bg-white p-4 text-sm text-slate-600">
                    {t('adminAgentSessions.empty')}
                </p>
            ) : (
                <ul className="space-y-2">
                    {sessions.map((session) => {
                        const isExpired = new Date(session.expiresAt).getTime() <= Date.now();
                        const isRevoked = session.revokedAt !== null;
                        const isActive = !isRevoked && !isExpired;
                        return (
                            <li
                                key={session.id}
                                className={`rounded border p-3 ${
                                    isActive ? 'bg-white' : 'bg-slate-50 opacity-75'
                                }`}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="space-y-1">
                                        <div className="font-mono text-lg">{session.code}</div>
                                        <div className="flex flex-wrap gap-1">
                                            {session.areas.map((area) => (
                                                <span
                                                    key={area}
                                                    className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700"
                                                >
                                                    {area}
                                                </span>
                                            ))}
                                            {isRevoked && (
                                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800">
                                                    {t('adminAgentSessions.revoked')}
                                                </span>
                                            )}
                                            {isExpired && !isRevoked && (
                                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                                                    {t('adminAgentSessions.expired')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500">
                                            {t('adminAgentSessions.createdAt')}: {formatLocalDateTime(session.createdAt, language)}
                                            {session.createdByIp ? ` · ${session.createdByIp}` : ''}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {t('adminAgentSessions.expiresAt')}: {formatLocalDateTime(session.expiresAt, language)}
                                        </p>
                                        {session.lastUsedAt && (
                                            <p className="text-xs text-slate-500">
                                                {t('adminAgentSessions.lastUsedAt')}: {formatLocalDateTime(session.lastUsedAt, language)}
                                                {session.lastUsedIp ? ` · ${session.lastUsedIp}` : ''}
                                            </p>
                                        )}
                                    </div>
                                    {isActive && (
                                        <button
                                            type="button"
                                            disabled={revoking.has(session.id)}
                                            onClick={() => void revoke(session.id)}
                                            className="rounded border border-rose-300 bg-white px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                        >
                                            {revoking.has(session.id)
                                                ? t('common.loading')
                                                : t('adminAgentSessions.revoke')}
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
            {otherSessions.length > 0 && (
                <p className="text-xs text-slate-500">
                    {t('adminAgentSessions.otherCount', { count: otherSessions.length })}
                </p>
            )}
        </div>
    );
}
