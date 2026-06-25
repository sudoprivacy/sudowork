/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-conversation enhancement state, lazily probed on first use.
 *
 * This module exists so AcpAgent.sendMessage can stay almost unchanged: the
 * agent only calls `enhancementOrchestrator.augment(...)` when a session was
 * previously bound via `bindSession`. Sessions that never bind (or bind to
 * a non-enhanced assistant) get a no-op that returns the original content.
 *
 * Binding is initiated by the renderer right after creating a conversation,
 * via `ipcBridge.dify.bindSession`. The renderer carries the SudoWork JWT
 * (it lives in localStorage) and the sudohub `assistant_id` (UUID) — neither
 * of which AcpAgent has on its own.
 *
 * No external state survives a process restart: if the user reopens the
 * client mid-conversation, the renderer simply rebinds on first message.
 */

import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { augmentMessage, getEnhancementPromptSuffix, probeEnhancement, type EnhancementMeta } from './enhancement';

interface SessionBinding {
  accessToken: string;
  assistantId: string;
  /** lazily filled */
  meta?: EnhancementMeta;
  /** sticky Dify conversation id so multi-turn Dify state survives */
  difyConversationId?: string;
}

const SESSIONS = new Map<string, SessionBinding>();

export function bindSession(args: { conversationId: string; accessToken: string; assistantId: string }): void {
  if (!args.conversationId || !args.accessToken || !args.assistantId) {
    mainWarn('DifyEnhancementOrchestrator', 'bindSession called with missing fields; ignoring');
    return;
  }
  SESSIONS.set(args.conversationId, {
    accessToken: args.accessToken,
    assistantId: args.assistantId,
    meta: undefined,
    difyConversationId: undefined,
  });
  mainLog('DifyEnhancementOrchestrator', `bound conversation ${args.conversationId} → assistant ${args.assistantId}`);
}

export function unbindSession(conversationId: string): void {
  SESSIONS.delete(conversationId);
}

async function ensureMeta(binding: SessionBinding): Promise<EnhancementMeta> {
  if (binding.meta) return binding.meta;
  binding.meta = await probeEnhancement(binding.accessToken, binding.assistantId);
  return binding.meta;
}

/**
 * Append the enhancement prelude to a presetContext (.md content). Called
 * each turn after AcpAgent reloads the rules, so the local agent sees the
 * additional guidance about how to use <knowledge_context>.
 */
export async function enhancePresetContext(conversationId: string, presetContext: string): Promise<string> {
  const binding = SESSIONS.get(conversationId);
  if (!binding) return presetContext;
  const meta = await ensureMeta(binding);
  if (!meta.enabled) return presetContext;
  return presetContext + getEnhancementPromptSuffix(meta);
}

/**
 * Optionally wrap the user message with a `<knowledge_context>` block.
 * Returns the original message verbatim if:
 *   - the session was never bound
 *   - the bound assistant has no enhancement
 *   - the Dify call fails for any reason (graceful degrade)
 */
export async function augmentUserContent(conversationId: string, userContent: string, onProgress?: (step: string) => void): Promise<string> {
  const binding = SESSIONS.get(conversationId);
  if (!binding) return userContent;
  const meta = await ensureMeta(binding);
  if (!meta.enabled) return userContent;

  try {
    const result = await augmentMessage({
      accessToken: binding.accessToken,
      assistantId: binding.assistantId,
      meta,
      query: userContent,
      conversationId: binding.difyConversationId,
      onProgress,
    });
    if (!result) return userContent;
    return result.augmentedMessage;
  } catch (err) {
    mainWarn('DifyEnhancementOrchestrator', 'augment failed; passing through:', err);
    return userContent;
  }
}

export function isBound(conversationId: string): boolean {
  return SESSIONS.has(conversationId);
}
