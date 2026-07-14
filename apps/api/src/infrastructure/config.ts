import path from 'path';
import { promises as fs } from 'fs';
import { ConfigurationError } from '../domain/errors';

export type JudgerProvider = string;
export type CatalogProvider = 'sqlite' | 'mysql';
export type SearchProvider = 'sqlite' | 'mysql';
export type ContentStorageProvider = 'filesystem' | 'database';
export type AgentAuthMode = 'none' | 'bearer' | 'oidc';
export type AdminAuthMode = 'simple' | 'oidc';
export type OidcAccessPolicy = 'all_authenticated_users' | 'required_groups';
export type OidcAccessTokenValidationMode = 'jwt_profile' | 'authentik_introspection';
export type PublishJudgementPolicy = 'disabled' | 'warn' | 'required';
type MySqlSslMode = 'preferred' | 'required' | 'disabled' | 'verify_ca' | 'verify_identity';

export interface AppConfig {
  dataDir: string;
  openapiYamlPath: string;
  registryId: string;
  registryName: string;
  publicApiBaseUrl: string;
  corsAllowedOrigins: string[];
  adminCsrfOriginCheck: boolean;
  adminUiBasePath: string;
  apiHost: string;
  apiPort: number;
  apiTrustedProxies: string[];
  adminAuthMode: AdminAuthMode;
  adminUser: string;
  adminPassword: string | null;
  adminPasswordHash: string;
  jwtSecret: string;
  sessionTtlSeconds: number;
  adminLoginRateLimitWindowMs: number;
  adminLoginRateLimitMaxRequests: number;
  adminLoginRateLimitMaxBuckets: number;
  judgerProvider: JudgerProvider;
  judgerAdapterPath: string | null;
  vercelAiSdkModel: string | null;
  vercelAiSdkTimeoutMs: number;
  vercelAiSdkMaxTextChars: number;
  vercelAiSdkMaxRetries: number;
  catalogProvider: CatalogProvider;
  searchProvider: SearchProvider;
  contentStorageProvider: ContentStorageProvider;
  mysqlHost: string;
  mysqlPort: number;
  mysqlDatabase: string;
  mysqlUser: string;
  mysqlPassword: string;
  mysqlSslMode: MySqlSslMode;
  mysqlConnectTimeoutMs: number;
  mysqlQueryTimeoutMs: number;
  proposalMaxFiles: number;
  proposalMaxFileSizeBytes: number;
  proposalDisallowedPaths: string[];
  proposalRateLimitWindowMs: number;
  proposalRateLimitMaxRequests: number;
  proposalRateLimitMaxBuckets: number;
  allowOpenProposalsInProduction: boolean;
  autoPublishOnGreen: boolean;
  autoPublishExcludedCategories: string[];
  autoApproveWithoutJudger: boolean;
  publishJudgementPolicy: PublishJudgementPolicy;
  publicReadAuthMode: AgentAuthMode;
  publicReadBearerToken: string | null;
  publicReadBearerActor: string;
  proposalAuthMode: AgentAuthMode;
  proposalBearerToken: string | null;
  proposalBearerActor: string;
  discoveryAuthMode: AgentAuthMode;
  discoveryBearerToken: string | null;
  discoveryBearerActor: string;
  oidcAgentIssuer: string | null;
  oidcAgentClientId: string | null;
  oidcAgentBaseScopes: string[];
  oidcDiscoveryScope: string | null;
  oidcPublicReadScope: string | null;
  oidcProposalScope: string | null;
  oidcAdminIssuer: string | null;
  oidcAdminClientId: string | null;
  oidcAdminClientSecret: string | null;
  oidcAdminRedirectUri: string | null;
  oidcAdminScopes: string[];
  oidcProposalAccess: OidcAccessPolicy;
  oidcProposalGroups: string[];
  oidcPublicReadAccess: OidcAccessPolicy;
  oidcPublicReadGroups: string[];
  oidcAdminSubjects: string[];
  oidcAdminGroups: string[];
  oidcReviewerGroups: string[];
  oidcPublisherGroups: string[];
  oidcLoginTransactionTtlSeconds: number;
  oidcClockToleranceSeconds: number;
  oidcJwksCacheTtlSeconds: number;
  oidcHttpTimeoutMs: number;
  oidcMaxTokenBytes: number;
  oidcMaxGroups: number;
  oidcHumanClaim: string;
  oidcAccessTokenValidationMode: OidcAccessTokenValidationMode;
  oidcIntrospectionClientId: string | null;
  oidcIntrospectionClientSecret: string | null;
  agentSessionEnabled: boolean;
  agentSessionTtlSeconds: number;
  agentSessionCodeLength: number;
  agentSessionCodeCharset: string;
  agentSessionMaxActive: number | null;
}

