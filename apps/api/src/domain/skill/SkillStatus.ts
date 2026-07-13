export enum SkillStatus {
  DRAFT = 'draft',
  IN_REVIEW = 'in_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PUBLISHED = 'published',
  DEPRECATED = 'deprecated',
}

const allowedTransitions: Record<SkillStatus, SkillStatus[]> = {
  [SkillStatus.DRAFT]: [SkillStatus.IN_REVIEW, SkillStatus.REJECTED],
  [SkillStatus.IN_REVIEW]: [SkillStatus.APPROVED, SkillStatus.DRAFT, SkillStatus.REJECTED],
  [SkillStatus.APPROVED]: [SkillStatus.PUBLISHED, SkillStatus.DRAFT, SkillStatus.REJECTED],
  [SkillStatus.REJECTED]: [],
  [SkillStatus.PUBLISHED]: [SkillStatus.DEPRECATED],
  [SkillStatus.DEPRECATED]: [],
};

export function canTransition(from: SkillStatus, to: SkillStatus): boolean {
  return allowedTransitions[from].includes(to);
}
