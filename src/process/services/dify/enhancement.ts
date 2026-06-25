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
import { dify } from '@/common/ipcBridge';

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
  try {
    const resp = await dify.getEnhancement.invoke({ accessToken, assistantId });
    if (!resp.success || !resp.data) return { enabled: false };
    return resp.data as EnhancementMeta;
  } catch (err) {
    mainWarn('DifyEnhancement', 'probe failed; treating as disabled:', err);
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
 * The `onProgress` callback fires for workflow steps so the renderer can
 * render a `🟢 step name` row in the chat transcript while we wait.
 */
export async function augmentMessage(args: { accessToken: string; assistantId: string; meta: EnhancementMeta; query: string; conversationId?: string; onProgress?: (step: string) => void }): Promise<AugmentResult | null> {
  if (!args.meta.enabled || !args.meta.mode) return null;

  const mode = args.meta.mode;

  if (mode === 'workflow') {
    return runWorkflowAugment(args, mode);
  }
  return runBlockingAugment(args, mode);
}

async function runBlockingAugment(args: Parameters<typeof augmentMessage>[0], mode: EnhancementMode): Promise<AugmentResult | null> {
  const start = Date.now();
  const resp = await dify.invokeEnhancement.invoke({
    accessToken: args.accessToken,
    assistantId: args.assistantId,
    query: args.query,
    conversationId: args.conversationId,
  });
  if (!resp.success || !resp.data) {
    mainWarn('DifyEnhancement', `blocking invoke failed: ${resp.msg ?? 'unknown'}`);
    return null;
  }
  const text = resp.data.text ?? '';
  if (text.length === 0) return null;
  return {
    augmentedMessage: composeMessage(text, mode, args.query),
    injectedText: text,
    promptSuffix: ENHANCEMENT_PRELUDE[mode],
    mode,
    elapsedMs: resp.data.elapsedMs ?? Date.now() - start,
  };
}

async function runWorkflowAugment(args: Parameters<typeof augmentMessage>[0], mode: EnhancementMode): Promise<AugmentResult | null> {
  const start = await dify.startEnhancement.invoke({
    accessToken: args.accessToken,
    assistantId: args.assistantId,
    query: args.query,
    conversationId: args.conversationId,
  });
  if (!start.success || !start.data) {
    mainWarn('DifyEnhancement', `start workflow failed: ${start.msg ?? 'unknown'}`);
    return null;
  }
  const { streamId } = start.data;
  const begin = Date.now();

  return new Promise<AugmentResult | null>((resolve) => {
    let injected: { text: string; elapsedMs: number } | null = null;

    const onProgress = (evt: { streamId: string; step: string }) => {
      if (evt.streamId !== streamId) return;
      try {
        args.onProgress?.(evt.step);
      } catch (err) {
        mainWarn('DifyEnhancement', 'onProgress callback threw:', err);
      }
    };
    const onResult = (evt: { streamId: string; text: string; elapsedMs: number }) => {
      if (evt.streamId !== streamId) return;
      injected = { text: evt.text, elapsedMs: evt.elapsedMs };
    };
    const onEnd = (evt: { streamId: string; ok: boolean; error?: string }) => {
      if (evt.streamId !== streamId) return;
      // Detach listeners — IPC emitters expose `.off` symmetric to `.on` in
      // sudowork's bridge runtime; if the project uses a different teardown
      // primitive this will need adjustment when integrated.
      try {
        (dify.enhancementProgress as any).off?.(onProgress);
        (dify.enhancementResult as any).off?.(onResult);
        (dify.enhancementEnd as any).off?.(onEnd);
      } catch {
        /* best-effort cleanup */
      }
      if (!evt.ok || !injected) {
        mainWarn('DifyEnhancement', `workflow stream ended without result: ${evt.error ?? 'unknown'}`);
        resolve(null);
        return;
      }
      mainLog('DifyEnhancement', `workflow ${streamId} finished in ${injected.elapsedMs}ms`);
      resolve({
        augmentedMessage: composeMessage(injected.text, mode, args.query),
        injectedText: injected.text,
        promptSuffix: ENHANCEMENT_PRELUDE[mode],
        mode,
        elapsedMs: injected.elapsedMs || Date.now() - begin,
      });
    };

    dify.enhancementProgress.on(onProgress);
    dify.enhancementResult.on(onResult);
    dify.enhancementEnd.on(onEnd);
  });
}

function composeMessage(injected: string, mode: EnhancementMode, originalQuery: string): string {
  const block = `<knowledge_context source="enterprise_knowledge_agent" mode="${mode}">
${injected.trim()}
</knowledge_context>

${originalQuery}`;
  return block;
}
