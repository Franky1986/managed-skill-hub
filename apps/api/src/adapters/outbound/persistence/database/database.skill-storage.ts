import crypto from 'crypto';
import { StorageError } from '../../../../domain/errors';
import {
  SkillFileStoragePort,
  StoredExtractedContent,
  StoredFile,
} from '../../../../application/ports/outbound/file-storage.port';
import { ContentDb, upsertClause } from './content-db';

interface FileRow {
  path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  updated_at: string;
  content_blob: Buffer;
}

interface ExtractRow {
  text: string;
  extracted_by: string;
  metadata_json: string;
  extracted_at: string;
}

export class DatabaseSkillStorage implements SkillFileStoragePort {
  constructor(private readonly contentDb: ContentDb) {}

  async storeSkillFile(skillId: string, version: string, filePath: string, content: Buffer, mimeType: string): Promise<StoredFile> {
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const updatedAt = new Date();
    try {
      await this.contentDb.execute(`
        INSERT INTO content_skill_files (skill_id, version, path, mime_type, size_bytes, sha256, updated_at, content_blob)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ${upsertClause(this.contentDb.dialect, ['skill_id', 'version', 'path'], ['mime_type', 'size_bytes', 'sha256', 'updated_at', 'content_blob'])}
      `, [skillId, version, filePath, mimeType, content.length, sha256, updatedAt.toISOString(), content]);
      return { path: filePath, mimeType, sizeBytes: content.length, sha256, updatedAt };
    } catch (err) {
      throw new StorageError('Failed to store skill file in database: ' + (err as Error).message);
    }
  }

  async readSkillFile(skillId: string, version: string, filePath: string): Promise<{ content: Buffer; mimeType: string } | null> {
    try {
      const row = await this.contentDb.queryOne<Pick<FileRow, 'mime_type' | 'content_blob'>>(`
        SELECT mime_type, content_blob FROM content_skill_files
        WHERE skill_id = ? AND version = ? AND path = ?
      `, [skillId, version, filePath]);
      return row ? { content: Buffer.from(row.content_blob), mimeType: row.mime_type } : null;
    } catch (err) {
      throw new StorageError('Failed to read skill file from database: ' + (err as Error).message);
    }
  }

  async listSkillFiles(skillId: string, version: string): Promise<StoredFile[]> {
    try {
      const rows = await this.contentDb.queryAll<FileRow>(`
        SELECT path, mime_type, size_bytes, sha256, updated_at FROM content_skill_files
        WHERE skill_id = ? AND version = ?
        ORDER BY path
      `, [skillId, version]);
      return rows.map(mapFileRow);
    } catch (err) {
      throw new StorageError('Failed to list skill files from database: ' + (err as Error).message);
    }
  }

  async storeSkillFileExtract(
    skillId: string,
    version: string,
    filePath: string,
    extracted: Omit<StoredExtractedContent, 'extractedAt'> & { extractedAt?: Date }
  ): Promise<StoredExtractedContent> {
    const extractedAt = extracted.extractedAt ?? new Date();
    try {
      await this.contentDb.execute(`
        INSERT INTO content_skill_file_extracts (skill_id, version, path, text, extracted_by, metadata_json, extracted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ${upsertClause(this.contentDb.dialect, ['skill_id', 'version', 'path'], ['text', 'extracted_by', 'metadata_json', 'extracted_at'])}
      `, [skillId, version, filePath, extracted.text, extracted.extractedBy, JSON.stringify(extracted.metadata), extractedAt.toISOString()]);
      return { text: extracted.text, extractedBy: extracted.extractedBy, metadata: extracted.metadata, extractedAt };
    } catch (err) {
      throw new StorageError('Failed to store extracted skill content in database: ' + (err as Error).message);
    }
  }

  async readSkillFileExtract(skillId: string, version: string, filePath: string): Promise<StoredExtractedContent | null> {
    try {
      const row = await this.contentDb.queryOne<ExtractRow>(`
        SELECT text, extracted_by, metadata_json, extracted_at FROM content_skill_file_extracts
        WHERE skill_id = ? AND version = ? AND path = ?
      `, [skillId, version, filePath]);
      return row ? mapExtractRow(row) : null;
    } catch (err) {
      throw new StorageError('Failed to read extracted skill content from database: ' + (err as Error).message);
    }
  }

