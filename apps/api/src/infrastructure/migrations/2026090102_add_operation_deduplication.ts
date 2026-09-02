import { CatalogMigration } from './catalog-migration';

/** Ensures there is at most one queued/running worker for one logical target. */
export const migration: CatalogMigration = {
  id: '2026090102_add_operation_deduplication',
  description: 'Prevent duplicate active asynchronous review operations.',
  async up(context) {
    // MySQL indexes utf8mb4 text in bytes; a raw target path can exceed the
    // InnoDB 3072-byte index limit. MySQL stores a SHA-256 hex digest instead.
    await context.addColumnIfMissing('skill_catalog_operations', 'dedupe_key', context.provider === 'mysql' ? 'CHAR(64) CHARACTER SET ascii NULL' : 'TEXT');
    await context.addIndexIfMissing('skill_catalog_operations', 'uq_skill_catalog_operations_dedupe', ['dedupe_key'], true);
  },
};
