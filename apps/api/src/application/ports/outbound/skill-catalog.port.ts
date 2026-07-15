import { Skill } from '../../../domain/skill/Skill';
import { Proposal } from '../../../domain/proposal/Proposal';
import { ProposalStatus } from '../../../domain/proposal/ProposalStatus';
import {
  Judgement,
  JudgementDimension,
  JudgementOverallRisk,
  JudgementTargetType,
} from '../../../domain/judgement/Judgement';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { ReviewLabel } from '../../usecases/proposal/review-metadata';

export interface CatalogSkillRef {
  skillId: string;
  version: string;
}

export interface CatalogSkillVersionRecord {
  skillId: string;
  version: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  useWhen: string[];
  doNotUseWhen: string[];
  entrypoint: string;
  status: string;
  skillUuid: string;
  versionUuid: string;
  contentDigest: string;
  createdAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  publishedBy: string | null;
  publishedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  deprecatedBy: string | null;
  deprecatedAt: Date | null;
  deprecationReason: string | null;
  updatedAt: Date | null;
  isLatestPublished: boolean;
  isLatestVersion: boolean;
}

export interface CatalogSkillFileRecord {
  skillId: string;
  version: string;
  path: string;
  artifactId: string;
  role: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  updatedAt: Date | null;
  extractable: boolean;
}

export interface CatalogJudgementRecord {
  id: string;
  targetType: JudgementTargetType;
  targetId: string;
  proposalId: string | null;
  skillId: string | null;
  skillVersion: string | null;
  dimensions: Record<string, JudgementDimension>;
  overallRisk: JudgementOverallRisk;
  summary: string;
  skillPurposeSummary: string | null;
  model: string | null;
  createdAt: Date;
}

export interface CatalogAuditEntryRecord {
  id: string;
  skillId: string | null;
  skillVersion: string | null;
  proposalId: string | null;
  action: string;
  actor: string;
  actorPrincipalId: string | null;
  actorDisplayName: string | null;
  actorClientId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CatalogProposalRecord {
  id: string;
  skillId: string | null;
  title: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  entrypoint: string | null;
  status: ProposalStatus;
  submittedBy: string;
  submittedByPrincipalId: string | null;
  submittedViaClientId: string | null;
  createdAt: Date;
  rejectionReason: string | null;
  latestJudgementRisk: JudgementOverallRisk | null;
  labels: ReviewLabel[];
  latestJudgementId: string | null;
  latestJudgedAt: Date | null;
  contentDigest: string | null;
}

export interface CatalogProposalFileRecord {
  proposalId: string;
  id: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
}

export interface SkillCatalogPort {
  upsertSkill(skill: Skill): Promise<void>;
  upsertProposal(proposal: Proposal): Promise<void>;
  findProposalByContentDigest(contentDigest: string, excludeId?: string): Promise<CatalogProposalRecord | null>;
  findPublishedSkillByContentDigest(contentDigest: string): Promise<{ skillId: string; version: string } | null>;
  deleteProposal(proposalId: string): Promise<void>;
  upsertSkillJudgement(skillId: string, version: string, judgement: Judgement): Promise<void>;
  listJudgements(targetType: JudgementTargetType, targetId: string): Promise<CatalogJudgementRecord[]>;
  upsertAuditEntry(entry: AuditEntry): Promise<void>;
  listSkillHistory(skillId: string): Promise<CatalogAuditEntryRecord[]>;
  listProposals(options?: {
    skillId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: CatalogProposalRecord[]; total: number }>;
  getProposal(proposalId: string): Promise<CatalogProposalRecord | null>;
  listProposalFiles(proposalId: string): Promise<CatalogProposalFileRecord[]>;
  listProposalJudgements(proposalId: string): Promise<CatalogJudgementRecord[]>;
  countPendingProposals(): Promise<number>;
  countProposalsByStatus(): Promise<Record<ProposalStatus, number>>;
  rebuild(skills: Skill[], options?: { clearProjections?: boolean }): Promise<void>;
  listCategories(): Promise<string[]>;
  listTags(): Promise<string[]>;
  listLatestSkillVersions(options?: {
    category?: string;
    publishedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: CatalogSkillVersionRecord[]; total: number }>;
  listPublishedSkillRefs(
    category?: string,
    limit?: number,
    offset?: number
  ): Promise<{ items: CatalogSkillRef[]; total: number }>;
  getSkillVersion(skillId: string, version: string): Promise<CatalogSkillVersionRecord | null>;
  getLatestVersion(skillId: string): Promise<CatalogSkillVersionRecord | null>;
  getLatestPublishedVersion(skillId: string): Promise<CatalogSkillVersionRecord | null>;
  listSkillVersions(skillId: string, options?: { publishedOnly?: boolean }): Promise<CatalogSkillVersionRecord[]>;
  listPublishedVersions(skillId: string): Promise<CatalogSkillVersionRecord[]>;
  listVersionFiles(skillId: string, version: string): Promise<CatalogSkillFileRecord[]>;
}
