import { AsyncLocalStorage } from 'node:async_hooks';
import { ContentDb } from './content-db';
import { MysqlClient, MysqlConnection } from '../../mysql/mysql.connection';
import { ensureMysqlContentSchema } from './mysql-content-schema';

export class MysqlContentDb implements ContentDb {
  readonly dialect = 'mysql' as const;
  private readonly schemaReady: Promise<void>;
  private readonly transactionConnection = new AsyncLocalStorage<MysqlConnection>();

  constructor(private readonly client: MysqlClient) {
    this.schemaReady = ensureMysqlContentSchema(client);
  }

  private async ensureSchema(): Promise<void> {
    await this.schemaReady;
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.ensureSchema();
    const connection = this.transactionConnection.getStore();
    if (connection) {
      await connection.execute(sql, params);
      return;
    }
    await this.client.execute(sql, params);
  }

  async queryAll<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.ensureSchema();
    const connection = this.transactionConnection.getStore();
    if (connection) {
      const [rows] = await connection.execute<T>(sql, params);
      return rows;
    }
    return this.client.query<T>(sql, params);
  }

  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.queryAll<T>(sql, params);
    return rows[0];
  }

  async transaction<T>(handler: () => Promise<T>): Promise<T> {
    await this.ensureSchema();
    if (this.transactionConnection.getStore()) {
      return handler();
    }
    return this.client.withTransaction((connection) =>
      this.transactionConnection.run(connection, handler)
    );
  }

  close(): void {}
}
