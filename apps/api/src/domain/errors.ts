export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidStateError extends DomainError {}
export class ValidationError extends DomainError {}
export class NotFoundError extends DomainError {}
export class ConflictError extends DomainError {}
export class UnauthorizedError extends DomainError {}
export class ForbiddenError extends DomainError {}
export class AgentAuthRequiredError extends UnauthorizedError {
  constructor(
    public readonly authArea: 'discovery' | 'public-read' | 'proposal',
    public readonly authScheme: 'bearer' | 'oidc',
    public readonly discoverUrl: string,
    public readonly credentialSetupScriptUrl: string | undefined
  ) {
    super('Agent API authentication required');
  }
}
export class StorageError extends DomainError {}
export class IntegrityError extends DomainError {}
export class JudgerUnavailableError extends DomainError {}
export class JudgerTimeoutError extends DomainError {}
export class UnsupportedFileTypeError extends DomainError {}
export class JudgerProtocolError extends DomainError {}
export class JudgementRequiredError extends DomainError {
  constructor(public readonly missingTargets: string[]) {
    super('Publishing requires a real judgement for the skill version and every extractable file.');
  }
}
export class ConfigurationError extends DomainError {}
export class ProposalFileLimitExceededError extends DomainError {
  constructor(
    public readonly limit: number,
    public readonly currentCount: number,
    public readonly filePath: string
  ) {
    super(`Proposal file limit exceeded for ${filePath}. Limit is ${limit} files.`);
  }
}
export class ProposalFileSizeLimitExceededError extends DomainError {
  constructor(
    public readonly limitBytes: number,
    public readonly sizeBytes: number,
    public readonly filePath: string
  ) {
    super(`Proposal file ${filePath} exceeds the configured size limit.`);
  }
}
export class ProposalDisallowedPathError extends DomainError {
  constructor(
    public readonly filePath: string,
    public readonly matchedPrefix: string
  ) {
    super(`Proposal file path ${filePath} is blocked by upload policy.`);
  }
}
export class ProposalUploadNotOpenError extends DomainError {
  constructor(
    public readonly proposalId: string,
    public readonly status: string
  ) {
    super(`Proposal ${proposalId} is not open for upload in status ${status}.`);
  }
}
export class ProposalUploadNotFinalizableError extends DomainError {
  constructor(
    public readonly proposalId: string,
    message: string
  ) {
    super(message);
  }
}

export class ProposalUploadValidationError extends DomainError {
  constructor(
    public readonly proposalId: string,
    public readonly findings: unknown[]
  ) {
    super('Proposal package references are inconsistent with the uploaded file structure.');
  }
}
