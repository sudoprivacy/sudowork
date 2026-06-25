/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { autoUpdaterService } from '../services/autoUpdaterService';
import { uuid } from '@/common/utils';
import type { UpdateCheckResult, UpdateDownloadProgressEvent, UpdateDownloadRequest, UpdateDownloadResult, UpdateReleaseInfo, GitHubReleaseAsset } from '@/common/updateTypes';
import { ipcBridge } from '@/common';
import { isNightlyBuild, buildDate, buildCommit, isNightlyTag, parseNightlyDate, parseNightlyCommit, compareNightlyTags } from '@/common/buildInfo';
import { getCosReleaseBase } from '@/common/systemConfig';

type GitHubReleaseApiAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  content_type?: string;
};

type GitHubReleaseApi = {
  tag_name: string;
  name?: string;
  body?: string;
  html_url: string;
  published_at?: string;
  prerelease: boolean;
  draft: boolean;
  assets?: GitHubReleaseApiAsset[];
};

/** Parameters for auto-update check via electron-updater */
interface AutoUpdateCheckParams {
  /** Whether to include prerelease/dev builds in update check */
  includePrerelease?: boolean;
}

const DEFAULT_REPO = 'sudoprivacy/sudowork';
const DEFAULT_USER_AGENT = 'Sudowork';
const ALLOWED_ASSET_EXTS = ['.exe', '.msi', '.dmg', '.zip', '.AppImage', '.deb', '.rpm'];
const ALLOWED_DOWNLOAD_HOSTS = new Set<string>([
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
  // COS release mirror for Chinese users (role-based bucket; primary)
  'sudowork-release-1309794936.cos.ap-beijing.myqcloud.com',
  'sudowork-release-1309794936.cos.accelerate.myqcloud.com',
  // Legacy COS mirror (kept live as fallback during deprecation)
  'sudowork-download-1309794936.cos.ap-beijing.myqcloud.com',
  'sudowork-download-1309794936.cos.accelerate.myqcloud.com',
]);
const MAX_REDIRECTS = 8;

/** COS mirror base URL (release bucket; server-driven cos_domain). */
const getCosMirrorBase = (): string => `${getCosReleaseBase()}/sudowork/release/latest`;

/** Whether a download host is allowlisted: the static set, or the server-dispatched cos release host (§4.4). */
const isAllowedDownloadHost = (hostname: string): boolean => {
  if (ALLOWED_DOWNLOAD_HOSTS.has(hostname)) return true;
  try {
    return new URL(getCosReleaseBase()).host === hostname;
  } catch {
    return false;
  }
};

/** COS yml file structure */
interface COSYmlInfo {
  version: string;
  releaseDate?: string;
  path?: string;
  files?: Array<{ url: string; size?: number }>;
}

/**
 * Parse COS yml file to extract version info.
 * yml format:
 *   version: 0.1.4
 *   releaseDate: '2026-03-29T11:39:22.037Z'
 *   path: Sudowork-latest-win-x64.exe
 */
