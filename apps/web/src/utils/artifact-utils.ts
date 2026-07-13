export interface RenderedArtifactMetadata {
    mimeType: string;
    path: string;
}

export type ArtifactSyntaxLanguage =
    | 'bash'
    | 'css'
    | 'javascript'
    | 'json'
    | 'markdown'
    | 'markup'
    | 'python'
    | 'sql'
    | 'text'
    | 'tsx'
    | 'typescript'
    | 'yaml';

export function isTextLikeArtifact(mimeType: string, filePath: string): boolean {
    const normalizedMimeType = mimeType.toLowerCase();
    const normalizedPath = filePath.toLowerCase();
    return (
        normalizedMimeType.startsWith('text/') ||
        normalizedMimeType === 'application/json' ||
        normalizedMimeType === 'application/ld+json' ||
        normalizedMimeType === 'application/xml' ||
        normalizedMimeType === 'text/xml' ||
        normalizedMimeType === 'application/yaml' ||
        normalizedMimeType === 'application/x-yaml' ||
        normalizedMimeType === 'text/yaml' ||
        normalizedMimeType === 'application/csv' ||
        /\.(md|markdown|txt|ya?ml|json|csv|tsv|html?|css|js|jsx|mjs|cjs|ts|tsx|py|rb|sh|bash|zsh|fish|cmd|bat|ps1|psm1|psd1|sql|ini|cfg|conf)$/i.test(normalizedPath)
    );
}

export function isImageArtifact(mimeType: string, filePath: string): boolean {
    return mimeType.startsWith('image/') || /\.(avif|gif|jpeg|jpg|png|webp|bmp|svg|ico|icon)$/i.test(filePath);
}

export function isVideoArtifact(mimeType: string, filePath: string): boolean {
    return (
        mimeType.startsWith('video/') ||
        /\.(3gp|avi|flv|m4v|mkv|mov|mp4|mpg|mpeg|ogv|webm|wmv)$/i.test(filePath)
    );
}

export function isAudioArtifact(mimeType: string, filePath: string): boolean {
    return (
        mimeType.startsWith('audio/') ||
        /\.(aac|aiff|flac|mp3|m4a|ogg|opus|wav)$/i.test(filePath)
    );
}

export function isPdfArtifact(mimeType: string, filePath: string): boolean {
    return mimeType.includes('pdf') || /\.pdf$/i.test(filePath);
}

export function isPptxArtifact(mimeType: string, filePath: string): boolean {
    return (
        mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        || /\.pptx$/i.test(filePath)
    );
}

export function isInlineMediaArtifact(mimeType: string, filePath: string): boolean {
    return isImageArtifact(mimeType, filePath) || isVideoArtifact(mimeType, filePath) || isAudioArtifact(mimeType, filePath) || isPdfArtifact(mimeType, filePath);
}

export function canProbeArtifact(mimeType: string, filePath: string): boolean {
    return isVideoArtifact(mimeType, filePath) || isAudioArtifact(mimeType, filePath) || /\.(ffprobe|f4v|3gp|avi|flv|m4v|mkv|mov|mp4|mpg|mpeg|ogv|webm|wmv|aac|aiff|flac|mp3|m4a|ogg|opus|wav)$/i.test(filePath);
}

export function isInlinePreviewableArtifact(mimeType: string, filePath: string): boolean {
    return isTextLikeArtifact(mimeType, filePath) || isInlineMediaArtifact(mimeType, filePath) || isPptxArtifact(mimeType, filePath);
}

export function detectArtifactSyntaxLanguage(mimeType: string, filePath: string): ArtifactSyntaxLanguage {
    const normalizedMimeType = mimeType.toLowerCase();
    const normalizedPath = filePath.toLowerCase();

    if (/\.(tsx)$/i.test(normalizedPath)) {
        return 'tsx';
    }
    if (/\.(ts|mts|cts)$/i.test(normalizedPath)) {
        return 'typescript';
    }
    if (/\.(jsx)$/i.test(normalizedPath)) {
        return 'javascript';
    }
    if (/\.(js|mjs|cjs)$/i.test(normalizedPath)) {
        return 'javascript';
    }
    if (/\.(json)$/i.test(normalizedPath) || normalizedMimeType.includes('json')) {
        return 'json';
    }
    if (/\.(ya?ml)$/i.test(normalizedPath) || normalizedMimeType.includes('yaml')) {
        return 'yaml';
    }
    if (/\.(md|markdown)$/i.test(normalizedPath)) {
        return 'markdown';
    }
    if (/\.(html?|xml)$/i.test(normalizedPath) || normalizedMimeType.includes('xml')) {
        return 'markup';
    }
    if (/\.(css)$/i.test(normalizedPath)) {
        return 'css';
    }
    if (/\.(py)$/i.test(normalizedPath)) {
        return 'python';
    }
    if (/\.(sql)$/i.test(normalizedPath)) {
        return 'sql';
    }
    if (/\.(sh|bash|zsh|fish|cmd|bat|ps1|psm1|psd1)$/i.test(normalizedPath)) {
        return 'bash';
    }
    if (normalizedMimeType.startsWith('text/html')) {
        return 'markup';
    }
    if (normalizedMimeType.startsWith('text/css')) {
        return 'css';
    }
    if (normalizedMimeType.startsWith('text/markdown')) {
        return 'markdown';
    }
    if (normalizedMimeType.startsWith('text/')) {
        return 'text';
    }
    return 'text';
}

export function renderVisibleText(value: string): string {
    return value
        .replace(/ /g, '·')
        .replace(/\t/g, '→\t')
        .replace(/\r/g, '␍')
        .replace(/\n/g, '␊\n')
        .replace(/\u200b/g, '[ZWSP]')
        .replace(/\ufeff/g, '[BOM]')
        .replace(/[\u202a-\u202e]/g, (char) => `[U+${char.charCodeAt(0).toString(16).toUpperCase()}]`);
}

export function isArtifactProbeSupported(mimeType: string, filePath: string): boolean {
    return canProbeArtifact(mimeType, filePath);
}