export function loadConfig(): AppConfig {
  loadEnvFiles();

  const rawDataDir = process.env.DATA_DIR ?? './data';
  const catalogProvider = parseCatalogProvider(process.env.CATALOG_PROVIDER);
  const searchProvider = parseSearchProvider(process.env.SEARCH_PROVIDER);
  const contentStorageProvider = parseContentStorageProvider(process.env.CONTENT_STORAGE_PROVIDER);
  const mysqlHostEnv = process.env.MYSQL_HOST;
  const mysqlPortEnv = process.env.MYSQL_PORT;
  const mysqlDatabaseEnv = process.env.MYSQL_DATABASE;
  const mysqlUserEnv = process.env.MYSQL_USER;
  const mysqlPassword = valueOrDefault(process.env.MYSQL_PASSWORD, '');
  const usingMysqlProvider = catalogProvider === 'mysql' || searchProvider === 'mysql';

  validateMySqlConfiguration({
    catalogProvider,
    searchProvider,
    mysqlHost: mysqlHostEnv,
    mysqlPort: mysqlPortEnv,
    mysqlDatabase: mysqlDatabaseEnv,
    mysqlUser: mysqlUserEnv,
  });

  const mysqlHost = usingMysqlProvider
    ? parseRequiredString(mysqlHostEnv, 'MySQL provider selected, but MYSQL_HOST is missing.')
    : valueOrDefault(mysqlHostEnv, '127.0.0.1');
  const mysqlPort = usingMysqlProvider
    ? parsePositiveInteger(mysqlPortEnv, 3306, 'MYSQL_PORT', false)
    : parsePositiveInteger(mysqlPortEnv, 3306, 'MYSQL_PORT', true, true);
  const mysqlDatabase = usingMysqlProvider
    ? parseRequiredString(
      mysqlDatabaseEnv,
      'MySQL provider selected, but MYSQL_DATABASE is missing.'
    )
    : valueOrDefault(mysqlDatabaseEnv, 'managed_skill_hub');
  const mysqlUser = usingMysqlProvider
    ? parseRequiredString(mysqlUserEnv, 'MySQL provider selected, but MYSQL_USER is missing.')
    : valueOrDefault(mysqlUserEnv, 'managed_skill_hub');
  const mysqlSslMode = parseMySqlSslMode(process.env.MYSQL_SSL_MODE);
  const mysqlConnectTimeoutMs = parsePositiveInteger(process.env.MYSQL_CONNECT_TIMEOUT_MS, 10000, 'MYSQL_CONNECT_TIMEOUT_MS');
  const mysqlQueryTimeoutMs = parsePositiveInteger(process.env.MYSQL_QUERY_TIMEOUT_MS, 30000, 'MYSQL_QUERY_TIMEOUT_MS');

  const repoRoot = resolveRepoRoot();
  const config: AppConfig = {
    dataDir: resolveDataDir(rawDataDir),
    openapiYamlPath: path.resolve(repoRoot, 'packages/openapi/skill-registry.openapi.yaml'),
    registryId: valueOrDefault(process.env.REGISTRY_ID, 'local'),
    registryName: valueOrDefault(process.env.REGISTRY_NAME, 'ManagedSkillHub Local'),
    publicApiBaseUrl: normalizePublicApiBaseUrl(
      valueOrDefault(process.env.PUBLIC_API_BASE_URL, `http://localhost:${process.env.API_PORT ?? 3040}`)
    ),
    corsAllowedOrigins: parseCsvList(
      process.env.CORS_ALLOWED_ORIGINS,
      ['http://localhost:3041', 'http://127.0.0.1:3041']
    ),
    adminCsrfOriginCheck: parseBoolean(
      process.env.ADMIN_CSRF_ORIGIN_CHECK,
      true,
      'ADMIN_CSRF_ORIGIN_CHECK'
    ),
    adminUiBasePath: parseAdminUiBasePath(process.env.ADMIN_UI_BASE_PATH),
    apiHost: process.env.API_HOST ?? '127.0.0.1',
    apiPort: Number(process.env.API_PORT ?? 3040),
    apiTrustedProxies: parseCsvList(process.env.API_TRUSTED_PROXIES, []),
    adminAuthMode: parseAdminAuthMode(process.env.ADMIN_AUTH_MODE),
    adminUser: process.env.ADMIN_USER ?? 'admin',
    adminPassword: valueOrNull(process.env.ADMIN_PASSWORD),
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? '',
    jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
    sessionTtlSeconds: parseBoundedInteger(
      process.env.SESSION_TTL_SECONDS,
      86_400,
      'SESSION_TTL_SECONDS',
      300,
      604_800
    ),
    agentSessionEnabled: parseBoolean(process.env.AGENT_SESSION_ENABLED, true, 'AGENT_SESSION_ENABLED'),
    agentSessionTtlSeconds: parsePositiveInteger(
      process.env.AGENT_SESSION_TTL_SECONDS,
      3 * 3600,
      'AGENT_SESSION_TTL_SECONDS'
    ),
    agentSessionCodeLength: parseBoundedInteger(
      process.env.AGENT_SESSION_CODE_LENGTH,
      8,
      'AGENT_SESSION_CODE_LENGTH',
      4,
      32
    ),
    agentSessionCodeCharset: parseAgentSessionCodeCharset(process.env.AGENT_SESSION_CODE_CHARSET),
    agentSessionMaxActive: parseNullablePositiveInteger(
      process.env.AGENT_SESSION_MAX_ACTIVE,
      10,
      'AGENT_SESSION_MAX_ACTIVE'
    ),
    adminLoginRateLimitWindowMs: parseBoundedInteger(
      process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS,
      300_000,
      'ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS',
      10_000,
      3_600_000
    ),
    adminLoginRateLimitMaxRequests: parseBoundedInteger(
      process.env.ADMIN_LOGIN_RATE_LIMIT_MAX_REQUESTS,
      10,
      'ADMIN_LOGIN_RATE_LIMIT_MAX_REQUESTS',
      1,
      1_000
    ),
    adminLoginRateLimitMaxBuckets: parseBoundedInteger(
      process.env.ADMIN_LOGIN_RATE_LIMIT_MAX_BUCKETS,
      10_000,
      'ADMIN_LOGIN_RATE_LIMIT_MAX_BUCKETS',
      100,
      100_000
    ),
    judgerProvider: parseJudgerProvider(process.env.JUDGER_PROVIDER),
    judgerAdapterPath: valueOrNull(process.env.JUDGER_ADAPTER_PATH),
    vercelAiSdkModel: valueOrNull(process.env.VERCEL_AI_SDK_MODEL),
    vercelAiSdkTimeoutMs: Number(process.env.VERCEL_AI_SDK_TIMEOUT_MS ?? 30000),
    vercelAiSdkMaxTextChars: Number(process.env.VERCEL_AI_SDK_MAX_TEXT_CHARS ?? 12000),
    vercelAiSdkMaxRetries: Number(process.env.VERCEL_AI_SDK_MAX_RETRIES ?? 0),
    catalogProvider,
    searchProvider,
    contentStorageProvider,
    mysqlHost,
    mysqlPort,
    mysqlDatabase,
    mysqlUser,
    mysqlPassword,
    mysqlSslMode,
    mysqlConnectTimeoutMs,
    mysqlQueryTimeoutMs,
    proposalMaxFiles: parsePositiveInteger(process.env.PROPOSAL_MAX_FILES, 30, 'PROPOSAL_MAX_FILES'),
    proposalMaxFileSizeBytes: parsePositiveInteger(
      process.env.PROPOSAL_MAX_FILE_SIZE_BYTES,
      10 * 1024 * 1024,
      'PROPOSAL_MAX_FILE_SIZE_BYTES'
    ),
    proposalDisallowedPaths: parseCsvList(
      process.env.PROPOSAL_DISALLOWED_PATHS,
      ['node_modules/', '.venv/', 'venv/', 'vendor/', 'dist-packages/', 'site-packages/']
    ),
    proposalRateLimitWindowMs: parsePositiveInteger(
      process.env.PROPOSAL_RATE_LIMIT_WINDOW_MS,
      60_000,
      'PROPOSAL_RATE_LIMIT_WINDOW_MS'
    ),
    proposalRateLimitMaxRequests: parsePositiveInteger(
      process.env.PROPOSAL_RATE_LIMIT_MAX_REQUESTS,
      120,
      'PROPOSAL_RATE_LIMIT_MAX_REQUESTS'
    ),
    proposalRateLimitMaxBuckets: parsePositiveInteger(
      process.env.PROPOSAL_RATE_LIMIT_MAX_BUCKETS,
      10_000,
      'PROPOSAL_RATE_LIMIT_MAX_BUCKETS'
    ),
    allowOpenProposalsInProduction: parseBoolean(
      process.env.ALLOW_OPEN_PROPOSALS_IN_PRODUCTION,
      false,
      'ALLOW_OPEN_PROPOSALS_IN_PRODUCTION'
    ),
    autoPublishOnGreen: parseBoolean(process.env.AUTO_PUBLISH_ON_GREEN, false, 'AUTO_PUBLISH_ON_GREEN'),
    publishJudgementPolicy: parsePublishJudgementPolicy(process.env.PUBLISH_JUDGEMENT_POLICY),
    autoPublishExcludedCategories: parseCsvList(
      process.env.AUTO_PUBLISH_EXCLUDED_CATEGORIES,
      ['security', 'automation', 'filesystem', 'network']
    ),
    autoApproveWithoutJudger: parseBoolean(
      process.env.AUTO_APPROVE_WITHOUT_JUDGER,
      false,
      'AUTO_APPROVE_WITHOUT_JUDGER'
    ),
    publicReadAuthMode: parseAgentAuthMode(process.env.PUBLIC_READ_AUTH_MODE, 'PUBLIC_READ_AUTH_MODE'),
    publicReadBearerToken: parseBearerToken(
      process.env.PUBLIC_READ_AUTH_MODE,
      process.env.PUBLIC_READ_BEARER_TOKEN,
      'PUBLIC_READ_BEARER_TOKEN'
    ),
    publicReadBearerActor: valueOrDefault(process.env.PUBLIC_READ_BEARER_ACTOR, 'agent-read-token'),
    proposalAuthMode: parseAgentAuthMode(process.env.PROPOSAL_AUTH_MODE, 'PROPOSAL_AUTH_MODE'),
    proposalBearerToken: parseBearerToken(
      process.env.PROPOSAL_AUTH_MODE,
      process.env.PROPOSAL_BEARER_TOKEN,
      'PROPOSAL_BEARER_TOKEN'
    ),
    proposalBearerActor: valueOrDefault(process.env.PROPOSAL_BEARER_ACTOR, 'agent-proposal-token'),
    discoveryAuthMode: parseAgentAuthMode(process.env.DISCOVERY_AUTH_MODE, 'DISCOVERY_AUTH_MODE'),
    discoveryBearerToken: parseBearerToken(
      process.env.DISCOVERY_AUTH_MODE,
      process.env.DISCOVERY_BEARER_TOKEN,
      'DISCOVERY_BEARER_TOKEN'
    ),
    discoveryBearerActor: valueOrDefault(process.env.DISCOVERY_BEARER_ACTOR, 'agent-discovery-token'),
    oidcAgentIssuer: valueOrNull(process.env.OIDC_AGENT_ISSUER),
    oidcAgentClientId: valueOrNull(process.env.OIDC_AGENT_CLIENT_ID),
    oidcAgentBaseScopes: parseCsvList(process.env.OIDC_AGENT_BASE_SCOPES, ['openid', 'profile', 'email']),
    oidcDiscoveryScope: valueOrNull(process.env.OIDC_DISCOVERY_SCOPE),
    oidcPublicReadScope: valueOrNull(process.env.OIDC_PUBLIC_READ_SCOPE),
    oidcProposalScope: valueOrNull(process.env.OIDC_PROPOSAL_SCOPE),
    oidcAdminIssuer: valueOrNull(process.env.OIDC_ADMIN_ISSUER),
    oidcAdminClientId: valueOrNull(process.env.OIDC_ADMIN_CLIENT_ID),
    oidcAdminClientSecret: valueOrNull(process.env.OIDC_ADMIN_CLIENT_SECRET),
    oidcAdminRedirectUri: valueOrNull(process.env.OIDC_ADMIN_REDIRECT_URI),
    oidcAdminScopes: parseCsvList(process.env.OIDC_ADMIN_SCOPES, ['openid', 'profile', 'email']),
    oidcProposalAccess: parseOidcAccessPolicy(process.env.OIDC_PROPOSAL_ACCESS, 'OIDC_PROPOSAL_ACCESS'),
    oidcProposalGroups: parseCsvList(process.env.OIDC_PROPOSAL_GROUPS, ['managedskillhub-submitters']),
    oidcPublicReadAccess: parseOidcAccessPolicy(process.env.OIDC_PUBLIC_READ_ACCESS, 'OIDC_PUBLIC_READ_ACCESS'),
    oidcPublicReadGroups: parseCsvList(process.env.OIDC_PUBLIC_READ_GROUPS, ['managedskillhub-readers']),
    oidcAdminSubjects: parseCsvList(process.env.OIDC_ADMIN_SUBJECTS, []),
    oidcAdminGroups: parseCsvList(process.env.OIDC_ADMIN_GROUPS, ['managedskillhub-admins']),
    oidcReviewerGroups: parseCsvList(process.env.OIDC_REVIEWER_GROUPS, ['managedskillhub-reviewers']),
    oidcPublisherGroups: parseCsvList(process.env.OIDC_PUBLISHER_GROUPS, ['managedskillhub-publishers']),
    oidcLoginTransactionTtlSeconds: parseBoundedInteger(
      process.env.OIDC_LOGIN_TRANSACTION_TTL_SECONDS,
      600,
      'OIDC_LOGIN_TRANSACTION_TTL_SECONDS',
      60,
      900
    ),
    oidcClockToleranceSeconds: parseBoundedInteger(
      process.env.OIDC_CLOCK_TOLERANCE_SECONDS,
      30,
      'OIDC_CLOCK_TOLERANCE_SECONDS',
      0,
      300
    ),
    oidcJwksCacheTtlSeconds: parseBoundedInteger(
      process.env.OIDC_JWKS_CACHE_TTL_SECONDS,
      3600,
      'OIDC_JWKS_CACHE_TTL_SECONDS',
      60,
      86_400
    ),
    oidcHttpTimeoutMs: parseBoundedInteger(
      process.env.OIDC_HTTP_TIMEOUT_MS,
      5000,
      'OIDC_HTTP_TIMEOUT_MS',
      250,
      30_000
    ),
    oidcMaxTokenBytes: parseBoundedInteger(
      process.env.OIDC_MAX_TOKEN_BYTES,
      16_384,
      'OIDC_MAX_TOKEN_BYTES',
      1024,
      65_536
    ),
    oidcMaxGroups: parseBoundedInteger(process.env.OIDC_MAX_GROUPS, 100, 'OIDC_MAX_GROUPS', 1, 500),
    oidcHumanClaim: valueOrDefault(process.env.OIDC_HUMAN_CLAIM, 'managedskillhub_human'),
    oidcAccessTokenValidationMode: parseOidcAccessTokenValidationMode(
      process.env.OIDC_ACCESS_TOKEN_VALIDATION_MODE
    ),
    oidcIntrospectionClientId: valueOrNull(process.env.OIDC_INTROSPECTION_CLIENT_ID),
    oidcIntrospectionClientSecret: valueOrNull(process.env.OIDC_INTROSPECTION_CLIENT_SECRET),
  };

  validateOidcConfiguration(config);
  validateProductionSecurityConfig(config);
  return config;
}


