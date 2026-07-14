import { Proposal } from '../../../domain/proposal/Proposal';
import {
  FinalizeProposalUploadResult,
  ProposalCommandPort,
  ProposalMetadataUpdate,
  ProposalActor,
  ProposalUploadFinding,
  SubmitProposalDraft,
  ValidateProposalUploadResult,
} from '../../ports/inbound/proposal-command.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillJudgerPort } from '../../ports/outbound/judger.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { SkillId } from '../../../domain/skill/SkillId';
import {
  ForbiddenError,
  ProposalDisallowedPathError,
  ProposalFileLimitExceededError,
  ProposalFileSizeLimitExceededError,
  ProposalUploadNotFinalizableError,
  ProposalUploadNotOpenError,
  ProposalUploadValidationError,
  ValidationError,
} from '../../../domain/errors';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { buildProposalAggregateFromCatalog } from './catalog-proposal-hydrator';
import { AutoPublishProposalUseCase } from './auto-publish-proposal.usecase';
import { isExtractableArtifact, isTextLikeArtifact } from '../skill/public-metadata';
import { normalizeRelativeArtifactPath } from '../../../domain/files/relative-artifact-path';
import { JudgementRuntimeEventSink, judgementErrorCategory } from '../judgement/judgement-runtime-event';

interface ProposalUploadConfig {
  maxFiles: number;
  maxFileSizeBytes: number;
  disallowedPathPrefixes: string[];
}

