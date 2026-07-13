import { afterEach, describe, expect, it } from 'vitest';
import { StorageError } from '../../../../domain/errors';
import { MysqlSkillSearch } from './mysql.search';

type SearchTableRow = {
  skill_id: string;
  version: string;
  title: string;
  description: string;
  groups_json: string;
  capabilities: string;
  body: string;
  category: string;
  published_at: string;
  score?: number;
};

class FakeMysqlClient {
  private documents = new Map<string, SearchTableRow>();
  private tags = new Map<string, Set<string>>();
  public executeCalls: Array<{ sql: string; params: unknown[] }> = [];
  public queryCalls: Array<{ sql: string; params: unknown[] }> = [];

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.queryCalls.push({ sql, params });

    if (sql.startsWith('CREATE TABLE')) {
      return [] as T[];
    }

    if (sql.includes('skill_search_documents')) {
      const rows = this.filterRows(sql, params);

      if (sql.includes('SELECT COUNT(*) AS total') || sql.includes('SELECT COUNT(*) AS c')) {
        return [{ total: rows.length }] as T[];
      }
      return rows as T[];
    }

    if (sql.includes('SELECT * FROM skill_search_documents d')) {
      return this.filterRows(sql, params) as T[];
    }

    return [] as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.executeCalls.push({ sql, params });
    const normalizedSql = normalize(sql);
    if (process.env.MYSQL_FAKE_DEBUG === '1') {
      if (normalizedSql.startsWith('insert into skill_search_documents')) {
        console.log('insert doc', params);
      }
      if (normalizedSql.startsWith('insert into skill_search_document_tags')) {
        console.log('insert tag', params);
      }
      if (normalizedSql.startsWith('delete from skill_search_document_tags')) {
        console.log('delete tags', params);
      }
      if (normalizedSql.includes('select skill_id')) {
        console.log('query', normalizedSql, params);
      }
      if (normalizedSql.includes('select count(*)')) {
        console.log('count', normalizedSql, params);
      }
    }

    if (normalizedSql.startsWith('create table')) {
      return;
    }
    if (normalizedSql.startsWith('delete from skill_search_document_tags') || normalizedSql.startsWith('delete from skill_search_documents')) {
      this.documents.clear();
      this.tags.clear();
      return;
    }

    if (normalizedSql.startsWith('insert into skill_search_documents')) {
      const [skillId, version, title, description, category, groups, capabilities, body, publishedAt] = params;
      this.documents.set(this.key(skillId, version), {
        skill_id: String(skillId),
        version: String(version),
        title: String(title),
        description: String(description),
        category: String(category),
        groups_json: String(groups),
        capabilities: String(capabilities),
        body: String(body),
        published_at: String(publishedAt),
      });
      if (!this.tags.has(this.key(skillId, version))) {
        this.tags.set(this.key(skillId, version), new Set());
      }
      return;
    }

