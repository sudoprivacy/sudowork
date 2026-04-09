/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw Prompts - System prompt injection for persistent mode
 *
 * This module orchestrates the injection of SudoClaw persistent-mode
 * instructions into `conversation.extra.presetContext`.
 *
 * The injection follows the same pattern used by preset assistants:
 *   1. Build the prompt string (system.ts + memory.ts)
 *   2. Set it on `conversation.extra.presetContext`
 *   3. The existing `prepareFirstMessageWithSkillsIndex()` in agentUtils.ts
 *      picks it up and wraps the first user message with
 *      `[Assistant Rules - You MUST follow these instructions]`
 *
 * @see docs/sudoclaw-mvp-plan.md - Section 1.6
 */

export { SUDOCLAW_SYSTEM_PROMPT, buildSudoclawSystemPrompt } from './system';
export { formatMemoryContext, getMemoryContext, DEFAULT_RECENT_LOG_COUNT } from './memory';
export type { MemoryLogEntry } from './memory';

import { buildSudoclawSystemPrompt } from './system';
import { getMemoryContext } from './memory';

/**
 * Build the complete SudoClaw presetContext string ready for injection
 * into `conversation.extra.presetContext`.
 *
 * This assembles:
 *   1. The SUDOCLAW_SYSTEM_PROMPT (tick behavior, tool descriptions, etc.)
 *   2. Recent memory log context (when available via #214)
 *
 * If the conversation already has a presetContext (e.g. from a preset assistant),
 * the caller should prepend the existing context before the SudoClaw addendum.
 *
 * @param existingPresetContext - Optional existing presetContext to preserve
 * @returns The full presetContext string for persistent mode
 */
export async function buildSudoclawPresetContext(existingPresetContext?: string): Promise<string> {
  const memoryContext = await getMemoryContext();
  const sudoclawPrompt = buildSudoclawSystemPrompt(memoryContext);

  if (existingPresetContext) {
    // Preserve existing preset assistant rules, append SudoClaw addendum
    return `${existingPresetContext}\n\n${sudoclawPrompt}`;
  }

  return sudoclawPrompt;
}

/**
 * Inject SudoClaw persistent-mode prompt into conversation extra.
 *
 * Mutates `conversationExtra.presetContext` in-place, following the same
 * pattern as `createAcpAgent` and `createOpenClawAgent` in initAgent.ts.
 *
 * This function is idempotent - calling it multiple times on the same
 * extra object will not duplicate the SudoClaw prompt (it checks for the
 * presence of the sentinel header "# SudoClaw Persistent Mode").
 *
 * @param conversationExtra - The `conversation.extra` object to mutate
 * @returns The updated presetContext string
 */
export async function injectSudoclawPrompt(
  conversationExtra: { presetContext?: string; [key: string]: unknown }
): Promise<string> {
  // Idempotency guard: skip if already injected
  if (conversationExtra.presetContext?.includes('# SudoClaw Persistent Mode')) {
    // Re-build only the memory portion (it may have new entries)
    const memoryContext = await getMemoryContext();
    if (memoryContext) {
      // Replace existing memory context section if present
      const memoryHeader = '## Recent Memory Context';
      const existingMemoryIdx = conversationExtra.presetContext.indexOf(memoryHeader);
      if (existingMemoryIdx !== -1) {
        const beforeMemory = conversationExtra.presetContext.substring(0, existingMemoryIdx);
        conversationExtra.presetContext = buildSudoclawSystemPrompt(memoryContext);
        // Preserve any rules that came before the SudoClaw block
        const sudoclawHeader = '# SudoClaw Persistent Mode';
        const sudoclawIdx = beforeMemory.indexOf(sudoclawHeader);
        if (sudoclawIdx > 0) {
          const existingRules = beforeMemory.substring(0, sudoclawIdx).trimEnd();
          conversationExtra.presetContext = `${existingRules}\n\n${conversationExtra.presetContext}`;
        }
      }
    }
    return conversationExtra.presetContext;
  }

  const presetContext = await buildSudoclawPresetContext(conversationExtra.presetContext);
  conversationExtra.presetContext = presetContext;
  return presetContext;
}
