/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared voice-transcription service.
 *
 * One entry point — `transcribe(audioPath, codec) → text` — used by the channel
 * gateway (ActionExecutor) for ALL platforms. The per-channel adapter supplies only
 * the audio file path and a codec hint (e.g. WeChat = SILK); decoding + ASR are
 * shared here so personal WeChat, WeCom, and DingTalk can all reuse it.
 *
 * The engine is pluggable behind {@link ITranscriptionEngine}:
 *   - local (default): rides the already-provisioned Python runtime
 *     (PythonRuntimeService, also used by ai-dev-browser) and runs CPU-only ASR
 *     (faster-whisper / SenseVoice) via resources/transcription/transcribe.py.
 *     Audio never leaves the device.
 *   - cloud (opt-in): config switch for weak machines — NOT wired by default
 *     because audio would leave the device (privacy tradeoff).
 *
 * Failure policy: every public call resolves to a string. On any failure
 * (no Python, missing deps, ASR error, timeout) it returns an empty string so the
 * caller can fall back to the `[voice message]` placeholder and never break the
 * channel. It must never throw or hang.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { promisify } from 'util';
import { ProcessConfig } from '@/process/initStorage';
import { getDataPath } from '@/process/utils';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { pythonRuntimeService } from '@/process/services/python/PythonRuntimeService';

const execFileAsync = promisify(execFile);

const TAG = 'Transcription';

/** Per-call wall-clock budget. ASR on a short clip is seconds; the model
 *  download on first run can be slow, so allow several minutes before bailing. */
const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;
/** First-run pip install of the ASR deps can be slow on China mirrors. */
const PROVISION_TIMEOUT_MS = 10 * 60 * 1000;

export type LocalEngineName = 'faster-whisper' | 'sensevoice';

export interface TranscriptionConfig {
  /** Which engine implementation to use. */
  engine: 'local' | 'cloud';
  /** Local ASR backend (ignored for cloud). */
  localEngine: LocalEngineName;
  /** Engine-specific model name; empty = engine default. */
  model: string;
  /** Language hint (e.g. 'zh', 'en'); empty = auto-detect. */
  language: string;
}

const DEFAULT_CONFIG: TranscriptionConfig = {
  engine: 'local',
  localEngine: 'faster-whisper',
  model: '',
  language: '',
};

/**
 * Pluggable transcription backend. Implementations must resolve to a string and
 * never throw — return '' to signal "unavailable" so the gateway falls back.
 */
export interface ITranscriptionEngine {
  readonly name: string;
  transcribe(audioPath: string, codec?: string): Promise<string>;
}

/** Resolve the bundled transcribe.py path in both dev and packaged builds. */
function getScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'transcription', 'transcribe.py');
  }
  return path.join(app.getAppPath(), 'resources', 'transcription', 'transcribe.py');
}

/**
 * Local CPU ASR engine. Spawns the provisioned Python with transcribe.py.
 * pip deps (faster-whisper / pilk, or funasr for SenseVoice) are installed lazily
 * on first use and remembered via a marker file so we don't reinstall every call.
 */
export class LocalPythonEngine implements ITranscriptionEngine {
  readonly name = 'local';

  constructor(private readonly config: TranscriptionConfig) {}

  /** pip packages required for the selected local engine. */
  private requiredPackages(): string[] {
    // pilk is always needed: only it can decode WeChat/Tencent SILK voice.
    const base = ['pilk'];
    if (this.config.localEngine === 'sensevoice') {
      return [...base, 'funasr'];
    }
    return [...base, 'faster-whisper'];
  }

