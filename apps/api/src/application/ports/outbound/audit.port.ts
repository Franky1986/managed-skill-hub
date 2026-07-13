import { AuditEntry } from '../../../domain/audit/AuditEntry';

export interface AuditLogPort {
  append(entry: AuditEntry): Promise<void>;
  findBySkillId(skillId: string): Promise<AuditEntry[]>;
  findByProposalId(proposalId: string): Promise<AuditEntry[]>;
  findAll(): Promise<AuditEntry[]>;
}
