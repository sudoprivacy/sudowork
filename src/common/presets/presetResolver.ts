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
 *
 * The registry is populated at runtime:
 * - Main process: after initBuiltinAssistantRules via registerAssistantMetas()
 * - Renderer: after assistantHub.getInstalledAssistants via registerAssistantMetas()
 */

import type { IAssistantMeta } from '@/process/constants/assistantStorage';

// Runtime-populated registry — replaces the old ASSISTANT_PRESETS constant
const presetRegistry = new Map<string, IAssistantMeta>();

// Backend-specific session mode mapping for yolo/auto-approve
const YOLO_SESSION_MODES: Record<string, string> = {
  claude: 'bypassPermissions',
  codebuddy: 'bypassPermissions',
  gemini: 'yolo',
  codex: 'yolo',
  iflow: 'yolo',
  qwen: 'yolo',
};

/**
 * Populate the preset registry with assistant metadata.
 * Called once at startup (main process) and whenever assistants are refreshed (renderer).
 */
export function registerAssistantMetas(metas: IAssistantMeta[]): void {
  presetRegistry.clear();
  for (const meta of metas) {
    if (meta.id) {
      presetRegistry.set(meta.id, meta);
    }
  }
}

/** O(1) lookup by preset ID (e.g. 'copilot'). */
export function getPresetById(presetId: string): IAssistantMeta | undefined {
  return presetRegistry.get(presetId);
}

/** Strip 'builtin-' prefix and lookup. Used by most consumers. */
export function getPresetByAgentId(customAgentId: string | undefined): IAssistantMeta | undefined {
  if (!customAgentId?.startsWith('builtin-')) return undefined;
  return presetRegistry.get(customAgentId.replace('builtin-', ''));
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
