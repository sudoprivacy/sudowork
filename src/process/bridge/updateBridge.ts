/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { uuid } from '@/common/utils';
import type { UpdateCheckResult, UpdateDownloadProgressEvent, UpdateDownloadRequest, UpdateDownloadResult, UpdateReleaseInfo, GitHubReleaseAsset } from '@/common/updateTypes';
import { ipcBridge } from '@/common';
import { isNightlyBuild, buildDate, buildCommit, isNightlyTag, parseNightlyDate, parseNightlyCommit } from '@/common/buildInfo';
import { getPrivateUpdateFeedBaseUrl, isUrlWithinPrivateUpdateFeed, PRIVATE_UPDATE_FEED_NOT_CONFIGURED, VERSION_UPDATE_DISABLED_BY_SERVER, isVersionUpdateEnabled } from '@/common/systemConfig';
import { autoUpdaterService } from '../services/autoUpdaterService';

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
const MAX_REDIRECTS = 8;
const SHA512_BASE64_PATTERN = /^[A-Za-z0-9+/]{86}==$/;

const getPrivateUpdateFeedBaseOrThrow = (): string => {
  const base = getPrivateUpdateFeedBaseUrl();
  if (!base) throw new Error(PRIVATE_UPDATE_FEED_NOT_CONFIGURED);
  return base;
};

const getPrivateFeedBase = (): string => getPrivateUpdateFeedBaseOrThrow();

const isAllowedDownloadUrl = (rawUrl: string): boolean => {
  return isUrlWithinPrivateUpdateFeed(rawUrl);
};

const cosYmlFileSchema = z.object({
  url: z.string().min(1),
  sha512: z.string().regex(SHA512_BASE64_PATTERN),
  size: z.number().int().positive(),
});

const cosYmlInfoSchema = z.object({
  version: z.string().refine((version) => semver.valid(version) !== null),
  releaseDate: z.string().optional(),
  path: z.string().min(1).optional(),
  sha512: z.string().regex(SHA512_BASE64_PATTERN).optional(),
  files: z.array(cosYmlFileSchema).min(1),
});

type COSYmlInfo = z.infer<typeof cosYmlInfoSchema>;

type RuntimePlatformInfo = {
  platform: NodeJS.Platform;
  arch: string;
};

