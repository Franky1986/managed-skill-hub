import { InvalidStateError, ValidationError } from '../errors';
import { Manifest } from './Manifest';
import { SkillId } from './SkillId';
import { SkillStatus } from './SkillStatus';

export class SkillVersion {
  private constructor(
    readonly skillId: SkillId,
    readonly version: string,
    readonly manifest: Manifest,
    readonly contentHash: string | null,
    readonly createdBy: string,
    readonly createdAt: Date,
    readonly approvedBy: string | null,
    readonly approvedAt: Date | null,
    readonly publishedBy: string | null,
    readonly publishedAt: Date | null,
    readonly rejectedBy: string | null,
    readonly rejectedAt: Date | null,
    readonly rejectionReason: string | null,
    readonly deprecatedBy: string | null,
    readonly deprecatedAt: Date | null,
    readonly deprecationReason: string | null
  ) {}

  static create(props: {
    skillId: SkillId;
    version: string;
    manifest: Manifest;
    contentHash?: string | null;
    createdBy: string;
    createdAt?: Date;
  }): SkillVersion {
    if (!props.version || props.version.trim().length === 0) {
      throw new ValidationError('Version is required');
    }
    return new SkillVersion(
      props.skillId,
      props.version.trim(),
      props.manifest,
      props.contentHash ?? null,
      props.createdBy,
      props.createdAt ?? new Date(),
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    );
  }

  static rehydrate(props: {
    skillId: SkillId;
    version: string;
    manifest: Manifest;
    contentHash?: string | null;
    createdBy: string;
    createdAt: Date;
    approvedBy?: string | null;
    approvedAt?: Date | null;
    publishedBy?: string | null;
    publishedAt?: Date | null;
    rejectedBy?: string | null;
    rejectedAt?: Date | null;
    rejectionReason?: string | null;
    deprecatedBy?: string | null;
    deprecatedAt?: Date | null;
    deprecationReason?: string | null;
  }): SkillVersion {
    if (!props.version || props.version.trim().length === 0) {
      throw new ValidationError('Version is required');
    }
    return new SkillVersion(
      props.skillId,
      props.version.trim(),
      props.manifest,
      props.contentHash ?? null,
      props.createdBy,
      props.createdAt,
      props.approvedBy ?? null,
      props.approvedAt ?? null,
      props.publishedBy ?? null,
      props.publishedAt ?? null,
      props.rejectedBy ?? null,
      props.rejectedAt ?? null,
      props.rejectionReason ?? null,
      props.deprecatedBy ?? null,
      props.deprecatedAt ?? null,
      props.deprecationReason ?? null
    );
  }

  get status(): SkillStatus {
    return this.manifest.status;
  }

  approve(actor: string, at: Date = new Date()): SkillVersion {
    if (this.status !== SkillStatus.IN_REVIEW) {
      throw new InvalidStateError(`Cannot approve from status ${this.status}`);
    }
    return new SkillVersion(
      this.skillId,
      this.version,
      this.manifest.withStatus(SkillStatus.APPROVED),
      this.contentHash,
      this.createdBy,
      this.createdAt,
      actor,
      at,
      this.publishedBy,
      this.publishedAt,
      this.rejectedBy,
      this.rejectedAt,
      this.rejectionReason,
      this.deprecatedBy,
      this.deprecatedAt,
      this.deprecationReason
    );
  }

  publish(actor: string, at: Date = new Date()): SkillVersion {
    if (this.status !== SkillStatus.APPROVED) {
      throw new InvalidStateError(`Cannot publish from status ${this.status}`);
    }
    return new SkillVersion(
      this.skillId,
      this.version,
      this.manifest.withStatus(SkillStatus.PUBLISHED),
      this.contentHash,
      this.createdBy,
      this.createdAt,
      this.approvedBy,
      this.approvedAt,
      actor,
      at,
      this.rejectedBy,
      this.rejectedAt,
      this.rejectionReason,
      this.deprecatedBy,
      this.deprecatedAt,
      this.deprecationReason
    );
  }

  reject(actor: string, reason: string, at: Date = new Date()): SkillVersion {
    const normalizedReason = reason.trim();
    if (normalizedReason.length === 0) {
      throw new ValidationError('Rejection reason is required');
    }
    if (![SkillStatus.DRAFT, SkillStatus.IN_REVIEW, SkillStatus.APPROVED].includes(this.status)) {
      throw new InvalidStateError(`Cannot reject from status ${this.status}`);
    }
    return new SkillVersion(
      this.skillId,
      this.version,
      this.manifest.withStatus(SkillStatus.REJECTED),
      this.contentHash,
      this.createdBy,
      this.createdAt,
      this.approvedBy,
      this.approvedAt,
      this.publishedBy,
      this.publishedAt,
      actor,
      at,
      normalizedReason,
      this.deprecatedBy,
      this.deprecatedAt,
      this.deprecationReason
    );
  }

  deprecate(actor: string, reasonOrAt?: string | Date | null, at?: Date): SkillVersion {
    const parsedAt = reasonOrAt instanceof Date ? reasonOrAt : (at ?? new Date());
    const reason = reasonOrAt instanceof Date ? null : reasonOrAt;
    if (this.status !== SkillStatus.PUBLISHED) {
      throw new InvalidStateError(`Cannot deprecate from status ${this.status}`);
    }
    return new SkillVersion(
      this.skillId,
      this.version,
      this.manifest.withStatus(SkillStatus.DEPRECATED),
      this.contentHash,
      this.createdBy,
      this.createdAt,
      this.approvedBy,
      this.approvedAt,
      this.publishedBy,
      this.publishedAt,
      this.rejectedBy,
      this.rejectedAt,
      this.rejectionReason,
      actor,
      parsedAt,
      reason?.trim() ?? null
    );
  }
}
