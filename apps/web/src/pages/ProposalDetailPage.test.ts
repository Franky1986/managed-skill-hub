import { describe, expect, it } from 'vitest';
import { getProposalDetailViewState } from './ProposalDetailPage';

describe('ProposalDetailPage view state', () => {
    it('shows load errors instead of an endless loading state', () => {
        expect(getProposalDetailViewState(null, 'Proposal not found')).toBe('load-error');
    });

    it('keeps the loading state while no proposal or error exists', () => {
        expect(getProposalDetailViewState(null, null)).toBe('loading');
    });
});
