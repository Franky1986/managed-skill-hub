export interface StoredFile {
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  updatedAt: Date | null;
}

export interface StoredExtractedContent {
  text: string;
  extractedBy: string;
  metadata: Record<string, unknown>;
  extractedAt: Date;
}

export interface SkillFileStoragePort {
  storeSkillFile(skillId: string, version: string, path: string, content: Buffer, mimeType: string): Promise<StoredFile>;
  readSkillFile(skillId: string, version: string, path: string): Promise<{ content: Buffer; mimeType: string } | null>;
  listSkillFiles(skillId: string, version: string): Promise<StoredFile[]>;
  storeSkillFileExtract(
    skillId: string,
    version: string,
    path: string,
    extracted: Omit<StoredExtractedContent, 'extractedAt'> & { extractedAt?: Date }
  ): Promise<StoredExtractedContent>;
  readSkillFileExtract(skillId: string, version: string, path: string): Promise<StoredExtractedContent | null>;
  storeProposalFile(proposalId: string, path: string, content: Buffer, mimeType: string): Promise<StoredFile>;
  readProposalFile(proposalId: string, path: string): Promise<{ content: Buffer; mimeType: string } | null>;
  listProposalFiles(proposalId: string): Promise<StoredFile[]>;
  storeProposalFileExtract(
    proposalId: string,
    path: string,
    extracted: Omit<StoredExtractedContent, 'extractedAt'> & { extractedAt?: Date }
  ): Promise<StoredExtractedContent>;
  readProposalFileExtract(proposalId: string, path: string): Promise<StoredExtractedContent | null>;
}
