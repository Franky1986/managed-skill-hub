import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { adminApi, type ProposalNotice } from '../../api/admin';
import { ProposalSummary } from '../../api/proposals';
import { JudgementBadgeRow } from '../../components/JudgementPanel';
import { type LanguageCode, useLanguage } from '../../i18n';
import { formatLocalDateTime } from '../../lib/formatLocalDateTime';
import { formatOverallRiskLabel, isNoJudgeAvailable, noJudgeHint, type TranslateFn } from '../../lib/judgement';
import { useBackgroundPolling } from '../../hooks/useBackgroundPolling';

export function AdminProposalsPage() {
    const { t, language } = useLanguage();
    const location = useLocation();
    const [proposals, setProposals] = useState<ProposalSummary[]>([]);
    const [filter, setFilter] = useState<ProposalFilter>(() => proposalFilterFromSearch(location.search));
    const [notice, setNotice] = useState<ProposalNotice | null>(null);
    const [allVersionedCount, setAllVersionedCount] = useState<number | null>(null);
    const [publishedVersions, setPublishedVersions] = useState<Record<string, string | null>>({});

    const refreshProposals = useCallback(async (signal: AbortSignal) => {
        const status = statusForProposalFilter(filter);
        try {
            const response = await adminApi.listProposals(undefined, status, signal);
            const items = sortProposalsByNewestSubmission(response.data.items ?? []);
            setProposals(items);
            if (filter === 'all') {
                const groups = groupVersionedProposals(items);
                const results = await Promise.allSettled(groups.map(async (group) => {
                    const skill = await adminApi.getSkill(group.skillId, signal);
                    return [group.skillId, skill.data.latestPublishedVersion] as const;
                }));
                if (!signal.aborted) {
                    setPublishedVersions(Object.fromEntries(
                        results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
                    ));
                }
            }
        } catch {
            // Keep the last successful list visible during transient background failures.
        }
    }, [filter]);
    useBackgroundPolling(refreshProposals);

    const refreshProposalNotice = useCallback(async (signal: AbortSignal) => {
        const [noticeResult, allResult] = await Promise.allSettled([
            adminApi.proposalNotice(signal),
            adminApi.listProposals(undefined, undefined, signal),
        ]);
        if (noticeResult.status === 'fulfilled') {
            setNotice(noticeResult.value.data);
        }
        if (allResult.status === 'fulfilled') {
            setAllVersionedCount(groupVersionedProposals(allResult.value.data.items ?? []).length);
        }
        // Keep each last successful count visible when its independent refresh fails.
    }, []);
    useBackgroundPolling(refreshProposalNotice);
    useEffect(() => setFilter(proposalFilterFromSearch(location.search)), [location.search]);
    const groupedProposals = useMemo(() => groupVersionedProposals(proposals), [proposals]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{t(`adminProposals.filter.${filter}`)}</h1>
                <div className="flex flex-wrap gap-2">
                    {(['in_upload', 'review', 'rejected', 'converted', 'all'] as const).map((item) => (
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
                            {t(`adminProposals.filter.${item}`)}{renderFilterCount(item, notice, item === 'all' ? allVersionedCount ?? undefined : undefined)}
                        </button>
                    ))}
                </div>
            </div>
            {(filter === 'all' ? groupedProposals.length === 0 : proposals.length === 0) ? (
                <p className="rounded border bg-white p-4 text-sm text-gray-600">{t(`adminProposals.empty.${filter}`)}</p>
            ) : (
                filter === 'all' ? (
                <div className="space-y-4">
                    {groupedProposals.map((group) => (
                        <section key={group.key} className="rounded border bg-white p-3">
                            <div className="mb-3 border-b border-slate-100 pb-2">
                                <Link to={`/admin/skills/${group.skillId}`} className="font-medium text-slate-950 hover:underline">{group.name}</Link>
                                {group.skillId && <p className="font-mono text-xs text-slate-500">{group.skillId}</p>}
                                <p className="mt-1 text-sm text-slate-700">
                                    {t('skillDetail.latestPublishedVersion')}: {group.skillId in publishedVersions
                                        ? publishedVersions[group.skillId] ?? t('common.notPublished')
                                        : '…'}
                                </p>
                            </div>
                            <ProposalListItem proposal={group.currentProposal} t={t} language={language} showCreatedVersion />
                            {group.previousProposals.length > 0 && (
                                <details className="mt-3 rounded border border-slate-200 bg-slate-50">
                                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">
                                        {t('adminProposals.previousVersions', { count: group.previousProposals.length })}
                                    </summary>
                                    <ul className="space-y-2 border-t border-slate-200 p-3">
                                        {group.previousProposals.map((proposal) => <ProposalListItem key={proposal.id} proposal={proposal} t={t} language={language} showCreatedVersion />)}
                                    </ul>
                                </details>
                            )}
                        </section>
                    ))}
                </div>
                ) : (
                <ul className="space-y-2">
                    {proposals.map((p) => (
                        <ProposalListItem key={p.id} proposal={p} t={t} language={language} />
                    ))}
                </ul>
                )
            )}
        </div>
    );
}

