import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedProviderFetch } from './bounded-provider-fetch';

describe('boundedProviderFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a response when the streamed body remains within the limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bounded body')));

    const response = await boundedProviderFetch(
      'https://auth.example.test/discovery',
      {},
      { trustedOrigin: 'https://auth.example.test', maxBytes: 32 }
    );

    expect(await response.text()).toBe('bounded body');
  });

  it('cancels a streamed body immediately after the actual limit is exceeded', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

    await expect(boundedProviderFetch(
      'https://auth.example.test/jwks',
      {},
      { trustedOrigin: 'https://auth.example.test', maxBytes: 10 }
    )).rejects.toThrow('size limit');
    expect(cancelled).toBe(true);
  });

  it('rejects another origin before issuing a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(boundedProviderFetch(
      'https://evil.example/jwks',
      {},
      { trustedOrigin: 'https://auth.example.test' }
    )).rejects.toThrow('trusted origin');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
