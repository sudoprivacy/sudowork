/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import type { PluginType } from '../types';

/**
 * Options for saving a media file to the workspace.
 */
export interface IMediaSaveOptions {
  /** The platform type (e.g., 'wechat', 'telegram', 'lark') */
  platform: PluginType;
  /** The base workspace directory for channel media */
  baseDir: string;
  /** Raw file data */
  data: Buffer;
  /** Original file name (if available) */
  fileName?: string;
  /** Default file extension (e.g., '.jpg', '.mp4') */
  defaultExtension?: string;
}

/**
 * Save a media file to the workspace directory.
 * Creates the platform-specific subdirectory if it doesn't exist.
 *
 * @returns The absolute path to the saved file
 */
export function saveMediaToWorkspace(options: IMediaSaveOptions): string {
  const dir = path.join(options.baseDir, options.platform);
  fs.mkdirSync(dir, { recursive: true });

  const ext = options.fileName ? path.extname(options.fileName) : options.defaultExtension || '';
  const baseName = options.fileName || `${options.platform}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const filePath = path.join(dir, baseName);

  fs.writeFileSync(filePath, options.data);
  return filePath;
}

/**
 * Download a file from a URL and save it to the workspace.
 *
 * @returns The absolute path to the saved file
 */
export async function downloadAndSaveMedia(url: string, options: Omit<IMediaSaveOptions, 'data'>, timeoutMs = 30_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    return saveMediaToWorkspace({ ...options, data });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Media download timed out');
    }
    throw error;
  }
}
