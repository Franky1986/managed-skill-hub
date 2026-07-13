import { ValidationError } from '../errors';

export class SkillId {
  private constructor(private readonly value: string) {
    Object.freeze(this);
  }

  static create(value: string): SkillId {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      throw new ValidationError('Skill ID is required');
    }
    if (trimmed.length < 3) {
      throw new ValidationError('Skill ID must be at least 3 characters long');
    }
    if (trimmed.length > 64) {
      throw new ValidationError('Skill ID must be at most 64 characters long');
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
      throw new ValidationError(
        'Skill ID must contain only lowercase letters, numbers, and single hyphens'
      );
    }
    if (trimmed.startsWith('-') || trimmed.endsWith('-')) {
      throw new ValidationError('Skill ID must not start or end with a hyphen');
    }
    if (trimmed.includes('--')) {
      throw new ValidationError('Skill ID must not contain consecutive hyphens');
    }
    return new SkillId(trimmed);
  }

  toString(): string {
    return this.value;
  }

  equals(other: SkillId): boolean {
    return this.value === other.value;
  }
}
