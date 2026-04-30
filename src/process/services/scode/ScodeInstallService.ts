/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scode Install Service
 *
 * Installs the bundled/downloaded scode CLI into its dedicated runtime root at
 * ~/.nexus/sudocode so startup can verify the default ACP runtime without
 * depending on the legacy Sudoclaw/OpenClaw gateway bootstrap path.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import runtimeVersions from '@/shared/runtime-versions.json';
import { extractTarGzWithProgress, extractZipWithProgress, listTarGzEntries, listZipEntries } from '../archiveProgress';

const TAG = 'ScodeInstallService';

/** OS name mapping: Node.js process.platform → scode archive OS name */
const SCODE_OS_NAME_MAP: Record<string, string> = { darwin: 'macos', win32: 'windows' };
/** Architecture mapping: Node.js process.arch → scode archive arch name */
const SCODE_ARCH_NAME_MAP: Record<string, string> = { arm64: 'arm64', x64: 'x64' };

/** Scode root: ~/.nexus/sudocode */
export const SCODE_DIR = path.join(os.homedir(), '.nexus', 'sudocode');

/** Marker filename to record installed version */
const SCODE_READY_MARKER = '.scode-bin-ready';

/** GitHub release base URL for scode downloads */
const SCODE_GITHUB_RELEASE_BASE_URL = 'https://github.com/sudoprivacy/sudocode/releases/download';

/** Get the scode executable name for the current platform */
function getScodeExeName(): string {
  return process.platform === 'win32' ? 'scode.exe' : 'scode';
}

/** Get the archive file extension */
function getArchiveExtension(): string {
  return process.platform === 'win32' ? '.zip' : '.tar.gz';
}

/** Get the platform-specific archive name */
function getPlatformArchiveName(): string {
  const osName = SCODE_OS_NAME_MAP[process.platform];
  const archName = SCODE_ARCH_NAME_MAP[process.arch];
  if (!osName || !archName) throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
  return `scode-${osName}-${archName}${getArchiveExtension()}`;
}

/** Get the versioned archive filename */
function getVersionedArchiveName(): string {
  const version = getScodeVersion();
  return `v${version}-${getPlatformArchiveName()}`;
}

/** Get the scode version from runtime-versions.json */
function getScodeVersion(): string {
  const value = runtimeVersions.scode;
  return typeof value === 'string' && value.trim() ? value.trim() : '0.1.1';
}

/** Get the installed scode binary path */
function getInstalledScodePath(): string {
  return path.join(SCODE_DIR, getScodeExeName());
}

/** Get the ready marker path */
function getReadyMarkerPath(): string {
  return path.join(SCODE_DIR, SCODE_READY_MARKER);
}

/** Check if marker file content matches current version */
function isMarkerCurrent(): boolean {
  const markerPath = getReadyMarkerPath();
  if (!fs.existsSync(markerPath)) return false;
  try {
    const content = fs.readFileSync(markerPath, 'utf-8').trim();
    return content === getScodeVersion();
  } catch {
    return false;
  }
}

/** Get the installed scode version from marker */
function getInstalledScodeVersion(): string | undefined {
  const markerPath = getReadyMarkerPath();
  if (!fs.existsSync(markerPath)) return undefined;
  try {
    const content = fs.readFileSync(markerPath, 'utf-8').trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}

/** Get version state for upgrade detection */
export function getScodeVersionState(): { installedVersion?: string; bundledVersion?: string; needsUpgrade: boolean } {
  const installedVersion = getInstalledScodeVersion();
  const bundledVersion = getScodeVersion();

  if (!installedVersion) {
    // Not installed - needs upgrade (install)
    return { installedVersion, bundledVersion, needsUpgrade: true };
  }

  if (!bundledVersion) {
    return { installedVersion, bundledVersion, needsUpgrade: false };
  }

  return {
    installedVersion,
    bundledVersion,
    needsUpgrade: installedVersion !== bundledVersion,
  };
}

/** Check if scode is installed and version matches */
export function isScodeInstalled(): boolean {
  const scodePath = getInstalledScodePath();
  return fs.existsSync(scodePath) && isMarkerCurrent();
}

/** Get the bundled scode resource path */
function getBundledScodePath(): string | null {
  const versionedName = getVersionedArchiveName();

  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, versionedName);
    if (fs.existsSync(packagedPath)) {
      const stats = fs.statSync(packagedPath);
      if (stats.size >= 1024 * 100) {
        return packagedPath;
      }
    }
  }

  const devPath = path.join(app.getAppPath(), 'resources', versionedName);
  if (fs.existsSync(devPath)) {
    const stats = fs.statSync(devPath);
    if (stats.size >= 1024 * 100) {
      return devPath;
    }
  }

  return null;
}

