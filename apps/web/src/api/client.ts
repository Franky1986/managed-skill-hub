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
        credentialSetupScriptUrl?: string | null;
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
      const details = payload.details as { authArea?: string; credentialSetupScriptUrl?: string | null; recommendation?: string };
      extras.push(
        details.credentialSetupScriptUrl
          ? `auth area: ${details.authArea ?? 'agent-api'}, setup: ${details.credentialSetupScriptUrl}`
          : `auth area: ${details.authArea ?? 'agent-api'}`
      );
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
