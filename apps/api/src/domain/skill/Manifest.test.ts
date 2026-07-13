import { describe, it, expect } from 'vitest';
import { Manifest } from './Manifest';
import { SkillStatus } from './SkillStatus';
import { ValidationError } from '../errors';

describe('Manifest', () => {
  it('creates a manifest with required fields', () => {
    const manifest = Manifest.create({
      id: 'my-skill',
      title: 'My Skill',
      version: '1.0.0',
      status: SkillStatus.DRAFT,
      category: 'automation',
      entrypoint: 'README.md',
    });

    expect(manifest.id).toBe('my-skill');
    expect(manifest.title).toBe('My Skill');
    expect(manifest.status).toBe(SkillStatus.DRAFT);
    expect(manifest.category).toBe('automation');
    expect(manifest.tags).toEqual([]);
    expect(manifest.capabilities).toEqual([]);
  });

  it('normalizes category, tags and capabilities to lowercase', () => {
    const manifest = Manifest.create({
      id: 'my-skill',
      title: 'My Skill',
      version: '1.0.0',
      status: SkillStatus.DRAFT,
      category: 'Frontend',
      entrypoint: 'README.md',
      tags: ['AI'],
      capabilities: ['CodeReview'],
    });

    expect(manifest.category).toEqual('frontend');
    expect(manifest.tags).toEqual(['ai']);
    expect(manifest.capabilities).toEqual(['codereview']);
  });

  it('filters empty strings from arrays', () => {
    const manifest = Manifest.create({
      id: 'my-skill',
      title: 'My Skill',
      version: '1.0.0',
      status: SkillStatus.DRAFT,
      category: 'frontend',
      entrypoint: 'README.md',
      tags: ['', 'ai'],
      capabilities: [''],
    });

    expect(manifest.category).toEqual('frontend');
    expect(manifest.tags).toEqual(['ai']);
    expect(manifest.capabilities).toEqual([]);
  });

  it('rejects a missing id', () => {
    expect(() =>
      Manifest.create({
        id: '',
        title: 'My Skill',
        version: '1.0.0',
        status: SkillStatus.DRAFT,
        category: 'automation',
        entrypoint: 'README.md',
      })
    ).toThrow(ValidationError);
  });

  it('rejects a missing title', () => {
    expect(() =>
      Manifest.create({
        id: 'my-skill',
        title: '  ',
        version: '1.0.0',
        status: SkillStatus.DRAFT,
        category: 'automation',
        entrypoint: 'README.md',
      })
    ).toThrow(ValidationError);
  });

  it('rejects a missing category', () => {
    expect(() =>
      Manifest.create({
        id: 'my-skill',
        title: 'My Skill',
        version: '1.0.0',
        status: SkillStatus.DRAFT,
        category: '   ',
        entrypoint: 'README.md',
      })
    ).toThrow(ValidationError);
  });

  it('rejects a missing entrypoint', () => {
    expect(() =>
      Manifest.create({
        id: 'my-skill',
        title: 'My Skill',
        version: '1.0.0',
        status: SkillStatus.DRAFT,
        category: 'automation',
        entrypoint: '',
      })
    ).toThrow(ValidationError);
  });

  it('creates a copy with a changed status', () => {
    const draft = Manifest.create({
      id: 'my-skill',
      title: 'My Skill',
      version: '1.0.0',
      status: SkillStatus.DRAFT,
      category: 'automation',
      entrypoint: 'README.md',
    });

    const published = draft.withStatus(SkillStatus.PUBLISHED);
    expect(published.status).toBe(SkillStatus.PUBLISHED);
    expect(draft.status).toBe(SkillStatus.DRAFT);
  });
});