  private markerPath(): string {
    const dir = path.join(getDataPath(), 'transcription');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `.deps-${this.config.localEngine}`);
  }

  /** Best-effort: ensure ASR pip deps are present. Returns false if Python is
   *  unavailable (caller then falls back). A failed install is non-fatal — the
   *  transcribe step will surface a structured error and we fall back anyway. */
  private async ensureDeps(pythonPath: string): Promise<boolean> {
    const marker = this.markerPath();
    if (fs.existsSync(marker)) return true;

    const pkgs = this.requiredPackages();
    mainLog(TAG, `Provisioning ASR deps (${pkgs.join(', ')}) — first run, may be slow`);
    const mirror = 'https://pypi.tuna.tsinghua.edu.cn/simple';
    try {
      await execFileAsync(pythonPath, ['-m', 'pip', 'install', '-i', mirror, '--extra-index-url', 'https://pypi.org/simple', ...pkgs], {
        timeout: PROVISION_TIMEOUT_MS,
      });
      fs.writeFileSync(marker, new Date().toISOString());
      return true;
    } catch (err) {
      mainWarn(TAG, 'Failed to provision ASR deps; will attempt transcription anyway', err);
      return false;
    }
  }

  async transcribe(audioPath: string, codec?: string): Promise<string> {
    const status = await pythonRuntimeService.checkInstalled();
    if (!status.installed || !status.path) {
      mainWarn(TAG, 'Python runtime not installed — cannot transcribe');
      return '';
    }
    const python = status.path;

    const script = getScriptPath();
    if (!fs.existsSync(script)) {
      mainWarn(TAG, `transcribe.py not found at ${script}`);
      return '';
    }

    // Provisioning failure is non-fatal; the script reports a structured error.
    await this.ensureDeps(python);

    const argv = [script, '--audio', audioPath, '--engine', this.config.localEngine];
    if (codec) argv.push('--codec', codec);
    if (this.config.model) argv.push('--model', this.config.model);
    if (this.config.language) argv.push('--language', this.config.language);

    try {
      const { stdout } = await execFileAsync(python, argv, {
        timeout: TRANSCRIBE_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      });
      return parseTranscriptOutput(stdout);
    } catch (err: any) {
      // execFile rejects on non-zero exit; the script still prints JSON on stdout.
      const text = parseTranscriptOutput(err?.stdout ?? '');
      if (text) return text;
      mainWarn(TAG, 'Transcription failed', err?.stderr || err?.message || err);
      return '';
    }
  }
}

/**
 * Cloud engine placeholder. Intentionally a no-op until a provider is wired —
 * keeps the interface symmetric so local↔cloud is a config switch. Returning ''
 * means the gateway falls back to the placeholder rather than silently failing.
 */
export class CloudEngine implements ITranscriptionEngine {
  readonly name = 'cloud';
  async transcribe(): Promise<string> {
    mainWarn(TAG, 'Cloud transcription engine is not configured — falling back');
    return '';
  }
}

/** Parse the helper's stdout (a single JSON object) into transcript text. */
export function parseTranscriptOutput(stdout: string): string {
  const trimmed = (stdout || '').trim();
  if (!trimmed) return '';
  // The helper prints exactly one JSON object; tolerate trailing log lines by
  // scanning for the last line that parses as JSON.
  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line) as { text?: string; error?: string };
      if (obj.error) {
        mainWarn(TAG, `Transcription helper error: ${obj.error}`);
        return '';
      }
      return (obj.text || '').trim();
    } catch {
      // keep scanning earlier lines
    }
  }
  return '';
}

async function loadConfig(): Promise<TranscriptionConfig> {
  try {
    const [engine, localEngine, model, language] = await Promise.all([ProcessConfig.get('assistant.transcription.engine'), ProcessConfig.get('assistant.transcription.localEngine'), ProcessConfig.get('assistant.transcription.model'), ProcessConfig.get('assistant.transcription.language')]);
    return {
      engine: engine ?? DEFAULT_CONFIG.engine,
      localEngine: localEngine ?? DEFAULT_CONFIG.localEngine,
      model: model ?? DEFAULT_CONFIG.model,
      language: language ?? DEFAULT_CONFIG.language,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Shared service. Lazily builds the configured engine. Stateless across calls
 * apart from the cached config/engine, which is rebuilt when the config changes.
 */
export class TranscriptionService {
  private engine: ITranscriptionEngine | null = null;
  private engineKey = '';

  private buildEngine(config: TranscriptionConfig): ITranscriptionEngine {
    return config.engine === 'cloud' ? new CloudEngine() : new LocalPythonEngine(config);
  }

  /**
   * Transcribe an audio file to text. Always resolves to a string; '' means
   * transcription was unavailable and the caller should fall back.
   *
   * @param audioPath absolute path to the downloaded audio file
   * @param codec     source codec hint from the adapter (e.g. 'silk', 'amr')
   */
  async transcribe(audioPath: string, codec?: string): Promise<string> {
    if (!audioPath || !fs.existsSync(audioPath)) {
      mainWarn(TAG, `Audio file missing: ${audioPath}`);
      return '';
    }
    const config = await loadConfig();
    const key = `${config.engine}:${config.localEngine}:${config.model}:${config.language}`;
    if (!this.engine || this.engineKey !== key) {
      this.engine = this.buildEngine(config);
      this.engineKey = key;
    }
    const text = await this.engine.transcribe(audioPath, codec);
    if (text) {
      mainLog(TAG, `Transcribed ${path.basename(audioPath)} (${text.length} chars) via ${this.engine.name}`);
    }
    return text;
  }
}

export const transcriptionService = new TranscriptionService();
