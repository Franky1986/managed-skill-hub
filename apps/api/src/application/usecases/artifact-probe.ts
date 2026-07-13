import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ValidationError } from '../../domain/errors';

const execFileAsync = promisify(execFile);

export interface ArtifactProbeResponse {
  probedBy: string;
  tool: string;
  filePath: string;
  mimeType: string;
  summary: Record<string, unknown>;
  parsed: Record<string, unknown>;
  format: Record<string, unknown>;
  streams: Array<Record<string, unknown>>;
  rawOutput: string;
}

export type ArtifactProbeExecutor = (
  content: Buffer,
  mimeType: string,
  filePath: string
) => Promise<ArtifactProbeResponse>;

const ffprobeBinary = 'ffprobe';

export async function probeArtifactContent(
  content: Buffer,
  mimeType: string,
  filePath: string
): Promise<ArtifactProbeResponse> {
  if (!isArtifactProbeSupported(mimeType, filePath)) {
    throw new ValidationError(`Artifact probe not supported for ${filePath}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'msf-probe-'));
  const tempFile = path.join(tempDir, `${randomUUID()}-${path.basename(filePath)}`);

  try {
    await fs.writeFile(tempFile, content);
    const { stdout } = await execFileAsync(
      ffprobeBinary,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        tempFile,
      ],
      {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const normalizedOutput = String(stdout ?? '').trim();
    if (!normalizedOutput) {
      throw new ValidationError('ffprobe returned an empty response');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(normalizedOutput) as Record<string, unknown>;
    } catch {
      throw new ValidationError('ffprobe output was not valid JSON');
    }

    const format = asObject(parsed.format);
    const streams = asArray(parsed.streams);

    return {
      probedBy: 'ffprobe',
      tool: 'ffprobe',
      filePath,
      mimeType,
      rawOutput: normalizedOutput,
      format,
      streams,
      parsed,
      summary: buildProbeSummary(format, streams),
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unknown ffprobe error';
    throw new ValidationError(`ffprobe failed: ${message}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export function isArtifactProbeSupported(mimeType: string, filePath: string): boolean {
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
    return true;
  }
  const normalized = filePath.toLowerCase();
  return /\.(3gp|avi|flv|m4v|mkv|mov|mp4|mpg|mpeg|ogv|webm|wmv)$/i.test(normalized)
    || /\.(aac|aiff|flac|mp3|m4a|ogg|opus|wav)$/i.test(normalized);
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry));
}

function buildProbeSummary(format: Record<string, unknown>, streams: Array<Record<string, unknown>>): Record<string, unknown> {
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');

  return {
    formatName: format.format_name ?? null,
    longName: format.format_long_name ?? null,
    duration: format.duration ?? null,
    bitRate: format.bit_rate ?? null,
    size: format.size ?? null,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    frameRate: videoStream?.r_frame_rate ?? null,
    sampleRate: audioStream?.sample_rate ?? null,
    channels: audioStream?.channels ?? null,
    numberOfStreams: streams.length,
  };
}
