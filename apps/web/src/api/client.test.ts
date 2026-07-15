import { describe, expect, it } from 'vitest';
import { buildApiUrl, handleApiError } from './client';

describe('buildApiUrl', () => {
  it('preserves a relative API prefix in a browser deployment', () => {
    expect(buildApiUrl('/admin/proposals/proposal-1/files/SKILL.md')).toBe(
      'http://localhost/api/admin/proposals/proposal-1/files/SKILL.md'
    );
  });

  it('preserves the path prefix of an absolute API base', () => {
    expect(buildApiUrl('/admin/proposals/proposal-1', 'https://frontend.example.test/api')).toBe(
      'https://frontend.example.test/api/admin/proposals/proposal-1'
    );
  });
});

describe('handleApiError', () => {
  it('formats normalized API errors with debug extras', () => {
    const error = {
      isAxiosError: true,
      message: 'Request failed with status code 500',
      response: {
        data: {
          error: 'Internal server error',
          code: 'INTERNAL_ERROR',
          requestId: 'req-123',
          originalError: 'database exploded',
        },
      },
    };

    expect(handleApiError(error)).toBe('Internal server error (cause: database exploded, request req-123)');
  });

  it('keeps compatibility with legacy error payloads', () => {
    const error = {
      isAxiosError: true,
      message: 'Request failed with status code 404',
      response: {
        data: {
          error: 'Proposal not found',
        },
      },
    };

    expect(handleApiError(error)).toBe('Proposal not found');
  });

  it('formats auth-required details for users', () => {
    const error = {
      isAxiosError: true,
      message: 'Request failed with status code 401',
      response: {
        data: {
          error: 'Agent API authentication required',
          code: 'UNAUTHORIZED',
          requestId: 'req-auth',
          details: {
            authRequired: true,
            authArea: 'proposal',

          },
        },
      },
    };

    expect(handleApiError(error)).toContain('auth area: proposal');
  });
});
