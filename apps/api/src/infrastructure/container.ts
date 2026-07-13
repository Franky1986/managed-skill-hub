import { FileSystemSkillRepository } from '../adapters/outbound/persistence/filesystem/file-system.repository';
import { FileSystemSkillStorage } from '../adapters/outbound/persistence/filesystem/file-system.storage';
import { DatabaseSkillStorage } from '../adapters/outbound/persistence/database/database.skill-storage';
import { DatabaseSkillRepository } from '../adapters/outbound/persistence/database/database.skill-repository';
import { SqliteContentDb } from '../adapters/outbound/persistence/database/sqlite-content-db';
import { MysqlContentDb } from '../adapters/outbound/persistence/database/mysql-content-db';
import { ContentDb } from '../adapters/outbound/persistence/database/content-db';
import { FileSystemAuditLog } from '../adapters/outbound/audit/filesystem/file-system.audit';
import { DatabaseAuditLog } from '../adapters/outbound/audit/database/database.audit';
import { SqliteSkillSearch } from '../adapters/outbound/search/sqlite/sqlite.search';
import { SqliteSkillCatalog } from '../adapters/outbound/catalog/sqlite/sqlite.skill-catalog';
import { MysqlSkillCatalog } from '../adapters/outbound/catalog/mysql/mysql.skill-catalog';
import { MysqlSkillSearch } from '../adapters/outbound/search/mysql/mysql.search';
import { MysqlClient } from '../adapters/outbound/mysql/mysql.connection';
import { ConfigurationError, ValidationError } from '../domain/errors';
import { CompositeFileScanner } from '../adapters/outbound/scanner/composite.scanner';
import { LiteParseFileScanner } from '../adapters/outbound/scanner/liteparse.scanner';
import { NativeFileScanner } from '../adapters/outbound/scanner/native.scanner';
import { NoopSkillJudger } from '../adapters/outbound/judger/noop.judger';
import { VercelAiSdkSkillJudger } from '../adapters/outbound/judger/vercel-ai-sdk.judger';
import { SkillCommandPort } from '../application/ports/inbound/skill-command.port';
import { SkillQueryPort } from '../application/ports/inbound/skill-query.port';
import { ProposalCommandPort } from '../application/ports/inbound/proposal-command.port';
import { NameSuggestionPort } from '../application/ports/inbound/name-suggestion.port';
import { CreateSkillUseCase } from '../application/usecases/skill/create-skill.usecase';
import { UpdateSkillUseCase } from '../application/usecases/skill/update-skill.usecase';
import { ReviewSkillUseCase } from '../application/usecases/skill/review-skill.usecase';
import { SubmitProposalUseCase } from '../application/usecases/proposal/submit-proposal.usecase';
import { SuggestSkillNameUseCase } from '../application/usecases/skill/suggest-name.usecase';
import { JudgeProposalUseCase } from '../application/usecases/judgement/judge-proposal.usecase';
import { JudgeFileUseCase } from '../application/usecases/judgement/judge-file.usecase';
import { JudgeSkillVersionUseCase } from '../application/usecases/judgement/judge-skill-version.usecase';
import { ListJudgementsUseCase } from '../application/usecases/judgement/list-judgements.usecase';
import { SkillQueryAdapter } from '../application/usecases/skill/skill-query.adapter';
import { AppConfig, CatalogProvider, ContentStorageProvider, SearchProvider, validateDataDir } from './config';
import { ReviewProposalUseCase } from '../application/usecases/proposal/review-proposal.usecase';
import { ProposalReadUseCase } from '../application/usecases/proposal/proposal-read.usecase';
import { ExtractProposalFileContentUseCase } from '../application/usecases/proposal/extract-proposal-file-content.usecase';
import { ProposalDuplicateCheckUseCase } from '../application/usecases/proposal/duplicate-check.usecase';
import { ReextractProposalFileUseCase } from '../application/usecases/proposal/reextract-proposal-file.usecase';
import { ProbeProposalFileContentUseCase } from '../application/usecases/proposal/probe-proposal-file-content.usecase';
import { SkillRepositoryPort } from '../application/ports/outbound/skill-repository.port';
import { SkillFileStoragePort } from '../application/ports/outbound/file-storage.port';
import { AuditLogPort } from '../application/ports/outbound/audit.port';
import { ExtractSkillFileContentUseCase } from '../application/usecases/skill/extract-skill-file-content.usecase';
import { ReextractSkillFileUseCase } from '../application/usecases/skill/reextract-skill-file.usecase';
import { ProbeSkillFileContentUseCase } from '../application/usecases/skill/probe-skill-file-content.usecase';
import { ReindexSkillSearchUseCase } from '../application/usecases/skill/reindex-skill-search.usecase';
import { AdminSkillReadUseCase } from '../application/usecases/skill/admin-skill-read.usecase';
import { RebuildProjectionsUseCase } from '../application/usecases/projection/rebuild-projections.usecase';
import { FileBackedObservability } from '../adapters/outbound/observability/file-backed.observability';
import { ReadObservabilityUseCase } from '../application/usecases/observability/read-observability.usecase';
import { ObservabilityPort } from '../application/ports/outbound/observability.port';
import { ExportObservabilityUseCase } from '../application/usecases/observability/export-observability.usecase';
import { SkillCatalogPort } from '../application/ports/outbound/skill-catalog.port';
import { SkillSearchPort } from '../application/ports/outbound/search.port';
import { AutoPublishProposalUseCase } from '../application/usecases/proposal/auto-publish-proposal.usecase';
import path from 'path';
import { promises as fs } from 'fs';
import type { SkillJudgerPort } from '../application/ports/outbound/judger.port';
import { resolveRepoRoot } from './config';
import { PrincipalRepositoryPort } from '../application/ports/outbound/principal-repository.port';
import { AdminSessionPort } from '../application/ports/outbound/admin-session.port';
import { OidcLoginTransactionPort } from '../application/ports/outbound/oidc-login-transaction.port';
import { SqliteIdentityPersistence } from '../adapters/outbound/identity/sqlite-identity.persistence';
import { MysqlIdentityPersistence } from '../adapters/outbound/identity/mysql-identity.persistence';
import { AuthorizationPolicy } from '../application/security/authorization-policy';
import { PrincipalProjectionService } from '../application/security/principal-projection.service';

