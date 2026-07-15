import axios, { AxiosInstance, AxiosError } from 'axios';
import { type LanguageCode, translate } from '../i18n';

// In development the Vite dev server proxies /api to the backend.
// In production the frontend is served behind the same host, so /api hits the backend directly.
const configuredApiBase = (import.meta.env.VITE_API_BASE_URL ?? '/api').trim();
const useApiProxy = import.meta.env.VITE_USE_API_PROXY !== 'false';

function getApiBaseUrl(): string {
  if (!configuredApiBase) {
    return '/api';
  }

  if (/^https?:\/\//i.test(configuredApiBase) && typeof window !== 'undefined') {
    try {
      const parsed = new URL(configuredApiBase);
      if (parsed.hostname && parsed.hostname !== window.location.hostname && useApiProxy) {
        return '/api';
      }
    } catch {
      return configuredApiBase;
    }
  }

  return configuredApiBase;
}

const API_BASE_URL = getApiBaseUrl();

/**
 * Build a browser-loadable API URL while preserving an optional API prefix.
 * `new URL('/admin/...', '/api')` is invalid, and a leading slash would also
 * discard `/api` when the configured base is an absolute URL with that path.
 */
export function buildApiUrl(path: string, apiBase = API_BASE_URL): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const baseUrl = new URL(apiBase || '/api', origin);
  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  const targetPath = path.replace(/^\/+/, '');
  return new URL(`${basePath}/${targetPath}`.replace(/\/+/g, '/'), baseUrl.origin).toString();
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
});

export function getApiErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) {
    return null;
  }
  const payload = (error as AxiosError<{ code?: string }>).response?.data;
  return payload?.code ?? null;
}

export function handleApiError(error: unknown, language: LanguageCode = 'en'): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{
      error?: string;
      message?: string;
      code?: string;
      requestId?: string;
      originalError?: string;
      details?: {
        authRequired?: boolean;
        authArea?: string;
        authScheme?: string;
        discoverUrl?: string;
        recommendation?: string;
      } | unknown;
    }>;
    const payload = axiosError.response?.data;
    const code = payload?.code;
    const fallbackMessage = payload?.error ?? payload?.message ?? axiosError.message;
    const message = code ? translate(language, `api.error.${code}`, {}, fallbackMessage) : fallbackMessage;
    const extras: string[] = [];

    if (payload?.details && typeof payload.details === 'object' && 'authRequired' in payload.details && payload.details.authRequired) {
      const details = payload.details as { authArea?: string; recommendation?: string };
      extras.push(`auth area: ${details.authArea ?? 'agent-api'}`);
    }

    if (payload?.originalError && payload.originalError !== message) {
      extras.push(`cause: ${payload.originalError}`);
    }

    if (payload?.requestId) {
      extras.push(`request ${payload.requestId}`);
    }

    return extras.length > 0 ? `${message} (${extras.join(', ')})` : message;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}
