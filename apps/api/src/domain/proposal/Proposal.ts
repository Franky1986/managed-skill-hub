import { createHash } from 'crypto';
import { InvalidStateError, ValidationError } from '../errors';
import { Judgement } from '../judgement/Judgement';
import { ProposalStatus } from './ProposalStatus';

export class ProposalFile {
  private constructor(
    readonly id: string,
    readonly path: string,
    readonly mimeType: string,
    readonly sizeBytes: number,
    readonly sha256: string | null
  ) {}

  static create(props: {
    id: string;
    path: string;
    mimeType: string;
    sizeBytes: number;
    sha256?: string | null;
  }): ProposalFile {
    return new ProposalFile(
      props.id,
      props.path,
      props.mimeType,
      props.sizeBytes,
      props.sha256 ?? null
    );
  }
}

export type ProposalArtifactClassification =
  | 'external_service_or_capability'
  | 'local_portable_artifact'
  | 'ambiguous_dependency';

export type ProposalArtifactDecisionKind =
  | 'include_portably'
  | 'keep_external_prerequisite'
  | 'remove_or_rewrite_dependency';

export type ProposalArtifactDecisionConfirmation = 'explicit_user_choice' | 'policy_default';

export interface ProposalArtifactDecision {
  reference: string;
  classification: ProposalArtifactClassification;
  decision: ProposalArtifactDecisionKind;
  confirmation: ProposalArtifactDecisionConfirmation;
  source: string | null;
  target: string | null;
  rationale: string;
}

export class Proposal {
  private constructor(
    readonly id: string,
    readonly skillId: string | null,
    readonly title: string,
    readonly description: string,
    readonly category: string,
    readonly tags: string[],
    readonly capabilities: string[],
    readonly entrypoint: string | null,
    readonly files: ProposalFile[],
    readonly judgements: Judgement[],
    readonly status: ProposalStatus,
    readonly submittedBy: string,
    readonly createdAt: Date,
    readonly rejectionReason: string | null,
    readonly contentDigest: string | null,
    readonly submittedByPrincipalId: string | null,
    readonly submittedViaClientId: string | null,
    readonly artifactDecisions: ProposalArtifactDecision[],
    readonly idempotencyKeyHash: string | null
  ) {}