export class SubmitProposalUseCase implements ProposalCommandPort {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly audit: AuditLogPort,
    private readonly judger: SkillJudgerPort,
    private readonly scanner: FileScannerPort,
    private readonly catalog?: SkillCatalogPort,
    private readonly uploadConfig: ProposalUploadConfig = {
      maxFiles: 30,
      maxFileSizeBytes: 10 * 1024 * 1024,
      disallowedPathPrefixes: ['node_modules/', '.venv/', 'venv/', 'vendor/', 'dist-packages/', 'site-packages/'],
    },
    private readonly autoPublish?: AutoPublishProposalUseCase,
    private readonly judgementEvents?: JudgementRuntimeEventSink
  ) {}

  async submitProposal(draft: SubmitProposalDraft, actor: ProposalActor): Promise<Proposal> {
    const actorContext = normalizeProposalActor(actor);
    const normalizedSkillId = draft.skillId ? draft.skillId.trim().toLowerCase() : null;
    if (normalizedSkillId) {
      try {
        SkillId.create(normalizedSkillId);
      } catch {
        throw new ValidationError(`Invalid skillId: ${draft.skillId}`);
      }
    }

    let proposal = Proposal.create({
      skillId: normalizedSkillId,
      title: draft.title,
      description: draft.description,
      category: draft.category,
      tags: draft.tags,
      capabilities: draft.capabilities,
      entrypoint: draft.entrypoint ?? null,
      submittedBy: actorContext.label,
      submittedByPrincipalId: actorContext.principalId,
      submittedViaClientId: actorContext.clientId,
    });

    await this.repo.saveProposal(proposal);

    await this.audit.append(
      AuditEntry.create({
        proposalId: proposal.id,
        action: 'submit_proposal',
        ...auditActor(actorContext),
        after: { id: proposal.id, title: proposal.title, status: proposal.status },
      })
    );

    return proposal;
  }

  async updateProposalMetadata(proposalId: string, update: ProposalMetadataUpdate, actor: ProposalActor): Promise<Proposal> {
    const actorContext = normalizeProposalActor(actor);
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new ValidationError(`Proposal ${proposalId} not found`);
    }
    this.assertProposalOwner(proposal, actorContext);
    if (proposal.status !== 'in_upload') {
      throw new ProposalUploadNotOpenError(proposalId, proposal.status);
    }
    if (Object.keys(update).length === 0) {
      throw new ValidationError('No metadata provided for update');
    }

    const updated = proposal.updateMetadata(update);
    await this.repo.saveProposal(updated);
    await this.audit.append(
      AuditEntry.create({
        proposalId: proposal.id,
        action: 'update_proposal_metadata',
        ...auditActor(actorContext),
        before: {
          title: proposal.title,
          description: proposal.description,
          category: proposal.category,
          tags: proposal.tags,
          capabilities: proposal.capabilities,
          entrypoint: proposal.entrypoint,
        },
        after: {
          title: updated.title,
          description: updated.description,
          category: updated.category,
          tags: updated.tags,
          capabilities: updated.capabilities,
          entrypoint: updated.entrypoint,
        },
      })
    );

    return updated;
  }

  async attachFile(proposalId: string, file: { path: string; content: Buffer; mimeType: string }, actor: ProposalActor): Promise<Proposal> {
    const actorContext = normalizeProposalActor(actor);
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new ValidationError(`Proposal ${proposalId} not found`);
    }
    this.assertProposalOwner(proposal, actorContext);
    if (proposal.status !== 'in_upload') {
      throw new ProposalUploadNotOpenError(proposalId, proposal.status);
    }

    const normalizedPath = normalizeProposalUploadPath(file.path);
    const matchedDisallowedPrefix = matchDisallowedPathPrefix(normalizedPath, this.uploadConfig.disallowedPathPrefixes);
    if (matchedDisallowedPrefix) {
      throw new ProposalDisallowedPathError(normalizedPath, matchedDisallowedPrefix);
    }
    const replacesExistingFile = proposal.files.some((existing) => existing.path === normalizedPath);
    if (!replacesExistingFile && proposal.files.length >= this.uploadConfig.maxFiles) {
      throw new ProposalFileLimitExceededError(this.uploadConfig.maxFiles, proposal.files.length, normalizedPath);
    }
    if (file.content.length > this.uploadConfig.maxFileSizeBytes) {
      throw new ProposalFileSizeLimitExceededError(
        this.uploadConfig.maxFileSizeBytes,
        file.content.length,
        normalizedPath
      );
    }

    const stored = await this.storage.storeProposalFile(proposalId, normalizedPath, file.content, file.mimeType);

    const updated = proposal.addFile({
      id: stored.path,
      path: stored.path,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
    });
    await this.repo.saveProposal(updated);

    await this.audit.append(
      AuditEntry.create({
        proposalId: proposal.id,
        action: replacesExistingFile ? 'replace_proposal_file' : 'attach_proposal_file',
        ...auditActor(actorContext),
        after: { proposalId, file: stored.path, sizeBytes: stored.sizeBytes, status: updated.status, replaced: replacesExistingFile },
      })
    );

    return updated;
  }

  async finalizeUpload(proposalId: string, actor: ProposalActor): Promise<FinalizeProposalUploadResult> {
    const actorContext = normalizeProposalActor(actor);
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new ValidationError(`Proposal ${proposalId} not found`);
    }
    this.assertProposalOwner(proposal, actorContext);
    if (proposal.status !== 'in_upload') {
      throw new ProposalUploadNotOpenError(proposalId, proposal.status);
    }
    if (proposal.files.length === 0) {
      throw new ProposalUploadNotFinalizableError(
        proposalId,
        'Proposal upload cannot be finalized without at least one file.'
      );
    }
    const validation = await this.validateUpload(proposalId, actor);
    if (!validation.valid) {
      throw new ProposalUploadValidationError(proposalId, validation.findings);
    }

    let updated = proposal.finalizeUpload();
    await this.repo.saveProposal(updated);
    await this.audit.append(
      AuditEntry.create({
        proposalId,
        action: 'finalize_proposal_upload',
        ...auditActor(actorContext),
        before: { status: proposal.status, fileCount: proposal.files.length },
        after: { status: updated.status, fileCount: updated.files.length },
      })
    );

    const extractedByPath = await this.extractProposalArtifacts(updated, actorContext);
    updated = await this.judgeProposalText(updated, actorContext);
    updated = await this.judgeProposalFiles(updated, actorContext, extractedByPath);
    const autoPublish = this.autoPublish
      ? await this.autoPublish.execute(updated.id)
      : {
          enabled: false,
          eligible: null,
          blockedReason: null,
          blockedByCategory: null,
          classifierReason: null,
          matchedExcludedCategory: null,
          autoPublished: false,
          publishedSkillId: null,
          publishedVersion: null,
        };
    const finalProposal = await this.loadProposal(proposalId);
    return {
      proposal: finalProposal ?? updated,
      autoPublish,
    };
  }

  async validateUpload(proposalId: string, actor: ProposalActor): Promise<ValidateProposalUploadResult> {
    const actorContext = normalizeProposalActor(actor);
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new ValidationError(`Proposal ${proposalId} not found`);
    }
    this.assertProposalOwner(proposal, actorContext);
    if (proposal.status !== 'in_upload') {
      throw new ProposalUploadNotOpenError(proposalId, proposal.status);
    }
    if (proposal.files.length === 0) {
      return {
        proposalId,
        status: proposal.status,
        valid: false,
        fileCount: 0,
        checkedTextFileCount: 0,
        findings: [createUploadFinding({
          kind: 'empty_upload',
          severity: 'error',
          blocksFinalize: true,
          message: 'Proposal upload cannot be finalized without at least one file.',
        })],
      };
    }

    const referenceValidation = await this.validateProposalReferences(proposal);
    return {
      proposalId,
      status: proposal.status,
      valid: !referenceValidation.findings.some((finding) => finding.blocksFinalize),
      fileCount: proposal.files.length,
      checkedTextFileCount: referenceValidation.checkedTextFileCount,
      findings: referenceValidation.findings,
    };
  }

  async deleteProposal(proposalId: string, actor: ProposalActor) {
    const actorContext = normalizeProposalActor(actor);
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new ValidationError(`Proposal ${proposalId} not found`);
    }
    this.assertProposalOwner(proposal, actorContext);
    if (proposal.status !== 'in_upload') {
      throw new ProposalUploadNotOpenError(proposalId, proposal.status);
    }
    await this.repo.deleteProposal(proposalId);
    await this.audit.append(
      AuditEntry.create({
        proposalId,
        action: 'delete_proposal',
        ...auditActor(actorContext),
        before: { status: proposal.status },
      })
    );
  }

  private async loadProposal(proposalId: string): Promise<Proposal | null> {
    const sourceProposal = await this.repo.findProposalById(proposalId);
    if (sourceProposal) {
      return sourceProposal;
    }

    if (this.catalog) {
      const proposal = await buildProposalAggregateFromCatalog(this.catalog, proposalId);
      if (proposal) {
        return proposal;
      }
    }

    return null;
  }

  private assertProposalOwner(
    proposal: Proposal,
    actor: ReturnType<typeof normalizeProposalActor>
  ): void {
    const ownerMatches = proposal.submittedByPrincipalId
      ? actor.principalId === proposal.submittedByPrincipalId
      : proposal.submittedBy === actor.label;
    if (!ownerMatches) {
      throw new ForbiddenError(`Proposal ${proposal.id} can only be changed by its submitting actor.`);
    }
  }

  private async judgeProposalText(
    proposal: Proposal,
    actor: ReturnType<typeof normalizeProposalActor>
  ): Promise<Proposal> {
    let updated = proposal;
    try {
      const proposalJudgement = await this.judger.judge({
        type: 'proposal',
        id: proposal.id,
        title: proposal.title,
        text: `${proposal.title}\n\n${proposal.description}`,
        metadata: { groups: proposal.groups, capabilities: proposal.capabilities },
      });
      updated = updated.addJudgement(proposalJudgement);
      await this.repo.saveProposal(updated);
      this.judgementEvents?.({
        event: 'judgement_execution',
        outcome: 'success',
        operation: 'proposal',
        proposalId: proposal.id,
      });
    } catch (error) {
      await this.audit.append(
        AuditEntry.create({
          proposalId: proposal.id,
          action: 'proposal_judgement_failed',
          ...auditActor(actor),
          after: { error: (error as Error).message },
        })
      );
      this.judgementEvents?.({
        event: 'judgement_execution',
        outcome: 'failure',
        operation: 'proposal',
        proposalId: proposal.id,
        errorCategory: judgementErrorCategory(error),
      });
    }
    return updated;
  }

  private async extractProposalArtifacts(
    proposal: Proposal,
    actor: ReturnType<typeof normalizeProposalActor>
  ): Promise<Map<string, { text: string; metadata: Record<string, unknown>; extractedBy: string }>> {
    const extractedByPath = new Map<string, { text: string; metadata: Record<string, unknown>; extractedBy: string }>();

    for (const file of proposal.files) {
      const stored = await this.storage.readProposalFile(proposal.id, file.path);
      if (!stored || !isExtractableArtifact(stored.mimeType, file.path)) {
        continue;
      }

      try {
        const extracted = isTextLikeArtifact(stored.mimeType, file.path)
          ? {
              text: stored.content.toString('utf-8'),
              metadata: { mimeType: stored.mimeType, filePath: file.path, extractor: 'native' },
              extractedBy: 'native',
            }
          : await this.scanner.scan(stored.content, stored.mimeType, file.path);

        await this.storage.storeProposalFileExtract(proposal.id, file.path, extracted);
        extractedByPath.set(file.path, extracted);
      } catch (error) {
        await this.audit.append(
          AuditEntry.create({
            proposalId: proposal.id,
            action: 'extract_proposal_file_failed',
            ...auditActor(actor),
            after: { file: file.path, error: (error as Error).message },
          })
        );
      }
    }

    return extractedByPath;
  }

  private async judgeProposalFiles(
    proposal: Proposal,
    actor: ReturnType<typeof normalizeProposalActor>,
    extractedByPath: Map<string, { text: string; metadata: Record<string, unknown>; extractedBy: string }>
  ): Promise<Proposal> {
    let updated = proposal;
    for (const file of proposal.files) {
      try {
        const stored = await this.storage.readProposalFile(proposal.id, file.path);
        if (!stored) {
          throw new ValidationError(`Proposal file ${file.path} not found`);
        }
        const scanned = extractedByPath.get(file.path)
          ?? (
            isTextLikeArtifact(stored.mimeType, file.path)
              ? {
                  text: stored.content.toString('utf-8'),
                  metadata: { mimeType: stored.mimeType, filePath: file.path, extractor: 'native' },
                  extractedBy: 'native',
                }
              : await this.scanner.scan(stored.content, stored.mimeType, file.path)
          );
        const fileJudgement = await this.judger.judge({
          type: 'file',
          id: `${proposal.id}:${file.path}`,
          title: file.path,
          text: scanned.text,
          metadata: { mimeType: file.mimeType, sizeBytes: file.sizeBytes },
        });
        updated = updated.addJudgement(fileJudgement);
        await this.repo.saveProposal(updated);
        this.judgementEvents?.({
          event: 'judgement_execution',
          outcome: 'success',
          operation: 'proposal_file',
          proposalId: proposal.id,
          filePath: file.path,
        });
      } catch (error) {
        await this.audit.append(
          AuditEntry.create({
            proposalId: proposal.id,
            action: 'file_judgement_failed',
            ...auditActor(actor),
            after: { file: file.path, error: (error as Error).message },
          })
        );
        this.judgementEvents?.({
          event: 'judgement_execution',
          outcome: 'failure',
          operation: 'proposal_file',
          proposalId: proposal.id,
          filePath: file.path,
          errorCategory: judgementErrorCategory(error),
        });
      }
    }
    return updated;
  }

  private async validateProposalReferences(proposal: Proposal): Promise<{ checkedTextFileCount: number; findings: ProposalUploadFinding[] }> {
    const knownFiles = new Set(proposal.files.map((file) => file.path));
    const knownDirectories = new Set<string>();
    for (const filePath of knownFiles) {
      const segments = filePath.split('/');
      for (let i = 1; i < segments.length; i++) {
        knownDirectories.add(`${segments.slice(0, i).join('/')}/`);
      }
    }

    const findings = new Map<string, ProposalUploadFinding>();
    const hasCommandFiles = [...knownFiles].some((filePath) => isPortableCommandFile(filePath));
    const hasCommandManifest = knownFiles.has('commands/manifest.json');
    if (hasCommandFiles && !hasCommandManifest) {
      const finding = createUploadFinding({
        kind: 'portable_command_manifest_missing',
        severity: 'warning',
        blocksFinalize: false,
        file: null,
        line: null,
        candidate: 'commands/',
        suggestedReplacement: 'commands/manifest.json',
        message: 'Package contains portable command files but no commands/manifest.json. Add a manifest so consuming agents can map commands to Cursor, Codex, Claude Code, or a generic command folder.',
      });
      findings.set(uploadFindingKey(finding), finding);
    }
    if (hasCommandManifest) {
      for (const finding of await this.validatePortableCommandManifest(proposal.id, knownFiles)) {
        findings.set(uploadFindingKey(finding), finding);
      }
    }
    let checkedTextFileCount = 0;
    for (const file of proposal.files) {
      const stored = await this.storage.readProposalFile(proposal.id, file.path);
      if (!stored || !isTextLikeArtifact(stored.mimeType, file.path)) {
        continue;
      }
      checkedTextFileCount += 1;

      if (file.path === 'commands/manifest.json') {
        continue;
      }

      const content = stored.content.toString('utf-8');
      for (const reference of collectReferenceCandidates(content)) {
        const candidate = reference.value;
        if (isKnownReference(candidate, knownFiles, knownDirectories)) {
          continue;
        }

        const externalReference = classifyExternalReference(candidate, file.path, reference.line, knownFiles);
        if (externalReference) {
          findings.set(uploadFindingKey(externalReference), externalReference);
          continue;
        }

        const matchedFile = [...knownFiles].find((knownPath) => candidate.endsWith(`/${knownPath}`));
        const matchedDirectory = [...knownDirectories].find((knownPath) => candidate.endsWith(`/${knownPath}`));
        if (matchedFile || matchedDirectory) {
          const suggestedReplacement = matchedFile ?? matchedDirectory ?? null;
          const finding = createUploadFinding({
            kind: 'outside_root_reference',
            severity: 'error',
            blocksFinalize: true,
            file: file.path,
            line: reference.line,
            candidate,
            suggestedReplacement,
            message: `Outside-root reference "${candidate}" should point to package-relative "${suggestedReplacement}".`,
          });
          findings.set(uploadFindingKey(finding), finding);
          continue;
        }

        if (looksLikePackageArtifactReference(candidate)) {
          const finding = createUploadFinding({
            kind: 'missing_package_reference',
            severity: 'error',
            blocksFinalize: true,
            file: file.path,
            line: reference.line,
            candidate,
            suggestedReplacement: null,
            message: `Missing package reference "${candidate}".`,
          });
          findings.set(uploadFindingKey(finding), finding);
        }
      }
    }

    return { checkedTextFileCount, findings: [...findings.values()] };
  }

  private async validatePortableCommandManifest(proposalId: string, knownFiles: Set<string>): Promise<ProposalUploadFinding[]> {
    const stored = await this.storage.readProposalFile(proposalId, 'commands/manifest.json');
    if (!stored) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored.content.toString('utf-8'));
    } catch {
      return [createUploadFinding({
        kind: 'portable_command_manifest_invalid',
        severity: 'warning',
        blocksFinalize: false,
        file: 'commands/manifest.json',
        line: null,
        candidate: 'commands/manifest.json',
        suggestedReplacement: null,
        message: 'commands/manifest.json is not valid JSON. Consuming agents may ignore portable command metadata.',
      })];
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.commands)) {
      return [createUploadFinding({
        kind: 'portable_command_manifest_invalid',
        severity: 'warning',
        blocksFinalize: false,
        file: 'commands/manifest.json',
        line: null,
        candidate: 'commands',
        suggestedReplacement: null,
        message: 'commands/manifest.json should contain a commands array with package-relative command source paths.',
      })];
    }

    const findings: ProposalUploadFinding[] = [];
    const seenCommandIds = new Set<string>();
    for (const [index, command] of parsed.commands.entries()) {
      if (!isRecord(command)) {
        findings.push(createUploadFinding({
          kind: 'portable_command_manifest_invalid',
          severity: 'warning',
          blocksFinalize: false,
          file: 'commands/manifest.json',
          line: null,
          candidate: `commands[${index}]`,
          suggestedReplacement: null,
          message: `commands/manifest.json command entry ${index} should be an object.`,
        }));
        continue;
      }

      const id = typeof command.id === 'string' ? command.id.trim() : '';
      if (id) {
        if (seenCommandIds.has(id)) {
          findings.push(createUploadFinding({
            kind: 'portable_command_manifest_invalid',
            severity: 'warning',
            blocksFinalize: false,
            file: 'commands/manifest.json',
            line: null,
            candidate: id,
            suggestedReplacement: null,
            message: `commands/manifest.json contains duplicate command id "${id}".`,
          }));
        }
        seenCommandIds.add(id);
      }

      const source = typeof command.source === 'string' ? command.source.trim().replace(/\\/g, '/') : '';
      if (!source) {
        findings.push(createUploadFinding({
          kind: 'portable_command_manifest_invalid',
          severity: 'warning',
          blocksFinalize: false,
          file: 'commands/manifest.json',
          line: null,
          candidate: id || `commands[${index}]`,
          suggestedReplacement: null,
          message: `commands/manifest.json command "${id || index}" should define a package-relative source path.`,
        }));
        continue;
      }
      if (!source.startsWith('commands/') || source === 'commands/manifest.json' || !knownFiles.has(source)) {
        findings.push(createUploadFinding({
          kind: 'portable_command_manifest_invalid',
          severity: 'warning',
          blocksFinalize: false,
          file: 'commands/manifest.json',
          line: null,
          candidate: source,
          suggestedReplacement: source.startsWith('commands/') ? null : `commands/${source.split('/').at(-1) ?? source}`,
          message: `commands/manifest.json source "${source}" should point to an uploaded command file under commands/.`,
        }));
      }
    }

    return findings;
  }
}

