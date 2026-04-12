/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Preset Runtime Applier — main-process-only side effects for preset configuration.
 *
 * Handles: env var injection, scripts/ discovery, modelConfigs file writing.
 * For pure resolution logic, see common/presets/presetResolver.ts.
 */

import fs from 'fs';
import path from 'path';
import { assistantManager } from '@/process/AssistantManager';
import type { IAssistantMeta } from '@/process/constants/assistantStorage';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

export interface PresetRuntimeContext {
  presetAssistantId?: string;
  backend: string;
  workspace?: string;
  cdpPort: number;
}

export interface PresetRuntimeResult {
  /** Extra env vars to inject into the ACP process */
  envOverrides: Record<string, string>;
  /** Text to append to presetContext (e.g. auto-discovered scripts listing) */
  contextAppendix: string;
}

/**
 * Apply all preset-specific runtime configuration in one call.
 * Reads configuration from AssistantManager (filesystem SSOT).
 */
export async function applyPresetRuntime(ctx: PresetRuntimeContext): Promise<PresetRuntimeResult> {
  const result: PresetRuntimeResult = { envOverrides: {}, contextAppendix: '' };

  if (!ctx.presetAssistantId) return result;

  // Look up from AssistantManager (reads _sudowork_meta.json)
  const strippedId = ctx.presetAssistantId.startsWith('builtin-')
    ? ctx.presetAssistantId.slice('builtin-'.length)
    : ctx.presetAssistantId;
  const meta = await assistantManager.getAssistantMeta(strippedId);
  if (!meta) return result;

  return applyPresetRuntimeFromMeta(meta, ctx);
}

/**
 * Apply preset runtime from a pre-loaded IAssistantMeta.
 * Useful when the caller already has the meta (avoids redundant disk read).
 */
export function applyPresetRuntimeFromMeta(meta: IAssistantMeta, ctx: PresetRuntimeContext): PresetRuntimeResult {
  const result: PresetRuntimeResult = { envOverrides: {}, contextAppendix: '' };

  // 1. opsEntryPoint → AI_DEV_BROWSER_REDIRECT env var
  if (meta.opsEntryPoint) {
    const absOpsPath = path.resolve(meta.opsEntryPoint).replace(/\\/g, '/');
    result.envOverrides.AI_DEV_BROWSER_REDIRECT = `Direct tool access is disabled for this assistant. Use: python "${absOpsPath}" --port ${ctx.cdpPort} --op <tool_name> [args]`;
  }

  // 2. resourceDir/scripts/ → auto-append to context, plus resolved ops path
  if (meta.resourceDir) {
    result.contextAppendix = discoverScripts(meta.resourceDir);
  }
  if (meta.opsEntryPoint) {
    const absOpsPath = path.resolve(meta.opsEntryPoint).replace(/\\/g, '/');
    result.contextAppendix += `\n\n## Ops Entry Point\n\n\`\`\`\npython "${absOpsPath}" --port ${ctx.cdpPort} --op <name> [args]\n\`\`\`\n`;
  }

  // 3. modelConfigs → .gemini/settings.json
  if (ctx.backend === 'gemini' && meta.modelConfigs && ctx.workspace) {
    writeGeminiConfig(meta.modelConfigs, ctx.workspace);
  }

  return result;
}

/** Scan resourceDir/scripts/ and return markdown listing with absolute paths. */
function discoverScripts(resourceDir: string): string {
  try {
    const scriptsDir = path.resolve(resourceDir, 'scripts');
    const entries = fs.readdirSync(scriptsDir).filter((e) => e.endsWith('.py') || e.endsWith('.sh'));
    if (entries.length > 0) {
      const lines = entries.map((s) => `python ${path.join(scriptsDir, s)} --help`);
      return `\n\n## Available Scripts\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`;
    }
  } catch {
    // No scripts directory
  }
  return '';
}

/** Write modelConfigs to .gemini/settings.json for Gemini CLI. */
function writeGeminiConfig(modelConfigs: Record<string, unknown>, workspace: string): void {
  try {
    const geminiDir = path.join(workspace, '.gemini');
    if (!fs.existsSync(geminiDir)) {
      fs.mkdirSync(geminiDir, { recursive: true });
    }
    const settingsPath = path.join(geminiDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ modelConfigs }, null, 2));
    mainLog('[PresetRuntime]', `Wrote Gemini model config to ${settingsPath}`);
  } catch (error) {
    mainWarn('[PresetRuntime]', 'Failed to write Gemini model config:', error);
  }
}
