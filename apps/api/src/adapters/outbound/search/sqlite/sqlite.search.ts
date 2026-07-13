import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { SkillSearchPort, SearchDocument, SearchEngineResult } from '../../../../application/ports/outbound/search.port';
import { SkillVersion } from '../../../../domain/skill/SkillVersion';
import { StorageError } from '../../../../domain/errors';
import { ensureSqliteSearchSchema } from './sqlite.search-schema';

export class SqliteSkillSearch implements SkillSearchPort {
  private db: Database.Database | null = null;

  constructor(private readonly indexPath: string) {}

  private getDb(): Database.Database {
    if (!this.db) {
      mkdirSync(path.dirname(this.indexPath), { recursive: true });
      this.db = new Database(this.indexPath);
      ensureSqliteSearchSchema(this.db);
    }
    return this.db;
  }

  async indexVersion(skillVersion: SkillVersion, extractedText: string): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO search_documents
      (skill_id, version, title, description, groups, capabilities, body, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      skillVersion.skillId.toString(),
      skillVersion.version,
      skillVersion.manifest.title,
      skillVersion.manifest.description,
      skillVersion.manifest.groups.join(','),
      skillVersion.manifest.capabilities.join(','),
      extractedText,
      skillVersion.publishedAt?.toISOString() ?? new Date().toISOString()
    );
  }

  async removeVersion(skillId: string, version: string): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare('DELETE FROM search_documents WHERE skill_id = ? AND version = ?');
    stmt.run(skillId, version);
  }

  async reindexAll(documents: SearchDocument[]): Promise<void> {
    const db = this.getDb();
    db.exec('DELETE FROM search_documents');
    const insert = db.prepare(`
      INSERT INTO search_documents (skill_id, version, title, description, groups, capabilities, body, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction((docs: SearchDocument[]) => {
      for (const doc of docs) {
        insert.run(
          doc.skillId,
          doc.version,
          doc.title,
          doc.description,
          doc.groups.join(','),
          doc.capabilities.join(','),
          doc.body,
          doc.publishedAt.toISOString()
        );
      }
    });
    tx(documents);
  }

  async search(
    query: string,
    mode: 'keyword' | 'fulltext' | 'regex',
    group?: string,
    tags: string[] = [],
    limit = 20,
    offset = 0
  ): Promise<{ items: SearchEngineResult[]; total: number }> {
    const db = this.getDb();
    if (mode === 'regex') {
      return this.regexSearch(query, group, tags, limit, offset);
    }

    const where: string[] = [];
    const params: (string | number)[] = [];
    if (group) {
      where.push("groups LIKE ?");
      params.push(`%${group}%`);
    }
    for (const tag of tags) {
      where.push("(',' || groups || ',') LIKE ?");
      params.push(`%,${tag},%`);
    }

    const ftsQuery = mode === 'keyword' ? this.toKeywordQuery(query) : query;
    if (!ftsQuery) {
      return {
        items: [],
        total: 0,
      };
    }
    const ftsWhere = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) as c FROM search_fts WHERE search_fts MATCH ? ${ftsWhere}`;
    const total = (db.prepare(countSql).get(ftsQuery, ...params) as { c: number }).c;
    if (total === 0) {
      return this.fuzzySearch(query, group, tags, limit, offset);
    }

    const sql = `
      SELECT d.skill_id, d.version, d.title, d.description, d.groups, d.published_at,
             rank as score
      FROM search_fts
      JOIN search_documents d ON d.rowid = search_fts.rowid
      WHERE search_fts MATCH ? ${ftsWhere}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;
    const rows = db.prepare(sql).all(ftsQuery, ...params, limit, offset) as Array<{
      skill_id: string;
      version: string;
      title: string;
      description: string;
      groups: string;
      published_at: string;
      score: number;
    }>;

    return {
      items: rows.map((r) => ({
        skillId: r.skill_id,
        version: r.version,
        title: r.title,
        description: r.description,
        groups: r.groups.split(',').filter(Boolean),
        publishedAt: new Date(r.published_at),
        score: normalizeBm25Score(r.score),
      })),
      total,
    };
  }

  private regexSearch(query: string, group?: string, tags: string[] = [], limit = 20, offset = 0): Promise<{ items: SearchEngineResult[]; total: number }> {
    const db = this.getDb();
    const safeTimeout = 1000; // ms
    const regex = new RegExp(query, 'i');
    const start = Date.now();

    const whereParts: string[] = [];
    const params: string[] = [];
    if (group) {
      whereParts.push('groups LIKE ?');
      params.push(`%${group}%`);
    }
    for (const tag of tags) {
      whereParts.push("(',' || groups || ',') LIKE ?");
      params.push(`%,${tag},%`);
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const rows = db.prepare(`SELECT * FROM search_documents ${where}`).all(...params) as Array<{
      skill_id: string;
      version: string;
      title: string;
      description: string;
      groups: string;
      body: string;
      published_at: string;
    }>;

    const matched = rows.filter((r) => {
      if (Date.now() - start > safeTimeout) {
        throw new StorageError('Regex search timeout');
      }
      const text = `${r.title} ${r.description} ${r.body}`;
      return regex.test(text);
    });

    return Promise.resolve({
      items: matched.slice(offset, offset + limit).map((r) => ({
        skillId: r.skill_id,
        version: r.version,
        title: r.title,
        description: r.description,
        groups: r.groups.split(',').filter(Boolean),
        publishedAt: new Date(r.published_at),
        score: null,
      })),
      total: matched.length,
    });
  }

  private fuzzySearch(query: string, group?: string, tags: string[] = [], limit = 20, offset = 0): Promise<{ items: SearchEngineResult[]; total: number }> {
    const db = this.getDb();
    const terms = this.normalizeTerms(query);
    if (terms.length === 0) {
      return Promise.resolve({ items: [], total: 0 });
    }

    const whereParts: string[] = [];
    const params: string[] = [];
    if (group) {
      whereParts.push('groups LIKE ?');
      params.push(`%${group}%`);
    }
    for (const tag of tags) {
      whereParts.push("(',' || groups || ',') LIKE ?");
      params.push(`%,${tag},%`);
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const rows = db.prepare(`SELECT * FROM search_documents ${where}`).all(...params) as Array<{
      skill_id: string;
      version: string;
      title: string;
      description: string;
      groups: string;
      capabilities: string;
      body: string;
      published_at: string;
    }>;

    const matched = rows
      .map((row) => {
        const text = `${row.title} ${row.description} ${row.groups} ${row.capabilities} ${row.body}`;
        const score = this.fuzzyScore(terms, text);
        return { row, score };
      })
      .filter((match): match is { row: (typeof rows)[number]; score: number } => match.score !== null)
      .sort((left, right) => right.score - left.score);

    return Promise.resolve({
      items: matched
        .slice(offset, offset + limit)
        .map(({ row, score }) => ({
        skillId: row.skill_id,
        version: row.version,
        title: row.title,
        description: row.description,
        groups: row.groups.split(',').filter(Boolean),
        publishedAt: new Date(row.published_at),
        score: normalizeFuzzyScore(score),
      })),
      total: matched.length,
    });
  }

  private fuzzyScore(queryTerms: string[], text: string): number | null {
    const tokens = this.normalizeTerms(text);
    if (tokens.length === 0) {
      return null;
    }

    let total = 0;
    for (const term of queryTerms) {
      const best = Math.min(...tokens.map((token) => normalizedEditDistance(term, token)));
      if (best > fuzzyThreshold(term)) {
        return null;
      }
      total += best;
    }

    return total / queryTerms.length;
  }

  private toKeywordQuery(query: string): string {
    const terms = this.normalizeTerms(query);
    if (terms.length === 0) {
      return '';
    }

    return terms.map((term) => `${term}*`).join(' ');
  }

  private normalizeTerms(value: string): string[] {
    const normalized = value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim();

    return normalized.split(/\s+/).filter(Boolean);
  }
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

function normalizeBm25Score(rawScore: number): number {
  return -rawScore;
}

function normalizeFuzzyScore(score: number): number {
  if (score <= 0) {
    return 1;
  }

  return 1 / (1 + score);
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
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}
