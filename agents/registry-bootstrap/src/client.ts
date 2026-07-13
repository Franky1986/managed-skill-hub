import {
  CategoryListResponse,
  DiscoveryResponse,
  SkillFileListResponse,
  SkillFileInfo,
  SkillListResponse,
  SkillResponse,
  SkillVersionListResponse,
} from './types.js';

export interface RegistryClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

export class RegistryClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: RegistryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async discover(): Promise<DiscoveryResponse> {
    return this.getJson<DiscoveryResponse>('/discover');
  }

  async listCategories(): Promise<CategoryListResponse> {
    return this.getJson<CategoryListResponse>('/categories');
  }

  async listSkills(category?: string, limit = 100, offset = 0): Promise<SkillListResponse> {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return this.getJson<SkillListResponse>(`/skills?${params.toString()}`);
  }

  async searchSkills(query: string, mode: 'keyword' | 'fulltext' | 'regex' = 'keyword'): Promise<SkillListResponse> {
    const params = new URLSearchParams({ q: query, mode });
    return this.getJson<SkillListResponse>(`/skills/search?${params.toString()}`);
  }

  async getSkill(skillId: string): Promise<SkillResponse> {
    return this.getJson<SkillResponse>(`/skills/${encodeURIComponent(skillId)}`);
  }

  async listSkillVersions(skillId: string): Promise<SkillVersionListResponse> {
    return this.getJson<SkillVersionListResponse>(
      `/skills/${encodeURIComponent(skillId)}/versions`
    );
  }

  async listSkillFiles(skillId: string, version?: string): Promise<SkillFileListResponse> {
    const params = new URLSearchParams();
    if (version) params.set('version', version);
    const query = params.toString();
    return this.getJson<SkillFileListResponse>(
      `/skills/${encodeURIComponent(skillId)}/files${query ? `?${query}` : ''}`
    );
  }

  async downloadFile(skillId: string, fileId: string, version?: string): Promise<Uint8Array> {
    const params = new URLSearchParams();
    if (version) params.set('version', version);
    const query = params.toString();
    const url = `${this.baseUrl}/skills/${encodeURIComponent(skillId)}/files/${encodeURIComponent(
      fileId
    )}${query ? `?${query}` : ''}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} downloading ${url}`);
      }
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} on ${path}: ${text.slice(0, 200)}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function fileIdFromInfo(info: SkillFileInfo): string {
  // The public API exposes both a stable artifactId and a path-based id.
  // Prefer the path-based id for downloads because it is deterministic and human-readable.
  return encodeURIComponent(info.path);
}
