import { ProposalDetail } from '../../api/proposals';
import { SkillDetail, SkillFile } from '../../api/skills';

export interface DiffLine {
    type: 'equal' | 'add' | 'remove';
    value: string;
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

export function selectInitialSkillVersion(skill: SkillDetail, proposal: ProposalDetail | null): string {
    if (!proposal) {
        return skill.versions[skill.versions.length - 1]?.version || '';
    }

    const proposalTargetVersion = proposal.conversion.nextVersion;
    if (
        proposal.status === 'converted'
        && proposalTargetVersion
        && skill.versions.some((version) => version.version === proposalTargetVersion)
    ) {
        return proposalTargetVersion;
    }

    const referenceVersion = skill.latestPublishedVersion ?? proposal.conversion.currentLatestVersion;
    if (referenceVersion && skill.versions.some((version) => version.version === referenceVersion)) {
        return referenceVersion;
    }

    return skill.versions[skill.versions.length - 1]?.version || '';
}

export function selectLatestDraftVersion(skill: SkillDetail): SkillDetail['versions'][number] | null {
    const draftVersions = skill.versions.filter((version) => version.status === 'draft');
    return draftVersions[draftVersions.length - 1] ?? null;
}

export function selectCreatedProposalVersion(skill: SkillDetail, proposal: ProposalDetail): string | null {
    const proposalTargetVersion = proposal.conversion.nextVersion;
    if (proposalTargetVersion) {
        const matchingTarget = skill.versions.find((version) =>
            version.version === proposalTargetVersion && version.status === 'draft'
        );
        if (matchingTarget) {
            return matchingTarget.version;
        }
    }

    return selectLatestDraftVersion(skill)?.version ?? null;
}

export function selectDefaultSkillFilePath(files: SkillFile[], entrypoint: string | null): string | null {
    if (entrypoint) {
        const entrypointFile = files.find((file) => file.path === entrypoint && !isInternalArtifact(file));
        if (entrypointFile) {
            return entrypointFile.path;
        }
    }

    const skillMd = files.find((file) => file.path === 'SKILL.md' && !isInternalArtifact(file));
    if (skillMd) {
        return skillMd.path;
    }

    const firstExternal = files.find((file) => !isInternalArtifact(file));
    return firstExternal?.path ?? files[0]?.path ?? null;
}

export function mapProposalFilesToSkillFiles(proposal: ProposalDetail): SkillFile[] {
    return proposal.files.map((file) => ({
        id: file.id,
        artifactId: file.id,
        path: file.path,
        role: proposal.entrypoint === file.path ? 'entrypoint' : 'attachment',
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        updatedAt: null,
        extractable: file.extractable,
    }));
}

export function selectAvailableComparisonVersions(
    skill: SkillDetail,
    selectedVersion: string,
    hasProposalFileSource: boolean
): SkillDetail['versions'] {
    if (hasProposalFileSource) {
        return skill.versions;
    }

    return skill.versions.filter((version) => version.version !== selectedVersion);
}

export function hasSelectedFileSource(
    selectedVersion: string,
    selectedProposalFile: ProposalDetail['files'][number] | null
): boolean {
    return Boolean(selectedProposalFile) || selectedVersion.trim().length > 0;
}

export function selectDefaultComparisonVersion(
    skill: SkillDetail,
    availableComparisonVersions: SkillDetail['versions'],
    selectedVersionIndex: number,
    hasProposalFileSource: boolean
): string {
    if (availableComparisonVersions.length === 0) {
        return '';
    }

    if (hasProposalFileSource && skill.latestPublishedVersion) {
        const latestPublished = availableComparisonVersions.find((version) => version.version === skill.latestPublishedVersion);
        if (latestPublished) {
            return latestPublished.version;
        }
    }

    if (!hasProposalFileSource && selectedVersionIndex > 0) {
        return skill.versions[selectedVersionIndex - 1]?.version ?? '';
    }

    return availableComparisonVersions[0]?.version ?? '';
}

export function buildReferenceToCurrentDiff(referenceContent: string, currentContent: string): DiffLine[] {
    return computeDiffLines(referenceContent, currentContent);
}

function normalizeLines(text: string): string[] {
    const normalized = text.replace(/\r\n/g, '\n');
    if (normalized.length === 0) {
        return [];
    }
    return normalized.split('\n');
}

function computeDiffLines(oldText: string, newText: string): DiffLine[] {
    const oldLines = normalizeLines(oldText);
    const newLines = normalizeLines(newText);
    const oldLength = oldLines.length;
    const newLength = newLines.length;

    if (oldLength === 0 && newLength === 0) {
        return [];
    }

    const matrix = Array.from({ length: oldLength + 1 }, () =>
        Array.from({ length: newLength + 1 }, () => 0)
    );

    for (let i = 1; i <= oldLength; i++) {
        matrix[i][0] = i;
    }
    for (let j = 1; j <= newLength; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= oldLength; i++) {
        for (let j = 1; j <= newLength; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                const deleteCost = matrix[i - 1][j] + 1;
                const insertCost = matrix[i][j - 1] + 1;
                const replaceCost = matrix[i - 1][j - 1] + 1;
                matrix[i][j] = Math.min(deleteCost, insertCost, replaceCost);
            }
        }
    }

    const patch: DiffLine[] = [];
    let i = oldLength;
    let j = newLength;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            patch.unshift({ type: 'equal', value: oldLines[i - 1] });
            i -= 1;
            j -= 1;
        } else if (i > 0 && j > 0 && matrix[i][j] === matrix[i - 1][j - 1] + 1) {
            patch.unshift({ type: 'remove', value: oldLines[i - 1] });
            patch.unshift({ type: 'add', value: newLines[j - 1] });
            i -= 1;
            j -= 1;
        } else if (i > 0 && (j === 0 || matrix[i][j] === matrix[i - 1][j] + 1)) {
            patch.unshift({ type: 'remove', value: oldLines[i - 1] });
            i -= 1;
        } else if (j > 0 && (i === 0 || matrix[i][j] === matrix[i][j - 1] + 1)) {
            patch.unshift({ type: 'add', value: newLines[j - 1] });
            j -= 1;
        } else {
            break;
        }
    }

    return patch;
}
