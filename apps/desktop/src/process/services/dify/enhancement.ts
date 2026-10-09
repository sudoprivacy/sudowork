/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pre-injection helper: wrap a user message with a `<knowledge_context>`
 * block sourced from the Dify enhancement layer.
 *
 * Why a helper module instead of inlining at the call site: the ACP runner
 * needs to call this synchronously before forwarding the message, and the
 * decision tree (no enhancement → return as-is; blocking → call invoke;
 * workflow → start stream + await result) is non-trivial. Concentrating it
 * here keeps `AcpAgent` clean.
 */

import { mainLog, mainWarn } from '@process/utils/mainLogger';
// Direct main-process helpers — we MUST NOT route these calls through the
// `dify.*` IPC bridge from here because the bridge's adapter only broadcasts
// to renderer windows (not back to main). The main-side provider would never
// fire and the Promise would hang. See difyBridge.ts:callGetEnhancement.
import { callGetEnhancement, callInvokeEnhancement, callStartEnhancementStream } from '@process/bridge/difyBridge';

export type EnhancementMode = 'agent-chat' | 'workflow' | 'rag-only';

/**
 * Guidance text appended to the assistant's system prompt (.md) when
 * enhancement is active. Tuned per mode to communicate the right priority
 * order to the local agent.
 */
const ENHANCEMENT_PRELUDE: Record<EnhancementMode, string> = {
  'rag-only': `

---

你的对话中会出现 <knowledge_context> 块，它来自企业知识库的检索结果。优先使用本地工具/技能解决用户问题；当本地能力不足以覆盖时，再参考该上下文，并在引用具体内容时尽量保留来源信息。`,

  workflow: `

---

你的对话中会出现 <knowledge_context> 块，它来自一条企业固化工作流的执行结果。优先使用本地工具/技能；当用户的请求恰好与该工作流匹配时，直接采用其结果并按你的人格风格输出。`,

  'agent-chat': `

---

你的对话中会出现 <knowledge_context> 块，它是企业知识助手（具备 RAG 与工具调用能力）对相同问题的回答。**本地技能优先**：当本地工具足以解决问题时直接使用本地工具；只有本地能力无法覆盖时再吸收 <knowledge_context> 的信息综合作答。不要逐字复述上下文，按你自己的人格重新组织。`,
};

export interface EnhancementMeta {
  enabled: boolean;
  mode?: EnhancementMode;
}

export interface AugmentResult {
  augmentedMessage: string;
  injectedText: string;
  promptSuffix: string;
  mode: EnhancementMode;
  elapsedMs: number;
}

/**
 * Probe the enhancement state for an assistant. Returns `{enabled: false}` if
 * the assistant has no Dify binding, the server is unreachable, etc. Callers
 * should treat any failure as "no enhancement" — pre-injection is a strict
 * enhancement, never a requirement.
 */
export async function probeEnhancement(accessToken: string, assistantId: string): Promise<EnhancementMeta> {
  const t0 = Date.now();
  mainLog('DifyEnhancement', `probe start assistantId=${assistantId}`);
  try {
    const resp = await callGetEnhancement(accessToken, assistantId);
    if (!resp.success || !resp.data) {
      mainLog('DifyEnhancement', `probe done in ${Date.now() - t0}ms → disabled (success=${resp.success}, msg=${resp.msg ?? '∅'})`);
      return { enabled: false };
    }
    const meta = resp.data as EnhancementMeta;
    mainLog('DifyEnhancement', `probe done in ${Date.now() - t0}ms → enabled=${meta.enabled} mode=${meta.mode ?? '∅'}`);
    return meta;
  } catch (err) {
    mainWarn('DifyEnhancement', `probe failed in ${Date.now() - t0}ms; treating as disabled:`, err);
    return { enabled: false };
  }
}

/**
 * Pull the prompt suffix that should be appended to the assistant's
 * system prompt (.md) when the session begins. Returns empty string when
 * enhancement is disabled, so callers can blindly concatenate.
 */
export function getEnhancementPromptSuffix(meta: EnhancementMeta): string {
  if (!meta.enabled || !meta.mode) return '';
  return ENHANCEMENT_PRELUDE[meta.mode] ?? '';
}

/**
 * Augment a user message by calling Dify and prepending its output as a
 * knowledge_context block. For `workflow` mode we open the streaming
 * endpoint so we can surface per-node progress to the renderer; otherwise we
 * use the blocking endpoint.
 *
 * `query` is what we send to Dify as the user's question — keep it small and
 * semantically clean (the raw user text, not the scode system prompt). If
 * `finalMessage` is supplied, the returned `augmentedMessage` will be
 * `<knowledge_context>${dify_text}</knowledge_context>\n\n${finalMessage}` —
 * this is how AcpAgent layers the Dify result on top of the fully-wrapped
 * scode message (preset rules + identity override + file intent marking
 * etc.). Without `finalMessage` we fall back to wrapping `query` itself,
 * which matches the original single-argument behavior.
 *
 * The `onProgress` callback fires for workflow steps so the renderer can
 * render a `🟢 step name` row in the chat transcript while we wait.
 */