export const parseCOSYmlText = (text: string): COSYmlInfo | null => {
  try {
    const result = cosYmlInfoSchema.safeParse(parseYaml(text) as unknown);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

/**
 * Parse and validate electron-updater metadata from the private update feed.
 */
const parseCOSYml = async (ymlUrl: string): Promise<COSYmlInfo | null> => {
  try {
    const res = await fetch(ymlUrl, { method: 'GET' });
    if (!res.ok) return null;

    return parseCOSYmlText(await res.text());
  } catch {
    return null;
  }
};

/**
 * Get yml filename for current platform.
 */
export const getCOSYmlFileName = (runtime: RuntimePlatformInfo = { platform: process.platform, arch: process.arch }): string => {
  const { platform, arch } = runtime;
  if (platform === 'win32') {
    return arch === 'arm64' ? 'win-arm64.yml' : 'latest.yml';
  } else if (platform === 'darwin') {
    return arch === 'arm64' ? 'arm64-mac.yml' : 'latest-mac.yml';
  } else {
    return arch === 'arm64' ? 'arm64-linux.yml' : 'latest-linux.yml';
  }
};

/**
 * Build UpdateReleaseInfo from private update metadata.
 */
export const buildReleaseInfoFromCOS = (ymlInfo: COSYmlInfo, runtime: RuntimePlatformInfo = { platform: process.platform, arch: process.arch }, mirrorBase = getPrivateFeedBase()): UpdateReleaseInfo | null => {
  const baseUrl = new URL(`${mirrorBase.replace(/\/+$/, '')}/`);
  const basePath = baseUrl.pathname;
  const assets = ymlInfo.files.flatMap((file): GitHubReleaseAsset[] => {
    try {
      const assetUrl = new URL(file.url, baseUrl);
      const isSameOrigin = assetUrl.origin === baseUrl.origin;
      const isWithinFeed = assetUrl.pathname.startsWith(basePath);
      if (!isSameOrigin || !isWithinFeed || !isAllowedAssetName(assetUrl.pathname)) {
        return [];
      }

      return [
        {
          name: path.basename(assetUrl.pathname),
          url: assetUrl.toString(),
          size: file.size,
          sha512: file.sha512,
        },
      ];
    } catch {
      return [];
    }
  });

  const recommendedAsset = pickRecommendedAsset(assets, runtime);
  if (!recommendedAsset) return null;

  return {
    tagName: `v${ymlInfo.version}`,
    version: ymlInfo.version,
    htmlUrl: baseUrl.toString(),
    publishedAt: ymlInfo.releaseDate,
    prerelease: false,
    draft: false,
    assets,
    recommendedAsset,
  };
};

/**
 * Check for updates from the private update feed.
 */
const checkUpdateFromCOS = async (): Promise<UpdateReleaseInfo | null> => {
  const ymlFileName = getCOSYmlFileName();
  const ymlUrl = `${getPrivateFeedBase()}/${ymlFileName}`;

  mainLog('Update', `Checking update from private feed: ${ymlUrl}`);

  const ymlInfo = await parseCOSYml(ymlUrl);
  if (!ymlInfo) {
    mainLog('Update', 'Failed to parse private update metadata');
    return null;
  }

  mainLog('Update', `Private feed version: ${ymlInfo.version}`);
  return buildReleaseInfoFromCOS(ymlInfo);
};

const isAllowedAssetName = (name: string) => {
  const ext = path.extname(name);
  return ALLOWED_ASSET_EXTS.includes(ext);
};

const mapAsset = (asset: GitHubReleaseApiAsset): GitHubReleaseAsset => ({
  name: asset.name,
  url: asset.browser_download_url,
  size: asset.size,
  contentType: asset.content_type,
});

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
 * Select best download source based on build channel.
 *
 * Stable releases → force the private update feed so auto-check and manual download
 * share the same source of truth.
 *
 * Nightly builds → keep the original asset URL; the allowlist below still blocks
 * anything outside the configured private update feed.
 */
const selectDownloadSource = async (originalUrl: string, originalName: string): Promise<string> => {
  if (isNightlyBuild) {
    return originalUrl;
  }

  const mirrorBase = `${getPrivateFeedBase().replace(/\/+$/, '')}/`;
  const sourceUrl = new URL(originalUrl);
  const mirrorUrl = new URL(mirrorBase);
  const isVersionedPrivateFeedAsset = sourceUrl.origin === mirrorUrl.origin && sourceUrl.pathname.startsWith(mirrorUrl.pathname);
  if (isVersionedPrivateFeedAsset) {
    return sourceUrl.toString();
  }

  const privateFeedUrl = new URL(path.basename(originalName), mirrorUrl).toString();
  mainLog('Update', `Stable release, forcing private feed download source: ${privateFeedUrl}`);
  return privateFeedUrl;
};

const assertAllowedUrl = (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid download URL');
  }

  if (!isAllowedDownloadUrl(parsed.toString())) {
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

export const verifyFileSha512 = async (filePath: string, expectedSha512: string): Promise<boolean> => {
  if (!SHA512_BASE64_PATTERN.test(expectedSha512)) return false;

  const hash = createHash('sha512');
  await new Promise<void>((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => {
      hash.update(chunk);
    });
    input.on('error', reject);
    input.on('end', resolve);
  });

  return hash.digest('base64') === expectedSha512;
};

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

const startDownloadInBackground = async (downloadId: string, url: string, filePath: string, abortController: AbortController, expectedSha512?: string) => {
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
  const hash = expectedSha512 ? createHash('sha512') : null;
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
      hash?.update(buf);
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

    if (hash && hash.digest('base64') !== expectedSha512) {
      throw new Error('Downloaded update failed SHA-512 verification');
    }

    emitThrottled('completed');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = abortController.signal.aborted || message.toLowerCase().includes('aborted');
    const isIntegrityFailure = message.includes('SHA-512 verification');
    if (isIntegrityFailure) {
      mainError('Update', message);
    }

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
      error: isIntegrityFailure ? undefined : message,
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
      const currentVersion = app.getVersion();
      if (!isVersionUpdateEnabled()) {
        return { success: false, msg: VERSION_UPDATE_DISABLED_BY_SERVER };
      }

      // Nightly builds: use GitHub API for date-based comparison
      if (isNightlyBuild) {
        mainLog('Update', `Nightly build detected (date: ${buildDate}), using GitHub API for update check`);
        const result = await checkNightlyUpdate(repo, buildDate);
        return { success: true, data: result };
      }

      // Stable releases: use the private update feed directly.
      mainLog('Update', 'Stable release, checking update from private feed');
      const currentSemver = semver.valid(currentVersion) || semver.coerce(currentVersion)?.version;
      if (!currentSemver) {
        return { success: true, data: { currentVersion, updateAvailable: false } };
      }

      // Get version info from private update metadata.
      const cosRelease = await checkUpdateFromCOS();
      if (!cosRelease) {
        return { success: true, data: { currentVersion, updateAvailable: false } };
      }

      const updateAvailable = semver.gt(cosRelease.version, currentSemver);
      mainLog('Update', `Private feed version: ${cosRelease.version}, current: ${currentSemver}, update available: ${updateAvailable}`);

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

  ipcBridge.update.download.provider(async (params: UpdateDownloadRequest): Promise<{ success: boolean; data?: UpdateDownloadResult; msg?: string }> => {
    try {
      if (!params?.url) {
        return { success: false, msg: 'missing url' };
      }
      if (params.sha512 && !SHA512_BASE64_PATTERN.test(params.sha512)) {
        return { success: false, msg: 'invalid sha512' };
      }

      // Defense-in-depth: only allow downloads within the configured private update feed.
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
          const isChecksumValid = params.sha512 ? await verifyFileSha512(targetPath, params.sha512) : true;
          if (isChecksumValid) {
            mainLog('Update', `File already exists: ${targetPath}`);
            return { success: true, data: { downloadId: 'cached', filePath: targetPath } };
          }
          mainLog('Update', `Ignoring cached update with mismatched SHA-512: ${targetPath}`);
        }
      }

      const downloadId = uuid();
      const abortController = new AbortController();
      const uniquePath = ensureUniquePath(targetPath);
      downloads.set(downloadId, { abortController, filePath: uniquePath });

      // Select the normalized private feed download source.
      selectDownloadSource(params.url, baseName)
        .then((downloadUrl) => {
          // Validate the selected URL again after normalization.
          assertAllowedUrl(downloadUrl);
          // Start background download
          void startDownloadInBackground(downloadId, downloadUrl, uniquePath, abortController, params.sha512);
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

      return { success: true, data: { downloadId, filePath: uniquePath } };
    } catch (err: unknown) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
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
    } catch {
      return { success: true, data: { path: null } };
    }
  });

  ipcBridge.autoUpdate.getMirrorStatus.provider(async (): Promise<{ success: boolean; data?: { useMirror: boolean; reason: string } }> => {
    try {
      const status = autoUpdaterService.getMirrorStatus();
      return { success: true, data: status };
    } catch {
      return { success: true, data: { useMirror: false, reason: 'error' } };
    }
  });
}
