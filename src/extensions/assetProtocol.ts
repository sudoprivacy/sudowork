/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';

/**
 * Custom protocol for serving local files/assets in Electron.
 *
 * In dev mode, the renderer loads from http://localhost:5173/ (Vite dev server),
 * which blocks file:// URLs due to browser security policy.
 * The aion-asset:// protocol serves local files through Electron with byte-range
 * support, bypassing this restriction.
 *
 * URL format: aion-asset://asset/C:/path/to/file.svg
 * - Uses `standard: true` so the URL parser correctly separates host and pathname.
 * - Fixed hostname "asset" prevents Windows drive letters (e.g. C:) from being
 *   misinterpreted as host:port by the URL parser.
 * - The handler streams files directly and honors byte-range requests.
 */
export const AION_ASSET_PROTOCOL = 'aion-asset';

/** Fixed hostname used in aion-asset:// URLs. */
export const AION_ASSET_HOST = 'asset';

/**
 * Convert an absolute file path to an aion-asset:// URL.
 * Normalizes backslashes to forward slashes for cross-platform compatibility.
 */
export function toAssetUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  return `${AION_ASSET_PROTOCOL}://${AION_ASSET_HOST}/${normalized}`;
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4v': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.aac': 'audio/aac',
  '.amr': 'audio/amr',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.ogv': 'video/ogg',
  '.opus': 'audio/opus',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.wma': 'audio/x-ms-wma',
};

export const getAssetContentType = (filePath: string): string => {
  return CONTENT_TYPE_BY_EXTENSION[extname(filePath).toLowerCase()] || 'application/octet-stream';
};

export const resolveAssetFilePath = (assetUrl: string, platform: NodeJS.Platform = process.platform): string => {
  const url = new URL(assetUrl);
  if (url.protocol !== `${AION_ASSET_PROTOCOL}:` || url.hostname !== AION_ASSET_HOST) {
    throw new Error(`Unsupported asset URL: ${assetUrl}`);
  }

  let filePath = decodeURIComponent(url.pathname);
  if (platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
    return filePath.slice(1);
  }

  if (platform !== 'win32' && filePath.startsWith('//')) {
    filePath = filePath.replace(/^\/+/, '/');
  }

  return filePath;
};

export interface AssetByteRange {
  readonly status: 200 | 206;
  readonly start: number;
  readonly end: number;
  readonly contentLength: number;
  readonly contentRange?: string;
}

export interface UnsatisfiableAssetByteRange {
  readonly status: 416;
  readonly contentRange: string;
}

export type AssetByteRangeResult = AssetByteRange | UnsatisfiableAssetByteRange;

export const resolveAssetByteRange = (rangeHeader: string | null, fileSize: number): AssetByteRangeResult => {
  if (!rangeHeader) {
    return {
      status: 200,
      start: 0,
      end: Math.max(fileSize - 1, 0),
      contentLength: fileSize,
    };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2]) || fileSize <= 0) {
    return {
      status: 416,
      contentRange: `bytes */${fileSize}`,
    };
  }

  const [, startValue, endValue] = match;
  let start: number;
  let end: number;

  if (!startValue) {
    const suffixLength = Number(endValue);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return {
        status: 416,
        contentRange: `bytes */${fileSize}`,
      };
    }

    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(startValue);
    end = endValue ? Number(endValue) : fileSize - 1;

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= fileSize || end < start) {
      return {
        status: 416,
        contentRange: `bytes */${fileSize}`,
      };
    }

    end = Math.min(end, fileSize - 1);
  }

  return {
    status: 206,
    start,
    end,
    contentLength: end - start + 1,
    contentRange: `bytes ${start}-${end}/${fileSize}`,
  };
};

const createRangeHeaders = (filePath: string, range: AssetByteRangeResult): Headers => {
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': getAssetContentType(filePath),
  });

  if (range.status === 416) {
    headers.set('Content-Range', range.contentRange);
    headers.set('Content-Length', '0');
    return headers;
  }

  headers.set('Content-Length', String(range.contentLength));
  if (range.contentRange) {
    headers.set('Content-Range', range.contentRange);
  }

  return headers;
};

export const createAssetProtocolResponse = async (request: Request): Promise<Response> => {
  try {
    const filePath = resolveAssetFilePath(request.url);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return new Response(null, { status: 404 });
    }

    const range = resolveAssetByteRange(request.headers.get('range'), fileStat.size);
    const headers = createRangeHeaders(filePath, range);
    if (range.status === 416 || fileStat.size === 0) {
      return new Response(null, { status: range.status, headers });
    }

    const fileStream = createReadStream(filePath, { start: range.start, end: range.end });
    const body = Readable.toWeb(fileStream) as BodyInit;
    return new Response(body, {
      status: range.status,
      headers,
    });
  } catch {
    return new Response(null, { status: 404 });
  }
};
