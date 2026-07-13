import { Proposal } from '../../../domain/proposal/Proposal';
import { Skill } from '../../../domain/skill/Skill';

export interface SkillRepositoryPort {
  save(skill: Skill): Promise<void>;
  findById(id: string): Promise<Skill | null>;
  findAll(options?: { category?: string; status?: string; limit?: number; offset?: number }): Promise<{ items: Skill[]; total: number }>;
  exists(id: string): Promise<boolean>;
  saveProposal(proposal: Proposal): Promise<void>;
  findProposalById(id: string): Promise<Proposal | null>;
  findProposals(options?: { skillId?: string; status?: string }): Promise<{ items: Proposal[]; total: number }>;
  deleteProposal(id: string): Promise<void>;
}
