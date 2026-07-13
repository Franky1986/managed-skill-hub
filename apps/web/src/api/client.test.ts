import { describe, expect, it } from 'vitest';
import { handleApiError } from './client';

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
            credentialSetupScriptUrl: 'https://skills.example.com/api/agent-credentials/setup.sh',
          },
        },
      },
    };

    expect(handleApiError(error)).toContain('setup: https://skills.example.com/api/agent-credentials/setup.sh');
  });
});
