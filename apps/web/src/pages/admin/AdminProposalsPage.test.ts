import { describe, expect, it } from 'vitest';
import { proposalDisplayStatus, renderFilterCount, statusForProposalFilter } from './AdminProposalsPage';

describe('statusForProposalFilter', () => {
    it('keeps in-upload proposals out of the open review filter', () => {
        expect(statusForProposalFilter('open')).toBe('submitted,judged,approved');
        expect(statusForProposalFilter('in_upload')).toBe('in_upload');
        expect(statusForProposalFilter('all')).toBeUndefined();
    });
});

describe('proposalDisplayStatus', () => {
    it('shows no-judge proposals as not judged instead of judged lifecycle status', () => {
        const t = (key: string) => key === 'judgement.notJudged' ? 'not judged' : key;

        expect(proposalDisplayStatus({ status: 'judged', latestJudgementRisk: 'no_judge_available' }, t)).toBe('not judged');
        expect(proposalDisplayStatus({ status: 'judged', latestJudgementRisk: 'low' }, t)).toBe('judged');
    });
});

describe('renderFilterCount', () => {
    const notice = { counts: { in_upload: 3, submitted: 4, judged: 12, converted: 7 } };

    it('shows submitted/judged breakdown for open filter', () => {
        expect(renderFilterCount('open', notice)).toBe(' (4/12)');
    });

    it('falls back to a single number when only one open bucket is non-zero', () => {
        const partial = { counts: { in_upload: 0, submitted: 5, judged: 0, converted: 0 } };
        expect(renderFilterCount('open', partial)).toBe(' (5)');
    });

    it('returns empty when open buckets are empty', () => {
        const empty = { counts: { in_upload: 0, submitted: 0, judged: 0, converted: 0 } };
        expect(renderFilterCount('open', empty)).toBe('');
    });

    it('shows in_upload and converted counts', () => {
        expect(renderFilterCount('in_upload', notice)).toBe(' (3)');
        expect(renderFilterCount('converted', notice)).toBe(' (7)');
    });

    it('returns empty for rejected and all filters', () => {
        expect(renderFilterCount('rejected', notice)).toBe('');
        expect(renderFilterCount('all', notice)).toBe('');
    });
});