export interface Container {
  config: AppConfig;
  skillRepository: SkillRepositoryPort;
  fileStorage: SkillFileStoragePort;
  auditLog: AuditLogPort;
  principalRepository: PrincipalRepositoryPort;
  adminSessions: AdminSessionPort;
  oidcLoginTransactions: OidcLoginTransactionPort;
  authorizationPolicy: AuthorizationPolicy;
  principalProjection: PrincipalProjectionService;
  createSkill: SkillCommandPort;
  updateSkill: SkillCommandPort;
  reviewSkill: SkillCommandPort;
  skillQuery: SkillQueryPort;
  proposalCommand: ProposalCommandPort;
  proposalRead: ProposalReadUseCase;
  proposalDuplicateCheck: ProposalDuplicateCheckUseCase;
  reviewProposal: ReviewProposalUseCase;
  nameSuggestion: NameSuggestionPort;
  judgeProposal: JudgeProposalUseCase;
  judgeFile: JudgeFileUseCase;
  judgeSkillVersion: JudgeSkillVersionUseCase;
  listJudgements: ListJudgementsUseCase;
  extractSkillFileContent: ExtractSkillFileContentUseCase;
  extractProposalFileContent: ExtractProposalFileContentUseCase;
  probeProposalFileContent: ProbeProposalFileContentUseCase;
  probeSkillFileContent: ProbeSkillFileContentUseCase;
  adminSkillRead: AdminSkillReadUseCase;
  reextractSkillFile: ReextractSkillFileUseCase;
  reextractProposalFile: ReextractProposalFileUseCase;
  reindexSkillSearch: ReindexSkillSearchUseCase;
  rebuildProjections: RebuildProjectionsUseCase;
  observability: ObservabilityPort;
  readObservability: ReadObservabilityUseCase;
  exportObservability: ExportObservabilityUseCase;
  shutdown(): Promise<void>;
}

export interface ContainerBuildOptions {
  recordPrincipalProjectionEvent?: import('../application/security/principal-projection.service').PrincipalProjectionEventSink;
}

