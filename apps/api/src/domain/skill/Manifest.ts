import { ValidationError } from '../errors';
import { ManifestFile } from './ManifestFile';
import { SkillStatus } from './SkillStatus';

export class Manifest {
  private constructor(
    readonly id: string,
    readonly title: string,
    readonly description: string,
    readonly version: string,
    readonly status: SkillStatus,
    readonly category: string,
    readonly tags: string[],
    readonly capabilities: string[],
    readonly useWhen: string[],
    readonly doNotUseWhen: string[],
    readonly entrypoint: string,
    readonly files: ManifestFile[]
  ) {}

  static create(props: {
    id: string;
    title: string;
    description?: string;
    version: string;
    status: SkillStatus;
    category: string;
    tags?: string[];
    capabilities?: string[];
    useWhen?: string[];
    doNotUseWhen?: string[];
    entrypoint: string;
    files?: ManifestFile[];
  }): Manifest {
    if (!props.id || props.id.trim().length === 0) {
      throw new ValidationError('Manifest id is required');
    }
    if (!props.title || props.title.trim().length === 0) {
      throw new ValidationError('Manifest title is required');
    }
    if (!props.version || props.version.trim().length === 0) {
      throw new ValidationError('Manifest version is required');
    }
    if (!props.category || props.category.trim().length === 0) {
      throw new ValidationError('Manifest category is required');
    }
    if (!props.entrypoint || props.entrypoint.trim().length === 0) {
      throw new ValidationError('Manifest entrypoint is required');
    }

    return new Manifest(
      props.id.trim(),
      props.title.trim(),
      (props.description ?? '').trim(),
      props.version.trim(),
      props.status,
      props.category.trim().toLowerCase(),
      props.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean) ?? [],
      props.capabilities?.map((c) => c.trim().toLowerCase()).filter(Boolean) ?? [],
      props.useWhen?.map((u) => u.trim()).filter(Boolean) ?? [],
      props.doNotUseWhen?.map((u) => u.trim()).filter(Boolean) ?? [],
      props.entrypoint.trim(),
      props.files ?? []
    );
  }

  withStatus(status: SkillStatus): Manifest {
    return Manifest.create({
      id: this.id,
      title: this.title,
      description: this.description,
      version: this.version,
      status,
      category: this.category,
      tags: this.tags,
      capabilities: this.capabilities,
      useWhen: this.useWhen,
      doNotUseWhen: this.doNotUseWhen,
      entrypoint: this.entrypoint,
      files: this.files,
    });
  }

  get groups(): string[] {
    return [this.category, ...this.tags];
  }
}
