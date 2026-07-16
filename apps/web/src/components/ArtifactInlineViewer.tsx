import { useEffect } from 'react';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import { useLanguage } from '../i18n';
import type { ExtractedSkillFileContent, SkillFile, ArtifactProbeResponse } from '../api/skills';
import {
    canProbeArtifact,
    detectArtifactSyntaxLanguage,
    isAudioArtifact,
    isImageArtifact,
    isInlineMediaArtifact,
    isPdfArtifact,
    isPptxArtifact,
    isTextLikeArtifact,
    isVideoArtifact,
    renderVisibleText,
} from '../utils/artifact-utils';

SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('markup', markup);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('yaml', yaml);

interface ArtifactInlineViewerProps {
    file: SkillFile;
    artifactId?: string;
    fileUrl: string;
    textContent?: string | null;
    textLoading?: boolean;
    textError?: string | null;
    showInvisible?: boolean;
    onShowInvisibleChange?: (next: boolean) => void;
    extractedContent?: ExtractedSkillFileContent | null;
    extractedLoading?: boolean;
    extractedError?: string | null;
    onLoadExtracted?: (filePath: string) => void;
    extractedPanelOpen?: boolean;
    onExtractedPanelToggle?: (isOpen: boolean) => void;
    probeResponse?: ArtifactProbeResponse | null;
    probeLoading?: boolean;
    probeError?: string | null;
    onRunProbe?: (filePath: string) => void | Promise<void>;
    probePanelOpen?: boolean;
    onProbePanelToggle?: (isOpen: boolean) => void;
    className?: string;
}

