/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Preset Runtime Resolver — SSOT for preset → runtime configuration mapping.
 *
 * Pure functions only (no fs, no IPC). Safe for both renderer and main process.
 * For main-process side effects (env injection, fs writes), see process/task/presetRuntime.ts.
 */

import { ASSISTANT_PRESETS, type AssistantPreset } from './assistantPresets';
import type { PresetAgentType } from '@/types/acpTypes';

// O(1) lookup map — built once at import time
const PRESET_MAP = new Map<string, AssistantPreset>(ASSISTANT_PRESETS.map((p) => [p.id, p]));

// Backend-specific session mode mapping for yolo/auto-approve
const YOLO_SESSION_MODES: Record<string, string> = {
  claude: 'bypassPermissions',
  codebuddy: 'bypassPermissions',
  gemini: 'yolo',
  codex: 'yolo',
  iflow: 'yolo',
  qwen: 'yolo',
};

/** O(1) lookup by preset ID. */
export function getPresetById(presetId: string): AssistantPreset | undefined {
  return PRESET_MAP.get(presetId);
}

/** Strip 'builtin-' prefix and lookup. Used by most consumers. */
export function getPresetByAgentId(customAgentId: string | undefined): AssistantPreset | undefined {
  if (!customAgentId?.startsWith('builtin-')) return undefined;
  return PRESET_MAP.get(customAgentId.replace('builtin-', ''));
}

/**
 * Resolve session mode from preset's defaultMode + current backend.
 *
 * When a preset has defaultMode: 'yolo' and the user hasn't manually changed the mode,
 * map to the backend-specific auto-approve mode (e.g. claude → 'bypassPermissions').
 */
export function resolveSessionMode(defaultMode: string | undefined, backend: string | undefined, selectedMode: string): string {
  if (selectedMode !== 'default') return selectedMode; // user explicitly set a mode
  if (defaultMode !== 'yolo') return selectedMode;
  return YOLO_SESSION_MODES[backend || ''] || 'yolo';
}

/**
 * Resolve rule file path for a given locale with fallback.
 */
export function resolveRuleFile(preset: AssistantPreset, locale: string): string | undefined {
  return preset.ruleFiles?.[locale] || preset.ruleFiles?.['en-US'];
}

/**
 * Resolve skill file path for a given locale with fallback.
 */
export function resolveSkillFile(preset: AssistantPreset, locale: string): string | undefined {
  return preset.skillFiles?.[locale] || preset.skillFiles?.['en-US'];
}

/**
 * Patch presetAgentType onto agent objects that match builtin presets.
 * Eliminates the duplicated patching loop in useGuidAgentSelection and AssistantManagement.
 */
export function patchPresetAgentTypes<T extends { id?: string; customAgentId?: string; presetAgentType?: string }>(agents: T[]): T[] {
  return agents.map((agent) => {
    const id = agent.customAgentId || agent.id;
    if (!id) return agent;
    const preset = getPresetByAgentId(id);
    if (preset?.presetAgentType) {
      return { ...agent, presetAgentType: preset.presetAgentType };
    }
    return agent;
  });
}
