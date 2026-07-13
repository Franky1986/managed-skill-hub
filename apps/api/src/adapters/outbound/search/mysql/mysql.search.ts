import { StorageError } from '../../../../domain/errors';
import { SkillSearchPort, SearchDocument, SearchEngineResult } from '../../../../application/ports/outbound/search.port';
import { SkillVersion } from '../../../../domain/skill/SkillVersion';
import { MysqlClient } from '../../mysql/mysql.connection';
import { ensureMysqlSearchSchema } from './mysql.search-schema';

interface SearchDocumentRow {
  skill_id: string;
  version: string;
  title: string;
  description: string;
  groups_json: string;
  capabilities: string;
  body: string;
  published_at: string;
  score: string | number | null;
}

interface SearchResultStatsRow {
  total: number;
}

const REGEX_TIMEOUT_MS = 1000;
const MYSQL_DATETIME_FORMAT = (value: Date | string): string => new Date(value).toISOString().slice(0, 19).replace('T', ' ');

export class MysqlSkillSearch implements SkillSearchPort {
  private schemaReady: Promise<void>;

  constructor(private readonly dbClient: MysqlClient) {
    this.schemaReady = ensureMysqlSearchSchema(this.dbClient);
  }

  private async ensureSchema(): Promise<void> {
    await this.schemaReady;
  }

  async indexVersion(skillVersion: SkillVersion, extractedText: string): Promise<void> {
    await this.ensureSchema();
    const publishedAt = skillVersion.publishedAt?.toISOString() ?? new Date().toISOString();

    await this.dbClient.withTransaction(async (connection) => {
      await connection.execute(
        `
          INSERT INTO skill_search_documents (
            skill_id, version, title, description, category, group_values, capabilities, body, published_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            description = VALUES(description),
            category = VALUES(category),
            group_values = VALUES(group_values),
            capabilities = VALUES(capabilities),
            body = VALUES(body),
            published_at = VALUES(published_at)
        `,
        [
          skillVersion.skillId.toString(),
          skillVersion.version,
          skillVersion.manifest.title,
          skillVersion.manifest.description,
          skillVersion.manifest.category,
          skillVersion.manifest.groups.join(','),
          skillVersion.manifest.capabilities.join(','),
          extractedText,
          MYSQL_DATETIME_FORMAT(publishedAt),
        ]
      );

      await connection.execute('DELETE FROM skill_search_document_tags WHERE skill_id = ? AND version = ?', [
        skillVersion.skillId.toString(),
        skillVersion.version,
      ]);

      const insertTag = `
        INSERT INTO skill_search_document_tags (skill_id, version, tag)
        VALUES (?, ?, ?)
      `;
      for (const tag of skillVersion.manifest.tags) {
        await connection.execute(insertTag, [skillVersion.skillId.toString(), skillVersion.version, tag]);
      }
    });
  }

  async removeVersion(skillId: string, version: string): Promise<void> {
    await this.ensureSchema();
    await this.dbClient.execute('DELETE FROM skill_search_documents WHERE skill_id = ? AND version = ?', [skillId, version]);
  }

  async reindexAll(documents: SearchDocument[]): Promise<void> {
    await this.ensureSchema();
    await this.dbClient.execute('DELETE FROM skill_search_documents');
    await this.dbClient.execute('DELETE FROM skill_search_document_tags');

    for (const doc of documents) {
      await this.dbClient.execute(
        `
          INSERT INTO skill_search_documents (
            skill_id, version, title, description, category, group_values, capabilities, body, published_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            description = VALUES(description),
            category = VALUES(category),
            group_values = VALUES(group_values),
            capabilities = VALUES(capabilities),
            body = VALUES(body),
            published_at = VALUES(published_at)
        `,
        [
          doc.skillId,
          doc.version,
          doc.title,
          doc.description,
          doc.category,
          doc.groups.join(','),
          doc.capabilities.join(','),
          doc.body,
          MYSQL_DATETIME_FORMAT(doc.publishedAt),
        ]
      );

      for (const tag of doc.groups.slice(1)) {
        await this.dbClient.execute(
          'INSERT INTO skill_search_document_tags (skill_id, version, tag) VALUES (?, ?, ?)',
          [doc.skillId, doc.version, tag]
        );
      }
    }
  }

