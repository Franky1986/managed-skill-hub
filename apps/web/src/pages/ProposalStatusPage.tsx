import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { proposalsApi, ProposalPublicStatus } from '../api/proposals';
import { handleApiError } from '../api/client';
import { useLanguage } from '../i18n';
import { formatLocalDateTime } from '../lib/formatLocalDateTime';
import { formatOverallRiskLabel, isNoJudgeAvailable, noJudgeHint } from '../lib/judgement';

export function ProposalStatusPage() {
    const { id } = useParams<{ id: string }>();
    const { language, t } = useLanguage();
    const [status, setStatus] = useState<ProposalPublicStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!id) return;
        setLoading(true);
        proposalsApi.status(id)
            .then((res) => setStatus(res.data))
            .catch((err) => setError(handleApiError(err, language)))
            .finally(() => setLoading(false));
    }, [id, language]);

    if (loading) return <p className="p-6">{t('proposalStatus.loading')}</p>;
    if (error) return <p className="p-6 text-red-600">{error}</p>;
    if (!status) return <p className="p-6">{t('proposalStatus.notFound')}</p>;
    const lifecycleHint = getProposalLifecycleHint(status.status, t);

    return (
        <div className="max-w-2xl space-y-4 p-6">
            <h1 className="text-2xl font-semibold">{t('proposalStatus.title')}</h1>
            <div className="rounded border bg-white p-4">
                <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <dt className="text-gray-500">ID</dt>
                        <dd className="font-mono">{status.id}</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-gray-500">{t('proposalStatus.fieldTitle')}</dt>
                        <dd>{status.title}</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-gray-500">{t('common.status')}</dt>
                        <dd><span className="rounded bg-slate-100 px-2 py-0.5 font-medium">{status.status}</span></dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-gray-500">{t('proposalStatus.submittedAt')}</dt>
                        <dd>{formatLocalDateTime(status.createdAt)}</dd>
                    </div>
                    {status.latestJudgementRisk && (
                        <>
                            <div className="flex justify-between">
                                <dt className="text-gray-500">{t('proposalStatus.latestRisk')}</dt>
                                <dd>{formatOverallRiskLabel(status.latestJudgementRisk, t, 'n/a')}</dd>
                            </div>
                            {isNoJudgeAvailable(status.latestJudgementRisk) && (
                                <p className="rounded border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
                                    {noJudgeHint(t)}
                                </p>
                            )}
                        </>
                    )}
                    <div className="flex justify-between">
                        <dt className="text-gray-500">{t('proposalStatus.uploadFinalized')}</dt>
                        <dd>{status.uploadFinalized ? t('common.yes') : t('common.no')}</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-gray-500">{t('proposalStatus.autoPublishEnabled')}</dt>
                        <dd>{status.autoPublishEnabled ? t('common.yes') : t('common.no')}</dd>
                    </div>
                    {status.autoPublishEnabled && (
                        <>
                            <div className="flex justify-between">
                                <dt className="text-gray-500">{t('proposalStatus.autoPublishEligible')}</dt>
                                <dd>{status.autoPublishEligible === null ? '—' : status.autoPublishEligible ? t('common.yes') : t('common.no')}</dd>
                            </div>
                            {status.autoPublishBlockedReason && (
                                <div className="rounded border border-amber-100 bg-amber-50 p-3">
                                    <p className="text-xs font-medium text-amber-700">{t('proposalStatus.autoPublishBlockedReason')}</p>
                                    <p className="mt-1 text-sm text-amber-700">{status.autoPublishBlockedReason}</p>
                                </div>
                            )}
                        </>
                    )}
                    {status.rejectionReason && (
                        <div className="rounded border border-red-100 bg-red-50 p-3">
                            <p className="text-xs font-medium text-red-700">{t('proposalStatus.rejectionReason')}</p>
                            <p className="mt-1 text-sm text-red-700">{status.rejectionReason}</p>
                        </div>
                    )}
                    {status.convertedSkillId && (
                        <div className="rounded border border-green-100 bg-green-50 p-3">
                            <p className="text-xs font-medium text-green-700">{t('proposalStatus.acceptedAsSkill')}</p>
                            <p className="mt-1 text-sm text-green-700">{status.convertedSkillId}</p>
                        </div>
                    )}
                    {status.contentDigest && (
                        <div className="flex justify-between">
                            <dt className="text-gray-500">{t('common.contentDigest')}</dt>
                            <dd className="font-mono">{status.contentDigest.slice(0, 16)}...</dd>
                        </div>
                    )}
                    {status.duplicateOfProposalId && (
                        <div className="rounded border border-yellow-100 bg-yellow-50 p-3">
                            <p className="text-xs font-medium text-yellow-700">{t('proposalStatus.duplicateContent')}</p>
                            <p className="mt-1 text-sm text-yellow-700">
                                {t('proposalStatus.duplicateProposal', { id: status.duplicateOfProposalId })}
                            </p>
                        </div>
                    )}
                    {status.duplicateOfSkillId && (
                        <div className="rounded border border-yellow-100 bg-yellow-50 p-3">
                            <p className="text-xs font-medium text-yellow-700">{t('proposalStatus.duplicateContent')}</p>
                            <p className="mt-1 text-sm text-yellow-700">
                                {t('proposalStatus.duplicateSkill', { id: status.duplicateOfSkillId })}
                            </p>
                        </div>
                    )}
                </dl>
            </div>
            <div className="rounded border bg-blue-50 p-4 text-sm text-blue-800">
                <p className="font-medium">{status.reviewNote}</p>
                <p className="mt-1">{status.nextStepForSubmitter}</p>
                {status.adminOnlyNextSteps.length > 0 && (
                    <p className="mt-1 text-xs">
                        {t('proposalStatus.adminOnly')}: {status.adminOnlyNextSteps.join(', ')}
                    </p>
                )}
            </div>
            <div className="rounded border bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-800">{t('proposalStatus.lifecycle')}</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                    {lifecycleHint.steps.map((item) => (
                        <li key={item.status} className={item.current ? 'font-medium text-slate-900' : ''}>
                            <span className="mr-2 font-mono">{item.status}</span>
                            {item.label}
                        </li>
                    ))}
                </ul>
                <p className="mt-2 text-xs text-slate-500">{lifecycleHint.note}</p>
            </div>
            <p className="text-xs text-gray-500">
                {t('proposalStatus.publicRejectionHint')}
            </p>
        </div>
    );
}

interface LifecycleHint {
    status: string;
    label: string;
    current: boolean;
}

function getProposalLifecycleHint(status: string, t: (key: string) => string): { steps: LifecycleHint[]; note: string } {
    const isCurrent = (value: string) => value === status;
    const steps: LifecycleHint[] = [
        { status: 'in_upload', label: t('proposalStatus.lifecycle.in_upload'), current: isCurrent('in_upload') },
        { status: 'submitted', label: t('proposalStatus.lifecycle.submitted'), current: isCurrent('submitted') },
        { status: 'judged', label: t('proposalStatus.lifecycle.judged'), current: isCurrent('judged') },
        { status: 'approved', label: t('proposalStatus.lifecycle.approved'), current: isCurrent('approved') },
        { status: 'converted', label: t('proposalStatus.lifecycle.converted'), current: isCurrent('converted') },
        { status: 'rejected', label: t('proposalStatus.lifecycle.rejected'), current: isCurrent('rejected') },
    ];
    const note = isCurrent('converted')
        ? t('proposalStatus.note.converted')
        : status === 'rejected'
            ? t('proposalStatus.note.rejected')
            : t('proposalStatus.note.open');
    return { steps, note };
}
