import { SkillStatus } from '../../domain/skill/SkillStatus';

export interface SkillSummaryDto {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  skillUuid: string;
  versionUuid: string;
  contentDigest: string;
  version: string;
  status: SkillStatus;
  publishedAt: Date | null;
}

export interface SkillVersionSummaryDto {
  version: string;
  versionUuid: string;
  contentDigest: string;
  status: SkillStatus;
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
}

export interface SkillDetailDto {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  useWhen: string[];
  doNotUseWhen: string[];
  entrypoint: string;
  skillUuid: string;
  latestPublishedVersion: string | null;
  versions: SkillVersionSummaryDto[];
}

export interface SkillFileDto {
  id: string;
  artifactId: string;
  path: string;
  role: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  updatedAt: Date | null;
  extractable: boolean;
}
