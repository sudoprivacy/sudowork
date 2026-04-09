/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared assistant resource reading utilities for the main process.
 * These are extracted from fsBridge.ts so CronService can call them directly
 * without going through IPC.
 */

import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { getAssistantsDir } from '../initStorage';
import { mainWarn } from '@process/utils/mainLogger';

type ResourceType = 'rules' | 'skills';

export const ruleFilePattern = (id: string, loc: string) => `${id}.${loc}.md`;
export const skillFilePattern = (id: string, loc: string) => `${id}-skills.${loc}.md`;

/**
 * Find the builtin resource directory (rules or skills)
 */
async function findBuiltinResourceDir(resourceType: ResourceType): Promise<string> {
  if (app.isPackaged) {
    const appPath = app.getAppPath();
    const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
    const candidates = [path.join(unpackedPath, resourceType), path.join(appPath, resourceType)];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Try next
      }
    }
    mainWarn('assistantResources', `Could not find builtin ${resourceType} directory`);
    return candidates[0];
  }
  const appPath = app.getAppPath();
  const candidates = [path.join(appPath, resourceType), path.join(appPath, '..', resourceType), path.join(appPath, '..', '..', resourceType), path.join(appPath, '..', '..', '..', resourceType)];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next
    }
  }
  return candidates[0];
}

/**
 * Read a builtin resource file (.md only)
 */
export async function readBuiltinResource(resourceType: ResourceType, fileName: string): Promise<string> {
  const safeFileName = path.basename(fileName);
  if (!safeFileName.endsWith('.md')) {
    throw new Error('Only .md files are allowed');
  }
  const dir = await findBuiltinResourceDir(resourceType);
  return fs.readFile(path.join(dir, safeFileName), 'utf-8');
}

/**
 * Read assistant resource file with locale fallback
 */
export async function readAssistantResource(resourceType: ResourceType, assistantId: string, locale: string, fileNamePattern: (id: string, loc: string) => string): Promise<string> {
  const assistantsDir = getAssistantsDir();
  const locales = [locale, 'en-US', 'zh-CN'].filter((l, i, arr) => arr.indexOf(l) === i);

  // 1. Try user data directory first
  for (const loc of locales) {
    const fileName = fileNamePattern(assistantId, loc);
    try {
      return await fs.readFile(path.join(assistantsDir, fileName), 'utf-8');
    } catch {
      // Try next locale
    }
  }

  // 2. Fallback to builtin directory
  const builtinDir = await findBuiltinResourceDir(resourceType);
  for (const loc of locales) {
    const fileName = fileNamePattern(assistantId, loc);
    try {
      return await fs.readFile(path.join(builtinDir, fileName), 'utf-8');
    } catch {
      // Try next locale
    }
  }

  return '';
}
