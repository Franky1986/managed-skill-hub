import { describe, it, expect } from 'vitest';
import { SkillId } from './SkillId';
import { Manifest } from './Manifest';
import { SkillStatus } from './SkillStatus';
import { SkillVersion } from './SkillVersion';
import { ManifestFile } from './ManifestFile';
import { InvalidStateError, ValidationError } from '../errors';

function createManifest(status: SkillStatus = SkillStatus.DRAFT): Manifest {
  return Manifest.create({
    id: 'test-skill',
    title: 'Test Skill',
    description: 'A skill for tests',
    version: '1.0.0',
    status,
    category: 'test',
    entrypoint: 'README.md',
    capabilities: ['demo'],
    files: [ManifestFile.create({ path: 'README.md', role: 'entrypoint', sha256: 'abc123' })],
  });
}

describe('SkillVersion', () => {
  it('creates a draft version', () => {
    const skillId = SkillId.create('test-skill');
    const version = SkillVersion.create({
      skillId,
      version: '1.0.0',
      manifest: createManifest(),
      createdBy: 'actor-a',
    });

    expect(version.version).toBe('1.0.0');
    expect(version.status).toBe(SkillStatus.DRAFT);
    expect(version.createdBy).toBe('actor-a');
    expect(version.approvedBy).toBeNull();
    expect(version.publishedBy).toBeNull();
  });

  it('rejects an empty version string', () => {
    const skillId = SkillId.create('test-skill');
    expect(() =>
      SkillVersion.create({
        skillId,
        version: '   ',
        manifest: createManifest(),
        createdBy: 'actor-a',
      })
    ).toThrow(ValidationError);
  });

  it('transitions in_review -> approved -> published', () => {
    const skillId = SkillId.create('test-skill');
    const inReview = SkillVersion.create({
      skillId,
      version: '1.0.0',
      manifest: createManifest(SkillStatus.IN_REVIEW),
      createdBy: 'actor-a',
    });

    const approved = inReview.approve('reviewer', new Date('2026-01-01'));
    expect(approved.status).toBe(SkillStatus.APPROVED);
    expect(approved.approvedBy).toBe('reviewer');

    const published = approved.publish('publisher', new Date('2026-01-02'));
    expect(published.status).toBe(SkillStatus.PUBLISHED);
    expect(published.publishedBy).toBe('publisher');
  });

  it('cannot approve a draft version directly', () => {
    const skillId = SkillId.create('test-skill');
    const draft = SkillVersion.create({
      skillId,
      version: '1.0.0',
      manifest: createManifest(),
      createdBy: 'actor-a',
    });

    expect(() => draft.approve('reviewer')).toThrow(InvalidStateError);
  });

  it('cannot publish a draft version directly', () => {
    const skillId = SkillId.create('test-skill');
    const draft = SkillVersion.create({
      skillId,
      version: '1.0.0',
      manifest: createManifest(),
      createdBy: 'actor-a',
    });

    expect(() => draft.publish('publisher')).toThrow(InvalidStateError);
  });

  it('cannot deprecate a draft version', () => {
    const skillId = SkillId.create('test-skill');
    const draft = SkillVersion.create({
      skillId,
      version: '1.0.0',
      manifest: createManifest(),
      createdBy: 'actor-a',
    });

    expect(() => draft.deprecate('actor')).toThrow(InvalidStateError);
  });

  it('rejects draft, in-review, and approved versions with a reason', () => {
    const skillId = SkillId.create('test-skill');
    for (const status of [SkillStatus.DRAFT, SkillStatus.IN_REVIEW, SkillStatus.APPROVED]) {
      const version = SkillVersion.create({
        skillId,
        version: '1.0.0',
        manifest: createManifest(status),
        createdBy: 'actor-a',
      });

      const rejected = version.reject('reviewer', 'Missing required evidence', new Date('2026-01-04'));
      expect(rejected.status).toBe(SkillStatus.REJECTED);
      expect(rejected.rejectedBy).toBe('reviewer');
      expect(rejected.rejectionReason).toBe('Missing required evidence');
    }
  });

  it('requires a rejection reason', () => {
    const skillId = SkillId.create('test-skill');
    const draft = SkillVersion.create({
      skillId,
      version: '1.0.0',
      manifest: createManifest(),
      createdBy: 'actor-a',
    });

    expect(() => draft.reject('reviewer', '  ')).toThrow(ValidationError);
  });

  it('deprecates a published version', () => {
    const skillId = SkillId.create('test-skill');
    const published = SkillVersion.create({
      skillId,
      version: '1.0.0',
      manifest: createManifest(SkillStatus.PUBLISHED),
      createdBy: 'actor-a',
    });

    const deprecated = published.deprecate('actor-b', new Date('2026-01-03'));
    expect(deprecated.status).toBe(SkillStatus.DEPRECATED);
    expect(deprecated.deprecatedBy).toBe('actor-b');
  });

  it('cannot reject a published version', () => {
    const skillId = SkillId.create('test-skill');
    const published = SkillVersion.create({
      skillId,
      version: '1.0.0',
      manifest: createManifest(SkillStatus.PUBLISHED),
      createdBy: 'actor-a',
    });

    expect(() => published.reject('reviewer', 'Not acceptable')).toThrow(InvalidStateError);
  });
});
