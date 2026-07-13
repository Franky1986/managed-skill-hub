import { Proposal } from '../../../domain/proposal/Proposal';
import { Skill } from '../../../domain/skill/Skill';
import { AutoPublishEvaluation } from '../../usecases/proposal/auto-publish-proposal.usecase';

export interface SubmitProposalDraft {
  skillId?: string;
  title: string;
  description: string;
  category: string;
  tags?: string[];
  capabilities?: string[];
  entrypoint?: string;
}

export interface ProposalMetadataUpdate {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  capabilities?: string[];
  entrypoint?: string | null;
}

export interface FinalizeProposalUploadResult {
  proposal: Proposal;
  autoPublish: AutoPublishEvaluation;
}

export interface ValidateProposalUploadResult {
  proposalId: string;
  status: string;
  valid: boolean;
  fileCount: number;
  checkedTextFileCount: number;
  findings: ProposalUploadFinding[];
}

export type ProposalUploadFindingKind =
  | 'empty_upload'
  | 'external_reference'
  | 'missing_package_reference'
  | 'outside_root_reference'
  | 'portable_command_manifest_invalid'
  | 'portable_command_manifest_missing'
  | 'portable_command_missing'
  | 'portable_command_reference';

export type ProposalUploadFindingSeverity = 'error' | 'warning' | 'info';

export interface ProposalUploadFinding {
  kind: ProposalUploadFindingKind;
  severity: ProposalUploadFindingSeverity;
  blocksFinalize: boolean;
  message: string;
  file: string | null;
  line: number | null;
  candidate: string | null;
  suggestedReplacement: string | null;
}

export interface ProposalCommandPort {
  submitProposal(draft: SubmitProposalDraft, actor: string): Promise<Proposal>;
  updateProposalMetadata(proposalId: string, update: ProposalMetadataUpdate, actor: string): Promise<Proposal>;
  attachFile(proposalId: string, file: { path: string; content: Buffer; mimeType: string }, actor: string): Promise<Proposal>;
  validateUpload(proposalId: string, actor: string): Promise<ValidateProposalUploadResult>;
  finalizeUpload(proposalId: string, actor: string): Promise<FinalizeProposalUploadResult>;
  deleteProposal(proposalId: string, actor: string): Promise<void>;
  rejectProposal?(proposalId: string, actor: string, reason?: string | null, comment?: string | null): Promise<Proposal>;
  convertProposal?(proposalId: string, actor: string, comment?: string | null): Promise<Skill>;
}
