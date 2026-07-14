import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../domain/errors';
import {
  loadConfig,
  parseAdminAuthMode,
  parseAgentAuthMode,
  parseCatalogProvider,
  parseContentStorageProvider,
  parseJudgerProvider,
  parseOidcAccessPolicy,
  parseOidcAccessTokenValidationMode,
  parseSearchProvider,
  resolveDataDir,
} from './config';

describe('resolveDataDir', () => {
  it('keeps absolute paths unchanged', () => {
    const absolute = '/tmp/managed-skill-hub/data';
    expect(resolveDataDir(absolute)).toBe(absolute);
  });

  it('resolves relative paths against the repository root', () => {
    const resolved = resolveDataDir('./data');
    expect(resolved.endsWith('/data')).toBe(true);
    expect(resolved.includes('apps/api')).toBe(false);
  });

  it('trims whitespace from the input', () => {
    const resolved = resolveDataDir('  ./data  ');
    expect(resolved.endsWith('/data')).toBe(true);
  });
});

describe('judger provider parsing', () => {
  it('requires explicit JUDGER_PROVIDER', () => {
    expect(() => parseJudgerProvider(undefined)).toThrow(ConfigurationError);
  });

  it('accepts supported providers', () => {
    expect(parseJudgerProvider('noop')).toBe('noop');
    expect(parseJudgerProvider('custom-judger')).toBe('custom-judger');
    expect(parseJudgerProvider('vercel-ai-sdk')).toBe('vercel-ai-sdk');
    expect(parseJudgerProvider('my-custom-judger')).toBe('my-custom-judger');
  });

  it('supports custom providers without validation, but loader still needs a path', () => {
    expect(parseJudgerProvider('my-custom-judger')).toBe('my-custom-judger');
  });
});

describe('catalog provider parsing', () => {
  it('defaults CATALOG_PROVIDER to sqlite', () => {
    expect(parseCatalogProvider(undefined)).toBe('sqlite');
    expect(parseCatalogProvider('')).toBe('sqlite');
  });

  it('accepts supported catalog providers', () => {
    expect(parseCatalogProvider('sqlite')).toBe('sqlite');
    expect(parseCatalogProvider('mysql')).toBe('mysql');
  });

  it('rejects unsupported catalog providers', () => {
    expect(() => parseCatalogProvider('postgres')).toThrow(ConfigurationError);
  });
});

describe('search provider parsing', () => {
  it('defaults SEARCH_PROVIDER to sqlite', () => {
    expect(parseSearchProvider(undefined)).toBe('sqlite');
    expect(parseSearchProvider('')).toBe('sqlite');
  });

  it('accepts supported search providers', () => {
    expect(parseSearchProvider('sqlite')).toBe('sqlite');
    expect(parseSearchProvider('mysql')).toBe('mysql');
  });

  it('rejects unsupported search providers', () => {
    expect(() => parseSearchProvider('postgres')).toThrow(ConfigurationError);
  });
});


describe('content storage provider parsing', () => {
  it('defaults CONTENT_STORAGE_PROVIDER to filesystem', () => {
    expect(parseContentStorageProvider(undefined)).toBe('filesystem');
    expect(parseContentStorageProvider('')).toBe('filesystem');
  });

  it('accepts supported content storage providers', () => {
    expect(parseContentStorageProvider('filesystem')).toBe('filesystem');
    expect(parseContentStorageProvider('database')).toBe('database');
  });

  it('rejects unsupported content storage providers', () => {
    expect(() => parseContentStorageProvider('object-storage')).toThrow(ConfigurationError);
  });

  it('loads configured CONTENT_STORAGE_PROVIDER', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('CONTENT_STORAGE_PROVIDER', 'database');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.contentStorageProvider).toBe('database');

    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});

