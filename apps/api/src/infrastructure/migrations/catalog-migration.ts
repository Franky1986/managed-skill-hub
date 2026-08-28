export type CatalogMigrationProvider = 'sqlite' | 'mysql';

export interface CatalogMigrationContext {
  provider: CatalogMigrationProvider;
  /** Executes SQL owned by this immutable migration. */
  executeSchema(sql: string): Promise<void>;
  addColumnIfMissing(table: string, column: string, definition: string): Promise<void>;
  addIndexIfMissing(table: string, index: string, columns: string[], unique?: boolean): Promise<void>;
  addForeignKeyIfMissing(table: string, constraint: string, columns: string[], referencedTable: string, referencedColumns: string[], onDelete: 'CASCADE' | 'RESTRICT'): Promise<void>;
}

export interface CatalogMigration {
  /** Immutable, ordered identifier; never rename after a release. */
  id: string;
  description: string;
  up(context: CatalogMigrationContext): Promise<void>;
}
