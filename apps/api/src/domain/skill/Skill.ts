import { ConflictError, InvalidStateError, NotFoundError } from '../errors';
import { AuditEntry } from '../audit/AuditEntry';
import { SkillId } from './SkillId';
import { SkillStatus } from './SkillStatus';
import { SkillVersion } from './SkillVersion';

export class Skill {
  private constructor(
    readonly id: SkillId,
    private versions: SkillVersion[],
    private latestPublishedVersion: string | null,
    readonly createdBy: string,
    readonly createdAt: Date
  ) {}

  static create(props: {
    id: SkillId;
    createdBy: string;
    createdAt?: Date;
  }): Skill {
    return new Skill(props.id, [], null, props.createdBy, props.createdAt ?? new Date());
  }

  static rehydrate(props: {
    id: SkillId;
    versions: SkillVersion[];
    latestPublishedVersion?: string | null;
    createdBy: string;
    createdAt: Date;
  }): Skill {
    return new Skill(
      props.id,
      [...props.versions],
      props.latestPublishedVersion ?? null,
      props.createdBy,
      props.createdAt
    );
  }

  addVersion(version: SkillVersion): Skill {
    if (!this.id.equals(version.skillId)) {
      throw new ConflictError('Version does not belong to this skill');
    }
    const exists = this.versions.some((v) => v.version === version.version);
    if (exists) {
      throw new ConflictError(`Version ${version.version} already exists`);
    }
    this.versions = [...this.versions, version];
    return this;
  }

  getVersion(version: string): SkillVersion {
    const v = this.versions.find((v) => v.version === version);
    if (!v) {
      throw new NotFoundError(`Version ${version} not found`);
    }
    return v;
  }

  getAllVersions(): SkillVersion[] {
    return [...this.versions];
  }

  getPublishedVersions(): SkillVersion[] {
    return this.versions.filter((v) => v.status === SkillStatus.PUBLISHED);
  }

  setLatestPublished(version: string): Skill {
    const v = this.getVersion(version);
    if (v.status !== SkillStatus.PUBLISHED) {
      throw new InvalidStateError(`Version ${version} is not published`);
    }
    this.latestPublishedVersion = version;
    return this;
  }

  getLatestPublishedVersion(): SkillVersion | null {
    if (!this.latestPublishedVersion) {
      return null;
    }
    return this.getVersion(this.latestPublishedVersion);
  }

  submitForReview(version: string, actor: string, at: Date = new Date()): { skill: Skill; entry: AuditEntry } {
    const v = this.getVersion(version);
    if (v.status !== SkillStatus.DRAFT) {
      throw new InvalidStateError(`Cannot submit version ${version} for review from status ${v.status}`);
    }
    const updated = SkillVersion.create({
      skillId: this.id,
      version: v.version,
      manifest: v.manifest.withStatus(SkillStatus.IN_REVIEW),
      contentHash: v.contentHash,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
    });
    this.versions = this.versions.map((existing) =>
      existing.version === version ? updated : existing
    );
    const entry = AuditEntry.create({
      skillId: this.id.toString(),
      skillVersion: version,
      action: 'submit_for_review',
      actor,
      before: { status: SkillStatus.DRAFT },
      after: { status: SkillStatus.IN_REVIEW },
      createdAt: at,
    });
    return { skill: this, entry };
  }

  approveVersion(version: string, actor: string, at: Date = new Date()): { skill: Skill; entry: AuditEntry } {
    const v = this.getVersion(version);
    const updated = v.approve(actor, at);
    this.versions = this.versions.map((existing) =>
      existing.version === version ? updated : existing
    );
    const entry = AuditEntry.create({
      skillId: this.id.toString(),
      skillVersion: version,
      action: 'approve',
      actor,
      before: { status: SkillStatus.IN_REVIEW },
      after: { status: SkillStatus.APPROVED, approvedBy: actor },
      createdAt: at,
    });
    return { skill: this, entry };
  }

  publishVersion(version: string, actor: string, at: Date = new Date()): { skill: Skill; entry: AuditEntry } {
    const v = this.getVersion(version);
    const previousPublishedVersion = this.latestPublishedVersion;
    const updated = v.publish(actor, at);
    this.versions = this.versions.map((existing) =>
      existing.version === version ? updated : existing
    );
    this.setLatestPublished(version);
    const entry = AuditEntry.create({
      skillId: this.id.toString(),
      skillVersion: version,
      action: 'publish',
      actor,
      before: { status: SkillStatus.APPROVED },
      after: {
        status: SkillStatus.PUBLISHED,
        publishedBy: actor,
        previousPublishedVersion,
        newPublishedVersion: version,
      },
      createdAt: at,
    });
    return { skill: this, entry };
  }

  rejectVersion(version: string, actor: string, reason: string, at: Date = new Date()): { skill: Skill; entry: AuditEntry } {
    const v = this.getVersion(version);
    const previousStatus = v.status;
    const updated = v.reject(actor, reason, at);
    this.versions = this.versions.map((existing) =>
      existing.version === version ? updated : existing
    );
    const entry = AuditEntry.create({
      skillId: this.id.toString(),
      skillVersion: version,
      action: 'reject',
      actor,
      before: { status: previousStatus },
      after: { status: SkillStatus.REJECTED, rejectedBy: actor, reason: updated.rejectionReason },
      createdAt: at,
    });
    return { skill: this, entry };
  }

  deprecateVersion(version: string, actor: string, reason?: string | null, at: Date = new Date()): { skill: Skill; entry: AuditEntry } {
    const v = this.getVersion(version);
    const updated = v.deprecate(actor, reason, at);
    this.versions = this.versions.map((existing) =>
      existing.version === version ? updated : existing
    );
    if (this.latestPublishedVersion === version) {
      const remaining = this.getPublishedVersions();
      this.latestPublishedVersion = remaining.length > 0 ? remaining[remaining.length - 1].version : null;
    }
    const entry = AuditEntry.create({
      skillId: this.id.toString(),
      skillVersion: version,
      action: 'deprecate',
      actor,
      before: { status: SkillStatus.PUBLISHED },
      after: { status: SkillStatus.DEPRECATED, deprecatedBy: actor },
      createdAt: at,
    });
    return { skill: this, entry };
  }
}
