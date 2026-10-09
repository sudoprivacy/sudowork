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

  if (!ctx.presetAssistantId) {
    mainLog('[PresetRuntime]', 'no presetAssistantId — skipping');
    return result;
  }

  // Look up from AssistantManager (reads _sudowork_meta.json). Use the
  // *WithDir variant so we get the assistant's real on-disk directory —
  // the relative `resourceDir` in the meta JSON is wrong once the assistant
  // is installed under hub/custom/system.
  const strippedId = ctx.presetAssistantId.startsWith('builtin-') ? ctx.presetAssistantId.slice('builtin-'.length) : ctx.presetAssistantId;
  const found = await assistantManager.getAssistantMetaWithDir(strippedId);
  if (!found) {
    mainWarn('[PresetRuntime]', `getAssistantMetaWithDir("${strippedId}") returned null — scripts/ context will be missing`);
    return result;
  }

  const applied = applyPresetRuntimeFromMeta(found.meta, ctx, found.dir);
  mainLog('[PresetRuntime]', `id=${strippedId} dir=${found.dir} contextAppendix=${applied.contextAppendix.length}B`);
  return applied;
}

/**
 * Resolve the assistant's `scripts/` directory.
 *
 * Prefers the real install directory (`installDir`) when known — that is
 * always correct regardless of where the assistant was installed. Falls back
 * to resolving the meta's relative `resourceDir` against CWD only when the
 * install directory is unavailable (legacy callers).
 */
function resolveScriptsDir(installDir: string | undefined, resourceDir: string | undefined): string | null {
  if (installDir) {
    return path.join(installDir, 'scripts');
  }
  if (resourceDir) {
    return path.resolve(resourceDir, 'scripts');
  }
  return null;
}

/**
 * Apply preset runtime from a pre-loaded IAssistantMeta.
 *
 * `installDir` is the assistant's resolved on-disk directory. When provided,
 * the assistant's `scripts/` are located under it (correct for hub / custom /
 * system installs). When omitted, paths fall back to the meta's relative
 * `resourceDir`, which only works when CWD happens to be the repo root.
 */
export function applyPresetRuntimeFromMeta(meta: IAssistantMeta, ctx: PresetRuntimeContext, installDir?: string): PresetRuntimeResult {
  const result: PresetRuntimeResult = { envOverrides: {}, contextAppendix: '' };

  // opsEntryPoint → AI_DEV_BROWSER_REDIRECT env var + context entry.
  // Prefer resolving it inside the assistant's install dir; fall back to a
  // CWD-relative resolve for entry points that live outside the assistant.
  let absOpsPath: string | null = null;
  if (meta.opsEntryPoint) {
    const candidates: string[] = [];
    if (installDir) {
      candidates.push(path.join(installDir, meta.opsEntryPoint));
    }
    candidates.push(path.resolve(meta.opsEntryPoint));
    absOpsPath = (candidates.find((p) => fs.existsSync(p)) ?? candidates[candidates.length - 1]).replace(/\\/g, '/');
  }

  if (absOpsPath) {
    result.envOverrides.AI_DEV_BROWSER_REDIRECT = `Direct tool access is disabled for this assistant. Use: python "${absOpsPath}" --port ${ctx.cdpPort} --op <tool_name> [args]`;
  }

  // scripts/ → auto-append an absolute-path listing to the context so the
  // assistant never has to `find` for its own scripts.
  const scriptsDir = resolveScriptsDir(installDir, meta.resourceDir);
  if (scriptsDir) {
    result.contextAppendix = discoverScripts(scriptsDir);
  }
  if (absOpsPath) {
    result.contextAppendix += `\n\n## Ops Entry Point\n\n\`\`\`\npython "${absOpsPath}" --port ${ctx.cdpPort} --op <name> [args]\n\`\`\`\n`;
  }

  // modelConfigs → .gemini/settings.json
  if (ctx.backend === 'gemini' && meta.modelConfigs && ctx.workspace) {
    writeGeminiConfig(meta.modelConfigs, ctx.workspace);
  }

  return result;
}

/** Scan a scripts directory and return a markdown listing with absolute paths. */
function discoverScripts(scriptsDir: string): string {
  try {
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
