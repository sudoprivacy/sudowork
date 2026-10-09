/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import type { TChatConversation } from '@sudowork/common/storage';
import type { ENTERPRISE_SKILL_SUBDIRS } from '@/process/constants/skillStorage';
import { MOSS_SKILL_META_FILE, SKILL_SUBDIRS } from '@/process/constants/skillStorage';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { normalizeSkillNames } from './conversationAssistantSkills';

const SKILL_HUB_META_FILE = '_sudowork_meta.json';

export function resolveConversationEnabledSkillNames(conversation?: TChatConversation, requestedSkillNames?: readonly string[]): Set<string> | undefined {
  const rawEnabledSkills = conversation?.extra?.enabledSkills;

  const normalizedEnabledSkills = normalizeSkillNames(rawEnabledSkills);
  const normalizedRequestedSkills = normalizeSkillNames(requestedSkillNames);

  if (!Array.isArray(rawEnabledSkills) && normalizedRequestedSkills.length === 0) {
    return undefined;
  }

  return new Set([...normalizedEnabledSkills, ...normalizedRequestedSkills]);
}

export async function listWorkspaceSkillTargets(
  skillsDir: string,
  allowedSkillNames?: ReadonlySet<string>,
  builtinSkillsDir = path.join(skillsDir, SKILL_SUBDIRS.system, SKILL_SUBDIRS.legacyBuiltin),
  layout: typeof SKILL_SUBDIRS | typeof ENTERPRISE_SKILL_SUBDIRS = SKILL_SUBDIRS
): Promise<Map<string, string>> {
  const startedAt = Date.now();
  const targets = new Map<string, string>();

  /**
   * Add a skill dir as a workspace symlink target.
   *
   * `forceBuiltin=true` marks the skill as auto-injected builtin. Such skills:
   *   1) are always treated as enabled regardless of meta `enabled` flag
   *   2) bypass the `allowedSkillNames` (per-assistant enabledSkills) filter
   *      so they surface in the workspace even when the active assistant has
   *      a non-empty explicit skill list — matching `AcpSkillManager.discoverBuiltinSkills()`
   *      auto-inject semantics for the LLM system prompt.
   */
  const addSkillDir = async (skillName: string, skillDir: string, forceBuiltin = false): Promise<void> => {
    try {
      const stat = await fs.stat(path.join(skillDir, 'SKILL.md'));
      if (!stat.isFile()) return;
    } catch {
      return;
    }

    let isBuiltin = forceBuiltin;
    let enabled = true;
    const isAutoInjected = forceBuiltin;

    const metadataFiles = 'tenant' in layout ? [MOSS_SKILL_META_FILE, SKILL_HUB_META_FILE] : [SKILL_HUB_META_FILE, MOSS_SKILL_META_FILE];
    for (const metadataFile of metadataFiles) {
      let meta: { is_builtin?: boolean; enabled?: boolean; name?: string; catalogManaged?: boolean };
      try {
        meta = JSON.parse(await fs.readFile(path.join(skillDir, metadataFile), 'utf-8'));
      } catch {
        continue;
      }
      if (meta.catalogManaged) {
        const { isCatalogPathVisible } = await import('@process/services/mossCatalogInstall');
        if (!(await isCatalogPathVisible(skillDir))) return;
      }
      if (meta.is_builtin !== undefined) {
        isBuiltin = meta.is_builtin === true;
      }
      if (!isBuiltin) {
        enabled = meta.enabled !== false;
      }
      if (typeof meta.name === 'string' && meta.name.trim()) {
        skillName = meta.name.trim();
      }
      break;
    }

    if (!isBuiltin && !enabled) {
      return;
    }

    // Auto-injected builtins (from `_system/_builtin/`) bypass the assistant-level
    // enabledSkills filter — they're always available, just like `cron`.
    if (!isAutoInjected && allowedSkillNames && !allowedSkillNames.has(skillName)) {
      return;
    }

    // Only set if not already present (first match wins = higher priority)
    if (!targets.has(skillName)) {
      targets.set(skillName, skillDir);
    }
  };

  // 扫描子目录（排除 _disable 目录）
  const scanDir = async (dir: string, forceBuiltin: boolean): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((): import('fs').Dirent[] => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // 跳过 _disable 目录（禁用技能）
      if (entry.name === '_disable') continue;
      await addSkillDir(entry.name, path.join(dir, entry.name), forceBuiltin);
    }
  };

  try {
    // Scan in priority order: custom > hub > _system/_builtin > system
    // For same-name skills, first match wins (higher priority).
    //
    // `_system/_builtin/` is scanned BEFORE `_system/` so that if an upgraded
    // install has a stale `_system/<skill>/` (from before the skill moved into
    // `_builtin/`), the new `_system/_builtin/<skill>/` wins — avoiding a
    // workspace symlink that points at the stale copy.
    await scanDir(path.join(skillsDir, layout.custom), false);
    await scanDir(path.join(skillsDir, layout.hub), false);
    if ('tenant' in layout) await scanDir(path.join(skillsDir, layout.tenant), false);
    await scanDir(builtinSkillsDir, true);
    await scanDir(path.join(skillsDir, layout.system), false);

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
