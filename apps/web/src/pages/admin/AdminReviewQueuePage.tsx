import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SkillSummary } from '../../api/skills';
import { adminApi } from '../../api/admin';
import { handleApiError } from '../../api/client';
import { useLanguage } from '../../i18n';

export function AdminReviewQueuePage() {
    const { language, t } = useLanguage();
    const [skills, setSkills] = useState<SkillSummary[]>([]);
    const [filter, setFilter] = useState<'active' | 'in_review' | 'approved' | 'rejected' | 'all'>('active');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        setError(null);
        adminApi
            .listSkills()
            .then((res) => setSkills(res.data.items ?? []))
            .catch((loadError) => setError(handleApiError(loadError, language)))
            .finally(() => setLoading(false));
    }, [language]);

    if (loading) {
        return <p>{t('adminReview.loading')}</p>;
    }

    const items = skills.filter((skill) => {
        if (filter === 'active') {
            return ['in_review', 'approved'].includes(skill.status);
        }
        if (filter === 'all') {
            return ['in_review', 'approved', 'rejected'].includes(skill.status);
        }
        return skill.status === filter;
    });

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{t('adminReview.title')}</h1>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap gap-2">
                        {(['active', 'in_review', 'approved', 'rejected', 'all'] as const).map((item) => (
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
                                {t(`adminReview.filter.${item}`)}
                            </button>
                        ))}
                    </div>
                    <Link to="/admin/drafts" className="text-blue-600 hover:underline">
                        {t('adminReview.drafts')}
                    </Link>
                    <Link to="/admin/proposals" className="text-blue-600 hover:underline">
                        {t('adminReview.openProposals')}
                    </Link>
                </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {items.length === 0 ? (
                <p className="rounded border bg-white p-4 text-sm text-gray-600">{t(`adminReview.empty.${filter}`)}</p>
            ) : (
                <ul className="space-y-2">
                    {items.map((skill) => (
                        <li key={`${skill.id}-${skill.version}`} className="rounded border bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <Link to={`/admin/skills/${skill.id}`} className="font-medium hover:underline">
                                        {skill.title}
                                    </Link>
                                    <p className="mt-1 text-sm text-gray-600">{skill.description}</p>
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                                        <span>{t('adminDrafts.version')}: {skill.version}</span>
                                        <span>{t('proposalDetail.category')}: {skill.category}</span>
                                        <span>{t('common.status')}: {skill.status}</span>
                                    </div>
                                </div>
                                <Link
                                    to={`/admin/skills/${skill.id}`}
                                    className="rounded border border-blue-300 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
                                >
                                    {skill.status === 'approved'
                                        ? t('adminReview.openPublish')
                                        : skill.status === 'rejected'
                                            ? t('adminReview.openRejected')
                                            : t('adminReview.openReview')}
                                </Link>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