export function resolveRepoRoot(): string {
  // __dirname is apps/api/dist/infrastructure after build or apps/api/src/infrastructure via tsx.
  // The repository root is two levels above apps/api.
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export function resolveDataDir(rawDataDir: string): string {
  const trimmed = rawDataDir.trim();
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  // Resolve relative paths against the repository root so that npm run dev,
  // node dist/server.js and custom start scripts all see the same data directory.
  return path.resolve(resolveRepoRoot(), trimmed);
}

export async function validateDataDir(dataDir: string): Promise<void> {
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error) {
    const message = (error as Error).message;
    throw new ConfigurationError(
      `DATA_DIR is not writable: ${dataDir}. Set DATA_DIR to an existing, writable directory. Original error: ${message}`
    );
  }

  const probe = path.join(dataDir, '.write-probe-' + Date.now());
  try {
    await fs.writeFile(probe, '');
    await fs.unlink(probe);
  } catch (error) {
    const message = (error as Error).message;
    throw new ConfigurationError(
      `DATA_DIR is not writable: ${dataDir}. Set DATA_DIR to an existing, writable directory. Original error: ${message}`
    );
  }
}

function loadEnvFiles(): void {
  const appRoot = path.resolve(__dirname, '..', '..');
  const repoRoot = path.resolve(appRoot, '..', '..');
  // loadEnvFile preserves exported process values. Secrets load first so the
  // lower-priority config file cannot replace them with blank placeholders.
  for (const filename of ['.env.secrets', '.env']) {
    try {
      process.loadEnvFile(path.join(repoRoot, filename));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

function valueOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseJudgerProvider(value: string | undefined): JudgerProvider {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new ConfigurationError(
      'JUDGER_PROVIDER is required. Built-ins are `noop` and `vercel-ai-sdk`. '
      + 'Custom providers are allowed when JUDGER_ADAPTER_PATH points to a module implementing SkillJudgerPort.'
    );
  }

  return trimmed;
}

export function parsePublishJudgementPolicy(value: string | undefined): PublishJudgementPolicy {
  const normalized = value?.trim().toLowerCase()
    || (process.env.NODE_ENV === 'production' ? 'required' : 'warn');
  if (normalized === 'disabled' || normalized === 'warn' || normalized === 'required') {
    return normalized;
  }
  throw new ConfigurationError(
    `PUBLISH_JUDGEMENT_POLICY must be disabled, warn, or required. Received: ${normalized}.`
  );
}

export function parseCatalogProvider(value: string | undefined): CatalogProvider {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 'sqlite';
  }

  if (trimmed === 'sqlite' || trimmed === 'mysql') {
    return trimmed;
  }

  throw new ConfigurationError(`CATALOG_PROVIDER must be sqlite or mysql. Received: ${trimmed}.`);
}

export function parseSearchProvider(value: string | undefined): SearchProvider {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 'sqlite';
  }

  if (trimmed === 'sqlite' || trimmed === 'mysql') {
    return trimmed;
  }

  throw new ConfigurationError(`SEARCH_PROVIDER must be sqlite or mysql. Received: ${trimmed}.`);
}

