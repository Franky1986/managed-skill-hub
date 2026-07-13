import { describe, it, expect } from 'vitest';
import { SkillId } from './SkillId';
import { ValidationError } from '../errors';

describe('SkillId', () => {
  it('creates a valid slug-style id', () => {
    const id = SkillId.create('my-first-skill');
    expect(id.toString()).toBe('my-first-skill');
  });

  it('normalizes uppercase letters to lowercase', () => {
    const id = SkillId.create('My-SKILL');
    expect(id.toString()).toBe('my-skill');
  });

  it('normalizes mixed case with hyphens', () => {
    const id = SkillId.create('My-First-Skill');
    expect(id.toString()).toBe('my-first-skill');
  });

  it('trims whitespace', () => {
    const id = SkillId.create('  my-skill  ');
    expect(id.toString()).toBe('my-skill');
  });

  it('rejects an empty id', () => {
    expect(() => SkillId.create('')).toThrow(ValidationError);
    expect(() => SkillId.create('   ')).toThrow(ValidationError);
  });

  it('rejects ids shorter than 3 characters', () => {
    expect(() => SkillId.create('ab')).toThrow(ValidationError);
  });

  it('rejects ids longer than 64 characters', () => {
    expect(() => SkillId.create('a'.repeat(65))).toThrow(ValidationError);
  });

  it('rejects leading hyphens', () => {
    expect(() => SkillId.create('-my-skill')).toThrow(ValidationError);
  });

  it('rejects trailing hyphens', () => {
    expect(() => SkillId.create('my-skill-')).toThrow(ValidationError);
  });

  it('rejects consecutive hyphens', () => {
    expect(() => SkillId.create('my--skill')).toThrow(ValidationError);
  });

  it('rejects special characters', () => {
    expect(() => SkillId.create('my_skill')).toThrow(ValidationError);
    expect(() => SkillId.create('my.skill')).toThrow(ValidationError);
    expect(() => SkillId.create('my skill')).toThrow(ValidationError);
  });

  it('compares equality by value', () => {
    const a = SkillId.create('my-skill');
    const b = SkillId.create('my-skill');
    const c = SkillId.create('other-skill');
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