/** Analyze archive structure to determine strip level */
async function analyzeArchiveStructure(archivePath: string): Promise<{ strip: number; topLevelNames: Set<string> }> {
  const entries = archivePath.endsWith('.zip') ? await listZipEntries(archivePath) : await listTarGzEntries(archivePath);
  const scodeName = getScodeExeName();

  const topLevelDirs = new Set<string>();
  for (const entry of entries) {
    const first = entry.split('/')[0];
    if (first) topLevelDirs.add(first);
  }

  if (topLevelDirs.size === 1) {
    const prefix = [...topLevelDirs][0];
    const names = new Set<string>();
    for (const entry of entries) {
      const rest = entry.slice(prefix.length + 1);
      if (rest) {
        const firstPart = rest.split('/')[0];
        if (firstPart) names.add(firstPart);
      }
    }

    if (names.has(scodeName)) {
      return { strip: 1, topLevelNames: names };
    }
  }

  const names = new Set<string>();
  for (const entry of entries) {
    const first = entry.split('/')[0];
    if (first) names.add(first);
  }
  return { strip: 0, topLevelNames: names };
}

/** Set executable permissions on scode binary (Unix only) */
function setInstalledPermissions(dir: string): void {
  if (process.platform === 'win32') return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      setInstalledPermissions(fullPath);
    } else if (entry.name === getScodeExeName() || entry.name.endsWith('.so') || entry.name.includes('.so.') || entry.name.endsWith('.dylib')) {
      fs.chmodSync(fullPath, 0o755);
    }
  }
}

/** Extract scode archive to target directory */
async function extractArchive(archivePath: string, targetDir: string, strip: number, onProgress?: (percent: number) => void): Promise<void> {
  if (archivePath.endsWith('.zip')) {
    await extractZipWithProgress(archivePath, targetDir, onProgress, { strip });
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    await extractTarGzWithProgress(archivePath, targetDir, onProgress, { strip });
  } else {
    throw new Error(`Unsupported archive format: ${archivePath}`);
  }
}