describe('layered environment files', () => {
  it('loads secrets before non-secret config so exported values remain highest priority', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    const loadEnvFile = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    loadConfig();

    expect(loadEnvFile.mock.calls.map(([file]) => path.basename(String(file)))).toEqual([
      '.env.secrets',
      '.env',
    ]);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});

describe('mysql provider configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('supports mysql providers when required settings are valid', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('CATALOG_PROVIDER', 'mysql');
    vi.stubEnv('SEARCH_PROVIDER', 'mysql');
    vi.stubEnv('MYSQL_HOST', '127.0.0.1');
    vi.stubEnv('MYSQL_PORT', '3307');
    vi.stubEnv('MYSQL_DATABASE', 'managed_skill_hub');
    vi.stubEnv('MYSQL_USER', 'managed_skill_hub');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.catalogProvider).toBe('mysql');
    expect(config.searchProvider).toBe('mysql');
    expect(config.mysqlPort).toBe(3307);
  });

  it('rejects missing mandatory mysql settings when a mysql provider is selected', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('CATALOG_PROVIDER', 'mysql');
    vi.stubEnv('MYSQL_HOST', '');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(ConfigurationError);
  });

  it('rejects invalid MYSQL_PORT values only when mysql is selected', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('SEARCH_PROVIDER', 'mysql');
    vi.stubEnv('MYSQL_HOST', '127.0.0.1');
    vi.stubEnv('MYSQL_DATABASE', 'managed_skill_hub');
    vi.stubEnv('MYSQL_USER', 'managed_skill_hub');
    vi.stubEnv('MYSQL_PORT', '0');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(ConfigurationError);
  });

  it('falls back to defaults for MYSQL_PORT when mysql is not selected', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('MYSQL_PORT', 'not-a-number');
    vi.stubEnv('SEARCH_PROVIDER', 'sqlite');
    vi.stubEnv('CATALOG_PROVIDER', 'sqlite');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();
    expect(config.mysqlPort).toBe(3306);
  });

  it('keeps sqlite providers usable even when optional mysql env values are absent', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.unstubAllEnvs();
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();
    expect(config.catalogProvider).toBe('sqlite');
    expect(config.searchProvider).toBe('sqlite');
  });

  it('reads JUDGER_ADAPTER_PATH when present', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'my-custom-judger');
    vi.stubEnv('JUDGER_ADAPTER_PATH', './path/to/my.judger.ts');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.judgerAdapterPath).toBe('./path/to/my.judger.ts');
    expect(config.judgerProvider).toBe('my-custom-judger');
  });
});

describe('vercel ai sdk config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads configured VERCEL_AI_SDK_MAX_RETRIES', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('VERCEL_AI_SDK_MAX_RETRIES', '7');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();
    expect(config.vercelAiSdkMaxRetries).toBe(7);
  });

  it('defaults VERCEL_AI_SDK_MAX_RETRIES to 0', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();
    expect(config.vercelAiSdkMaxRetries).toBe(0);
  });

  it('reads proposal upload defaults and auto-publish defaults', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();
    expect(config.proposalMaxFiles).toBe(30);
    expect(config.proposalMaxFileSizeBytes).toBe(10 * 1024 * 1024);
    expect(config.proposalDisallowedPaths).toContain('node_modules/');
    expect(config.autoPublishOnGreen).toBe(false);
    expect(config.autoApproveWithoutJudger).toBe(false);
    expect(config.autoPublishExcludedCategories).toEqual(['security', 'automation', 'filesystem', 'network']);
  });

  it('reads configured proposal upload limits and auto-publish config', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('PROPOSAL_MAX_FILES', '12');
    vi.stubEnv('PROPOSAL_MAX_FILE_SIZE_BYTES', '4096');
    vi.stubEnv('PROPOSAL_DISALLOWED_PATHS', 'node_modules/,vendor/');
    vi.stubEnv('AUTO_PUBLISH_ON_GREEN', 'true');
    vi.stubEnv('AUTO_PUBLISH_EXCLUDED_CATEGORIES', 'security,network');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();
    expect(config.proposalMaxFiles).toBe(12);
    expect(config.proposalMaxFileSizeBytes).toBe(4096);
    expect(config.proposalDisallowedPaths).toEqual(['node_modules/', 'vendor/']);
    expect(config.autoPublishOnGreen).toBe(true);
    expect(config.autoApproveWithoutJudger).toBe(false);
    expect(config.autoPublishExcludedCategories).toEqual(['security', 'network']);
  });

  it('parses AUTO_APPROVE_WITHOUT_JUDGER', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('AUTO_APPROVE_WITHOUT_JUDGER', 'true');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.autoApproveWithoutJudger).toBe(true);
  });
});