export async function buildContainer(
  config: AppConfig,
  options: ContainerBuildOptions = {}
): Promise<Container> {
  await validateDataDir(config.dataDir);

  const mysqlClient = needsMysqlClient(config) ? new MysqlClient(config) : null;
  const catalog = buildCatalogAdapter(
    config.catalogProvider,
    config.dataDir,
    path.join(config.dataDir, 'index', 'search.db'),
    mysqlClient
  );
  const identityPersistence = buildIdentityPersistence(
    config.catalogProvider,
    path.join(config.dataDir, 'index', 'search.db'),
    mysqlClient
  );
  const authorizationPolicy = new AuthorizationPolicy(config);
  const principalProjection = new PrincipalProjectionService(
    identityPersistence,
    authorizationPolicy,
    config,
    options.recordPrincipalProjectionEvent
  );
  const search = buildSearchAdapter(config.searchProvider, path.join(config.dataDir, 'index', 'search.db'), mysqlClient);
  const contentDb = buildContentDb(config, mysqlClient);
  const storage = buildStorageAdapter(config.contentStorageProvider ?? 'filesystem', config, contentDb);
  const audit = buildAuditAdapter(config.contentStorageProvider ?? 'filesystem', config, catalog, contentDb);
  const scanner = new CompositeFileScanner([new NativeFileScanner(), new LiteParseFileScanner()]);
  const judger = await buildJudger(config);
  const repo = buildRepositoryAdapter(config.contentStorageProvider ?? 'filesystem', config, catalog, contentDb);
  const query = new SkillQueryAdapter(repo, search, storage, audit, catalog);
  const extractor = new ExtractSkillFileContentUseCase(repo, storage, scanner, catalog);
  const proposalExtractor = new ExtractProposalFileContentUseCase(repo, storage, scanner, catalog);
  const proposalProber = new ProbeProposalFileContentUseCase(repo, storage, catalog);
  const skillProber = new ProbeSkillFileContentUseCase(repo, storage, catalog);
  const observability = new FileBackedObservability(
    path.join(config.dataDir, 'observability', 'http-observability.snapshot.json')
  );

  const createSkill = new CreateSkillUseCase(repo, storage, audit);
  const judgeSkillVersion = new JudgeSkillVersionUseCase(repo, judger, audit, catalog, storage, scanner);
  const reviewProposal = new ReviewProposalUseCase(
    repo,
    storage,
    audit,
    createSkill,
    judgeSkillVersion,
    catalog,
    extractor
  );
  const reviewSkill = new ReviewSkillUseCase(repo, audit, storage, scanner, search, catalog, judger);
  const autoPublishProposal = new AutoPublishProposalUseCase(
    repo,
    storage,
    audit,
    scanner,
    judger,
    reviewProposal,
    reviewSkill,
    {
      enabled: config.autoPublishOnGreen,
      excludedCategories: config.autoPublishExcludedCategories,
      autoApproveWithoutJudger: config.autoApproveWithoutJudger,
    },
    catalog
  );

  return {
    config,
    skillRepository: repo,
    fileStorage: storage,
    auditLog: audit,
    principalRepository: identityPersistence,
    adminSessions: identityPersistence,
    oidcLoginTransactions: identityPersistence,
    authorizationPolicy,
    principalProjection,
    createSkill,
    updateSkill: new UpdateSkillUseCase(repo, storage, audit, catalog),
    reviewSkill,
    skillQuery: query,
    proposalCommand: new SubmitProposalUseCase(repo, storage, audit, judger, scanner, catalog, {
      maxFiles: config.proposalMaxFiles,
      maxFileSizeBytes: config.proposalMaxFileSizeBytes,
      disallowedPathPrefixes: config.proposalDisallowedPaths,
    }, autoPublishProposal),
    proposalRead: new ProposalReadUseCase(
      repo,
      storage,
      proposalExtractor,
      audit,
      catalog,
      config.autoPublishOnGreen,
      config.proposalMaxFiles,
      config.proposalMaxFileSizeBytes,
      config.proposalDisallowedPaths
    ),
    proposalDuplicateCheck: new ProposalDuplicateCheckUseCase(catalog),
    reviewProposal,
    nameSuggestion: new SuggestSkillNameUseCase(repo),
    judgeProposal: new JudgeProposalUseCase(repo, judger, audit, catalog, storage, scanner),
    judgeFile: new JudgeFileUseCase(scanner, judger),
    judgeSkillVersion,
    listJudgements: new ListJudgementsUseCase(repo, audit, catalog),
    extractSkillFileContent: extractor,
    extractProposalFileContent: proposalExtractor,
    probeProposalFileContent: proposalProber,
    probeSkillFileContent: skillProber,
    adminSkillRead: new AdminSkillReadUseCase(repo, storage, extractor, catalog),
    reextractSkillFile: new ReextractSkillFileUseCase(extractor, audit),
    reextractProposalFile: new ReextractProposalFileUseCase(proposalExtractor, audit),
    reindexSkillSearch: new ReindexSkillSearchUseCase(repo, storage, scanner, search, audit, catalog),
    rebuildProjections: new RebuildProjectionsUseCase(repo, audit, catalog, search, storage, scanner),
    observability,
    readObservability: new ReadObservabilityUseCase(observability),
    exportObservability: new ExportObservabilityUseCase(observability),
    async shutdown(): Promise<void> {
      contentDb?.close();
      if (identityPersistence instanceof SqliteIdentityPersistence) {
        identityPersistence.close();
      }
      await mysqlClient?.close();
    },
  };
}

