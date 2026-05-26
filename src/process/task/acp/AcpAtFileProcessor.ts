/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { extractAtPaths, parseAllAtCommands, reconstructQuery } from '@/common/atCommandParser';
import { detectImageMimeType, resizeImageForContext, IMAGE_TARGET_RAW_SIZE } from '@/common/imageUtils';
import { getImageTargetSize } from '@/common/imageUtils';
import type { AcpImageContentBlock } from '@/types/acpTypes';
import { promises as fs } from 'fs';
import * as path from 'path';
import { mainWarn } from '@process/utils/mainLogger';

export interface ProcessedImageWithSource extends AcpImageContentBlock {
  filePath?: string;
}

/**
 * Try to read a file and detect if it's an image via magic bytes.
 * Images exceeding size/dimension limits are automatically resized and compressed.
 * Returns the image content block if it is an image, null otherwise.
 */
async function tryReadAsImage(filePath: string, maxBytes: number = IMAGE_TARGET_RAW_SIZE): Promise<ProcessedImageWithSource | null> {
  try {
    const buffer = await fs.readFile(filePath);
    const detected = detectImageMimeType(buffer);
    mainWarn('AcpAtFile', `tryReadAsImage: ${filePath}, size=${buffer.length}, detected=${detected ? detected.mime : 'not-image'}`);
    if (detected) {
      if (buffer.length > maxBytes) {
        try {
          const result = await resizeImageForContext(buffer, maxBytes);
          mainWarn('AcpAtFile', `tryReadAsImage: resized ${filePath} from ${buffer.length} to ${result.buffer.length} bytes, mediaType=${result.mediaType}`);
          return {
            type: 'image',
            data: result.buffer.toString('base64'),
            mimeType: result.mediaType,
            filePath,
          };
        } catch (resizeErr) {
          mainWarn('AcpAtFile', `tryReadAsImage: resize failed for ${filePath}: ${resizeErr instanceof Error ? resizeErr.message : String(resizeErr)}, sending original`);
        }
      }
      return {
        type: 'image',
        data: buffer.toString('base64'),
        mimeType: detected.mime,
        filePath,
      };
    }
  } catch (err) {
    mainWarn('AcpAtFile', `tryReadAsImage: failed to read ${filePath}: ${err}`);
  }
  return null;
}

export interface ProcessedAtFileResult {
  text: string;
  images: ProcessedImageWithSource[];
}

/**
 * Process @ file references in the message content.
 * Resolves @ references to actual files in the workspace,
 * reads their content, and appends it to the message.
 * Image files (detected by magic bytes) are returned as separate content blocks.
 */
export async function processAtFileReferences(content: string, workspace: string | undefined, uploadedFiles?: string[], modelId?: string): Promise<ProcessedAtFileResult> {
  if (!workspace) {
    return { text: content, images: [] };
  }

  const parts = parseAllAtCommands(content);
  const atPaths = extractAtPaths(content);

  mainWarn('AcpAtFile', `processAtFileReferences: atPaths=${JSON.stringify(atPaths)}, uploadedFiles=${JSON.stringify(uploadedFiles)}`);

  if (atPaths.length === 0) {
    return { text: content, images: [] };
  }

  const resolvedFiles: Map<string, string> = new Map();
  const referencesToRemove: Set<string> = new Set();
  const images: ProcessedImageWithSource[] = [];
  const imageReferences: Set<string> = new Set();

  const maxImageBytes = getImageTargetSize(modelId);

  for (const atPath of atPaths) {
    const matchedUploadFile = uploadedFiles?.find((filePath) => {
      const normalizedFilePath = filePath.replace(/\\/g, '/');
      if (atPath === normalizedFilePath) return true;
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      return atPath === fileName;
    });

    if (matchedUploadFile) {
      const imageBlock = await tryReadAsImage(matchedUploadFile, maxImageBytes);
      if (imageBlock) {
        images.push(imageBlock);
        imageReferences.add(atPath);
        referencesToRemove.add(atPath);
      } else if (atPath !== matchedUploadFile) {
        referencesToRemove.add(atPath);
      }
      continue;
    }

    const resolvedPath = await resolveAtPath(atPath, workspace);

    if (resolvedPath) {
      // Try reading as image via magic bytes
      const imageBlock = await tryReadAsImage(resolvedPath, maxImageBytes);
      if (imageBlock) {
        images.push(imageBlock);
        imageReferences.add(atPath);
      } else {
        try {
          const fileContent = await fs.readFile(resolvedPath, 'utf-8');
          resolvedFiles.set(atPath, fileContent);
        } catch {
          mainWarn('AcpAgent', `Skipping binary file ${atPath}`);
        }
      }
    }
  }

  if (resolvedFiles.size === 0 && referencesToRemove.size === 0 && imageReferences.size === 0) {
    return { text: content, images };
  }

  const reconstructedQuery = reconstructQuery(parts, (atPath) => {
    if (referencesToRemove.has(atPath) || imageReferences.has(atPath)) {
      return '';
    }
    if (resolvedFiles.has(atPath)) {
      return atPath;
    }
    return '@' + atPath;
  });

  let result = reconstructedQuery;
  if (resolvedFiles.size > 0) {
    result += '\n\n--- Referenced file contents ---';
    for (const [atPath, fileContent] of resolvedFiles) {
      result += `\n\n[Content of ${atPath}]:\n${fileContent}`;
    }
    result += '\n--- End of file contents ---';
  }

  mainWarn('AcpAtFile', `processAtFileReferences result: images=${images.length}, textFiles=${resolvedFiles.size}, removed=${referencesToRemove.size}, imageRefs=${imageReferences.size}, textLen=${result.length}`);
  return { text: result, images };
}

async function resolveAtPath(atPath: string, workspace: string): Promise<string | null> {
  const directPath = path.resolve(workspace, atPath);
  try {
    const stats = await fs.stat(directPath);
    if (stats.isFile()) {
      return directPath;
    }
    return null;
  } catch {
    // Direct path doesn't exist, try searching
  }

  try {
    const fileName = path.basename(atPath);
    const foundPath = await findFileInWorkspace(workspace, fileName);
    return foundPath;
  } catch {
    return null;
  }
}

async function findFileInWorkspace(workspace: string, fileName: string, maxDepth: number = 3): Promise<string | null> {
  const searchDir = async (dir: string, depth: number): Promise<string | null> => {
    if (depth > maxDepth) return null;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
          return fullPath;
        }
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const found = await searchDir(fullPath, depth + 1);
          if (found) return found;
        }
      }
    } catch {
      // Ignore permission errors
    }
    return null;
  };

  return await searchDir(workspace, 0);
}