describe('agent api auth config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('defaults agent-facing auth modes to none and exposes registry identity', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.registryId).toBe('local');
    expect(config.registryName).toBe('ManagedSkillHub Local');
    expect(config.publicApiBaseUrl).toBe('http://localhost:3040');
    expect(config.publicReadAuthMode).toBe('none');
    expect(config.proposalAuthMode).toBe('none');
    expect(config.discoveryAuthMode).toBe('none');
  });

  it('reads bearer auth config and normalizes PUBLIC_API_BASE_URL', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('REGISTRY_ID', 'company-prod');
    vi.stubEnv('REGISTRY_NAME', 'Company Production');
    vi.stubEnv('PUBLIC_API_BASE_URL', 'https://skills.example.com/api/');
    vi.stubEnv('PUBLIC_READ_AUTH_MODE', 'bearer');
    vi.stubEnv('PUBLIC_READ_BEARER_TOKEN', 'read-token');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'bearer');
    vi.stubEnv('PROPOSAL_BEARER_TOKEN', 'proposal-token');
    vi.stubEnv('DISCOVERY_AUTH_MODE', 'bearer');
    vi.stubEnv('DISCOVERY_BEARER_TOKEN', 'discovery-token');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.registryId).toBe('company-prod');
    expect(config.publicApiBaseUrl).toBe('https://skills.example.com/api');
    expect(config.publicReadBearerToken).toBe('read-token');
    expect(config.proposalBearerToken).toBe('proposal-token');
    expect(config.discoveryBearerToken).toBe('discovery-token');
  });

  it('rejects bearer mode without a bearer token', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'bearer');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(ConfigurationError);
  });

  it('rejects unsupported agent auth modes', () => {
    expect(parseAgentAuthMode(undefined, 'PUBLIC_READ_AUTH_MODE')).toBe('none');
    expect(parseAgentAuthMode('bearer', 'PUBLIC_READ_AUTH_MODE')).toBe('bearer');
    expect(parseAgentAuthMode('oidc', 'PUBLIC_READ_AUTH_MODE')).toBe('oidc');
    expect(() => parseAgentAuthMode('oauth', 'PUBLIC_READ_AUTH_MODE')).toThrow(ConfigurationError);
  });

  it('loads independently mixed OIDC and legacy agent modes', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('DISCOVERY_AUTH_MODE', 'none');
    vi.stubEnv('PUBLIC_READ_AUTH_MODE', 'bearer');
    vi.stubEnv('PUBLIC_READ_BEARER_TOKEN', 'read-token');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'oidc');
    vi.stubEnv('OIDC_AGENT_ISSUER', 'https://auth.example.test/application/o/agent/');
    vi.stubEnv('OIDC_AGENT_CLIENT_ID', 'managedskillhub-agent-device');
    vi.stubEnv('OIDC_PROPOSAL_SCOPE', 'managedskillhub:proposals');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.discoveryAuthMode).toBe('none');
    expect(config.publicReadAuthMode).toBe('bearer');
    expect(config.proposalAuthMode).toBe('oidc');
    expect(config.oidcAgentBaseScopes).toEqual(['openid', 'profile', 'email']);
    expect(config.oidcAccessTokenValidationMode).toBe('jwt_profile');
  });

  it('requires confidential introspection credentials for Authentik JWT compatibility mode', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'oidc');
    vi.stubEnv('OIDC_AGENT_ISSUER', 'https://auth.example.test/application/o/agent/');
    vi.stubEnv('OIDC_AGENT_CLIENT_ID', 'managedskillhub-agent-device');
    vi.stubEnv('OIDC_PROPOSAL_SCOPE', 'managedskillhub:proposals');
    vi.stubEnv('OIDC_ACCESS_TOKEN_VALIDATION_MODE', 'authentik_introspection');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(/OIDC_INTROSPECTION_CLIENT_ID/);
    vi.stubEnv('OIDC_INTROSPECTION_CLIENT_ID', 'managedskillhub-token-checker');
    expect(() => loadConfig()).toThrow(/OIDC_INTROSPECTION_CLIENT_SECRET/);
    vi.stubEnv('OIDC_INTROSPECTION_CLIENT_SECRET', 'checker-secret');
    expect(loadConfig().oidcAccessTokenValidationMode).toBe('authentik_introspection');
    expect(() => parseOidcAccessTokenValidationMode('permissive')).toThrow(ConfigurationError);
  });

  it('requires issuer, client, and area scope for each OIDC agent area', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'oidc');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(/OIDC_AGENT_ISSUER/);

    vi.stubEnv('OIDC_AGENT_ISSUER', 'https://auth.example.test/application/o/agent/');
    expect(() => loadConfig()).toThrow(/OIDC_AGENT_CLIENT_ID/);

    vi.stubEnv('OIDC_AGENT_CLIENT_ID', 'managedskillhub-agent-device');
    expect(() => loadConfig()).toThrow(/OIDC_PROPOSAL_SCOPE/);
  });

  it('rejects unsafe issuer URLs and permits explicit localhost HTTP', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'oidc');
    vi.stubEnv('OIDC_AGENT_CLIENT_ID', 'managedskillhub-agent-device');
    vi.stubEnv('OIDC_PROPOSAL_SCOPE', 'managedskillhub:proposals');
    vi.stubEnv('OIDC_AGENT_ISSUER', 'http://auth.example.test/application/o/agent/');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(/HTTPS/);

    vi.stubEnv('OIDC_AGENT_ISSUER', 'https://user:pass@auth.example.test/application/o/agent/');
    expect(() => loadConfig()).toThrow(/credentials/);

    vi.stubEnv('OIDC_AGENT_ISSUER', 'http://127.0.0.1:9000/application/o/agent/');
    expect(loadConfig().oidcAgentIssuer).toContain('127.0.0.1');
  });

  it('rejects required-group policies without configured groups', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('OIDC_PROPOSAL_ACCESS', 'required_groups');
    vi.stubEnv('OIDC_PROPOSAL_GROUPS', ',');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(/OIDC_PROPOSAL_GROUPS/);
  });
});