const parseCOSYml = async (ymlUrl: string): Promise<COSYmlInfo | null> => {
  try {
    const res = await fetch(ymlUrl, { method: 'GET' });
    if (!res.ok) return null;

    const text = await res.text();
    const versionMatch = text.match(/^version:\s*['"]?([\d.]+)['"]?/m);
    const releaseDateMatch = text.match(/^releaseDate:\s*['"]([^'"]+)['"]/m);
    const pathMatch = text.match(/^path:\s*(.+)$/m);

    if (!versionMatch) return null;

    return {
      version: versionMatch[1],
      releaseDate: releaseDateMatch?.[1],
      path: pathMatch?.[1]?.trim(),
    };
  } catch {
    return null;
  }
};

/**
 * Get yml filename for current platform.
 */
const getCOSYmlFileName = (): string => {
  const { platform, arch } = process;
  if (platform === 'win32') {
    return arch === 'arm64' ? 'win-arm64.yml' : 'latest.yml';
  } else if (platform === 'darwin') {
    return arch === 'arm64' ? 'arm64-mac.yml' : 'latest-mac.yml';
  } else {
    return arch === 'arm64' ? 'arm64-linux.yml' : 'latest-linux.yml';
  }
};

/**
 * Build UpdateReleaseInfo from COS yml data.
 */
const buildReleaseInfoFromCOS = (ymlInfo: COSYmlInfo): UpdateReleaseInfo => {
  const platform = process.platform;
  const arch = process.arch;

  // Determine file extension based on platform
  // macOS: always use .dmg (not .zip which may not exist on COS)
  // Windows: .exe
  // Linux: .AppImage
  const ext = platform === 'win32' ? '.exe' : platform === 'darwin' ? '.dmg' : '.AppImage';
  const platformName = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux';
  const archName = arch === 'arm64' ? 'arm64' : 'x64';

  // For macOS, ignore yml path (which may point to .zip) and use .dmg directly
  const fileName = `Sudowork-latest-${platformName}-${archName}${ext}`;

  return {
    tagName: `v${ymlInfo.version}`,
    version: ymlInfo.version,
    htmlUrl: `https://github.com/sudoprivacy/sudowork/releases/tag/v${ymlInfo.version}`,
    publishedAt: ymlInfo.releaseDate,
    prerelease: false,
    draft: false,
    assets: [
      {
        name: fileName,
        url: `${getCosMirrorBase()}/${fileName}`,
        size: ymlInfo.files?.[0]?.size || 0,
      },
    ],
    recommendedAsset: {
      name: fileName,
      url: `${getCosMirrorBase()}/${fileName}`,
      size: ymlInfo.files?.[0]?.size || 0,
    },
  };
};

/**
 * Check for updates from COS mirror (fallback when GitHub unreachable).
 */
const checkUpdateFromCOS = async (): Promise<UpdateReleaseInfo | null> => {
  const ymlFileName = getCOSYmlFileName();
  const ymlUrl = `${getCosMirrorBase()}/${ymlFileName}`;

  mainLog('Update', `Checking update from COS mirror: ${ymlUrl}`);

  const ymlInfo = await parseCOSYml(ymlUrl);
  if (!ymlInfo) {
    mainLog('Update', 'Failed to parse COS yml');
    return null;
  }

  mainLog('Update', `COS version: ${ymlInfo.version}`);
  return buildReleaseInfoFromCOS(ymlInfo);
};

const isAllowedAssetName = (name: string) => {
  const ext = path.extname(name);
  return ALLOWED_ASSET_EXTS.includes(ext);
};

const normalizeTagToSemver = (tag: string): string | null => {
  const trimmed = tag.trim();
  const withoutV = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  // Ensure it looks like a semver prefix at least.
  if (!/^\d+\.\d+\.\d+/.test(withoutV)) return null;
  return semver.valid(withoutV);
};

const mapAsset = (asset: GitHubReleaseApiAsset): GitHubReleaseAsset => ({
  name: asset.name,
  url: asset.browser_download_url,
  size: asset.size,
  contentType: asset.content_type,
});

type RuntimePlatformInfo = {
  platform: NodeJS.Platform;
  arch: string;
};

type CanonicalArch = 'x64' | 'arm64' | 'ia32';

const normalizeArch = (arch: string): CanonicalArch => {
  if (arch === 'arm64') return 'arm64';
  if (arch === 'ia32' || arch === 'x32') return 'ia32';
  return 'x64';
};

const detectAssetArchs = (nameLower: string): Set<CanonicalArch> => {
  const detected = new Set<CanonicalArch>();

  if (/\b(arm64|aarch64)\b/.test(nameLower)) detected.add('arm64');
  if (/\b(x64|x86_64|amd64)\b/.test(nameLower)) detected.add('x64');

  const hasX86Token = /\bx86\b/.test(nameLower) && !/\bx86[_-]?64\b/.test(nameLower);
  if (/\b(ia32|x32|32bit)\b/.test(nameLower) || hasX86Token) detected.add('ia32');

  return detected;
};

const getPlatformHints = (runtime: RuntimePlatformInfo = { platform: process.platform, arch: process.arch }) => {
  const platform = runtime.platform;
  const arch = runtime.arch;
  const normalizedArch = normalizeArch(arch);

  const archHints = normalizedArch === 'arm64' ? ['arm64', 'aarch64'] : normalizedArch === 'ia32' ? ['ia32', 'x86', 'x32', '32bit'] : ['x64', 'x86_64', 'amd64'];

  // electron-builder artifact names often include one of these
  const platformHints = platform === 'win32' ? ['win', 'win32', 'windows'] : platform === 'darwin' ? ['mac', 'darwin', 'osx'] : ['linux'];

  return { platform, arch, normalizedArch, archHints, platformHints };
};

const scoreAsset = (asset: GitHubReleaseAsset, runtime?: RuntimePlatformInfo): number => {
  const { platform, normalizedArch, archHints, platformHints } = getPlatformHints(runtime);
  const nameLower = asset.name.toLowerCase();
  const ext = path.extname(asset.name);

  const detectedArchs = detectAssetArchs(nameLower);
  if (detectedArchs.size > 0 && !detectedArchs.has(normalizedArch)) {
    return -1;
  }

  let score = 0;

  // Platform match
  if (platformHints.some((hint) => nameLower.includes(hint))) score += 20;

  // Arch match
  if (archHints.some((hint) => nameLower.includes(hint))) score += 10;
  if (detectedArchs.has(normalizedArch)) score += 15;

  // Prefer installer formats per platform
  if (platform === 'win32') {
    if (ext === '.exe') score += 100;
    if (ext === '.msi') score += 90;
    if (ext === '.zip') score += 50;
  } else if (platform === 'darwin') {
    if (ext === '.dmg') score += 100;
    if (ext === '.zip') score += 70;
  } else {
    if (ext === '.AppImage') score += 100;
    if (ext === '.deb') score += 90;
    if (ext === '.rpm') score += 80;
    if (ext === '.zip') score += 40;
  }

  return score;
};

export const pickRecommendedAsset = (assets: GitHubReleaseAsset[], runtime?: RuntimePlatformInfo): GitHubReleaseAsset | undefined => {
  if (!assets.length) return undefined;

  const scored = assets
    .map((asset) => ({ asset, score: scoreAsset(asset, runtime) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.asset;
};

const resolveRepo = (requestRepo?: string): string => {
  const envRepo = process.env.NEXUS_GITHUB_REPO?.trim();
  const repo = (requestRepo || envRepo || DEFAULT_REPO).trim();
  return repo || DEFAULT_REPO;
};

/**
 * Convert versioned filename to COS latest format.
 * Sudowork-1.2.0-darwin-arm64.dmg -> Sudowork-latest-mac-arm64.dmg
 * Sudowork-1.2.0-win32-x64.exe -> Sudowork-latest-win-x64.exe
 */
const convertToCOSName = (originalName: string): string => {
  return originalName
    .replace(/\d+\.\d+\.\d+/, 'latest')
    .replace('darwin', 'mac')
    .replace('win32', 'win');
};

/**
 * Detect if GitHub is accessible with timeout.
 */
const detectGitHubAccessible = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    await fetch('https://api.github.com/rate_limit', {
      signal: controller.signal,
      method: 'HEAD',
    });

    clearTimeout(timeoutId);
    return true;
  } catch {
    return false;
  }
};

/**
 * Select best download source based on network accessibility.
 * Returns COS mirror URL if GitHub is unreachable.
 */
const selectDownloadSource = async (originalUrl: string, originalName: string): Promise<string> => {
  const canAccessGitHub = await detectGitHubAccessible();

  if (canAccessGitHub) {
    return originalUrl; // Use original GitHub URL
  }

  // Use COS mirror
  const cosUrl = `${getCosMirrorBase()}/${convertToCOSName(originalName)}`;
  mainLog('Update', `GitHub unreachable, using COS mirror: ${cosUrl}`);
  return cosUrl;
};

const assertAllowedUrl = (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid download URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only https download URLs are allowed');
  }
  if (!isAllowedDownloadHost(parsed.hostname)) {
    throw new Error(`Download host not allowed: ${parsed.hostname}`);
  }
};

const fetchWithAllowlistedRedirects = async (rawUrl: string, signal: AbortSignal): Promise<Response> => {
  let current = rawUrl;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    assertAllowedUrl(current);

    const res = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`Redirect (${res.status}) missing location header`);
      }
      current = new URL(location, current).toString();
      continue;
    }

    return res;
  }

  throw new Error('Too many redirects while downloading');
};

