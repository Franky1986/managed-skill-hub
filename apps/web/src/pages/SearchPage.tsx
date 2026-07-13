import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { skillsApi, SearchResult, SkillHistoryEntry, SkillVersionSummary } from '../api/skills';
import { JudgementBadgeRow } from '../components/JudgementPanel';
import type { JudgementRecord } from '../api/judgements';
import { useLanguage } from '../i18n';
import { formatOverallRiskLabel, isNoJudgeAvailable, noJudgeHint } from '../lib/judgement';

interface SearchResultDetailState {
    open: boolean;
    loading: boolean;
    versions: SkillVersionSummary[];
    selectedVersion: string;
    judgements: JudgementRecord[];
    history: SkillHistoryEntry[];
    error: string | null;
}

const SEARCH_PAGE_SIZE = 20;

export function SearchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [query, setQuery] = useState(searchParams.get('q') ?? '');
    const [category, setCategory] = useState(searchParams.get('category') ?? '');
    const [selectedTags, setSelectedTags] = useState(searchParams.getAll('tag'));
    const [page, setPage] = useState(readPageParam(searchParams));
    const [categories, setCategories] = useState<string[]>([]);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [detailsBySkillId, setDetailsBySkillId] = useState<Record<string, SearchResultDetailState>>({});
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const { t, language } = useLanguage();

    useEffect(() => {
        skillsApi.listCategories()
            .then((response) => setCategories(response.data.items ?? []))
            .catch(() => setCategories([]));
        skillsApi.listTags()
            .then((response) => setAvailableTags(response.data.items ?? []))
            .catch(() => setAvailableTags([]));
    }, []);

    useEffect(() => {
        const nextQuery = searchParams.get('q') ?? '';
        const nextCategory = searchParams.get('category') ?? '';
        setQuery(nextQuery);
        setCategory(nextCategory);
        setSelectedTags(searchParams.getAll('tag'));
        setPage(readPageParam(searchParams));
    }, [searchParams]);

    useEffect(() => {
        const trimmedQuery = query.trim();
        const offset = (page - 1) * SEARCH_PAGE_SIZE;

        let active = true;
        setLoading(true);

        const request = trimmedQuery
            ? skillsApi.search(trimmedQuery, category || undefined, selectedTags, SEARCH_PAGE_SIZE, offset)
            : skillsApi.list(category || undefined, selectedTags, SEARCH_PAGE_SIZE, offset);

        request
            .then((res) => {
                if (!active) {
                    return;
                }
                const items = (res.data.items ?? []).map((item: SearchResult) => ({
                    ...item,
                    score: item.score ?? null,
                }));
                setResults(items);
                setTotal(res.data.total ?? items.length);
                setDetailsBySkillId({});
            })
            .catch((err) => {
                if (active) {
                    console.error(err);
                    setResults([]);
                    setTotal(0);
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [category, page, query, selectedTags]);

    async function handleSearch(e: React.FormEvent) {
        e.preventDefault();
        updateSearchParams(1);
    }

    function updateSearchParams(nextPage: number, nextCategory = category, nextTags = selectedTags) {
        const nextParams = new URLSearchParams();
        const trimmedQuery = query.trim();
        if (trimmedQuery) {
            nextParams.set('q', trimmedQuery);
        }
        if (nextCategory) {
            nextParams.set('category', nextCategory);
        }
        for (const tag of nextTags) {
            nextParams.append('tag', tag);
        }
        if (nextPage > 1) {
            nextParams.set('page', String(nextPage));
        }
        setSearchParams(nextParams);
    }

    function toggleTag(tag: string) {
        const nextTags = selectedTags.includes(tag)
            ? selectedTags.filter((item) => item !== tag)
            : [...selectedTags, tag];
        setSelectedTags(nextTags);
        updateSearchParams(1, category, nextTags);
    }

    async function toggleDetails(result: SearchResult) {
        const current = detailsBySkillId[result.id];
        if (current?.open) {
            setDetailsBySkillId((state) => ({
                ...state,
                [result.id]: { ...current, open: false },
            }));
            return;
        }

        if (current && current.versions.length > 0) {
            setDetailsBySkillId((state) => ({
                ...state,
                [result.id]: { ...current, open: true },
            }));
            return;
        }

        setDetailsBySkillId((state) => ({
            ...state,
            [result.id]: {
                open: true,
                loading: true,
                versions: [],
                selectedVersion: result.version,
                judgements: [],
                history: [],
                error: null,
            },
        }));

        try {
            const [versionsResponse, judgementResponse, historyResponse] = await Promise.all([
                skillsApi.listVersions(result.id),
                skillsApi.listJudgements(result.id, result.version),
                skillsApi.getHistory(result.id),
            ]);
            setDetailsBySkillId((state) => ({
                ...state,
                [result.id]: {
                    open: true,
                    loading: false,
                    versions: versionsResponse.data.items ?? [],
                    selectedVersion: result.version,
                    judgements: judgementResponse.data.items ?? [],
                    history: historyResponse.data.items ?? [],
                    error: null,
                },
            }));
        } catch (error) {
            console.error(error);
            setDetailsBySkillId((state) => ({
                ...state,
                [result.id]: {
                    open: true,
                    loading: false,
                    versions: [],
                    selectedVersion: result.version,
                    judgements: [],
                    history: [],
                    error: t('search.versionDetailsError'),
                },
            }));
        }
    }

    async function handleVersionChange(result: SearchResult, version: string) {
        const current = detailsBySkillId[result.id];
        if (!current) {
            return;
        }

        setDetailsBySkillId((state) => ({
            ...state,
            [result.id]: {
                ...current,
                selectedVersion: version,
                loading: true,
                judgements: [],
                error: null,
            },
        }));

        try {
            const judgementResponse = await skillsApi.listJudgements(result.id, version);
            setDetailsBySkillId((state) => {
                const next = state[result.id];
                if (!next) {
                    return state;
                }
                return {
                    ...state,
                    [result.id]: {
                        ...next,
                        loading: false,
                        selectedVersion: version,
                        judgements: judgementResponse.data.items ?? [],
                        error: null,
                    },
                };
            });
        } catch (error) {
            console.error(error);
            setDetailsBySkillId((state) => {
                const next = state[result.id];
                if (!next) {
                    return state;
                }
                return {
                    ...state,
                    [result.id]: {
                        ...next,
                        loading: false,
                        error: t('search.judgementLoadError'),
                    },
                };
            });
        }
    }

    return (
        <div>
            <h1 className="mb-4 text-2xl font-semibold">{t('search.title')}</h1>
            <form onSubmit={handleSearch} className="mb-6 space-y-3">
                <div className="flex flex-wrap gap-2">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('search.placeholder')}
                        className="flex-1 rounded border px-3 py-2"
                    />
                    <select
                        value={category}
                        onChange={(e) => {
                            setCategory(e.target.value);
                            updateSearchParams(1, e.target.value);
                        }}
                        className="rounded border px-3 py-2"
                    >
                        <option value="">{t('search.allCategories')}</option>
                        {categories.map((item) => (
                            <option key={item} value={item}>{item}</option>
                        ))}
                    </select>
                    <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white">
                        {t('search.submit')}
                    </button>
                </div>
                {availableTags.length > 0 && (
                    <div className="rounded border bg-white p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-slate-700">{t('search.tags')}</span>
                            {selectedTags.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedTags([]);
                                        updateSearchParams(1, category, []);
                                    }}
                                    className="text-sm text-blue-700 hover:underline"
                                >
                                    {t('search.clearTags')}
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {availableTags.map((tag) => {
                                const active = selectedTags.includes(tag);
                                return (
                                    <label
                                        key={tag}
                                        className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm ${
                                            active ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-slate-300 bg-white text-slate-700'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={active}
                                            onChange={() => toggleTag(tag)}
                                        />
                                        <span>{tag}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}
            </form>

            {loading && <p>{t('search.loading')}</p>}
            {!loading && total > 0 && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
                    <span>{t('search.resultRange', {
                        from: (page - 1) * SEARCH_PAGE_SIZE + 1,
                        to: Math.min(page * SEARCH_PAGE_SIZE, total),
                        total,
                        count: results.length,
                    })}</span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => updateSearchParams(page - 1)}
                            disabled={page <= 1}
                            className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50"
                        >
                            {t('search.previousPage')}
                        </button>
                        <span>{t('search.pageLabel', { page })}</span>
                        <button
                            type="button"
                            onClick={() => updateSearchParams(page + 1)}
                            disabled={page * SEARCH_PAGE_SIZE >= total}
                            className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50"
                        >
                            {t('search.nextPage')}
                        </button>
                    </div>
                </div>
            )}
            {!loading && total === 0 && (
                <p className="rounded border bg-white p-4 text-sm text-slate-600">{t('search.empty')}</p>
            )}

            <ul className="space-y-3">
                {results.map((r) => {
                    const detail = detailsBySkillId[r.id];
                    const sortedJudgements = [...(detail?.judgements ?? [])]
                        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                    const latestJudgement = sortedJudgements[0] ?? null;
                    const selectedVersion = detail?.selectedVersion ?? r.version;
                    const selectedVersionRecord = detail?.versions.find((version) => version.version === selectedVersion) ?? null;
                    const changeNote = findChangeNote(detail?.history ?? [], selectedVersion);
                    return (
                    <li key={r.id} className="rounded border bg-white p-4">
                        <Link to={`/skills/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                        <p className="text-sm text-gray-600">{r.description}</p>
                        <div className="mt-2 flex gap-2">
                            <span className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white">{r.category}</span>
                            {r.tags.map((tag) => (
                                <span key={tag} className="rounded bg-gray-200 px-2 py-0.5 text-xs">{tag}</span>
                            ))}
                        </div>
                        {r.score !== null && (
                            <span className="text-xs text-gray-500">{t('search.score')}: {r.score.toFixed(3)}</span>
                        )}
                        <div className="mt-3">
                            <button
                                type="button"
                                onClick={() => void toggleDetails(r)}
                                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                            >
                                {detail?.open ? t('search.hideVersionDetails') : t('search.showVersionDetails')}
                            </button>
                        </div>
                        {detail?.open && (
                            <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                                {detail.loading && <p className="text-slate-600">{t('search.loadingVersionDetails')}</p>}
                                {detail.error && <p className="text-red-700">{detail.error}</p>}
                                {detail.versions.length > 0 && (
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label className="text-sm font-medium text-slate-700">
                                                {t('search.publishedVersions')}
                                            </label>
                                            <select
                                                value={selectedVersion}
                                                onChange={(event) => void handleVersionChange(r, event.target.value)}
                                                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                                            >
                                                {detail.versions.map((version) => (
                                                    <option key={version.versionUuid} value={version.version}>
                                                        {version.version === r.version ? `${version.version} (${t('search.activeVersion')})` : version.version}
                                                    </option>
                                                ))}
                                            </select>
                                            {selectedVersionRecord && (
                                                <span className="text-xs text-slate-600">
                                                    {selectedVersionRecord.status}
                                                </span>
                                            )}
                                        </div>
                                        {latestJudgement ? (
                                            <div className="rounded border border-indigo-100 bg-white p-3">
                                                {latestJudgement.skillPurposeSummary && (
                                                    <p className="text-sm text-slate-800">
                                                        <span className="font-medium">{t('search.skillPurpose')}:</span>{' '}
                                                        {latestJudgement.skillPurposeSummary}
                                                    </p>
                                                )}
                                                <p className="mt-2 text-sm text-slate-700">{latestJudgement.summary}</p>
                                                <p className="mt-2 text-xs text-slate-500">
                                                    {t('common.model')}: {latestJudgement.model ?? 'n/a'} · {t('proposalDetail.risk')}: {formatOverallRiskLabel(latestJudgement.overallRisk, t)}
                                                </p>
                                                {isNoJudgeAvailable(latestJudgement.overallRisk) && (
                                                    <p className="mt-1 text-xs text-amber-700">{noJudgeHint(t)}</p>
                                                )}
                                                <JudgementBadgeRow judgement={latestJudgement} className="mt-2" language={language} />
                                            </div>
                                        ) : (
                                            !detail.loading && <p className="text-sm text-slate-600">{t('search.noVersionJudgement')}</p>
                                        )}
                                        {changeNote && (
                                            <div className="rounded border border-emerald-100 bg-white p-3 text-sm text-slate-800">
                                                <p className="font-medium">{t('search.changeNote')}</p>
                                                <p className="mt-1">{changeNote}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </li>
                    );
                })}
            </ul>
        </div>
    );
}

function readPageParam(params: URLSearchParams): number {
    const parsed = Number(params.get('page') ?? '1');
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function findChangeNote(history: SkillHistoryEntry[], version: string): string | null {
    const direct = history
        .filter((entry) => entry.skillVersion === version)
        .reverse()
        .find((entry) => entry.action === 'publish_change_note' && typeof entry.after?.changeSummary === 'string');
    if (direct && typeof direct.after?.changeSummary === 'string') {
        return direct.after.changeSummary;
    }

    const publishEntry = history
        .filter((entry) => entry.skillVersion === version)
        .reverse()
        .find((entry) => entry.action === 'publish' && typeof entry.after?.changeSummary === 'string');
    return typeof publishEntry?.after?.changeSummary === 'string' ? publishEntry.after.changeSummary : null;
}
