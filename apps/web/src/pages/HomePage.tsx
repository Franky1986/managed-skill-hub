import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { skillsApi, SkillSummary } from '../api/skills';
import { useLanguage } from '../i18n';

const CATEGORY_ICONS: Record<string, string> = {
    navigation: 'route',
    'data-extraction': 'data_exploration',
    'task-automation': 'automation',
    conversational: 'chat',
    database: 'database',
    default: 'widgets',
};

function categoryIcon(category: string): string {
    const key = category.toLowerCase().replace(/\s+/g, '-');
    return CATEGORY_ICONS[key] ?? CATEGORY_ICONS.default;
}

function formatVersion(version: string | null | undefined): string {
    return version ? `v${version}` : '';
}

function riskBadgeClass(risk: string | null | undefined): string {
    switch (risk) {
        case 'low':
        case 'safe':
            return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
        case 'medium':
        case 'needs_review':
            return 'bg-amber-100 text-amber-800 border border-amber-200';
        case 'high':
        case 'critical':
            return 'bg-red-100 text-red-700 border border-red-200';
        default:
            return 'bg-surface-container-high text-on-surface border border-outline-variant';
    }
}

export function HomePage() {
    const [skills, setSkills] = useState<SkillSummary[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [tags, setTags] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const navigate = useNavigate();
    const { t } = useLanguage();

    useEffect(() => {
        skillsApi
            .listCategories()
            .then((response) => {
                const items = response.data.items ?? [];
                setCategories(items);
            })
            .catch(() => setCategories([]));
        skillsApi
            .listTags()
            .then((response) => {
                const items = response.data.items ?? [];
                setTags(items);
            })
            .catch(() => setTags([]));
    }, []);

    useEffect(() => {
        setLoading(true);
        setError(null);
        skillsApi
            .list(undefined, [], 6)
            .then((res) => setSkills(res.data.items ?? []))
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    function handleSearch(event: FormEvent) {
        event.preventDefault();
        if (!searchQuery.trim()) return;
        navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }

    if (loading) {
        return <div className="py-xl text-center text-on-surface-variant">{t('home.loadingSkills')}</div>;
    }

    if (error) {
        return (
            <div className="bg-error-container text-on-error-container rounded-xl p-lg border border-error/20">
                {t('home.error', { message: error })}
            </div>
        );
    }

    const mainFeature = skills[0];
    const sideFeatures = skills.slice(1, 3);

    return (
        <div className="space-y-xl">
            {/* Hero */}
            <section className="flex flex-col items-center justify-center text-center py-xl mb-xl">
                <h1 className="font-h1 text-h1 md:text-[2.5rem] md:leading-[3rem] text-on-background mb-md max-w-3xl">
                    {t('home.hero.title')}
                </h1>
                <p className="font-body text-body text-on-surface-variant max-w-2xl mb-xl">
                    {t('home.hero.copy')}
                </p>

                <form onSubmit={handleSearch} className="w-full max-w-3xl">
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-ambient p-sm flex items-center focus-within:border-primary focus-within:ring-2 focus-within:ring-primary-fixed transition-all">
                        <span className="material-symbols-outlined text-outline mx-sm">search</span>
                        <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            className="flex-grow bg-transparent border-none focus:ring-0 font-body text-body text-on-surface outline-none placeholder:text-outline py-2"
                            placeholder={t('home.search.placeholder')}
                            type="text"
                        />
                    </div>
                </form>
            </section>

            {/* Tags */}
            <section className="mb-xl">
                <div className="flex justify-between items-end mb-lg gap-md">
                    <div>
                        <h2 className="font-h2 text-h2 text-on-background">{t('home.tags.title')}</h2>
                        <p className="font-body text-body text-on-surface-variant">{t('home.tags.copy')}</p>
                    </div>
                    <Link
                        to="/search"
                        className="text-primary hover:underline font-body text-body flex items-center gap-xs"
                    >
                        {t('home.tags.all')}
                        <span className="material-symbols-outlined text-[1rem]">arrow_forward</span>
                    </Link>
                </div>
                {tags.length === 0 ? (
                    <div className="text-on-surface-variant font-body text-body">
                        {t('home.tags.empty')}
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-sm">
                        {tags.slice(0, 12).map((tag) => (
                            <Link
                                key={tag}
                                to={`/search?tag=${encodeURIComponent(tag)}`}
                                className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low"
                            >
                                {tag}
                            </Link>
                        ))}
                    </div>
                )}
            </section>

            {/* Categories */}
            <section className="mb-xl">
                <div className="flex justify-between items-end mb-lg">
                    <h2 className="font-h2 text-h2 text-on-background">{t('home.categories.title')}</h2>
                    <Link
                        to="/search"
                        className="text-primary hover:underline font-body text-body flex items-center gap-xs"
                    >
                        {t('home.categories.all')}
                        <span className="material-symbols-outlined text-[1rem]">arrow_forward</span>
                    </Link>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-md">
                    {categories.slice(0, 4).map((category) => (
                        <Link
                            key={category}
                            to={`/search?category=${encodeURIComponent(category)}`}
                            className="group block bg-surface-container-lowest border border-outline-variant rounded-xl p-lg hover-lift shadow-ambient"
                        >
                            <div className="bg-surface-container-low w-12 h-12 rounded-lg flex items-center justify-center mb-md group-hover:bg-primary-fixed transition-colors">
                                <span className="material-symbols-outlined text-primary text-2xl">{categoryIcon(category)}</span>
                            </div>
                            <h3 className="font-h3 text-h3 text-on-background mb-xs">{category}</h3>
                            <p className="font-body text-body text-on-surface-variant">
                                {t('home.categories.cardCopy')}
                            </p>
                        </Link>
                    ))}
                    {categories.length === 0 && (
                        <div className="col-span-full text-on-surface-variant font-body text-body">
                            {t('home.categories.empty')}
                        </div>
                    )}
                </div>
            </section>

            {/* Featured Skills */}
            <section className="mb-xl">
                <h2 className="font-h2 text-h2 text-on-background mb-lg">{t('home.skills.title')}</h2>
                {skills.length === 0 ? (
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-xl text-on-surface-variant font-body text-body">
                        {t('home.skills.empty')}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
                        {mainFeature && (
                            <Link
                                to={`/skills/${mainFeature.id}`}
                                className="md:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-lg shadow-ambient hover-lift flex flex-col justify-between min-h-[300px] relative overflow-hidden"
                            >
                                <div className="absolute top-0 right-0 w-64 h-64 bg-primary-fixed-dim rounded-full blur-3xl opacity-30 -mr-10 -mt-10 pointer-events-none"></div>
                                <div className="z-10">
                                    <div className="flex items-center gap-sm mb-md">
                                        <span className={`font-mono text-mono px-2 py-1 rounded-md ${riskBadgeClass(mainFeature.status)}`}>
                                            {mainFeature.status}
                                        </span>
                                        <span className="bg-surface-container-high text-on-surface font-small text-small px-2 py-1 rounded-md">
                                            {formatVersion(mainFeature.version)}
                                        </span>
                                    </div>
                                    <h3 className="font-h1 text-h1 text-on-background mb-sm">{mainFeature.title}</h3>
                                    <p className="font-body text-body text-on-surface-variant max-w-lg mb-lg">{mainFeature.description}</p>
                                </div>
                                <div className="flex items-center justify-between z-10 border-t border-outline-variant pt-md">
                                    <div className="flex items-center gap-sm">
                                        <span className="material-symbols-outlined text-outline">{categoryIcon(mainFeature.category)}</span>
                                        <span className="font-small text-small text-on-surface-variant">{mainFeature.category}</span>
                                    </div>
                                    <span className="text-primary font-body text-body hover:underline flex items-center gap-xs">
                                        {t('home.skills.details')}
                                        <span className="material-symbols-outlined text-[1rem]">chevron_right</span>
                                    </span>
                                </div>
                            </Link>
                        )}

                        <div className="flex flex-col gap-md">
                            {sideFeatures.map((skill) => (
                                <Link
                                    key={skill.id}
                                    to={`/skills/${skill.id}`}
                                    className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md shadow-ambient hover-lift flex-1 flex flex-col"
                                >
                                    <div className="flex justify-between items-start mb-sm">
                                        <h3 className="font-h3 text-h3 text-on-background">{skill.title}</h3>
                                        <span className={`font-mono text-mono px-2 py-1 rounded-md ${riskBadgeClass(skill.status)}`}>
                                            {skill.status}
                                        </span>
                                    </div>
                                    <p className="font-small text-small text-on-surface-variant mb-md flex-grow">{skill.description}</p>
                                    <div className="flex items-center gap-xs text-outline">
                                        <span className="material-symbols-outlined text-[1rem]">{categoryIcon(skill.category)}</span>
                                        <span className="font-small text-small">{skill.category}</span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            {/* Agent hint */}
            <section className="bg-surface-container-low rounded-2xl p-xl flex flex-col md:flex-row items-start justify-between shadow-ambient border border-outline-variant gap-lg">
                <div className="max-w-2xl">
                    <h2 className="font-h2 text-h2 text-on-background mb-sm">{t('home.agentHint.title')}</h2>
                    <p className="font-body text-body text-on-surface-variant">
                        {t('home.agentHint.copy')}
                    </p>
                </div>
                <div className="flex flex-col gap-sm">
                    <div className="rounded-xl border border-outline-variant bg-surface-container-high px-lg py-md text-sm text-on-surface">
                        {t('home.agentHint.ui')}: <span className="font-mono">/frontend</span><br />
                        {t('home.agentHint.agentStart')}: <span className="font-mono">/api/discover</span>
                    </div>
                    <Link
                        to="/how-to-propose"
                        className="bg-primary-container text-on-primary-container px-5 py-3 rounded-lg font-body text-body hover:opacity-90 transition-opacity active:scale-95 duration-150 text-center"
                    >
                        {t('home.agentHint.cta')}
                    </Link>
                </div>
            </section>
        </div>
    );
}
