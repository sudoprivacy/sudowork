/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Git Install Service
 *
 * Cross-platform git detection and online installation.
 * - Windows:        Downloads the official Git for Windows installer from GitHub Releases
 *                   and runs it silently. Architecture-aware (x64 / arm64).
 * - macOS:          Triggers `xcode-select --install` (installs git via CLT), falls back
 *                   to `brew install git` if Homebrew is present.
 * - Linux:          Tries common package managers in order: apt-get → dnf → yum → pacman → zypper.
 *
 * All installation steps are non-fatal: failures are logged and the caller receives
 * a boolean result rather than a thrown error.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

const execAsync = promisify(exec);
const TAG = 'GitInstall';

// ── Git for Windows download URLs ────────────────────────────────────────────
const GIT_WIN_VERSION = '2.47.1';
const GIT_WIN_BASE = `https://github.com/git-for-windows/git/releases/download/v${GIT_WIN_VERSION}.windows.1`;
const GIT_WIN_URLS: Record<string, string> = {
  x64: `${GIT_WIN_BASE}/Git-${GIT_WIN_VERSION}-64-bit.exe`,
  arm64: `${GIT_WIN_BASE}/Git-${GIT_WIN_VERSION}-arm64.exe`,
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the `git --version` string if git is available, otherwise null.
 */
export async function getGitVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git --version', { timeout: 5_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Returns true if git is available in PATH.
 */
export async function isGitInstalled(): Promise<boolean> {
  return (await getGitVersion()) !== null;
}

/**
 * Ensure git is installed.  Downloads and installs it online if missing.
 *
 * @param onProgress  Optional callback for human-readable progress messages.
 * @returns           true if git is available (was already installed OR was just installed).
 */
export async function ensureGitInstalled(onProgress?: (msg: string) => void): Promise<boolean> {
  const existingVersion = await getGitVersion();
  if (existingVersion) {
    mainLog(TAG, `Git already installed: ${existingVersion}`);
    onProgress?.(`Git 已安装 (${existingVersion})`);
    return true;
  }

  mainLog(TAG, `Git not found on ${process.platform}/${process.arch} — attempting online install`);
  onProgress?.('Git 未安装，正在在线安装...');

  let success = false;
  try {
    switch (process.platform) {
      case 'win32':
        success = await _installGitWindows(onProgress);
        break;
      case 'darwin':
        success = await _installGitMacOS(onProgress);
        break;
      case 'linux':
        success = await _installGitLinux(onProgress);
        break;
      default:
        mainWarn(TAG, `Auto-install not supported on ${process.platform}`);
        onProgress?.(`不支持在 ${process.platform} 上自动安装 Git，请手动安装`);
    }
  } catch (err) {
    mainError(TAG, 'Git installation threw an unexpected error', err);
  }

  // Recheck even if installation "failed" (e.g. PATH update needed)
  const finalCheck = await isGitInstalled();

  if (finalCheck) {
    const ver = await getGitVersion();
    onProgress?.(`✓ Git 安装完成 (${ver ?? 'unknown'})`);
    mainLog(TAG, `Git installation succeeded: ${ver}`);
  } else if (success) {
    // Installer reported success but git not in PATH yet (may need shell restart)
    onProgress?.('Git 安装完成，重启应用后生效');
    mainLog(TAG, 'Git installed but not yet in PATH — relaunch may be required');
  } else {
    onProgress?.('⚠ Git 安装失败，请手动安装: https://git-scm.com');
    mainWarn(TAG, 'Git installation failed');
  }

  return finalCheck || success;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Download a file from a URL (follows redirects) to a local path.
 * Invokes `onProgress` with 0-100 percentage values.
 */
function _downloadFile(url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    const fetch = (urlStr: string) => {
      const req = https.get(urlStr, { timeout: 30_000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          if (loc) { file.close(); fs.unlink(dest, () => {}); fetch(loc); return; }
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`HTTP ${res.statusCode} downloading ${urlStr}`));
          return;
        }

        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let received = 0;

        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) onProgress?.(Math.round((received / total) * 100));
        });

        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
      });
      req.on('error', (err) => { file.close(); fs.unlink(dest, () => {}); reject(err); });
      req.on('timeout', () => { req.destroy(); reject(new Error('Download timed out')); });
    };

    fetch(url);
  });
}

async function _installGitWindows(onProgress?: (msg: string) => void): Promise<boolean> {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const url = GIT_WIN_URLS[arch] ?? GIT_WIN_URLS.x64;
  const installerPath = path.join(os.tmpdir(), `git-installer-${arch}.exe`);

  try {
    onProgress?.(`正在下载 Git for Windows (${arch})...`);
    mainLog(TAG, `Downloading Git ${GIT_WIN_VERSION} from ${url}`);

    await _downloadFile(url, installerPath, (pct) => {
      onProgress?.(`下载 Git... ${pct}%`);
    });

    onProgress?.('正在安装 Git for Windows（静默模式）...');
    mainLog(TAG, `Installing Git from ${installerPath}`);

    // /VERYSILENT /NORESTART — no UI, no reboot prompt
    await execAsync(
      `"${installerPath}" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /COMPONENTS="icons,ext\\reg\\shellhere,assoc,assoc_sh"`,
      { timeout: 300_000 },
    );

    mainLog(TAG, 'Git for Windows installer completed');
    return true;
  } catch (err) {
    mainError(TAG, 'Git for Windows installation failed', err);
    return false;
  } finally {
    try { if (fs.existsSync(installerPath)) fs.unlinkSync(installerPath); } catch {}
  }
}

async function _installGitMacOS(onProgress?: (msg: string) => void): Promise<boolean> {
  // Option 1: xcode-select --install (triggers a system dialog)
  try {
    onProgress?.('正在通过 Xcode Command Line Tools 安装 Git...');
    mainLog(TAG, 'Running: xcode-select --install');
    await execAsync('xcode-select --install 2>&1 || true', { timeout: 10_000 });
    // Short wait — if CLT was already queued, git might appear quickly
    await new Promise((r) => setTimeout(r, 3_000));
    if (await isGitInstalled()) return true;
  } catch {
    // Expected when dialog is shown or already installed
  }

  // Option 2: Homebrew fallback
  try {
    const { stdout } = await execAsync('which brew 2>/dev/null || true', { timeout: 5_000 });
    if (stdout.trim()) {
      onProgress?.('正在通过 Homebrew 安装 Git...');
      mainLog(TAG, 'Running: brew install git');
      await execAsync('brew install git', { timeout: 180_000 });
      return await isGitInstalled();
    }
  } catch {
    // Homebrew not available
  }

  return false;
}

async function _installGitLinux(onProgress?: (msg: string) => void): Promise<boolean> {
  const managers = [
    { bin: 'apt-get', cmd: 'apt-get install -y git' },
    { bin: 'dnf', cmd: 'dnf install -y git' },
    { bin: 'yum', cmd: 'yum install -y git' },
    { bin: 'pacman', cmd: 'pacman -S --noconfirm git' },
    { bin: 'zypper', cmd: 'zypper install -y git' },
  ];

  for (const { bin, cmd } of managers) {
    try {
      await execAsync(`which ${bin}`, { timeout: 5_000 });
      onProgress?.(`正在通过 ${bin} 安装 Git...`);
      mainLog(TAG, `Running: ${cmd}`);
      await execAsync(cmd, { timeout: 120_000 });
      if (await isGitInstalled()) return true;
    } catch {
      // Package manager not available — try next
    }
  }

  return false;
}
