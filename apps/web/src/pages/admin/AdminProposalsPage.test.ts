import { describe, expect, it } from 'vitest';
import { proposalDisplayStatus, statusForProposalFilter } from './AdminProposalsPage';

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