  async search(
    query: string,
    mode: 'keyword' | 'fulltext' | 'regex',
    category?: string,
    tags: string[] = [],
    limit = 20,
    offset = 0
  ): Promise<{ items: SearchEngineResult[]; total: number }> {
    await this.ensureSchema();
    if (mode === 'regex') {
      return this.regexSearch(query, category, tags, limit, offset);
    }

    const searchMode = mode === 'fulltext' ? 'fulltext' : 'keyword';
    const ftsQuery = searchMode === 'fulltext' ? query : this.toKeywordQuery(query);
    if (!ftsQuery) {
      return {
        items: [],
        total: 0,
      };
    }

    const { rows, total } = await this.fetchFulltextResults(
      ftsQuery,
      searchMode,
      category,
      tags,
      limit,
      offset
    );
    if (total > 0) {
      return {
        items: rows.map(mapSearchDocumentRow),
        total,
      };
    }

    return this.fuzzySearch(query, category, tags, limit, offset);
  }

  private async fetchFulltextResults(
    ftsQuery: string,
    mode: 'fulltext' | 'keyword',
    category?: string,
    tags: string[] = [],
    limit = 20,
    offset = 0
  ): Promise<{ rows: SearchDocumentRow[]; total: number }> {
    const matchClause = mode === 'fulltext'
      ? `MATCH (title, description, category, group_values, capabilities, body) AGAINST (? IN NATURAL LANGUAGE MODE)`
      : `MATCH (title, description, category, group_values, capabilities, body) AGAINST (? IN BOOLEAN MODE)`;

    const { whereClauses, params } = this.buildFilters(category, tags);
    const whereParts = [...whereClauses, `${matchClause}`];

    const countSql = `
      SELECT COUNT(*) AS total
      FROM skill_search_documents d
      WHERE ${whereParts.join(' AND ')}
    `;
    const countRows = await this.dbClient.query<SearchResultStatsRow>(countSql, [...params, ftsQuery]);
    const total = Number(countRows[0]?.total ?? 0);
    if (total === 0) {
      return { rows: [], total: 0 };
    }

    const sql = `
      SELECT d.skill_id, d.version, d.title, d.description, d.group_values AS groups_json, d.capabilities, d.body, d.published_at, ${matchClause} AS score
      FROM skill_search_documents d
      WHERE ${whereParts.join(' AND ')}
      ORDER BY score DESC
      LIMIT ${sanitizeLimit(limit, 20)}
      OFFSET ${sanitizeOffset(offset)}
    `;
    const rows = await this.dbClient.query<SearchDocumentRow>(sql, [...params, ftsQuery, ftsQuery]);
    return { rows, total };
  }

  private async regexSearch(
    query: string,
    category?: string,
    tags: string[] = [],
    limit = 20,
    offset = 0
  ): Promise<{ items: SearchEngineResult[]; total: number }> {
    const { whereClauses, params } = this.buildFilters(category, tags);
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const rows = await this.dbClient.query<SearchDocumentRow>(
      `SELECT skill_id, version, title, description, group_values AS groups_json, body, published_at, capabilities FROM skill_search_documents d ${whereSql}`,
      params
    );

    let regex: RegExp;
    try {
      regex = new RegExp(query, 'i');
    } catch (error) {
      throw new StorageError(`Invalid regex query '${query}': ${(error as Error).message}`);
    }

    const startedAt = Date.now();
    const matches = rows.filter((row) => {
      if (Date.now() - startedAt > REGEX_TIMEOUT_MS) {
        throw new StorageError('Regex search timeout');
      }
      const text = `${row.title} ${row.description} ${row.body}`;
      return regex.test(text);
    });
    const items = matches.slice(offset, offset + limit).map((row) => ({
      skillId: row.skill_id,
      version: row.version,
      title: row.title,
      description: row.description,
      groups: row.groups_json.split(',').filter(Boolean),
      publishedAt: new Date(row.published_at),
      score: null,
    }));

    return { items, total: matches.length };
  }

