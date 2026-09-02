import { describe, expect, it } from 'vitest';
import type { SkillSummary } from '../../api/skills';
import { countReviewSkills, filterReviewSkills } from './AdminReviewQueuePage';

const skill = (id: string, status: string): SkillSummary => ({
    id,
    title: id,
    description: '',
    category: 'testing',
    tags: [],
    skillUuid: id,
    versionUuid: `${id}-version`,
    contentDigest: '',
    version: '1.0.0',
    publishedAt: null,
    status,
});

describe('AdminReviewQueuePage', () => {
    const skills = [skill('draft', 'draft'), skill('review', 'in_review'), skill('approved', 'approved'), skill('rejected', 'rejected'), skill('published', 'published')];

    it('keeps drafts with active work after the separate drafts page is removed', () => {
        expect(filterReviewSkills(skills, 'active').map((item) => item.id)).toEqual(['draft', 'review', 'approved']);
        expect(filterReviewSkills(skills, 'all').map((item) => item.id)).toEqual(['draft', 'review', 'approved', 'rejected']);
    });

    it('derives every tab count from the complete refreshed skill list', () => {
        expect(countReviewSkills(skills)).toEqual({ active: 3, in_review: 1, approved: 1, rejected: 1, all: 4 });
    });
});