  static create(props: {
    id?: string;
    skillId?: string | null;
    title: string;
    description: string;
    category: string;
    tags?: string[];
    capabilities?: string[];
    entrypoint?: string | null;
    submittedBy: string;
    submittedByPrincipalId?: string | null;
    submittedViaClientId?: string | null;
    artifactDecisions?: ProposalArtifactDecision[];
    idempotencyKeyHash?: string | null;
    createdAt?: Date;
  }): Proposal {
    if (!props.title || props.title.trim().length === 0) {
      throw new ValidationError('Proposal title is required');
    }
    if (!props.description || props.description.trim().length === 0) {
      throw new ValidationError('Proposal description is required');
    }
    if (!props.category || props.category.trim().length === 0) {
      throw new ValidationError('Proposal category is required');
    }
    return new Proposal(
      props.id ?? generateProposalId(),
      props.skillId ?? null,
      props.title.trim(),
      props.description.trim(),
      props.category.trim().toLowerCase(),
      props.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean) ?? [],
      props.capabilities?.map((c) => c.trim().toLowerCase()).filter(Boolean) ?? [],
      props.entrypoint?.trim() ?? null,
      [],
      [],
      ProposalStatus.IN_UPLOAD,
      props.submittedBy,
      props.createdAt ?? new Date(),
      null,
      null,
      props.submittedByPrincipalId ?? null,
      props.submittedViaClientId ?? null,
      normalizeArtifactDecisions(props.artifactDecisions ?? []),
      props.idempotencyKeyHash ?? null
    );
  }

  static rehydrate(props: {
    id: string;
    skillId?: string | null;
    title: string;
    description: string;
    category: string;
    tags?: string[];
    capabilities?: string[];
    entrypoint?: string | null;
    files?: ProposalFile[];
    judgements?: Judgement[];
    status: ProposalStatus;
    submittedBy: string;
    createdAt: Date;
    rejectionReason?: string | null;
    contentDigest?: string | null;
    submittedByPrincipalId?: string | null;
    submittedViaClientId?: string | null;
    artifactDecisions?: ProposalArtifactDecision[];
    idempotencyKeyHash?: string | null;
  }): Proposal {
    if (!props.title || props.title.trim().length === 0) {
      throw new ValidationError('Proposal title is required');
    }
    if (!props.description || props.description.trim().length === 0) {
      throw new ValidationError('Proposal description is required');
    }
    if (!props.category || props.category.trim().length === 0) {
      throw new ValidationError('Proposal category is required');
    }

    return new Proposal(
      props.id,
      props.skillId ?? null,
      props.title.trim(),
      props.description.trim(),
      props.category.trim().toLowerCase(),
      props.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean) ?? [],
      props.capabilities?.map((c) => c.trim().toLowerCase()).filter(Boolean) ?? [],
      props.entrypoint?.trim() ?? null,
      props.files ?? [],
      props.judgements ?? [],
      props.status,
      props.submittedBy,
      props.createdAt,
      props.rejectionReason?.trim() ?? null,
      props.contentDigest ?? null,
      props.submittedByPrincipalId ?? null,
      props.submittedViaClientId ?? null,
      normalizeArtifactDecisions(props.artifactDecisions ?? []),
      props.idempotencyKeyHash ?? null
    );
  }

  addFile(file: ProposalFile): Proposal {
    if (this.status !== ProposalStatus.IN_UPLOAD) {
      throw new InvalidStateError(`Cannot attach files to proposal in status ${this.status}`);
    }
    const nextFiles = [
      ...this.files.filter((existing) => existing.path !== file.path),
      file,
    ];
    const digest = computeProposalContentDigest({
      skillId: this.skillId,
      title: this.title,
      description: this.description,
      category: this.category,
      tags: this.tags,
      capabilities: this.capabilities,
      entrypoint: this.entrypoint,
      files: nextFiles,
    });
    return new Proposal(
      this.id,
      this.skillId,
      this.title,
      this.description,
      this.category,
      this.tags,
      this.capabilities,
      this.entrypoint,
      nextFiles,
      this.judgements,
      this.status,
      this.submittedBy,
      this.createdAt,
      this.rejectionReason,
      digest,
      this.submittedByPrincipalId,
      this.submittedViaClientId,
      this.artifactDecisions,
      this.idempotencyKeyHash
    );
  }

  updateMetadata(proposed: {
    title?: string;
    description?: string;
    category?: string;
    tags?: string[];
    capabilities?: string[];
    entrypoint?: string | null;
    artifactDecisions?: ProposalArtifactDecision[];
  }): Proposal {
    if (this.status === ProposalStatus.REJECTED || this.status === ProposalStatus.CONVERTED) {
      throw new InvalidStateError(`Cannot update metadata for proposal in status ${this.status}`);
    }

    const nextTitle = proposed.title?.trim() ?? this.title;
    const nextDescription = proposed.description?.trim() ?? this.description;
    const nextCategory = proposed.category?.trim() ?? this.category;
    const nextTags = proposed.tags === undefined
      ? this.tags
      : proposed.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
    const nextCapabilities = proposed.capabilities === undefined
      ? this.capabilities
      : proposed.capabilities.map((capability) => capability.trim().toLowerCase()).filter(Boolean);
    const nextEntrypoint = proposed.entrypoint === undefined
      ? this.entrypoint
      : (proposed.entrypoint?.trim() ?? null);

    if (!nextTitle) {
      throw new ValidationError('Proposal title is required');
    }
    if (!nextDescription) {
      throw new ValidationError('Proposal description is required');
    }
    if (!nextCategory) {
      throw new ValidationError('Proposal category is required');
    }

    return new Proposal(
      this.id,
      this.skillId,
      nextTitle,
      nextDescription,
      nextCategory,
      nextTags,
      nextCapabilities,
      nextEntrypoint,
      this.files,
      this.judgements,
      this.status,
      this.submittedBy,
      this.createdAt,
      this.rejectionReason,
      computeProposalContentDigest({
        skillId: this.skillId,
        title: nextTitle,
        description: nextDescription,
        category: nextCategory,
        tags: nextTags,
        capabilities: nextCapabilities,
        entrypoint: nextEntrypoint,
        files: this.files,
      }),
      this.submittedByPrincipalId,
      this.submittedViaClientId,
      proposed.artifactDecisions === undefined
        ? this.artifactDecisions
        : normalizeArtifactDecisions(proposed.artifactDecisions),
      this.idempotencyKeyHash
    );
  }

  addJudgement(judgement: Judgement): Proposal {
    const nextStatus = [ProposalStatus.APPROVED, ProposalStatus.REJECTED, ProposalStatus.CONVERTED].includes(this.status)
      ? this.status
      : ProposalStatus.JUDGED;
    return new Proposal(
      this.id,
      this.skillId,
      this.title,
      this.description,
      this.category,
      this.tags,
      this.capabilities,
      this.entrypoint,
      this.files,
      [...this.judgements, judgement],
      nextStatus,
      this.submittedBy,
      this.createdAt,
      this.rejectionReason,
      this.contentDigest,
      this.submittedByPrincipalId,
      this.submittedViaClientId,
      this.artifactDecisions,
      this.idempotencyKeyHash
    );
  }

  finalizeUpload(): Proposal {
    if (this.status !== ProposalStatus.IN_UPLOAD) {
      throw new InvalidStateError(`Cannot finalize proposal upload in status ${this.status}`);
    }
    return new Proposal(
      this.id,
      this.skillId,
      this.title,
      this.description,
      this.category,
      this.tags,
      this.capabilities,
      this.entrypoint,
      this.files,
      this.judgements,
      ProposalStatus.SUBMITTED,
      this.submittedBy,
      this.createdAt,
      this.rejectionReason,
      this.contentDigest,
      this.submittedByPrincipalId,
      this.submittedViaClientId,
      this.artifactDecisions,
      this.idempotencyKeyHash
    );
  }

  approve(): Proposal {
    if (this.status !== ProposalStatus.SUBMITTED && this.status !== ProposalStatus.JUDGED) {
      throw new InvalidStateError(`Cannot approve proposal in status ${this.status}`);
    }
    return new Proposal(
      this.id,
      this.skillId,
      this.title,
      this.description,
      this.category,
      this.tags,
      this.capabilities,
      this.entrypoint,
      this.files,
      this.judgements,
      ProposalStatus.APPROVED,
      this.submittedBy,
      this.createdAt,
      null,
      this.contentDigest,
      this.submittedByPrincipalId,
      this.submittedViaClientId,
      this.artifactDecisions,
      this.idempotencyKeyHash
    );
  }

  reject(reason: string | null): Proposal {
    if (this.status !== ProposalStatus.SUBMITTED && this.status !== ProposalStatus.JUDGED) {
      throw new InvalidStateError(`Cannot reject proposal in status ${this.status}`);
    }
    return new Proposal(
      this.id,
      this.skillId,
      this.title,
      this.description,
      this.category,
      this.tags,
      this.capabilities,
      this.entrypoint,
      this.files,
      this.judgements,
      ProposalStatus.REJECTED,
      this.submittedBy,
      this.createdAt,
      reason?.trim() ?? null,
      this.contentDigest,
      this.submittedByPrincipalId,
      this.submittedViaClientId,
      this.artifactDecisions,
      this.idempotencyKeyHash
    );
  }

  convert(): Proposal {
    if (this.status !== ProposalStatus.APPROVED) {
      throw new InvalidStateError(`Cannot convert proposal in status ${this.status}`);
    }
    return new Proposal(
      this.id,
      this.skillId,
      this.title,
      this.description,
      this.category,
      this.tags,
      this.capabilities,
      this.entrypoint,
      this.files,
      this.judgements,
      ProposalStatus.CONVERTED,
      this.submittedBy,
      this.createdAt,
      this.rejectionReason,
      this.contentDigest,
      this.submittedByPrincipalId,
      this.submittedViaClientId,
      this.artifactDecisions,
      this.idempotencyKeyHash
    );
  }

  get groups(): string[] {
    return [this.category, ...this.tags];
  }
}

