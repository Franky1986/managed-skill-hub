import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  StoredExtractedContent,
  SkillFileStoragePort,
  StoredFile,
} from '../../../../application/ports/outbound/file-storage.port';
import { StorageError } from '../../../../domain/errors';
import { normalizeRelativeArtifactPath } from '../../../../domain/files/relative-artifact-path';

interface FileMeta {
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  updatedAt: string;
}

interface ExtractedFileMeta {
  text: string;
  extractedBy: string;
  metadata: Record<string, unknown>;
  extractedAt: string;
}

export class FileSystemSkillStorage implements SkillFileStoragePort {
  constructor(private readonly dataDir: string) {}

  private skillDir(skillId: string, version: string): string {
    return path.join(this.dataDir, 'skills', skillId, version);
  }

  private proposalDir(proposalId: string): string {
    return path.join(this.dataDir, 'proposals', proposalId);
  }

  private skillExtractPath(skillId: string, version: string): string {
    return path.join(this.skillDir(skillId, version), '.extracts.json');
  }

  private proposalExtractPath(proposalId: string): string {
    return path.join(this.proposalDir(proposalId), '.extracts.json');
  }

  async storeSkillFile(
    skillId: string,
    version: string,
    filePath: string,
    content: Buffer,
    mimeType: string
  ): Promise<StoredFile> {
    const dir = this.skillDir(skillId, version);
    await fs.mkdir(dir, { recursive: true });
    const { target, relativePath } = this.resolveInside(dir, filePath, 'Skill file path');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await this.atomicWrite(target, content);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const updatedAt = new Date().toISOString();
    const metaPath = path.join(dir, '.meta.json');
    const meta = await this.readMeta(metaPath);
    meta[relativePath] = { mimeType, sizeBytes: content.length, sha256, updatedAt };
    await this.atomicWrite(metaPath, Buffer.from(JSON.stringify(meta, null, 2)));
    return {
      path: relativePath,
      mimeType,
      sizeBytes: content.length,
      sha256,
      updatedAt: new Date(updatedAt),
    };
  }

  async readSkillFile(
    skillId: string,
    version: string,
    filePath: string
  ): Promise<{ content: Buffer; mimeType: string } | null> {
    const dir = this.skillDir(skillId, version);
    const { target, relativePath } = this.resolveInside(dir, filePath, 'Skill file path');
    try {
      const content = await fs.readFile(target);
      const meta = await this.readMeta(path.join(dir, '.meta.json'));
      return { content, mimeType: meta[relativePath]?.mimeType ?? 'application/octet-stream' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new StorageError(`Failed to read skill file: ${(err as Error).message}`);
    }
  }

  async listSkillFiles(skillId: string, version: string): Promise<StoredFile[]> {
    const dir = this.skillDir(skillId, version);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
      const meta = await this.readMeta(path.join(dir, '.meta.json'));
      return entries
        .filter((e) => e.isFile() && e.name !== '.meta.json' && e.name !== '.extracts.json')
        .map((e) => {
          const relative = path.relative(dir, path.join(e.parentPath ?? dir, e.name));
          const m = meta[relative];
          return {
            path: relative,
            mimeType: m?.mimeType ?? 'application/octet-stream',
            sizeBytes: m?.sizeBytes ?? 0,
            sha256: m?.sha256 ?? null,
            updatedAt: m?.updatedAt ? new Date(m.updatedAt) : null,
          };
        });
    } catch {
      return [];
    }
  }

  async storeSkillFileExtract(
    skillId: string,
    version: string,
    filePath: string,
    extracted: Omit<StoredExtractedContent, 'extractedAt'> & { extractedAt?: Date }
  ): Promise<StoredExtractedContent> {
    const dir = this.skillDir(skillId, version);
    await fs.mkdir(dir, { recursive: true });
    const extractedAt = extracted.extractedAt ?? new Date();
    const extractPath = this.skillExtractPath(skillId, version);
    const current = await this.readExtracts(extractPath);
    const relativePath = this.normalizePath(filePath, 'Skill file path');
    current[relativePath] = {
      text: extracted.text,
      extractedBy: extracted.extractedBy,
      metadata: extracted.metadata,
      extractedAt: extractedAt.toISOString(),
    };
    await this.atomicWrite(extractPath, Buffer.from(JSON.stringify(current, null, 2)));
    return {
      text: extracted.text,
      extractedBy: extracted.extractedBy,
      metadata: extracted.metadata,
      extractedAt,
    };
  }