function buildIdentityPersistence(
  provider: CatalogProvider,
  catalogPath: string,
  mysqlClient: MysqlClient | null
): SqliteIdentityPersistence | MysqlIdentityPersistence {
  if (provider === 'sqlite') {
    return new SqliteIdentityPersistence(catalogPath);
  }
  if (!mysqlClient) {
    throw new ConfigurationError('MYSQL client configuration is required for mysql identity persistence.');
  }
  return new MysqlIdentityPersistence(mysqlClient);
}


function buildContentDb(config: AppConfig, mysqlClient: MysqlClient | null): ContentDb | null {
  if ((config.contentStorageProvider ?? 'filesystem') !== 'database') {
    return null;
  }
  if (config.catalogProvider === 'sqlite') {
    return new SqliteContentDb(path.join(config.dataDir, 'index', 'search.db'));
  }
  if (config.catalogProvider === 'mysql') {
    if (!mysqlClient) {
      throw new ConfigurationError('MYSQL client configuration is required for mysql database content storage.');
    }
    return new MysqlContentDb(mysqlClient);
  }
  throw new ConfigurationError('Unsupported catalog provider for database content storage.');
}

function buildStorageAdapter(
  provider: ContentStorageProvider,
  config: AppConfig,
  contentDb: ContentDb | null
) {
  if (provider === 'filesystem') {
    return new FileSystemSkillStorage(config.dataDir);
  }
  if (!contentDb) {
    throw new ConfigurationError('Database content storage requires a configured content database.');
  }
  return new DatabaseSkillStorage(contentDb);
}

function buildRepositoryAdapter(
  provider: ContentStorageProvider,
  config: AppConfig,
  catalog: SkillCatalogPort,
  contentDb: ContentDb | null
): SkillRepositoryPort {
  if (provider === 'filesystem') {
    return new FileSystemSkillRepository(config.dataDir, catalog);
  }
  if (!contentDb) {
    throw new ConfigurationError('Database content repository requires a configured content database.');
  }
  return new DatabaseSkillRepository(contentDb, catalog);
}

function buildAuditAdapter(
  provider: ContentStorageProvider,
  config: AppConfig,
  catalog: SkillCatalogPort,
  contentDb: ContentDb | null
) {
  if (provider === 'filesystem') {
    return new FileSystemAuditLog(config.dataDir, catalog);
  }
  if (!contentDb) {
    throw new ConfigurationError('Database audit storage requires a configured content database.');
  }
  return new DatabaseAuditLog(contentDb, catalog);
}

function needsMysqlClient(config: AppConfig): boolean {
  return config.catalogProvider === 'mysql' || config.searchProvider === 'mysql';
}

