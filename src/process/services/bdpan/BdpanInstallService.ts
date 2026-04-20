/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { downloadFile, fetchSha256 } from '../download/RemoteResourceDownloader';
import runtimeVersions from '@/shared/runtime-versions.json';

const BDPAN_VERSION = runtimeVersions.bdpan;
const BDPAN_CDN_BASE = `https://issuecdn.baidupcs.com/issue/netdisk/ai-bdpan/installer/${BDPAN_VERSION}`;

/** Returns the arch suffix used in the bundled installer filename (x64 or arm64) */
function getBundledArch(): string {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/** Returns the CDN arch name (amd64 or arm64) */
function getCdnArch(): string {
  return process.arch === 'arm64' ? 'arm64' : 'amd64';
}

/** Returns the bundled installer filename for the current platform */
function getInstallerName(): string | null {
  const arch = getBundledArch();
  if (process.platform === 'darwin') return `bdpan-installer-darwin-${arch}`;
  if (process.platform === 'linux') return `bdpan-installer-linux-${arch}`;
  if (process.platform === 'win32') return `bdpan-installer-windows-${arch}.exe`;
  return null;
}

/** Returns the CDN filename for the current platform */
function getCdnName(): string | null {
  const arch = getCdnArch();
  const ext = process.platform === 'win32' ? '.exe' : '';
  if (process.platform === 'darwin') return `bdpan-installer-darwin-${arch}${ext}`;
  if (process.platform === 'linux') return `bdpan-installer-linux-${arch}${ext}`;
  if (process.platform === 'win32') return `bdpan-installer-windows-${arch}${ext}`;
  return null;
}

/** Finds the bundled bdpan installer binary (packaged app or dev mode) */
function getBundledInstallerPath(): string | null {
  const name = getInstallerName();
  if (!name) return null;

  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, name);
    if (fs.existsSync(p)) return p;
  }

  const devPath = path.join(app.getAppPath(), 'resources', name);
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

/** Check if bdpan CLI is already installed on PATH */
export function isBdpanInstalled(): boolean {
  try {
    const result = spawnSync('bdpan', ['version'], { encoding: 'utf8', timeout: 5000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Install bdpan CLI — from bundled installer if available, otherwise download from CDN.
 * Runs the installer silently with --yes.
 * Non-fatal: logs errors but does not throw.
 */
export async function ensureBdpanInstalled(): Promise<boolean> {
  if (isBdpanInstalled()) {
    mainLog('Bdpan', 'Already installed');
    return true;
  }

  let installerPath = getBundledInstallerPath();

  if (!installerPath) {
    // Download from CDN
    const cdnName = getCdnName();
    if (!cdnName) {
      mainWarn('Bdpan', `Unsupported platform: ${process.platform}/${process.arch}`);
      return false;
    }

    mainLog('Bdpan', 'Bundled installer not found, downloading from CDN...');
    const tmpPath = path.join(os.tmpdir(), cdnName);
    const url = `${BDPAN_CDN_BASE}/${cdnName}`;

    // Try to get SHA256 checksum for verification
    const checksumUrl = `${BDPAN_CDN_BASE}/SHA256SUMS`;
    const expectedHash = await fetchSha256(checksumUrl, cdnName);

    const downloadOk = await downloadFile(url, tmpPath, {
      expectedSha256: expectedHash ?? undefined,
    });

    if (!downloadOk) {
      mainWarn('Bdpan', `Failed to download installer from ${url}`);
      return false;
    }

    installerPath = tmpPath;
    mainLog('Bdpan', `Downloaded installer to ${tmpPath}`);
  }

  mainLog('Bdpan', `Installing from ${installerPath}...`);

  try {
    fs.chmodSync(installerPath, 0o755);
  } catch (err) {
    mainWarn('Bdpan', `Could not set executable permission: ${err}`);
  }

  const result = spawnSync(installerPath, ['--yes'], {
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, HOME: os.homedir() },
  });

  // Clean up temp installer if downloaded from remote
  if (!getBundledInstallerPath()) {
    try { fs.unlinkSync(installerPath); } catch { /* ignore */ }
  }

  if (result.status !== 0) {
    mainError('Bdpan', `Installer exited with code ${result.status}: ${result.stderr || result.stdout}`);
    return false;
  }

  if (isBdpanInstalled()) {
    mainLog('Bdpan', 'Installed successfully');
    return true;
  }

  // bdpan installs to ~/.local/bin which may not be on PATH in the Electron process
  mainWarn('Bdpan', 'Installer succeeded but bdpan not found on PATH (may need ~/.local/bin added)');
  return true;
}
