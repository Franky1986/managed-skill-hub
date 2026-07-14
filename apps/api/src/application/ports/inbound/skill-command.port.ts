import { Skill } from '../../../domain/skill/Skill';

export interface CreateSkillDraft {
  id: string;
  title: string;
  description: string;
  category: string;
  tags?: string[];
  capabilities?: string[];
  entrypoint: string;
  files?: { path: string; role: string; content: Buffer; mimeType: string }[];
}

export interface UpdateSkillDraft {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  capabilities?: string[];
}

export interface UploadSkillFileDraft {
  path: string;
  role?: string;
  content: Buffer;
  mimeType: string;
}

export interface MoveSkillFileDraft {
  path: string;
}

export interface PublishSkillOptions {
  judgementOverrideAllowed?: boolean;
  judgementOverrideReason?: string;
}

export interface SkillCommandPort {
  createSkill(draft: CreateSkillDraft, actor: string): Promise<Skill>;
  updateSkill(id: string, patch: UpdateSkillDraft, actor: string): Promise<Skill>;
  uploadFile(id: string, version: string, file: UploadSkillFileDraft, actor: string): Promise<Skill>;
  moveFile(id: string, version: string, filePath: string, patch: MoveSkillFileDraft, actor: string): Promise<Skill>;
  deleteFile(id: string, version: string, filePath: string, actor: string): Promise<Skill>;
  submitForReview(id: string, version: string, actor: string): Promise<Skill>;
  approve(id: string, version: string, actor: string): Promise<Skill>;
  publish(id: string, version: string, actor: string, options?: PublishSkillOptions): Promise<Skill>;
  reject(id: string, version: string, actor: string, reason: string): Promise<Skill>;
  deprecate(id: string, version: string, actor: string, reason?: string | null): Promise<Skill>;
}
