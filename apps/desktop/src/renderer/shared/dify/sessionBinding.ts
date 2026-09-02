/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renderer-side helpers for wiring a chat session into the Dify enhancement
 * orchestrator running in the main process.
 *
 * The renderer is the only side that knows the SudoWork access token (it
 * lives in localStorage). At conversation creation / resume, the renderer
 * looks up the sudohub assistant UUID for the chosen assistant and forwards
 * both to the main process via `ipcBridge.dify.bindSession`.
 *
 * Once bound, AcpAgent.sendMessage transparently augments each user turn
 * with `<knowledge_context>` if the assistant has a Dify enhancement; for
 * non-enhanced assistants the binding is a no-op. The renderer therefore
 * doesn't need to know the enhancement mode — it just binds and forgets.
 */

import { ipcBridge } from '@/common';

const CONSUMER_AUTH_KEY = 'sudowork_auth_v2';
const ENTERPRISE_AUTH_KEY = 'eeclaw_auth_v1';

/**
 * Read the current SudoWork access token from localStorage. Returns `null`
 * if no token is stored (logged-out state) or the JSON is malformed.
 */
export function readAccessToken(): string | null {
  for (const key of [ENTERPRISE_AUTH_KEY, CONSUMER_AUTH_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { access_token?: string };
      if (parsed?.access_token) return parsed.access_token;
    } catch {
      // try next storage location
    }
  }
  return null;
}

/**
 * Resolve the sudohub assistant UUID from the local assistant directory name.
 *
 * `presetAssistantId` on a conversation is the directory key (e.g.
 * `recruitment_expert`), not the UUID. We fetch the meta file to recover the
 * UUID stored at `meta.id`. Returns `null` if the assistant is local-only
 * (no server id) or the meta lookup fails.
 */
export async function resolveSudohubAssistantId(presetAssistantIdOrName: string | undefined | null): Promise<string | null> {
  if (!presetAssistantIdOrName) return null;
  // 'builtin-*' prefix is added by toBackendConfig for system assistants;
  // strip it to get the directory name AssistantManager expects.
  const lookupName = presetAssistantIdOrName.startsWith('builtin-') ? presetAssistantIdOrName.slice('builtin-'.length) : presetAssistantIdOrName;
  try {
    const result = await ipcBridge.assistantHub.getAssistantMeta.invoke({ name: lookupName });
    if (!result?.success || !result.data) return null;
    return result.data.id || null;
  } catch {
    return null;
  }
}

/**
 * Bind a freshly-created or resumed conversation to its enhancement context.
 * Silently no-ops if any required piece is missing — never throws, never
 * blocks the chat from starting.
 */
export async function bindAssistantSession(args: { conversationId: string; presetAssistantIdOrName: string | undefined | null }): Promise<void> {
  if (!args.conversationId) return;
  const accessToken = readAccessToken();
  if (!accessToken) return;
  const assistantId = await resolveSudohubAssistantId(args.presetAssistantIdOrName);
  if (!assistantId) return;
  try {
    await ipcBridge.dify.bindSession.invoke({
      conversationId: args.conversationId,
      accessToken,
      assistantId,
    });
  } catch {
    // best-effort; main process will degrade gracefully when no binding exists
  }
}

/**
 * Tear down a binding when a conversation is deleted. Idempotent; calling
 * for a never-bound conversation is fine.
 */
export async function unbindAssistantSession(conversationId: string): Promise<void> {
  if (!conversationId) return;
  try {
    await ipcBridge.dify.unbindSession.invoke({ conversationId });
  } catch {
    // best-effort
  }
}
