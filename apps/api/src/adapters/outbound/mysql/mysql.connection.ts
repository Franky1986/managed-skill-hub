import { StorageError } from '../../../domain/errors';
import { AppConfig } from '../../../infrastructure/config';

export interface MysqlSchemaRunner {
  ensureSchema(): Promise<void>;
}

interface MysqlPool {
  execute<T = unknown>(
    query: string | { sql: string; values: unknown[]; timeout?: number },
    params?: unknown[]
  ): Promise<[T[], unknown]>;
  query<T = unknown>(
    query: string | { sql: string; values: unknown[]; timeout?: number },
    params?: unknown[]
  ): Promise<[T[], unknown]>;
  getConnection(): Promise<MysqlConnection>;
  end(): Promise<void>;
}

export interface MysqlConnection {
  execute<T = unknown>(
    query: string | { sql: string; values: unknown[]; timeout?: number },
    params?: unknown[]
  ): Promise<[T[], unknown]>;
  query<T = unknown>(
    query: string | { sql: string; values: unknown[]; timeout?: number },
    params?: unknown[]
  ): Promise<[T[], unknown]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

export class MysqlClient {
  private pool: MysqlPool | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly schemaRunner?: MysqlSchemaRunner
  ) {}

  async query<T = unknown>(query: string, params: unknown[] = []): Promise<T[]> {
    const pool = await this.getPool();
    const [rows] = await this.executeQuery<T>(pool, query, params);
    return rows;
  }

  async queryWithOptions<T = unknown>(query: string, params: unknown[] = [], timeoutMs?: number): Promise<T[]> {
    const pool = await this.getPool();
    const [rows] = await this.executeQuery<T>(pool, query, params, timeoutMs);
    return rows;
  }

  async execute(query: string, params: unknown[] = []): Promise<void> {
    const pool = await this.getPool();
    await pool.execute(query, params);
  }

  async executeWithOptions(query: string, params: unknown[] = [], timeoutMs?: number): Promise<void> {
    const pool = await this.getPool();
    await this.executeSql(pool, query, params, timeoutMs);
  }

  async withTransaction<T>(handler: (connection: MysqlConnection) => Promise<T>): Promise<T> {
    const pool = await this.getPool();
    const connection = await pool.getConnection();
    try {
      await this.executeSql(connection, 'START TRANSACTION');
      const result = await handler(connection);
      await this.executeSql(connection, 'COMMIT');
      return result;
    } catch (error) {
      await this.safeRollback(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    if (pool) {
      await pool.end();
    }
  }

  private async getPool(): Promise<MysqlPool> {
    if (this.pool) {
      return this.pool;
    }

    const mysql = await this.loadMysqlDriver();

    const ssl = this.buildSslConfig();
    try {
      this.pool = mysql.createPool({
        host: this.config.mysqlHost,
        port: this.config.mysqlPort,
        user: this.config.mysqlUser,
        password: this.config.mysqlPassword,
        database: this.config.mysqlDatabase,
        connectTimeout: this.config.mysqlConnectTimeoutMs,
        multipleStatements: true,
        timezone: 'Z',
        dateStrings: true,
        ssl,
      }) as MysqlPool;
    } catch (error) {
      throw new StorageError(`Failed to configure MySQL pool: ${(error as Error).message}`);
    }

    if (this.schemaRunner) {
      await this.schemaRunner.ensureSchema();
    }

    return this.pool;
  }

  private async loadMysqlDriver(): Promise<{ createPool: (config: Record<string, unknown>) => MysqlPool }> {
    const moduleName = 'mysql2/promise';
    try {
      const moduleNamespace = (await import(moduleName)) as {
        createPool: (config: Record<string, unknown>) => MysqlPool;
      };
      return moduleNamespace;
    } catch (error) {
      throw new StorageError(
        `MySQL driver import failed. Install mysql2 to use MySQL-backed providers: ${(error as Error).message}`
      );
    }
  }

  private buildSslConfig(): boolean | Record<string, boolean> | undefined {
    if (this.config.mysqlSslMode === 'disabled') {
      return false;
    }

    if (this.config.mysqlSslMode === 'required' || this.config.mysqlSslMode === 'verify_ca' || this.config.mysqlSslMode === 'verify_identity') {
      return { rejectUnauthorized: true };
    }

    return undefined;
  }

  private async executeSql(target: MysqlPool | MysqlConnection, query: string, params: unknown[] = [], timeoutMs?: number): Promise<void> {
    await this.executeQuery(target, query, params, timeoutMs);
  }

  private async executeQuery<T>(
    target: MysqlPool | MysqlConnection,
    query: string,
    params: unknown[] = [],
    timeoutMs?: number
  ): Promise<[T[], unknown]> {
    const sql = timeoutMs ?? this.config.mysqlQueryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    try {
      return await (target as { execute: MysqlPool['execute']; query: MysqlPool['query'] }).execute(
        {
          sql: query,
          values: params,
          timeout: sql,
        }
      ) as [T[], unknown];
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (/not supported in the prepared statement protocol yet/i.test(message)) {
        return await (target as { query: MysqlPool['query'] }).query(
          {
            sql: query,
            values: params,
            timeout: sql,
          }
        ) as [T[], unknown];
      }
      throw this.rewriteMysqlError(error as Error);
    }
  }

  private async safeRollback(connection: MysqlConnection): Promise<void> {
    try {
      await this.executeSql(connection, 'ROLLBACK');
    } catch {
      // ignore rollback failure while propagating the original transactional error
    }
  }

  private rewriteMysqlError(error: Error): StorageError {
    const message = error.message ?? 'unknown';
    return new StorageError(`MySQL query failed: ${message}`);
  }
}
