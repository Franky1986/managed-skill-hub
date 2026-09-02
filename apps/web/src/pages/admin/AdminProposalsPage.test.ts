import { describe, expect, it } from 'vitest';
import { groupAllProposals, groupVersionedProposals, proposalDisplayStatus, proposalFilterFromSearch, renderFilterCount, sortProposalsByNewestSubmission, statusForProposalFilter } from './AdminProposalsPage';
import { ProposalSummary } from '../../api/proposals';

describe('statusForProposalFilter', () => {
    it('opens the review queue only for an explicit navigation filter', () => {
        expect(proposalFilterFromSearch('?filter=review')).toBe('review');
        expect(proposalFilterFromSearch('')).toBe('in_upload');
        expect(proposalFilterFromSearch('?filter=in_upload')).toBe('in_upload');
    });

    it('keeps the actionable review queue separate from unfinished uploads', () => {
        expect(statusForProposalFilter('review')).toBe('judged,approved');
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
    const notice = { counts: { in_upload: 3, submitted: 4, judged: 12, approved: 2, rejected: 5, converted: 7 } };

    it('shows the review count without exposing the transient submitted bucket', () => {
        expect(renderFilterCount('review', notice)).toBe(' (14)');
    });

    it('does not show the transient submitted bucket as a filter', () => {
        const partial = { counts: { in_upload: 0, submitted: 5, judged: 0, approved: 0, rejected: 0, converted: 0 } };
        expect(renderFilterCount('review', partial)).toBe('');
    });

    it('returns empty when the relevant buckets are empty', () => {
        const empty = { counts: { in_upload: 0, submitted: 0, judged: 0, approved: 0, rejected: 0, converted: 0 } };
        expect(renderFilterCount('review', empty)).toBe('');
    });

    it('shows in_upload and converted counts', () => {
        expect(renderFilterCount('in_upload', notice)).toBe(' (3)');
        expect(renderFilterCount('converted', notice)).toBe(' (7)');
    });

    it('shows a total for all proposals without counting skill versions', () => {
        expect(renderFilterCount('rejected', notice)).toBe('');
        expect(renderFilterCount('all', notice)).toBe(' (33)');
    });

    it('groups all proposals by skill/name and sorts groups and entries by newest submission', () => {
        const proposal = (id: string, title: string, skillId: string | null, submittedAt: string): ProposalSummary => ({
            id, title, skillId, status: 'converted', createdAt: submittedAt, submittedAt, rejectedAt: null, rejectedBy: null,
            latestJudgementRisk: null, latestJudgement: null, labels: [], convertedVersion: null,
        });
        const groups = groupAllProposals([
            proposal('old-a', 'Alpha old name', 'alpha', '2026-01-01T00:00:00.000Z'),
            proposal('beta', 'Beta', 'beta', '2026-02-01T00:00:00.000Z'),
            proposal('new-a', 'Alpha current name', 'alpha', '2026-03-01T00:00:00.000Z'),
        ]);

        expect(groups.map((group) => group.name)).toEqual(['Alpha current name', 'Beta']);
        expect(groups[0]?.proposals.map((item) => item.id)).toEqual(['new-a', 'old-a']);
    });

    it('keeps the converted flat list chronological by newest submission', () => {
        const proposal = (id: string, submittedAt: string): ProposalSummary => ({
            id, title: id, skillId: 'skill', status: 'converted', createdAt: submittedAt, submittedAt,
            rejectedAt: null, rejectedBy: null, latestJudgementRisk: null, latestJudgement: null, labels: [], convertedVersion: null,
        });
        expect(sortProposalsByNewestSubmission([proposal('old', '2026-01-01T00:00:00.000Z'), proposal('new', '2026-02-01T00:00:00.000Z')]).map((item) => item.id)).toEqual(['new', 'old']);
    });

    it('keeps only converted versions in All and collapses older ones behind the current version', () => {
        const proposal = (id: string, version: string, submittedAt: string, status = 'converted'): ProposalSummary => ({
            id, title: 'Skill', skillId: 'skill', status, createdAt: submittedAt, submittedAt, rejectedAt: null, rejectedBy: null,
            latestJudgementRisk: null, latestJudgement: null, labels: [], convertedVersion: version,
            conversion: { mode: 'create_version', targetSkillId: 'skill', targetSkillTitle: 'Skill', targetSkillExists: true, currentLatestVersion: '1.0.0', nextVersion: version, targetEntrypoint: 'SKILL.md' },
        });
        const groups = groupVersionedProposals([
            proposal('v1', '1.0.0', '2026-03-01T00:00:00.000Z'),
            proposal('v2', '1.0.1', '2026-02-01T00:00:00.000Z'),
            proposal('draft', '1.0.2', '2026-01-01T00:00:00.000Z'),
            proposal('upload', '1.0.3', '2026-04-01T00:00:00.000Z', 'in_upload'),
        ]);

        expect(groups).toHaveLength(1);
        expect(groups[0]?.currentProposal.id).toBe('draft');
        expect(groups[0]?.previousProposals.map((item) => item.id)).toEqual(['v2', 'v1']);
    });
});
