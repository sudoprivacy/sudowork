/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Remote Resource Downloader
 *
 * Generic utility for downloading binary resources at runtime (first app launch).
 * Supports progress callbacks, multi-source fallback, retries, and redirect handling.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

const TAG = 'RemoteDownloader';

export type DownloadProgressCallback = (percent: number, downloadedBytes: number, totalBytes: number) => void;

export interface DownloadOptions {
  /** Progress callback: reports percent (0-100), downloaded bytes, and total bytes */
  onProgress?: DownloadProgressCallback;
  /** Maximum number of retries per URL (default: 3) */
  maxRetries?: number;
  /** Timeout in ms for the HTTP request (default: 300000 = 5 min) */
  timeoutMs?: number;
  /** Expected SHA256 hash to verify after download */
  expectedSha256?: string;
}

/**
 * Download a file from a URL with progress reporting, redirect handling, and retries.
 * @param url - The URL to download from
 * @param destPath - The local path to save the file
 * @param options - Download options
 * @returns true if download was successful
 */
export async function downloadFile(url: string, destPath: string, options?: DownloadOptions): Promise<boolean> {
  const maxRetries = options?.maxRetries ?? 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      mainLog(TAG, `Downloading (attempt ${attempt}/${maxRetries}): ${url}`);
      await downloadOnce(url, destPath, options);

      // Verify SHA256 if provided
      if (options?.expectedSha256) {
        const actualHash = sha256File(destPath);
        if (actualHash !== options.expectedSha256) {
          fs.unlinkSync(destPath);
          throw new Error(`SHA256 mismatch: expected ${options.expectedSha256}, got ${actualHash}`);
        }
        mainLog(TAG, 'SHA256 verified');
      }

      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Attempt ${attempt} failed: ${msg}`);

      // Clean up partial download
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch { /* ignore */ }

      if (attempt === maxRetries) {
        mainError(TAG, `All ${maxRetries} attempts failed for ${url}`);
        return false;
      }

      // Brief delay before retry
      await sleep(1000 * attempt);
    }
  }

  return false;
}

/**
 * Download from multiple URLs with fallback. Tries each URL in order until one succeeds.
 * @param urls - Array of URLs to try
 * @param destPath - The local path to save the file
 * @param options - Download options
 * @returns true if any URL succeeded
 */
export async function downloadWithFallback(urls: string[], destPath: string, options?: DownloadOptions): Promise<boolean> {
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    mainLog(TAG, `Trying source ${i + 1}/${urls.length}: ${url}`);

    const success = await downloadFile(url, destPath, { ...options, maxRetries: 2 });
    if (success) return true;

    mainWarn(TAG, `Source ${i + 1} failed, ${i < urls.length - 1 ? 'trying next...' : 'no more sources'}`);
  }

  return false;
}

/**
 * Download a SHA256SUMS file and extract the hash for a specific filename.
 */
export async function fetchSha256(checksumUrl: string, filename: string): Promise<string | null> {
  const tmpPath = path.join(require('os').tmpdir(), `sha256sums-${Date.now()}`);
  try {
    const ok = await downloadFile(checksumUrl, tmpPath, { maxRetries: 2 });
    if (!ok) return null;

    const content = fs.readFileSync(tmpPath, 'utf8');
    const line = content.split('\n').find((l) => l.includes(filename));
    if (!line) return null;

    return line.split(/\s+/)[0] || null;
  } catch {
    return null;
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch { /* ignore */ }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

function downloadOnce(url: string, destPath: string, options?: DownloadOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const file = fs.createWriteStream(destPath);
    let redirects = 0;
    const timeoutMs = options?.timeoutMs ?? 300_000;

    const doRequest = (requestUrl: string): void => {
      if (redirects++ > 10) {
        file.close();
        reject(new Error('Too many redirects'));
        return;
      }

      const protocol = requestUrl.startsWith('https') ? https : http;
      const req = protocol.get(requestUrl, { timeout: timeoutMs }, (response) => {
        // Handle redirects
        if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode)) {
          const location = response.headers.location;
          if (location) {
            response.resume(); // Consume response to free resources
            doRequest(location);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;
        let lastReportedPercent = -1;

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (totalSize > 0 && options?.onProgress) {
            const percent = Math.round((downloaded / totalSize) * 100);
            if (percent !== lastReportedPercent) {
              lastReportedPercent = percent;
              options.onProgress(percent, downloaded, totalSize);
            }
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      req.on('error', (err) => {
        file.close();
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        file.close();
        reject(new Error(`Download timeout after ${timeoutMs}ms`));
      });
    };

    doRequest(url);
  });
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
