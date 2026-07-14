import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AgentAuthRequiredError,
  ConfigurationError,
  ConflictError,
  ForbiddenError,
  IntegrityError,
  InvalidStateError,
  JudgerProtocolError,
  JudgementRequiredError,
  JudgerTimeoutError,
  JudgerUnavailableError,
  NotFoundError,
  ProposalDisallowedPathError,
  ProposalFileLimitExceededError,
  ProposalFileSizeLimitExceededError,
  ProposalUploadNotFinalizableError,
  ProposalUploadNotOpenError,
  ProposalUploadValidationError,
  StorageError,
  UnauthorizedError,
  UnsupportedFileTypeError,
  ValidationError,
} from '../../../domain/errors';

export interface ApiErrorResponse {
  error: string;
  code: string;
  requestId: string;
  details?: Record<string, unknown>;
  originalError?: string;
}

interface SendApiErrorOptions {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  originalError?: string;
}

interface ApiErrorDefinition extends SendApiErrorOptions {
  logLevel?: 'warn' | 'error';
}

export function sendApiError(reply: FastifyReply, request: FastifyRequest, options: SendApiErrorOptions) {
  const payload: ApiErrorResponse = {
    error: options.message,
    code: options.code,
    requestId: request.id,
  };

  if (options.details && Object.keys(options.details).length > 0) {
    payload.details = options.details;
  }

  if (options.originalError && options.originalError !== options.message) {
    payload.originalError = options.originalError;
  }

  return reply.code(options.statusCode).send(payload);
}

export function sendMappedApiError(
  reply: FastifyReply,
  request: FastifyRequest,
  error: unknown,
  options: { admin?: boolean } = {}
) {
  const mapped = mapApiError(error, options);
  const logMethod = mapped.logLevel === 'warn' ? request.log.warn.bind(request.log) : request.log.error.bind(request.log);
  logMethod(
    {
      requestId: request.id,
      code: mapped.code,
      statusCode: mapped.statusCode,
      details: mapped.details,
      error: error instanceof Error ? error : undefined,
    },
    mapped.message
  );

  return sendApiError(reply, request, mapped);
}

export function registerApiErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    return sendMappedApiError(reply, request, error, { admin: isAdminRequest(request) });
  });
}