describe('admin auth config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('parses supported admin modes and OIDC access policies', () => {
    expect(parseAdminAuthMode(undefined)).toBe('simple');
    expect(parseAdminAuthMode('oidc')).toBe('oidc');
    expect(() => parseAdminAuthMode('oauth')).toThrow(ConfigurationError);
    expect(parseOidcAccessPolicy(undefined, 'OIDC_PROPOSAL_ACCESS')).toBe('all_authenticated_users');
    expect(parseOidcAccessPolicy('required_groups', 'OIDC_PROPOSAL_ACCESS')).toBe('required_groups');
    expect(() => parseOidcAccessPolicy('everyone', 'OIDC_PROPOSAL_ACCESS')).toThrow(ConfigurationError);
  });

  it('loads a complete OIDC admin profile without simple credentials', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('ADMIN_AUTH_MODE', 'oidc');
    vi.stubEnv('OIDC_ADMIN_ISSUER', 'https://auth.example.test/application/o/admin/');
    vi.stubEnv('OIDC_ADMIN_CLIENT_ID', 'managedskillhub-admin-web');
    vi.stubEnv('OIDC_ADMIN_CLIENT_SECRET', 'test-client-secret');
    vi.stubEnv('OIDC_ADMIN_REDIRECT_URI', 'https://skills.example.test/api/admin/auth/oidc/callback');
    vi.stubEnv('OIDC_ADMIN_SUBJECTS', 'user-uuid-1');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.adminAuthMode).toBe('oidc');
    expect(config.oidcAdminSubjects).toEqual(['user-uuid-1']);
    expect(config.oidcAdminScopes).toContain('openid');
  });

  it('rejects incomplete OIDC admin profiles and implicit password fallback', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('ADMIN_AUTH_MODE', 'oidc');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(/OIDC_ADMIN_ISSUER/);

    vi.stubEnv('OIDC_ADMIN_ISSUER', 'https://auth.example.test/application/o/admin/');
    vi.stubEnv('OIDC_ADMIN_CLIENT_ID', 'managedskillhub-admin-web');
    vi.stubEnv('OIDC_ADMIN_CLIENT_SECRET', 'test-client-secret');
    vi.stubEnv('OIDC_ADMIN_REDIRECT_URI', 'https://skills.example.test/api/admin/auth/oidc/callback');
    vi.stubEnv('ADMIN_USER', 'admin');
    expect(() => loadConfig()).toThrow(/implicit simple-admin fallback/);
  });

  it('requires an admin subject or group and an openid scope', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('ADMIN_AUTH_MODE', 'oidc');
    vi.stubEnv('OIDC_ADMIN_ISSUER', 'https://auth.example.test/application/o/admin/');
    vi.stubEnv('OIDC_ADMIN_CLIENT_ID', 'managedskillhub-admin-web');
    vi.stubEnv('OIDC_ADMIN_CLIENT_SECRET', 'test-client-secret');
    vi.stubEnv('OIDC_ADMIN_REDIRECT_URI', 'https://skills.example.test/api/admin/auth/oidc/callback');
    vi.stubEnv('OIDC_ADMIN_SCOPES', 'profile,email');
    vi.stubEnv('OIDC_ADMIN_GROUPS', ',');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(/OIDC_ADMIN_SCOPES/);

    vi.stubEnv('OIDC_ADMIN_SCOPES', 'openid,profile');
    expect(() => loadConfig()).toThrow(/OIDC_ADMIN_SUBJECTS or OIDC_ADMIN_GROUPS/);
  });
});

