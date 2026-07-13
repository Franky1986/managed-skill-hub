type JoseModule = typeof import('jose');

const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<JoseModule>;

let modulePromise: Promise<JoseModule> | null = null;

export function loadJose(): Promise<JoseModule> {
  modulePromise ??= importEsm('jose');
  return modulePromise;
}