export function parseAgentAuthMode(value: string | undefined, name: string): AgentAuthMode {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 'none';
  }
  if (trimmed === 'none' || trimmed === 'bearer' || trimmed === 'oidc') {
    return trimmed;
  }
  throw new ConfigurationError(`${name} must be none, bearer, or oidc. Received: ${trimmed}.`);
}

export function parseAdminAuthMode(value: string | undefined): AdminAuthMode {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 'simple';
  }
  if (trimmed === 'simple' || trimmed === 'oidc') {
    return trimmed;
  }
  throw new ConfigurationError(`ADMIN_AUTH_MODE must be simple or oidc. Received: ${trimmed}.`);
}

export function parseOidcAccessPolicy(
  value: string | undefined,
  name: string
): OidcAccessPolicy {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 'all_authenticated_users';
  }
  if (trimmed === 'all_authenticated_users' || trimmed === 'required_groups') {
    return trimmed;
  }
  throw new ConfigurationError(
    `${name} must be all_authenticated_users or required_groups. Received: ${trimmed}.`
  );
}

function parseBearerToken(
  rawMode: string | undefined,
  value: string | undefined,
  name: string
): string | null {
  const modeName = name.replace('_BEARER_TOKEN', '_AUTH_MODE');
  const mode = parseAgentAuthMode(rawMode, modeName);
  const token = valueOrNull(value);
  if (mode === 'bearer' && !token) {
    throw new ConfigurationError(`${name} is required when ${modeName}=bearer.`);
  }
  return token;
}

