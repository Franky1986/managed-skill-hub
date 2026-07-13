import crypto from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { ManifestFile } from '../../../domain/skill/ManifestFile';
import { SkillVersion } from '../../../domain/skill/SkillVersion';

const SKILL_NAMESPACE = '6cf9f6be-f8d0-427e-ab47-c16d4961ce2d';
const VERSION_NAMESPACE = 'f6dcae18-1b7c-49a4-b102-809ac5ffb5f1';
const ARTIFACT_NAMESPACE = '4cb7eb93-81de-4420-b56f-e831e0563038';

export interface ArtifactMetadataInput {
  path: string;
  role: string;
  mimeType: string | null;
  sha256: string | null;
  sizeBytes?: number | null;
  updatedAt?: Date | null;
}

export function computeSkillUuid(skillId: string): string {
  return uuidv5(skillId, SKILL_NAMESPACE);
}

export function computeVersionUuid(skillId: string, version: string): string {
  return uuidv5(`${computeSkillUuid(skillId)}:${version}`, VERSION_NAMESPACE);
}

export function computeArtifactId(skillId: string, version: string, filePath: string): string {
  return uuidv5(`${computeVersionUuid(skillId, version)}:${filePath}`, ARTIFACT_NAMESPACE);
}

export function computeContentDigest(
  skillId: string,
  version: string,
  category: string,
  tags: string[],
  capabilities: string[],
  entrypoint: string,
  files: ArtifactMetadataInput[]
): string {
  const payload = JSON.stringify({
    skillId,
    version,
    category,
    tags,
    capabilities,
    entrypoint,
    files: [...files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({
        path: file.path,
        role: file.role,
        mimeType: file.mimeType,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes ?? null,
      })),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function computeContentDigestForVersion(skillVersion: SkillVersion): string {
  return computeContentDigest(
    skillVersion.skillId.toString(),
    skillVersion.version,
    skillVersion.manifest.category,
    skillVersion.manifest.tags,
    skillVersion.manifest.capabilities,
    skillVersion.manifest.entrypoint,
    skillVersion.manifest.files.map((file) => mapManifestFileToArtifactInput(file))
  );
}

export function isTextLikeArtifact(mimeType: string | null, filePath: string): boolean {
  if (mimeType?.startsWith('text/')) {
    return true;
  }

  return /\.(md|markdown|txt|ya?ml|json|csv|tsv|ts|tsx|js|jsx|mjs|cjs|css|html?|xml|sh|bash|zsh|fish|cmd|bat|ps1|psm1|psd1|py|rb|java|go|rs|sql|ini|cfg|conf)$/i.test(
    filePath
  );
}

export function isExtractableArtifact(mimeType: string | null, filePath: string): boolean {
  if (isTextLikeArtifact(mimeType, filePath)) {
    return true;
  }

  return (
    /\.(pdf|docx|pptx|xlsx)$/i.test(filePath) ||
    mimeType === 'application/pdf' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

function mapManifestFileToArtifactInput(file: ManifestFile): ArtifactMetadataInput {
  return {
    path: file.path,
    role: file.role,
    mimeType: file.mimeType,
    sha256: file.sha256,
  };
}
