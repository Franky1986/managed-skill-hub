import { ValidationError } from '../errors';

export interface NormalizeRelativeArtifactPathOptions {
  allowLeadingSlashTrim?: boolean;
  fieldLabel?: string;
}

export function normalizeRelativeArtifactPath(
  inputPath: string,
  options: NormalizeRelativeArtifactPathOptions = {}
): string {
  const fieldLabel = options.fieldLabel ?? 'File path';
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new ValidationError(`${fieldLabel} is required`);
  }
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new ValidationError(`${fieldLabel} ${inputPath} is invalid`);
  }
  if (trimmed.startsWith('\\\\')) {
    throw new ValidationError(`${fieldLabel} ${inputPath} is invalid`);
  }
  if (!options.allowLeadingSlashTrim && trimmed.startsWith('/')) {
    throw new ValidationError(`${fieldLabel} ${inputPath} is invalid`);
  }

  const normalized = trimmed
    .replace(/\\/g, '/')
    .replace(options.allowLeadingSlashTrim ? /^\/+/ : /^/, '')
    .replace(/\/+/g, '/');

  if (!normalized) {
    throw new ValidationError(`${fieldLabel} is required`);
  }
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new ValidationError(`${fieldLabel} ${inputPath} is invalid`);
  }
  return normalized;
}
