export type ContentDbDialect = 'sqlite' | 'mysql';

export interface ContentDb {
  readonly dialect: ContentDbDialect;
  execute(sql: string, params?: unknown[]): Promise<void>;
  queryAll<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  transaction<T>(handler: () => Promise<T>): Promise<T>;
  close(): Promise<void> | void;
}

export function upsertClause(dialect: ContentDbDialect, keys: string[], assignments: string[]): string {
  if (dialect === 'sqlite') {
    return 'ON CONFLICT(' + keys.join(', ') + ') DO UPDATE SET ' + assignments.map((column) => column + ' = excluded.' + column).join(', ');
  }
  return 'ON DUPLICATE KEY UPDATE ' + assignments.map((column) => column + ' = VALUES(' + column + ')').join(', ');
}

export function insertDoNothingClause(dialect: ContentDbDialect, keyColumn: string): string {
  if (dialect === 'sqlite') {
    return 'ON CONFLICT(' + keyColumn + ') DO NOTHING';
  }
  return 'ON DUPLICATE KEY UPDATE ' + keyColumn + ' = ' + keyColumn;
}