  async storeProposalFile(proposalId: string, filePath: string, content: Buffer, mimeType: string): Promise<StoredFile> {
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const updatedAt = new Date();
    try {
      await this.contentDb.execute(`
        INSERT INTO content_proposal_files (proposal_id, path, mime_type, size_bytes, sha256, updated_at, content_blob)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ${upsertClause(this.contentDb.dialect, ['proposal_id', 'path'], ['mime_type', 'size_bytes', 'sha256', 'updated_at', 'content_blob'])}
      `, [proposalId, filePath, mimeType, content.length, sha256, updatedAt.toISOString(), content]);
      return { path: filePath, mimeType, sizeBytes: content.length, sha256, updatedAt };
    } catch (err) {
      throw new StorageError('Failed to store proposal file in database: ' + (err as Error).message);
    }
  }

  async readProposalFile(proposalId: string, filePath: string): Promise<{ content: Buffer; mimeType: string } | null> {
    try {
      const row = await this.contentDb.queryOne<Pick<FileRow, 'mime_type' | 'content_blob'>>(`
        SELECT mime_type, content_blob FROM content_proposal_files
        WHERE proposal_id = ? AND path = ?
      `, [proposalId, filePath]);
      return row ? { content: Buffer.from(row.content_blob), mimeType: row.mime_type } : null;
    } catch (err) {
      throw new StorageError('Failed to read proposal file from database: ' + (err as Error).message);
    }
  }

  async listProposalFiles(proposalId: string): Promise<StoredFile[]> {
    try {
      const rows = await this.contentDb.queryAll<FileRow>(`
        SELECT path, mime_type, size_bytes, sha256, updated_at FROM content_proposal_files
        WHERE proposal_id = ?
        ORDER BY path
      `, [proposalId]);
      return rows.map(mapFileRow);
    } catch (err) {
      throw new StorageError('Failed to list proposal files from database: ' + (err as Error).message);
    }
  }

  async storeProposalFileExtract(
    proposalId: string,
    filePath: string,
    extracted: Omit<StoredExtractedContent, 'extractedAt'> & { extractedAt?: Date }
  ): Promise<StoredExtractedContent> {
    const extractedAt = extracted.extractedAt ?? new Date();
    try {
      await this.contentDb.execute(`
        INSERT INTO content_proposal_file_extracts (proposal_id, path, text, extracted_by, metadata_json, extracted_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ${upsertClause(this.contentDb.dialect, ['proposal_id', 'path'], ['text', 'extracted_by', 'metadata_json', 'extracted_at'])}
      `, [proposalId, filePath, extracted.text, extracted.extractedBy, JSON.stringify(extracted.metadata), extractedAt.toISOString()]);
      return { text: extracted.text, extractedBy: extracted.extractedBy, metadata: extracted.metadata, extractedAt };
    } catch (err) {
      throw new StorageError('Failed to store extracted proposal content in database: ' + (err as Error).message);
    }
  }

  async readProposalFileExtract(proposalId: string, filePath: string): Promise<StoredExtractedContent | null> {
    try {
      const row = await this.contentDb.queryOne<ExtractRow>(`
        SELECT text, extracted_by, metadata_json, extracted_at FROM content_proposal_file_extracts
        WHERE proposal_id = ? AND path = ?
      `, [proposalId, filePath]);
      return row ? mapExtractRow(row) : null;
    } catch (err) {
      throw new StorageError('Failed to read extracted proposal content from database: ' + (err as Error).message);
    }
  }
}

function mapFileRow(row: FileRow): StoredFile {
  return {
    path: row.path,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

function mapExtractRow(row: ExtractRow): StoredExtractedContent {
  return {
    text: row.text,
    extractedBy: row.extracted_by,
    metadata: parseJson(row.metadata_json) as Record<string, unknown>,
    extractedAt: new Date(row.extracted_at),
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}
