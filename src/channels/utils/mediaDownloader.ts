/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { getDataPath } from '@/process/utils';
import type { PluginType } from '../types';

/**
 * Get the workspace directory for channel media files.
 * Creates the directory if it doesn't exist.
 *
 * @param platform - Channel platform type (e.g., 'wechat', 'telegram')
 * @returns Absolute path to the media workspace directory
 */
export function getMediaWorkspacePath(platform: PluginType): string {
  const dir = path.join(getDataPath(), 'channel-media', platform);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Save a media buffer to the workspace directory.
 * Generates a unique filename with the given extension.
 *
 * @param platform - Channel platform type
 * @param data - File content as Buffer
 * @param extension - File extension including dot (e.g., '.jpg')
 * @param prefix - Optional filename prefix (default: 'media')
 * @returns Absolute path to the saved file
 */
export async function saveMediaToWorkspace(platform: PluginType, data: Buffer, extension: string, prefix = 'media'): Promise<string> {
  const dir = getMediaWorkspacePath(platform);
  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${extension}`;
  const filePath = path.join(dir, filename);
  await fs.promises.writeFile(filePath, data);
  return filePath;
}
