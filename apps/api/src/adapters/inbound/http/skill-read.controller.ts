import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { promises as fs } from 'fs';
import { Container } from '../../../infrastructure/container';
import { SkillSearchQuery } from '../../../application/ports/inbound/skill-query.port';
import { NotFoundError, UnsupportedFileTypeError, ValidationError } from '../../../domain/errors';
import { sendApiError, sendMappedApiError } from './error-response';
import { AgentApiAuth } from './agent-api-auth';
import { normalizeRelativeArtifactPath } from '../../../domain/files/relative-artifact-path';
import { sendArtifactResponse } from './artifact-response';
import { AdminAuth } from './admin-auth';
import { ListSkillsUseCase } from '../../../application/usecases/skill/list-skills.usecase';

function parseTagQuery(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => item.trim()).filter(Boolean);
}

function buildZipArchive(files: Array<{ path: string; content: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  const crcTable = new Array<number>(256).fill(0).map((_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    return value >>> 0;
  });

  const crc32 = (buffer: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      const tableIndex = (crc ^ byte) & 0xff;
      crc = (crc >>> 8) ^ crcTable[tableIndex];
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  for (const file of files) {
    const fileName = Buffer.from(file.path, 'utf-8');
    const crc = crc32(file.content);
    const fileHeader = Buffer.alloc(30);
    let cursor = 0;
    fileHeader.writeUInt32LE(0x04034b50, cursor); // local header signature
    cursor += 4;
    fileHeader.writeUInt16LE(20, cursor); // version needed
    cursor += 2;
    fileHeader.writeUInt16LE(0, cursor); // flags
    cursor += 2;
    fileHeader.writeUInt16LE(0, cursor); // stored
    cursor += 2;
    fileHeader.writeUInt16LE(0, cursor); // mod time
    cursor += 2;
    fileHeader.writeUInt16LE(0, cursor); // mod date
    cursor += 2;
    fileHeader.writeUInt32LE(crc, cursor);
    cursor += 4;
    fileHeader.writeUInt32LE(file.content.length, cursor); // compressed
    cursor += 4;
    fileHeader.writeUInt32LE(file.content.length, cursor); // uncompressed
    cursor += 4;
    fileHeader.writeUInt16LE(fileName.length, cursor);
    cursor += 2;
    fileHeader.writeUInt16LE(0, cursor); // extra
    cursor += 2;

    localParts.push(fileHeader, fileName, file.content);
    const localOffset = offset;
    offset += fileHeader.length + fileName.length + file.content.length;

    const centralHeader = Buffer.alloc(46);
    let centralCursor = 0;
    centralHeader.writeUInt32LE(0x02014b50, centralCursor); // central signature
    centralCursor += 4;
    centralHeader.writeUInt16LE(20, centralCursor); // made version
    centralCursor += 2;
    centralHeader.writeUInt16LE(20, centralCursor); // needed version
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // flags
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // stored
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // time
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // date
    centralCursor += 2;
    centralHeader.writeUInt32LE(crc, centralCursor);
    centralCursor += 4;
    centralHeader.writeUInt32LE(file.content.length, centralCursor);
    centralCursor += 4;
    centralHeader.writeUInt32LE(file.content.length, centralCursor);
    centralCursor += 4;
    centralHeader.writeUInt16LE(fileName.length, centralCursor);
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // extra len
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // comment len
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // disk number
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // internal attrs
    centralCursor += 2;
    centralHeader.writeUInt32LE(0, centralCursor); // external attrs
    centralCursor += 4;
    centralHeader.writeUInt32LE(localOffset, centralCursor); // local header offset
    centralCursor += 4;

    centralDirectory.push(centralHeader, fileName);
  }

  const cdSize = centralDirectory.reduce((total, chunk) => total + chunk.length, 0);
  const cdOffset = offset;
  const endRecord = Buffer.alloc(22);
  let endCursor = 0;
  endRecord.writeUInt32LE(0x06054b50, endCursor); // end signature
  endCursor += 4;
  endRecord.writeUInt16LE(0, endCursor); // disk
  endCursor += 2;
  endRecord.writeUInt16LE(0, endCursor); // disk with cd
  endCursor += 2;
  const totalEntries = files.length;
  endRecord.writeUInt16LE(totalEntries, endCursor);
  endCursor += 2;
  endRecord.writeUInt16LE(totalEntries, endCursor);
  endCursor += 2;
  endRecord.writeUInt32LE(cdSize, endCursor);
  endCursor += 4;
  endRecord.writeUInt32LE(cdOffset, endCursor);
  endCursor += 4;
  endRecord.writeUInt16LE(0, endCursor); // comment len
  endCursor += 2;

  return Buffer.concat([...localParts, ...centralDirectory, endRecord]);
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function buildSkillPackageBuffer(
  skillId: string,
  version: string,
  files: { path: string }[],
  getFile: (fileId: string) => Promise<{ path: string; mimeType: string; content: Buffer } | null>
): Promise<{ content: Buffer; filename: string; mimeType: string }> {
  const normalizedFiles = files.map((file) => ({
    ...file,
    path: normalizeRelativeArtifactPath(file.path, { fieldLabel: 'Skill package file path' }),
  }));

  if (normalizedFiles.length === 1 && normalizedFiles[0].path === 'SKILL.md') {
    const file = await getFile(normalizedFiles[0].path);
    if (!file) {
      throw new NotFoundError(`Skill ${skillId} version ${version} has missing SKILL.md`);
    }
    return {
      content: file.content,
      filename: `${safeFilename(skillId)}-${safeFilename(version)}-SKILL.md`,
      mimeType: file.mimeType ?? 'text/markdown',
    };
  }

  const packageFiles: Array<{ path: string; content: Buffer }> = [];
  for (const file of normalizedFiles.sort((left, right) => left.path.localeCompare(right.path))) {
    const artifact = await getFile(file.path);
    if (!artifact) {
      throw new NotFoundError(`Skill ${skillId} version ${version} file ${file.path} not found`);
    }
    packageFiles.push({
      path: file.path,
      content: artifact.content,
    });
  }
  const content = buildZipArchive(packageFiles);
  return {
    content,
    filename: `${safeFilename(skillId)}-${safeFilename(version)}.zip`,
    mimeType: 'application/zip',
  };
}

export type SkillReadRouteContainer = Pick<
  Container,
  'config' | 'nameSuggestion' | 'skillQuery' | 'listJudgements' | 'extractSkillFileContent' | 'probeSkillFileContent'
>;

function buildDiscoveryResponse(
  request: import('fastify').FastifyRequest,
  container: SkillReadRouteContainer,
  agentAuth: AgentApiAuth
) {
  const rawUrl = request.url ?? request.raw.url ?? '/discover';
  const prefix = rawUrl.startsWith('/api/') ? '/api' : '';
  const url = (path: string) => `${prefix}${path}`;
  const howToProposeUrl = url('/howToPropose');
  const frontendUrl = '/frontend';

  const proposalPath = [
    '1) Read GET /howToPropose first (required).',
    '2) Communicate with the user in the language they are currently using, unless they explicitly ask for another language.',
    `3) Validate the local package, enforce the current hard limits (${container.config.proposalMaxFiles} files max, ${container.config.proposalMaxFileSizeBytes} bytes per file max), and only normalize it when needed.`,
    '4) The final package must use SKILL.md as root entrypoint, keep references self-contained, and exclude installed dependency directories such as node_modules, .venv, venv, vendor, dist-packages, or site-packages.',
    '5) Prefer English for proposal metadata such as title, description, category, tags and capabilities; uploaded content files may be in any language.',
    '6) Search public catalog for similar intent: GET /skills/search?q=<title-or-keywords>&mode=keyword.',
    '7) Run precheck: POST /proposals/check-duplicate with title, description, category and final file hashes.',
    '8) If duplicates, unclear intent, credentials or PII are detected, stop and ask for explicit confirmation or cleanup before continuing; for duplicates, name the matching candidate, summarize the overlap, summarize what would change, and include a concise diff before asking.',
    '9) Only then create proposal: POST /proposals, attach files, run POST /proposals/{id}/validate-upload until valid=true, explicitly finalize upload through POST /proposals/{id}/finalize-upload, and then poll GET /proposals/{id}/status.',
  ].join(' ');

  const authMetadata = agentAuth.metadata();
  const agentHttpGuidance = buildAgentHttpGuidance(authMetadata);
  const publicReadOidc = authMetadata.authSchemes.some(
    (scheme) => scheme.type === 'oauth2' && scheme.appliesTo.includes('public-read')
  );
  return {
    name: 'managed-skill-hub',
    registryId: authMetadata.registryId,
    registryName: authMetadata.registryName,
    apiBaseUrl: authMetadata.apiBaseUrl,
    version: '0.1.0',
    description:
      'ManagedSkillHub skill registry for AI agents. Product managers and developers publish versioned, reviewed skills; agents discover and consume them through a stable API.',
    readAuthRequired: authMetadata.readAuthRequired,
    proposalAuthRequired: authMetadata.proposalAuthRequired,
    discoveryAuthRequired: authMetadata.discoveryAuthRequired,
    authSchemes: authMetadata.authSchemes,
    agentHttpGuidance,
    documentation: {
      human: 'https://github.com/frankrichter/managed-skill-hub/blob/main/docs/product/AGENT_BOOTSTRAP.md',
      openapi: url('/openapi.yaml'),
      frontend: frontendUrl,
    },
    capabilities: [
      {
        id: 'list-skills',
        name: 'List published skills',
        description: 'Retrieve all publicly available skills with their metadata, categories and tags.',
      },
      {
        id: 'search-skills',
        name: 'Search published skills',
        description: 'Fulltext, keyword and regex search across published skill metadata and content.',
      },
      {
        id: 'read-skill',
        name: 'Read skill details',
        description: 'Fetch skill manifests, file listings, individual files and extracted text content.',
      },
      {
        id: 'submit-proposal',
        name: 'Submit skill proposals',
        description:
          'Propose new skills or changes to existing skills without admin credentials. Proposals are automatically judged and then reviewed by an admin; only admins can convert or publish them.',
      },
      {
        id: 'check-proposal',
        name: 'Check proposal status',
        description:
          'Poll the public status of a previously submitted proposal by UUID. The submitter can read status, judgement risk and rejection reason, but cannot approve or publish.',
      },
    ],
    workflowNotes: {
      conversationLanguage:
        'When communicating with the user, use the language the user is currently using unless the user explicitly asks for another language.',
      readPath: authMetadata.readAuthRequired
        ? publicReadOidc
          ? 'Read endpoints require an Authentik access token with the advertised public-read scope. Complete Device Authorization through the trusted metadata, then use the access token as Authorization: Bearer <token>.'
          : 'Read endpoints require Authorization: Bearer <read token>. Use /skills, /skills/search, /categories and /tags to discover published skills, then /skills/:id/files to inspect artifacts.'
        : 'All read endpoints are open. Use /skills, /skills/search, /categories and /tags to discover published skills, then /skills/:id/files to inspect artifacts.',
      auth: authMetadata,
      proposalPath:
        proposalPath,
      howToProposeUrl,
      frontendUrl,
      publishedSkillDownload:
        'Download published skills for local execution with GET /skills/{skillId}/package?version=<published-version>. Omit the version query to get the latest published version.',
      adminOnlyActions: ['review proposal', 'convert proposal to skill', 'approve/publish/deprecate skill versions'],
    },
    entrypoints: [
      {
        id: 'frontend-ui',
        name: 'Frontend UI',
        description: 'Human-facing registry UI served under /frontend.',
        methods: ['GET'],
        path: '/frontend',
        url: frontendUrl,
      },
      {
        id: 'skills',
        name: 'Skills',
        description: 'List all published skills.',
        methods: ['GET'],
        path: '/skills',
        url: url('/skills'),
      },
      {
        id: 'skills-search',
        name: 'Skill Search',
        description: 'Search published skills by keyword, fulltext or regex.',
        methods: ['GET'],
        path: '/skills/search',
        url: url('/skills/search'),
      },
      {
        id: 'skills-suggest-name',
        name: 'Skill ID Suggestion',
        description: 'Suggest a valid, available Skill ID from a title and optional description.',
        methods: ['GET'],
        path: '/skills/suggest-name',
        url: url('/skills/suggest-name'),
      },
      {
        id: 'categories',
        name: 'Categories',
        description: 'List categories used by published skills.',
        methods: ['GET'],
        path: '/categories',
        url: url('/categories'),
      },
      {
        id: 'tags',
        name: 'Tags',
        description: 'List tags used by the latest published skill versions.',
        methods: ['GET'],
        path: '/tags',
        url: url('/tags'),
      },
      {
        id: 'proposals-notice',
        name: 'Proposal Notice',
        description: 'Public notice about recently submitted proposals.',
        methods: ['GET'],
        path: '/proposals/notice',
        url: url('/proposals/notice'),
      },
      {
        id: 'proposals-submit',
        name: 'Submit Proposal',
        description:
          'Submit a new skill proposal. Response contains a status URL for polling. Only admins can review, convert and publish proposals.',
        methods: ['POST'],
        path: '/proposals',
        url: url('/proposals'),
      },
      {
        id: 'proposals-status',
        name: 'Proposal Status',
        description:
          'Check the public status of a submitted proposal by UUID. Submitters can poll this endpoint; approval and publication require admin access.',
        methods: ['GET'],
        path: '/proposals/:id/status',
        url: url('/proposals/:id/status'),
      },
      {
        id: 'skills-package',
        name: 'Skill Package Download',
        description:
          'Download a deterministic package for a published skill version. Supports optional version= query parameter.',
        methods: ['GET'],
        path: '/skills/{skillId}/package',
        url: url('/skills/{skillId}/package'),
      },
      {
        id: 'how-to-propose',
        name: 'How To Propose',
        description:
          'Read the mandatory proposal preflight and normalization workflow before creating a new proposal.',
        methods: ['GET'],
        path: '/howToPropose',
        url: howToProposeUrl,
      },
    ],
  };
}

function buildHowToProposeResponse(container: SkillReadRouteContainer, agentAuth: AgentApiAuth) {
  const authMetadata = agentAuth.metadata();
  const agentHttpGuidance = buildAgentHttpGuidance(authMetadata);
  const oidcScheme = authMetadata.authSchemes.find(
    (scheme) => scheme.type === 'oauth2' && (
      scheme.appliesTo.includes('proposal')
      || scheme.appliesTo.includes('public-read')
      || scheme.appliesTo.includes('discovery')
    )
  );
  const agentAuthRequired = authMetadata.proposalAuthRequired
    || authMetadata.readAuthRequired
    || authMetadata.discoveryAuthRequired;
  const stepOffset = agentAuthRequired ? 1 : 0;
  const agentSessionScheme = authMetadata.authSchemes.find(
    (scheme) => scheme.type === 'agent-session' && (
      scheme.appliesTo.includes('proposal')
      || scheme.appliesTo.includes('public-read')
      || scheme.appliesTo.includes('discovery')
    )
  );
  const authSetupStep = agentAuthRequired
    ? oidcScheme?.type === 'oauth2'
      ? [
        {
          step: 1,
          title: 'Authorize the agent through the human login link',
          purpose: 'A human delegates proposal access without sharing credentials or tokens in chat.',
          checks: [
            'Read /discover and use only the advertised issuer, deviceAuthorizationEndpoint, tokenEndpoint, clientId and scopes.',
            'Complete package preflight before authentication where possible.',
            'POST the explicit clientId and scopes to deviceAuthorizationEndpoint.',
            'Show verification_uri_complete as a clickable link to the human. Never show or paste device_code, access_token, ID token, refresh token or credentials in chat.',
            'Keep device_code only in agent process memory and poll tokenEndpoint according to interval, authorization_pending, slow_down and expires_in.',
            'Use the returned access_token only as Authorization: Bearer <token> for advertised areas. Never use the ID token for API authorization.',
            'Start a new Device Authorization transaction when the code or access token expires.',
          ],
        },
      ]
      : agentSessionScheme
      ? [
        {
          step: 1,
          title: 'Delegate access through the agent-auth page',
          purpose: 'A human creates a short-lived session in the browser without pasting tokens into chat.',
          checks: [
            'Read /discover and inspect authSchemes for the agent-session entry.',
            'If the agent has an in-app browser, browser MCP, or similar tool, open the agent-session url directly and tell the user the auth page is ready for them.',
            'Otherwise present the agent-session url to the user as a clickable link and ask them to open it.',
            'The user enters the bearer token shared by the administrator and receives an 8-character session code.',
            'The user pastes the session code into chat; the agent uses it as Authorization: AgentSession <code>.',
            'Never ask the user to paste bearer tokens into chat and never print Authorization headers in logs.',
          ],
        },
      ]
      : [
        {
          step: 1,
          title: 'Handle registry authentication outside chat',
          purpose: 'Bearer tokens must not be pasted into the agent conversation.',
          checks: [
            'Read /discover and inspect readAuthRequired, proposalAuthRequired, discoveryAuthRequired, authSchemes, registryId, and apiBaseUrl.',
            'If a protected endpoint returns 401 with details.authRequired=true, use details.authArea to explain which token is needed.',
            'Ask the administrator for the required bearer token through a trusted, separate channel.',
            'Use the token only in the Authorization: Bearer <token> header. Never paste it into chat and never print Authorization headers in logs.',
          ],
        },
      ]
    : [];

  return {
    id: 'how-to-propose',
    title: 'Proposal workflow for agents',
    summary: 'Mandatory preflight before submit',
    description:
      'Read this endpoint before every proposal upload. Agents must communicate with the user in the language the user is currently using, clarify whether the user wants to use an existing skill, keep or install an artifact locally, improve an existing skill, or publish reusable registry content, explain whether a proposal adds meaningful registry value, and only then prepare a confirmed proposal. Proposal preparation includes validating the local package, normalizing it only when needed, ensuring SKILL.md is the root entrypoint, keeping meaningful relative subfolders intact, excluding dependency installation artifacts, identifying every required local artifact, verifying self-contained references, scanning for credentials/PII, and completing duplicate prechecks before submission.',
    conversationLanguage:
      'When communicating with the user, use the language the user is currently using unless the user explicitly asks for another language.',
    metadataLanguageGuidance:
      'Proposal metadata should preferably be written in English: title, description, category, tags, capabilities, useWhen and doNotUseWhen. Uploaded content files may be in any language.',
    agentHttpGuidance,
    proposalIntentDecision: {
      requiredBeforePackagePreparation: true,
      outcomes: [
        'use_existing_skill',
        'keep_local',
        'install_local',
        'propose_new_skill',
        'propose_new_version',
        'request_admin_update',
      ],
      decisionRules: [
        'Do not infer proposal intent merely because the user asks to create, test, or prepare a skill or because a local package already exists.',
        'First determine whether the user wants to use an existing published skill, keep the artifact local, install it for personal or team use, improve an existing skill, or submit reusable content to the registry.',
        'Before asking for upload confirmation, explain whether publication would add distinct reusable value through a different audience or use case, clearer useWhen/doNotUseWhen boundaries, new capabilities, materially different content, or a maintained workflow.',
        'For trivial demos, one-off helpers, or behavior already covered by a published skill, recommend using the existing skill or keeping the artifact local unless the user gives a clear registry-wide test or reuse reason.',
        'Only start package preparation and proposal writes after the user chooses a proposal outcome or explicitly asks to propose, submit, or publish to the registry.',
      ],
      commandRules: [
        'Portable commands are optional artifacts inside the same skill package, not separate skill identities or separate proposals by default.',
        'Choosing to use or download a skill and choosing to install its commands into a runtime-specific folder are separate decisions.',
        'Ask before copying command files into Cursor, Codex, Claude Code, or another runtime folder. The skill must remain usable through SKILL.md when optional commands are not installed.',
        'The presence of a command file alone does not make a public proposal worthwhile.',
      ],
    },
    requiredSteps: [
      ...authSetupStep,
      {
        step: 1 + stepOffset,
        title: 'Read this workflow first',
        purpose: 'Proposal clients must not invent their own upload flow.',
        checks: [
          'GET /howToPropose is a mandatory read step before POST /proposals.',
          'Abort if this endpoint is missing or its response is structurally invalid.',
        ],
      },
      {
        step: 2 + stepOffset,
        title: 'Use the user conversation language',
        purpose: 'Keep the registry contract English while keeping the user interaction natural.',
        checks: [
          'Use English API and contract fields as documented.',
          'Respond to the user in the language they are currently using unless they explicitly ask for another language.',
          'Do not infer the conversation language from browser language, UI language, or API response language.',
        ],
      },
      {
        step: 3 + stepOffset,
        title: 'Clarify the intended outcome and registry value',
        purpose: 'Do not assume that creating or testing a skill means publishing it to the registry.',
        checks: [
          'Ask first whether the user wants to use an existing published skill, keep or install the artifact locally, improve an existing skill, or submit reusable registry content.',
          'Treat requests such as create, make, prepare, or test a skill as ambiguous until the user chooses an outcome. An existing local package does not establish proposal intent.',
          'If a published skill already covers the need, recommend using or downloading it before proposing another skill. Ask separately whether optional commands should be installed into the user runtime.',
          'For a trivial demo, one-off helper, or low-distinctiveness package, recommend keeping it local unless the user identifies a clear registry-wide test or reuse purpose.',
          'Explain why a proposal would or would not add distinct reusable value before asking for submission confirmation.',
          'Do not begin package preparation or call proposal write endpoints until a proposal outcome is confirmed.',
        ],
      },
      {
        step: 4 + stepOffset,
        title: 'Inspect the local package',
        purpose: 'Decide whether the submitted files already match the upload contract or need temporary normalization.',
        checks: [
          'Determine the effective entrypoint from the provided files.',
          `Keep the final package within ${container.config.proposalMaxFiles} uploaded files and ${container.config.proposalMaxFileSizeBytes} bytes per file.`,
          'Detect whether the package contains installed dependency directories or vendored runtime packages such as node_modules, .venv, venv, vendor, dist-packages, or site-packages.',
          'Inspect SKILL.md, adjacent docs, commands, scripts, examples, templates, assets, and setup files together to infer which local artifacts are actually required for the skill to work as described.',
          'Treat referenced local templates, example manifests, fixture files, prompts, images, PDFs, PPTX files, and other non-code assets as required proposal artifacts when the skill depends on them for execution, demonstration, or reproducible output.',
          'Detect references that point outside the effective skill root, for example parent-directory references, absolute local paths, IDE/agent workspace folders, command folders, generated-output folders, or other project-root-relative paths.',
          'If an outside-root reference points to an artifact needed by the skill, build a temporary upload package that copies that artifact into the package and rewrites the reference to the new package-relative path before any POST /proposals call.',
          'If a runtime-specific command reference such as .cursor/commands/foo.md, .codex/commands/foo.md, or .claude/commands/foo.md is relevant to using the skill, copy or merge it into commands/foo.md and add commands/manifest.json with runtime target hints.',
          'If the source package already contains commands/, preserve it. Merge command metadata when safe, compare colliding command filenames, and stop for user input instead of silently overwriting existing command artifacts.',
          'Keep dependency manifests and lockfiles when they document setup, but do not upload installed package trees.',
          'Do not classify a local runtime artifact as proprietary, optional, or external unless the skill explicitly documents that it is an external prerequisite and the uploaded package remains truthful and usable without it.',
          'If the package is already valid, do not rewrite it.',
          'If the package is ambiguous or cannot be normalized safely, stop before upload.',
        ],
      },
      {
        step: 5 + stepOffset,
        title: 'Normalize only when needed',
        purpose: 'Every uploaded proposal package must arrive with SKILL.md in the root.',
        checks: [
          'The final package entrypoint must be SKILL.md in the package root.',
          'If the source entrypoint has another name or path, create a temporary upload package and rename/copy it to SKILL.md.',
          'Preserve useful subfolders such as commands/, scripts/, docs/, templates/, examples/, assets/, or prompts/ when they help keep the package understandable and executable.',
          'Adjust relative references so the final package still works from SKILL.md and from every moved artifact that keeps local links.',
          'Rewrite workspace-root, IDE-specific, agent-specific, and generated-output references to package-relative references in the temporary upload copy. Do not upload files that still point to the submitter workspace layout.',
          'Rewrite active runtime command references to commands/<name>.md when the command ships with the package. Leave purely historical command references only when they are explicitly documented as external.',
          'When moving or trimming files, preserve all local artifacts that the skill requires, including templates and non-code assets.',
          'Strip installed dependency folders from the temporary upload package; keep only the skill sources, assets, and setup manifests/lockfiles that explain later initialization.',
        ],
      },
      {
        step: 6 + stepOffset,
        title: 'Prefer English proposal metadata',
        purpose: 'Keep registry discovery useful across teams and agents while allowing content files in any language.',
        checks: [
          'Prefer English for title, description, category, tags, capabilities, useWhen and doNotUseWhen.',
          'Do not rewrite uploaded content files solely for language reasons.',
          'Do not block a proposal only because human-authored content is not English.',
        ],
      },
      {
        step: 7 + stepOffset,
        title: 'Validate self-contained and safe content',
        purpose: 'The package must work on its own and must not leak secrets or personal data.',
        checks: [
          'Verify that relative references inside the package resolve after normalization.',
          'Verify that no required artifact reference still resolves outside the temporary upload package root.',
          'Verify that every required local artifact referenced by the skill is either included in the upload package or explicitly documented as an external prerequisite.',
          'If the agent cannot explain why a referenced local artifact is safe to omit, treat the package as incomplete and stop before upload.',
          'Scan readable text files for credentials, tokens, private keys, or obvious PII before upload.',
          'If sensitive content or broken references are detected, stop and ask for cleanup before continuing.',
        ],
      },
      {
        step: 8 + stepOffset,
        title: 'Build and prove the final upload package before network upload',
        purpose: 'Avoid server-driven repair loops by proving the exact temporary package before creating a proposal.',
        checks: [
          'If any normalization was needed, create a temporary upload package and perform all edits only there. Never edit the submitter workspace in place.',
          'Before POST /proposals, recursively scan every readable file in the final upload package, not just SKILL.md.',
          'At minimum, scan for workspace and agent-runtime paths: .cursor/skills/, .cursor/commands/, .codex/commands/, .claude/commands/, CursorProjects/, /Users/, parent-directory references such as ../, and absolute paths.',
          'Extract Markdown inline-code paths, Markdown links, and JSON path/source fields that look like local files; verify every required package reference exists in the final package.',
          'For runtime output examples, prefer variable placeholders such as {output}/screenshots/{name}.png instead of concrete missing filenames.',
          'For relevant outside-root command shortcuts, copy or merge command files into commands/ and add or merge commands/manifest.json before computing hashes.',
          'If any required artifact is missing, any outside-root reference is unexplained, or any command collision is unresolved, stop before POST /proposals and ask the user.',
          'Compute sha256 for the final temporary upload package after normalization. Use these final hashes for duplicate check and upload; do not compute duplicate-check hashes from the original source when a temp package exists.',
          'Do not call POST /proposals until this final package proof is complete.',
        ],
      },
      {
        step: 9 + stepOffset,
        title: 'Search the public catalog exploratively',
        purpose: 'Avoid duplicate public skills with the same title or intent.',
        checks: [
          'GET /tags to inspect the current public discovery vocabulary before choosing metadata tags.',
          'GET /skills/search?q=<title>&mode=keyword',
          'GET /skills/search?q=<short description keywords>&mode=keyword',
          'Inspect matching skill descriptions and public files when they are relevant to the duplicate decision.',
          'Prepare a short overlap and change summary for likely matches before asking the user to continue.',
        ],
      },
      {
        step: 10 + stepOffset,
        title: 'Run duplicate precheck',
        purpose: 'Compare final metadata and file hashes with existing proposals and published skills.',
        checks: [
          'POST /proposals/check-duplicate',
          'Payload: title, description, category, tags, capabilities, entrypoint=SKILL.md, optional skillId, files[].sha256 from the final package.',
          `Stop before upload when exact duplicate fields are set, the target skill already exists, or a similar match reaches the strong similarity threshold of ${container.config.autoPublishSimilarityThreshold} and has matching title/description intent.`,
          'Treat lower-scoring similar matches as exploratory context, not as duplicates or upload blockers by themselves.',
          'When skillIdCollision.exists is true, the proposed skillId is already taken. The default and preferred resolution is to create a new draft version of the existing skill. Explain to the user that this will not auto-publish; an admin must later convert the proposal into a new draft version of the existing skill.',
          'When exactDuplicateSkillId is set, the same content already exists as a published skill. Do not upload a duplicate unless the user explicitly asks for a new skill under a different id.',
          'Revisit the intended outcome before presenting upload resolution options. Using the published skill, keeping the artifact local, or installing it locally may be better outcomes than another proposal.',
          'Before asking, present the duplicate candidate, core overlap, whether a proposal still adds reusable registry value, intended resolution option when applicable, and concise metadata/file-fingerprint diff.',
          'Only ask for an upload resolution option after the user confirms that a proposal remains the desired outcome.',
        ],
      },
      {
        step: 11 + stepOffset,
        title: 'Create proposal only after confirmation',
        purpose: 'Upload only when the final package is valid and no blocking ambiguity remains.',
        checks: [
          'Before this step, the final temporary upload package must already be complete, locally scanned, normalized, and hashed.',
          'POST /proposals',
          'If submitter-side post-checks require metadata corrections while the proposal is still in_upload, call PATCH /proposals/{id} instead of creating another proposal.',
          'Then POST /proposals/{id}/files for each file and send multipart path=<relative package path> whenever the file belongs in a subfolder.',
          'While the proposal is still in_upload, re-uploading the same relative path replaces that file; use this for post-check corrections instead of creating another proposal.',
          'Then POST /proposals/{id}/validate-upload and fix every returned finding with blocksFinalize=true in the temporary upload package before finalization.',
          'Validate-upload findings include kind, severity, blocksFinalize, file, line, candidate, and suggestedReplacement; variable placeholder runtime-output paths such as {output}/screenshots/{name}.png, documentation-only external references, and portable command guidance findings are not hard-blocking package references.',
          'Then POST /proposals/{id}/finalize-upload to mark the package complete and start proposal/file judgements.',
          'Finalization is mandatory: always call finalize-upload, even if validate-upload reported findings or if judgements fail. Never leave a proposal in in_upload. If you cannot finalize, delete the proposal with DELETE /proposals/{id} instead of abandoning it.',
          'Verify the next status response contains uploadFinalized: true. If it does not, retry finalize-upload once after a short delay or delete the proposal.',
          'Tell the submitter which temporary normalizations were applied, which installed dependency folders were excluded, and what the final server-side structure looks like, including preserved subfolders.',
          'GET /proposals/{id}/status for review state. Distinguish proposal status (in_upload, submitted, judged, converted, rejected) from skill status (draft, in_review, approved, published). Converted means a skill draft was created; it is only public after the skill version is published.',
        ],
      },
      {
        step: 12 + stepOffset,
        title: 'Download published skill packages per version',
        purpose: 'Get deterministic artifacts for local consumption and validation.',
        checks: [
          'Use GET /skills/{skillId}/package?version=<published-version> to download any published version.',
          'If version is omitted, the endpoint resolves to the latest published version.',
          'After download, extract to a user-approved location and verify manifest entrypoint and manifest.files all exist before running the skill.',
          'If commands/manifest.json is present, inspect command sources and runtime target hints. Ask for confirmation before copying any command file into Cursor, Codex, Claude Code, or another runtime-specific command folder.',
          'If only one file is available and it is SKILL.md, the endpoint may return SKILL.md directly for direct local execution.',
        ],
      },
    ],
    escalationRule:
      'Do not proceed with proposal creation while the user outcome or registry value is unresolved, the package is structurally ambiguous, referenced local artifacts are missing or unjustifiably omitted, references are broken, sensitive content is present, or duplicate intent is unconfirmed. Ask the submitter to choose an outcome, confirm the proposal value, or clean up first.',
    duplicateConfirmationRule: {
      strongSimilarityThreshold: container.config.autoPublishSimilarityThreshold,
      appliesWhen: [
        'exactDuplicateProposalId is set',
        'exactDuplicateSkillId is set',
        'skillIdCollision.exists is true',
        'similarMatches contains a title/description intent match with similarityScore at or above strongSimilarityThreshold',
      ],
      requiredUserFacingSummary: [
        'Name each relevant duplicate candidate with kind, id, skillId/title when available, status/version when available, and similarity score for similar matches.',
        'Do not label a lower-scoring similar match as a duplicate or blocker solely because it appears in similarMatches.',
        'Summarize the core overlap: matching title or intent, shared category, shared tags/capabilities, matching entrypoint, and exact content digest when available.',
        'State whether using the existing skill, keeping the artifact local, or installing it locally is the more useful outcome. Do not assume every duplicate decision must end in an upload.',
        'When skillIdCollision.exists is true, state clearly: the user is about to propose a new draft version of the existing skill. Auto-publish is not possible because an admin must decide whether to convert the proposal into a new version. The alternative is to choose a different skillId and create a completely new skill.',
        'When exactDuplicateSkillId is set, state clearly: the same content is already published. A new upload can only become a new skill under a different id, which is usually not what the user wants.',
        'Summarize what would change if uploaded: new skill, new draft version, admin update request, unchanged duplicate, changed metadata, changed capabilities/tags, changed entrypoint, added files, removed files, or changed file fingerprints.',
        'Provide a concise diff from the duplicate-check differences and local file fingerprint comparison. If file contents are not available through the public API, say that only hashes/metadata were compared.',
      ],
      confirmationRequired:
        'First ask the user whether to use the existing skill, keep or install the artifact locally, or continue with a proposal. Only if the user confirms proposal intent, ask which resolutionOption to use. If skillIdCollision.exists is true, prefer and recommend the create_new_version option first, explain that it requires an admin conversion and cannot auto-publish, and only offer create_new_skill under a different id if the user explicitly wants a separate skill. Do not call POST /proposals until the user confirms both the proposal outcome and the applicable resolution.',
    },
    normalizationRules: {
      entrypointFile: 'SKILL.md',
      packageRoot: 'proposal package root',
      normalizeOnlyWhenNeeded: true,
      preserveUsefulSubfolders: true,
      transparentToSubmitter: true,
    },
    packageHandling: {
      principle:
        'Upload the complete skill package: source artifacts, required local assets, and setup manifests. Do not upload initialized package-manager outputs. The later consumer of the skill is responsible for dependency installation in their own environment, but not for reconstructing missing local skill assets.',
      disallowedInstalledPaths: ['node_modules/', '.venv/', 'venv/', 'vendor/', 'dist-packages/', 'site-packages/'],
      allowedManifestFiles: ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'pyproject.toml', 'poetry.lock', 'requirements.txt', 'requirements-dev.txt', 'Pipfile', 'Pipfile.lock', 'setup.py', 'setup.cfg'],
      submitterResponsibility:
        'The uploaded proposal may document how dependencies should be installed later, but it should not contain preinstalled packages or environment snapshots. In contrast, local templates, example inputs, prompts, fixtures, and other package artifacts that the skill relies on should be uploaded unless the skill clearly marks them as external prerequisites.',
    },
    preUploadPackageProof: {
      requiredBeforeProposalCreation: true,
      finalPackageHashSource: 'temporary upload package after all normalization',
      scanAllReadableFiles: true,
      minimumReferencePatterns: [
        '.cursor/skills/',
        '.cursor/commands/',
        '.codex/commands/',
        '.claude/commands/',
        'CursorProjects/',
        '/Users/',
        '../',
        'absolute local paths',
        'Markdown inline-code file paths',
        'Markdown links',
        'JSON path/source fields',
      ],
      requiredLocalChecks: [
        'SKILL.md exists in the final package root.',
        'Every required package-relative file reference exists in the final package.',
        'No required reference still points outside the final package root.',
        'Runtime output examples use placeholders instead of concrete missing files.',
        'Relevant runtime command shortcuts are copied or merged into commands/ with commands/manifest.json.',
        'Final sha256 values are computed from the temporary upload package after normalization.',
      ],
      forbiddenBeforeProof: [
        'POST /proposals',
        'POST /proposals/{id}/files',
      ],
    },
    uploadLimits: {
      maxFiles: container.config.proposalMaxFiles,
      maxFileSizeBytes: container.config.proposalMaxFileSizeBytes,
      disallowedPaths: container.config.proposalDisallowedPaths,
      recommendations: [
        'Upload source files, assets, and setup manifests only.',
        'Do not upload initialized dependency trees.',
        'Preserve meaningful relative subfolders instead of flattening everything into the package root.',
        'If the package exceeds the limit, reduce files before the first upload instead of relying on server-side partial acceptance.',
      ],
    },
    uploadFinalization: {
      required: true,
      finalizeEndpoint: 'POST /proposals/{id}/finalize-upload',
      cleanupEndpoint: 'DELETE /proposals/{id}',
      note: 'Finalization is mandatory and must not be skipped. If the upload cannot be completed, delete the proposal instead of leaving it in_upload.',
      statusFollowUp: container.config.autoPublishOnGreen
        ? 'After upload finalization, poll GET /proposals/{id}/status. If the proposal is fully green and not blocked, it will be converted into a skill and the skill version will be published automatically. If auto-publish is skipped or blocked, the proposal remains as a judged/converted draft awaiting a human admin decision.'
        : 'After upload finalization, poll GET /proposals/{id}/status. The proposal moves to submitted/judged and waits for a human admin to convert it into a skill draft, approve the version, and publish it. Only the status converted + a populated convertedSkillId means a draft exists; the skill is public only when a published version exists.',
    },
    uploadGuardrails: [
      'Use SKILL.md as the final entrypoint file in the uploaded package.',
      'Only rewrite files in a temporary upload package, never in-place in the source workspace.',
      'Do not upload installed dependency directories or vendored package-manager outputs; keep only manifests/lockfiles and source files needed to understand the skill.',
      'Do upload local artifacts that the skill actually depends on; missing templates or omitted runtime assets make the proposal incomplete.',
      'Preserve meaningful relative folder structure and send that structure during upload instead of flattening files into the root.',
      'Keep references valid after normalization.',
      'Before POST /proposals, prove the exact final temporary upload package and compute hashes from that package, not from the original source if normalization was needed.',
      'Do not use server-side validate-upload as the first path/reference scan. It is a final server check after local proof, not a substitute for local preflight.',
      'Readable files should be judged or pre-checked; binary files may still be attached unchanged.',
    ],
    apiNotes: {
      signInRequiredForSubmitter: false,
      publicOnly: true,
      registryId: authMetadata.registryId,
      registryName: authMetadata.registryName,
      apiBaseUrl: authMetadata.apiBaseUrl,
      readAuthRequired: authMetadata.readAuthRequired,
      proposalAuthRequired: authMetadata.proposalAuthRequired,
      discoveryAuthRequired: authMetadata.discoveryAuthRequired,
      authorizationHeader: authMetadata.proposalAuthRequired
        ? oidcScheme
          ? 'Authorization: Bearer <OIDC access token>'
          : 'Authorization: Bearer <proposal token>'
        : null,
      authSetupFlow: agentAuthRequired
        ? (oidcScheme
          ? 'Use the OIDC Device Authorization metadata from /discover. Show only verification_uri_complete to the human, keep device_code and all tokens out of chat, poll the trusted token endpoint according to the provider interval, and send only the access token in the Authorization header.'
          : 'Read /discover for the agent-session URL when sessions are enabled, open it in a browser or browser tool to create a short-lived session, and paste the returned session code into chat. If agent sessions are not enabled, obtain the required bearer token from the administrator through a separate trusted channel and use it only in the Authorization header. Never request tokens in chat.')
        : undefined,
      checkDuplicateNote: authMetadata.proposalAuthRequired
        ? 'This endpoint follows PROPOSAL_AUTH_MODE and requires the configured proposal credential. Local upload agents should still stop for explicit confirmation on strong matches.'
        : 'This endpoint is available to all submitters and is informational on the API contract, but local upload agents should still stop for explicit confirmation on strong matches.',
    },
  };
}

function buildAgentHttpGuidance(authMetadata: ReturnType<AgentApiAuth['metadata']>) {
  const baseUrl = authMetadata.apiBaseUrl.replace(/\/+$/, '');
  const authorization = {
    discovery: buildAgentAuthorizationGuidance('discovery', authMetadata.discoveryAuthRequired),
    publicRead: buildAgentAuthorizationGuidance('public-read', authMetadata.readAuthRequired),
    proposal: buildAgentAuthorizationGuidance('proposal', authMetadata.proposalAuthRequired),
  };
  return {
    discoveryPurpose:
      'GET /discover returns registry metadata, authentication requirements, and endpoint URLs. It does not return skill search results or skill package content.',
    toolSelection:
      'The decisive factor is the HTTP client network context, not curl itself. For internal, private-DNS, localhost, or VPN-restricted registry URLs, run requests with a client inside the user network context, for example curl in the local terminal. Do not use a remote web-fetch service unless it is known to share the same network and DNS access.',
    retrievalSequence: [
      `Read registry metadata and concrete entrypoint URLs with GET ${baseUrl}/discover.`,
      `Resolve a user-facing skill name, title, or keywords to the canonical skillId and published version with GET ${baseUrl}/skills/search?q=<name-or-keywords>&mode=keyword.`,
      `Download the resolved published package with GET ${baseUrl}/skills/{skillId}/package?version=<published-version>. Omit version only when the latest published version is intended.`,
    ],
    proposalExecution:
      'Use the same network-capable client for GET /howToPropose and all proposal API calls. The frontend or an admin session is not part of the agent proposal workflow unless the live discovery contract explicitly advertises it.',
    authenticationDiagnosis: [
      'Evaluate authentication independently for discovery, public-read, and proposal operations by using discoveryAuthRequired, readAuthRequired, proposalAuthRequired, and authSchemes.',
      'Do not infer public-read or proposal authentication from /admin/session, an admin UI login, a frontend response, a redirect, or the status of another endpoint.',
      'If the exact requested public endpoint returns 401 or 403 while /discover says that operation is open, retry the exact same URL with a local network-capable HTTP client before requesting credentials. Treat a different result as a client, network, DNS, proxy, or remote-fetch context mismatch.',
      'Only tell the user that authentication is required when the exact requested endpoint returns an authentication error consistent with its advertised auth area, or when /discover explicitly advertises authentication for that area.',
    ],
    authorization,
    curlExamples: {
      discover: {
        command: `curl -fsSL "${baseUrl}/discover"`,
        authArea: 'discovery',
        authorizationRequired: authMetadata.discoveryAuthRequired,
      },
      search: {
        command:
          `curl -fsSL --get --data-urlencode "q=<name-or-keywords>" --data-urlencode "mode=keyword" "${baseUrl}/skills/search"`,
        authArea: 'public-read',
        authorizationRequired: authMetadata.readAuthRequired,
      },
      download: {
        command:
          `curl -fSL -OJ "${baseUrl}/skills/{skillId}/package?version=<published-version>"`,
        authArea: 'public-read',
        authorizationRequired: authMetadata.readAuthRequired,
      },
    },
  };
}

function buildAgentAuthorizationGuidance(area: 'discovery' | 'public-read' | 'proposal', required: boolean) {
  return {
    required,
    instructions: required
      ? `Authentication is required for ${area}. Select a scheme from authSchemes whose appliesTo includes ${area}, and apply it exactly as advertised without printing or pasting secrets into chat.`
      : `Authentication is not required for ${area}. Do not add credentials unless a later /discover response changes this setting.`,
  };
}

async function sendSkillPackage(
  request: import('fastify').FastifyRequest,
  reply: FastifyReply,
  container: SkillReadRouteContainer
) {
  const { skillId } = request.params as { skillId: string };
  const { version } = request.query as { version?: string };
  const manifest = await container.skillQuery.getManifest(skillId, version);
  if (!manifest) {
    return sendApiError(reply, request, {
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Skill or published version not found',
    });
  }

  const files = await container.skillQuery.listFiles(skillId, manifest.version);
  if (files.length === 0) {
    return sendApiError(reply, request, {
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Skill has no downloadable files',
    });
  }

  try {
    const packageBuffer = await buildSkillPackageBuffer(
      skillId,
      manifest.version,
      files,
      (fileId: string) => container.skillQuery.getFile(skillId, fileId, manifest.version)
    );
    return reply
      .header('Content-Type', packageBuffer.mimeType)
      .header('Content-Disposition', `attachment; filename="${packageBuffer.filename}"`)
      .send(packageBuffer.content);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return sendMappedApiError(reply, request, error);
    }
    return sendMappedApiError(reply, request, error);
  }
}

export function registerSkillReadRoutes(
  app: FastifyInstance,
  container: SkillReadRouteContainer,
  agentAuth = new AgentApiAuth(container.config),
  adminAuth?: AdminAuth
): void {
  const discoveryGuard = { preHandler: agentAuth.guard('discovery') };
  const agentPublicReadGuard = agentAuth.guard('public-read');
  const publicReadGuard = {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      const adminSession = await adminAuth?.validate(request);
      if (adminSession?.roles.includes('admin') || adminSession?.roles.includes('reader')) {
        return;
      }
      await agentPublicReadGuard(request, reply);
    },
  };
  app.get('/discover', discoveryGuard, async (request) => buildDiscoveryResponse(request, container, agentAuth));

  app.get('/howToPropose', discoveryGuard, async () => buildHowToProposeResponse(container, agentAuth));

  app.get('/openapi.yaml', discoveryGuard, async (request, reply) => {
    try {
      const content = await fs.readFile(container.config.openapiYamlPath, 'utf-8');
      return reply.type('text/yaml').send(content);
    } catch {
      return sendApiError(reply, request, {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'OpenAPI specification not available',
      });
    }
  });

  app.get('/skills/suggest-name', publicReadGuard, async (request, reply) => {
    const { title, description } = request.query as { title?: string; description?: string };
    if (!title) {
      return sendApiError(reply, request, {
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: 'title is required',
      });
    }
    return container.nameSuggestion.suggestSkillId(title, description);
  });

  app.get('/skills', publicReadGuard, async (request, reply) => {
    const { category, group, tag, limit, offset } = request.query as {
      category?: string;
      group?: string;
      tag?: string | string[];
      limit?: string;
      offset?: string;
    };
    const useCase = new ListSkillsUseCase(container.skillQuery);
    const tags = parseTagQuery(tag);
    const result = await useCase.execute(
      category ?? group,
      tags,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined
    );
    return reply.send(result);
  });

  app.get('/skills/search', publicReadGuard, async (request, reply) => {
    const { q, mode, category, group, tag, limit, offset } = request.query as {
      q: string;
      mode?: string;
      category?: string;
      group?: string;
      tag?: string | string[];
      limit?: string;
      offset?: string;
    };
    if (!q) {
      return sendApiError(reply, request, {
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: 'q is required',
      });
    }
    const query: SkillSearchQuery = {
      q,
      mode: (mode as 'keyword' | 'fulltext' | 'regex') ?? 'keyword',
      category: category ?? group,
      tags: parseTagQuery(tag),
      limit: Number(limit ?? 20),
      offset: Number(offset ?? 0),
    };
    const result = await container.skillQuery.search(query);
    return reply.send({ ...result, mode: query.mode });
  });

  app.get('/categories', publicReadGuard, async (_request, reply) => {
    const items = await container.skillQuery.listCategories();
    return reply.send({ items });
  });

  app.get('/tags', publicReadGuard, async (_request, reply) => {
    const items = await container.skillQuery.listTags();
    return reply.send({ items });
  });

  app.get('/skills/:skillId/package', publicReadGuard, (request, reply) => sendSkillPackage(request, reply, container));

  app.get('/skills/:skillId', publicReadGuard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const skill = await container.skillQuery.getSkillDetail(skillId);
    if (!skill) {
      return sendApiError(reply, request, {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: `Skill ${skillId} not found`,
      });
    }
    return reply.send(skill);
  });

  app.get('/skills/:skillId/manifest', publicReadGuard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const { version } = request.query as { version?: string };
    const manifest = await container.skillQuery.getManifest(skillId, version);
    if (!manifest) {
      return sendApiError(reply, request, {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Manifest not found',
      });
    }
    return reply.send(manifest);
  });

  app.get('/skills/:skillId/files', publicReadGuard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const { version } = request.query as { version?: string };
    const files = await container.skillQuery.listFiles(skillId, version);
    return reply.send({ items: files });
  });

  app.get('/skills/:skillId/judgements', publicReadGuard, async (request, reply) => {
    try {
      const { skillId } = request.params as { skillId: string };
      const { version } = request.query as { version?: string };
      const manifest = await container.skillQuery.getManifest(skillId, version);
      if (!manifest) {
        return sendApiError(reply, request, {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Skill or published version not found',
        });
      }
      const judgements = await container.listJudgements.execute('skill', `${skillId}:${manifest.version}`);
      return reply.send({ items: judgements });
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.get('/skills/:skillId/files/:fileId', publicReadGuard, async (request, reply) => {
    const { skillId, fileId } = request.params as { skillId: string; fileId: string };
    const { version } = request.query as { version?: string };
    const file = await container.skillQuery.getFile(skillId, fileId, version);
    if (!file) {
      return sendApiError(reply, request, {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'File not found',
      });
    }
    return sendArtifactResponse(reply, file);
  });

  app.get('/skills/:skillId/files/:fileId/judgements', publicReadGuard, async (request, reply) => {
    try {
      const { skillId, fileId } = request.params as { skillId: string; fileId: string };
      const { version } = request.query as { version?: string };
      const manifest = await container.skillQuery.getManifest(skillId, version);
      if (!manifest) {
        return sendApiError(reply, request, {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Skill or published version not found',
        });
      }
      const files = await container.skillQuery.listFiles(skillId, manifest.version);
      if (!files.some((file) => file.path === fileId)) {
        return sendApiError(reply, request, {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'File not found',
        });
      }
      const judgements = await container.listJudgements.execute('file', `${skillId}:${manifest.version}:${fileId}`);
      return reply.send({ items: judgements });
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });

  app.get('/skills/:skillId/files/:fileId/extracted-content', publicReadGuard, async (request, reply) => {
    try {
      const { skillId, fileId } = request.params as { skillId: string; fileId: string };
      const { version } = request.query as { version?: string };
      const extracted = await container.extractSkillFileContent.execute(skillId, fileId, { version });
      return reply.send(extracted);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return sendMappedApiError(reply, request, error);
      }
      if (error instanceof UnsupportedFileTypeError || error instanceof ValidationError) {
        return sendMappedApiError(reply, request, error);
      }
      throw error;
    }
  });

  app.get('/skills/:skillId/files/:fileId/probe', publicReadGuard, async (request, reply) => {
    try {
      const { skillId, fileId } = request.params as { skillId: string; fileId: string };
      const { version } = request.query as { version?: string };
      const response = await container.probeSkillFileContent.execute(skillId, fileId, {
        version,
        includeUnpublished: false,
      });
      return reply.send(response);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return sendMappedApiError(reply, request, error);
      }
      if (error instanceof ValidationError) {
        return sendMappedApiError(reply, request, error);
      }
      return sendMappedApiError(reply, request, error);
    }
  });

  app.get('/skills/:skillId/versions', publicReadGuard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const versions = await container.skillQuery.listVersions(skillId);
    return reply.send({ items: versions });
  });

  app.get('/skills/:skillId/history', publicReadGuard, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const history = await container.skillQuery.getHistory(skillId);
    return reply.send({ items: history });
  });

  app.get('/skills/:skillId/deprecation', publicReadGuard, async (request, reply) => {
    try {
      const { skillId } = request.params as { skillId: string };
      const { version } = request.query as { version?: string };
      const result = await container.skillQuery.getDeprecationInfo(skillId, version);
      if (!result) {
        return sendApiError(reply, request, {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Skill or published version not found',
        });
      }
      return reply.send(result);
    } catch (error) {
      return sendMappedApiError(reply, request, error);
    }
  });
}