function normalizeProposalActor(actor: ProposalActor): {
  label: string;
  principalId: string | null;
  clientId: string | null;
} {
  return typeof actor === 'string'
    ? { label: actor, principalId: null, clientId: null }
    : { label: actor.label, principalId: actor.principalId, clientId: actor.clientId };
}

function auditActor(actor: ReturnType<typeof normalizeProposalActor>) {
  return {
    actor: actor.label,
    actorPrincipalId: actor.principalId,
    actorDisplayName: actor.label,
    actorClientId: actor.clientId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createUploadFinding(props: {
  kind: ProposalUploadFinding['kind'];
  severity: ProposalUploadFinding['severity'];
  blocksFinalize: boolean;
  message: string;
  file?: string | null;
  line?: number | null;
  candidate?: string | null;
  suggestedReplacement?: string | null;
}): ProposalUploadFinding {
  return {
    kind: props.kind,
    severity: props.severity,
    blocksFinalize: props.blocksFinalize,
    message: props.message,
    file: props.file ?? null,
    line: props.line ?? null,
    candidate: props.candidate ?? null,
    suggestedReplacement: props.suggestedReplacement ?? null,
  };
}

function uploadFindingKey(finding: ProposalUploadFinding): string {
  return [
    finding.kind,
    finding.file ?? '',
    finding.line ?? '',
    finding.candidate ?? '',
    finding.suggestedReplacement ?? '',
  ].join('|');
}

function classifyExternalReference(candidate: string, file: string, line: number, knownFiles: Set<string>): ProposalUploadFinding | null {
  const normalized = candidate.replace(/\\/g, '/');
  if (/^CursorProjects\//.test(normalized)) {
    return createUploadFinding({
      kind: 'external_reference',
      severity: 'warning',
      blocksFinalize: false,
      file,
      line,
      candidate,
      suggestedReplacement: null,
      message: `External workspace reference "${candidate}" is treated as documentation-only. If the skill requires it at runtime, copy the artifact into the package and reference it relatively.`,
    });
  }
  const portableCommand = toPortableCommandPath(normalized);
  if (portableCommand) {
    const commandExists = knownFiles.has(portableCommand);
    return createUploadFinding({
      kind: commandExists ? 'portable_command_reference' : 'portable_command_missing',
      severity: 'warning',
      blocksFinalize: false,
      file,
      line,
      candidate,
      suggestedReplacement: portableCommand,
      message: commandExists
        ? `Agent command reference "${candidate}" points to a runtime-specific location. Reference the packaged portable command artifact "${portableCommand}" instead.`
        : `Agent command reference "${candidate}" is outside the package. If the skill should ship this shortcut, copy it into "${portableCommand}" and add commands/manifest.json; otherwise document it as historical or external.`,
    });
  }
  return null;
}

function isPortableCommandFile(filePath: string): boolean {
  return /^commands\/.+/i.test(filePath) && filePath !== 'commands/manifest.json';
}

function toPortableCommandPath(candidate: string): string | null {
  const match = candidate.match(/^\.?(?:cursor|codex|claude)\/commands\/(.+)$/i);
  if (!match?.[1]) {
    return null;
  }
  return `commands/${match[1].replace(/^\/+/, '')}`;
}

function normalizeProposalUploadPath(filePath: string): string {
  return normalizeRelativeArtifactPath(filePath, {
    allowLeadingSlashTrim: true,
    fieldLabel: 'Proposal file path',
  });
}

function matchDisallowedPathPrefix(filePath: string, disallowedPrefixes: string[]): string | null {
  const normalizedPath = filePath.toLowerCase();
  for (const prefix of disallowedPrefixes) {
    const normalizedPrefix = prefix.trim().toLowerCase().replace(/\\/g, '/');
    if (!normalizedPrefix) {
      continue;
    }
    if (normalizedPath === normalizedPrefix.replace(/\/+$/, '') || normalizedPath.startsWith(normalizedPrefix)) {
      return prefix;
    }
  }
  return null;
}

interface ReferenceCandidate {
  value: string;
  line: number;
}

function collectReferenceCandidates(content: string): ReferenceCandidate[] {
  const candidates = new Map<string, ReferenceCandidate>();
  const patterns = [
    /\[[^\]]*]\(([^)\s]+)\)/g,
    /`([^`\n]*\/[^`\n]*)`/g,
    /\b(?:\.cursor|\.codex|\.claude|CursorProjects)[^\s'"`)]*/g,
    /\b(?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)?\/?\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const raw = (match[1] ?? match[0] ?? '').trim();
      const normalized = raw.replace(/^[("'`]+|[)"'`,.;:!?]+$/g, '');
      if (!normalized || normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('~/') || normalized.startsWith('/')) {
        continue;
      }
      const line = lineNumberAt(content, match.index ?? 0);
      const key = `${line}:${canonicalReferenceCandidateKey(normalized)}`;
      if (!candidates.has(key) || normalized.startsWith('.')) {
        candidates.set(key, { value: normalized, line });
      }
    }
  }

  return [...candidates.values()];
}

function canonicalReferenceCandidateKey(candidate: string): string {
  return candidate.replace(/^\.?((?:cursor|codex|claude)\/(?:skills|commands)\/)/i, '$1');
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function isKnownReference(candidate: string, knownFiles: Set<string>, knownDirectories: Set<string>): boolean {
  return knownFiles.has(candidate) || knownDirectories.has(candidate);
}

function looksLikePackageArtifactReference(candidate: string): boolean {
  if (!candidate.includes('/')
    || candidate.startsWith('GET /')
    || candidate.startsWith('POST /')
    || candidate.startsWith('PUT /')
    || candidate.startsWith('PATCH /')
    || candidate.startsWith('DELETE /')) {
    return false;
  }

  const normalized = candidate.replace(/\\/g, '/');
  if (/^HTTP\/\d+(?:\.\d+)*$/i.test(normalized)) {
    return false;
  }
  if (/\{[^}/]+}/.test(normalized)) {
    return false;
  }
  if (/^(?:\.cursor|\.codex|\.claude|CursorProjects)\//.test(normalized)) {
    return true;
  }
  if (/^(?:\.{1,2}\/)/.test(normalized)) {
    return true;
  }
  if (/^(?:agents|assets|docs|examples|fixtures|images|prompts|references|scripts|templates|tests)\//i.test(normalized)) {
    return true;
  }
  return /\.[A-Za-z0-9]{1,12}(?:[#?][^/]*)?$/.test(normalized.split('/').at(-1) ?? '');
}
