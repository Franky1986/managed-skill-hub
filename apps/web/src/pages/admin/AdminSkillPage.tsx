import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { adminApi, JudgementRecord } from '../../api/admin';
import { getApiErrorCode, handleApiError } from '../../api/client';
import { SkillDetail, SkillFile, skillsApi } from '../../api/skills';
import { ArtifactInlineViewer } from '../../components/ArtifactInlineViewer';
import { SkillFileTree } from '../../components/SkillFileTree';
import { JudgementExecutionStatus, ProposalDetail } from '../../api/proposals';
import { useLanguage } from '../../i18n';
import { formatLocalDateTime } from '../../lib/formatLocalDateTime';
import { formatOverallRiskLabel, isNoJudgeAvailable, noJudgeHint } from '../../lib/judgement';
import { hasAdminRole, useAuthStore } from '../../store/auth';
import {
    buildReferenceToCurrentDiff,
    hasSelectedFileSource,
    mapProposalFilesToSkillFiles,
    selectAvailableComparisonVersions,
    selectCreatedProposalVersion,
    selectDefaultComparisonVersion,
    selectDefaultSkillFilePath,
    selectInitialSkillVersion,
    DiffLine,
} from './adminSkillPageSelectors';

export function AdminSkillPage() {
    const { language, t } = useLanguage();
    const roles = useAuthStore((state) => state.roles);
    const canAdmin = hasAdminRole(roles, 'admin');
    const canReview = hasAdminRole(roles, 'reviewer');
    const canPublish = hasAdminRole(roles, 'publisher');
    const location = useLocation();
    const { id } = useParams<{ id: string }>();
    const locationState =
        location.state as { fromProposal?: boolean; proposalId?: string; mode?: 'view' | 'edit' } | null;
    const locationSearch = new URLSearchParams(location.search);
    const proposalIdFromSearch = locationSearch.get('proposalId');
    const fromProposal =
        locationState?.fromProposal === true ||
        locationState?.proposalId != null ||
        proposalIdFromSearch != null;
    const proposalModeFromSearch = locationSearch.get('mode');
    const proposalMode = locationState?.mode ?? proposalModeFromSearch;
    const initialEditable = canAdmin && !(
        fromProposal &&
        (proposalMode === 'view' || proposalMode == null)
    );
    const fromProposalId = fromProposal
        ? (locationState?.proposalId ?? proposalIdFromSearch)
        : null;
    const [isEditMode, setIsEditMode] = useState(initialEditable);
    const [skill, setSkill] = useState<SkillDetail | null>(null);
    const [files, setFiles] = useState<SkillFile[]>([]);
    const [judgements, setJudgements] = useState<JudgementRecord[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<string>('');
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    const [selectedDirectoryPath, setSelectedDirectoryPath] = useState<string | null>(null);
    const [rawContent, setRawContent] = useState('');
    const [editableContent, setEditableContent] = useState('');
    const [extractedContent, setExtractedContent] = useState<string>('');
    const [showInvisible, setShowInvisible] = useState(false);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editCategory, setEditCategory] = useState('');
    const [editTags, setEditTags] = useState('');
    const [categories, setCategories] = useState<string[]>([]);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadPath, setUploadPath] = useState('');
    const [uploadRole, setUploadRole] = useState('attachment');
    const [deprecateReason, setDeprecateReason] = useState('');
    const [showDeprecateDialog, setShowDeprecateDialog] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [showRejectDialog, setShowRejectDialog] = useState(false);
    const [publishOverrideReason, setPublishOverrideReason] = useState('');
    const [showPublishOverrideDialog, setShowPublishOverrideDialog] = useState(false);
    const [movePath, setMovePath] = useState('');
    const [comparisonVersion, setComparisonVersion] = useState('');
    const [comparisonFileDiff, setComparisonFileDiff] = useState<DiffLine[]>([]);
    const [showComparisonDiff, setShowComparisonDiff] = useState(false);
    const [comparisonFileMissing, setComparisonFileMissing] = useState(false);
    const [comparisonError, setComparisonError] = useState<string | null>(null);
    const [isComparingFile, setIsComparingFile] = useState(false);
    const [comparisonFileCache, setComparisonFileCache] = useState<
        Record<string, { content: string; exists: boolean; role: string | null }>
    >({});
    const [comparisonFileTargetRole, setComparisonFileTargetRole] = useState<string | null>(null);
    const [proposalDetail, setProposalDetail] = useState<ProposalDetail | null>(null);
    const [proposalFinalizeComment, setProposalFinalizeComment] = useState('');
    const [showSelectedFileJudgements, setShowSelectedFileJudgements] = useState(false);
    const isReadOnlyProposalView = fromProposal && (!isEditMode || !canAdmin);
    const sortedShownJudgements = useMemo(
        () => [...judgements].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        [judgements]
    );

    const latestShownJudgement = sortedShownJudgements[0] ?? null;
    const historicalShownJudgements = sortedShownJudgements.slice(1);
    const sortedProposalJudgements = useMemo(
        () =>
            (fromProposal && proposalDetail
                ? [...proposalDetail.judgements]
                    .filter((judgement) => judgement.targetType === 'proposal')
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                : []
            ),
        [fromProposal, proposalDetail]
    );
    const canFinalizeProposal = fromProposal && proposalDetail && proposalDetail.status !== 'converted' && proposalDetail.status !== 'rejected';
    const isProposalFlowBlocked = fromProposal && proposalDetail?.status !== 'converted';
    const proposalTargetExists = proposalDetail?.conversion?.targetSkillExists === true;
    const latestProposalJudgement = sortedProposalJudgements[0] ?? null;
    const historicalProposalJudgements = sortedProposalJudgements.slice(1);

    const selectedFileJudgements = useMemo(() => {
        if (!fromProposal || !proposalDetail || !selectedFilePath) {
            return [];
        }
        const expectedPrefix = `${proposalDetail.id}:`;
        return proposalDetail.judgements
            .filter((judgement) => {
                if (judgement.targetType !== 'file') {
                    return false;
                }
                return judgement.targetId.startsWith(expectedPrefix)
                    && judgement.targetId.slice(expectedPrefix.length) === selectedFilePath;
            })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [fromProposal, proposalDetail, selectedFilePath]);

    useEffect(() => {
        void refreshSkill();
    }, [id, fromProposal, proposalIdFromSearch]);

    async function resolveProposalId(skillId: string): Promise<string | null> {
        const directProposalId = fromProposalId;
        if (directProposalId) {
            return directProposalId;
        }

        try {
            const response = await adminApi.listProposals(skillId);
            const matching = response.data.items.filter((proposal) => proposal.conversion?.targetSkillId === skillId);
            if (matching.length === 0) {
                return null;
            }
            const sortedByCreatedAt = [...matching].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            const preferred = sortedByCreatedAt.find((proposal) =>
                ['submitted', 'judged', 'approved', 'converted', 'in_review', 'pending'].includes(proposal.status)
            );
            return preferred?.id ?? sortedByCreatedAt[0]?.id ?? null;
        } catch {
            return null;
        }
    }

    useEffect(() => {
        skillsApi.listCategories()
            .then((response) => setCategories(response.data.items ?? []))
            .catch(() => setCategories([]));
    }, []);

    useEffect(() => {
        if (!skill) {
            return;
        }
        setEditTitle(skill.title);
        setEditDescription(skill.description);
        setEditCategory(skill.category);
        setEditTags(skill.tags.join(', '));
    }, [skill]);

    useEffect(() => {
        if (!id || !selectedVersion) {
            return;
        }
        void loadVersionContext(id, selectedVersion);
    }, [id, selectedVersion]);

    const selectedVersionRecord = useMemo(
        () => skill?.versions.find((version) => version.version === selectedVersion) ?? null,
        [skill, selectedVersion]
    );
    const canRejectSelectedVersion = selectedVersionRecord !== null
        && ['draft', 'in_review', 'approved'].includes(selectedVersionRecord.status);

    const proposalDisplayFiles = useMemo(
        () => (isReadOnlyProposalView && proposalDetail ? mapProposalFilesToSkillFiles(proposalDetail) : []),
        [isReadOnlyProposalView, proposalDetail]
    );

    const displayedFiles = isReadOnlyProposalView && proposalDetail ? proposalDisplayFiles : files;

    const selectedFile = useMemo(
        () => displayedFiles.find((file) => file.path === selectedFilePath) ?? null,
        [displayedFiles, selectedFilePath]
    );

    const selectedFileIsInternal = useMemo(
        () => selectedFile !== null && isInternalArtifact(selectedFile),
        [selectedFile]
    );

    const externalFiles = useMemo(
        () => displayedFiles.filter((file) => !isInternalArtifact(file)),
        [displayedFiles]
    );

    const internalFiles = useMemo(
        () => displayedFiles.filter((file) => isInternalArtifact(file)),
        [displayedFiles]
    );

    const selectedDirectoryFiles = useMemo(() => {
        if (!selectedDirectoryPath) {
            return [];
        }
        return displayedFiles.filter((file) => file.path.startsWith(`${selectedDirectoryPath}/`));
    }, [displayedFiles, selectedDirectoryPath]);

    const selectedDirectorySummary = useMemo(() => {
        if (!selectedDirectoryPath) {
            return null;
        }
        const directChildren = new Set<string>();
        let extractableFiles = 0;
        for (const file of selectedDirectoryFiles) {
            const relativePath = file.path.slice(selectedDirectoryPath.length + 1);
            const childName = relativePath.split('/')[0];
            if (childName) {
                directChildren.add(childName);
            }
            if (file.extractable) {
                extractableFiles += 1;
            }
        }
        return {
            totalFiles: selectedDirectoryFiles.length,
            directChildren: directChildren.size,
            extractableFiles,
        };
    }, [selectedDirectoryFiles, selectedDirectoryPath]);

    const selectedProposalFile = useMemo(() => {
        if (!isReadOnlyProposalView || !proposalDetail || !selectedFilePath) {
            return null;
        }
        return proposalDetail.files.find((file) => file.path === selectedFilePath) ?? null;
    }, [isReadOnlyProposalView, proposalDetail, selectedFilePath]);

    useEffect(() => {
        if (!isReadOnlyProposalView || !proposalDetail) {
            return;
        }
        setSelectedFilePath((current) => {
            if (current && proposalDisplayFiles.some((file) => file.path === current)) {
                return current;
            }
            const nextSelected = selectDefaultSkillFilePath(proposalDisplayFiles, proposalDetail.entrypoint);
            setSelectedDirectoryPath(nextSelected ? dirname(nextSelected) : null);
            return nextSelected;
        });
    }, [isReadOnlyProposalView, proposalDetail, proposalDisplayFiles]);

    const availableComparisonVersions = useMemo(() => {
        return skill ? selectAvailableComparisonVersions(skill, selectedVersion, selectedProposalFile !== null) : [];
    }, [selectedProposalFile, selectedVersion, skill]);

    const selectedVersionIndex = useMemo(
        () => skill?.versions.findIndex((version) => version.version === selectedVersion) ?? -1,
        [skill, selectedVersion]
    );

    const defaultComparisonVersion = useMemo(() => {
        return skill
            ? selectDefaultComparisonVersion(
                skill,
                availableComparisonVersions,
                selectedVersionIndex,
                selectedProposalFile !== null
            )
            : '';
    }, [availableComparisonVersions, selectedProposalFile, selectedVersionIndex, skill]);

    useEffect(() => {
        setRawContent('');
        setEditableContent('');
        setExtractedContent('');
    }, [selectedVersion, selectedFilePath]);

    useEffect(() => {
        setShowComparisonDiff(false);
        setComparisonFileDiff([]);
        setComparisonError(null);
        setComparisonFileMissing(false);
        setComparisonFileTargetRole(null);
    }, [selectedVersion, selectedFilePath]);

    useEffect(() => {
        setComparisonFileCache({});
    }, [id]);

    useEffect(() => {
        if (availableComparisonVersions.length === 0) {
            setComparisonVersion('');
            return;
        }
        setComparisonVersion((current) => {
            if (selectedProposalFile) {
                return defaultComparisonVersion;
            }
            if (!current || !availableComparisonVersions.some((version) => version.version === current)) {
                return defaultComparisonVersion;
            }
            return current;
        });
    }, [availableComparisonVersions, defaultComparisonVersion, selectedProposalFile?.path]);

    useEffect(() => {
        setMovePath(selectedFile?.path ?? '');
    }, [selectedFile?.path]);

    useEffect(() => {
        if (!selectedFilePath || selectedFileJudgements.length === 0) {
            setShowSelectedFileJudgements(false);
            return;
        }
        setShowSelectedFileJudgements(true);
    }, [selectedFilePath, selectedFileJudgements]);

    useEffect(() => {
        let active = true;

        async function loadRawContent() {
            if (
                !id
                || !selectedFile
                || !isTextLikeFile(selectedFile)
                || !hasSelectedFileSource(selectedVersion, selectedProposalFile)
            ) {
                setRawContent('');
                return;
            }

            try {
                const response = selectedProposalFile && proposalDetail
                    ? await adminApi.getProposalFileContent(proposalDetail.id, selectedProposalFile.id)
                    : await adminApi.getSkillFileContent(id, selectedFile.path, selectedVersion);
                if (active) {
                    setRawContent(response.data);
                    setEditableContent(response.data);
                }
            } catch (loadError) {
                if (active) {
                    setRawContent('');
                    setEditableContent('');
                    setError(handleApiError(loadError, language));
                }
            }
        }

        void loadRawContent();

        return () => {
            active = false;
        };
    }, [id, selectedVersion, selectedFile, selectedProposalFile, proposalDetail, language]);

    function handleSelectFile(path: string) {
        setSelectedFilePath(path);
        setSelectedDirectoryPath(dirname(path));
    }

    function getComparisonFileCacheKey(version: string, filePath: string): string {
        return `${version}::${filePath}`;
    }

    async function getComparisonFileContent(
        filePath: string,
        version: string
    ): Promise<{ content: string; exists: boolean; role: string | null }> {
        if (!id) {
            return { content: '', exists: false, role: null };
        }

        const cacheKey = getComparisonFileCacheKey(version, filePath);
        const cached = comparisonFileCache[cacheKey];
        if (cached !== undefined) {
            return cached;
        }

        try {
            const response = await adminApi.getSkillFileContent(id, filePath, version);
            let role: string | null = null;
            try {
                const fileList = await adminApi.listSkillFiles(id, version);
                role = fileList.data.items.find((file) => file.path === filePath)?.role ?? null;
            } catch {
                role = null;
            }
            const nextEntry = { content: response.data, exists: true, role };
            setComparisonFileCache((current) => ({
                ...current,
                [cacheKey]: nextEntry,
            }));
            return nextEntry;
        } catch (error) {
            const status = (error as { response?: { status?: number } }).response?.status;
            if (status === 404) {
                const nextEntry = { content: '', exists: false, role: null };
                setComparisonFileCache((current) => ({
                    ...current,
                    [cacheKey]: nextEntry,
                }));
                return nextEntry;
            }
            throw error;
        }
    }

    async function calculateComparisonDiff(version: string) {
        if (!selectedFile || !version || !isTextLikeFile(selectedFile)) {
            return;
        }

        setShowComparisonDiff(true);
        setIsComparingFile(true);
        setComparisonError(null);
        setComparisonFileMissing(false);
        try {
            const response = await getComparisonFileContent(selectedFile.path, version);
            setComparisonFileMissing(!response.exists);
            setComparisonFileTargetRole(response.role);
            if (response.exists) {
                setComparisonFileDiff(buildReferenceToCurrentDiff(response.content, editableContent));
            } else {
                setComparisonFileDiff([]);
            }
            setShowComparisonDiff(true);
        } catch (error) {
            setComparisonError(handleApiError(error, language));
            setShowComparisonDiff(false);
        } finally {
            setIsComparingFile(false);
        }
    }

    async function handleToggleComparisonDiff() {
        if (!selectedFile || !comparisonVersion || !isTextLikeFile(selectedFile)) {
            return;
        }

        if (showComparisonDiff) {
            setShowComparisonDiff(false);
            return;
        }

        await calculateComparisonDiff(comparisonVersion);
    }

    function handleComparisonVersionChange(version: string) {
        setComparisonVersion(version);
        if (showComparisonDiff) {
            void calculateComparisonDiff(version);
        }
    }


    async function loadVersionContext(skillId: string, version: string, entrypoint: string | null = skill?.entrypoint ?? null) {
        setError(null);
        try {
            const [fileResponse, judgementResponse] = await Promise.all([
                adminApi.listSkillFiles(skillId, version),
                adminApi.listJudgements('skill', `${skillId}:${version}`),
            ]);

            const nextFiles = fileResponse.data.items ?? [];
            setFiles(nextFiles);
            setJudgements(judgementResponse.data.items ?? []);
            setSelectedFilePath((current) => {
                const nextSelected =
                    current && nextFiles.some((file) => file.path === current)
                        ? current
                        : selectDefaultSkillFilePath(nextFiles, entrypoint);
                setSelectedDirectoryPath((selectedDirectory) => {
                    if (
                        selectedDirectory &&
                        nextFiles.some((file) => file.path === selectedDirectory || file.path.startsWith(`${selectedDirectory}/`))
                    ) {
                        return selectedDirectory;
                    }
                    return nextSelected ? dirname(nextSelected) : null;
                });
                return nextSelected;
            });
        } catch (loadError) {
            setError(handleApiError(loadError, language));
        }
    }

    function renderVersionSelectorBlock() {
        return (
            <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="text-sm">
                            {isReadOnlyProposalView ? t('adminSkill.referenceVersion') : 'Version'}
                            <select
                                value={selectedVersion}
                                onChange={(event) => setSelectedVersion(event.target.value)}
                                className="ml-2 rounded border px-2 py-1"
                            >
                                {skill?.versions.map((version) => (
                                    <option key={version.versionUuid} value={version.version}>
                                        {version.version} · {version.status}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {selectedVersionRecord && (
                            <span className="text-sm text-gray-600">
                                {selectedVersionRecord.versionUuid}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {isProposalFlowBlocked && (
                            <p className="text-sm text-gray-600">
                                {t('adminSkill.proposalFlowBlocked')}
                            </p>
                        )}
                        {!isProposalFlowBlocked && (
                            <>
                                {canAdmin && selectedVersionRecord?.status === 'draft' && (
                                    <button
                                        type="button"
                                        onClick={() => void handleVersionAction('submit-review')}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                                    >
                                        Submit Review
                                    </button>
                                )}
                                {canReview && canRejectSelectedVersion && (
                                    <button
                                        type="button"
                                        onClick={() => setShowRejectDialog(true)}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                                    >
                                        {t('adminSkill.rejectVersion')}
                                    </button>
                                )}
                                {canReview && selectedVersionRecord?.status === 'in_review' && (
                                    <button
                                        type="button"
                                        onClick={() => void handleVersionAction('approve')}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                                    >
                                        {t('adminSkill.approveVersion')}
                                    </button>
                                )}
                                {canPublish && selectedVersionRecord?.status === 'approved' && (
                                    <button
                                        type="button"
                                        onClick={() => void handleVersionAction('publish')}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                                    >
                                        {t('adminSkill.publishVersion')}
                                    </button>
                                )}
                                {canPublish && selectedVersionRecord?.status === 'published' && (
                                    <button
                                        type="button"
                                        onClick={() => setShowDeprecateDialog(true)}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                                    >
                                        {t('adminSkill.deprecateVersion')}
                                    </button>
                                )}
                            </>
                        )}
                        {(canReview || canAdmin) && selectedVersionRecord && (
                            <button
                                type="button"
                                onClick={() => void handleRejudge()}
                                disabled={Boolean(actionLoading)}
                                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                            >
                                {isReadOnlyProposalView ? t('adminSkill.rejudgeReferenceVersion') : 'Re-Judge'}
                            </button>
                        )}
                    </div>
                </div>
                {selectedVersionRecord?.status === 'rejected' && (
                    <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                        <p className="font-medium">{t('adminSkill.rejectedVersion')}</p>
                        <p className="mt-1">
                            {t('adminSkill.rejectedBy')}: {selectedVersionRecord.rejectedBy ?? 'n/a'}
                            {selectedVersionRecord.rejectedAt
                                ? ` · ${formatJudgementDate(selectedVersionRecord.rejectedAt, language)}`
                                : ''}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap">{selectedVersionRecord.rejectionReason ?? ''}</p>
                    </div>
                )}
                {selectedVersionRecord && (
                    <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                        <h3 className="text-sm font-medium text-slate-950">{t('adminSkill.versionLifecycle')}</h3>
                        <dl className="mt-2 grid gap-2 md:grid-cols-2">
                            {buildVersionLifecycleRows(selectedVersionRecord, language, t).map((row) => (
                                <div key={row.label}>
                                    <dt className="text-xs uppercase text-slate-500">{row.label}</dt>
                                    <dd className="text-sm text-slate-800">{row.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                )}
            </>
        );
    }

    function renderReferenceVersionJudgePanel() {
        return (
            <div className="mt-4 rounded border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
                {latestShownJudgement ? (
                    <>
                        <h3 className="mb-2 text-sm font-medium text-indigo-950">
                            {isReadOnlyProposalView
                                ? t('adminSkill.referenceVersionJudge', { version: selectedVersionRecord?.version ?? '—' })
                                : t('adminSkill.globalJudge', { version: selectedVersionRecord?.version ?? '—' })}
                        </h3>
                        {isReadOnlyProposalView && (
                            <p className="mb-2 text-xs text-indigo-800">
                                {t('adminSkill.referenceVersionJudgeNote')}
                            </p>
                        )}
                        <div className="space-y-2 rounded bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="text-sm font-medium text-gray-900">
                                    {isReadOnlyProposalView ? t('adminSkill.latestReferenceVersionJudge') : t('adminSkill.latestJudge')}
                                </p>
                                <p className="text-xs text-gray-500">{formatJudgementDate(latestShownJudgement.createdAt, language)}</p>
                            </div>
                            <p className="text-sm text-gray-700">{latestShownJudgement.summary}</p>
                                <p className="text-xs text-gray-600">
                                {t('common.model')}: {latestShownJudgement.model ?? 'n/a'} · {t('adminSkill.risk')}: {formatOverallRiskLabel(latestShownJudgement.overallRisk, t, t('judgement.notJudged'))}
                            </p>
                            {isNoJudgeAvailable(latestShownJudgement.overallRisk) && (
                                <p className="mt-1 text-xs text-amber-700">{noJudgeHint(t)}</p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-2">
                                {renderJudgementFlags(latestShownJudgement)}
                            </div>
                            {renderJudgementFindings(latestShownJudgement, t('adminSkill.judgementFindings'))}
                            {historicalShownJudgements.length > 0 && (
                                <details className="mt-2">
                                    <summary className="cursor-pointer text-xs text-indigo-800">
                                        {t('adminSkill.previousJudgements', { count: historicalShownJudgements.length })}
                                    </summary>
                                    <div className="mt-2 space-y-2">
                                        {historicalShownJudgements.map((judgement) => (
                                            <div
                                                key={judgement.id}
                                                className="rounded border border-indigo-100 bg-indigo-50 p-2"
                                            >
                                                <div className="flex flex-wrap items-start justify-between gap-2">
                                                    <p className="text-xs font-medium text-gray-900">{t('adminSkill.history')}</p>
                                                    <p className="text-xs text-gray-500">{formatJudgementDate(judgement.createdAt, language)}</p>
                                                </div>
                                                <p className="text-xs text-gray-700">{judgement.summary}</p>
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {renderJudgementFlags(judgement)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-gray-600">
                        {isReadOnlyProposalView ? t('adminSkill.noReferenceVersionJudge') : t('adminSkill.noGlobalJudge')}
                    </p>
                )}
            </div>
        );
    }

    function renderProposalJudgePanel() {
        if (!fromProposal || !proposalDetail) {
            return null;
        }

        return (
            <div className="rounded border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
                <div className="rounded bg-white p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-medium text-indigo-950">
                            {t('adminSkill.proposalJudge', { id: proposalDetail.id })}
                        </h3>
                        {canReview && proposalDetail.status !== 'rejected' && (
                            <button
                                type="button"
                                onClick={() => void handleRejudgeProposal()}
                                disabled={Boolean(actionLoading)}
                                className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {actionLoading === 'proposal-rejudge'
                                    ? t('adminSkill.proposalRejudging')
                                    : t('adminSkill.rejudgeProposal')}
                            </button>
                        )}
                    </div>
                    {renderJudgementExecutionStatus(proposalDetail.judgement)}
                    {latestProposalJudgement ? (
                            <div className="space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="text-sm font-medium text-gray-900">{t('adminSkill.latestProposalJudge')}</p>
                                <p className="text-xs text-gray-500">
                                    {formatJudgementDate(latestProposalJudgement.createdAt, language)}
                                </p>
                            </div>
                            <p className="text-sm text-gray-700">{latestProposalJudgement.summary}</p>
                                <p className="text-xs text-gray-600">
                                {t('common.model')}: {latestProposalJudgement.model ?? 'n/a'} · {t('adminSkill.risk')}: {formatOverallRiskLabel(latestProposalJudgement.overallRisk, t, t('judgement.notJudged'))}
                                </p>
                                {isNoJudgeAvailable(latestProposalJudgement.overallRisk) && (
                                    <p className="mt-1 text-xs text-amber-700">{noJudgeHint(t)}</p>
                                )}
                                <div className="mt-2 flex flex-wrap gap-2">{renderJudgementFlags(latestProposalJudgement)}</div>
                            {renderJudgementFindings(latestProposalJudgement, t('adminSkill.judgementFindings'))}
                            {historicalProposalJudgements.length > 0 && (
                                <details className="mt-2">
                                    <summary className="cursor-pointer text-xs text-indigo-800">
                                        {t('adminSkill.previousProposalJudgements', { count: historicalProposalJudgements.length })}
                                    </summary>
                                    <div className="mt-2 space-y-2">
                                        {historicalProposalJudgements.map((judgement) => (
                                            <div
                                                key={judgement.id}
                                                className="rounded border border-indigo-100 bg-indigo-50 p-2"
                                            >
                                                <div className="flex flex-wrap items-start justify-between gap-2">
                                                    <p className="text-xs font-medium text-gray-900">{t('adminSkill.history')}</p>
                                                    <p className="text-xs text-gray-500">{formatJudgementDate(judgement.createdAt, language)}</p>
                                                </div>
                                                <p className="text-xs text-gray-700">{judgement.summary}</p>
                                                <div className="mt-1 flex flex-wrap gap-1">{renderJudgementFlags(judgement)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}
                        </div>
                    ) : (
                        <p className="mt-2 text-sm text-gray-600">{t('adminSkill.noProposalJudge')}</p>
                    )}
                    {proposalDetail.lifecycle.length > 0 && (
                        <details className="mt-3">
                            <summary className="cursor-pointer text-xs text-indigo-800">{t('adminSkill.proposalLifecycle')}</summary>
                            <ol className="mt-2 space-y-2">
                                {proposalDetail.lifecycle.map((event) => (
                                    <li key={event.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                                        <p className="font-medium text-slate-900">{formatLifecycleAction(event.action, t)}</p>
                                        <p>{formatJudgementDate(event.at, language)} · {event.actor}</p>
                                        {(event.fromStatus || event.toStatus) && (
                                            <p>{event.fromStatus ?? '—'} → {event.toStatus ?? '—'}</p>
                                        )}
                                        {(event.skillId || event.skillVersion) && (
                                            <p>{event.skillId ?? '—'} {event.skillVersion ? `@${event.skillVersion}` : ''}</p>
                                        )}
                                        {event.reason && <p>{t('adminSkill.lifecycleReason')}: {event.reason}</p>}
                                        {event.comment && <p>{t('adminSkill.lifecycleComment')}: {event.comment}</p>}
                                    </li>
                                ))}
                            </ol>
                        </details>
                    )}
                </div>
            </div>
        );
    }

    function renderJudgementExecutionStatus(status: JudgementExecutionStatus) {
        const stateLabel = status.state === 'completed'
            ? t('adminSkill.judgeState.completed')
            : status.state === 'unavailable'
                ? t('adminSkill.judgeState.unavailable')
                : status.state === 'failed'
                    ? t('adminSkill.judgeState.failed')
                    : t('adminSkill.judgeState.notStarted');
        const stateClass = status.state === 'completed'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : status.state === 'failed'
                ? 'border-red-200 bg-red-50 text-red-900'
                : status.state === 'unavailable'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-slate-200 bg-slate-50 text-slate-800';

        return (
            <div className={`rounded border p-2 text-xs ${stateClass}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{stateLabel}</strong>
                    <span>{t('adminSkill.judgeProvider')}: <code>{status.provider}</code></span>
                </div>
                {status.attemptedAt && (
                    <p className="mt-1">{t('adminSkill.judgeAttemptedAt')}: {formatJudgementDate(status.attemptedAt, language)}</p>
                )}
                {status.message && <p className="mt-1">{status.message}</p>}
            </div>
        );
    }

    if (loading) {
        return <p>{t('adminSkill.loading')}</p>;
    }

    if (!skill) {
        return <p>{t('adminSkill.notFound')}</p>;
    }

    return (
        <div className="space-y-6">
            <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold">{skill.title}</h1>
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white">{skill.category}</span>
                    {skill.tags.map((tag) => (
                        <span key={tag} className="rounded bg-gray-200 px-2 py-0.5 text-xs">{tag}</span>
                    ))}
                </div>
                <p className="text-gray-700">{skill.description}</p>
                {fromProposal && proposalDetail && !proposalTargetExists && (
                    <div className="rounded border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm text-amber-900">{t('adminSkill.proposalCreatesNewSkill')}</p>
                        <p className="mt-1 text-xs text-amber-800">{t('adminSkill.proposalMetadataHint')}</p>
                        <Link
                            to={`/admin/skills/${proposalDetail.conversion.targetSkillId}?fromProposal=1&proposalId=${encodeURIComponent(proposalDetail.id)}&mode=view`}
                            state={{ fromProposal: true, proposalId: proposalDetail.id, mode: 'view' }}
                            className="mt-2 inline-flex rounded border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900"
                        >
                            {t('adminSkill.openSkillCreate')}
                        </Link>
                    </div>
                )}
                {fromProposal && canAdmin && (
                    <div className="mt-2">
                        <button
                            type="button"
                            onClick={() => setIsEditMode((current) => !current)}
                            className="rounded border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-900 hover:bg-indigo-100"
                        >
                            {isReadOnlyProposalView ? t('adminSkill.enableEditing') : t('adminSkill.backToView')}
                        </button>
                    </div>
                )}
                <div className="grid gap-2 text-sm text-gray-600 md:grid-cols-2">
                    <p>{t('skillDetail.skillUuid')}: <code>{skill.skillUuid}</code></p>
                    <p>{t('skillDetail.latestPublishedVersion')}: <code>{skill.latestPublishedVersion ?? '—'}</code></p>
                    <p>{t('common.entrypoint')}: <code>{skill.entrypoint}</code></p>
                </div>
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
            </section>

            {fromProposal && proposalDetail && canFinalizeProposal && (canPublish || canReview) && (
                <section className="rounded border bg-white p-4">
                    <h2 className="mb-3 text-lg font-medium">{t('adminSkill.finalizeProposal')}</h2>
                    <p className="text-sm text-gray-600">
                        {t('adminSkill.finalizeCopy', { id: proposalDetail.id })}
                    </p>
                    <label className="mt-3 block text-sm font-medium text-gray-700" htmlFor="proposal-finalize-comment">
                        {t('adminSkill.finalizeComment')}
                    </label>
                    <textarea
                        id="proposal-finalize-comment"
                        value={proposalFinalizeComment}
                        onChange={(event) => setProposalFinalizeComment(event.target.value)}
                        rows={3}
                        className="mt-2 w-full rounded border px-3 py-2 text-sm"
                        placeholder={t('adminSkill.finalizePlaceholder')}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                        {canPublish && <button
                            type="button"
                            onClick={() => void handleFinalizeProposalFromContext('draft')}
                            disabled={Boolean(actionLoading)}
                            className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 disabled:opacity-50"
                        >
                            {t('adminSkill.finalizeProposal')}
                        </button>}
                        {canAdmin && <button
                            type="button"
                            onClick={() => void handleFinalizeProposalFromContext('review')}
                            disabled={Boolean(actionLoading)}
                            className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 disabled:opacity-50"
                        >
                            {t('adminSkill.finalizeAndReview')}
                        </button>}
                        {canAdmin && <button
                            type="button"
                            onClick={() => void handleFinalizeProposalFromContext('publish')}
                            disabled={Boolean(actionLoading)}
                            className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900 disabled:opacity-50"
                        >
                            {t('adminSkill.finalizeAndPublish')}
                        </button>}
                        {canReview && <button
                            type="button"
                            onClick={() => void handleRejectProposalFromContext()}
                            disabled={Boolean(actionLoading)}
                            className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 disabled:opacity-50"
                        >
                            {actionLoading === 'reject-proposal'
                                ? t('adminSkill.rejectingProposal')
                                : t('adminSkill.rejectProposal')}
                        </button>}
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                        {t('common.status')}: {proposalDetail.status}
                    </p>
                </section>
            )}

            {isReadOnlyProposalView && fromProposal && proposalDetail && (
                <section className="rounded border bg-white p-4">
                    {proposalDetail.status === 'converted' && renderVersionSelectorBlock()}
                    {renderProposalJudgePanel()}
                    {proposalDetail.status === 'converted' && renderReferenceVersionJudgePanel()}
                    {notice && <p className="mt-3 text-sm text-green-700">{notice}</p>}
                    {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                </section>
            )}

            {!isReadOnlyProposalView && (
            <section className="rounded border bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="text-sm">
                            {isReadOnlyProposalView ? t('adminSkill.referenceVersion') : 'Version'}
                            <select
                                value={selectedVersion}
                                onChange={(event) => setSelectedVersion(event.target.value)}
                                className="ml-2 rounded border px-2 py-1"
                            >
                                {skill.versions.map((version) => (
                                    <option key={version.versionUuid} value={version.version}>
                                        {version.version} · {version.status}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {selectedVersionRecord && (
                            <span className="text-sm text-gray-600">
                                {selectedVersionRecord.versionUuid}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {isProposalFlowBlocked && (
                            <p className="text-sm text-gray-600">
                                {t('adminSkill.proposalFlowBlocked')}
                            </p>
                        )}
                        {!isProposalFlowBlocked && (
                            <>
                                {canAdmin && selectedVersionRecord?.status === 'draft' && (
                                    <button
                                        type="button"
                                        onClick={() => void handleVersionAction('submit-review')}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                                    >
                                        Submit Review
                                    </button>
                                )}
                                {canReview && canRejectSelectedVersion && (
                                    <button
                                        type="button"
                                        onClick={() => setShowRejectDialog(true)}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                                    >
                                        {t('adminSkill.rejectVersion')}
                                    </button>
                                )}
                                {canReview && selectedVersionRecord?.status === 'in_review' && (
                                    <button
                                        type="button"
                                        onClick={() => void handleVersionAction('approve')}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                                    >
                                        {t('adminSkill.approveVersion')}
                                    </button>
                                )}
                                {canPublish && selectedVersionRecord?.status === 'approved' && (
                                    <button
                                        type="button"
                                        onClick={() => void handleVersionAction('publish')}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                                    >
                                        {t('adminSkill.publishVersion')}
                                    </button>
                                )}
                                {canPublish && selectedVersionRecord?.status === 'published' && (
                                    <button
                                        type="button"
                                        onClick={() => setShowDeprecateDialog(true)}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                                    >
                                        {t('adminSkill.deprecateVersion')}
                                    </button>
                                )}
                            </>
                        )}
                        {canAdmin && selectedVersionRecord && (
                            <button
                                type="button"
                                onClick={() => void handleRejudge()}
                                disabled={Boolean(actionLoading)}
                                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                            >
                                {isReadOnlyProposalView ? t('adminSkill.rejudgeReferenceVersion') : 'Re-Judge'}
                            </button>
                        )}
                    </div>
                </div>
                {selectedVersionRecord?.status === 'rejected' && (
                    <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                        <p className="font-medium">{t('adminSkill.rejectedVersion')}</p>
                        <p className="mt-1">
                            {t('adminSkill.rejectedBy')}: {selectedVersionRecord.rejectedBy ?? 'n/a'}
                            {selectedVersionRecord.rejectedAt
                                ? ` · ${formatJudgementDate(selectedVersionRecord.rejectedAt, language)}`
                                : ''}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap">{selectedVersionRecord.rejectionReason ?? ''}</p>
                    </div>
                )}
                {selectedVersionRecord && (
                    <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                        <h3 className="text-sm font-medium text-slate-950">{t('adminSkill.versionLifecycle')}</h3>
                        <dl className="mt-2 grid gap-2 md:grid-cols-2">
                            {buildVersionLifecycleRows(selectedVersionRecord, language, t).map((row) => (
                                <div key={row.label}>
                                    <dt className="text-xs uppercase text-slate-500">{row.label}</dt>
                                    <dd className="text-sm text-slate-800">{row.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                )}
                <div className="mt-4 rounded border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
                    {latestShownJudgement ? (
                        <>
                            <h3 className="mb-2 text-sm font-medium text-indigo-950">
                                {isReadOnlyProposalView
                                    ? t('adminSkill.referenceVersionJudge', { version: selectedVersionRecord?.version ?? '—' })
                                    : t('adminSkill.globalJudge', { version: selectedVersionRecord?.version ?? '—' })}
                            </h3>
                            {isReadOnlyProposalView && (
                                <p className="mb-2 text-xs text-indigo-800">
                                    {t('adminSkill.referenceVersionJudgeNote')}
                                </p>
                            )}
                            <div className="space-y-2 rounded bg-white p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <p className="text-sm font-medium text-gray-900">{t('adminSkill.latestJudge')}</p>
                                    <p className="text-xs text-gray-500">{formatJudgementDate(latestShownJudgement.createdAt, language)}</p>
                                </div>
                                <p className="text-sm text-gray-700">{latestShownJudgement.summary}</p>
                                <p className="text-xs text-gray-600">
                                    {t('common.model')}: {latestShownJudgement.model ?? 'n/a'} · {t('adminSkill.risk')}: {formatOverallRiskLabel(latestShownJudgement.overallRisk, t, t('judgement.notJudged'))}
                                </p>
                                {isNoJudgeAvailable(latestShownJudgement.overallRisk) && (
                                    <p className="mt-1 text-xs text-amber-700">{noJudgeHint(t)}</p>
                                )}
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {renderJudgementFlags(latestShownJudgement)}
                                </div>
                                {renderJudgementFindings(latestShownJudgement, t('adminSkill.judgementFindings'))}
                                {historicalShownJudgements.length > 0 && (
                                    <details className="mt-2">
                                        <summary className="cursor-pointer text-xs text-indigo-800">
                                            {t('adminSkill.previousJudgements', { count: historicalShownJudgements.length })}
                                        </summary>
                                        <div className="mt-2 space-y-2">
                                            {historicalShownJudgements.map((judgement) => (
                                                <div
                                                    key={judgement.id}
                                                    className="rounded border border-indigo-100 bg-indigo-50 p-2"
                                                >
                                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <p className="text-xs font-medium text-gray-900">{t('adminSkill.history')}</p>
                                                        <p className="text-xs text-gray-500">{formatJudgementDate(judgement.createdAt, language)}</p>
                                                    </div>
                                                    <p className="text-xs text-gray-700">{judgement.summary}</p>
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {renderJudgementFlags(judgement)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                )}
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-gray-600">
                            {isReadOnlyProposalView ? t('adminSkill.noReferenceVersionJudge') : t('adminSkill.noGlobalJudge')}
                        </p>
                    )}
                    {fromProposal && proposalDetail && (
                        <div className="mt-3 rounded bg-white p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-sm font-medium text-indigo-950">
                                    {t('adminSkill.proposalJudge', { id: proposalDetail.id })}
                                </h3>
                                {canReview && proposalDetail.status !== 'converted' && proposalDetail.status !== 'rejected' && (
                                    <button
                                        type="button"
                                        onClick={() => void handleRejudgeProposal()}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {actionLoading === 'proposal-rejudge'
                                            ? t('adminSkill.proposalRejudging')
                                            : t('adminSkill.rejudgeProposal')}
                                    </button>
                                )}
                            </div>
                            {latestProposalJudgement ? (
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <p className="text-sm font-medium text-gray-900">{t('adminSkill.latestProposalJudge')}</p>
                                        <p className="text-xs text-gray-500">
                                            {formatJudgementDate(latestProposalJudgement.createdAt, language)}
                                        </p>
                                    </div>
                                    <p className="text-sm text-gray-700">{latestProposalJudgement.summary}</p>
                                <p className="text-xs text-gray-600">
                                    {t('common.model')}: {latestProposalJudgement.model ?? 'n/a'} · {t('adminSkill.risk')}: {formatOverallRiskLabel(latestProposalJudgement.overallRisk, t, t('judgement.notJudged'))}
                                </p>
                                {isNoJudgeAvailable(latestProposalJudgement.overallRisk) && (
                                    <p className="mt-1 text-xs text-amber-700">{noJudgeHint(t)}</p>
                                )}
                                <div className="mt-2 flex flex-wrap gap-2">{renderJudgementFlags(latestProposalJudgement)}</div>
                                    {renderJudgementFindings(latestProposalJudgement, t('adminSkill.judgementFindings'))}
                                    {historicalProposalJudgements.length > 0 && (
                                        <details className="mt-2">
                                            <summary className="cursor-pointer text-xs text-indigo-800">
                                                {t('adminSkill.previousProposalJudgements', { count: historicalProposalJudgements.length })}
                                            </summary>
                                            <div className="mt-2 space-y-2">
                                                {historicalProposalJudgements.map((judgement) => (
                                                    <div
                                                        key={judgement.id}
                                                        className="rounded border border-indigo-100 bg-indigo-50 p-2"
                                                    >
                                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                                            <p className="text-xs font-medium text-gray-900">{t('adminSkill.history')}</p>
                                                            <p className="text-xs text-gray-500">{formatJudgementDate(judgement.createdAt, language)}</p>
                                                        </div>
                                                        <p className="text-xs text-gray-700">{judgement.summary}</p>
                                                        <div className="mt-1 flex flex-wrap gap-1">{renderJudgementFlags(judgement)}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </details>
                                    )}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-600">{t('adminSkill.noProposalJudge')}</p>
                            )}
                            {proposalDetail.lifecycle.length > 0 && (
                                <details className="mt-3">
                                    <summary className="cursor-pointer text-xs text-indigo-800">{t('adminSkill.proposalLifecycle')}</summary>
                                    <ol className="mt-2 space-y-2">
                                        {proposalDetail.lifecycle.map((event) => (
                                            <li key={event.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                                                <p className="font-medium text-slate-900">{formatLifecycleAction(event.action, t)}</p>
                                                <p>{formatJudgementDate(event.at, language)} · {event.actor}</p>
                                                {(event.fromStatus || event.toStatus) && (
                                                    <p>{event.fromStatus ?? '—'} → {event.toStatus ?? '—'}</p>
                                                )}
                                                {(event.skillId || event.skillVersion) && (
                                                    <p>{event.skillId ?? '—'} {event.skillVersion ? `@${event.skillVersion}` : ''}</p>
                                                )}
                                                {event.reason && <p>{t('adminSkill.lifecycleReason')}: {event.reason}</p>}
                                                {event.comment && <p>{t('adminSkill.lifecycleComment')}: {event.comment}</p>}
                                            </li>
                                        ))}
                                    </ol>
                                </details>
                            )}
                        </div>
                    )}
                </div>
                {notice && <p className="mt-3 text-sm text-green-700">{notice}</p>}
                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            </section>
            )}

            {canAdmin && !isReadOnlyProposalView && (
                <section className="rounded border bg-white p-4">
                    <h2 className="mb-3 text-lg font-medium">{t('adminSkill.updateMetadata')}</h2>
                    <form
                        className="grid gap-4 md:grid-cols-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleMetadataUpdate();
                        }}
                    >
                        <label className="block text-sm md:col-span-1">
                            {t('proposalStatus.fieldTitle')}
                            <input
                                value={editTitle}
                                onChange={(event) => setEditTitle(event.target.value)}
                                className="mt-1 w-full rounded border px-3 py-2"
                                required
                            />
                        </label>

                        <label className="block text-sm md:col-span-1">
                            {t('proposalDetail.category')}
                            <input
                                list="admin-skill-categories"
                                value={editCategory}
                                onChange={(event) => setEditCategory(event.target.value)}
                                className="mt-1 w-full rounded border px-3 py-2"
                                required
                            />
                            <datalist id="admin-skill-categories">
                                {categories.map((item) => (
                                    <option key={item} value={item} />
                                ))}
                            </datalist>
                        </label>

                        <label className="block text-sm md:col-span-2">
                            {t('adminSkillCreate.description')}
                            <textarea
                                value={editDescription}
                                onChange={(event) => setEditDescription(event.target.value)}
                                className="mt-1 min-h-28 w-full rounded border px-3 py-2"
                                required
                            />
                        </label>

                        <label className="block text-sm md:col-span-2">
                            Tags
                            <input
                                value={editTags}
                                onChange={(event) => setEditTags(event.target.value)}
                                className="mt-1 w-full rounded border px-3 py-2"
                                placeholder="comma,separated,tags"
                            />
                        </label>

                        <div className="md:col-span-2 flex justify-end">
                            <button
                                type="submit"
                                disabled={Boolean(actionLoading)}
                                className="rounded border px-4 py-2 text-sm disabled:opacity-50"
                            >
                                {fromProposal && !proposalTargetExists
                                    ? t('adminSkill.updateProposalMetadata')
                                    : t('adminSkill.createDraftVersion')}
                            </button>
                        </div>
                    </form>
                </section>
            )}

            {canAdmin && !fromProposal && (
                <section className="rounded border bg-white p-4">
                    <h2 className="mb-3 text-lg font-medium">{t('adminSkill.addFile')}</h2>
                    <form
                        className="grid gap-4 md:grid-cols-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleFileUpload();
                        }}
                    >
                        <label className="block text-sm md:col-span-1">
                            {t('adminSkill.baseVersion')}
                            <input
                                value={selectedVersion}
                                readOnly
                                className="mt-1 w-full rounded border bg-gray-50 px-3 py-2 text-gray-600"
                            />
                        </label>

                        <label className="block text-sm md:col-span-1">
                            {t('adminSkill.role')}
                            <select
                                value={uploadRole}
                                onChange={(event) => setUploadRole(event.target.value)}
                                className="mt-1 w-full rounded border px-3 py-2"
                            >
                                <option value="attachment">attachment</option>
                                <option value="entrypoint">entrypoint</option>
                                <option value="example">example</option>
                                <option value="knowledge">knowledge</option>
                                <option value="test">test</option>
                            </select>
                        </label>

                        <label className="block text-sm md:col-span-2">
                            {t('adminSkill.targetFilePath')}
                            <input
                                value={uploadPath}
                                onChange={(event) => setUploadPath(event.target.value)}
                                className="mt-1 w-full rounded border px-3 py-2"
                                placeholder="docs/guide.md"
                            />
                            {selectedDirectoryPath && (
                                <p className="mt-1 text-xs text-gray-500">
                                    {t('adminSkill.selectedFolderContext')}: <code>{selectedDirectoryPath}</code>
                                </p>
                            )}
                        </label>

                        <label className="block text-sm md:col-span-2">
                            {t('adminSkill.file')}
                            <input
                                type="file"
                                onChange={(event) => {
                                    const nextFile = event.target.files?.[0] ?? null;
                                    setUploadFile(nextFile);
                                    setUploadPath((current) => current || nextFile?.name || '');
                                }}
                                className="mt-1 w-full rounded border px-3 py-2"
                            />
                        </label>

                        <div className="md:col-span-2 flex justify-end">
                            <button
                                type="submit"
                                disabled={Boolean(actionLoading) || !uploadFile || !selectedVersion}
                                className="rounded border px-4 py-2 text-sm disabled:opacity-50"
                            >
                                {t('adminSkill.createDraftWithFile')}
                            </button>
                        </div>
                    </form>
                </section>
            )}

            <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                <aside className="rounded border bg-white p-4">
                    <h2 className="mb-3 text-lg font-medium">{t('adminSkill.artifacts')}</h2>
                    {isReadOnlyProposalView && proposalDetail && (
                        <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                            {t('adminSkill.proposalArtifactSource', {
                                proposalId: proposalDetail.id,
                                version: selectedVersionRecord?.version ?? '—',
                            })}
                        </p>
                    )}
                    <SkillFileTree
                        files={externalFiles}
                        selectedPath={selectedFilePath}
                        selectedDirectoryPath={selectedDirectoryPath}
                        onSelect={handleSelectFile}
                        onSelectDirectory={setSelectedDirectoryPath}
                        displayRootPath={dirname(proposalDetail?.entrypoint ?? skill?.entrypoint ?? null)}
                        emptyLabel={t('adminSkill.noFilesForVersion')}
                    />

                    {internalFiles.length > 0 && (
                        <>
                            <div className="my-3 border-t border-dashed border-gray-300">
                                <p className="mt-2 text-xs uppercase tracking-wide text-gray-500">{t('adminSkill.internalDocuments')}</p>
                            </div>
                            <SkillFileTree
                                files={internalFiles}
                                selectedPath={selectedFilePath}
                                selectedDirectoryPath={selectedDirectoryPath}
                                onSelect={handleSelectFile}
                                onSelectDirectory={setSelectedDirectoryPath}
                                displayRootPath={dirname(proposalDetail?.entrypoint ?? skill?.entrypoint ?? null)}
                                emptyLabel={t('adminSkill.noInternalDocuments')}
                            />
                        </>
                    )}

                    {selectedDirectoryPath && selectedDirectorySummary && (
                        <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                            <p className="font-medium text-slate-900">{t('adminSkill.folderContext')}</p>
                            <p className="mt-2 break-all text-xs text-slate-700">
                                <code>{selectedDirectoryPath}</code>
                            </p>
                            <div className="mt-2 space-y-1 text-xs text-slate-600">
                                <p>{t('adminSkill.filesBelow')}: {selectedDirectorySummary.totalFiles}</p>
                                <p>{t('adminSkill.directEntries')}: {selectedDirectorySummary.directChildren}</p>
                                <p>{t('adminSkill.extractable')}: {selectedDirectorySummary.extractableFiles}</p>
                            </div>
                            {(canAdmin && !isReadOnlyProposalView && !fromProposal && !selectedFileIsInternal) && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setUploadPath(joinPath(selectedDirectoryPath, uploadFile?.name ?? ''))}
                                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                    >
                                        {t('adminSkill.useAsUploadTarget')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!selectedFile) {
                                                return;
                                            }
                                            setMovePath(joinPath(selectedDirectoryPath, basename(selectedFile.path)));
                                        }}
                                        disabled={!selectedFile}
                                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                                    >
                                        {t('adminSkill.moveCurrentFileHere')}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </aside>

                <div className="space-y-4">
                    <section className="rounded border bg-white p-4">
                        {!selectedFile ? (
                            <p className="text-sm text-gray-500">{t('adminSkill.noFileSelected')}</p>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <h2 className="text-lg font-medium">{selectedFile.path}</h2>
                                        <p className="text-sm text-gray-500">
                                            {selectedFile.mimeType} · {selectedFile.sizeBytes} bytes
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        {canAdmin && !isReadOnlyProposalView && !selectedFileIsInternal && (
                                            <button
                                                type="button"
                                                onClick={() => void handleReextract()}
                                                disabled={Boolean(actionLoading) || !selectedFile.extractable}
                                                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                                            >
                                                {t('adminSkill.reextract')}
                                            </button>
                                        )}
                                        <a
                                            href={selectedProposalFile && proposalDetail
                                                ? adminApi.getProposalFileUrl(proposalDetail.id, selectedProposalFile.id)
                                                : adminApi.getSkillFileUrl(skill.id, selectedFile.path, selectedVersion)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                                        >
                                            {t('common.download')}
                                        </a>
                                    </div>
                                </div>

                                <div className="grid gap-2 text-sm text-gray-600 md:grid-cols-2">
                                    <p>{t('common.artifactId')}: <code>{selectedFile.artifactId}</code></p>
                                    <p>{t('adminSkill.role')}: <code>{selectedFile.role}</code></p>
                                    <p>SHA-256: <code>{selectedFile.sha256 ?? '—'}</code></p>
                                    <p>{t('skillDetail.updated')}: {formatLocalDateTime(selectedFile.updatedAt)}</p>
                                    <p>{t('skillDetail.extractable')}: {selectedFile.extractable ? t('common.yes') : t('common.no')}</p>
                                </div>

                                {(selectedProposalFile || selectedFileJudgements.length > 0) && (
                                    <details
                                        className="rounded border border-gray-200"
                                        open={showSelectedFileJudgements || selectedFileJudgements.length === 0}
                                        onToggle={(event) =>
                                            setShowSelectedFileJudgements((event.currentTarget as HTMLDetailsElement).open)
                                        }
                                    >
                                        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                                            {t('adminSkill.selectedFileJudgements', { count: selectedFileJudgements.length })}
                                        </summary>
                                        <div className="space-y-2 border-t px-4 py-3">
                                            {selectedProposalFile && (
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        {renderJudgementExecutionStatus(selectedProposalFile.judgement)}
                                                    </div>
                                                    {canReview && selectedProposalFile.extractable && (
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleRejudgeProposalFile(selectedProposalFile.id)}
                                                            disabled={Boolean(actionLoading)}
                                                            className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 disabled:opacity-50"
                                                        >
                                                            {actionLoading === `proposal-file-rejudge:${selectedProposalFile.id}`
                                                                ? t('adminSkill.fileRejudging')
                                                                : t('adminSkill.rejudgeFile')}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            {selectedFileJudgements.length === 0 && (
                                                <p className="text-xs text-slate-600">{t('adminSkill.noFileJudge')}</p>
                                            )}
                                            {selectedFileJudgements.map((judgement) => (
                                                <div
                                                    key={judgement.id}
                                                    className="rounded border border-slate-200 bg-slate-50 p-2"
                                                >
                                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <p className="text-xs font-medium text-slate-900">{judgement.summary}</p>
                                                        <p className="text-xs text-slate-500">{formatJudgementDate(judgement.createdAt, language)}</p>
                                                    </div>
                                                    <p className="mt-1 text-xs text-slate-700">
                                                        {t('common.model')}: {judgement.model ?? 'n/a'}
                                                    </p>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {renderJudgementFlags(judgement)}
                                                    </div>
                                                    {renderJudgementFindings(judgement, t('adminSkill.judgementFindings'))}
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                )}

                                {(!selectedFileIsInternal && (isReadOnlyProposalView || !isTextLikeFile(selectedFile))) && (
                                    <ArtifactInlineViewer
                                        file={selectedFile}
                                        artifactId={selectedFile.artifactId}
                                        fileUrl={selectedProposalFile && proposalDetail
                                            ? adminApi.getProposalFileUrl(proposalDetail.id, selectedProposalFile.id)
                                            : adminApi.getSkillFileUrl(skill.id, selectedFile.path, selectedVersion)}
                                        textContent={rawContent}
                                        textLoading={false}
                                        textError={null}
                                        showInvisible={showInvisible}
                                        onShowInvisibleChange={setShowInvisible}
                                        extractedContent={selectedFile.extractable && extractedContent
                                            ? {
                                                text: extractedContent,
                                                extractedBy: 'loaded',
                                                metadata: {},
                                            }
                                            : null}
                                        extractedLoading={actionLoading === 'load-extracted' || actionLoading === 'reextract'}
                                        extractedError={error}
                                        onLoadExtracted={selectedFile.extractable
                                            ? () => {
                                                void loadExtractedContent();
                                            }
                                            : undefined}
                                        extractedPanelOpen={selectedFile.extractable ? Boolean(extractedContent) : false}
                                        onExtractedPanelToggle={(isOpen) => {
                                            if (isOpen && !extractedContent) {
                                                void loadExtractedContent();
                                            }
                                        }}
                                    />
                                )}

                                {canAdmin && !isReadOnlyProposalView && !selectedFileIsInternal && (
                                    <div className="rounded border border-gray-200 p-4">
                                        <h3 className="text-sm font-medium text-gray-900">{t('adminSkill.moveRenameFile')}</h3>
                                        {selectedDirectoryPath && (
                                            <p className="mt-2 text-xs text-gray-500">
                                                {t('adminSkill.selectedFolderContext')}: <code>{selectedDirectoryPath}</code>
                                            </p>
                                        )}
                                        <div className="mt-3 flex flex-col gap-3 md:flex-row">
                                            <input
                                                value={movePath}
                                                onChange={(event) => setMovePath(event.target.value)}
                                                className="w-full rounded border px-3 py-2 text-sm"
                                                placeholder="docs/archive/guide.md"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => void handleMoveFile()}
                                                disabled={Boolean(actionLoading) || !selectedVersion || !selectedFile || movePath.trim().length === 0}
                                                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                                            >
                                                {t('adminSkill.createDraftVersion')}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {canAdmin && !isReadOnlyProposalView && !selectedFileIsInternal && (
                                    <div className="rounded border border-red-200 bg-red-50 p-4">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-sm font-medium text-red-900">{t('adminSkill.removeFileTitle')}</h3>
                                                <p className="text-xs text-red-700">
                                                    {t('adminSkill.removeFileCopy')}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => void handleDeleteFile()}
                                                disabled={Boolean(actionLoading) || !selectedVersion || !selectedFile || selectedFile.role === 'entrypoint'}
                                                className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                                            >
                                                {t('adminSkill.removeFile')}
                                            </button>
                                        </div>
                                        {selectedFile.role === 'entrypoint' && (
                                            <p className="mt-2 text-xs text-red-700">
                                                {t('adminSkill.entrypointMoveRequired')}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {isTextLikeFile(selectedFile) && (
                                    <div className="space-y-3">
                                        {!selectedFileIsInternal ? (
                                            <div className="rounded border border-gray-200 p-4">
                                                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                                    <h3 className="text-sm font-medium text-gray-900">
                                                        {isReadOnlyProposalView ? t('adminSkill.textContent') : t('adminSkill.editTextContent')}
                                                    </h3>
                                                    {canAdmin && !isReadOnlyProposalView && (
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleSaveFileContent()}
                                                            disabled={Boolean(actionLoading) || editableContent === rawContent}
                                                            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                                                        >
                                                            {t('adminSkill.saveDraftVersion')}
                                                        </button>
                                                    )}
                                                </div>
                                                {isReadOnlyProposalView ? (
                                                    <pre className="max-h-72 min-h-72 overflow-x-auto overflow-y-auto rounded border border-slate-200 bg-slate-950 p-4 font-mono text-sm text-slate-100 whitespace-pre-wrap break-words">
                                                        {showInvisible ? renderVisibleText(editableContent) : editableContent}
                                                    </pre>
                                                ) : (
                                                    <textarea
                                                        value={editableContent}
                                                        onChange={(event) => {
                                                            setEditableContent(event.target.value);
                                                            setShowComparisonDiff(false);
                                                            setComparisonFileDiff([]);
                                                        }}
                                                        className="min-h-72 w-full rounded border px-3 py-2 font-mono text-sm"
                                                        spellCheck={false}
                                                    />
                                                )}
                                            </div>
                                        ) : (
                                            <div className="rounded border border-gray-200 bg-slate-50 p-4">
                                                <h3 className="text-sm font-medium text-gray-900">{t('adminSkill.internalFileText')}</h3>
                                                <p className="mt-2 text-sm text-slate-600">
                                                    {t('adminSkill.internalFileCopy')}
                                                </p>
                                            </div>
                                        )}
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                                <span>{t('adminSkill.compareWithVersion')}:</span>
                                                <select
                                                    value={comparisonVersion}
                                                    onChange={(event) => handleComparisonVersionChange(event.target.value)}
                                                    className="rounded border px-2 py-1 text-sm"
                                                >
                                                    {availableComparisonVersions.map((version) => (
                                                        <option key={version.versionUuid} value={version.version}>
                                                            {version.version} · {version.status}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            {availableComparisonVersions.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => void handleToggleComparisonDiff()}
                                                    disabled={Boolean(actionLoading) || isComparingFile || !comparisonVersion}
                                                    className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                                                >
                                                    {showComparisonDiff ? t('adminSkill.hideDiff') : t('adminSkill.showDiff')}
                                                </button>
                                            )}
                                        </div>
                                        <label className="flex items-center gap-2 text-sm text-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={showInvisible}
                                                onChange={(event) => setShowInvisible(event.target.checked)}
                                            />
                                            {t('adminSkill.showInvisible')}
                                        </label>
                                        {availableComparisonVersions.length === 0 && (
                                            <p className="text-xs text-gray-500">{t('adminSkill.noComparisonVersions')}</p>
                                        )}
                                        {showComparisonDiff && (
                                            <div className="rounded border border-gray-200 bg-slate-50 p-3">
                                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-xs text-gray-500">{t('adminSkill.diffAgainstVersion', { version: comparisonVersion })}</p>
                                            {comparisonFileMissing ? (
                                                <p className="text-xs text-amber-700">{t('adminSkill.fileMissingInComparison')}</p>
                                            ) : (
                                                <p className="text-xs text-slate-700">
                                                    {t('adminSkill.comparisonRole')}: <code>{comparisonFileTargetRole ?? t('proposalDetail.unknown')}</code>
                                                </p>
                                            )}
                                            {!comparisonFileMissing && comparisonFileTargetRole === 'entrypoint' && (
                                                <p className="text-xs font-medium text-emerald-700">
                                                    {t('adminSkill.entrypointInComparison')}
                                                </p>
                                            )}
                                        </div>
                                                {isComparingFile && <p className="text-xs text-gray-500">{t('adminSkill.diffCalculating')}</p>}
                                                {comparisonError && <p className="text-xs text-red-600">{comparisonError}</p>}
                                                {!comparisonError && !isComparingFile && !comparisonFileMissing && (
                                                    <pre className="overflow-x-auto rounded border border-slate-200 bg-white p-2">
                                                        {comparisonFileDiff.length === 0 ? (
                                                            <span className="text-xs text-gray-500">{t('adminSkill.noDifference')}</span>
                                                        ) : (
                                                            comparisonFileDiff.map((line, index) => (
                                                                <div
                                                                    key={`${comparisonVersion}-${selectedFile.path}-${index}`}
                                                                    className={`flex min-h-4 items-start ${renderDiffLineClass(line.type)}`}
                                                                >
                                                                    <span className="inline-block w-6 shrink-0 text-center text-xs font-bold opacity-70">
                                                                        {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                                                                    </span>
                                                                    <span className="inline-block min-w-0 flex-1 font-mono text-xs whitespace-pre-wrap break-words">
                                                                        {showInvisible ? renderVisibleText(line.value) : line.value}
                                                                    </span>
                                                                </div>
                                                            ))
                                                        )}
                                                    </pre>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {selectedFile.extractable && !selectedFileIsInternal && isTextLikeFile(selectedFile) && (
                                    <details className="rounded border border-gray-200">
                                        <summary
                                            className="cursor-pointer px-4 py-3 text-sm font-medium"
                                            onClick={() => {
                                                if (!extractedContent) {
                                                    void loadExtractedContent();
                                                }
                                            }}
                                        >
                                            {t('adminSkill.extractedContent')}
                                        </summary>
                                        <div className="border-t px-4 py-3">
                                            {extractedContent ? (
                                                <pre className="overflow-x-auto rounded bg-gray-100 p-4 text-sm text-gray-800">
                                                    {showInvisible ? renderVisibleText(extractedContent) : extractedContent}
                                                </pre>
                                            ) : (
                                                <p className="text-sm text-gray-500">{t('adminSkill.notLoadedYet')}</p>
                                            )}
                                        </div>
                                    </details>
                                )}
                            </div>
                        )}
                    </section>

                </div>
            </section>
            {isReadOnlyProposalView && proposalDetail?.status !== 'converted' && (
                <section className="rounded border bg-white p-4">
                    {renderVersionSelectorBlock()}
                    {renderReferenceVersionJudgePanel()}
                </section>
            )}
            {showDeprecateDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded border bg-white p-4 shadow-lg">
                        <h3 className="text-lg font-medium">{t('adminSkill.confirmDeprecate')}</h3>
                        <p className="mt-1 text-sm text-gray-600">
                            {t('adminSkill.deprecateCopy', { version: selectedVersionRecord?.version ?? '—' })}
                        </p>
                        <label className="mt-3 block text-sm font-medium text-gray-700" htmlFor="deprecate-reason">{t('adminSkill.deprecateReason')}</label>
                        <textarea
                            id="deprecate-reason"
                            value={deprecateReason}
                            onChange={(event) => setDeprecateReason(event.target.value)}
                            rows={3}
                            className="mt-2 w-full rounded border px-3 py-2 text-sm"
                            placeholder={t('adminSkill.deprecatePlaceholder')}
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowDeprecateDialog(false)}
                                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
                            >
                                {t('adminSkill.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleConfirmDeprecate()}
                                disabled={Boolean(actionLoading)}
                                className="rounded bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                            >
                                Deprecate
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showRejectDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded border bg-white p-4 shadow-lg">
                        <h3 className="text-lg font-medium">{t('adminSkill.confirmReject')}</h3>
                        <p className="mt-1 text-sm text-gray-600">
                            {t('adminSkill.rejectCopy', { version: selectedVersionRecord?.version ?? '—' })}
                        </p>
                        <label className="mt-3 block text-sm font-medium text-gray-700" htmlFor="reject-reason">{t('adminSkill.rejectReason')}</label>
                        <textarea
                            id="reject-reason"
                            value={rejectReason}
                            onChange={(event) => setRejectReason(event.target.value)}
                            rows={3}
                            className="mt-2 w-full rounded border px-3 py-2 text-sm"
                            placeholder={t('adminSkill.rejectPlaceholder')}
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowRejectDialog(false)}
                                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
                            >
                                {t('adminSkill.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleConfirmReject()}
                                disabled={Boolean(actionLoading) || rejectReason.trim().length === 0}
                                className="rounded bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                            >
                                {t('adminSkill.rejectVersion')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showPublishOverrideDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded border bg-white p-4 shadow-lg">
                        <h3 className="text-lg font-medium">{t('adminSkill.publishOverrideTitle')}</h3>
                        <p className="mt-1 text-sm text-gray-600">{t('adminSkill.publishOverrideCopy')}</p>
                        <label className="mt-3 block text-sm font-medium text-gray-700" htmlFor="publish-override-reason">
                            {t('adminSkill.publishOverrideReason')}
                        </label>
                        <textarea
                            id="publish-override-reason"
                            value={publishOverrideReason}
                            onChange={(event) => setPublishOverrideReason(event.target.value)}
                            rows={3}
                            className="mt-2 w-full rounded border px-3 py-2 text-sm"
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowPublishOverrideDialog(false)}
                                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
                            >
                                {t('adminSkill.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleConfirmPublishOverride()}
                                disabled={Boolean(actionLoading) || publishOverrideReason.trim().length === 0}
                                className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                            >
                                {t('adminSkill.publishWithOverride')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    async function refreshSkill(preferredVersion?: string) {
        if (!id) {
            return;
        }
        setLoading(true);
        setError(null);
        setNotice(null);
        setProposalDetail(null);
        try {
            let nextProposalDetail: ProposalDetail | null = null;
            if (fromProposal) {
                const resolvedProposalId = fromProposalId ?? (await resolveProposalId(id));
                if (resolvedProposalId) {
                    try {
                        const proposalResponse = await adminApi.getProposal(resolvedProposalId);
                        nextProposalDetail = proposalResponse.data;
                    } catch {
                        nextProposalDetail = null;
                    }
                }
            }
            const response = await adminApi.getSkill(id);
            const nextSkill = response.data;
            const nextVersion = preferredVersion && nextSkill.versions.some((version) => version.version === preferredVersion)
                ? preferredVersion
                : selectInitialSkillVersion(nextSkill, nextProposalDetail);
            setSkill(nextSkill);
            setSelectedVersion((current) => (fromProposal ? nextVersion : current || nextVersion));
            setSelectedDirectoryPath((current) => current ?? dirname(nextSkill.entrypoint));
            if (nextVersion) {
                await loadVersionContext(id, nextVersion, nextSkill.entrypoint);
            }

            if (fromProposal) {
                setProposalDetail(nextProposalDetail);
                setProposalFinalizeComment('');
            }
        } catch (loadError) {
            if (fromProposal) {
                const resolvedProposalId = fromProposalId ?? (await resolveProposalId(id));
                if (resolvedProposalId) {
                    try {
                        const proposalResponse = await adminApi.getProposal(resolvedProposalId);
                        const nextProposalDetail = proposalResponse.data;
                        const syntheticSkill = buildProposalContextSkill(id, nextProposalDetail);
                        setSkill(syntheticSkill);
                        setProposalDetail(nextProposalDetail);
                        setSelectedVersion('');
                        setFiles([]);
                        setJudgements([]);
                        setSelectedFilePath(selectDefaultSkillFilePath(mapProposalFilesToSkillFiles(nextProposalDetail), nextProposalDetail.entrypoint));
                        setSelectedDirectoryPath(dirname(nextProposalDetail.entrypoint ?? nextProposalDetail.conversion.targetEntrypoint ?? 'SKILL.md'));
                        setProposalFinalizeComment('');
                        return;
                    } catch {
                        // fall through to normal error handling
                    }
                }
            }
            setError(handleApiError(loadError, language));
        } finally {
            setLoading(false);
        }
    }

    async function handleMetadataUpdate() {
        if (!id) {
            return;
        }
        const updatePayload = {
            title: editTitle,
            description: editDescription,
            category: editCategory,
            tags: parseCommaList(editTags),
        };
        setActionLoading('update-metadata');
        setError(null);
        setNotice(null);
        if (fromProposal && !proposalDetail) {
            setError(t('adminSkill.error.proposalContextUnavailable'));
            setActionLoading(null);
            return;
        }
        if (fromProposal && proposalDetail && !proposalTargetExists) {
            try {
                await adminApi.updateProposal(proposalDetail.id, updatePayload);
                await refreshSkill();
                setNotice(t('adminSkill.notice.proposalMetadataUpdated'));
            } catch (updateError) {
                setError(handleApiError(updateError, language));
            } finally {
                setActionLoading(null);
            }
            return;
        }
        try {
            const response = await adminApi.updateSkill(id, updatePayload);
            await refreshSkill();
            setSelectedVersion(response.data.version);
            setNotice(t('adminSkill.notice.metadataDraft'));
        } catch (updateError) {
            setError(handleApiError(updateError, language));
        } finally {
            setActionLoading(null);
        }
    }

    async function handleFinalizeProposalFromContext(target: 'draft' | 'review' | 'publish') {
        if (!id || !proposalDetail) {
            return;
        }
        if (!canFinalizeProposal) {
            return;
        }
        if (target === 'publish' && !window.confirm(t('adminSkill.confirmFinalizeAndPublish'))) {
            return;
        }
        setActionLoading(target === 'draft' ? 'finalize-proposal' : `finalize-${target}`);
        setError(null);
        setNotice(null);
        const trimmedComment = proposalFinalizeComment.trim();
        try {
            const response = await adminApi.convertProposal(
                proposalDetail.id,
                trimmedComment.length > 0 ? trimmedComment : undefined
            );
            const createdVersion = selectCreatedProposalVersion(response.data, proposalDetail)
                ?? response.data.versions[response.data.versions.length - 1]?.version;
            const targetSkillId = response.data.id;
            if (createdVersion && target !== 'draft') {
                await adminApi.submitForReview(targetSkillId, createdVersion);
            }
            if (createdVersion && target === 'publish') {
                await adminApi.approve(targetSkillId, createdVersion);
                await adminApi.publish(targetSkillId, createdVersion);
            }
            await refreshSkill(createdVersion);
            if (createdVersion) {
                setSelectedVersion(createdVersion);
            }
            setProposalFinalizeComment('');
            setNotice(
                target === 'publish'
                    ? t('adminSkill.notice.proposalFinalizedAndPublished')
                    : target === 'review'
                        ? t('adminSkill.notice.proposalFinalizedAndReview')
                        : t('adminSkill.notice.proposalFinalized')
            );
            window.dispatchEvent(new Event('skillHub:proposalDecision'));
        } catch (finalizeError) {
            setError(handleApiError(finalizeError, language));
        } finally {
            setActionLoading(null);
        }
    }

    async function handleRejectProposalFromContext() {
        if (!proposalDetail) {
            return;
        }
        if (!canFinalizeProposal) {
            return;
        }
        const trimmedReason = proposalFinalizeComment.trim();
        if (trimmedReason.length === 0) {
            setError(t('adminSkill.error.rejectionReasonRequired'));
            return;
        }
        setActionLoading('reject-proposal');
        setError(null);
        setNotice(null);
        try {
            await adminApi.rejectProposal(proposalDetail.id, trimmedReason);
            setProposalFinalizeComment('');
            await refreshSkill();
            setNotice(t('adminSkill.notice.proposalRejected'));
            window.dispatchEvent(new Event('skillHub:proposalDecision'));
        } catch (rejectError) {
            setError(handleApiError(rejectError, language));
        } finally {
            setActionLoading(null);
        }
    }

    async function handleVersionAction(action: 'submit-review' | 'approve' | 'publish' | 'reject' | 'deprecate', reason?: string) {
        if (!id || !selectedVersionRecord) {
            return;
        }
        if (isProposalFlowBlocked) {
            setError(t('adminSkill.error.reviewBlocked'));
            return;
        }
        setActionLoading(action);
        setError(null);
        setNotice(null);
        try {
            if (action === 'submit-review') {
                await adminApi.submitForReview(id, selectedVersionRecord.version);
            } else if (action === 'approve') {
                await adminApi.approve(id, selectedVersionRecord.version);
            } else if (action === 'publish') {
                await adminApi.publish(id, selectedVersionRecord.version, reason);
            } else if (action === 'reject') {
                await adminApi.rejectSkillVersion(id, selectedVersionRecord.version, reason ?? '');
            } else {
                await adminApi.deprecate(id, selectedVersionRecord.version, reason);
            }
            setNotice(t('adminSkill.notice.actionDone', { action }));
            await refreshSkill();
        } catch (actionError) {
            if (action === 'publish' && canAdmin && getApiErrorCode(actionError) === 'JUDGEMENT_REQUIRED') {
                setShowPublishOverrideDialog(true);
            }
            setError(handleApiError(actionError, language));
        } finally {
            setActionLoading(null);
        }
    }

    async function handleConfirmDeprecate() {
        if (!id || !selectedVersionRecord) {
            return;
        }
        const trimmed = deprecateReason.trim();
        await handleVersionAction('deprecate', trimmed.length > 0 ? trimmed : undefined);
        setShowDeprecateDialog(false);
        setDeprecateReason('');
    }

    async function handleConfirmReject() {
        if (!id || !selectedVersionRecord) {
            return;
        }
        const trimmed = rejectReason.trim();
        if (trimmed.length === 0) {
            setError(t('adminSkill.error.rejectionReasonRequired'));
            return;
        }
        await handleVersionAction('reject', trimmed);
        setShowRejectDialog(false);
        setRejectReason('');
    }

    async function handleConfirmPublishOverride() {
        const trimmed = publishOverrideReason.trim();
        if (!trimmed) {
            return;
        }
        await handleVersionAction('publish', trimmed);
        setShowPublishOverrideDialog(false);
        setPublishOverrideReason('');
    }

    async function handleRejudge() {
        if (!id || !selectedVersionRecord) {
            return;
        }
        setActionLoading('rejudge');
        setError(null);
        setNotice(null);
        try {
            const response = await adminApi.rejudgeSkillVersion(id, selectedVersionRecord.version);
            setJudgements((current) => [response.data, ...current]);
            setNotice(t('adminSkill.notice.rejudged'));
        } catch (actionError) {
            setError(handleApiError(actionError, language));
        } finally {
            setActionLoading(null);
        }
    }

    async function handleRejudgeProposal() {
        if (!proposalDetail) {
            return;
        }
        setActionLoading('proposal-rejudge');
        setError(null);
        setNotice(null);
        try {
            await adminApi.judgeProposal(proposalDetail.id);
            const response = await adminApi.getProposal(proposalDetail.id);
            setProposalDetail(response.data);
            setNotice(t('adminSkill.notice.proposalRejudged'));
        } catch (actionError) {
            setError(handleApiError(actionError, language));
            try {
                const response = await adminApi.getProposal(proposalDetail.id);
                setProposalDetail(response.data);
            } catch {
                // Keep the original provider error visible when status refresh also fails.
            }
        } finally {
            setActionLoading(null);
        }
    }

    async function handleRejudgeProposalFile(fileId: string) {
        if (!proposalDetail) {
            return;
        }
        setActionLoading(`proposal-file-rejudge:${fileId}`);
        setError(null);
        setNotice(null);
        try {
            await adminApi.judgeProposalFile(proposalDetail.id, fileId);
            const response = await adminApi.getProposal(proposalDetail.id);
            setProposalDetail(response.data);
            setNotice(t('adminSkill.notice.fileRejudged'));
        } catch (actionError) {
            setError(handleApiError(actionError, language));
            try {
                const response = await adminApi.getProposal(proposalDetail.id);
                setProposalDetail(response.data);
            } catch {
                // Keep the original provider error visible when status refresh also fails.
            }
        } finally {
            setActionLoading(null);
        }
    }

    async function handleReextract() {
        if (!id || !selectedVersion || !selectedFile) {
            return;
        }
        setActionLoading('reextract');
        setError(null);
        setNotice(null);
        try {
            const response = await adminApi.reextractSkillFile(id, selectedFile.path, selectedVersion);
            setExtractedContent(response.data.text);
            setNotice(t('adminSkill.notice.reextracted'));
        } catch (actionError) {
            setError(handleApiError(actionError, language));
        } finally {
            setActionLoading(null);
        }
    }

    async function loadExtractedContent() {
        if (!id || !selectedFile || !hasSelectedFileSource(selectedVersion, selectedProposalFile)) {
            return;
        }
        setActionLoading('load-extracted');
        setError(null);
        try {
            const response = selectedProposalFile && proposalDetail
                ? await adminApi.getProposalExtractedContent(proposalDetail.id, selectedProposalFile.id)
                : await adminApi.getSkillExtractedContent(id, selectedFile.path, selectedVersion);
            setExtractedContent(response.data.text);
        } catch (loadError) {
            setError(handleApiError(loadError, language));
        } finally {
            setActionLoading(null);
        }
    }

    async function handleFileUpload() {
        if (!id || !selectedVersion || !uploadFile) {
            return;
        }
        setActionLoading('upload-file');
        setError(null);
        setNotice(null);
        try {
            const response = await adminApi.uploadSkillFile(
                id,
                selectedVersion,
                uploadFile,
                uploadPath || uploadFile.name,
                uploadRole
            );
            await refreshSkill();
            setSelectedVersion(response.data.version);
            setUploadFile(null);
            setUploadPath('');
            setUploadRole('attachment');
            setNotice(t('adminSkill.notice.fileAdded'));
        } catch (uploadError) {
            setError(handleApiError(uploadError, language));
        } finally {
            setActionLoading(null);
        }
    }

    async function handleMoveFile() {
        if (!id || !selectedVersion || !selectedFile) {
            return;
        }
        setActionLoading('move-file');
        setError(null);
        setNotice(null);
        try {
            const nextPath = movePath.trim();
            const response = await adminApi.moveSkillFile(id, selectedVersion, selectedFile.path, nextPath);
            await refreshSkill();
            setSelectedVersion(response.data.version);
            setSelectedFilePath(nextPath);
            setNotice(t('adminSkill.notice.fileMoved'));
        } catch (moveError) {
            setError(handleApiError(moveError, language));
        } finally {
            setActionLoading(null);
        }
    }

    async function handleDeleteFile() {
        if (!id || !selectedVersion || !selectedFile) {
            return;
        }
        if (!window.confirm(t('adminSkill.confirmDeleteFile', { path: selectedFile.path }))) {
            return;
        }
        setActionLoading('delete-file');
        setError(null);
        setNotice(null);
        try {
            const response = await adminApi.deleteSkillFile(id, selectedVersion, selectedFile.path);
            await refreshSkill();
            setSelectedVersion(response.data.version);
            setSelectedFilePath(null);
            setNotice(t('adminSkill.notice.fileDeleted'));
        } catch (deleteError) {
            setError(handleApiError(deleteError, language));
        } finally {
            setActionLoading(null);
        }
    }

    async function handleSaveFileContent() {
        if (!id || !selectedVersion || !selectedFile || !isTextLikeFile(selectedFile)) {
            return;
        }
        setActionLoading('save-file-content');
        setError(null);
        setNotice(null);
        try {
            const response = await adminApi.updateSkillFileContent(
                id,
                selectedVersion,
                selectedFile.path,
                editableContent,
                selectedFile.mimeType
            );
            await refreshSkill();
            setSelectedVersion(response.data.version);
            setSelectedFilePath(selectedFile.path);
            setNotice(t('adminSkill.notice.fileContentUpdated'));
        } catch (saveError) {
            setError(handleApiError(saveError, language));
        } finally {
            setActionLoading(null);
        }
    }
}

function isTextLikeFile(file: SkillFile): boolean {
    return file.mimeType.startsWith('text/') || /\.(md|markdown|txt|ya?ml|json|csv|ts|tsx|js|jsx|css|html?|xml|sh)$/i.test(file.path);
}

function isInternalArtifact(file: SkillFile): boolean {
    const lowerCasePath = file.path.toLowerCase();
    if (lowerCasePath === 'skill.yaml') {
        return true;
    }
    if (lowerCasePath.endsWith('.extracts.json')) {
        return true;
    }
    return lowerCasePath.startsWith('.') || lowerCasePath.includes('/.');
}

function renderDiffLineClass(type: DiffLine['type']): string {
    return type === 'add'
        ? 'bg-emerald-50 text-emerald-800 border-l-4 border-emerald-300'
        : type === 'remove'
            ? 'bg-red-50 text-red-800 border-l-4 border-red-300'
            : 'bg-transparent text-slate-700';
}

function renderVisibleText(value: string): string {
    return value
        .replace(/ /g, '·')
        .replace(/\t/g, '→\t')
        .replace(/\r/g, '␍')
        .replace(/\n/g, '␊\n')
        .replace(/\u200b/g, '[ZWSP]')
        .replace(/\ufeff/g, '[BOM]')
        .replace(/[\u202a-\u202e]/g, (char) => `[U+${char.charCodeAt(0).toString(16).toUpperCase()}]`);
}

function parseCommaList(value: string): string[] {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function buildProposalContextSkill(skillId: string, proposal: ProposalDetail): SkillDetail {
    return {
        id: skillId,
        title: proposal.conversion.targetSkillTitle ?? proposal.title,
        description: proposal.description,
        category: proposal.category,
        tags: proposal.tags,
        capabilities: proposal.capabilities,
        useWhen: [],
        doNotUseWhen: [],
        entrypoint: proposal.conversion.targetEntrypoint || proposal.entrypoint || 'SKILL.md',
        skillUuid: proposal.skillId ?? `proposal-context:${proposal.id}`,
        latestPublishedVersion: proposal.conversion.currentLatestVersion,
        versions: [],
    };
}

function buildVersionLifecycleRows(
    version: SkillDetail['versions'][number],
    language: 'en' | 'de',
    t: (key: string, values?: Record<string, string | number>) => string
): Array<{ label: string; value: string }> {
    const rows = [
        {
            label: t('adminSkill.lifecycleCreated'),
            value: `${formatJudgementDate(version.createdAt, language)} · ${version.status}`,
        },
    ];
    if (version.approvedAt) {
        rows.push({
            label: t('adminSkill.lifecycleApproved'),
            value: `${formatJudgementDate(version.approvedAt, language)} · ${version.approvedBy ?? 'n/a'}`,
        });
    }
    if (version.publishedAt) {
        rows.push({
            label: t('adminSkill.lifecyclePublished'),
            value: `${formatJudgementDate(version.publishedAt, language)} · ${version.publishedBy ?? 'n/a'}`,
        });
    }
    if (version.rejectedAt) {
        rows.push({
            label: t('adminSkill.lifecycleRejected'),
            value: `${formatJudgementDate(version.rejectedAt, language)} · ${version.rejectedBy ?? 'n/a'}`,
        });
    }
    if (version.deprecatedAt) {
        rows.push({
            label: t('adminSkill.lifecycleDeprecated'),
            value: `${formatJudgementDate(version.deprecatedAt, language)} · ${version.deprecatedBy ?? 'n/a'}`,
        });
    }
    return rows;
}

function formatLifecycleAction(
    action: string,
    t: (key: string, values?: Record<string, string | number>) => string
): string {
    const key = `adminSkill.lifecycleAction.${action}`;
    const translated = t(key);
    return translated === key ? action : translated;
}

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

function formatJudgementDate(value: string, language: 'en' | 'de'): string {
    void language;
    return formatLocalDateTime(value);
}

function dirname(filePath: string): string | null {
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length <= 1) {
        return null;
    }
    return parts.slice(0, -1).join('/');
}

function basename(filePath: string): string {
    return filePath.split('/').pop() ?? filePath;
}

function joinPath(directoryPath: string, fileName: string): string {
    const trimmedDirectory = directoryPath.trim().replace(/^\/+|\/+$/g, '');
    const trimmedFileName = fileName.trim().replace(/^\/+/g, '');
    if (!trimmedFileName) {
        return trimmedDirectory;
    }
    return trimmedDirectory ? `${trimmedDirectory}/${trimmedFileName}` : trimmedFileName;
}
