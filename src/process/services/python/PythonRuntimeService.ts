/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Python Runtime Service
 *
 * Detects, installs, and uninstalls Python to the system environment.
 * Installation follows the same pattern as LibreOffice: download the official
 * installer and run it with appropriate privileges on each platform.
 *
 * - macOS: downloads the official python.org .pkg installer and runs it via
 *   `installer -pkg` with administrator privileges.
 * - Windows: downloads the official python.org .exe installer and runs it
 *   silently with `InstallAllUsers=1` (system-wide).
 * - Linux: installs via the system package manager (apt / dnf / pacman).
 */

import { execFile, exec } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import { app } from 'electron';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Update this version constant when a new Python stable release is available.
// Download page: https://www.python.org/downloads/
const PYTHON_VERSION = '3.13.4';

interface PythonStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

export type InstallPhase = 'downloading' | 'installing' | 'configuring' | 'cleanup';

export type ProgressCallback = (phase: InstallPhase, percent?: number) => void;

export class PythonRuntimeService {
  async checkInstalled(): Promise<PythonStatus> {
    if (process.platform === 'darwin') {
      return this.checkInstalledMac();
    } else if (process.platform === 'win32') {
      return this.checkInstalledWindows();
    } else {
      return this.checkInstalledLinux();
    }
  }