export function parseOidcAccessTokenValidationMode(
  value: string | undefined
): OidcAccessTokenValidationMode {
  const normalized = value?.trim() || 'jwt_profile';
  if (normalized === 'jwt_profile' || normalized === 'authentik_introspection') {
    return normalized;
  }
  throw new ConfigurationError(
    'OIDC_ACCESS_TOKEN_VALIDATION_MODE must be jwt_profile or authentik_introspection.'
  );
}

function normalizePublicApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'http://localhost:3040';
  }
  return trimmed.replace(/\/+$/, '');
}

function validateProductionSecurityConfig(config: AppConfig): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (
    (config.judgerProvider === 'noop' || config.judgerProvider === 'vercel-ai-sdk')
    && config.judgerAdapterPath
  ) {
    throw new ConfigurationError(
      'JUDGER_ADAPTER_PATH must be empty for built-in JUDGER_PROVIDER values in production.'
    );
  }

  if (
    config.adminAuthMode === 'simple'
    && (config.jwtSecret === 'change-me-in-production' || config.jwtSecret.length < 32)
  ) {
    throw new ConfigurationError(
      'JWT_SECRET must be changed and at least 32 characters long when NODE_ENV=production.'
    );
  }

  if (config.adminAuthMode === 'simple' && config.adminPassword) {
    throw new ConfigurationError(
      'ADMIN_PASSWORD is not allowed when NODE_ENV=production. Use ADMIN_PASSWORD_HASH instead.'
    );
  }

  if (config.adminAuthMode === 'simple' && !config.adminPasswordHash) {
    throw new ConfigurationError(
      'ADMIN_PASSWORD_HASH is required when NODE_ENV=production.'
    );
  }

  if (config.corsAllowedOrigins.includes('*')) {
    throw new ConfigurationError(
      'CORS_ALLOWED_ORIGINS must not contain * when NODE_ENV=production.'
    );
  }

  if (config.proposalAuthMode === 'none' && !config.allowOpenProposalsInProduction) {
    throw new ConfigurationError(
      'PROPOSAL_AUTH_MODE=bearer or oidc is required when NODE_ENV=production. Set ALLOW_OPEN_PROPOSALS_IN_PRODUCTION=true only for explicitly open internal deployments.'
    );
  }

  if (
    config.adminAuthMode === 'oidc'
    && (
      !config.oidcAdminClientSecret
      || Buffer.byteLength(config.oidcAdminClientSecret, 'utf8') < 32
      || isExampleSecret(config.oidcAdminClientSecret)
    )
  ) {
    throw new ConfigurationError(
      'OIDC_ADMIN_CLIENT_SECRET must contain at least 32 bytes and must not use an example value when NODE_ENV=production.'
    );
  }

  if (
    config.oidcAccessTokenValidationMode === 'authentik_introspection'
    && [config.discoveryAuthMode, config.publicReadAuthMode, config.proposalAuthMode].includes('oidc')
    && (
      !config.oidcIntrospectionClientSecret
      || Buffer.byteLength(config.oidcIntrospectionClientSecret, 'utf8') < 32
      || isExampleSecret(config.oidcIntrospectionClientSecret)
    )
  ) {
    throw new ConfigurationError(
      'OIDC_INTROSPECTION_CLIENT_SECRET must contain at least 32 bytes and must not use an example value when NODE_ENV=production.'
    );
  }

  for (const [name, mode, token] of [
    ['PUBLIC_READ_BEARER_TOKEN', config.publicReadAuthMode, config.publicReadBearerToken],
    ['PROPOSAL_BEARER_TOKEN', config.proposalAuthMode, config.proposalBearerToken],
    ['DISCOVERY_BEARER_TOKEN', config.discoveryAuthMode, config.discoveryBearerToken],
  ] as const) {
    if (mode === 'bearer' && (!token || Buffer.byteLength(token, 'utf8') < 32 || isExampleSecret(token))) {
      throw new ConfigurationError(
        `${name} must contain at least 32 random bytes and must not use an example value when NODE_ENV=production.`
      );
    }
  }
}

