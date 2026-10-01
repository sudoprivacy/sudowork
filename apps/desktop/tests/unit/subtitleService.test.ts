import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runEncoder, ensureEncoder } = vi.hoisted(() => ({ runEncoder: vi.fn(), ensureEncoder: vi.fn() }));
vi.mock('child_process', () => ({
  execFile: (_file: string, args: string[], options: unknown, onDone: (err: Error | null) => void) => {
    runEncoder(args, options).then(() => onDone(null), onDone);
  },
}));
vi.mock('@process/services/ffmpeg/FfmpegRuntimeService', () => ({ ensureFfmpegInstalled: ensureEncoder, getFfmpegBinaryPath: () => 'managed-ffmpeg' }));
vi.mock('@process/services/transcription/TranscriptionService', () => ({ transcriptionService: { transcribeSubtitles: vi.fn() } }));

import { SubtitleService } from '@process/services/transcription/SubtitleService';

let dir: string;
let inputPath: string;
let subtitlePath: string;
let outputPath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "subtitles-字幕's, "));
  inputPath = path.join(dir, 'source.mp4');
  subtitlePath = path.join(dir, "user's captions.srt");
  outputPath = path.join(dir, 'finished.mp4');
  await fs.writeFile(inputPath, 'original video');
  await fs.writeFile(subtitlePath, '1\n00:00:00,000 --> 00:00:02,000\n你好\n');
  ensureEncoder.mockReset().mockResolvedValue(true);
  runEncoder.mockReset().mockImplementation(async (args: string[]) => fs.writeFile(args.at(-1)!, 'encoded video'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Subtitle video output', () => {
  it('uses a fixed filter path and publishes only the completed output', async () => {
    await new SubtitleService().burn({ inputPath, subtitlePath, outputPath });
    const [args, options] = runEncoder.mock.calls[0];
    expect(args).toContain(inputPath);
    expect(args).not.toContain(subtitlePath);
    expect(args).toContain('subtitles=filename=captions.srt:charenc=UTF-8');
    expect(options.cwd.startsWith(dir)).toBe(true);
    expect(await fs.readFile(outputPath, 'utf8')).toBe('encoded video');
    expect(await fs.readFile(inputPath, 'utf8')).toBe('original video');
    expect((await fs.readdir(dir)).some((file) => file.startsWith('.sudowork-subtitles-'))).toBe(false);
  });

  it('cleans failed encoder output and releases the operation for a retry', async () => {
    runEncoder.mockImplementationOnce(async (args: string[]) => {
      await fs.writeFile(args.at(-1)!, 'incomplete video');
      throw new Error('encoder failed');
    });
    const service = new SubtitleService();
    await expect(service.burn({ inputPath, subtitlePath, outputPath })).rejects.toThrow('encoder failed');
    await expect(fs.stat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(dir)).some((file) => file.startsWith('.sudowork-subtitles-'))).toBe(false);
    await service.burn({ inputPath, subtitlePath, outputPath });
    expect(await fs.readFile(outputPath, 'utf8')).toBe('encoded video');
  });

  it('refuses a target created while the encoder was running', async () => {
    runEncoder.mockImplementationOnce(async (args: string[]) => {
      await fs.writeFile(args.at(-1)!, 'encoded video');
      await fs.writeFile(outputPath, 'another operation');
    });
    await expect(new SubtitleService().burn({ inputPath, subtitlePath, outputPath })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(outputPath, 'utf8')).toBe('another operation');
  });

  it('does not encode when runtime provisioning fails', async () => {
    ensureEncoder.mockResolvedValue(false);
    await expect(new SubtitleService().burn({ inputPath, subtitlePath, outputPath })).rejects.toThrow('Could not prepare');
    expect(runEncoder).not.toHaveBeenCalled();
    await expect(fs.stat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
