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
import { ASSISTANT_SUBDIRS, ENTERPRISE_ASSISTANT_SUBDIRS } from '../constants/assistantStorage';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { mainWarn } from '@process/utils/mainLogger';

type ResourceType = 'rules' | 'skills';

export const ruleFilePattern = (id: string, loc: string) => `${id}.${loc}.md`;
export const skillFilePattern = (id: string, loc: string) => `${id}-skills.${loc}.md`;

/**
 * Map resource type to the file name used in the directory structure.
 * rules -> AGENT.md, skills -> SKILLS.md
 */
const resourceTypeToFile = (resourceType: ResourceType): string => {
  return resourceType === 'rules' ? 'AGENT.md' : 'SKILLS.md';
};

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
 * Read assistant resource file with directory-based priority search.
 *
 * Search order:
 * Enterprise mode: custom/{id} > hub/{id} > system/{strippedId}
 * Personal mode: _my-custom-assistant/{id} > _hub/{id} > _system/{strippedId}
 */
export async function readAssistantResource(resourceType: ResourceType, assistantId: string, locale: string, fileNamePattern: (id: string, loc: string) => string): Promise<string> {
  const fileName = resourceTypeToFile(resourceType);

  // 1. Try directory-based paths with priority: custom > hub > system - mode-aware
  const subdirs = isEnterpriseMode() ? { custom: ENTERPRISE_ASSISTANT_SUBDIRS.custom, hub: ENTERPRISE_ASSISTANT_SUBDIRS.hub, system: ENTERPRISE_ASSISTANT_SUBDIRS.system } : { custom: ASSISTANT_SUBDIRS.custom, hub: ASSISTANT_SUBDIRS.hub, system: ASSISTANT_SUBDIRS.system };

  const dirCandidates: string[] = [path.join(getAssistantsDir(), subdirs.custom, assistantId, fileName), path.join(getAssistantsDir(), subdirs.hub, assistantId, fileName)];

  // For builtin assistants (id starts with "builtin-"), strip prefix for system dir lookup
  const strippedId = assistantId.startsWith('builtin-') ? assistantId.slice('builtin-'.length) : assistantId;
  dirCandidates.push(path.join(getAssistantsDir(), subdirs.system, strippedId, fileName));
  // Also try with the full id in system/
  if (strippedId !== assistantId) {
    dirCandidates.push(path.join(getAssistantsDir(), subdirs.system, assistantId, fileName));
  }

  for (const candidate of dirCandidates) {
    try {
      return await fs.readFile(candidate, 'utf-8');
    } catch {
      // Try next
    }
  }

  // 2. Legacy flat file fallback (backward compat with pre-directory structure)
  const assistantsDir = getAssistantsDir();
  const locales = [locale, 'en-US', 'zh-CN'].filter((l, i, arr) => arr.indexOf(l) === i);

  for (const loc of locales) {
    const legacyFileName = fileNamePattern(assistantId, loc);
    try {
      return await fs.readFile(path.join(assistantsDir, legacyFileName), 'utf-8');
    } catch {
      // Try next locale
    }
  }

  // 3. Bundled fallback (builtin resource directory in app bundle)
  const builtinDir = await findBuiltinResourceDir(resourceType);
  for (const loc of locales) {
    const builtinFileName = fileNamePattern(assistantId, loc);
    try {
      return await fs.readFile(path.join(builtinDir, builtinFileName), 'utf-8');
    } catch {
      // Try next locale
    }
  }

  return '';
}
