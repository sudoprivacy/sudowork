import { execFile } from 'child_process';
import { constants } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { z } from 'zod';
import { ensureFfmpegInstalled, getFfmpegBinaryPath } from '@process/services/ffmpeg/FfmpegRuntimeService';
import { transcriptionService } from './TranscriptionService';

const execFileAsync = promisify(execFile);
const absolutePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => path.isAbsolute(value) && Array.from(value).every((char) => char.charCodeAt(0) >= 32), 'Use an absolute local file path.');

export const subtitleTranscribeSchema = z
  .object({
    inputPath: absolutePath,
    outputPath: absolutePath.refine((value) => path.extname(value).toLowerCase() === '.srt', 'Output must be an .srt file.'),
    language: z
      .string()
      .regex(/^[a-z]{2,3}$/)
      .optional(),
    model: z.enum(['tiny', 'base', 'small', 'medium', 'large-v3', 'turbo']).optional(),
  })
  .strict();

export const subtitleBurnSchema = z
  .object({
    inputPath: absolutePath,
    subtitlePath: absolutePath.refine((value) => path.extname(value).toLowerCase() === '.srt', 'Subtitles must be an .srt file.'),
    outputPath: absolutePath.refine((value) => path.extname(value).toLowerCase() === '.mp4', 'Output must be an .mp4 file.'),
  })
  .strict();

export class SubtitleBusyError extends Error {
  constructor() {
    super('A subtitle operation is already running. Wait for it to finish before retrying.');
  }
}

/** Local media operations shared by the agent skill and integration tests. */
export class SubtitleService {
  private isBusy = false;

  async transcribe(input: z.infer<typeof subtitleTranscribeSchema>, signal?: AbortSignal) {
    const params = subtitleTranscribeSchema.parse(input);
    return this.runExclusive(async () => {
      await requireFile(params.inputPath);
      await requireNewOutput(params.outputPath);
      const result = await transcriptionService.transcribeSubtitles(params.inputPath, { language: params.language, model: params.model, signal });
      signal?.throwIfAborted();
      await withOutputDirectory(params.outputPath, async (dir) => {
        const staged = path.join(dir, 'captions.srt');
        await fs.writeFile(staged, result.srt, 'utf8');
        await fs.copyFile(staged, params.outputPath, constants.COPYFILE_EXCL);
      });
      return { outputPath: params.outputPath, language: result.language };
    });
  }

  async burn(input: z.infer<typeof subtitleBurnSchema>, signal?: AbortSignal) {
    const params = subtitleBurnSchema.parse(input);
    return this.runExclusive(async () => {
      await requireFile(params.inputPath);
      const subtitles = await requireFile(params.subtitlePath);
      if (subtitles.size === 0 || subtitles.size > 16 * 1024 * 1024) throw new Error('Subtitles must be a non-empty SRT file under 16 MB.');
      await requireNewOutput(params.outputPath);
      signal?.throwIfAborted();
      if (!(await ensureFfmpegInstalled())) throw new Error('Could not prepare the video encoder. Check the network and retry.');
      signal?.throwIfAborted();

      await withOutputDirectory(params.outputPath, async (dir) => {
        // A fixed relative filter path avoids FFmpeg escaping rules for drive
        // letters, apostrophes, commas and non-ASCII user filenames.
        await fs.copyFile(params.subtitlePath, path.join(dir, 'captions.srt'));
        const staged = path.join(dir, 'video.mp4');
        await execFileAsync(
          getFfmpegBinaryPath(),
          ['-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', params.inputPath, '-map', '0:v:0', '-map', '0:a?', '-vf', 'subtitles=filename=captions.srt:charenc=UTF-8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', staged],
          {
            cwd: dir,
            timeout: 45 * 60 * 1000,
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true,
            signal,
          }
        );
        signal?.throwIfAborted();
        await fs.copyFile(staged, params.outputPath, constants.COPYFILE_EXCL);
      });
      return { outputPath: params.outputPath };
    });
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isBusy) throw new SubtitleBusyError();
    this.isBusy = true;
    try {
      return await operation();
    } finally {
      this.isBusy = false;
    }
  }
}

async function requireFile(filePath: string) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`Expected a media file: ${filePath}`);
  return stat;
}

async function requireNewOutput(filePath: string): Promise<void> {
  try {
    await fs.lstat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  throw new Error(`Output already exists. Choose a new filename: ${filePath}`);
}

async function withOutputDirectory<T>(outputPath: string, operation: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(path.dirname(outputPath), '.sudowork-subtitles-'));
  try {
    return await operation(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export const subtitleService = new SubtitleService();