function validateOidcConfiguration(config: AppConfig): void {
  const oidcAreas: Array<{ mode: AgentAuthMode; name: string; scope: string | null }> = [
    { mode: config.discoveryAuthMode, name: 'DISCOVERY_AUTH_MODE', scope: config.oidcDiscoveryScope },
    { mode: config.publicReadAuthMode, name: 'PUBLIC_READ_AUTH_MODE', scope: config.oidcPublicReadScope },
    { mode: config.proposalAuthMode, name: 'PROPOSAL_AUTH_MODE', scope: config.oidcProposalScope },
  ];
  const enabledAgentAreas = oidcAreas.filter((area) => area.mode === 'oidc');

  if (enabledAgentAreas.length > 0) {
    requireOidcValue(config.oidcAgentIssuer, 'OIDC_AGENT_ISSUER', enabledAgentAreas[0].name);
    requireOidcValue(config.oidcAgentClientId, 'OIDC_AGENT_CLIENT_ID', enabledAgentAreas[0].name);
    validateTrustedOidcUrl(config.oidcAgentIssuer!, 'OIDC_AGENT_ISSUER');
    if (!config.oidcAgentBaseScopes.includes('openid')) {
      throw new ConfigurationError('OIDC_AGENT_BASE_SCOPES must include openid when an agent area uses oidc.');
    }
    for (const area of enabledAgentAreas) {
      requireOidcValue(area.scope, oidcScopeName(area.name), area.name);
    }
    if (config.oidcAccessTokenValidationMode === 'authentik_introspection') {
      requireOidcValue(
        config.oidcIntrospectionClientId,
        'OIDC_INTROSPECTION_CLIENT_ID',
        'OIDC_ACCESS_TOKEN_VALIDATION_MODE'
      );
      requireOidcValue(
        config.oidcIntrospectionClientSecret,
        'OIDC_INTROSPECTION_CLIENT_SECRET',
        'OIDC_ACCESS_TOKEN_VALIDATION_MODE'
      );
    }
  }

  if (config.oidcProposalAccess === 'required_groups' && config.oidcProposalGroups.length === 0) {
    throw new ConfigurationError('OIDC_PROPOSAL_GROUPS is required when OIDC_PROPOSAL_ACCESS=required_groups.');
  }
  if (config.oidcPublicReadAccess === 'required_groups' && config.oidcPublicReadGroups.length === 0) {
    throw new ConfigurationError(
      'OIDC_PUBLIC_READ_GROUPS is required when OIDC_PUBLIC_READ_ACCESS=required_groups.'
    );
  }

  if (config.adminAuthMode === 'oidc') {
    requireOidcValue(config.oidcAdminIssuer, 'OIDC_ADMIN_ISSUER', 'ADMIN_AUTH_MODE');
    requireOidcValue(config.oidcAdminClientId, 'OIDC_ADMIN_CLIENT_ID', 'ADMIN_AUTH_MODE');
    requireOidcValue(config.oidcAdminClientSecret, 'OIDC_ADMIN_CLIENT_SECRET', 'ADMIN_AUTH_MODE');
    requireOidcValue(config.oidcAdminRedirectUri, 'OIDC_ADMIN_REDIRECT_URI', 'ADMIN_AUTH_MODE');
    validateTrustedOidcUrl(config.oidcAdminIssuer!, 'OIDC_ADMIN_ISSUER');
    validateTrustedOidcUrl(config.oidcAdminRedirectUri!, 'OIDC_ADMIN_REDIRECT_URI');
    if (!config.oidcAdminScopes.includes('openid')) {
      throw new ConfigurationError('OIDC_ADMIN_SCOPES must include openid when ADMIN_AUTH_MODE=oidc.');
    }
    if (config.oidcAdminSubjects.length === 0 && config.oidcAdminGroups.length === 0) {
      throw new ConfigurationError(
        'ADMIN_AUTH_MODE=oidc requires OIDC_ADMIN_SUBJECTS or OIDC_ADMIN_GROUPS.'
      );
    }
    if (hasExplicitSimpleAdminCredentials()) {
      throw new ConfigurationError(
        'ADMIN_USER, ADMIN_PASSWORD, and ADMIN_PASSWORD_HASH must be absent when ADMIN_AUTH_MODE=oidc; implicit simple-admin fallback is not allowed.'
      );
    }
  }
}