export type ProposalFilter = 'review' | 'in_upload' | 'rejected' | 'converted' | 'all';

export function proposalFilterFromSearch(search: string): ProposalFilter {
    const value = new URLSearchParams(search).get('filter');
    return value === 'review' || value === 'rejected' || value === 'converted' || value === 'all'
        ? value
        : 'in_upload';
}

export function statusForProposalFilter(filter: ProposalFilter): string | undefined {
    if (filter === 'review') {
        return 'judged,approved';
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
    filter: ProposalFilter,
    notice: Pick<ProposalNotice, 'counts'> | null,
    allUniqueCount?: number
): string {
    if (!notice) {
        return '';
    }
    const counts = notice.counts;
    switch (filter) {
        case 'review': {
            const judged = counts.judged ?? 0;
            const approved = counts.approved ?? 0;
            return judged + approved > 0 ? ` (${judged + approved})` : '';
        }
        case 'in_upload':
            return counts.in_upload > 0 ? ` (${counts.in_upload})` : '';
        case 'converted':
            return counts.converted > 0 ? ` (${counts.converted})` : '';
        case 'all': {
            if (allUniqueCount !== undefined) return ` (${allUniqueCount})`;
            const total = counts.in_upload
                + counts.submitted
                + counts.judged
                + (counts.approved ?? 0)
                + (counts.rejected ?? 0)
                + counts.converted;
            return ` (${total})`;
        }
        default:
            return '';
    }
}

export interface ProposalGroup {
    key: string;
    name: string;
    skillId: string | null;
    proposals: ProposalSummary[];
    latestSubmittedAt: string;
}

export interface VersionedProposalGroup {
    key: string;
    name: string;
    skillId: string;
    currentProposal: ProposalSummary;
    previousProposals: ProposalSummary[];
    latestSubmittedAt: string;
}

export function sortProposalsByNewestSubmission(proposals: ProposalSummary[]): ProposalSummary[] {
    return [...proposals].sort((left, right) =>
        new Date(right.submittedAt ?? right.createdAt).getTime() - new Date(left.submittedAt ?? left.createdAt).getTime()
    );
}

/** All-proposals view groups version proposals by target skill/name and newest submission first. */
export function groupAllProposals(proposals: ProposalSummary[]): ProposalGroup[] {
    const groups = new Map<string, ProposalGroup>();
    for (const proposal of proposals) {
        const key = proposal.skillId ? `skill:${proposal.skillId}` : `title:${proposal.title.trim().toLowerCase()}`;
        const submittedAt = proposal.submittedAt ?? proposal.createdAt;
        const current = groups.get(key);
        if (current) {
            current.proposals.push(proposal);
            if (new Date(submittedAt).getTime() > new Date(current.latestSubmittedAt).getTime()) {
                current.latestSubmittedAt = submittedAt;
                current.name = proposal.title;
            }
        } else {
            groups.set(key, { key, name: proposal.title, skillId: proposal.skillId, proposals: [proposal], latestSubmittedAt: submittedAt });
        }
    }
    return [...groups.values()]
        .map((group) => ({ ...group, proposals: [...group.proposals].sort((a, b) => new Date(b.submittedAt ?? b.createdAt).getTime() - new Date(a.submittedAt ?? a.createdAt).getTime()) }))
        .sort((a, b) => new Date(b.latestSubmittedAt).getTime() - new Date(a.latestSubmittedAt).getTime());
}

/** Builds the All view from versioned proposals, excluding uploads and rejected work. */
export function groupVersionedProposals(proposals: ProposalSummary[]): VersionedProposalGroup[] {
    const groups = groupAllProposals(proposals.filter((proposal) => proposal.status === 'converted' && proposal.skillId));
    return groups.flatMap((group) => {
        if (!group.skillId) return [];
        const ordered = [...group.proposals].sort(compareConvertedVersionsNewestFirst);
        const current = ordered[0];
        if (!current) return [];
        return [{
            key: group.key,
            name: group.name,
            skillId: group.skillId,
            currentProposal: current,
            previousProposals: ordered.filter((proposal) => proposal.id !== current.id),
            latestSubmittedAt: group.latestSubmittedAt,
        }];
    });
}

/** Conversion audit versions are the historical ordering authority, not upload timestamps. */
function compareConvertedVersionsNewestFirst(left: ProposalSummary, right: ProposalSummary): number {
    const versionComparison = compareSemanticVersions(right.convertedVersion, left.convertedVersion);
    if (versionComparison !== 0) {
        return versionComparison;
    }
    return new Date(right.submittedAt ?? right.createdAt).getTime() - new Date(left.submittedAt ?? left.createdAt).getTime();
}

function compareSemanticVersions(left: string | null, right: string | null): number {
    if (!left || !right) return 0;
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    if (leftParts.some(Number.isNaN) || rightParts.some(Number.isNaN)) return 0;
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

function ProposalListItem({ proposal: p, t, language, showCreatedVersion = false }: { proposal: ProposalSummary; t: TranslateFn; language: LanguageCode; showCreatedVersion?: boolean }) {
    return <li className="rounded border bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
                <div>
                    <Link to={`/admin/proposals/${p.id}`} className="font-medium hover:underline">{showCreatedVersion && p.convertedVersion ? `${t('adminProposals.version')}: ${p.convertedVersion}` : p.title}</Link>
                    <span className="ml-2 text-sm text-gray-500">{proposalDisplayStatus(p, t)} — {t('adminProposals.risk')}: {formatOverallRiskLabel(p.latestJudgementRisk, t, 'n/a')}</span>
                </div>
                {p.latestJudgement && <JudgementBadgeRow judgement={p.latestJudgement} language={language} />}
                {isNoJudgeAvailable(p.latestJudgementRisk) && <p className="text-xs text-amber-700">{noJudgeHint(t)}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>{t('adminProposals.submittedAt')}: {formatLocalDateTime(p.submittedAt ?? p.createdAt)}</span>
                    {p.rejectedAt && <span>{t('adminProposals.rejectedAt')}: {formatLocalDateTime(p.rejectedAt)}{p.rejectedBy ? ` · ${p.rejectedBy}` : ''}</span>}
                </div>
                {p.labels.length > 0 && <div className="flex flex-wrap gap-2">{p.labels.map((label) => <span key={label} className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700">{label}</span>)}</div>}
                {p.conversion && <div className="text-sm text-slate-700">
                    {p.status === 'converted' ? <>{t('adminProposals.convertedTo')} <Link to={`/admin/skills/${p.conversion.targetSkillId}?fromProposal=1&proposalId=${encodeURIComponent(p.id)}&mode=view`} state={{ fromProposal: true, proposalId: p.id, mode: 'view' }} className="font-medium text-sky-700 hover:underline">{p.conversion.targetSkillTitle ?? p.conversion.targetSkillId}</Link>{p.convertedVersion ? ` (${t('adminProposals.createdVersion')}: ${p.convertedVersion})` : ''}</> : p.conversion.targetSkillExists ? <>{t('adminProposals.replaces')} <Link to={`/admin/skills/${p.conversion.targetSkillId}?fromProposal=1&proposalId=${encodeURIComponent(p.id)}&mode=view`} state={{ fromProposal: true, proposalId: p.id, mode: 'view' }} className="font-medium text-sky-700 hover:underline">{p.conversion.targetSkillTitle ?? p.conversion.targetSkillId}</Link> ({t('adminProposals.nextVersion')}: {p.conversion.nextVersion})</> : <>{t('adminProposals.createsNewSkill')} <Link to={`/admin/skills/${p.conversion.targetSkillId}?fromProposal=1&proposalId=${encodeURIComponent(p.id)}&mode=view`} state={{ fromProposal: true, proposalId: p.id, mode: 'view' }} className="font-mono text-sky-700 hover:underline">{p.conversion.targetSkillId}</Link></>}
                </div>}
            </div>
        </div>
    </li>;
}
