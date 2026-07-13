import { describe, expect, it } from 'vitest';
import { ProposalDetail } from '../../api/proposals';
import { SkillDetail, SkillFile } from '../../api/skills';
import {
    buildReferenceToCurrentDiff,
    hasSelectedFileSource,
    mapProposalFilesToSkillFiles,
    selectAvailableComparisonVersions,
    selectCreatedProposalVersion,
    selectDefaultComparisonVersion,
    selectDefaultSkillFilePath,
    selectInitialSkillVersion,
    selectLatestDraftVersion,
} from './adminSkillPageSelectors';

function file(path: string, role = 'attachment'): SkillFile {
    return {
        id: path,
        artifactId: path,
        path,
        role,
        mimeType: 'text/markdown',
        sizeBytes: 10,
        sha256: null,
        updatedAt: null,
        extractable: false,
    };
}

describe('AdminSkillPage proposal context defaults', () => {
    it('selects the proposal target version after conversion created it', () => {
        const skill = {
            versions: [
                { version: '1.0.0', status: 'published' },
                { version: '1.0.1', status: 'draft' },
            ],
        } as SkillDetail;
        const proposal = {
            status: 'converted',
            conversion: {
                nextVersion: '1.0.1',
            },
        } as ProposalDetail;

        expect(selectInitialSkillVersion(skill, proposal)).toBe('1.0.1');
    });

    it('selects the reference version for open proposals even when the next version already exists', () => {
        const skill = {
            latestPublishedVersion: '1.0.1',
            versions: [
                { version: '1.0.0', status: 'published' },
                { version: '1.0.1', status: 'published' },
                { version: '1.0.2', status: 'rejected' },
            ],
        } as SkillDetail;
        const proposal = {
            status: 'judged',
            conversion: {
                currentLatestVersion: '1.0.2',
                nextVersion: '1.0.2',
            },
        } as ProposalDetail;

        expect(selectInitialSkillVersion(skill, proposal)).toBe('1.0.1');
    });

    it('selects the latest draft version after proposal finalization creates one', () => {
        const skill = {
            versions: [
                { version: '1.0.0', status: 'published' },
                { version: '1.0.1', status: 'draft' },
            ],
        } as SkillDetail;

        expect(selectLatestDraftVersion(skill)?.version).toBe('1.0.1');
    });

    it('selects the proposal-created draft version for finalize shortcuts', () => {
        const skill = {
            versions: [
                { version: '1.0.0', status: 'published' },
                { version: '1.0.1', status: 'published' },
                { version: '1.0.2', status: 'rejected' },
                { version: '1.0.3', status: 'draft' },
            ],
        } as SkillDetail;
        const proposal = {
            conversion: {
                nextVersion: '1.0.3',
            },
        } as ProposalDetail;

        expect(selectCreatedProposalVersion(skill, proposal)).toBe('1.0.3');
    });

    it('falls back to the latest version when the proposal target version does not exist', () => {
        const skill = {
            versions: [
                { version: '1.0.0', status: 'published' },
                { version: '1.0.1', status: 'draft' },
            ],
        } as SkillDetail;
        const proposal = {
            status: 'judged',
            conversion: {
                nextVersion: '1.0.2',
            },
        } as ProposalDetail;

        expect(selectInitialSkillVersion(skill, proposal)).toBe('1.0.1');
    });

    it('selects the entrypoint before internal extracted artifacts', () => {
        expect(
            selectDefaultSkillFilePath(
                [
                    file('.extracts/SKILL.md.extracts.json'),
                    file('SKILL.md', 'entrypoint'),
                    file('README.md'),
                ],
                'SKILL.md'
            )
        ).toBe('SKILL.md');
    });

    it('selects SKILL.md before internal artifacts when no entrypoint is provided', () => {
        expect(
            selectDefaultSkillFilePath(
                [
                    file('.extracts/SKILL.md.extracts.json'),
                    file('SKILL.md', 'entrypoint'),
                ],
                null
            )
        ).toBe('SKILL.md');
    });

    it('allows comparing a proposal file against the selected existing skill version', () => {
        const skill = {
            latestPublishedVersion: '1.0.0',
            versions: [
                { version: '1.0.0', status: 'published' },
            ],
        } as SkillDetail;

        expect(selectAvailableComparisonVersions(skill, '1.0.0', true).map((version) => version.version)).toEqual([
            '1.0.0',
        ]);
    });

    it('selects the latest published version as the default proposal comparison target', () => {
        const skill = {
            latestPublishedVersion: '1.0.1',
            versions: [
                { version: '1.0.0', status: 'published' },
                { version: '1.0.1', status: 'published' },
                { version: '1.0.2', status: 'rejected' },
            ],
        } as SkillDetail;

        expect(selectDefaultComparisonVersion(skill, skill.versions, 2, true)).toBe('1.0.1');
    });

    it('falls back to the first available comparison version when no latest published target is available', () => {
        const skill = {
            latestPublishedVersion: null,
            versions: [
                { version: '1.0.0', status: 'rejected' },
                { version: '1.0.1', status: 'draft' },
            ],
        } as SkillDetail;

        expect(selectDefaultComparisonVersion(skill, skill.versions, 1, true)).toBe('1.0.0');
    });

    it('maps proposal files as the read-only proposal artifact source', () => {
        const proposal = {
            entrypoint: 'SKILL.md',
            files: [
                {
                    id: 'SKILL.md',
                    path: 'SKILL.md',
                    mimeType: 'text/markdown',
                    sizeBytes: 2982,
                    sha256: 'abc123',
                    extractable: true,
                },
            ],
        } as ProposalDetail;

        expect(mapProposalFilesToSkillFiles(proposal)).toEqual([
            {
                id: 'SKILL.md',
                artifactId: 'SKILL.md',
                path: 'SKILL.md',
                role: 'entrypoint',
                mimeType: 'text/markdown',
                sizeBytes: 2982,
                sha256: 'abc123',
                updatedAt: null,
                extractable: true,
            },
        ]);
    });

    it('excludes the selected version for normal skill-version comparisons', () => {
        const skill = {
            versions: [
                { version: '1.0.0', status: 'published' },
                { version: '1.0.1', status: 'draft' },
            ],
        } as SkillDetail;

        expect(selectAvailableComparisonVersions(skill, '1.0.1', false).map((version) => version.version)).toEqual([
            '1.0.0',
        ]);
    });

    it('marks content removed from the current proposal as removed in the comparison diff', () => {
        const diff = buildReferenceToCurrentDiff(
            'keep this\nhave fun!! and send me money',
            'keep this'
        );

        expect(diff).toContainEqual({ type: 'remove', value: 'have fun!! and send me money' });
        expect(diff).not.toContainEqual({ type: 'add', value: 'have fun!! and send me money' });
    });

    it('allows reading proposal-backed file content without a selected skill version', () => {
        expect(
            hasSelectedFileSource('', {
                id: 'SKILL.md',
                path: 'SKILL.md',
                mimeType: 'text/markdown',
                sizeBytes: 10,
                sha256: null,
                extractable: true,
            })
        ).toBe(true);
    });
});