function requireOidcValue(value: string | null, name: string, selector: string): void {
  if (!value) {
    throw new ConfigurationError(`${name} is required when ${selector}=oidc.`);
  }
}

function oidcScopeName(authModeName: string): string {
  switch (authModeName) {
    case 'DISCOVERY_AUTH_MODE':
      return 'OIDC_DISCOVERY_SCOPE';
    case 'PUBLIC_READ_AUTH_MODE':
      return 'OIDC_PUBLIC_READ_SCOPE';
    default:
      return 'OIDC_PROPOSAL_SCOPE';
  }
}

function validateTrustedOidcUrl(value: string, name: string): void {
  if (Buffer.byteLength(value, 'utf8') > 1024) {
    throw new ConfigurationError(`${name} must not exceed 1024 UTF-8 bytes.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(`${name} must be an absolute HTTPS URL.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ConfigurationError(`${name} must not contain credentials, a query string, or a fragment.`);
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost(parsed.hostname))) {
    throw new ConfigurationError(`${name} must use HTTPS outside explicit localhost development.`);
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function hasExplicitSimpleAdminCredentials(): boolean {
  return ['ADMIN_USER', 'ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH'].some((name) => {
    const value = process.env[name];
    return value !== undefined && value.trim().length > 0;
  });
}

function isExampleSecret(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized.includes('replace-with')
    || normalized.includes('change-me')
    || normalized.includes('example');
}

function parseMySqlSslMode(value: string | undefined): MySqlSslMode {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 'preferred';
  }

  if (trimmed === 'preferred' || trimmed === 'required' || trimmed === 'disabled' || trimmed === 'verify_ca' || trimmed === 'verify_identity') {
    return trimmed;
  }

  throw new ConfigurationError(`MYSQL_SSL_MODE must be one of: preferred, required, disabled, verify_ca, verify_identity.`);
}

function parseNullablePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number | null {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'none' || trimmed === 'null' || trimmed === 'unlimited') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigurationError(`${name} must be a positive integer, none, null, or unlimited.`);
  }
  return parsed;
}