const fetchGitHubReleases = async (repo: string): Promise<GitHubReleaseApi[]> => {
  const url = `https://api.github.com/repos/${repo}/releases`;

  // 添加超时控制，防止网络问题导致无限等待 / Add timeout to prevent infinite wait on network issues
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 秒超时 / 30 second timeout

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': DEFAULT_USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub releases request failed (${res.status}): ${body || res.statusText}`);
    }

    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) {
      throw new Error('GitHub releases response is not an array');
    }
    return json as GitHubReleaseApi[];
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('GitHub API request timed out (30s)');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

const mapRelease = (rel: GitHubReleaseApi): UpdateReleaseInfo | null => {
  const version = normalizeTagToSemver(rel.tag_name);
  if (!version) return null;

  const assets = (rel.assets || [])
    .filter((asset) => asset && asset.name && asset.browser_download_url)
    .filter((asset) => isAllowedAssetName(asset.name))
    .map(mapAsset);

  return {
    tagName: rel.tag_name,
    version,
    name: rel.name,
    body: rel.body,
    htmlUrl: rel.html_url,
    publishedAt: rel.published_at,
    prerelease: Boolean(rel.prerelease),
    draft: Boolean(rel.draft),
    assets,
    recommendedAsset: pickRecommendedAsset(assets),
  };
};

