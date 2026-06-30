/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Python Runtime Service
 *
 * Manages a bundled Python interpreter (from python-build-standalone) that is
 * extracted at runtime to ~/.nexus/python/.  No administrator privileges are
 * required: extraction is done entirely in user space.
 *
 * Bundled archives are downloaded at build time via `bun run python:download`
 * and shipped as extraResources inside the packaged app.
 *
 * Fall-back: if no bundled archive is present (e.g. development without a
 * prior download), the service detects any system Python 3 installation and
 * reports it with source='system'.
 *
 * python-build-standalone archive naming:
 *   cpython-{VERSION}+{DATE}-{ARCH}-{OS}-install_only_stripped.tar.gz
 * All platforms use .tar.gz (Windows 10+ ships with a compatible tar.exe).
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { promisify } from 'util';
import { getDataPath } from '@process/utils';
import type { ICliStatus } from '@/common/ipcBridge';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { extractTarGzWithProgress } from '../archiveProgress';

const execAsync = promisify(exec);

const PYTHON_VERSION = '3.13.4';

export type InstallPhase = 'downloading' | 'installing' | 'configuring' | 'cleanup';
export type ProgressCallback = (phase: InstallPhase, percent?: number) => void;

// ── path helpers ──────────────────────────────────────────────────────────────

/** Root directory where the bundled Python is extracted. */
function getPythonDir(): string {
  return path.join(getDataPath(), 'python');
}

/** Absolute path to the Python interpreter binary. */
export function getPythonBinaryPath(): string {
  const dir = getPythonDir();
  return process.platform === 'win32' ? path.join(dir, 'python.exe') : path.join(dir, 'bin', 'python3');
}

/** Absolute path to the pip binary. */
export function getPipBinaryPath(): string {
  const dir = getPythonDir();
  return process.platform === 'win32' ? path.join(dir, 'Scripts', 'pip.exe') : path.join(dir, 'bin', 'pip3');
}

/** True when the managed Python binary exists on disk. */
export function isPythonInstalled(): boolean {
  return fs.existsSync(getPythonBinaryPath());
}

/** Resolve the bundled .tar.gz resource path (works packaged and in dev). */
function getBundledResourcePath(): string | null {
  const platform = process.platform; // 'darwin' | 'win32' | 'linux'
  const arch = process.arch; // 'arm64' | 'x64'
  const resourceName = `python-${platform}-${arch}.tar.gz`;

  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, resourceName);
    if (fs.existsSync(packaged)) return packaged;
  }

  // Development: look next to the electron-builder resources dir
  const dev = path.join(app.getAppPath(), 'resources', resourceName);
  if (fs.existsSync(dev)) return dev;

  return null;
}

// ── version helpers ───────────────────────────────────────────────────────────

async function readPythonVersion(binaryPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`"${binaryPath}" --version`);
    const match = (stdout + '').trim().match(/Python\s+(\S+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

// ── system Python fallback ────────────────────────────────────────────────────

async function checkSystemPython(): Promise<ICliStatus> {
  const candidates =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3']
      : process.platform === 'win32'
        ? [] // rely on PATH search only
        : [];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const version = await readPythonVersion(candidate);
      return { installed: true, version, path: candidate, source: 'system' };
    }
  }

  // PATH search
  try {
    const cmd = process.platform === 'win32' ? 'where python' : 'which python3 || which python';
    const { stdout } = await execAsync(cmd);
    const found = stdout.trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) {
      const version = await readPythonVersion(found);
      return { installed: true, version, path: found, source: 'system' };
    }
  } catch {
    /* not in PATH */
  }

  return { installed: false, source: 'none' };
}

// ── public API ────────────────────────────────────────────────────────────────

export class PythonRuntimeService {
  /** Check Python availability: managed first, then system fallback. */
  async checkInstalled(): Promise<ICliStatus> {
    if (isPythonInstalled()) {
      const version = await readPythonVersion(getPythonBinaryPath());
      return { installed: true, version, path: getPythonBinaryPath(), source: 'managed' };
    }
    return checkSystemPython();
  }

  /**
   * Extract the bundled Python archive to ~/.nexus/python/.
   * Reports progress via onProgress callbacks.
   */
  async install(onProgress: ProgressCallback): Promise<void> {
    const resourcePath = getBundledResourcePath();
    if (!resourcePath) {
      throw new Error(`Bundled Python archive not found for ${process.platform}-${process.arch}. ` + `Run \`bun run python:download\` to fetch it before building.`);
    }

    const pythonDir = getPythonDir();
    const pythonBin = getPythonBinaryPath();

    if (fs.existsSync(pythonBin)) {
      mainLog('PythonRuntime', 'Already installed at:', pythonBin);
      onProgress('configuring', 100);
      onProgress('cleanup');
      return;
    }

    mainLog('PythonRuntime', 'Installing Python', PYTHON_VERSION);
    mainLog('PythonRuntime', 'Resource:', resourcePath);
    mainLog('PythonRuntime', 'Target:', pythonDir);

    fs.mkdirSync(pythonDir, { recursive: true });

    try {
      onProgress('installing', 0);

      // python-build-standalone archives contain a single top-level "python/"
      // directory; strip it so the contents land directly in pythonDir.
      await extractTarGzWithProgress(resourcePath, pythonDir, (percent) => onProgress('installing', percent), { strip: 1 });

      mainLog('PythonRuntime', 'Extraction complete. Contents:', fs.readdirSync(pythonDir));

      if (!fs.existsSync(pythonBin)) {
        throw new Error(`Python binary not found at expected path: ${pythonBin}`);
      }

      // Ensure executables are runnable on Unix
      if (process.platform !== 'win32') {
        onProgress('configuring');
        for (const bin of [pythonBin, getPipBinaryPath()]) {
          if (fs.existsSync(bin)) fs.chmodSync(bin, 0o755);
        }
        // chmod +x all binaries in bin/
        const binDir = path.join(pythonDir, 'bin');
        if (fs.existsSync(binDir)) {
          for (const f of fs.readdirSync(binDir)) {
            const fp = path.join(binDir, f);
            if (fs.statSync(fp).isFile()) fs.chmodSync(fp, 0o755);
          }
        }
      }

      mainLog('PythonRuntime', 'Python installed successfully:', pythonBin);
    } catch (err) {
      mainError('PythonRuntime', 'Installation failed:', err);
      // Clean up partial extraction
      try {
        fs.rmSync(pythonDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      onProgress('cleanup');
    }
  }

  /** Remove the managed Python installation from ~/.nexus/python/. */
  async uninstall(): Promise<void> {
    const pythonDir = getPythonDir();
    if (fs.existsSync(pythonDir)) {
      fs.rmSync(pythonDir, { recursive: true, force: true });
      mainLog('PythonRuntime', 'Removed managed Python at:', pythonDir);
    }
  }

  /** Returns the managed Python binary path (for use by other services). */
  getPythonBinaryPath(): string {
    return getPythonBinaryPath();
  }

  /** Returns the managed pip binary path (for use by other services). */
  getPipBinaryPath(): string {
    return getPipBinaryPath();
  }
}

export const pythonRuntimeService = new PythonRuntimeService();