describe('security config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('loads default CORS origins and admin mutation origin checks', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.corsAllowedOrigins).toEqual(['http://localhost:3041', 'http://127.0.0.1:3041']);
    expect(config.adminCsrfOriginCheck).toBe(true);
    expect(config.apiTrustedProxies).toEqual([]);
    expect(config.proposalRateLimitMaxBuckets).toBe(10_000);
  });

  it('loads trusted proxy and bounded proposal rate-limit settings', () => {
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('API_TRUSTED_PROXIES', '127.0.0.1, ::1, 10.0.0.0/8');
    vi.stubEnv('PROPOSAL_RATE_LIMIT_MAX_BUCKETS', '2500');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.apiTrustedProxies).toEqual(['127.0.0.1', '::1', '10.0.0.0/8']);
    expect(config.proposalRateLimitMaxBuckets).toBe(2500);
  });

  it('rejects default admin security settings in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(ConfigurationError);
  });

  it('accepts hashed admin credentials in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('ADMIN_PASSWORD', '');
    vi.stubEnv('ADMIN_PASSWORD_HASH', '$2b$10$012345678901234567890u01234567890123456789012345678901234');
    vi.stubEnv('JWT_SECRET', 'production-secret-with-at-least-32-characters');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'bearer');
    vi.stubEnv('PROPOSAL_BEARER_TOKEN', 'J6f8mB3wQ2rN9xK4pT7vC5sL1hD0zA8u');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.adminPassword).toBeNull();
    expect(config.adminPasswordHash).toContain('$2b$10$');
    expect(config.proposalAuthMode).toBe('bearer');
  });

  it('does not require local admin credentials or JWT_SECRET in production OIDC mode', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('ADMIN_USER', '');
    vi.stubEnv('ADMIN_PASSWORD', '');
    vi.stubEnv('ADMIN_PASSWORD_HASH', '');
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('ADMIN_AUTH_MODE', 'oidc');
    vi.stubEnv('OIDC_ADMIN_ISSUER', 'https://auth.company.test/application/o/admin/');
    vi.stubEnv('OIDC_ADMIN_CLIENT_ID', 'managedskillhub-admin-web');
    vi.stubEnv('OIDC_ADMIN_CLIENT_SECRET', 'production-client-secret-with-sufficient-entropy');
    vi.stubEnv('OIDC_ADMIN_REDIRECT_URI', 'https://skills.company.test/api/admin/auth/oidc/callback');
    vi.stubEnv('OIDC_ADMIN_SUBJECTS', 'authentik-user-uuid-1');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'bearer');
    vi.stubEnv('PROPOSAL_BEARER_TOKEN', 'J6f8mB3wQ2rN9xK4pT7vC5sL1hD0zA8u');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.adminAuthMode).toBe('oidc');
    expect(config.adminPassword).toBeNull();
    expect(config.adminPasswordHash).toBe('');
    expect(config.jwtSecret).toBe('');
  });

  it('requires strong confidential OIDC secrets in production introspection mode', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('ADMIN_USER', '');
    vi.stubEnv('ADMIN_PASSWORD', '');
    vi.stubEnv('ADMIN_PASSWORD_HASH', '');
    vi.stubEnv('ADMIN_AUTH_MODE', 'oidc');
    vi.stubEnv('OIDC_ADMIN_ISSUER', 'https://auth.company.test/application/o/admin/');
    vi.stubEnv('OIDC_ADMIN_CLIENT_ID', 'managedskillhub-admin-web');
    vi.stubEnv('OIDC_ADMIN_CLIENT_SECRET', 'uP8fN2xR6qT9mK4wC7zA5sD1hJ3vL0bE');
    vi.stubEnv('OIDC_ADMIN_REDIRECT_URI', 'https://skills.company.test/api/admin/auth/oidc/callback');
    vi.stubEnv('OIDC_ADMIN_SUBJECTS', 'authentik-user-uuid-1');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'oidc');
    vi.stubEnv('OIDC_AGENT_ISSUER', 'https://auth.company.test/application/o/agent/');
    vi.stubEnv('OIDC_AGENT_CLIENT_ID', 'managedskillhub-agent-device');
    vi.stubEnv('OIDC_PROPOSAL_SCOPE', 'managedskillhub:proposals');
    vi.stubEnv('OIDC_ACCESS_TOKEN_VALIDATION_MODE', 'authentik_introspection');
    vi.stubEnv('OIDC_INTROSPECTION_CLIENT_ID', 'managedskillhub-token-checker');
    vi.stubEnv('OIDC_INTROSPECTION_CLIENT_SECRET', 'short');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(/OIDC_INTROSPECTION_CLIENT_SECRET.*32 bytes/);
    vi.stubEnv('OIDC_INTROSPECTION_CLIENT_SECRET', 'rQ7mV2zK8pL4sN1xC9dF5hJ3wT6bA0uE');
    expect(loadConfig().oidcAccessTokenValidationMode).toBe('authentik_introspection');
  });

  it('rejects open proposal APIs in production unless explicitly allowed', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('ADMIN_PASSWORD', '');
    vi.stubEnv('ADMIN_PASSWORD_HASH', '$2b$10$012345678901234567890u01234567890123456789012345678901234');
    vi.stubEnv('JWT_SECRET', 'production-secret-with-at-least-32-characters');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'none');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(/PROPOSAL_AUTH_MODE=bearer/);
  });

  it('rejects weak static bearer tokens and out-of-range security limits in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('ADMIN_PASSWORD', '');
    vi.stubEnv('ADMIN_PASSWORD_HASH', '$2b$10$012345678901234567890u01234567890123456789012345678901234');
    vi.stubEnv('JWT_SECRET', 'production-secret-with-at-least-32-characters');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'bearer');
    vi.stubEnv('PROPOSAL_BEARER_TOKEN', 'x');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadConfig()).toThrow(/32 random bytes/);
    vi.stubEnv('PROPOSAL_BEARER_TOKEN', 'J6f8mB3wQ2rN9xK4pT7vC5sL1hD0zA8u');
    vi.stubEnv('OIDC_CLOCK_TOLERANCE_SECONDS', '301');
    expect(() => loadConfig()).toThrow(/OIDC_CLOCK_TOLERANCE_SECONDS/);
    vi.stubEnv('OIDC_CLOCK_TOLERANCE_SECONDS', '30');
    vi.stubEnv('SESSION_TTL_SECONDS', '604801');
    expect(() => loadConfig()).toThrow(/SESSION_TTL_SECONDS/);
  });

  it('allows explicitly open proposal APIs in production for internal deployments', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JUDGER_PROVIDER', 'noop');
    vi.stubEnv('ADMIN_PASSWORD', '');
    vi.stubEnv('ADMIN_PASSWORD_HASH', '$2b$10$012345678901234567890u01234567890123456789012345678901234');
    vi.stubEnv('JWT_SECRET', 'production-secret-with-at-least-32-characters');
    vi.stubEnv('PROPOSAL_AUTH_MODE', 'none');
    vi.stubEnv('ALLOW_OPEN_PROPOSALS_IN_PRODUCTION', 'true');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config.proposalAuthMode).toBe('none');
    expect(config.allowOpenProposalsInProduction).toBe(true);
  });
});
