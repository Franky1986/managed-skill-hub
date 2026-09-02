import { CatalogMigration } from './catalog-migration';
import { migration as baselineLegacyCatalog } from './2026082600_baseline_legacy_catalog';
import { migration as addJudgementReuseMetadata } from './2026082701_add_judgement_reuse_metadata';
import { migration as normalizeLegacyCatalog } from './2026082801_normalize_legacy_catalog';
import { migration as finalizeLegacyCatalogParity } from './2026082802_finalize_legacy_catalog_parity';
import { migration as verifyFrozenCatalogIndexes } from './2026082803_verify_frozen_catalog_indexes';
import { migration as addAsyncOperations } from './2026090101_add_async_operations';
import { migration as addOperationDeduplication } from './2026090102_add_operation_deduplication';

/** Ordered, append-only catalog migration list. */
export const catalogMigrations: readonly CatalogMigration[] = [baselineLegacyCatalog, addJudgementReuseMetadata, normalizeLegacyCatalog, finalizeLegacyCatalogParity, verifyFrozenCatalogIndexes, addAsyncOperations, addOperationDeduplication];
