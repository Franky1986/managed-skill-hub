import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, JudgementRecord } from '../api/admin';
import { handleApiError } from '../api/client';
import { ProposalDetail } from '../api/proposals';
import { ArtifactProbeResponse, ExtractedSkillFileContent } from '../api/skills';
import { useLanguage } from '../i18n';
import { ArtifactInlineViewer } from '../components/ArtifactInlineViewer';
import { SkillFileTree } from '../components/SkillFileTree';
import { isTextLikeArtifact } from '../utils/artifact-utils';
import { formatLocalDateTime } from '../lib/formatLocalDateTime';
import { formatOverallRiskLabel, isNoJudgeAvailable, noJudgeHint } from '../lib/judgement';
import { hasAdminRole, useAuthStore } from '../store/auth';
import { useBackgroundPolling } from '../hooks/useBackgroundPolling';

function renderJudgementFlags(judgement: JudgementRecord): JSX.Element[] {
    return Object.entries(judgement.dimensions).map(([name, dimension]: [string, { risk: string; reason: string }]) => (
        <span
            key={name}
            title={`${dimension.risk} — ${dimension.reason}`}
            className={`inline-flex cursor-help items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                dimension.risk === 'critical'
                    ? 'bg-red-100 text-red-800'
                    : dimension.risk === 'high'
                        ? 'bg-orange-100 text-orange-800'
                        : dimension.risk === 'medium'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-green-100 text-green-800'
            }`}
        >
            {name}: {dimension.risk}
        </span>
    ));
}

