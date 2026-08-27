import { CatalogMigration } from './catalog-migration';
import { migration as baselineLegacyCatalog } from './2026082600_baseline_legacy_catalog';
import { migration as addJudgementReuseMetadata } from './2026082701_add_judgement_reuse_metadata';

/** Ordered, append-only catalog migration list. */
export const catalogMigrations: readonly CatalogMigration[] = [baselineLegacyCatalog, addJudgementReuseMetadata];