export async function augmentMessage(args: { accessToken: string; assistantId: string; meta: EnhancementMeta; query: string; finalMessage?: string; conversationId?: string; onProgress?: (step: string) => void }): Promise<AugmentResult | null> {
  if (!args.meta.enabled || !args.meta.mode) return null;

  const mode = args.meta.mode;

  if (mode === 'workflow') {
    return runWorkflowAugment(args, mode);
  }
  return runBlockingAugment(args, mode);
}

async function runBlockingAugment(args: Parameters<typeof augmentMessage>[0], mode: EnhancementMode): Promise<AugmentResult | null> {
  const start = Date.now();
  mainLog('DifyEnhancement', `blocking invoke start mode=${mode} assistantId=${args.assistantId} queryLen=${args.query.length} finalMessageLen=${args.finalMessage?.length ?? 0}`);
  const resp = await callInvokeEnhancement({
    accessToken: args.accessToken,
    assistantId: args.assistantId,
    query: args.query,
    conversationId: args.conversationId,
  });
  if (!resp.success || !resp.data) {
    mainWarn('DifyEnhancement', `blocking invoke failed in ${Date.now() - start}ms: ${resp.msg ?? 'unknown'}`);
    return null;
  }
  const text = resp.data.text ?? '';
  if (text.length === 0) {
    mainLog('DifyEnhancement', `blocking invoke returned empty text in ${Date.now() - start}ms — skipping augment`);
    return null;
  }
  mainLog('DifyEnhancement', `blocking invoke done in ${Date.now() - start}ms textLen=${text.length}`);
  return {
    augmentedMessage: composeMessage(text, mode, args.finalMessage ?? args.query),
    injectedText: text,
    promptSuffix: ENHANCEMENT_PRELUDE[mode],
    mode,
    elapsedMs: resp.data.elapsedMs ?? Date.now() - start,
  };
}

async function runWorkflowAugment(args: Parameters<typeof augmentMessage>[0], mode: EnhancementMode): Promise<AugmentResult | null> {
  const begin = Date.now();
  mainLog('DifyEnhancement', `workflow stream start mode=${mode} assistantId=${args.assistantId} queryLen=${args.query.length} finalMessageLen=${args.finalMessage?.length ?? 0}`);

  // Direct call — see `callStartEnhancementStream` for why the original
  // event-based path via `dify.startEnhancement.invoke` + `dify.enhancement*`
  // listeners cannot work from the main process (the IPC bridge's adapter
  // only broadcasts events to renderer windows, never back to main, so the
  // Promise + listeners would hang forever exactly the way blocking mode
  // used to hang before we added `callGetEnhancement`).
  const resp = await callStartEnhancementStream({
    accessToken: args.accessToken,
    assistantId: args.assistantId,
    query: args.query,
    conversationId: args.conversationId,
    onProgress: (step) => {
      try {
        args.onProgress?.(step);
      } catch (err) {
        mainWarn('DifyEnhancement', 'workflow onProgress callback threw:', err);
      }
    },
  });
  if (!resp.success || !resp.data) {
    mainWarn('DifyEnhancement', `workflow stream failed in ${Date.now() - begin}ms: ${resp.msg ?? 'unknown'}`);
    return null;
  }
  const text = resp.data.text;
  if (text.length === 0) {
    mainLog('DifyEnhancement', `workflow stream returned empty text in ${Date.now() - begin}ms — skipping augment`);
    return null;
  }
  const elapsedMs = resp.data.elapsedMs || Date.now() - begin;
  mainLog('DifyEnhancement', `workflow stream done in ${elapsedMs}ms textLen=${text.length}`);
  return {
    augmentedMessage: composeMessage(text, mode, args.finalMessage ?? args.query),
    injectedText: text,
    promptSuffix: ENHANCEMENT_PRELUDE[mode],
    mode,
    elapsedMs,
  };
}

function composeMessage(injected: string, mode: EnhancementMode, userContentForAssistant: string): string {
  // `userContentForAssistant` is whatever AcpAgent built for the local agent
  // (identity override + preset rules + file intent marking + user typed
  // text). The Dify-side `injected` text is the RAG / Agent / Workflow
  // result keyed off the *raw* user query — see `augmentMessage` docstring
  // for why we don't want the scode system prompt pollution to also leak
  // into the Dify query.
  const block = `<knowledge_context source="enterprise_knowledge_agent" mode="${mode}">
${injected.trim()}
</knowledge_context>

${userContentForAssistant}`;
  return block;
}
