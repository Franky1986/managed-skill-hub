import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteContentDb } from './sqlite-content-db';

describe('SqliteContentDb', () => {
  it('serializes external work around an active async transaction', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'msh-sqlite-content-db-'));
    const db = new SqliteContentDb(path.join(tempDir, 'content.db'));
    const transactionEntered = deferred<void>();
    const releaseTransaction = deferred<void>();

    try {
      await db.execute('CREATE TABLE concurrency_proof (value INTEGER NOT NULL)');
      const transaction = db.transaction(async () => {
        await db.execute('INSERT INTO concurrency_proof (value) VALUES (?)', [1]);
        transactionEntered.resolve();
        await releaseTransaction.promise;
      });
      await transactionEntered.promise;

      let outsideWriteCompleted = false;
      const outsideWrite = db
        .execute('INSERT INTO concurrency_proof (value) VALUES (?)', [2])
        .then(() => {
          outsideWriteCompleted = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(outsideWriteCompleted).toBe(false);

      releaseTransaction.resolve();
      await Promise.all([transaction, outsideWrite]);

      const rows = await db.queryAll<{ value: number }>('SELECT value FROM concurrency_proof ORDER BY value');
      expect(rows).toEqual([{ value: 1 }, { value: 2 }]);
    } finally {
      db.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
