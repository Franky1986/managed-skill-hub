import { ValidationError } from '../errors';
import { normalizeRelativeArtifactPath } from '../files/relative-artifact-path';

export enum FileRole {
  ENTRYPOINT = 'entrypoint',
  EXAMPLE = 'example',
  KNOWLEDGE = 'knowledge',
  TEST = 'test',
  ATTACHMENT = 'attachment',
}

export class ManifestFile {
  private constructor(
    readonly path: string,
    readonly role: FileRole,
    readonly mimeType: string | null,
    readonly sha256: string | null
  ) {}

  static create(props: {
    path: string;
    role: string;
    mimeType?: string | null;
    sha256?: string | null;
  }): ManifestFile {
    if (!props.path || props.path.trim().length === 0) {
      throw new ValidationError('File path is required');
    }
    if (!Object.values(FileRole).includes(props.role as FileRole)) {
      throw new ValidationError(`Invalid file role: ${props.role}`);
    }
    return new ManifestFile(
      normalizeRelativeArtifactPath(props.path),
      props.role as FileRole,
      props.mimeType ?? null,
      props.sha256 ?? null
    );
  }
}