function parseAgentSessionCodeCharset(value: string | undefined): string {
  const charset = valueOrDefault(value, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  if (charset.length < 16) {
    throw new ConfigurationError('AGENT_SESSION_CODE_CHARSET must contain at least 16 characters.');
  }
  if (new Set(charset).size !== charset.length) {
    throw new ConfigurationError('AGENT_SESSION_CODE_CHARSET must not contain duplicate characters.');
  }
  if (/[^A-Za-z0-9]/.test(charset)) {
    throw new ConfigurationError('AGENT_SESSION_CODE_CHARSET must be alphanumeric only.');
  }
  return charset.toUpperCase();
}

function valueOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function validateMySqlConfiguration(params: {
  catalogProvider: CatalogProvider;
  searchProvider: SearchProvider;
  mysqlHost?: string;
  mysqlPort?: string;
  mysqlDatabase?: string;
  mysqlUser?: string;
}): void {
  const usingMySql = params.catalogProvider === 'mysql' || params.searchProvider === 'mysql';
  if (!usingMySql) {
    return;
  }

  if (!params.mysqlHost || params.mysqlHost.trim().length === 0) {
    throw new ConfigurationError('MySQL provider selected, but MYSQL_HOST is missing.');
  }
  if (!params.mysqlPort || params.mysqlPort.trim().length === 0) {
    throw new ConfigurationError('MySQL provider selected, but MYSQL_PORT is missing.');
  }
  const parsedMysqlPort = Number(params.mysqlPort);
  if (!Number.isInteger(parsedMysqlPort) || parsedMysqlPort <= 0) {
    throw new ConfigurationError('MySQL provider selected, but MYSQL_PORT must be a positive integer.');
  }
  if (!params.mysqlDatabase || params.mysqlDatabase.trim().length === 0) {
    throw new ConfigurationError('MySQL provider selected, but MYSQL_DATABASE is missing.');
  }
  if (!params.mysqlUser || params.mysqlUser.trim().length === 0) {
    throw new ConfigurationError('MySQL provider selected, but MYSQL_USER is missing.');
  }
}

function parseRequiredString(value: string | undefined, errorMessage: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new ConfigurationError(errorMessage);
  }
  return value.trim();
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  allowDefault = true,
  fallbackOnInvalid = false
): number {
  if (value === undefined || value.trim().length === 0) {
    if (allowDefault) {
      return fallback;
    }
    throw new ConfigurationError(`${name} is required.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    if (fallbackOnInvalid) {
      return fallback;
    }
    throw new ConfigurationError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number
): number {
  const parsed = value === undefined || value.trim().length === 0 ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  switch (value.trim().toLowerCase()) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      throw new ConfigurationError(`${name} must be true or false.`);
  }
}

function parseAdminUiBasePath(value: string | undefined): string {
  const path = valueOrDefault(value, '/frontend/admin');
  if (
    !path.startsWith('/')
    || path.startsWith('//')
    || path.includes('\\')
    || path.includes('?')
    || path.includes('#')
    || /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new ConfigurationError('ADMIN_UI_BASE_PATH must be a relative absolute-path without query or fragment.');
  }
  return path.replace(/\/+$/, '') || '/';
}

function parseCsvList(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
export function parseContentStorageProvider(value: string | undefined): ContentStorageProvider {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) {
    return 'filesystem';
  }
  if (normalized === 'filesystem' || normalized === 'database') {
    return normalized;
  }
  throw new ConfigurationError(
    `CONTENT_STORAGE_PROVIDER must be one of: filesystem, database. Received: ${value}`
  );
}