export function ArtifactInlineViewer(props: ArtifactInlineViewerProps) {
    const {
        file,
        artifactId,
        fileUrl,
        textContent,
        textLoading,
        textError,
        showInvisible,
        onShowInvisibleChange,
        extractedContent,
        extractedLoading,
        extractedError,
        onLoadExtracted,
        extractedPanelOpen,
        probeResponse,
        probeLoading,
        probeError,
        onRunProbe,
        className = '',
        onExtractedPanelToggle,
        onProbePanelToggle,
        probePanelOpen,
    } = props;
    const { t } = useLanguage();
    const textLike = isTextLikeArtifact(file.mimeType, file.path);
    const canPreviewMedia = isInlineMediaArtifact(file.mimeType, file.path);
    const isPptx = isPptxArtifact(file.mimeType, file.path);
    const mediaType = getMediaElementType(file.mimeType, file.path);
    const supportsProbe = canProbeArtifact(file.mimeType, file.path);
    const renderText = showInvisible ? renderVisibleText(textContent ?? '') : textContent;
    const resourceKey = artifactId ?? file.path;

    useEffect(() => {
        if (isPptx && onLoadExtracted && !extractedContent && !extractedLoading && !extractedError) {
            onLoadExtracted(resourceKey);
        }
    }, [isPptx, onLoadExtracted, extractedContent, extractedLoading, extractedError, resourceKey]);

    const handleExtractedToggle = (isOpen: boolean) => {
        onExtractedPanelToggle?.(isOpen);
        if (isOpen && onLoadExtracted && !extractedContent && !extractedLoading && !extractedError) {
            onLoadExtracted(resourceKey);
        }
    };

    const handleProbeToggle = (isOpen: boolean) => {
        onProbePanelToggle?.(isOpen);
        if (isOpen && onRunProbe && !probeResponse && !probeLoading && !probeError) {
            void onRunProbe(resourceKey);
        }
    };

    return (
        <div className={`space-y-4 ${className}`}>
            <div className="space-y-3">
                {textLike && (
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={Boolean(showInvisible)}
                            onChange={(event) => onShowInvisibleChange?.(event.target.checked)}
                        />
                        {t('artifactViewer.showInvisible')}
                    </label>
                )}

                {textLike ? (
                    <RenderTextContent
                        file={file}
                        textLoading={textLoading}
                        textError={textError}
                        renderText={renderText}
                        showInvisible={showInvisible}
                    />
                ) : isPptx ? (
                    <RenderPptxContent
                        file={file}
                        extractedContent={extractedContent}
                        extractedLoading={extractedLoading}
                        extractedError={extractedError}
                    />
                ) : canPreviewMedia ? (
                    <RenderMediaContent
                        fileUrl={fileUrl}
                        file={file}
                        mediaType={mediaType}
                    />
                ) : (
                    <p className="rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-600">
                        {t('artifactViewer.noInlinePreview')}
                    </p>
                )}
            </div>

            <details
                open={extractedPanelOpen}
                onToggle={(event) => handleExtractedToggle((event.currentTarget as HTMLDetailsElement).open)}
                className="rounded border border-gray-200"
            >
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                    {t('artifactViewer.extractedContent')}
                </summary>
                <div className="space-y-3 border-t px-4 py-3">
                    {extractedLoading && (
                        <p className="text-sm text-gray-500">{t('artifactViewer.loading')}</p>
                    )}
                    {extractedError && <p className="text-sm text-red-600">{extractedError}</p>}
                    {extractedContent ? (
                        <>
                            <p className="text-xs text-gray-500">
                                {t('artifactViewer.extractedVia')} <code>{extractedContent.extractedBy}</code>
                            </p>
                            <pre className="overflow-x-auto rounded bg-gray-100 p-4 text-sm text-gray-800">
                                {renderVisibleText(extractedContent.text)}
                            </pre>
                        </>
                    ) : (
                        !extractedLoading && !extractedError && (
                            <p className="text-sm text-gray-500">
                                {t('artifactViewer.extractedNotLoaded')}
                            </p>
                        )
                    )}
                </div>
            </details>

            {supportsProbe && (
                <details
                    open={probePanelOpen}
                    onToggle={(event) => handleProbeToggle((event.currentTarget as HTMLDetailsElement).open)}
                    className="rounded border border-gray-200"
                >
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                        {t('artifactViewer.ffprobe')}
                    </summary>
                    <div className="space-y-3 border-t px-4 py-3">
                        {probeLoading && (
                            <p className="text-sm text-gray-500">
                                {t('artifactViewer.runningProbe')}
                            </p>
                        )}
                        {probeError && <p className="text-sm text-red-600">{probeError}</p>}
                        {probeResponse ? (
                            <>
                                <div className="space-y-2 text-sm text-gray-800">
                                    <p>
                                        {t('artifactViewer.probeTool')}: <code>{probeResponse.tool}</code>
                                    </p>
                                    <p>
                                        {t('artifactViewer.probeBy')}: <code>{probeResponse.probedBy}</code>
                                    </p>
                                </div>
                                <div>
                                    <h4 className="text-xs font-semibold uppercase text-gray-600">{t('artifactViewer.probeSummary')}</h4>
                                    <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-4 text-xs text-gray-800">
                                        {JSON.stringify(probeResponse.summary, null, 2)}
                                    </pre>
                                </div>
                                <details className="rounded border border-gray-200">
                                    <summary className="cursor-pointer px-4 py-3 text-xs font-medium">
                                        {t('artifactViewer.probeParsed')}
                                    </summary>
                                    <pre className="overflow-x-auto rounded bg-gray-100 p-4 text-xs text-gray-800">
                                        {JSON.stringify(probeResponse.parsed, null, 2)}
                                    </pre>
                                </details>
                                <details className="rounded border border-gray-200">
                                    <summary className="cursor-pointer px-4 py-3 text-xs font-medium">
                                        {t('artifactViewer.probeRawOutput')}
                                    </summary>
                                    <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-gray-100 p-4 text-xs text-gray-800">
                                        {probeResponse.rawOutput}
                                    </pre>
                                </details>
                            </>
                        ) : (
                            !probeLoading && !probeError && (
                                <p className="text-sm text-gray-500">
                                    {t('artifactViewer.probeNotRun')}
                                </p>
                            )
                        )}
                        {onRunProbe && !probeLoading && (
                            <button
                                type="button"
                                onClick={() => void onRunProbe(resourceKey)}
                                className="rounded border px-3 py-1.5 text-sm"
                            >
                                {t('artifactViewer.runProbe')}
                            </button>
                        )}
                    </div>
                </details>
            )}
            {onRunProbe === undefined && supportsProbe && (
                <p className="text-xs text-gray-500">
                    {t('artifactViewer.probeUnavailable')}
                </p>
            )}
        </div>
    );
}

function RenderTextContent({
    file,
    textLoading,
    textError,
    renderText,
    showInvisible,
}: {
    file: SkillFile;
    textLoading?: boolean;
    textError?: string | null;
    renderText?: string | null;
    showInvisible?: boolean;
}) {
    const { t } = useLanguage();

    if (textLoading) {
        return <p className="text-sm text-gray-500">{t('artifactViewer.loading')}</p>;
    }
    if (textError) {
        return <p className="text-sm text-red-600">{textError}</p>;
    }
    if (showInvisible) {
        return (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-4 text-sm text-slate-100">
                {renderText ?? ''}
            </pre>
        );
    }

    const language = detectArtifactSyntaxLanguage(file.mimeType, file.path);
    return (
        <SyntaxHighlighter
            language={language === 'text' ? undefined : language}
            style={oneDark}
            customStyle={{
                margin: 0,
                borderRadius: '0.5rem',
                padding: '1rem',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                overflowX: 'auto',
                background: '#020617',
            }}
            codeTagProps={{
                style: {
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
                },
            }}
            wrapLongLines
            PreTag="div"
        >
            {renderText ?? ''}
        </SyntaxHighlighter>
    );
}

