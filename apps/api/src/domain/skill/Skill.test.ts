import { describe, it, expect } from 'vitest';
import { Skill } from './Skill';
import { SkillId } from './SkillId';
import { Manifest } from './Manifest';
import { SkillStatus } from './SkillStatus';
import { SkillVersion } from './SkillVersion';
import { ManifestFile } from './ManifestFile';
import { ConflictError, InvalidStateError, NotFoundError } from '../errors';

function manifestFor(status: SkillStatus): Manifest {
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

describe('Skill', () => {
  it('creates a skill with an id and owner', () => {
    const id = SkillId.create('my-skill');
    const skill = Skill.create({ id, createdBy: 'frank' });

    expect(skill.id.toString()).toBe('my-skill');
    expect(skill.createdBy).toBe('frank');
    expect(skill.getAllVersions()).toHaveLength(0);
    expect(skill.getLatestPublishedVersion()).toBeNull();
  });

  it('adds a version', () => {
    const id = SkillId.create('my-skill');
    const skill = Skill.create({ id, createdBy: 'frank' });
    const version = SkillVersion.create({
      skillId: id,
      version: '1.0.0',
      manifest: manifestFor(SkillStatus.DRAFT),
      createdBy: 'frank',
    });

    skill.addVersion(version);
    expect(skill.getAllVersions()).toHaveLength(1);
  });

  it('rejects a version belonging to another skill', () => {
    const id = SkillId.create('my-skill');
    const otherId = SkillId.create('other-skill');
    const skill = Skill.create({ id, createdBy: 'frank' });
    const version = SkillVersion.create({
      skillId: otherId,
      version: '1.0.0',
      manifest: manifestFor(SkillStatus.DRAFT),
      createdBy: 'frank',
    });

    expect(() => skill.addVersion(version)).toThrow(ConflictError);
  });

  it('rejects duplicate versions', () => {
    const id = SkillId.create('my-skill');
    const skill = Skill.create({ id, createdBy: 'frank' });
    const v1 = SkillVersion.create({
      skillId: id,
      version: '1.0.0',
      manifest: manifestFor(SkillStatus.DRAFT),
      createdBy: 'frank',
    });
    const v2 = SkillVersion.create({
      skillId: id,
      version: '1.0.0',
      manifest: manifestFor(SkillStatus.DRAFT),
      createdBy: 'frank',
    });

    skill.addVersion(v1);
    expect(() => skill.addVersion(v2)).toThrow(ConflictError);
  });

  it('throws when requesting a missing version', () => {
    const id = SkillId.create('my-skill');
    const skill = Skill.create({ id, createdBy: 'frank' });

    expect(() => skill.getVersion('1.0.0')).toThrow(NotFoundError);
  });

  it('runs the full lifecycle and sets latest published', () => {
    const id = SkillId.create('my-skill');
    const skill = Skill.create({ id, createdBy: 'frank' });
    const draft = SkillVersion.create({
      skillId: id,
      version: '1.0.0',
      manifest: manifestFor(SkillStatus.DRAFT),
      createdBy: 'frank',
    });

    skill.addVersion(draft);

    const submitResult = skill.submitForReview('1.0.0', 'frank');
    expect(submitResult.entry.action).toBe('submit_for_review');
    expect(skill.getVersion('1.0.0').status).toBe(SkillStatus.IN_REVIEW);

    const approveResult = skill.approveVersion('1.0.0', 'reviewer');
    expect(approveResult.entry.action).toBe('approve');
    expect(skill.getVersion('1.0.0').status).toBe(SkillStatus.APPROVED);

    const publishResult = skill.publishVersion('1.0.0', 'publisher');
    expect(publishResult.entry.action).toBe('publish');
    expect(skill.getVersion('1.0.0').status).toBe(SkillStatus.PUBLISHED);
    expect(skill.getLatestPublishedVersion()?.version).toBe('1.0.0');
  });

  it('cannot publish a version that is not approved', () => {
    const id = SkillId.create('my-skill');
    const skill = Skill.create({ id, createdBy: 'frank' });
    const draft = SkillVersion.create({
      skillId: id,
      version: '1.0.0',
      manifest: manifestFor(SkillStatus.DRAFT),
      createdBy: 'frank',
    });

    skill.addVersion(draft);
    expect(() => skill.publishVersion('1.0.0', 'publisher')).toThrow(InvalidStateError);
  });
});