/**
 * Map a nightly GitHub release to UpdateReleaseInfo.
 * Nightly releases use tag-based date comparison instead of semver.
 * The version field is set to the nightly date for display purposes.
 */
const mapNightlyRelease = (rel: GitHubReleaseApi): UpdateReleaseInfo | null => {
  const nightlyDate = parseNightlyDate(rel.tag_name);
  if (!nightlyDate) return null;

  const assets = (rel.assets || [])
    .filter((asset) => asset && asset.name && asset.browser_download_url)
    .filter((asset) => isAllowedAssetName(asset.name))
    .map(mapAsset);

  return {
    tagName: rel.tag_name,
    version: rel.tag_name,
    name: rel.name || `Nightly ${nightlyDate}`,
    body: rel.body,
    htmlUrl: rel.html_url,
    publishedAt: rel.published_at,
    prerelease: true,
    draft: Boolean(rel.draft),
    assets,
    recommendedAsset: pickRecommendedAsset(assets),
  };
};

/**
 * Check for nightly-to-nightly updates.
 * Returns an update when:
 *   1. A nightly with a newer date exists, OR
 *   2. A nightly with the same date exists but has a different commit hash
 *      (pick the one with the latest publishedAt).
 */
const checkNightlyUpdate = async (repo: string, currentBuildDate: string): Promise<UpdateCheckResult> => {
  const currentVersion = app.getVersion();
  const releases = await fetchGitHubReleases(repo);

  const nightlyCandidates = releases
    .filter((r) => r && !r.draft && isNightlyTag(r.tag_name))
    .map(mapNightlyRelease)
    .filter((r): r is UpdateReleaseInfo => Boolean(r));

  if (nightlyCandidates.length === 0) {
    return { currentVersion, updateAvailable: false };
  }

  // Filter candidates whose date is >= current build date
  const currentNorm = currentBuildDate.replace(/-/g, '');
  const eligibleCandidates = nightlyCandidates.filter((r) => {
    const d = parseNightlyDate(r.tagName);
    if (!d) return false;
    return d.replace(/-/g, '') >= currentNorm;
  });

  if (eligibleCandidates.length === 0) {
    return { currentVersion, updateAvailable: false };
  }

  // Sort by publishedAt descending to pick the most recently published release
  eligibleCandidates.sort((a, b) => {
    const pa = a.publishedAt || '';
    const pb = b.publishedAt || '';
    return pb.localeCompare(pa);
  });
  const latest = eligibleCandidates[0];

  const latestDate = parseNightlyDate(latest.tagName);
  if (!latestDate) {
    return { currentVersion, updateAvailable: false };
  }

  const latestNorm = latestDate.replace(/-/g, '');

  let updateAvailable = false;
  if (latestNorm > currentNorm) {
    // Newer date → always update
    updateAvailable = true;
  } else {
    // Same date → update only if commit hash differs
    const latestCommit = parseNightlyCommit(latest.tagName);
    // When both hashes are available, compare them; otherwise fall back to no-update
    if (latestCommit && buildCommit && buildCommit !== 'unknown') {
      updateAvailable = latestCommit.toLowerCase() !== buildCommit.toLowerCase();
    }
  }

  return {
    currentVersion,
    updateAvailable,
    latest: updateAvailable ? latest : undefined,
  };
};