  private async checkInstalledMac(): Promise<PythonStatus> {
    // Check for Homebrew python3, official python.org install, or system python3
    const candidates = ['/usr/local/bin/python3', '/opt/homebrew/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3'];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const { stdout } = await execAsync(`"${candidate}" --version`);
          const match = stdout.trim().match(/Python\s+(\S+)/);
          return { installed: true, version: match?.[1], path: candidate };
        } catch {
          return { installed: true, path: candidate };
        }
      }
    }
    // Fallback: check PATH
    try {
      const { stdout } = await execAsync('which python3 2>/dev/null');
      const pythonPath = stdout.trim();
      if (pythonPath) {
        const { stdout: verOut } = await execAsync(`"${pythonPath}" --version`);
        const match = verOut.trim().match(/Python\s+(\S+)/);
        return { installed: true, version: match?.[1], path: pythonPath };
      }
    } catch {
      /* not found */
    }
    return { installed: false };
  }

  private async checkInstalledWindows(): Promise<PythonStatus> {
    // Check common install locations
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const localAppData = process.env['LOCALAPPDATA'] ?? '';

    // Check system-wide install
    try {
      const entries = fs.readdirSync(programFiles).filter((d) => d.toLowerCase().startsWith('python'));
      for (const entry of entries) {
        const pythonExe = path.join(programFiles, entry, 'python.exe');
        if (fs.existsSync(pythonExe)) {
          try {
            const { stdout } = await execAsync(`"${pythonExe}" --version`);
            const match = stdout.trim().match(/Python\s+(\S+)/);
            return { installed: true, version: match?.[1], path: pythonExe };
          } catch {
            return { installed: true, path: pythonExe };
          }
        }
      }
    } catch {
      /* ignore */
    }

    // Check user-level install
    if (localAppData) {
      try {
        const pyDir = path.join(localAppData, 'Programs', 'Python');
        if (fs.existsSync(pyDir)) {
          const entries = fs.readdirSync(pyDir).filter((d) => d.toLowerCase().startsWith('python'));
          for (const entry of entries) {
            const pythonExe = path.join(pyDir, entry, 'python.exe');
            if (fs.existsSync(pythonExe)) {
              try {
                const { stdout } = await execAsync(`"${pythonExe}" --version`);
                const match = stdout.trim().match(/Python\s+(\S+)/);
                return { installed: true, version: match?.[1], path: pythonExe };
              } catch {
                return { installed: true, path: pythonExe };
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Fallback: check PATH
    try {
      const { stdout } = await execAsync('where python 2>nul');
      const pythonPath = stdout.trim().split(/\r?\n/)[0];
      if (pythonPath && fs.existsSync(pythonPath)) {
        const { stdout: verOut } = await execAsync(`"${pythonPath}" --version`);
        const match = verOut.trim().match(/Python\s+(\S+)/);
        return { installed: true, version: match?.[1], path: pythonPath };
      }
    } catch {
      /* not found */
    }
    return { installed: false };
  }

  private async checkInstalledLinux(): Promise<PythonStatus> {
    try {
      const { stdout } = await execAsync('which python3 2>/dev/null || which python 2>/dev/null');
      const pythonPath = stdout.trim().split(/\n/)[0];
      if (pythonPath) {
        try {
          const { stdout: verOut } = await execAsync(`"${pythonPath}" --version`);
          const match = verOut.trim().match(/Python\s+(\S+)/);
          return { installed: true, version: match?.[1], path: pythonPath };
        } catch {
          return { installed: true, path: pythonPath };
        }
      }
    } catch {
      /* not found */
    }
    return { installed: false };
  }

  getDownloadUrl(): string {
    const v = PYTHON_VERSION;
    if (process.platform === 'darwin') {
      // Universal installer for macOS (works on both Intel and Apple Silicon)
      return `https://www.python.org/ftp/python/${v}/python-${v}-macos11.pkg`;
    } else if (process.platform === 'win32') {
      // Windows installer
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
      return `https://www.python.org/ftp/python/${v}/python-${v}-${arch}.exe`;
    } else {
      // Linux: use package manager, no direct download
      return '';
    }
  }

  private getCacheDir(): string {
    const cacheDir = path.join(app.getPath('userData'), 'python-cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    return cacheDir;
  }

  private getCachedFilePath(): string {
    const cacheDir = this.getCacheDir();
    let ext: string;
    if (process.platform === 'darwin') {
      ext = 'pkg';
    } else if (process.platform === 'win32') {
      ext = 'exe';
    } else {
      ext = 'tar.gz';
    }
    return path.join(cacheDir, `python-${PYTHON_VERSION}.${ext}`);
  }

  async install(onProgress: ProgressCallback): Promise<void> {
    if (process.platform === 'darwin') {
      return this.installMac(onProgress);
    } else if (process.platform === 'win32') {
      return this.installWindows(onProgress);
    } else {
      return this.installLinux(onProgress);
    }
  }

  private async installMac(onProgress: ProgressCallback): Promise<void> {
    const pkgPath = this.getCachedFilePath();

    try {
      // Download if not cached
      if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).size > 0) {
        onProgress('downloading', 100);
      } else {
        await this.downloadFile(this.getDownloadUrl(), pkgPath, (percent) => {
          onProgress('downloading', percent);
        });
      }

      onProgress('installing');
      // Use osascript to run the installer with admin privileges
      const script = `do shell script "installer -pkg '${pkgPath.replace(/'/g, "'\\''")}' -target /" with administrator privileges`;
      await execFileAsync('osascript', ['-e', script]);

      onProgress('configuring');
    } catch (err) {
      try {
        if (fs.existsSync(pkgPath)) fs.rmSync(pkgPath);
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      onProgress('cleanup');
    }
  }

  private async installWindows(onProgress: ProgressCallback): Promise<void> {
    const exePath = this.getCachedFilePath();

    try {
      // Download if not cached
      if (fs.existsSync(exePath) && fs.statSync(exePath).size > 0) {
        onProgress('downloading', 100);
      } else {
        await this.downloadFile(this.getDownloadUrl(), exePath, (percent) => {
          onProgress('downloading', percent);
        });
      }

      onProgress('installing');
      // Run the official Python installer silently with system-wide install
      // InstallAllUsers=1 installs for all users (system-wide)
      // PrependPath=1 adds Python to PATH
      // Include_pip=1 includes pip
      await execFileAsync(exePath, ['/passive', 'InstallAllUsers=1', 'PrependPath=1', 'Include_pip=1', 'Include_launcher=1']);
    } catch (err) {
      try {
        if (fs.existsSync(exePath)) fs.rmSync(exePath);
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      onProgress('cleanup');
    }
  }

  private async installLinux(onProgress: ProgressCallback): Promise<void> {
    onProgress('installing');
    try {
      // Try apt (Debian/Ubuntu)
      try {
        await execAsync('which apt-get');
        await execFileAsync('pkexec', ['bash', '-c', 'apt-get update && apt-get install -y python3 python3-pip python3-venv']);
        return;
      } catch {
        /* not apt-based */
      }

      // Try dnf (Fedora/RHEL)
      try {
        await execAsync('which dnf');
        await execFileAsync('pkexec', ['dnf', 'install', '-y', 'python3', 'python3-pip']);
        return;
      } catch {
        /* not dnf-based */
      }

      // Try pacman (Arch)
      try {
        await execAsync('which pacman');
        await execFileAsync('pkexec', ['pacman', '-S', '--noconfirm', 'python', 'python-pip']);
        return;
      } catch {
        /* not pacman-based */
      }

      throw new Error('Unsupported Linux distribution. Please install Python manually using your system package manager.');
    } finally {
      onProgress('cleanup');
    }
  }

  async uninstall(): Promise<void> {
    if (process.platform === 'darwin') {
      // Remove the official python.org framework install
      const script = `do shell script "rm -rf /Library/Frameworks/Python.framework" with administrator privileges`;
      try {
        await execFileAsync('osascript', ['-e', script]);
      } catch {
        /* ignore – may not be a framework install */
      }
    } else if (process.platform === 'win32') {
      // Run the cached installer in uninstall mode
      const exePath = this.getCachedFilePath();
      if (fs.existsSync(exePath)) {
        try {
          await execFileAsync(exePath, ['/uninstall', '/passive']);
        } catch {
          /* ignore */
        }
      }
      // Also try via Programs and Features registry
      try {
        await execAsync('wmic product where "name like \'Python%\'" call uninstall /nointeractive');
      } catch {
        /* ignore */
      }
    } else {
      // Linux: remove via package manager
      try {
        await execAsync('which apt-get');
        await execFileAsync('pkexec', ['apt-get', 'remove', '-y', 'python3']);
        return;
      } catch {
        /* not apt */
      }
      try {
        await execAsync('which dnf');
        await execFileAsync('pkexec', ['dnf', 'remove', '-y', 'python3']);
        return;
      } catch {
        /* not dnf */
      }
      try {
        await execAsync('which pacman');
        await execFileAsync('pkexec', ['pacman', '-R', '--noconfirm', 'python']);
        return;
      } catch {
        /* not pacman */
      }
    }
    // Clean download cache
    const cacheDir = this.getCacheDir();
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  private downloadFile(url: string, dest: string, onPercent: (n: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const doRequest = (reqUrl: string, redirectCount = 0) => {
        if (redirectCount > 10) return reject(new Error('Too many redirects'));
        const mod = reqUrl.startsWith('https') ? https : http;
        mod
          .get(reqUrl, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return doRequest(res.headers.location, redirectCount + 1);
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
            }
            const total = parseInt(res.headers['content-length'] ?? '0', 10);
            let received = 0;
            const file = fs.createWriteStream(dest);
            res.on('data', (chunk: Buffer) => {
              received += chunk.length;
              if (total > 0) onPercent(Math.round((received / total) * 100));
            });
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
            file.on('error', (e) => {
              fs.rmSync(dest, { force: true });
              reject(e);
            });
            res.on('error', reject);
          })
          .on('error', reject);
      };
      doRequest(url);
    });
  }
}

export const pythonRuntimeService = new PythonRuntimeService();
