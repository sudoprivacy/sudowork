/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import type { IUnifiedAttachment, PluginType } from '../types';

/**
 * Result of downloading a media file to the workspace.
 */
export interface IMediaDownloadResult {
  /** Absolute path to the downloaded file on disk */
  filePath: string;
  /** Original attachment metadata */
  attachment: IUnifiedAttachment;
}

/**
 * Extension mapping from MIME types to file extensions.
 * Used when the original filename is unavailable.
 */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/amr': '.amr',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'video/mp4': '.mp4',
  'application/pdf': '.pdf',
};

/**
 * Extension mapping from attachment types to default extensions (fallback).
 */
const TYPE_TO_EXT: Record<string, string> = {
  photo: '.jpg',
  voice: '.amr',
  audio: '.mp3',
  video: '.mp4',
  document: '.bin',
  sticker: '.webp',
};

/**
 * Generate a filename for a downloaded media file.
 * Format: {type}_{timestamp}_{randomSuffix}{ext}
 */
export function generateMediaFilename(attachment: IUnifiedAttachment): string {
  const timestamp = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);
  const ext = (attachment.fileName && path.extname(attachment.fileName)) || (attachment.mimeType && MIME_TO_EXT[attachment.mimeType]) || TYPE_TO_EXT[attachment.type] || '.bin';
  const baseName = attachment.fileName ? path.basename(attachment.fileName, path.extname(attachment.fileName)) : attachment.type;
  return `${baseName}_${timestamp}_${suffix}${ext}`;
}

/**
 * Ensure the media directory exists within the workspace.
 * Returns the absolute path to the media subdirectory.
 */
export function ensureMediaDir(workspace: string, platform: PluginType): string {
  const mediaDir = path.join(workspace, platform, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  return mediaDir;
}

/**
 * Save a media buffer to the workspace.
 * Returns the absolute path to the saved file.
 */
export function saveMediaToWorkspace(buffer: Buffer, workspace: string, platform: PluginType, attachment: IUnifiedAttachment): string {
  const mediaDir = ensureMediaDir(workspace, platform);
  const filename = generateMediaFilename(attachment);
  const filePath = path.join(mediaDir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}
