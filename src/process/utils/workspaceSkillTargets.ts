/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import fs from 'fs/promises';
import path from 'path';

const SKILL_HUB_META_FILE = '_sudowork_meta.json';

export function resolveConversationEnabledSkillNames(conversation?: TChatConversation): Set<string> | undefined {
  const rawEnabledSkills = conversation?.extra?.enabledSkills;
  if (!Array.isArray(rawEnabledSkills)) {
    return undefined;
  }

  return new Set(
    rawEnabledSkills
      .filter((skill): skill is string => typeof skill === 'string')
      .map((skill) => skill.trim())
      .filter(Boolean)
  );
}

export async function listWorkspaceSkillTargets(skillsDir: string, allowedSkillNames?: ReadonlySet<string>): Promise<Map<string, string>> {
  const startedAt = Date.now();
  const targets = new Map<string, string>();

  const addSkillDir = async (skillName: string, skillDir: string, forceBuiltin = false): Promise<void> => {
    try {
      const stat = await fs.stat(path.join(skillDir, 'SKILL.md'));
      if (!stat.isFile()) return;
    } catch {
      return;
    }

    let isBuiltin = forceBuiltin;
    let enabled = true;

    try {
      const raw = await fs.readFile(path.join(skillDir, SKILL_HUB_META_FILE), 'utf-8');
      const meta = JSON.parse(raw) as { is_builtin?: boolean; enabled?: boolean; name?: string };
      if (meta.is_builtin !== undefined) {
        isBuiltin = meta.is_builtin === true;
      }
      if (!isBuiltin) {
        enabled = meta.enabled !== false;
      }
      if (typeof meta.name === 'string' && meta.name.trim()) {
        skillName = meta.name.trim();
      }
    } catch {
      // No metadata file: treat as enabled custom skill unless forced builtin.
    }

    if (!isBuiltin && !enabled) {
      return;
    }

    if (allowedSkillNames && !allowedSkillNames.has(skillName)) {
      return;
    }

    targets.set(skillName, skillDir);
  };

  try {
    const builtinDir = path.join(skillsDir, '_builtin');
    const builtinEntries = await fs.readdir(builtinDir, { withFileTypes: true }).catch((): import('fs').Dirent[] => []);
    for (const entry of builtinEntries) {
      if (!entry.isDirectory()) continue;
      await addSkillDir(entry.name, path.join(builtinDir, entry.name), true);
    }

    const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch((): import('fs').Dirent[] => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '_builtin') continue;
      await addSkillDir(entry.name, path.join(skillsDir, entry.name), false);
    }
  } catch (error) {
    mainWarn('ConversationSkillSync', 'Failed to list workspace skill targets', error);
  }

  mainLog('ConversationSkillSync', 'listWorkspaceSkillTargets completed', {
    count: targets.size,
    filtered: Boolean(allowedSkillNames),
    durationMs: Date.now() - startedAt,
  });
  return targets;
}