/** Download scode from GitHub release */
async function downloadScode(url: string, destPath: string, onProgress?: (percent: number) => void): Promise<void> {
  const https = await import('https');
  const http = await import('http');

  return new Promise<void>((resolve, reject) => {
    let redirects = 0;
    const maxRedirects = 10;

    const doRequest = (requestUrl: string): void => {
      if (redirects > maxRedirects) {
        reject(new Error('Too many redirects'));
        return;
      }

      const mod = requestUrl.startsWith('https') ? https : http;
      const req = mod.get(requestUrl, (response: import('http').IncomingMessage) => {
        if ([301, 302, 307, 308].includes(response.statusCode!) && response.headers.location) {
          redirects++;
          mainLog(TAG, `Download redirect → ${response.headers.location}`);
          doRequest(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const file = fs.createWriteStream(destPath);

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (totalSize > 0) {
            const percent = Math.round((downloaded / totalSize) * 100);
            mainLog(TAG, `Downloading scode... ${percent}%`);
            onProgress?.(percent);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          onProgress?.(100);
          resolve();
        });

        file.on('error', (err: Error) => {
          try {
            fs.unlinkSync(destPath);
          } catch {
            /* ignore */
          }
          reject(err);
        });
      });

      req.on('error', (err: Error) => {
        try {
          fs.unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        reject(err);
      });
    };

    doRequest(url);
  });
}

/** Get GitHub download URL for scode */
function getGitHubDownloadUrl(): string {
  const version = getScodeVersion();
  return `${SCODE_GITHUB_RELEASE_BASE_URL}/v${version}/${getPlatformArchiveName()}`;
}

/**
 * Install scode from bundled resources or download from GitHub.
 * Silent installation - no UI, just background install.
 */
export async function ensureScodeInstalled(options?: { forceReinstall?: boolean; onProgress?: (percent: number) => void }): Promise<boolean> {
  const forceReinstall = options?.forceReinstall === true;

  if (!forceReinstall && isScodeInstalled()) {
    mainLog(TAG, `Scode ${getScodeVersion()} already installed, skipping`);
    options?.onProgress?.(100);
    return true;
  }

  const binDir = SCODE_DIR;
  let archivePath: string | null = null;
  const downloadDir = path.join(os.tmpdir(), 'scode-download');
  const downloadDest = path.join(downloadDir, getVersionedArchiveName());

  // Try bundled resource first
  const bundledPath = getBundledScodePath();
  if (bundledPath) {
    archivePath = bundledPath;
    mainLog(TAG, `Using bundled scode archive from ${bundledPath}`);
    options?.onProgress?.(5);
  } else {
    // Download from GitHub
    mainLog(TAG, 'Bundled scode not found, attempting download from GitHub...');
    fs.mkdirSync(downloadDir, { recursive: true });

    const downloadAttempts = [{ label: 'GitHub', url: getGitHubDownloadUrl() }];

    let lastError: string | null = null;
    for (const attempt of downloadAttempts) {
      try {
        mainLog(TAG, `Downloading scode from ${attempt.label}: ${attempt.url}`);
        await downloadScode(attempt.url, downloadDest, (percent) => {
          const mapped = Math.max(5, Math.min(45, Math.round((percent / 100) * 45)));
          options?.onProgress?.(mapped);
        });
        archivePath = downloadDest;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        mainWarn(TAG, `${attempt.label} download failed: ${lastError}`);
      }
    }

    if (!archivePath) {
      mainError(TAG, `Failed to download scode: ${lastError ?? 'unknown error'}`);
      return false;
    }
  }

  try {
    mainLog(TAG, `Installing scode from ${archivePath}...`);

    // Analyze archive structure
    const { strip, topLevelNames } = await analyzeArchiveStructure(archivePath);
    mainLog(TAG, `Archive analysis: strip=${strip}, entries=[${[...topLevelNames].join(', ')}]`);

    // Ensure bin directory exists
    fs.mkdirSync(binDir, { recursive: true });

    // Clean old files
    const toRemove = new Set(topLevelNames);
    toRemove.add(SCODE_READY_MARKER);
    toRemove.add(getScodeExeName());

    for (const name of toRemove) {
      const target = path.join(binDir, name);
      if (fs.existsSync(target)) {
        try {
          fs.rmSync(target, { recursive: true, force: true });
        } catch (err) {
          mainWarn(TAG, `Failed to remove ${target}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Extract archive
    const extractBaseProgress = bundledPath ? 5 : 45;
    await extractArchive(archivePath, binDir, strip, (percent) => {
      const mapped = extractBaseProgress + Math.round((percent / 100) * (100 - extractBaseProgress));
      options?.onProgress?.(Math.max(extractBaseProgress, Math.min(100, mapped)));
    });

    // Set permissions
    setInstalledPermissions(binDir);

    // Write version marker
    const markerFile = getReadyMarkerPath();
    fs.writeFileSync(markerFile, getScodeVersion());
    options?.onProgress?.(100);

    mainLog(TAG, `Scode installation completed: ${binDir}`);

    // Clean up downloaded archive
    if (archivePath === downloadDest && fs.existsSync(downloadDest)) {
      try {
        fs.unlinkSync(downloadDest);
      } catch {
        /* ignore */
      }
    }

    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    mainError(TAG, `Scode installation failed: ${errorMsg}`);
    return false;
  }
}

/** Get scode binary path if installed */
export function getScodePath(): string | null {
  const scodePath = getInstalledScodePath();
  return isScodeInstalled() && fs.existsSync(scodePath) ? scodePath : null;
}

/** Remove the managed scode runtime directory. */
export function removeScodeInstallation(): void {
  if (!fs.existsSync(SCODE_DIR)) {
    return;
  }

  fs.rmSync(SCODE_DIR, { recursive: true, force: true });
}
