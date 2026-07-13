type OpenIdClientModule = typeof import('openid-client');

const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<OpenIdClientModule>;

let modulePromise: Promise<OpenIdClientModule> | null = null;

export function loadOpenIdClient(): Promise<OpenIdClientModule> {
  modulePromise ??= importEsm('openid-client');
  return modulePromise;
}
