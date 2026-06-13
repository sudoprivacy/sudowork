/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// app.getAppPath() points at the repo root so the bundled transcribe.py resolves.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

// ---- Mock the provisioned Python runtime ----
const checkInstalled = vi.fn();
vi.mock('@/process/services/python/PythonRuntimeService', () => ({
  pythonRuntimeService: {
    checkInstalled: () => checkInstalled(),
  },
}));

// ---- Mock config reads (ProcessConfig.get) ----
const configStore: Record<string, unknown> = {};
vi.mock('@/process/initStorage', () => ({
  ProcessConfig: {
    get: (key: string) => Promise.resolve(configStore[key]),
  },
}));

// ---- Mock getDataPath to a temp dir (marker files land here) ----
let tmpDataDir: string;
vi.mock('@/process/utils', () => ({
  getDataPath: () => tmpDataDir,
}));

// ---- Mock child_process.execFile (callback-style, promisify-compatible) ----
type ExecHandler = (file: string, args: string[]) => { stdout: string } | Error;
let execHandler: ExecHandler;
const execFileCalls: Array<{ file: string; args: string[] }> = [];
vi.mock('child_process', () => ({
  execFile: (file: string, args: string[], _opts: unknown, cb: (err: Error | null, res?: { stdout: string }) => void) => {
    execFileCalls.push({ file, args });
    const result = execHandler(file, args);
    if (result instanceof Error) cb(result);
    else cb(null, result);
  },
}));

import { TranscriptionService, parseTranscriptOutput } from '@/process/services/transcription/TranscriptionService';

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudowork-transcribe-'));
  execFileCalls.length = 0;
  for (const k of Object.keys(configStore)) delete configStore[k];
  checkInstalled.mockReset();
  // Default: pip install (ensureDeps) succeeds; transcription returns a transcript.
  execHandler = (_file, args) => {
    if (args.includes('pip')) return { stdout: '' };
    return { stdout: JSON.stringify({ text: 'hello world', engine: 'faster-whisper' }) };
  };
});

afterEach(() => {
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

describe('parseTranscriptOutput', () => {
  it('extracts text from a clean JSON line', () => {
    expect(parseTranscriptOutput(JSON.stringify({ text: '你好' }))).toBe('你好');
  });

  it('ignores leading log lines and reads the trailing JSON', () => {
    const out = ['Downloading model...', 'done', JSON.stringify({ text: 'final' })].join('\n');
    expect(parseTranscriptOutput(out)).toBe('final');
  });

  it('returns empty string for a structured error', () => {
    expect(parseTranscriptOutput(JSON.stringify({ error: 'boom' }))).toBe('');
  });

  it('returns empty string for empty or non-JSON output', () => {
    expect(parseTranscriptOutput('')).toBe('');
    expect(parseTranscriptOutput('not json at all')).toBe('');
  });
});

describe('TranscriptionService', () => {
  const audioFile = () => {
    const f = path.join(tmpDataDir, 'clip.amr');
    fs.writeFileSync(f, 'fake-audio');
    return f;
  };

  it('returns empty string when the audio file is missing', async () => {
    checkInstalled.mockResolvedValue({ installed: true, path: '/usr/bin/python3' });
    const svc = new TranscriptionService();
    expect(await svc.transcribe(path.join(tmpDataDir, 'nope.amr'), 'silk')).toBe('');
  });

  it('returns empty string when Python is not installed (graceful fallback)', async () => {
    checkInstalled.mockResolvedValue({ installed: false });
    const svc = new TranscriptionService();
    expect(await svc.transcribe(audioFile(), 'silk')).toBe('');
  });

  it('transcribes via the local engine and forwards codec + engine args', async () => {
    checkInstalled.mockResolvedValue({ installed: true, path: '/usr/bin/python3' });
    const svc = new TranscriptionService();
    const text = await svc.transcribe(audioFile(), 'silk');

    expect(text).toBe('hello world');
    const run = execFileCalls.find((c) => c.args.some((a) => a.endsWith('transcribe.py')));
    expect(run).toBeTruthy();
    expect(run!.args).toContain('--codec');
    expect(run!.args).toContain('silk');
    expect(run!.args).toContain('--engine');
    expect(run!.args).toContain('faster-whisper');
  });

  it('falls back to empty string when the helper reports an error', async () => {
    checkInstalled.mockResolvedValue({ installed: true, path: '/usr/bin/python3' });
    execHandler = (_file, args) => {
      if (args.includes('pip')) return { stdout: '' };
      // Non-zero exit: the helper printed an error JSON to stdout before exiting.
      return Object.assign(new Error('exit 1'), { stdout: JSON.stringify({ error: 'pilk missing' }) });
    };
    const svc = new TranscriptionService();
    expect(await svc.transcribe(audioFile(), 'silk')).toBe('');
  });

  it('uses the SenseVoice engine when configured', async () => {
    configStore['assistant.transcription.localEngine'] = 'sensevoice';
    checkInstalled.mockResolvedValue({ installed: true, path: '/usr/bin/python3' });
    const svc = new TranscriptionService();
    await svc.transcribe(audioFile(), 'silk');

    const run = execFileCalls.find((c) => c.args.some((a) => a.endsWith('transcribe.py')));
    expect(run!.args).toContain('sensevoice');
    // funasr should be in the pip provisioning set for SenseVoice.
    const pip = execFileCalls.find((c) => c.args.includes('pip'));
    expect(pip!.args).toContain('funasr');
  });

  it('returns empty string for the cloud engine (not configured)', async () => {
    configStore['assistant.transcription.engine'] = 'cloud';
    const svc = new TranscriptionService();
    expect(await svc.transcribe(audioFile(), 'silk')).toBe('');
    // Cloud engine must not spawn Python.
    expect(execFileCalls.length).toBe(0);
  });
});
