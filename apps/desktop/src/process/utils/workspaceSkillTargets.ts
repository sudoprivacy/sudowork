/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import type { TChatConversation } from '@sudowork/common/storage';
import { SKILL_SUBDIRS } from '@/process/constants/skillStorage';
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

export async function listWorkspaceSkillTargets(skillsDir: string, allowedSkillNames?: ReadonlySet<string>): Promise<Map<string, string>> {
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

  try {
    // Scan in priority order: custom > hub > _system/_builtin > system
    // For same-name skills, first match wins (higher priority).
    //
    // `_system/_builtin/` is scanned BEFORE `_system/` so that if an upgraded
    // install has a stale `_system/<skill>/` (from before the skill moved into
    // `_builtin/`), the new `_system/_builtin/<skill>/` wins — avoiding a
    // workspace symlink that points at the stale copy.
    await scanSubdir(SKILL_SUBDIRS.custom, false);
    await scanSubdir(SKILL_SUBDIRS.hub, false);
    await scanSubdir(path.join(SKILL_SUBDIRS.system, SKILL_SUBDIRS.legacyBuiltin), true);
    await scanSubdir(SKILL_SUBDIRS.system, false);

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
