import { SkillVersion } from '../../../domain/skill/SkillVersion';

export interface SearchDocument {
  skillId: string;
  version: string;
  title: string;
  description: string;
  category: string;
  groups: string[];
  capabilities: string[];
  body: string;
  publishedAt: Date;
}

export interface SearchEngineResult {
  skillId: string;
  version: string;
  title: string;
  description: string;
  groups: string[];
  publishedAt: Date;
  score: number | null;
}

export interface RegexSearchEngineResult extends SearchEngineResult {
  matches: string[];
}

export interface SkillSearchPort {
  search(
    query: string,
    mode: 'keyword' | 'fulltext' | 'regex',
    group?: string,
    tags?: string[],
    limit?: number,
    offset?: number
  ): Promise<{ items: SearchEngineResult[]; total: number }>;
  indexVersion(skillVersion: SkillVersion, extractedText: string): Promise<void>;
  removeVersion(skillId: string, version: string): Promise<void>;
  reindexAll(documents: SearchDocument[]): Promise<void>;
}
