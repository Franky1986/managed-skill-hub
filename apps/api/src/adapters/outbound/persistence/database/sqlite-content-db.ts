import { AsyncLocalStorage } from 'node:async_hooks';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { ensureSqliteContentSchema } from './sqlite-content-schema';
import { ContentDb } from './content-db';

export class SqliteContentDb implements ContentDb {
  readonly dialect = 'sqlite' as const;
  private db: Database.Database | null = null;
  private readonly transactionContext = new AsyncLocalStorage<boolean>();
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly dbPath: string) {}

  getDb(): Database.Database {
    if (!this.db) {
      mkdirSync(path.dirname(this.dbPath), { recursive: true });
      this.db = new Database(this.dbPath);
      ensureSqliteContentSchema(this.db);
    }
    return this.db;
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    if (this.transactionContext.getStore()) {
      this.getDb().prepare(sql).run(...params);
      return;
    }
    await this.runExclusive(() => {
      this.getDb().prepare(sql).run(...params);
    });
  }

  async queryAll<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this.transactionContext.getStore()) {
      return this.getDb().prepare(sql).all(...params) as T[];
    }
    return this.runExclusive(() => this.getDb().prepare(sql).all(...params) as T[]);
  }

  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    if (this.transactionContext.getStore()) {
      return this.getDb().prepare(sql).get(...params) as T | undefined;
    }
    return this.runExclusive(() => this.getDb().prepare(sql).get(...params) as T | undefined);
  }

  async transaction<T>(handler: () => Promise<T>): Promise<T> {
    if (this.transactionContext.getStore()) {
      return handler();
    }
    return this.runExclusive(async () => {
      this.getDb().prepare('BEGIN').run();
      try {
        const result = await this.transactionContext.run(true, handler);
        this.getDb().prepare('COMMIT').run();
        return result;
      } catch (error) {
        this.getDb().prepare('ROLLBACK').run();
        throw error;
      }
    });
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private async runExclusive<T>(handler: () => Promise<T> | T): Promise<T> {
    const previous = this.operationTail;
    let release: () => void = () => undefined;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await handler();
    } finally {
      release();
    }
  }
}