  private async fuzzySearch(
    query: string,
    category?: string,
    tags: string[] = [],
    limit = 20,
    offset = 0
  ): Promise<{ items: SearchEngineResult[]; total: number }> {
    const terms = this.normalizeTerms(query);
    if (terms.length === 0) {
      return { items: [], total: 0 };
    }

    const { whereClauses, params } = this.buildFilters(category, tags);
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const rows = await this.dbClient.query<SearchDocumentRow>(
      `SELECT skill_id, version, title, description, group_values AS groups_json, capabilities, body, published_at FROM skill_search_documents d ${whereSql}`,
      params
    );

    const scored = rows
      .map((row) => {
        const text = `${row.title} ${row.description} ${row.groups_json} ${row.capabilities} ${row.body}`;
        const score = this.fuzzyScore(terms, text);
        return score === null ? null : { row, score };
      })
      .filter((entry): entry is { row: SearchDocumentRow; score: number } => Boolean(entry))
      .sort((left, right) => right.score - left.score);

    return {
      items: scored.slice(offset, offset + limit).map(({ row, score }) => ({
        skillId: row.skill_id,
        version: row.version,
        title: row.title,
        description: row.description,
        groups: row.groups_json.split(',').filter(Boolean),
        publishedAt: new Date(row.published_at),
        score: normalizeFuzzyScore(score),
      })),
      total: scored.length,
    };
  }

  private buildFilters(category?: string, tags: string[] = []) {
    const whereClauses: string[] = [];
    const params: string[] = [];
    if (category) {
      whereClauses.push('d.category = ?');
      params.push(category);
    }

    tags.forEach((tag, index) => {
      whereClauses.push(
        `EXISTS (
          SELECT 1
          FROM skill_search_document_tags t${index}
          WHERE t${index}.skill_id = d.skill_id
            AND t${index}.version = d.version
            AND t${index}.tag = ?
        )`
      );
      params.push(tag);
    });

    return { whereClauses, params };
  }

  private normalizeTerms(value: string): string[] {
    const normalized = value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim();
    return normalized.split(/\s+/).filter(Boolean);
  }

  private toKeywordQuery(query: string): string {
    const terms = this.normalizeTerms(query);
    if (terms.length === 0) {
      return '';
    }
    return terms.map((term) => `${term}*`).join(' ');
  }

  private fuzzyScore(needles: string[], text: string): number | null {
    const tokens = this.normalizeTerms(text);
    if (tokens.length === 0) {
      return null;
    }

    let total = 0;
    for (const term of needles) {
      const best = Math.min(...tokens.map((token) => normalizedEditDistance(term, token)));
      if (best > fuzzyThreshold(term)) {
        return null;
      }
      total += best;
    }
    return total / needles.length;
  }
}

function mapSearchDocumentRow(row: SearchDocumentRow): SearchEngineResult {
  const rawScore = typeof row.score === 'string' ? Number(row.score) : row.score;
  return {
    skillId: row.skill_id,
    version: row.version,
    title: row.title,
    description: row.description,
    groups: row.groups_json.split(',').filter(Boolean),
    publishedAt: new Date(row.published_at),
    score: Number.isFinite(rawScore) ? rawScore : null,
  };
}

function fuzzyThreshold(term: string): number {
  if (term.length <= 3) {
    return 0;
  }
  if (term.length <= 5) {
    return 0.34;
  }
  return 0.4;
}

function normalizeFuzzyScore(score: number): number {
  if (score <= 0) {
    return 1;
  }
  return 1 / (1 + score);
}

function sanitizeLimit(value: number, defaultValue: number): number {
  if (!Number.isInteger(value) || value < 0) {
    return defaultValue;
  }
  return value;
}

function sanitizeOffset(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    return 0;
  }
  return value;
}

function normalizedEditDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (right.startsWith(left) || left.startsWith(right)) {
    return Math.abs(left.length - right.length) / Math.max(left.length, right.length);
  }
  return levenshtein(left, right) / Math.max(left.length, right.length);
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}