function normalizeArtifactDecisions(decisions: ProposalArtifactDecision[]): ProposalArtifactDecision[] {
  const normalized = decisions.map((item, index) => {
    const reference = item.reference?.trim();
    const rationale = item.rationale?.trim();
    const source = item.source?.trim() || null;
    const target = item.target?.trim().replace(/\\/g, '/') || null;
    if (!reference) {
      throw new ValidationError(`Artifact decision ${index} requires a reference`);
    }
    if (!rationale) {
      throw new ValidationError(`Artifact decision ${reference} requires a rationale`);
    }
    if (!['external_service_or_capability', 'local_portable_artifact', 'ambiguous_dependency'].includes(item.classification)) {
      throw new ValidationError(`Artifact decision ${reference} has an invalid classification`);
    }
    if (!['include_portably', 'keep_external_prerequisite', 'remove_or_rewrite_dependency'].includes(item.decision)) {
      throw new ValidationError(`Artifact decision ${reference} has an invalid decision`);
    }
    if (!['explicit_user_choice', 'policy_default'].includes(item.confirmation)) {
      throw new ValidationError(`Artifact decision ${reference} has an invalid confirmation`);
    }
    if (item.classification !== 'external_service_or_capability' && item.confirmation !== 'explicit_user_choice') {
      throw new ValidationError(`Artifact decision ${reference} requires explicit_user_choice confirmation`);
    }
    if (item.classification === 'external_service_or_capability' && item.decision !== 'keep_external_prerequisite') {
      throw new ValidationError(`External service decision ${reference} must use keep_external_prerequisite`);
    }
    if (item.decision === 'include_portably' && !target) {
      throw new ValidationError(`Artifact decision ${reference} requires a package-relative target`);
    }
    if (target && (target.startsWith('/') || target.startsWith('../') || target.includes('/../'))) {
      throw new ValidationError(`Artifact decision ${reference} target must be package-relative`);
    }
    return {
      reference,
      classification: item.classification,
      decision: item.decision,
      confirmation: item.confirmation,
      source,
      target,
      rationale,
    };
  });
  const references = new Set<string>();
  for (const decision of normalized) {
    const key = decision.reference.replace(/\\/g, '/').toLowerCase();
    if (references.has(key)) {
      throw new ValidationError(`Duplicate artifact decision for ${decision.reference}`);
    }
    references.add(key);
  }
  return normalized;
}

function generateProposalId(): string {
  return `prop-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export interface ProposalContentDigestInput {
  skillId: string | null;
  title: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  entrypoint: string | null;
  files: ProposalFile[];
}

export function computeProposalContentDigest(input: ProposalContentDigestInput): string {
  const hash = createHash('sha256');
  hash.update(input.skillId ?? '');
  hash.update('|');
  hash.update(input.title);
  hash.update('|');
  hash.update(input.description);
  hash.update('|');
  hash.update(input.category);
  hash.update('|');
  hash.update(input.tags.join(','));
  hash.update('|');
  hash.update(input.capabilities.join(','));
  hash.update('|');
  hash.update(input.entrypoint ?? '');
  hash.update('|');
  const fileParts = input.files
    .map((file) => `${file.path}:${file.sha256 ?? ''}`)
    .sort();
  hash.update(fileParts.join(','));
  return hash.digest('hex');
}
