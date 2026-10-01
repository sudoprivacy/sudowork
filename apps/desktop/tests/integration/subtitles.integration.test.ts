import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({ isEnterprise: false }));
vi.mock('@common/enterpriseDebugConfig', () => ({ isEnterpriseMode: () => account.isEnterprise }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@/process/initStorage', () => ({ ProcessConfig: { get: vi.fn(async () => undefined) } }));
vi.mock('@process/services/python/PythonRuntimeService', () => ({
  pythonRuntimeService: { checkInstalled: async () => ({ installed: true, path: process.env.SUBTITLE_TEST_PYTHON || 'python3' }) },
}));
vi.mock('@process/services/ffmpeg/FfmpegRuntimeService', () => ({
  ensureFfmpegInstalled: async () => true,
  getFfmpegBinaryPath: () => process.env.SUBTITLE_TEST_FFMPEG || 'ffmpeg',
}));
vi.mock('../../src/process/services/authProxy/configItemsLoader', () => ({ findRuleForUrl: vi.fn(), refreshRules: vi.fn(), getRules: vi.fn() }));
vi.mock('../../src/process/services/authProxy/secretsApi', () => ({ handleSecretsRequest: vi.fn() }));
vi.mock('../../src/process/services/authProxy/pwdLoginApi', () => ({ handlePwdLoginRequest: vi.fn() }));
vi.mock('@common/nexus/secret-cache', () => ({ resolveSecret: vi.fn() }));

const execFileAsync = promisify(execFile);
const isLive = process.env.SUBTITLE_LIVE_TEST === '1';
const token = 'subtitle-integration-token';
const cli = path.resolve('skills/_builtin/video-subtitles/scripts/subtitles.mjs');
const captions = '1\n00:00:00,000 --> 00:00:02,000\nHello world\n';
let server: import('../../src/process/services/authProxy/AuthProxyServer').AuthProxyServer;
let transcription: typeof import('../../src/process/services/transcription/TranscriptionService').transcriptionService;
let base: string;
let dir: string;

beforeAll(async () => {
  const { AuthProxyServer } = await import('../../src/process/services/authProxy/AuthProxyServer');
  transcription = (await import('../../src/process/services/transcription/TranscriptionService')).transcriptionService;
  server = new AuthProxyServer(() => false);
  base = `http://127.0.0.1:${await server.start()}`;
  server.registerToken(token, process.pid);
});

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "subtitles-字幕's, "));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await server?.stop();
});

