/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { extractAtPaths, parseAllAtCommands, reconstructQuery } from '@/common/atCommandParser';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Process @ file references in the message content.
 * Resolves @ references to actual files in the workspace,
 * reads their content, and appends it to the message.
 */
export async function processAtFileReferences(content: string, workspace: string | undefined, uploadedFiles?: string[]): Promise<string> {
  if (!workspace) {
    return content;
  }

  const parts = parseAllAtCommands(content);
  const atPaths = extractAtPaths(content);

  if (atPaths.length === 0) {
    return content;
  }

  const resolvedFiles: Map<string, string> = new Map();
  const referencesToRemove: Set<string> = new Set();

  for (const atPath of atPaths) {
    const matchedUploadFile = uploadedFiles?.find((filePath) => {
      if (atPath === filePath) return true;
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      return atPath === fileName;
    });

    if (matchedUploadFile) {
      if (atPath !== matchedUploadFile) {
        referencesToRemove.add(atPath);
      }
      continue;
    }

    const resolvedPath = await resolveAtPath(atPath, workspace);

    if (resolvedPath) {
      try {
        const fileContent = await fs.readFile(resolvedPath, 'utf-8');
        resolvedFiles.set(atPath, fileContent);
      } catch (error) {
        console.warn(`[AcpAgent] Skipping binary file ${atPath} (will be handled by CLI)`);
      }
    }
  }

  if (resolvedFiles.size === 0 && referencesToRemove.size === 0) {
    return content;
  }

  const reconstructedQuery = reconstructQuery(parts, (atPath) => {
    if (referencesToRemove.has(atPath)) {
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

  return result;
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