    if (normalizedSql.startsWith('insert into skill_search_document_tags')) {
      const [skillId, version, tag] = params;
      const key = this.key(skillId, version);
      const current = this.tags.get(key) ?? new Set();
      current.add(String(tag));
      this.tags.set(key, current);
    }
  }

  async withTransaction<T>(handler: (connection: {
    execute: (sql: string, params?: unknown[]) => Promise<void>;
    query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  }) => Promise<T>): Promise<T> {
    return handler({
      execute: async (sql, params) => {
        await this.execute(sql, params);
      },
      query: async (sql, params) => {
        return this.query(sql, params);
      },
    });
  }

  private filterRows(sql: string, params: unknown[]): SearchTableRow[] {
    const { category, tags, searchIndex } = this.parseFilters(sql, params);
    const query = this.getMatchQueryFromParams(params, searchIndex);
    const normalized = normalize(sql);

    const rows = [...this.documents.values()].filter((row) => {
      if (category && row.category !== category) {
        return false;
      }
      if (!tags.every((tag) => (this.tags.get(this.key(row.skill_id, row.version)) ?? new Set()).has(tag))) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = `${row.title} ${row.description} ${row.groups_json} ${row.capabilities} ${row.body}`.toLowerCase();
      return query.split(/\s+/).every((term) => haystack.includes(term));
    });

    if (process.env.MYSQL_FAKE_DEBUG === '1' && (normalized.includes('select skill_id') || normalized.includes('select d.skill_id'))) {
      console.log('filterRows', {
        normalizedSql: normalized,
        params,
        category,
        tags,
        query,
        documentCount: [...this.documents.values()].length,
        matchingRowCount: rows.length,
        rows: rows.map((row) => ({
          skillId: row.skill_id,
          version: row.version,
          category: row.category,
          tags: [...(this.tags.get(this.key(row.skill_id, row.version)) ?? new Set())],
        })),
      });
    }

    const hasLimit = sql.includes('LIMIT');
    const hasMatch = sql.includes('MATCH');
    const limit = hasLimit ? this.extractLimit(sql, rows.length) : rows.length;
    const offset = hasLimit ? this.extractOffset(sql) : 0;
    const scoreColumnIndex = hasMatch ? searchIndex : -1;

    return rows
      .map((row) => ({
        ...row,
        score: hasMatch ? this.computeMatchScore(row, this.getMatchQueryFromParams(params, scoreColumnIndex)) : undefined,
      }))
      .sort((left, right) => (Number(right.score) - Number(left.score)))
      .slice(offset, offset + limit);
  }

  private parseFilters(sql: string, params: unknown[]) {
    const hasMatch = sql.includes('MATCH');
    const hasLimit = sql.includes('LIMIT');
    const filterParamCount = hasMatch ? Math.max(0, params.length - 1) : params.length;
    const filterParams = params.slice(0, filterParamCount);
    const searchIndex = hasMatch ? filterParamCount : -1;

    if (process.env.MYSQL_FAKE_DEBUG === '1') {
      console.log('debug', { hasMatch, hasLimit, params, filterParams, filterParamCount, searchIndex, sql: sql.trim().slice(0, 240) });
    }

    const tagCount = (sql.match(/tag = \?/g) ?? []).length;
    let cursor = 0;
    const hasCategoryFilter = sql.includes('d.category = ?');
    const category = hasCategoryFilter ? String(filterParams[cursor++] ?? '') : undefined;
    const tags = hasCategoryFilter ? (filterParams.slice(cursor, cursor + tagCount) as string[]) : filterParams.slice(0, tagCount) as string[];
    return {
      category,
      tags: tags.map((tag) => String(tag)),
      searchIndex,
    };
  }

  private extractLimit(sql: string, fallback: number): number {
    const match = normalize(sql).match(/limit\s+(\d+)\s+offset\s+\d+/);
    if (!match) {
      return fallback;
    }
    const parsed = Number.parseInt(match[1], 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private extractOffset(sql: string): number {
    const match = normalize(sql).match(/offset\s+(\d+)/);
    if (!match) {
      return 0;
    }
    const parsed = Number.parseInt(match[1], 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  private getMatchQueryFromParams(params: unknown[], searchIndex: number): string {
    if (searchIndex < 0 || searchIndex >= params.length) {
      return '';
    }

    return String(params[searchIndex] ?? '')
      .replace(/\*/g, '')
      .toLowerCase()
      .trim();
  }

  private computeMatchScore(row: SearchTableRow, query: string): number {
    if (!query) {
      return 0;
    }
    const terms = query.split(/\s+/).filter(Boolean);
      const haystack = `${row.title} ${row.description} ${row.groups_json} ${row.capabilities} ${row.body}`.toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) {
        score += 1;
      }
    }
    return score;
  }

  private key(skillId: unknown, version: unknown): string {
    return `${String(skillId)}:${String(version)}`;
  }

  reset(): void {
    this.documents.clear();
    this.tags.clear();
    this.executeCalls = [];
    this.queryCalls = [];
  }
}

describe('MysqlSkillSearch', () => {
  const client = new FakeMysqlClient();

  afterEach(() => {
    client.reset();
  });

  it('reindexes documents with relational tags and uses fulltext + fallback fuzzy matching', async () => {
    const search = new MysqlSkillSearch(client as unknown as any);

    await search.reindexAll([
      {
        skillId: 'video-skill',
        version: '1.0.0',
        title: 'FFmpeg Video Skill',
        description: 'A guide for local media workflows.',
        category: 'media',
        groups: ['media', 'video', 'audio'],
        capabilities: ['ffmpeg', 'encoding'],
        body: 'Cut, concat and encode MP4 files.',
        publishedAt: new Date('2026-07-09T09:00:00.000Z'),
      },
      {
        skillId: 'image-skill',
        version: '1.0.0',
        title: 'Image Inspector',
        description: 'Checks images and assets.',
        category: 'media',
        groups: ['media', 'image'],
        capabilities: ['vision'],
        body: 'Analyze PNG and JPEG for quality.',
        publishedAt: new Date('2026-07-09T09:00:00.000Z'),
      },
    ]);

    const fulltextResult = await search.search('media', 'keyword', 'media', ['video']);
    expect(fulltextResult.total).toBe(1);
    expect(fulltextResult.items[0]).toMatchObject({
      skillId: 'video-skill',
      version: '1.0.0',
      score: expect.any(Number),
    });
    expect(fulltextResult.items[0].score).toBeGreaterThan(0);

    const exactTagResult = await search.search('video', 'keyword', 'media', ['audio', 'video']);
    expect(exactTagResult.total).toBe(1);

    const impossibleTagResult = await search.search('video', 'keyword', 'media', ['audio', 'missing']);
    expect(impossibleTagResult.total).toBe(0);
  });

  it('falls back to fuzzy search when fulltext scoring does not match', async () => {
    const search = new MysqlSkillSearch(client as unknown as any);
    await search.reindexAll([
      {
        skillId: 'video-skill',
        version: '1.0.0',
        title: 'FFmpeg Video Tool',
        description: 'Local video pipeline helper.',
        category: 'media',
        groups: ['media', 'video'],
        capabilities: ['ffmpeg'],
        body: 'Encode and trim files.',
        publishedAt: new Date('2026-07-09T09:15:00.000Z'),
      },
    ]);

    const result = await search.search('vido', 'keyword');
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      skillId: 'video-skill',
      version: '1.0.0',
      score: expect.any(Number),
    });
  });

  it('returns storage error for invalid regex input', async () => {
    const search = new MysqlSkillSearch(client as unknown as any);

    await expect(search.search('(', 'regex')).rejects.toBeInstanceOf(StorageError);
  });

  it('supports index/remove operations for single versions', async () => {
    const search = new MysqlSkillSearch(client as unknown as any);
    await search.indexVersion({
      skillId: { toString: () => 'skill-1' } as unknown as { toString: () => string },
      version: '1.0.0',
      manifest: {
        title: 'Draft',
        description: 'Draft skill',
        tags: ['draft'],
        category: 'media',
        groups: ['media'],
        capabilities: ['draft'],
      } as any,
    } as any, 'extract text');

    await search.removeVersion('skill-1', '1.0.0');

    const executeSql = client.executeCalls.map((entry) => entry.sql);
    expect(executeSql.some((sql) => sql.includes('INSERT INTO skill_search_documents'))).toBe(true);
    expect(executeSql.some((sql) => sql.includes('DELETE FROM skill_search_documents WHERE skill_id = ?'))).toBe(true);
  });
});

function normalize(sql: string): string {
  return sql.toLowerCase().trim().replace(/\s+/g, ' ');
}
