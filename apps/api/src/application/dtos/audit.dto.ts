export interface AuditEntryDto {
  id: string;
  skillId: string | null;
  skillVersion: string | null;
  proposalId: string | null;
  action: string;
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: Date;
}
