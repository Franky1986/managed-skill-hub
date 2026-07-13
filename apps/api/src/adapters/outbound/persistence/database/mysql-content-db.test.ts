import { describe, expect, it, vi } from 'vitest';
import type { MysqlClient, MysqlConnection } from '../../mysql/mysql.connection';

vi.mock('./mysql-content-schema', () => ({
  ensureMysqlContentSchema: vi.fn().mockResolvedValue(undefined),
}));

import { MysqlContentDb } from './mysql-content-db';

describe('MysqlContentDb', () => {
  it('keeps concurrent non-transactional work outside an active transaction', async () => {
    const transactionEntered = deferred<void>();
    const releaseTransaction = deferred<void>();
    const connection = {
      execute: vi.fn(async (sql: string) => {
        if (sql === 'transaction-write') {
          transactionEntered.resolve();
          await releaseTransaction.promise;
        }
        return [[], undefined];
      }),
    } as unknown as MysqlConnection;
    const client = {
      execute: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      withTransaction: vi.fn(async (handler: (value: MysqlConnection) => Promise<unknown>) => handler(connection)),
    } as unknown as MysqlClient;
    const db = new MysqlContentDb(client);

    const transaction = db.transaction(async () => {
      await db.execute('transaction-write');
    });
    await transactionEntered.promise;

    await db.execute('outside-write');

    expect(client.execute).toHaveBeenCalledWith('outside-write', []);
    expect(connection.execute).not.toHaveBeenCalledWith('outside-write', []);

    releaseTransaction.resolve();
    await transaction;
  });
});

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