type DownloadState = {
  abortController: AbortController;
  filePath: string;
};

const downloads = new Map<string, DownloadState>();

const sanitizeFileName = (name: string): string => {
  // Keep only base name and trim weird whitespace.
  const base = path.basename(name).trim();
  // Avoid empty names.
  return base || `Sudowork-update-${Date.now()}`;
};

const ensureUniquePath = (target: string): string => {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let i = 1; i < 1000; i++) {
    const next = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(next)) return next;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
};

const emitProgress = (evt: UpdateDownloadProgressEvent) => {
  ipcBridge.update.downloadProgress.emit(evt);
};

const startDownloadInBackground = async (downloadId: string, url: string, filePath: string, abortController: AbortController) => {
  let receivedBytes = 0;
  let totalBytes: number | undefined;

  const startedAt = Date.now();
  let lastEmitAt = 0;

  const emitThrottled = (status: UpdateDownloadProgressEvent['status']) => {
    const now = Date.now();
    const shouldEmit = now - lastEmitAt >= 250 || status !== 'downloading';
    if (!shouldEmit) return;

    const elapsedSec = Math.max(0.001, (now - startedAt) / 1000);
    const bytesPerSecond = receivedBytes / elapsedSec;
    const percent = totalBytes ? Math.min(100, (receivedBytes / totalBytes) * 100) : undefined;

    lastEmitAt = now;
    emitProgress({
      downloadId,
      status,
      receivedBytes,
      totalBytes,
      percent,
      bytesPerSecond,
      filePath: status === 'completed' ? filePath : undefined,
    });
  };

  emitThrottled('starting');

  let stream: fs.WriteStream | null = null;
  try {
    const res = await fetchWithAllowlistedRedirects(url, abortController.signal);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Download failed (${res.status}): ${body || res.statusText}`);
    }

    const contentLengthHeader = res.headers.get('content-length');
    if (contentLengthHeader) {
      const parsed = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        totalBytes = parsed;
      }
    }

    if (!res.body) {
      throw new Error('Download response has no body');
    }

    stream = fs.createWriteStream(filePath);
    const reader = res.body.getReader();

    let doneReading = false;
    while (!doneReading) {
      const { done, value } = await reader.read();
      doneReading = done;
      if (doneReading) break;
      if (!value) continue;

      receivedBytes += value.byteLength;

      const buf = Buffer.from(value);
      if (!stream.write(buf)) {
        await new Promise<void>((resolve) => stream?.once('drain', () => resolve()));
      }

      emitThrottled('downloading');
    }

    await new Promise<void>((resolve, reject) => {
      if (!stream) {
        resolve();
        return;
      }
      stream.end(() => resolve());
      stream.on('error', reject);
    });

    emitThrottled('completed');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = abortController.signal.aborted || message.toLowerCase().includes('aborted');

    try {
      stream?.close();
    } catch {
      // ignore
    }

    // Remove partial file
    try {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    } catch {
      // ignore
    }

    emitProgress({
      downloadId,
      status: isAbort ? 'cancelled' : 'error',
      receivedBytes,
      totalBytes,
      error: message,
    });
  } finally {
    downloads.delete(downloadId);
  }
};

/**
 * Create a status broadcast callback that sends updates via ipcBridge.autoUpdate.status.emit.
 * This is a pure emitter: it does not bind to any specific window.
 * The ipcBridge channel broadcasts to all renderer listeners, so no window guard is needed here.
 */
export function createAutoUpdateStatusBroadcast(): (status: import('../services/autoUpdaterService').AutoUpdateStatus) => void {
  return (status) => {
    ipcBridge.autoUpdate.status.emit(status);
  };
}

export function initUpdateBridge(): void {
  ipcBridge.update.check.provider(async (params): Promise<{ success: boolean; data?: UpdateCheckResult; msg?: string }> => {
    try {
      const repo = resolveRepo(params?.repo);
      const includePrerelease = Boolean(params?.includePrerelease);
      const currentVersion = app.getVersion();

      // Nightly builds: use GitHub API for date-based comparison
      if (isNightlyBuild) {
        mainLog('Update', `Nightly build detected (date: ${buildDate}), using GitHub API for update check`);
        const result = await checkNightlyUpdate(repo, buildDate);
        return { success: true, data: result };
      }

      // Stable releases: use COS mirror directly for Chinese users
      mainLog('Update', 'Stable release, checking update from COS mirror');
      const currentSemver = semver.valid(currentVersion) || semver.coerce(currentVersion)?.version;
      if (!currentSemver) {
        return { success: true, data: { currentVersion, updateAvailable: false } };
      }

      // Get version info from COS yml
      const cosRelease = await checkUpdateFromCOS();
      if (!cosRelease) {
        return { success: true, data: { currentVersion, updateAvailable: false } };
      }

      const updateAvailable = semver.gt(cosRelease.version, currentSemver);
      mainLog('Update', `COS version: ${cosRelease.version}, current: ${currentSemver}, update available: ${updateAvailable}`);

      return {
        success: true,
        data: {
          currentVersion,
          updateAvailable,
          latest: cosRelease,
        },
      };
    } catch (err: unknown) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.update.download.provider((params: UpdateDownloadRequest): Promise<{ success: boolean; data?: UpdateDownloadResult; msg?: string }> => {
    try {
      if (!params?.url) {
        return Promise.resolve({ success: false, msg: 'missing url' });
      }

      // Defense-in-depth: do not allow arbitrary downloads from renderer.
      // EN: We only allow GitHub release hosts (and follow redirects manually with per-hop allowlist checks).
      // 中文：仅允许 GitHub 相关下载域名，并手动处理重定向（每一跳都校验白名单）。
      assertAllowedUrl(params.url);

      const downloadsDir = app.getPath('downloads');
      const urlObj = new URL(params.url);
      const urlName = path.basename(urlObj.pathname);
      const baseName = sanitizeFileName(params.fileName || urlName);
      const targetPath = path.join(downloadsDir, baseName);

      // Check if file already exists (avoid re-download)
      if (fs.existsSync(targetPath)) {
        const stats = fs.statSync(targetPath);
        if (stats.size > 0) {
          mainLog('Update', `File already exists: ${targetPath}`);
          return Promise.resolve({ success: true, data: { downloadId: 'cached', filePath: targetPath } });
        }
      }

      const downloadId = uuid();
      const abortController = new AbortController();
      const uniquePath = ensureUniquePath(targetPath);
      downloads.set(downloadId, { abortController, filePath: uniquePath });

      // Select best download source (auto-switch to COS mirror if GitHub unreachable)
      selectDownloadSource(params.url, baseName)
        .then((downloadUrl) => {
          // Validate the selected URL (COS mirror URLs should pass since we added it to ALLOWED_DOWNLOAD_HOSTS)
          assertAllowedUrl(downloadUrl);
          // Start background download
          void startDownloadInBackground(downloadId, downloadUrl, uniquePath, abortController);
        })
        .catch((err) => {
          mainError('Update', 'Failed to select download source:', err);
          emitProgress({
            downloadId,
            status: 'error',
            receivedBytes: 0,
            totalBytes: undefined,
            error: err instanceof Error ? err.message : String(err),
          });
          downloads.delete(downloadId);
        });

      return Promise.resolve({ success: true, data: { downloadId, filePath: uniquePath } });
    } catch (err: unknown) {
      return Promise.resolve({ success: false, msg: err instanceof Error ? err.message : String(err) });
    }
  });

  // Auto-updater IPC handlers (electron-updater)
  ipcBridge.autoUpdate.check.provider(async (params: AutoUpdateCheckParams): Promise<{ success: boolean; data?: { updateInfo?: { version: string; releaseDate?: string; releaseNotes?: string } }; msg?: string }> => {
    try {
      // Set prerelease preference before checking
      const includePrerelease = Boolean(params?.includePrerelease);
      autoUpdaterService.setAllowPrerelease(includePrerelease);

      const result = await autoUpdaterService.checkForUpdates();
      if (result.success && result.updateInfo) {
        // Only report update when the remote version is actually newer than the current version.
        // electron-updater's checkForUpdates() always returns updateInfo regardless of availability.
        const currentVersion = app.getVersion();
        if (!semver.gt(result.updateInfo.version, currentVersion)) {
          return { success: true, data: {} };
        }
        return {
          success: true,
          data: {
            updateInfo: {
              version: result.updateInfo.version,
              releaseDate: result.updateInfo.releaseDate,
              releaseNotes: typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : undefined,
            },
          },
        };
      }
      return { success: result.success, msg: result.error };
    } catch (err: unknown) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.autoUpdate.download.provider(async (): Promise<{ success: boolean; msg?: string }> => {
    try {
      const result = await autoUpdaterService.downloadUpdate();
      return { success: result.success, msg: result.error };
    } catch (err: unknown) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.autoUpdate.quitAndInstall.provider(async (): Promise<void> => {
    try {
      autoUpdaterService.quitAndInstall();
    } catch (err: unknown) {
      mainError('Update', 'quitAndInstall failed:', err);
    }
  });

  ipcBridge.autoUpdate.getDownloadedFilePath.provider(async (): Promise<{ success: boolean; data?: { path: string | null } }> => {
    try {
      const filePath = autoUpdaterService.getDownloadedFilePath();
      return { success: true, data: { path: filePath } };
    } catch (err: unknown) {
      return { success: true, data: { path: null } };
    }
  });

  ipcBridge.autoUpdate.getMirrorStatus.provider(async (): Promise<{ success: boolean; data?: { useMirror: boolean; reason: string } }> => {
    try {
      const status = autoUpdaterService.getMirrorStatus();
      return { success: true, data: status };
    } catch (err: unknown) {
      return { success: true, data: { useMirror: false, reason: 'error' } };
    }
  });
}
