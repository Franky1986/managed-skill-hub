export type CatalogMigrationProvider = 'sqlite' | 'mysql';

export interface CatalogMigrationContext {
  provider: CatalogMigrationProvider;
  bootstrapLegacySchema(): Promise<void>;
  addColumnIfMissing(table: string, column: string, definition: string): Promise<void>;
}

export interface CatalogMigration {
  /** Immutable, ordered identifier; never rename after a release. */
  id: string;
  description: string;
  up(context: CatalogMigrationContext): Promise<void>;
}
