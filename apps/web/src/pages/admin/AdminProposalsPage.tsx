import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, type ProposalNotice } from '../../api/admin';
import { ProposalSummary } from '../../api/proposals';
import { JudgementBadgeRow } from '../../components/JudgementPanel';
import { useLanguage } from '../../i18n';
import { formatLocalDateTime } from '../../lib/formatLocalDateTime';
import { formatOverallRiskLabel, isNoJudgeAvailable, noJudgeHint } from '../../lib/judgement';
import { useBackgroundPolling } from '../../hooks/useBackgroundPolling';

export function AdminProposalsPage() {
    const { t, language } = useLanguage();
    const [proposals, setProposals] = useState<ProposalSummary[]>([]);
    const [filter, setFilter] = useState<'open' | 'in_upload' | 'rejected' | 'converted' | 'all'>('open');
    const [notice, setNotice] = useState<ProposalNotice | null>(null);

    const refreshProposals = useCallback(async (signal: AbortSignal) => {
        const status = statusForProposalFilter(filter);
        try {
            const response = await adminApi.listProposals(undefined, status, signal);
            setProposals(response.data.items ?? []);
        } catch {
            // Keep the last successful list visible during transient background failures.
        }
    }, [filter]);
    useBackgroundPolling(refreshProposals);

    const refreshProposalNotice = useCallback(async (signal: AbortSignal) => {
        try {
            const response = await adminApi.proposalNotice(signal);
            setNotice(response.data);
        } catch {
            // Keep the last successful count visible during transient background failures.
        }
    }, []);
    useBackgroundPolling(refreshProposalNotice);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{t('adminProposals.title')}</h1>
                <div className="flex flex-wrap gap-2">
                    {(['open', 'in_upload', 'rejected', 'converted', 'all'] as const).map((item) => (
                        <button
                            key={item}
                            type="button"
                            onClick={() => setFilter(item)}
                            className={`rounded border px-3 py-1.5 text-sm ${
                                filter === item
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                            {t(`adminProposals.filter.${item}`)}{renderFilterCount(item, notice)}
                        </button>
                    ))}
                </div>
            </div>
            {proposals.length === 0 ? (
                <p className="rounded border bg-white p-4 text-sm text-gray-600">{t(`adminProposals.empty.${filter}`)}</p>
            ) : (
                <ul className="space-y-2">
                    {proposals.map((p) => (
                        <li key={p.id} className="rounded border bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="space-y-2">
                                    <div>
                                        <Link to={`/admin/proposals/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                                    <span className="ml-2 text-sm text-gray-500">
                                        {proposalDisplayStatus(p, t)} — {t('adminProposals.risk')}: {formatOverallRiskLabel(p.latestJudgementRisk, t, 'n/a')}
                                    </span>
                                </div>
                                {p.latestJudgement && (
                                    <JudgementBadgeRow judgement={p.latestJudgement} language={language} />
                                )}
                                {isNoJudgeAvailable(p.latestJudgementRisk) && (
                                    <p className="text-xs text-amber-700">{noJudgeHint(t)}</p>
                                )}
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                                        <span>{t('adminProposals.submittedAt')}: {formatLocalDateTime(p.submittedAt ?? p.createdAt)}</span>
                                        {p.rejectedAt && (
                                            <span>
                                                {t('adminProposals.rejectedAt')}: {formatLocalDateTime(p.rejectedAt)}
                                                {p.rejectedBy ? ` · ${p.rejectedBy}` : ''}
                                            </span>
                                        )}
                                    </div>
                                    {p.labels.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {p.labels.map((label) => (
                                                <span key={label} className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700">
                                                    {label}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {p.conversion && (
                                        <div className="text-sm text-slate-700">
                                            {p.conversion.targetSkillExists ? (
                                                <>
                                                    {t('adminProposals.replaces')}{' '}
                                                    <Link
                                                        to={`/admin/skills/${p.conversion.targetSkillId}?fromProposal=1&proposalId=${encodeURIComponent(p.id)}&mode=view`}
                                                        state={{ fromProposal: true, proposalId: p.id, mode: 'view' }}
                                                        className="font-medium text-sky-700 hover:underline"
                                                    >
                                                        {p.conversion.targetSkillTitle ?? p.conversion.targetSkillId}
                                                    </Link>{' '}
                                                    ({t('adminProposals.nextVersion')}: {p.conversion.nextVersion})
                                                </>
                                            ) : (
                                                <>
                                                    {t('adminProposals.createsNewSkill')}{' '}
                                                    <Link
                                                        to={`/admin/skills/${p.conversion.targetSkillId}?fromProposal=1&proposalId=${encodeURIComponent(p.id)}&mode=view`}
                                                        state={{ fromProposal: true, proposalId: p.id, mode: 'view' }}
                                                        className="font-mono text-sky-700 hover:underline"
                                                    >
                                                        {p.conversion.targetSkillId}
                                                    </Link>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export function statusForProposalFilter(filter: 'open' | 'in_upload' | 'rejected' | 'converted' | 'all'): string | undefined {
    if (filter === 'open') {
        return 'submitted,judged,approved';
    }
    if (filter === 'in_upload') {
        return 'in_upload';
    }
    if (filter === 'all') {
        return undefined;
    }
    return filter;
}

export function proposalDisplayStatus(proposal: Pick<ProposalSummary, 'status' | 'latestJudgementRisk'>, t: (key: string) => string): string {
    if (isNoJudgeAvailable(proposal.latestJudgementRisk)) {
        return t('judgement.notJudged');
    }
    return proposal.status;
}


export function renderFilterCount(
    filter: 'open' | 'in_upload' | 'rejected' | 'converted' | 'all',
    notice: Pick<ProposalNotice, 'counts'> | null
): string {
    if (!notice) {
        return '';
    }
    const counts = notice.counts;
    switch (filter) {
        case 'open': {
            const submitted = counts.submitted ?? 0;
            const judged = counts.judged ?? 0;
            if (submitted === 0 && judged === 0) {
                return '';
            }
            if (submitted === 0 || judged === 0) {
                return ` (${submitted + judged})`;
            }
            return ` (${submitted}/${judged})`;
        }
        case 'in_upload':
            return counts.in_upload > 0 ? ` (${counts.in_upload})` : '';
        case 'converted':
            return counts.converted > 0 ? ` (${counts.converted})` : '';
        default:
            return '';
    }
}
