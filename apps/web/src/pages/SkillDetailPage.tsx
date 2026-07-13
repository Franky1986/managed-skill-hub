import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArtifactProbeResponse, ExtractedSkillFileContent, SkillDetail, SkillFile, skillsApi } from '../api/skills';
import { handleApiError } from '../api/client';
import { SkillFileTree } from '../components/SkillFileTree';
import { ArtifactInlineViewer } from '../components/ArtifactInlineViewer';
import { useLanguage } from '../i18n';
import type { JudgementRecord } from '../api/judgements';
import { JudgementPanel } from '../components/JudgementPanel';
import { isTextLikeArtifact } from '../utils/artifact-utils';
import { formatLocalDateTime } from '../lib/formatLocalDateTime';

export function SkillDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { language, t } = useLanguage();
    const [skill, setSkill] = useState<SkillDetail | null>(null);
    const [files, setFiles] = useState<SkillFile[]>([]);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [selectedContent, setSelectedContent] = useState<string>('');
    const [selectedContentLoading, setSelectedContentLoading] = useState(false);
    const [selectedContentError, setSelectedContentError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showInvisible, setShowInvisible] = useState(false);
    const [showExtractedContent, setShowExtractedContent] = useState(false);
    const [showProbePanel, setShowProbePanel] = useState(false);
    const [extractedContentByPath, setExtractedContentByPath] = useState<Record<string, ExtractedSkillFileContent>>({});
    const [extractedContentError, setExtractedContentError] = useState<string | null>(null);
    const [loadingExtractedContent, setLoadingExtractedContent] = useState(false);
    const [probeResponseByPath, setProbeResponseByPath] = useState<Record<string, ArtifactProbeResponse>>({});
    const [probeLoadingByPath, setProbeLoadingByPath] = useState<Record<string, boolean>>({});
    const [probeErrorByPath, setProbeErrorByPath] = useState<Record<string, string | null>>({});
    const [skillJudgements, setSkillJudgements] = useState<JudgementRecord[]>([]);
    const [fileJudgementsByPath, setFileJudgementsByPath] = useState<Record<string, JudgementRecord[]>>({});

    useEffect(() => {
        let active = true;

        async function load() {
            if (!id) {
                return;
            }

            setLoading(true);
            setError(null);
            try {
                const [skillResponse, fileResponse] = await Promise.all([
                    skillsApi.get(id),
                    skillsApi.listFiles(id),
                ]);
                if (!active) {
                    return;
                }

                const nextFiles = fileResponse.data.items ?? [];
                const selectedVersion = skillResponse.data.latestPublishedVersion ?? undefined;
                const [judgementResponse, fileJudgementResponses] = await Promise.all([
                    skillsApi.listJudgements(id, selectedVersion),
                    Promise.all(
                        nextFiles.map(async (file) => {
                            const response = await skillsApi.listFileJudgements(id, file.path, selectedVersion);
                            return [file.path, response.data.items ?? []] as const;
                        })
                    ),
                ]);
                if (!active) {
                    return;
                }
                setSkill(skillResponse.data);
                setFiles(nextFiles);
                setSkillJudgements(judgementResponse.data.items ?? []);
                setFileJudgementsByPath(Object.fromEntries(fileJudgementResponses));
                setSelectedPath((current) => current ?? nextFiles[0]?.path ?? null);
            } catch (loadError) {
                if (active) {
                    setError(handleApiError(loadError, language));
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        }

        void load();

        return () => {
            active = false;
        };
    }, [id, language]);

    const selectedFile = useMemo(
        () => files.find((file) => file.path === selectedPath) ?? null,
        [files, selectedPath]
    );

    useEffect(() => {
        setShowExtractedContent(false);
        setShowProbePanel(false);
        setExtractedContentError(null);
        setLoadingExtractedContent(false);
    }, [selectedPath]);

    useEffect(() => {
        let active = true;

        async function loadFileContent() {
            if (!id || !selectedFile || !isTextLikeArtifact(selectedFile.mimeType, selectedFile.path)) {
                setSelectedContent('');
                setSelectedContentLoading(false);
                setSelectedContentError(null);
                return;
            }

            setSelectedContentLoading(true);
            setSelectedContentError(null);
            try {
                const response = await skillsApi.getFileContent(id, selectedFile.path);
                if (active) {
                    setSelectedContent(response.data);
                }
            } catch (loadError) {
                if (active) {
                    setSelectedContent('');
                    setSelectedContentError(handleApiError(loadError, language));
                }
            } finally {
                if (active) {
                    setSelectedContentLoading(false);
                }
            }
        }

        void loadFileContent();

        return () => {
            active = false;
        };
    }, [id, selectedFile]);

    if (loading) return <p>{t('skillDetail.loading')}</p>;
    if (error) return <p className="text-red-600">{t('skillDetail.error', { message: error })}</p>;
    if (!skill) return <p>{t('skillDetail.notFound')}</p>;

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold">{skill.title}</h1>
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white">{skill.category}</span>
                    {skill.tags.map((tag) => (
                        <span key={tag} className="rounded bg-gray-200 px-2 py-0.5 text-xs">{tag}</span>
                    ))}
                </div>
                <p className="text-gray-700">{skill.description}</p>
                <div className="grid gap-2 text-sm text-gray-600 md:grid-cols-2">
                    <p>{t('proposalDetail.category')}: <code>{skill.category}</code></p>
                    <p>{t('skillDetail.skillUuid')}: <code>{skill.skillUuid}</code></p>
                    <p>{t('skillDetail.latestPublishedVersion')}: <code>{skill.latestPublishedVersion ?? '—'}</code></p>
                    <p>{t('common.entrypoint')}: <code>{skill.entrypoint}</code></p>
                </div>
                {skill.capabilities.length > 0 && (
                    <div>
                        <h2 className="text-sm font-medium text-gray-900">{t('skillDetail.capabilities')}</h2>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {skill.capabilities.map((capability) => (
                                <span key={capability} className="rounded-full border border-emerald-300 px-2 py-0.5 text-xs text-emerald-800">
                                    {capability}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
                {(skill.useWhen.length > 0 || skill.doNotUseWhen.length > 0) && (
                    <div className="grid gap-4 rounded border bg-white p-4 md:grid-cols-2">
                        <div>
                            <h2 className="text-sm font-medium text-gray-900">{t('skillDetail.useWhen')}</h2>
                            {skill.useWhen.length === 0 ? (
                                <p className="mt-2 text-sm text-gray-500">{t('skillDetail.noUseWhen')}</p>
                            ) : (
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                                    {skill.useWhen.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div>
                            <h2 className="text-sm font-medium text-gray-900">{t('skillDetail.doNotUseWhen')}</h2>
                            {skill.doNotUseWhen.length === 0 ? (
                                <p className="mt-2 text-sm text-gray-500">{t('skillDetail.noDoNotUseWhen')}</p>
                            ) : (
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                                    {skill.doNotUseWhen.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <JudgementPanel
                judgements={skillJudgements}
                title={t('skillDetail.skillJudgements')}
                latestLabel={t('skillDetail.latestSkillJudgement')}
                previousLabel={(count) => t('proposalDetail.previousJudgements', { count })}
                findingsLabel={t('adminSkill.judgementFindings')}
                noJudgementsLabel={t('skillDetail.noSkillJudgements')}
                modelLabel={t('common.model')}
                riskLabel={t('adminSkill.risk')}
                historyLabel={t('adminSkill.history')}
                language={language}
            />

            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                <aside className="rounded border bg-white p-4">
                    <h2 className="mb-3 text-lg font-medium">{t('skillDetail.files')}</h2>
                    <SkillFileTree
                        files={files}
                        selectedPath={selectedPath}
                        onSelect={setSelectedPath}
                    />
                </aside>

                <section className="rounded border bg-white p-4">
                    {!selectedFile ? (
                        <p className="text-sm text-gray-500">{t('skillDetail.noFileSelected')}</p>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-medium">{selectedFile.path}</h2>
                                    <p className="text-sm text-gray-500">
                                        {selectedFile.mimeType} · {selectedFile.sizeBytes} bytes
                                    </p>
                                </div>
                                <a
                                    href={skillsApi.getFileUrl(skill.id, selectedFile.path)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                                >
                                    {t('common.download')}
                                </a>
                            </div>

                            <div className="grid gap-2 text-sm text-gray-600 md:grid-cols-2">
                                <p>{t('common.artifactId')}: <code>{selectedFile.artifactId}</code></p>
                                <p>{t('adminSkill.role')}: <code>{selectedFile.role}</code></p>
                                <p>SHA-256: <code>{selectedFile.sha256 ?? '—'}</code></p>
                                <p>{t('skillDetail.updated')}: {formatLocalDateTime(selectedFile.updatedAt)}</p>
                                <p>{t('skillDetail.extractable')}: {selectedFile.extractable ? t('common.yes') : t('common.no')}</p>
                            </div>

                            <JudgementPanel
                                judgements={fileJudgementsByPath[selectedFile.path] ?? []}
                                title={t('skillDetail.fileJudgements')}
                                latestLabel={t('skillDetail.latestFileJudgement')}
                                previousLabel={(count) => t('proposalDetail.previousJudgements', { count })}
                                findingsLabel={t('adminSkill.judgementFindings')}
                                noJudgementsLabel={t('skillDetail.noFileJudgements')}
                                modelLabel={t('common.model')}
                                riskLabel={t('adminSkill.risk')}
                                historyLabel={t('adminSkill.history')}
                                language={language}
                            />

                            <ArtifactInlineViewer
                                file={selectedFile}
                                fileUrl={skillsApi.getFileUrl(skill.id, selectedFile.path, skill.latestPublishedVersion ?? undefined)}
                                textContent={selectedContent}
                                textLoading={selectedContentLoading}
                                textError={selectedContentError}
                                showInvisible={showInvisible}
                                onShowInvisibleChange={setShowInvisible}
                                extractedContent={selectedFile.extractable ? extractedContentByPath[selectedFile.path] ?? null : null}
                                extractedLoading={selectedFile.extractable ? loadingExtractedContent : undefined}
                                extractedError={selectedFile.extractable ? extractedContentError : null}
                                onLoadExtracted={selectedFile.extractable
                                    ? () => {
                                        void ensureExtractedContent(selectedFile.path);
                                    }
                                    : undefined}
                                extractedPanelOpen={showExtractedContent}
                                onExtractedPanelToggle={selectedFile.extractable ? setShowExtractedContent : undefined}
                                probeResponse={probeResponseByPath[selectedFile.path] ?? null}
                                probeLoading={Boolean(probeLoadingByPath[selectedFile.path])}
                                probeError={probeErrorByPath[selectedFile.path] ?? null}
                                onRunProbe={() => void runProbe(selectedFile.path)}
                                probePanelOpen={showProbePanel}
                                onProbePanelToggle={setShowProbePanel}
                            />
                        </div>
                    )}
                </section>
            </div>

            <div>
                <h2 className="text-lg font-medium">{t('skillDetail.versions')}</h2>
                <ul className="mt-2 space-y-2">
                    {skill.versions.map((version) => (
                        <li key={version.versionUuid} className="rounded border bg-white p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span>
                                    <strong>{version.version}</strong> · {version.status}
                                </span>
                                <span className="text-gray-500">
                                    {version.publishedAt ? formatLocalDateTime(version.publishedAt) : t('common.notPublished')}
                                </span>
                            </div>
                            <p className="mt-2 text-gray-600">{t('skillDetail.versionUuid')}: <code>{version.versionUuid}</code></p>
                            <p className="text-gray-600">{t('common.contentDigest')}: <code>{version.contentDigest}</code></p>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );

    async function ensureExtractedContent(filePath: string) {
        if (!id) {
            return;
        }
        if (extractedContentByPath[filePath]) {
            return;
        }

        setLoadingExtractedContent(true);
        setExtractedContentError(null);
        try {
            const response = await skillsApi.getExtractedContent(id, filePath);
            setExtractedContentByPath((current) => ({
                ...current,
                [filePath]: response.data,
            }));
        } catch (loadError) {
            setExtractedContentError(handleApiError(loadError, language));
        } finally {
            setLoadingExtractedContent(false);
        }
    }

    async function runProbe(filePath: string) {
        if (!id) {
            return;
        }
        if (probeResponseByPath[filePath]) {
            return;
        }

        setProbeLoadingByPath((current) => ({ ...current, [filePath]: true }));
        setProbeErrorByPath((current) => ({ ...current, [filePath]: null }));
        try {
            const response = await skillsApi.getFileProbe(id, filePath);
            setProbeResponseByPath((current) => ({ ...current, [filePath]: response.data }));
        } catch (probeError) {
            setProbeErrorByPath((current) => ({ ...current, [filePath]: handleApiError(probeError, language) }));
        } finally {
            setProbeLoadingByPath((current) => ({ ...current, [filePath]: false }));
        }
    }
}
