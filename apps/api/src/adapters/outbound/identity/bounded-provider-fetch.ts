const DEFAULT_MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

export interface BoundedProviderFetchOptions {
  trustedOrigin: string;
  maxBytes?: number;
}

export async function boundedProviderFetch(
  url: string | URL,
  options: RequestInit,
  policy: BoundedProviderFetchOptions
): Promise<Response> {
  const target = new URL(url);
  if (target.origin !== policy.trustedOrigin) {
    throw new Error('OIDC provider endpoint left the configured trusted origin.');
  }

  const maxBytes = policy.maxBytes ?? DEFAULT_MAX_PROVIDER_RESPONSE_BYTES;
  const response = await fetch(target, { ...options, redirect: 'manual' });
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel('OIDC provider response exceeded the configured size limit.');
    throw new Error('OIDC provider response exceeded the configured size limit.');
  }

  const body = await readBoundedBody(response, maxBytes);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-length', String(body.byteLength));
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('OIDC provider response exceeded the configured size limit.');
        throw new Error('OIDC provider response exceeded the configured size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