async function request(route: string, body: unknown, auth = token) {
  return fetch(`${base}/subtitles/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function runCli(args: string[]) {
  return execFileAsync(process.execPath, [cli, ...args], { env: { ...process.env, SUDOWORK_AUTH_PROXY_BASE_URL: base, SUDOWORK_AUTH_PROXY_TOKEN: token }, timeout: 10 * 60 * 1000, windowsHide: true });
}

describe('Subtitle skill over the authenticated local HTTP connection', () => {
  it('starts local media for online accounts while keeping credentials on Moss', async () => {
    const proxy = await import('../../src/process/services/authProxy');
    account.isEnterprise = true;
    try {
      const [port, concurrentPort] = await Promise.all([proxy.ensureLocalAgentApiPort(), proxy.ensureLocalAgentApiPort()]);
      expect(port).toBeGreaterThan(0);
      expect(concurrentPort).toBe(port);
      expect(proxy.getCredentialProxyUrl()).toBeNull();
      proxy.registerToken(token, process.pid);
      const inputPath = path.join(dir, 'source.mp4');
      const outputPath = path.join(dir, 'online.srt');
      await fs.writeFile(inputPath, 'original');
      vi.spyOn(transcription, 'transcribeSubtitles').mockResolvedValue({ format: 'srt', srt: captions, text: 'Hello', language: 'en' });
      const headers = { Authorization: `Bearer ${token}` };
      const response = await fetch(`http://127.0.0.1:${port}/subtitles/transcribe`, { method: 'POST', headers, body: JSON.stringify({ inputPath, outputPath }) });
      expect(response.status).toBe(200);
      expect(await fs.readFile(outputPath, 'utf8')).toBe(captions);
      for (const route of ['/proxy', '/secrets', '/pwdlogin']) {
        expect((await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers })).status).toBe(403);
      }
      account.isEnterprise = false;
      expect(proxy.getCredentialProxyUrl()).toBe(`http://127.0.0.1:${port}/proxy`);
      account.isEnterprise = true;
      expect((await fetch(`http://127.0.0.1:${port}/secrets`, { headers })).status).toBe(403);
    } finally {
      await proxy.stopAuthProxy();
      account.isEnterprise = false;
    }
  });

  it('discovers the shipped builtin even when the assistant selects other skills', async () => {
    const { listWorkspaceSkillTargets } = await import('../../src/process/utils/workspaceSkillTargets');
    const target = path.join(dir, '_system', '_builtin', 'video-subtitles');
    await fs.cp(path.resolve('skills/_builtin/video-subtitles'), target, { recursive: true });
    const skills = await listWorkspaceSkillTargets(dir, new Set(['other-skill']));
    expect(skills.get('video-subtitles')).toBe(target);
    expect(await fs.readFile(path.join(target, 'scripts', 'subtitles.mjs'), 'utf8')).toContain('SUDOWORK_AUTH_PROXY_TOKEN');
  });

  it('links the bundled subtitle skill after login without exposing personal skills', async () => {
    const { listWorkspaceSkillTargets } = await import('../../src/process/utils/workspaceSkillTargets');
    const shared = path.join(dir, 'skills', '_system', '_builtin');
    const target = path.join(shared, 'video-subtitles');
    await fs.cp(path.resolve('skills/_builtin/video-subtitles'), target, { recursive: true });
    const personal = path.join(dir, 'skills', '_my-custom-skill', 'private-skill');
    await fs.mkdir(personal, { recursive: true });
    await fs.writeFile(path.join(personal, 'SKILL.md'), '# Private skill');
    const accountSkills = path.join(dir, 'managed', 'account-a', 'skills');
    const skills = await listWorkspaceSkillTargets(accountSkills, new Set(), shared);
    expect([...skills.entries()]).toEqual([['video-subtitles', target]]);
  });

  it('runs the shipped CLI and writes UTF-8 captions at the requested path', async () => {
    const spy = vi.spyOn(transcription, 'transcribeSubtitles').mockResolvedValue({ format: 'srt', srt: captions, text: 'Hello world', language: 'en' });
    const input = path.join(dir, 'source.mp4');
    const output = path.join(dir, 'captions.srt');
    await fs.writeFile(input, 'original');
    const result = JSON.parse((await runCli(['transcribe', '--input', input, '--output', output])).stdout);
    expect(result).toEqual({ success: true, data: { outputPath: output, language: 'en' } });
    expect(await fs.readFile(output, 'utf8')).toBe(captions);
    expect(await fs.readFile(input, 'utf8')).toBe('original');
    expect(spy).toHaveBeenCalledWith(input, expect.objectContaining({ language: undefined, signal: expect.any(AbortSignal) }));
  });

  it('rejects missing/revoked credentials before starting ASR', async () => {
    const spy = vi.spyOn(transcription, 'transcribeSubtitles');
    expect((await request('transcribe', {}, '')).status).toBe(401);
    server.registerToken('revoked', process.pid);
    server.revokeToken('revoked');
    expect((await request('transcribe', {}, 'revoked')).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects invalid paths and unexpected options at the API boundary', async () => {
    const response = await request('transcribe', { inputPath: 'https://example.com/a.mp4', outputPath: path.join(dir, 'x.srt'), shell: 'bad' });
    expect(response.status).toBe(400);
    expect((await request('unknown', {})).status).toBe(404);
  });

  it('rejects malformed and oversized request bodies without starting ASR', async () => {
    const spy = vi.spyOn(transcription, 'transcribeSubtitles');
    const headers = { Authorization: `Bearer ${token}` };
    expect((await fetch(`${base}/subtitles/transcribe`, { method: 'POST', headers, body: '{' })).status).toBe(400);
    expect((await fetch(`${base}/subtitles/transcribe`, { method: 'POST', headers, body: JSON.stringify({ data: 'x'.repeat(17 * 1024) }) })).status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaves existing files unchanged without running a model', async () => {
    const spy = vi.spyOn(transcription, 'transcribeSubtitles');
    const inputPath = path.join(dir, 'source.mp4');
    const outputPath = path.join(dir, 'captions.srt');
    await fs.writeFile(inputPath, 'original');
    await fs.writeFile(outputPath, 'existing');
    expect((await request('transcribe', { inputPath, outputPath })).status).toBe(422);
    expect(await fs.readFile(outputPath, 'utf8')).toBe('existing');
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns a failure to the CLI and allows a later retry', async () => {
    const spy = vi.spyOn(transcription, 'transcribeSubtitles').mockRejectedValueOnce(new Error('No speech was detected.')).mockResolvedValue({ format: 'srt', srt: captions, text: 'Hello', language: 'en' });
    const input = path.join(dir, 'source.mp4');
    const output = path.join(dir, 'captions.srt');
    await fs.writeFile(input, 'original');
    await expect(runCli(['transcribe', '--input', input, '--output', output])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('No speech') });
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
    await runCli(['transcribe', '--input', input, '--output', output]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('aborts ASR on disconnect and refuses concurrent model jobs', async () => {
    let onStarted!: () => void;
    let onAborted!: () => void;
    const started = new Promise<void>((resolve) => {
      onStarted = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      onAborted = resolve;
    });
    vi.spyOn(transcription, 'transcribeSubtitles').mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            'abort',
            () => {
              onAborted();
              reject(new Error('cancelled'));
            },
            { once: true }
          );
          onStarted();
        })
    );
    const inputPath = path.join(dir, 'source.mp4');
    await fs.writeFile(inputPath, 'original');
    const controller = new AbortController();
    const pending = fetch(`${base}/subtitles/transcribe`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ inputPath, outputPath: path.join(dir, 'first.srt') }), signal: controller.signal }).catch(() => undefined);
    await started;
    expect((await request('transcribe', { inputPath, outputPath: path.join(dir, 'second.srt') })).status).toBe(409);
    controller.abort();
    await aborted;
    await pending;
    await expect(fs.stat(path.join(dir, 'first.srt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

// Set SUBTITLE_LIVE_TEST=1 in CI to require real CPU ASR and FFmpeg. Only the
// Electron host/runtime lookup is replaced; CLI, HTTP, media operations and
// transcription helper are the production implementations.
describe.skipIf(!isLive)('Subtitle skill with real speech recognition and encoding', () => {
  it(
    'transcribes a spoken video and renders visible captions without changing the source',
    async () => {
      const ffmpeg = process.env.SUBTITLE_TEST_FFMPEG || 'ffmpeg';
      const input = path.join(dir, 'original video.mp4');
      const srt = path.join(dir, 'captions.srt');
      const translatedSrt = path.join(dir, 'captions-zh.srt');
      const output = path.join(dir, 'finished video.mp4');
      // The fixture is synthetic speech: "Hello world. This video demonstrates
      // automatic subtitles. Please keep the original video safe."
      await execFileAsync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=25', '-i', path.resolve('tests/fixtures/subtitles/speech.wav'), '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', input], { windowsHide: true, timeout: 60_000 });
      const original = await fs.readFile(input);
      const transcript = JSON.parse((await runCli(['transcribe', '--input', input, '--output', srt])).stdout);
      expect(transcript.data.language).toBe('en');
      const text = await fs.readFile(srt, 'utf8');
      expect(text.toLowerCase()).toContain('hello');
      expect(text.toLowerCase()).toContain('subtitle');
      expect(text).toMatch(/\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}/);
      // A reviewed fixture translation stands in for the conversational agent.
      // Retain the real ASR timing while exercising UTF-8 Chinese burn-in.
      const cues = text.trim().split(/\r?\n\r?\n/);
      expect(cues).toHaveLength(1);
      await fs.writeFile(translatedSrt, `${cues[0].split('\n').slice(0, 2).join('\n')}\n你好，世界。这段视频演示自动字幕。请保留原始视频。\n`, 'utf8');
      await runCli(['burn', '--input', input, '--subtitles', translatedSrt, '--output', output]);
      expect(await fs.readFile(input)).toEqual(original);
      if (process.env.SUBTITLE_TEST_ARTIFACT_DIR) {
        await fs.mkdir(process.env.SUBTITLE_TEST_ARTIFACT_DIR, { recursive: true });
        await fs.cp(dir, process.env.SUBTITLE_TEST_ARTIFACT_DIR, { recursive: true });
      }
      const frames = await execFileAsync(ffmpeg, ['-v', 'error', '-i', output, '-vf', 'fps=2,crop=160:90:(iw-160)/2:ih-90,format=gray', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      expect(frames.stdout.length).toBeGreaterThan(160 * 90);
      // A black source has no bright pixels. White caption pixels prove burn-in.
      expect(frames.stdout.reduce((max, pixel) => Math.max(max, pixel), 0)).toBeGreaterThan(180);
      await expect(runCli(['burn', '--input', input, '--subtitles', srt, '--output', input])).rejects.toMatchObject({ code: 1 });
      expect(await fs.readFile(input)).toEqual(original);
    },
    10 * 60 * 1000
  );

  it(
    'reports silence without leaving a subtitle artifact',
    async () => {
      const ffmpeg = process.env.SUBTITLE_TEST_FFMPEG || 'ffmpeg';
      const input = path.join(dir, 'silence.wav');
      const output = path.join(dir, 'silence.srt');
      await execFileAsync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '2', input], { windowsHide: true });
      await expect(runCli(['transcribe', '--input', input, '--output', output])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('No speech') });
      await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
    },
    10 * 60 * 1000
  );
});