function buildCatalogAdapter(
  provider: CatalogProvider,
  dataDir: string,
  catalogPath: string,
  mysqlClient: MysqlClient | null
): SkillCatalogPort {
  if (provider === 'sqlite') {
    return new SqliteSkillCatalog(dataDir, catalogPath);
  }
  if (provider === 'mysql') {
    if (!mysqlClient) {
      throw new ConfigurationError('MYSQL client configuration is required for mysql catalog provider.');
    }
    return new MysqlSkillCatalog(dataDir, mysqlClient);
  }

  throw new ConfigurationError(
    `CATALOG_PROVIDER is set to '${provider}', but mysql catalog support is not available in this build.`
  );
}

function buildSearchAdapter(
  provider: SearchProvider,
  indexPath: string,
  mysqlClient: MysqlClient | null
): SkillSearchPort {
  if (provider === 'sqlite') {
    return new SqliteSkillSearch(indexPath);
  }
  if (provider === 'mysql') {
    if (!mysqlClient) {
      throw new ConfigurationError('MYSQL client configuration is required for mysql search provider.');
    }
    return new MysqlSkillSearch(mysqlClient);
  }

  throw new ConfigurationError(`SEARCH_PROVIDER is set to '${provider}', but mysql search is not available in this build.`);
}

async function buildJudger(config: AppConfig): Promise<SkillJudgerPort> {
  if (config.judgerProvider === 'noop') {
    return new NoopSkillJudger();
  }

  if (config.judgerProvider === 'vercel-ai-sdk') {
    return new VercelAiSdkSkillJudger({
      model: required(config.vercelAiSdkModel, 'VERCEL_AI_SDK_MODEL', 'vercel-ai-sdk'),
      timeoutMs: config.vercelAiSdkTimeoutMs,
      maxTextChars: config.vercelAiSdkMaxTextChars,
      maxRetries: config.vercelAiSdkMaxRetries,
    });
  }


  return loadExternalJudgerAdapter(config);
}

type JudgerAdapterModule = {
  SkillJudgerPlugin?: unknown;
  SkillJudgerAdapter?: unknown;
  createJudger?: (context: JudgerAdapterFactoryContext) => Promise<unknown> | unknown;
  createSkillJudger?: (context: JudgerAdapterFactoryContext) => Promise<unknown> | unknown;
  createSkillJudgerAdapter?: (context: JudgerAdapterFactoryContext) => Promise<unknown> | unknown;
  default?: unknown;
  [key: string]: unknown;
};

type JudgerAdapterFactoryContext = {
  provider: string;
  adapterPath: string;
  config: AppConfig;
};

async function loadExternalJudgerAdapter(config: AppConfig): Promise<SkillJudgerPort> {
  const rawAdapterModuleCandidates = resolveJudgerAdapterModuleCandidates(config);
  const adapterModulePathCandidates: string[] = [];

  for (const candidatePath of rawAdapterModuleCandidates) {
    const expandedPaths = await resolveJudgerAdapterModulePathCandidates(candidatePath);
    adapterModulePathCandidates.push(...expandedPaths);
  }

  const adapterModulePaths = [...new Set(adapterModulePathCandidates)];
  let module: JudgerAdapterModule | null = null;
  let adapterModulePath = '';

  for (const candidatePath of adapterModulePaths) {
    try {
      module = await loadJudgerAdapterModule(candidatePath);
      adapterModulePath = candidatePath;
      break;
    } catch (error) {
      if (isModuleNotFoundForAdapter(candidatePath, error)) {
        if (candidatePath === adapterModulePaths[adapterModulePaths.length - 1]) {
          throw new ConfigurationError(
            `Judger adapter module not found for provider '${config.judgerProvider}'. Tried: ${adapterModulePaths.join(', ')}.`
          );
        }
        continue;
      }
      throw error;
    }
  }

  if (!module) {
    throw new ConfigurationError(
      `Judger adapter module could not be loaded for provider '${config.judgerProvider}'.`
    );
  }

  const context: JudgerAdapterFactoryContext = {
    provider: config.judgerProvider,
    adapterPath: adapterModulePath,
    config,
  };

  const candidates: unknown[] = [
    module.default,
    module.createJudger,
    module.createSkillJudger,
    module.createSkillJudgerAdapter,
    module.SkillJudgerPlugin,
    module.SkillJudgerAdapter,
  ];

  for (const candidate of candidates) {
    const adapter = await instantiateJudgerCandidate(candidate, context);
    if (adapter) {
      return adapter;
    }
  }

  throw new ConfigurationError(
    `Loaded judger adapter module '${adapterModulePath}' does not export a valid SkillJudgerPort. ` +
    'Expected default export, SkillJudgerAdapter class, or a matching factory function.'
  );
}

