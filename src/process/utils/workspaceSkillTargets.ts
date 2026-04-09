/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import { SKILL_SUBDIRS } from '@/process/initStorage';
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

    // Only set if not already present (first match wins = higher priority)
    if (!targets.has(skillName)) {
      targets.set(skillName, skillDir);
    }
  };

  // 扫描子目录（排除 _disable 目录）
  const scanSubdir = async (subdirName: string, forceBuiltin: boolean): Promise<void> => {
    const dir = path.join(skillsDir, subdirName);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((): import('fs').Dirent[] => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // 跳过 _disable 目录（禁用技能）
      if (entry.name === '_disable') continue;
      await addSkillDir(entry.name, path.join(dir, entry.name), forceBuiltin);
    }
  };

  // 扫描 _system/_builtin 子目录
  const scanSystemBuiltinSubdir = async (): Promise<void> => {
    const builtinDir = path.join(skillsDir, SKILL_SUBDIRS.system, '_builtin');
    try {
      const entries = await fs.readdir(builtinDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '_disable') continue;
        await addSkillDir(entry.name, path.join(builtinDir, entry.name), true);
      }
    } catch {
      // 目录不存在，跳过
    }
  };

  try {
    // Scan in priority order: custom > hub > system
    // For same-name skills, first match wins (higher priority)
    await scanSubdir(SKILL_SUBDIRS.custom, false);
    await scanSubdir(SKILL_SUBDIRS.hub, false);
    await scanSubdir(SKILL_SUBDIRS.system, true);

    // 扫描 _system/_builtin/ 子目录（内置技能）
    await scanSystemBuiltinSubdir();

    // Legacy: scan _builtin/ for backward compatibility
    await scanSubdir(SKILL_SUBDIRS.legacyBuiltin, true);

    // Legacy: scan flat directories for backward compatibility
    const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch((): import('fs').Dirent[] => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
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