function RenderMediaContent({
    fileUrl,
    file,
    mediaType,
}: {
    fileUrl: string;
    file: SkillFile;
    mediaType: 'image' | 'video' | 'audio' | 'pdf' | 'other';
}) {
    const { t } = useLanguage();

    if (mediaType === 'image') {
        return (
            <img
                src={fileUrl}
                alt={file.path}
                className="max-h-[60vh] max-w-full rounded border border-slate-300"
            />
        );
    }
    if (mediaType === 'video') {
        return (
            <video
                controls
                src={fileUrl}
                className="max-h-[60vh] max-w-full rounded border border-slate-300"
            >
                {t('artifactViewer.videoNotSupported')}
            </video>
        );
    }
    if (mediaType === 'audio') {
        return (
            <audio controls src={fileUrl} className="w-full">
                {t('artifactViewer.audioNotSupported')}
            </audio>
        );
    }

    if (mediaType === 'pdf') {
        return (
            <iframe
                src={fileUrl}
                title={file.path}
                className="h-[70vh] w-full rounded border border-slate-300"
            />
        );
    }

    return (
        <p className="rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-600">
            {t('artifactViewer.noInlinePreview')}
        </p>
    );
}

function RenderPptxContent({
    file,
    extractedContent,
    extractedLoading,
    extractedError,
}: {
    file: SkillFile;
    extractedContent?: ExtractedSkillFileContent | null;
    extractedLoading?: boolean;
    extractedError?: string | null;
}) {
    const { t } = useLanguage();

    if (extractedLoading) {
        return <p className="text-sm text-gray-500">{t('artifactViewer.loading')}</p>;
    }
    if (extractedError) {
        return <p className="text-sm text-red-600">{extractedError}</p>;
    }
    if (!extractedContent) {
        return (
            <p className="rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-600">
                {t('artifactViewer.extractedNotLoaded')}
            </p>
        );
    }

    const slides = parsePptxSlides(extractedContent.text);
    return (
        <div className="space-y-3">
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-900">{file.path}</p>
                <p className="mt-1 text-xs text-slate-600">
                    {t('artifactViewer.extractedVia')} <code>{extractedContent.extractedBy}</code>
                </p>
            </div>
            {slides.length > 0 ? (
                <div className="grid gap-3">
                    {slides.map((slide) => (
                        <section key={slide.number} className="rounded border border-slate-300 bg-white p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h4 className="text-sm font-semibold text-slate-900">{slide.title}</h4>
                            </div>
                            <div className="space-y-2 text-sm text-slate-700">
                                {slide.lines.map((line, index) => (
                                    <p key={`${slide.number}-${index}`} className="whitespace-pre-wrap break-words">
                                        {line}
                                    </p>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            ) : (
                <pre className="overflow-x-auto rounded bg-slate-950 p-4 text-sm text-slate-100 whitespace-pre-wrap break-words">
                    {extractedContent.text}
                </pre>
            )}
        </div>
    );
}

function parsePptxSlides(text: string): Array<{ number: number; title: string; lines: string[] }> {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
        return [];
    }

    const matches = [...normalized.matchAll(/(?:^|\n\n)Slide (\d+)\n([\s\S]*?)(?=\n\nSlide \d+\n|$)/g)];
    if (matches.length === 0) {
        return parseMarkdownSeparatedSlides(normalized);
    }

    return matches.map((match) => {
        const number = Number.parseInt(match[1] ?? '0', 10);
        const rawBody = (match[2] ?? '').trim();
        const lines = rawBody.split('\n').map((line) => line.trim()).filter(Boolean);
        const title = lines[0] ? `Slide ${number}: ${lines[0]}` : `Slide ${number}`;
        return {
            number,
            title,
            lines,
        };
    });
}

function parseMarkdownSeparatedSlides(text: string): Array<{ number: number; title: string; lines: string[] }> {
    const sections = text
        .split(/\n-{3,}\n/g)
        .map((section) => section.replace(/```text\s*/gi, '').replace(/```/g, '').trim())
        .filter(Boolean);

    return sections
        .map((section, index) => {
            const lines = section.split('\n').map((line) => line.trim()).filter(Boolean);
            if (lines.length === 0) {
                return null;
            }
            const titleLine = lines.find((line) => /^#{1,6}\s+/.test(line)) ?? lines[0];
            return {
                number: index + 1,
                title: `Slide ${index + 1}: ${titleLine.replace(/^#{1,6}\s+/, '')}`,
                lines,
            };
        })
        .filter((slide): slide is { number: number; title: string; lines: string[] } => slide !== null);
}

function getMediaElementType(mimeType: string, filePath: string): 'image' | 'video' | 'audio' | 'pdf' | 'other' {
    if (isImageArtifact(mimeType, filePath)) {
        return 'image';
    }
    if (isVideoArtifact(mimeType, filePath)) {
        return 'video';
    }
    if (isAudioArtifact(mimeType, filePath)) {
        return 'audio';
    }
    if (isPdfArtifact(mimeType, filePath)) {
        return 'pdf';
    }
    return 'other';
}
