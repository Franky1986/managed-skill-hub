import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SkillSummary } from '../../api/skills';
import { adminApi, ObservabilitySnapshot } from '../../api/admin';
import { handleApiError } from '../../api/client';
import { useLanguage } from '../../i18n';
import { formatLocalDateTime } from '../../lib/formatLocalDateTime';
import { hasAdminRole, useAuthStore } from '../../store/auth';

export function AdminDashboardPage() {
    const { language, t } = useLanguage();
    const [skills, setSkills] = useState<SkillSummary[]>([]);
    const [observability, setObservability] = useState<ObservabilitySnapshot | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const roles = useAuthStore((state) => state.roles);
    const canViewOperations = hasAdminRole(roles, 'admin');

    useEffect(() => {
        adminApi.listSkills().then((res) => setSkills(res.data.items ?? []));
        if (canViewOperations) void refreshObservability();
    }, [canViewOperations]);

    async function refreshObservability() {
        try {
            const response = await adminApi.getObservabilityMetrics();
            setObservability(response.data);
        } catch (error) {
            setMessage(handleApiError(error, language));
        } finally {
        }
    }

    const topCounters = (observability?.counters ?? []).slice(0, 8);
    const areaSummaries = (observability?.areaSummaries ?? []).slice(0, 6);
    const timeline = observability?.requestTimeline ?? [];
    const latencyHistogram = observability?.latencyHistogram ?? [];
    const hourlyRollups = (observability?.hourlyRollups ?? []).slice(-12);
    const recentRequests = (observability?.recentRequests ?? []).slice(0, 8);
    const recentErrors = (observability?.recentErrors ?? []).slice(0, 6);
    const draftSkills = skills.filter((skill) => skill.status === 'draft');

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">{t('adminDashboard.title')}</h1>
            </div>
            {message && <p className="text-sm text-gray-700">{message}</p>}
            {canViewOperations && <section className="rounded border bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-medium">{t('adminDashboard.observability')}</h2>
                    <p className="text-xs text-gray-500">
                        {observability ? `${t('adminDashboard.snapshot')}: ${formatLocalDateTime(observability.generatedAt)}` : t('adminDashboard.noSnapshot')}
                    </p>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                        <h3 className="text-sm font-medium text-gray-900">{t('adminDashboard.areaSummaries')}</h3>
                        {areaSummaries.length === 0 ? (
                            <p className="mt-2 text-sm text-gray-500">{t('adminDashboard.noAreaData')}</p>
                        ) : (
                            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                                {areaSummaries.map((summary) => {
                                    const errorRate = summary.totalRequests > 0
                                        ? Math.round((summary.errorRequests / summary.totalRequests) * 100)
                                        : 0;
                                    return (
                                        <li key={`${summary.area}-${summary.lastObservedAt}`} className="rounded border bg-slate-50 p-3 text-sm">
                                            <div className="flex items-center justify-between gap-2">
                                                <strong>{summary.area}</strong>
                                                <span>{summary.totalRequests} req</span>
                                            </div>
                                            <p className="mt-1 text-xs text-gray-600">
                                                avg {summary.avgDurationMs} ms · p95 {summary.p95DurationMs} ms · max {summary.maxDurationMs} ms
                                            </p>
                                            <p className="mt-1 text-xs text-gray-500">
                                                {t('adminDashboard.errors')}: {summary.errorRequests} ({errorRate}%)
                                            </p>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-900">{t('adminDashboard.topCounters')}</h3>
                        {topCounters.length === 0 ? (
                            <p className="mt-2 text-sm text-gray-500">{t('adminDashboard.noRequests')}</p>
                        ) : (
                            <ul className="mt-2 space-y-2 text-sm">
                                {topCounters.map((counter) => (
                                    <li key={`${counter.name}-${counter.area}-${counter.method}-${counter.route}-${counter.statusClass}`} className="rounded border bg-slate-50 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <strong>{counter.area}</strong>
                                            <span>{counter.count}x</span>
                                        </div>
                                        <p className="mt-1 text-xs text-gray-600">
                                            {counter.method} {counter.route} · {counter.statusClass}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                        <h3 className="text-sm font-medium text-gray-900">{t('adminDashboard.requestTrend')}</h3>
                        {timeline.length === 0 ? (
                            <p className="mt-2 text-sm text-gray-500">{t('adminDashboard.noTrendData')}</p>
                        ) : (
                            <ul className="mt-2 space-y-2 text-sm">
                                {timeline.map((bucket) => (
                                    <li key={bucket.bucketStart} className="rounded border bg-slate-50 p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <strong>{new Date(bucket.bucketStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                                            <span>{bucket.totalRequests} req</span>
                                        </div>
                                        <p className="mt-1 text-xs text-gray-600">
                                            {t('adminDashboard.errors')}: {bucket.errorRequests}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-900">{t('adminDashboard.latencyHistogram')}</h3>
                        {latencyHistogram.length === 0 ? (
                            <p className="mt-2 text-sm text-gray-500">{t('adminDashboard.noLatencyData')}</p>
                        ) : (
                            <ul className="mt-2 space-y-2 text-sm">
                                {latencyHistogram.map((bucket) => (
                                    <li key={bucket.label} className="rounded border bg-slate-50 p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <strong>{bucket.label}</strong>
                                            <span>{bucket.count} req</span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                        <h3 className="text-sm font-medium text-gray-900">{t('adminDashboard.recentRequests')}</h3>
                        {recentRequests.length === 0 ? (
                            <p className="mt-2 text-sm text-gray-500">{t('adminDashboard.noRequests')}</p>
                        ) : (
                            <ul className="mt-2 space-y-2 text-sm">
                                {recentRequests.map((request) => (
                                    <li key={`${request.traceId}-${request.timestamp}`} className="rounded border bg-slate-50 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <strong>{request.area}</strong>
                                            <span>{request.statusCode} · {request.durationMs} ms</span>
                                        </div>
                                        <p className="mt-1 text-xs text-gray-600">
                                            {request.method} {request.route}
                                        </p>
                                        <p className="mt-1 break-all text-xs text-gray-500">
                                            trace: <code>{request.traceId}</code>
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-900">{t('adminDashboard.recentErrors')}</h3>
                        {recentErrors.length === 0 ? (
                            <p className="mt-2 text-sm text-gray-500">{t('adminDashboard.noErrorRequests')}</p>
                        ) : (
                            <ul className="mt-2 space-y-2 text-sm">
                                {recentErrors.map((request) => (
                                    <li key={`${request.traceId}-${request.timestamp}-error`} className="rounded border border-rose-200 bg-rose-50 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <strong>{request.area}</strong>
                                            <span>{request.statusCode} · {request.durationMs} ms</span>
                                        </div>
                                        <p className="mt-1 text-xs text-rose-700">
                                            {request.method} {request.route}
                                        </p>
                                        <p className="mt-1 break-all text-xs text-rose-600">
                                            trace: <code>{request.traceId}</code>
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
                <div className="mt-4">
                    <h3 className="text-sm font-medium text-gray-900">{t('adminDashboard.hourlyRollups')}</h3>
                    {hourlyRollups.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-500">{t('adminDashboard.noHourlyRollups')}</p>
                    ) : (
                        <ul className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {hourlyRollups.map((bucket) => (
                                <li key={bucket.bucketStart} className="rounded border bg-slate-50 p-3 text-sm">
                                    <div className="flex items-center justify-between gap-2">
                                        <strong>{formatLocalDateTime(bucket.bucketStart)}</strong>
                                        <span>{bucket.totalRequests} req</span>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-600">
                                        {t('adminDashboard.errors')}: {bucket.errorRequests} · avg {bucket.avgDurationMs} ms · max {bucket.maxDurationMs} ms
                                    </p>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>}
            <section className="rounded border bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-medium">{t('adminDashboard.draftSkills')}</h2>
                    <span className="text-sm text-gray-500">{t('adminDashboard.draftSkillCount', { count: draftSkills.length })}</span>
                </div>
                {draftSkills.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">{t('adminDashboard.noDraftSkills')}</p>
                ) : (
                    <ul className="mt-3 space-y-2">
                        {draftSkills.map((s) => (
                            <li key={s.id} className="rounded border bg-slate-50 p-3">
                                <Link to={`/admin/skills/${s.id}`} className="font-medium hover:underline">{s.title}</Link>
                                <span className="ml-2 text-sm text-gray-500">{s.version} - {s.status}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="rounded border bg-white p-4">
                <h2 className="text-lg font-medium">{t('adminDashboard.allSkills')}</h2>
                <ul className="mt-3 space-y-2">
                {skills.map((s) => (
                    <li key={s.id} className="rounded border bg-white p-3">
                        <Link to={`/admin/skills/${s.id}`} className="font-medium hover:underline">{s.title}</Link>
                        <span className="ml-2 text-sm text-gray-500">{s.version} — {s.status}</span>
                    </li>
                ))}
                </ul>
            </section>
        </div>
    );
}
