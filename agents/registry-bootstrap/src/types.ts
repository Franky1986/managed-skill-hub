export interface DiscoveryResponse {
  name: string;
  version: string;
  readAuthRequired: boolean;
  entrypoints: string[];
}

export interface CategoryListResponse {
  items: string[];
}

export interface SkillSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  skillUuid: string;
  versionUuid: string;
  contentDigest: string;
  version: string;
  status: string;
  publishedAt: string | null;
}

export interface SkillListResponse {
  items: SkillSummary[];
  total: number;
}

export interface SkillVersionSummary {
  version: string;
  versionUuid: string;
  contentDigest: string;
  status: string;
  createdAt: string;
  approvedBy: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
}

export interface SkillVersionListResponse {
  items: SkillVersionSummary[];
}

export interface SkillResponse {
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
  versions: SkillVersionSummary[];
}

export interface SkillFileInfo {
  id: string;
  artifactId: string;
  path: string;
  role: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  updatedAt: string | null;
  extractable: boolean;
}

export interface SkillFileListResponse {
  items: SkillFileInfo[];
}

export interface SyncedSkill {
  skillUuid: string;
  versionUuid: string;
  contentDigest: string;
  version: string;
  title: string;
  category: string;
  entrypoint: string;
  pulledAt: string;
  files: Record<string, SyncedFile>;
}

export interface SyncedFile {
  artifactId: string;
  path: string;
  sha256: string | null;
  sizeBytes: number;
  mimeType: string;
  updatedAt: string | null;
}

export interface SyncState {
  registryUrl: string;
  lastSyncedAt: string;
  skills: Record<string, SyncedSkill>;
}
