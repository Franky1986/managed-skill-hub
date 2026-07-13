import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { Manifest } from '../../../domain/skill/Manifest';
import { Skill } from '../../../domain/skill/Skill';
import { SkillDetailDto, SkillSummaryDto, SkillVersionSummaryDto } from '../../dtos/skill.dto';

export interface SkillFileInfo {
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

export interface SearchResult {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  skillUuid: string;
  versionUuid: string;
  contentDigest: string;
  version: string;
  publishedAt: Date;
  score: number | null;
}

export interface SkillSearchQuery {
  q: string;
  mode: 'keyword' | 'fulltext' | 'regex';
  category?: string;
  tags?: string[];
  limit: number;
  offset: number;
}

export interface SkillQueryPort {
  discover(): Promise<DiscoveryResponse>;
  listPublished(category?: string, tags?: string[], limit?: number, offset?: number): Promise<{ items: Skill[]; total: number }>;
  listPublishedSummaries(category?: string, tags?: string[], limit?: number, offset?: number): Promise<{ items: SkillSummaryDto[]; total: number }>;
  search(query: SkillSearchQuery): Promise<{ items: SearchResult[]; total: number }>;
  listCategories(): Promise<string[]>;
  listTags(): Promise<string[]>;
  getSkill(id: string): Promise<Skill | null>;
  getSkillDetail(id: string): Promise<SkillDetailDto | null>;
  getManifest(skillId: string, version?: string): Promise<Manifest | null>;
  listFiles(skillId: string, version?: string): Promise<SkillFileInfo[]>;
  getFile(skillId: string, fileId: string, version?: string): Promise<{ path: string; mimeType: string; content: Buffer } | null>;
  listVersions(skillId: string): Promise<SkillVersionSummaryDto[]>;
  getHistory(skillId: string): Promise<AuditEntry[]>;
  getDeprecationInfo(skillId: string, version?: string): Promise<SkillDeprecationInfoDto | null>;
}

export interface SkillDeprecationInfoDto {
  skillId: string;
  version: string;
  status: string;
  deprecatedBy: string | null;
  deprecatedAt: Date | null;
  reason: string | null;
}

export interface DiscoveryResponse {
  name: string;
  version: string;
  readAuthRequired: boolean;
  entrypoints: string[];
}