function mapApiError(error: unknown, options: { admin?: boolean }): ApiErrorDefinition {
  const admin = options.admin ?? false;

  if (error instanceof ConfigurationError) {
    return {
      statusCode: 503,
      code: 'CONFIGURATION_ERROR',
      message: error.message,
      logLevel: 'error',
    };
  }

  if (error instanceof NotFoundError) {
    return { statusCode: 404, code: 'NOT_FOUND', message: error.message, logLevel: 'warn' };
  }

  if (error instanceof UnsupportedFileTypeError) {
    return { statusCode: 422, code: 'UNSUPPORTED_FILE_TYPE', message: error.message, logLevel: 'warn' };
  }

  if (error instanceof ValidationError) {
    return { statusCode: 422, code: 'VALIDATION_ERROR', message: error.message, logLevel: 'warn' };
  }

  if (error instanceof JudgementRequiredError) {
    return {
      statusCode: 409,
      code: 'JUDGEMENT_REQUIRED',
      message: error.message,
      details: { missingTargets: error.missingTargets },
      logLevel: 'warn',
    };
  }

  if (error instanceof ProposalFileLimitExceededError) {
    return {
      statusCode: 422,
      code: 'PROPOSAL_FILE_LIMIT_EXCEEDED',
      message: 'Proposal file limit exceeded',
      details: {
        limit: error.limit,
        currentCount: error.currentCount,
        filePath: error.filePath,
        recommendation: 'Remove unnecessary files and keep only source artifacts plus setup manifests.',
      },
      logLevel: 'warn',
    };
  }

  if (error instanceof ProposalFileSizeLimitExceededError) {
    return {
      statusCode: 413,
      code: 'PROPOSAL_FILE_SIZE_LIMIT_EXCEEDED',
      message: 'Proposal file exceeds the configured per-file size limit',
      details: {
        limitBytes: error.limitBytes,
        sizeBytes: error.sizeBytes,
        filePath: error.filePath,
        recommendation: 'Split large assets out of the proposal or reduce the file size before upload.',
      },
      logLevel: 'warn',
    };
  }

  if (error instanceof ProposalDisallowedPathError) {
    return {
      statusCode: 422,
      code: 'PROPOSAL_DISALLOWED_PATH',
      message: 'Proposal file path is blocked by upload policy',
      details: {
        filePath: error.filePath,
        matchedPrefix: error.matchedPrefix,
        recommendation: 'Do not upload installed dependency trees; keep only source files and manifests.',
      },
      logLevel: 'warn',
    };
  }

  if (error instanceof ProposalUploadNotFinalizableError) {
    return {
      statusCode: 409,
      code: 'PROPOSAL_UPLOAD_NOT_FINALIZABLE',
      message: error.message,
      logLevel: 'warn',
    };
  }

  if (error instanceof ProposalUploadValidationError) {
    return {
      statusCode: 422,
      code: 'PROPOSAL_UPLOAD_VALIDATION_FAILED',
      message: error.message,
      details: {
        proposalId: error.proposalId,
        findings: error.findings,
      },
      logLevel: 'warn',
    };
  }

  if (error instanceof ProposalUploadNotOpenError) {
    return {
      statusCode: 409,
      code: 'PROPOSAL_UPLOAD_NOT_OPEN',
      message: error.message,
      details: {
        proposalId: error.proposalId,
        status: error.status,
      },
      logLevel: 'warn',
    };
  }

  if (error instanceof InvalidStateError || error instanceof ConflictError || error instanceof IntegrityError) {
    return { statusCode: 409, code: 'CONFLICT', message: error.message, logLevel: 'warn' };
  }

  if (error instanceof AgentAuthRequiredError) {
    return {
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: error.message,
      details: {
        authRequired: true,
        authArea: error.authArea,
        authScheme: error.authScheme,
        discoverUrl: error.discoverUrl,
        recommendation: error.authScheme === 'oidc'
          ? 'Read /discover for the trusted OIDC Device Authorization login link and start a new authorization when the token has expired.'
          : 'Read /discover for the agent-session URL, open it in a browser or browser tool to create a short-lived session, and paste the returned session code into chat. Do not paste bearer tokens into chat.',
      },
      logLevel: 'warn',
    };
  }

  if (error instanceof UnauthorizedError) {
    return { statusCode: 401, code: 'UNAUTHORIZED', message: error.message, logLevel: 'warn' };
  }

  if (error instanceof ForbiddenError) {
    return { statusCode: 403, code: 'FORBIDDEN', message: error.message, logLevel: 'warn' };
  }

  if (error instanceof JudgerUnavailableError) {
    return {
      statusCode: 503,
      code: 'JUDGER_UNAVAILABLE',
      message: 'Judgement provider is unavailable or misconfigured',
      logLevel: 'error',
    };
  }

  if (error instanceof JudgerTimeoutError) {
    return { statusCode: 504, code: 'JUDGER_TIMEOUT', message: 'Judgement provider timed out', logLevel: 'error' };
  }

  if (error instanceof JudgerProtocolError) {
    return {
      statusCode: 502,
      code: 'JUDGER_PROTOCOL_ERROR',
      message: 'Judgement provider returned an invalid response',
      logLevel: 'error',
    };
  }

  if (error instanceof StorageError) {
    return {
      statusCode: 503,
      code: 'STORAGE_UNAVAILABLE',
      message: 'Storage is temporarily unavailable',
      originalError: admin ? error.message : undefined,
      logLevel: 'error',
    };
  }

  const fastifyError = error as Partial<FastifyError> | undefined;
  if (fastifyError?.code === 'FST_REQ_FILE_TOO_LARGE' || fastifyError?.statusCode === 413) {
    return {
      statusCode: 413,
      code: 'FILE_TOO_LARGE',
      message: 'Uploaded file exceeds the size limit',
      originalError: admin && typeof fastifyError.message === 'string' ? fastifyError.message : undefined,
      logLevel: 'warn',
    };
  }

  if (fastifyError?.validation) {
    return {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: { validation: fastifyError.validation as unknown as Record<string, unknown> },
      originalError: admin && typeof fastifyError.message === 'string' ? fastifyError.message : undefined,
      logLevel: 'warn',
    };
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    originalError: admin ? getOriginalErrorMessage(error) : undefined,
    logLevel: 'error',
  };
}

function getOriginalErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return undefined;
}

function isAdminRequest(request: FastifyRequest): boolean {
  return request.url.startsWith('/admin');
}
