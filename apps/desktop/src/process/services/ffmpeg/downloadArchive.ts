/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal https download-to-file for the FFmpeg runtime (COS source). Split out
 * from FfmpegRuntimeService so the service can be unit-tested with this mocked.
 * Mirrors the proxy-aware, redirect-following download used by the other runtime
 * installers (DynamicNexusVfsService).
 */

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { getProxyAgent } from '@process/utils/proxyAgent';

export type DownloadProgressCallback = (percent: number) => void;

/** Download `url` to `destPath`. Rejects with `NOT_FOUND` on 404. */
export async function downloadArchive(url: string, destPath: string, onProgress?: DownloadProgressCallback): Promise<void> {
  // Honor HTTP(S)_PROXY / NO_PROXY — Node's raw get() ignores them.
  const proxyAgent = await getProxyAgent(url);
  return new Promise((resolve, reject) => {
    let redirects = 0;

    const doRequest = (requestUrl: string): void => {
      if (redirects++ > 10) {
        reject(new Error('Too many redirects'));
        return;
      }
      const protocol = requestUrl.startsWith('https') ? https : http;
      protocol
        .get(requestUrl, { agent: proxyAgent }, (response) => {
          const code = response.statusCode;
          if (code && [301, 302, 307, 308].includes(code) && response.headers.location) {
            response.resume();
            doRequest(response.headers.location);
            return;
          }
          if (code === 404) {
            response.resume();
            reject(new Error('NOT_FOUND'));
            return;
          }
          if (code !== 200) {
            response.resume();
            reject(new Error(`HTTP ${code}`));
            return;
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10);
          let downloaded = 0;
          const file = fs.createWriteStream(destPath);

          response.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            if (totalSize > 0 && onProgress) {
              onProgress(Math.round((downloaded / totalSize) * 100));
            }
          });
          response.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', (err) => {
            try {
              fs.unlinkSync(destPath);
            } catch {
              // ignore cleanup failure
            }
            reject(err);
          });
        })
        .on('error', (err) => {
          try {
            fs.unlinkSync(destPath);
          } catch {
            // ignore cleanup failure
          }
          reject(err);
        });
    };

    doRequest(url);
  });
}