  async readSkillFileExtract(skillId: string, version: string, filePath: string): Promise<StoredExtractedContent | null> {
    try {
      const relativePath = this.normalizePath(filePath, 'Skill file path');
      const extract = (await this.readExtracts(this.skillExtractPath(skillId, version)))[relativePath];
      if (!extract) {
        return null;
      }
      return {
        text: extract.text,
        extractedBy: extract.extractedBy,
        metadata: extract.metadata,
        extractedAt: new Date(extract.extractedAt),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new StorageError(`Failed to read extracted skill content: ${(err as Error).message}`);
    }
  }

  async storeProposalFile(
    proposalId: string,
    filePath: string,
    content: Buffer,
    mimeType: string
  ): Promise<StoredFile> {
    const dir = this.proposalDir(proposalId);
    await fs.mkdir(dir, { recursive: true });
    const { target, relativePath } = this.resolveInside(dir, filePath, 'Proposal file path');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await this.atomicWrite(target, content);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const updatedAt = new Date().toISOString();
    const metaPath = path.join(dir, '.meta.json');
    const meta = await this.readMeta(metaPath);
    meta[relativePath] = { mimeType, sizeBytes: content.length, sha256, updatedAt };
    await this.atomicWrite(metaPath, Buffer.from(JSON.stringify(meta, null, 2)));
    return {
      path: relativePath,
      mimeType,
      sizeBytes: content.length,
      sha256,
      updatedAt: new Date(updatedAt),
    };
  }

  async readProposalFile(
    proposalId: string,
    filePath: string
  ): Promise<{ content: Buffer; mimeType: string } | null> {
    const dir = this.proposalDir(proposalId);
    const { target, relativePath } = this.resolveInside(dir, filePath, 'Proposal file path');
    try {
      const content = await fs.readFile(target);
      const meta = await this.readMeta(path.join(dir, '.meta.json'));
      return { content, mimeType: meta[relativePath]?.mimeType ?? 'application/octet-stream' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new StorageError(`Failed to read proposal file: ${(err as Error).message}`);
    }
  }

  async listProposalFiles(proposalId: string): Promise<StoredFile[]> {
    const dir = this.proposalDir(proposalId);
    try {
      const meta = await this.readMeta(path.join(dir, '.meta.json'));
      return Object.entries(meta).map(([filePath, m]) => ({
        path: filePath,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        sha256: m.sha256,
        updatedAt: m.updatedAt ? new Date(m.updatedAt) : null,
      }));
    } catch {
      return [];
    }
  }

  async storeProposalFileExtract(
    proposalId: string,
    filePath: string,
    extracted: Omit<StoredExtractedContent, 'extractedAt'> & { extractedAt?: Date }
  ): Promise<StoredExtractedContent> {
    const dir = this.proposalDir(proposalId);
    await fs.mkdir(dir, { recursive: true });
    const extractedAt = extracted.extractedAt ?? new Date();
    const extractPath = this.proposalExtractPath(proposalId);
    const current = await this.readExtracts(extractPath);
    const relativePath = this.normalizePath(filePath, 'Proposal file path');
    current[relativePath] = {
      text: extracted.text,
      extractedBy: extracted.extractedBy,
      metadata: extracted.metadata,
      extractedAt: extractedAt.toISOString(),
    };
    await this.atomicWrite(extractPath, Buffer.from(JSON.stringify(current, null, 2)));
    return {
      text: extracted.text,
      extractedBy: extracted.extractedBy,
      metadata: extracted.metadata,
      extractedAt,
    };
  }

  async readProposalFileExtract(proposalId: string, filePath: string): Promise<StoredExtractedContent | null> {
    try {
      const relativePath = this.normalizePath(filePath, 'Proposal file path');
      const extract = (await this.readExtracts(this.proposalExtractPath(proposalId)))[relativePath];
      if (!extract) {
        return null;
      }
      return {
        text: extract.text,
        extractedBy: extract.extractedBy,
        metadata: extract.metadata,
        extractedAt: new Date(extract.extractedAt),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new StorageError(`Failed to read extracted proposal content: ${(err as Error).message}`);
    }
  }

  private async atomicWrite(target: string, content: Buffer): Promise<void> {
    const temp = `${target}.tmp.${process.hrtime.bigint().toString()}`;
    await fs.writeFile(temp, content);
    await fs.rename(temp, target);
  }

  private async readMeta(metaPath: string): Promise<Record<string, FileMeta>> {
    try {
      const raw = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(raw) as Record<string, FileMeta>;
    } catch {
      return {};
    }
  }

  private async readExtracts(extractPath: string): Promise<Record<string, ExtractedFileMeta>> {
    try {
      const raw = await fs.readFile(extractPath, 'utf-8');
      return JSON.parse(raw) as Record<string, ExtractedFileMeta>;
    } catch {
      return {};
    }
  }

  private resolveInside(baseDir: string, filePath: string, fieldLabel: string): { target: string; relativePath: string } {
    const relativePath = this.normalizePath(filePath, fieldLabel);
    const base = path.resolve(baseDir);
    const target = path.resolve(base, relativePath);
    if (target === base || !target.startsWith(base + path.sep)) {
      throw new StorageError(`${fieldLabel} escapes storage directory.`);
    }
    return { target, relativePath };
  }

  private normalizePath(filePath: string, fieldLabel: string): string {
    try {
      return normalizeRelativeArtifactPath(filePath, { fieldLabel });
    } catch (error) {
      throw new StorageError((error as Error).message);
    }
  }
}