function renderJudgementFindings(judgement: JudgementRecord, title: string): JSX.Element | null {
    const findings = Object.entries(judgement.dimensions)
        .filter(([, dimension]) => dimension.risk !== 'low' && dimension.reason.trim().length > 0);
    if (findings.length === 0) {
        return null;
    }

    return (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
            <p className="font-medium">{title}</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
                {findings.map(([name, dimension]) => (
                    <li key={name}>
                        <span className="font-medium">{name}: {dimension.risk}</span>
                        {' '}
                        {dimension.reason}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function ProposalDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { language, t } = useLanguage();
    const [proposal, setProposal] = useState<ProposalDetail | null>(null);
    const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
    const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
    const [proposalFileContentById, setProposalFileContentById] = useState<Record<string, string>>({});
    const [selectedFileError, setSelectedFileError] = useState<string | null>(null);
    const [loadingFile, setLoadingFile] = useState(false);
    const [expandedExtractPath, setExpandedExtractPath] = useState<string | null>(null);
    const [extractedContentByPath, setExtractedContentByPath] = useState<Record<string, ExtractedSkillFileContent>>({});
    const [loadingExtractedPath, setLoadingExtractedPath] = useState<string | null>(null);
    const [extractedContentError, setExtractedContentError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showInvisibleCharacters, setShowInvisibleCharacters] = useState(false);
    const [probeResponseByFileId, setProbeResponseByFileId] = useState<Record<string, ArtifactProbeResponse>>({});
    const [probeLoadingByFileId, setProbeLoadingByFileId] = useState<Record<string, boolean>>({});
    const [probeErrorByFileId, setProbeErrorByFileId] = useState<Record<string, string | null>>({});
    const [expandedProbeFileId, setExpandedProbeFileId] = useState<string | null>(null);
    const hasLoadedProposal = useRef(false);
    const roles = useAuthStore((state) => state.roles);
    const canReview = hasAdminRole(roles, 'reviewer');

    useEffect(() => {
        if (!id) {
            return;
        }

        hasLoadedProposal.current = false;
        setProposal(null);
        setError(null);
        setSelectedFileId(null);
        setSelectedFileContent(null);
        setSelectedFileError(null);
        setLoadingFile(false);
        setExpandedExtractPath(null);
        setExpandedProbeFileId(null);
        setProposalFileContentById({});
        setExtractedContentByPath({});
        setLoadingExtractedPath(null);
        setExtractedContentError(null);
        setShowInvisibleCharacters(false);
        setProbeResponseByFileId({});
        setProbeLoadingByFileId({});
        setProbeErrorByFileId({});

    }, [id]);

    const refreshProposal = useCallback(async (signal: AbortSignal) => {
        if (!id) {
            return;
        }
        try {
            const response = await adminApi.getProposal(id, signal);
            hasLoadedProposal.current = true;
            setProposal(response.data);
            setError(null);
        } catch (loadError) {
            if (!signal.aborted && !hasLoadedProposal.current) {
                setError(handleApiError(loadError, language));
            }
        }
    }, [id, language]);
    useBackgroundPolling(refreshProposal, Boolean(id));

    useEffect(() => {
        if (!id || !proposal || !selectedFileId) {
            return;
        }

        const file = proposal.files.find((entry) => entry.id === selectedFileId);
        if (!file || !isTextLikeArtifact(file.mimeType, file.path)) {
            setSelectedFileContent(null);
            setLoadingFile(false);
            return;
        }

        if (proposalFileContentById[selectedFileId] !== undefined) {
            setSelectedFileContent(proposalFileContentById[selectedFileId]);
            return;
        }

        setLoadingFile(true);
        setSelectedFileError(null);
        adminApi
            .getProposalFileContent(id, selectedFileId)
            .then((res) => {
                setProposalFileContentById((current) => ({
                    ...current,
                    [selectedFileId]: res.data,
                }));
                setSelectedFileContent(res.data);
            })
            .catch((err) => {
                setSelectedFileContent(null);
                setSelectedFileError(handleApiError(err, language));
            })
            .finally(() => setLoadingFile(false));
    }, [id, proposal, selectedFileId, proposalFileContentById, language]);

    async function ensureExtractedContent(fileId: string) {
        if (!id) {
            return;
        }

        if (extractedContentByPath[fileId]) {
            return;
        }

        setLoadingExtractedPath(fileId);
        setExtractedContentError(null);
        try {
            const response = await adminApi.getProposalExtractedContent(id, fileId);
            setExtractedContentByPath((current) => ({
                ...current,
                [fileId]: response.data,
            }));
        } catch (err) {
            setExtractedContentError(handleApiError(err, language));
        } finally {
            setLoadingExtractedPath((current) => (current === fileId ? null : current));
        }
    }

    async function handleReextract(fileId: string) {
        if (!id) {
            return;
        }

        setLoadingExtractedPath(fileId);
        setExtractedContentError(null);
        try {
            const response = await adminApi.reextractProposalFile(id, fileId);
            setExtractedContentByPath((current) => ({
                ...current,
                [fileId]: response.data,
            }));
        } catch (err) {
            setExtractedContentError(handleApiError(err, language));
        } finally {
            setLoadingExtractedPath((current) => (current === fileId ? null : current));
        }
    }

    async function runProbe(fileId: string) {
        if (!id) {
            return;
        }

        if (probeResponseByFileId[fileId]) {
            return;
        }

        setProbeLoadingByFileId((current) => ({ ...current, [fileId]: true }));
        setProbeErrorByFileId((current) => ({ ...current, [fileId]: null }));
        try {
            const response = await adminApi.getProposalFileProbe(id, fileId);
            setProbeResponseByFileId((current) => ({
                ...current,
                [fileId]: response.data,
            }));
        } catch (probeError) {
            setProbeErrorByFileId((current) => ({
                ...current,
                [fileId]: handleApiError(probeError, language),
            }));
        } finally {
            setProbeLoadingByFileId((current) => ({ ...current, [fileId]: false }));
        }
    }

    const fileJudgementsByPath = useMemo(() => {
        if (!proposal) {
            return new Map<string, JudgementRecord[]>();
        }
        const grouped = new Map<string, JudgementRecord[]>();
        for (const judgement of proposal.judgements) {
            if (judgement.targetType !== 'file') {
                continue;
            }
            const expectedPrefix = `${proposal.id}:`;
            if (!judgement.targetId.startsWith(expectedPrefix)) {
                continue;
            }
            const filePath = judgement.targetId.slice(expectedPrefix.length);
            const current = grouped.get(filePath) ?? [];
            grouped.set(
                filePath,
                [...current, judgement].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            );
        }
        return grouped;
    }, [proposal]);

    const proposalJudgements = useMemo(() => {
        return (proposal?.judgements.filter((judgement) => judgement.targetType === 'proposal') ?? [])
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [proposal]);
    const proposalDisplayRootPath = useMemo(() => dirname(proposal?.entrypoint ?? null), [proposal?.entrypoint]);

    if (getProposalDetailViewState(proposal, error) === 'load-error') {
        return <p className="text-sm text-red-600">{error}</p>;
    }

    if (!proposal) {
        return <p>{t('proposalDetail.loading')}</p>;
    }

    const currentProposal = proposal;

    return (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <main className="space-y-4">
            <section className="rounded border bg-white p-4">
                <h1 className="text-2xl font-semibold text-gray-900">{currentProposal.title}</h1>
                <p className="mt-2 text-sm text-gray-700">{currentProposal.description}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-sm text-gray-700">
                    <span>{t('proposalDetail.category')}: <span className="font-semibold">{currentProposal.category}</span></span>
                    <span>{t('common.status')}: <span className="font-semibold">{currentProposal.status}</span></span>
                    <span>{t('proposalDetail.submittedBy')}: <span className="font-semibold">{currentProposal.submittedBy}</span></span>
                </div>
                {currentProposal.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {currentProposal.tags.map((tag) => (
                            <span key={tag} className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700">
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
                {currentProposal.capabilities.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {currentProposal.capabilities.map((capability) => (
                            <span key={capability} className="rounded-full border border-emerald-300 px-2 py-0.5 text-xs text-emerald-800">
                                {capability}
                            </span>
                        ))}
                    </div>
                )}
                {currentProposal.entrypoint && (
                    <p className="mt-3 text-sm text-gray-600">
                        {t('common.entrypoint')}: <code>{currentProposal.entrypoint}</code>
                    </p>
                )}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        <p className="font-medium text-slate-900">{t('proposalDetail.uploadState')}</p>
                        <p className="mt-1">{t('proposalDetail.uploadFinalized')}: {currentProposal.uploadFinalized ? t('common.yes') : t('common.no')}</p>
                        <p>{t('proposalDetail.fileCount')}: {currentProposal.fileCount} / {currentProposal.maxFiles}</p>
                        <p>{t('proposalDetail.maxFileSizeBytes')}: {currentProposal.maxFileSizeBytes}</p>
                        {currentProposal.disallowedPaths.length > 0 && (
                            <p className="mt-1">{t('proposalDetail.disallowedPaths')}: {currentProposal.disallowedPaths.join(', ')}</p>
                        )}
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        <p className="font-medium text-slate-900">{t('proposalDetail.autoPublish')}</p>
                        <p className="mt-1">{t('proposalDetail.autoPublishEnabled')}: {currentProposal.autoPublishEnabled ? t('common.yes') : t('common.no')}</p>
                        {currentProposal.autoPublishEnabled && (
                            <>
                                <p>{t('proposalDetail.autoPublishEligible')}: {currentProposal.autoPublishEligible === null ? '—' : currentProposal.autoPublishEligible ? t('common.yes') : t('common.no')}</p>
                                {currentProposal.autoPublishBlockedReason && (
                                    <p>{t('proposalDetail.autoPublishBlockedReason')}: {currentProposal.autoPublishBlockedReason}</p>
                                )}
                                {currentProposal.autoPublishClassifierReason && (
                                    <p>{t('proposalDetail.autoPublishClassifierReason')}: {currentProposal.autoPublishClassifierReason}</p>
                                )}
                                {currentProposal.autoPublished && (
                                    <p>{t('proposalDetail.autoPublishedResult')}: {currentProposal.autoPublishedSkillId ?? currentProposal.autoPublishedVersion ?? 'published'}</p>
                                )}
                            </>
                        )}
                    </div>
                </div>
                <div className="mt-3 text-sm text-gray-700">
                    <span className="inline-block rounded bg-slate-100 px-2 py-0.5">
                        {t('proposalDetail.reviewRisk')}: <strong>{formatOverallRiskLabel(currentProposal.review.latestJudgementRisk, t, t('proposalDetail.notJudged'))}</strong>
                    </span>
                    {isNoJudgeAvailable(currentProposal.review.latestJudgementRisk) && (
                        <p className="mt-1 text-xs text-amber-700">{noJudgeHint(t)}</p>
                    )}
                </div>
                {currentProposal.review.labels.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {currentProposal.review.labels.map((label) => (
                            <span key={label} className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700">
                                {label}
                            </span>
                        ))}
                    </div>
                )}
                <p className="mt-4 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-700">
                    {currentProposal.judgements.length === 0
                        ? t('proposalDetail.noJudgements')
                        : t('proposalDetail.judgementCount', { count: currentProposal.judgements.length })}
                </p>
                {proposalJudgements.length > 0 && (
                    <div className="mt-3 space-y-2 rounded border border-indigo-200 bg-indigo-50 p-3">
                        <h2 className="text-sm font-semibold">{t('proposalDetail.proposalJudgements')}</h2>
                        {proposalJudgements.slice(0, 1).map((judgement) => (
                            <article key={judgement.id} className="rounded border border-indigo-200 bg-white p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-sm font-medium">
                                        {t('proposalDetail.risk')}: <strong>{formatOverallRiskLabel(judgement.overallRisk, t)}</strong>
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {formatLocalDateTime(judgement.createdAt)}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                    {t('common.model')}: <code>{judgement.model ?? 'n/a'}</code>
                                </p>
                                <p className="mt-2 text-sm text-gray-700">{judgement.summary || t('proposalDetail.noSummary')}</p>
                                <div className="mt-2 flex flex-wrap gap-2">{renderJudgementFlags(judgement)}</div>
                                {renderJudgementFindings(judgement, t('adminSkill.judgementFindings'))}
                            </article>
                        ))}
                        {proposalJudgements.length > 1 && (
                            <details className="rounded border border-indigo-200 bg-white">
                                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-indigo-900">
                                    {t('proposalDetail.previousJudgements', { count: proposalJudgements.length - 1 })}
                                </summary>
                                <div className="space-y-2 border-t p-3">
                                    {proposalJudgements.slice(1).map((judgement) => (
                                        <article key={judgement.id} className="rounded border border-indigo-100 bg-indigo-50 p-3">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <span className="text-sm font-medium">
                                                    {t('proposalDetail.risk')}: <strong>{formatOverallRiskLabel(judgement.overallRisk, t)}</strong>
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    {formatLocalDateTime(judgement.createdAt)}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-xs text-gray-500">
                                                {t('common.model')}: <code>{judgement.model ?? 'n/a'}</code>
                                            </p>
                                            <p className="mt-2 text-sm text-gray-700">{judgement.summary || t('proposalDetail.noSummary')}</p>
                                            <div className="mt-2 flex flex-wrap gap-2">{renderJudgementFlags(judgement)}</div>
                                            {renderJudgementFindings(judgement, t('adminSkill.judgementFindings'))}
                                        </article>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>
                )}
                {currentProposal.lifecycle.length > 0 && (
                    <details className="mt-4 rounded border border-slate-200 bg-slate-50" open={false}>
                        <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-slate-900">
                            {t('proposalDetail.lifecycle')} ({currentProposal.lifecycle.length})
                        </summary>
                        <div className="border-t border-slate-200 p-3">
                            <ol className="space-y-2">
                                {currentProposal.lifecycle.map((event) => (
                                    <li key={event.id} className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                                        <p className="font-medium text-slate-900">{formatProposalLifecycleAction(event.action, t)}</p>
                                        <p>{formatLocalDateTime(event.at)} · {event.actor}</p>
                                        {(event.fromStatus || event.toStatus) && (
                                            <p>{event.fromStatus ?? '—'} → {event.toStatus ?? '—'}</p>
                                        )}
                                        {(event.skillId || event.skillVersion) && (
                                            <p>{event.skillId ?? '—'} {event.skillVersion ? `@${event.skillVersion}` : ''}</p>
                                        )}
                                        {event.reason && <p>{t('proposalDetail.lifecycleReason')}: {event.reason}</p>}
                                        {event.comment && <p>{t('proposalDetail.lifecycleComment')}: {event.comment}</p>}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </details>
                )}
            </section>

            {currentProposal.rejectionReason && (
                <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {t('proposalDetail.rejectionReason')}: {currentProposal.rejectionReason}
                </p>
            )}

            {currentProposal.files.length > 0 && (
                <section className="rounded border bg-white p-4">
                    <h2 className="text-lg font-medium">{t('proposalDetail.files')}</h2>
                    <p className="mt-2 text-xs text-slate-500">
                        {t('common.entrypoint')}: <code>{currentProposal.entrypoint ?? 'SKILL.md'}</code>
                    </p>
                    <div className="mt-3">
                        <SkillFileTree
                            files={currentProposal.files.map((file) => ({
                                id: file.id,
                                artifactId: file.id,
                                path: file.path,
                                role: currentProposal.entrypoint === file.path ? 'entrypoint' : 'attachment',
                                mimeType: file.mimeType,
                                sizeBytes: file.sizeBytes,
                                sha256: file.sha256,
                                updatedAt: null,
                                extractable: file.extractable,
                            }))}
                            selectedPath={selectedFileId ? currentProposal.files.find((file) => file.id === selectedFileId)?.path ?? null : null}
                            onSelect={(path) => {
                                const selected = currentProposal.files.find((file) => file.path === path);
                                if (!selected) {
                                    return;
                                }
                                setSelectedFileId(selected.id);
                                setSelectedFileContent(null);
                                setSelectedFileError(null);
                            }}
                            displayRootPath={proposalDisplayRootPath}
                            emptyLabel={t('adminSkill.noFilesForVersion')}
                        />
                    </div>
                </section>
            )}

            {currentProposal.files.length > 0 && (
                <div>
                    <h2 className="text-lg font-medium">{t('proposalDetail.files')}</h2>
                    <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={showInvisibleCharacters}
                            onChange={(event) => setShowInvisibleCharacters(event.target.checked)}
                        />
                        {t('proposalDetail.showInvisible')}
                    </label>

                    <ul className="mt-2 space-y-2">
                        {currentProposal.files.map((f) => {
                            const fileJudgements = fileJudgementsByPath.get(f.path) ?? [];

                            return (
                                <li key={f.id} className="rounded border border-gray-200 bg-white p-3 text-sm">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <p className="font-medium text-gray-900">{f.path}</p>
                                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                                                <span>{t('proposalDetail.mime')}: {f.mimeType}</span>
                                                <span>{t('proposalDetail.size')}: {f.sizeBytes} bytes</span>
                                                <span>{t('proposalDetail.sha256')}: {f.sha256 ?? t('proposalDetail.unknown')}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedFileId((current) => (current === f.id ? null : f.id));
                                                    setSelectedFileContent(null);
                                                    setSelectedFileError(null);
                                                }}
                                                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                            >
                                                {selectedFileId === f.id ? t('proposalDetail.hidePreview') : t('proposalDetail.preview')}
                                            </button>
                                            {f.extractable && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const nextOpen = expandedExtractPath !== f.id;
                                                        setSelectedFileId(f.id);
                                                        setExpandedExtractPath(nextOpen ? f.id : null);
                                                        setSelectedFileContent(null);
                                                        setSelectedFileError(null);
                                                        if (nextOpen) {
                                                            void ensureExtractedContent(f.id);
                                                        }
                                                    }}
                                                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                                >
                                                    {expandedExtractPath === f.id ? t('proposalDetail.hideExtract') : t('proposalDetail.extract')}
                                                </button>
                                            )}
                                            <a
                                                href={adminApi.getProposalFileUrl(currentProposal.id, f.id)}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                            >
                                                {t('proposalDetail.open')}
                                            </a>
                                            {f.extractable && canReview && (
                                                <button
                                                    type="button"
                                                    onClick={() => void handleReextract(f.id)}
                                                    disabled={loadingExtractedPath === f.id}
                                                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                                                >
                                                    {t('proposalDetail.reextract')}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {fileJudgements.length > 0 && (
                                        <div className="mt-3 space-y-2 rounded border border-indigo-200 bg-indigo-50 p-3">
                                            <h3 className="text-sm font-semibold">{t('proposalDetail.fileJudgements', { path: f.path })}</h3>
                                            {fileJudgements.slice(0, 1).map((judgement) => (
                                                <article key={judgement.id} className="rounded border border-indigo-200 bg-white p-3">
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <span className="text-sm font-medium">
                                                                {t('proposalDetail.risk')}: <strong>{formatOverallRiskLabel(judgement.overallRisk, t)}</strong>
                                                        </span>
                                                        <span className="text-xs text-gray-500">
                                                            {formatLocalDateTime(judgement.createdAt)}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        {t('common.model')}: <code>{judgement.model ?? 'n/a'}</code>
                                                    </p>
                                                    <p className="mt-2 text-sm text-gray-700">{judgement.summary || t('proposalDetail.noSummary')}</p>
                                                    <div className="mt-2 flex flex-wrap gap-2">{renderJudgementFlags(judgement)}</div>
                                                    {renderJudgementFindings(judgement, t('adminSkill.judgementFindings'))}
                                                </article>
                                            ))}
                                            {fileJudgements.length > 1 && (
                                                <details className="rounded border border-indigo-200 bg-white">
                                                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-indigo-900">
                                                        {t('proposalDetail.previousJudgements', { count: fileJudgements.length - 1 })}
                                                    </summary>
                                                    <div className="space-y-2 border-t p-3">
                                                        {fileJudgements.slice(1).map((judgement) => (
                                                            <article key={judgement.id} className="rounded border border-indigo-100 bg-indigo-50 p-3">
                                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                                    <span className="text-sm font-medium">
                                                                        {t('proposalDetail.risk')}: <strong>{formatOverallRiskLabel(judgement.overallRisk, t)}</strong>
                                                                    </span>
                                                                    <span className="text-xs text-gray-500">
                                                                        {formatLocalDateTime(judgement.createdAt)}
                                                                    </span>
                                                                </div>
                                                                <p className="mt-1 text-xs text-gray-500">
                                                                    {t('common.model')}: <code>{judgement.model ?? 'n/a'}</code>
                                                                </p>
                                                                <p className="mt-2 text-sm text-gray-700">{judgement.summary || t('proposalDetail.noSummary')}</p>
                                                                <div className="mt-2 flex flex-wrap gap-2">{renderJudgementFlags(judgement)}</div>
                                                                {renderJudgementFindings(judgement, t('adminSkill.judgementFindings'))}
                                                            </article>
                                                        ))}
                                                    </div>
                                                </details>
                                            )}
                                        </div>
                                    )}

                                    {(selectedFileId === f.id || expandedExtractPath === f.id || expandedProbeFileId === f.id) && (
                                        <ArtifactInlineViewer
                                            file={{
                                                id: f.id,
                                                path: f.path,
                                                mimeType: f.mimeType,
                                                sizeBytes: f.sizeBytes,
                                                sha256: f.sha256,
                                                artifactId: f.id,
                                                role: 'entrypoint',
                                                updatedAt: null,
                                                extractable: f.extractable,
                                            }}
                                            artifactId={f.id}
                                            fileUrl={adminApi.getProposalFileUrl(currentProposal.id, f.id)}
                                            textContent={selectedFileContent}
                                            textLoading={loadingFile}
                                            textError={selectedFileError}
                                            showInvisible={showInvisibleCharacters}
                                            onShowInvisibleChange={setShowInvisibleCharacters}
                                            extractedContent={f.extractable ? extractedContentByPath[f.id] ?? null : null}
                                            extractedLoading={loadingExtractedPath === f.id}
                                            extractedError={expandedExtractPath === f.id ? extractedContentError : null}
                                            onLoadExtracted={f.extractable
                                                ? () => {
                                                    void ensureExtractedContent(f.id);
                                                }
                                                : undefined}
                                            extractedPanelOpen={expandedExtractPath === f.id}
                                            onExtractedPanelToggle={(isOpen) => {
                                                setExpandedExtractPath(isOpen ? f.id : null);
                                                if (!isOpen) {
                                                    return;
                                                }
                                                void ensureExtractedContent(f.id);
                                            }}
                                            probeResponse={probeResponseByFileId[f.id] ?? null}
                                            probeLoading={Boolean(probeLoadingByFileId[f.id])}
                                            probeError={probeErrorByFileId[f.id] ?? null}
                                            onRunProbe={() => void runProbe(f.id)}
                                            probePanelOpen={expandedProbeFileId === f.id}
                                            onProbePanelToggle={(isOpen) => {
                                                setExpandedProbeFileId(isOpen ? f.id : null);
                                                if (!isOpen) {
                                                    return;
                                                }
                                                void runProbe(f.id);
                                            }}
                                        />
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            </main>
            <aside className="lg:sticky lg:top-4 lg:self-start">
                <section className="rounded border bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-medium">{t('proposalDetail.conversion')}</h2>
                            <p className="mt-1 text-sm text-slate-600">{t('proposalDetail.targetContextHint')}</p>
                        </div>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-gray-700">
                        <p>
                            {t('proposalDetail.target')}: <strong>{currentProposal.conversion.mode === 'create_version' ? t('proposalDetail.targetDraftVersion') : t('proposalDetail.targetNewSkill')}</strong>
                        </p>
                        <p>
                            {t('common.skillId')}: <code>{currentProposal.conversion.targetSkillId}</code>
                        </p>
                        <p>
                            {t('proposalDetail.targetTitle')}: <strong>{currentProposal.conversion.targetSkillTitle ?? t('proposalDetail.generatedFromProposal')}</strong>
                        </p>
                        <p>
                            {t('proposalDetail.nextVersion')}: <code>{currentProposal.conversion.nextVersion}</code>
                        </p>
                        <p>
                            {t('proposalDetail.targetEntrypoint')}: <code>{currentProposal.conversion.targetEntrypoint}</code>
                        </p>
                        {currentProposal.conversion.currentLatestVersion && (
                            <p>
                                {t('proposalDetail.currentLatestVersion')}: <code>{currentProposal.conversion.currentLatestVersion}</code>
                            </p>
                        )}
                    </div>
                    <div className="mt-4">
                        <div className="space-y-2">
                            <Link
                                to={`/admin/skills/${currentProposal.conversion.targetSkillId}?fromProposal=1&proposalId=${encodeURIComponent(currentProposal.id)}&mode=view`}
                                state={{ fromProposal: true, proposalId: currentProposal.id, mode: 'view' }}
                                className="inline-flex w-full items-center justify-center rounded border bg-blue-600 px-3 py-2 text-sm text-white hover:opacity-95"
                            >
                                {t('proposalDetail.openTargetSkill')}
                            </Link>
                            <p className="text-xs text-slate-500">{t('proposalDetail.openTargetSkillHint')}</p>
                            {!currentProposal.conversion.targetSkillExists && (
                                <p className="text-sm text-gray-600">{t('proposalDetail.noTargetSkill')}</p>
                            )}
                        </div>
                    </div>
                </section>
            </aside>
        </div>
    );
}

export function getProposalDetailViewState(
    proposal: ProposalDetail | null,
    error: string | null
): 'ready' | 'loading' | 'load-error' {
    if (!proposal && error) {
        return 'load-error';
    }
    return proposal ? 'ready' : 'loading';
}

function formatProposalLifecycleAction(
    action: string,
    t: (key: string, values?: Record<string, string | number>) => string
): string {
    const key = `proposalDetail.lifecycleAction.${action}`;
    const translated = t(key);
    return translated === key ? action : translated;
}

function dirname(path: string | null): string | null {
    if (!path) {
        return null;
    }
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 1) {
        return null;
    }
    return parts.slice(0, -1).join('/');
}