async function loadJudgerAdapterModule(modulePath: string): Promise<JudgerAdapterModule> {
  try {
    return (await import(modulePath)) as JudgerAdapterModule;
  } catch (error) {
    throw error;
  }
}

function resolveJudgerAdapterModuleCandidates(config: AppConfig): string[] {
  if (config.judgerAdapterPath && config.judgerAdapterPath.trim().length > 0) {
    return [config.judgerAdapterPath.trim()];
  }

  throw new ConfigurationError(
    `JUDGER_PROVIDER=${config.judgerProvider} requires JUDGER_ADAPTER_PATH to point to a module that implements SkillJudgerPort.`
  );
}

async function resolveJudgerAdapterModulePathCandidates(rawPath: string): Promise<string[]> {
  if (path.isAbsolute(rawPath)) {
    const expanded = resolveCandidateAdapterPaths(rawPath);
    const existing = await filterExistingModulePaths(expanded);
    return existing.length > 0 ? existing : expanded;
  }

  const absolutePath = path.resolve(resolveRepoRoot(), rawPath);
  const expanded = resolveCandidateAdapterPaths(absolutePath);
  const existing = await filterExistingModulePaths(expanded);
  return existing.length > 0 ? existing : expanded;
}

function resolveCandidateAdapterPaths(modulePath: string): string[] {
  const ext = path.extname(modulePath);
  if (ext) {
    return [modulePath];
  }

  return [
    modulePath,
    `${modulePath}.ts`,
    `${modulePath}.js`,
    `${modulePath}.mjs`,
    `${modulePath}.cjs`,
    `${modulePath}.mts`,
    `${modulePath}.cts`,
  ];
}

async function filterExistingModulePaths(candidates: string[]): Promise<string[]> {
  const checks = await Promise.all(
    candidates.map(async (candidate) => ({
      path: candidate,
      exists: await fileExists(candidate),
    }))
  );

  return checks.filter((check) => check.exists).map((check) => check.path);
}

function isModuleNotFoundForAdapter(candidatePath: string, error: unknown): boolean {
  const nodeError = error as NodeJS.ErrnoException & { message: string };
  if (nodeError.code !== 'ERR_MODULE_NOT_FOUND') {
    return false;
  }

  return nodeError.message.includes(candidatePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function instantiateJudgerCandidate(
  candidate: unknown,
  context: JudgerAdapterFactoryContext
): Promise<SkillJudgerPort | null> {
  if (!candidate) {
    return null;
  }

  if (isSkillJudgerPort(candidate)) {
    return candidate;
  }

  if (typeof candidate !== 'function') {
    return null;
  }

  const candidateCtor = candidate as {
    prototype?: {
      judge?: unknown;
    };
  };

  const isClassLike = typeof candidateCtor.prototype?.judge === 'function';
  if (isClassLike) {
    try {
      const instance = new (candidate as new (context: JudgerAdapterFactoryContext) => unknown)(context);
      if (isSkillJudgerPort(instance)) {
        return instance;
      }
    } catch (error) {
      if (String((error as Error).message).toLowerCase().includes('is not a constructor')) {
        // fall through to factory-style resolution
      } else {
        throw error;
      }
    }
  }

  const created = await Promise.resolve((candidate as (context: JudgerAdapterFactoryContext) => unknown)(context));
  if (isSkillJudgerPort(created)) {
    return created;
  }

  if (created && typeof created === 'object' && isSkillJudgerPort(created)) {
    return created;
  }

  return null;
}

function required(value: string | null, name: string, provider: string): string {
  if (!value) {
    throw new ValidationError(`JUDGER_PROVIDER=${provider} requires ${name}`);
  }

  return value;
}

function isSkillJudgerPort(value: unknown): value is SkillJudgerPort {
  return typeof value === 'object' && value !== null && typeof (value as SkillJudgerPort).judge === 'function';
}
