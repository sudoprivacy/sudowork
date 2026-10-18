import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IResponseMessage } from '@sudowork/host-bridge/ipcBridge';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { transformMessage, type TMessage } from '@sudowork/common/chatLib';
import type { TokenUsageData } from '@sudowork/common/storage';
import type { ThoughtData } from '@renderer/components/ThoughtDisplay';
import { useAddOrUpdateMessage, useUpdateMessageList } from '@renderer/messages/hooks';
import { emitter } from '@renderer/utils/emitter';
import { shouldCancelAcpFinishTimeout } from './acpFinishTimeout';

const USER_CANCELLED_TEXT = '请求已被用户终止';

const isUserCancelledContent = (message: IResponseMessage): boolean => {
  return message.type === 'content' && message.data === USER_CANCELLED_TEXT;
};

export function useAcpMessage(conversation_id: string) {
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const updateMessageList = useUpdateMessageList();
  const [running, setRunning] = useState(false);
  const [thought, setThought] = useState<ThoughtData>({
    description: '',
    subject: '',
  });
  const [acpStatus, setAcpStatus] = useState<'connecting' | 'connected' | 'authenticated' | 'session_active' | 'disconnected' | 'error' | null>(null);
  const [aiProcessing, setAiProcessing] = useState(false); // New loading state for AI response
  const [tokenUsage, setTokenUsage] = useState<TokenUsageData | null>(null);
  const [contextLimit, setContextLimit] = useState<number>(0);
  const [processingStartTime, setProcessingStartTime] = useState<number | undefined>(undefined);

  // Use refs to sync state for immediate access in event handlers
  // 使用 ref 同步状态，以便在事件处理程序中立即访问
  const runningRef = useRef(running);
  const aiProcessingRef = useRef(aiProcessing);
  const stopPendingRef = useRef(false);
  const activeTurnStartTimeRef = useRef<number | undefined>(undefined);
  // Per-instance finish timeout (was a window global singleton that collided when multiple AcpSendBox
  // instances mounted — e.g. a team detail page with Leader + a teammate chat). 附录 A4 / 风险 10.
  const finishTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Track whether current turn has content output
  // Only reset aiProcessing when finish arrives after content (not after tool calls)
  const hasContentInTurnRef = useRef(false);

  // Track request trace state for displaying complete request lifecycle
  const requestTraceRef = useRef<{
    startTime: number;
    backend: string;
    modelId: string;
    sessionMode?: string;
  } | null>(null);

  // Think 消息节流：限制更新频率，减少渲染次数
  // Throttle thought updates to reduce render frequency. Think deltas arrive
  // incrementally, so pending accumulates description (subject follows the
  // latest delta) and each flush appends to the current thought state.
  const thoughtThrottleRef = useRef<{
    lastUpdate: number;
    pending: ThoughtData | null;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ lastUpdate: 0, pending: null, timer: null });

  const throttledSetThought = useMemo(() => {
    const THROTTLE_MS = 50;
    const flush = () => {
      const ref = thoughtThrottleRef.current;
      const pending = ref.pending;
      ref.pending = null;
      ref.lastUpdate = Date.now();
      if (pending) {
        setThought((prev) => ({ subject: pending.subject, description: (prev.description || '') + pending.description }));
      }
    };
    return (data: ThoughtData) => {
      const now = Date.now();
      const ref = thoughtThrottleRef.current;
      ref.pending = ref.pending ? { subject: data.subject, description: ref.pending.description + data.description } : { subject: data.subject, description: data.description };
      if (now - ref.lastUpdate >= THROTTLE_MS) {
        if (ref.timer) {
          clearTimeout(ref.timer);
          ref.timer = null;
        }
        flush();
      } else if (!ref.timer) {
        ref.timer = setTimeout(flush, THROTTLE_MS - (now - ref.lastUpdate));
      }
    };
  }, []);

  // 清理节流定时器
  useEffect(() => {
    return () => {
      if (thoughtThrottleRef.current.timer) {
        clearTimeout(thoughtThrottleRef.current.timer);
      }
    };
  }, []);

  // 添加一个 ref 来跟踪组件是否已挂载
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleResponseMessage = useCallback(
    (message: IResponseMessage) => {
      // 检查组件是否已挂载
      if (!isMountedRef.current) {
        return;
      }

      if (conversation_id !== message.conversation_id) {
        return;
      }

      // Cancel pending finish timeout if new message arrives
      // 如果真正的会话活动在 finish 后继续到达，取消待处理的 finish timeout
      const pendingTimeout = finishTimeoutRef.current;
      if (pendingTimeout && shouldCancelAcpFinishTimeout(message.type)) {
        clearTimeout(pendingTimeout);
        finishTimeoutRef.current = undefined;
      }

      // Handle clear_incomplete_tools before transformMessage (it's not a standard message type)
      // 在 transformMessage 之前处理 clear_incomplete_tools（它不是标准消息类型）
      if (message.type === 'clear_incomplete_tools') {
        // Clear all tool calls from message list (user cancelled)
        // 清理消息列表中所有工具调用（用户终止）
        updateMessageList((list) => {
          return list.filter((msg) => {
            // Remove all tool-related messages
            if (msg.type === 'acp_tool_call') return false;
            if (msg.type === 'codex_tool_call') return false;
            if (msg.type === 'tool_call') return false;
            return true;
          });
        });
        return;
      }

      let transformedMessage: TMessage | undefined;
      try {
        transformedMessage = transformMessage(message);
      } catch (error) {
        console.warn('[AcpSendBox] Ignoring unsupported response message', {
          conversation_id,
          type: message.type,
          error,
        });
        return;
      }
      switch (message.type) {
        case 'thought':
          if (stopPendingRef.current) {
            break;
          }
          // Auto-recover running/aiProcessing state if thought arrives after finish
          // 如果 thought 在 finish 后到达，自动恢复 running/aiProcessing 状态
          if (!runningRef.current) {
            setRunning(true);
            runningRef.current = true;
          }
          if (!aiProcessingRef.current) {
            setAiProcessing(true);
            aiProcessingRef.current = true;
          }
          throttledSetThought(message.data as ThoughtData);
          // Also stream the reasoning block into the message list (collapsed display)
          // 同时把思考内容写入消息列表（折叠展示）
          if (transformedMessage) {
            addOrUpdateMessage(transformedMessage);
          }
          break;
        case 'start':
          stopPendingRef.current = false;
          {
            const startData = message.data as { processingStartTime?: number } | null;
            const startTime = startData?.processingStartTime ?? activeTurnStartTimeRef.current ?? Date.now();
            activeTurnStartTimeRef.current = startTime;
            setProcessingStartTime(startTime);
          }
          setRunning(true);
          runningRef.current = true;
          // Activate aiProcessing when AI starts responding
          // AI 开始响应时激活 aiProcessing
          if (!aiProcessingRef.current) {
            setAiProcessing(true);
            aiProcessingRef.current = true;
          }
          break;
        case 'finish':
          console.log('[AcpSendBox] Processing finish message');
          {
            // Use delayed reset to detect true end of task
            // 使用延迟重置来检测任务的真正结束
            const timeoutId = setTimeout(() => {
              if (isMountedRef.current) {
                setRunning(false);
                runningRef.current = false;
                setAiProcessing(false);
                aiProcessingRef.current = false;
                setThought({ subject: '', description: '' });
                setProcessingStartTime(undefined);
              }
              finishTimeoutRef.current = undefined;
            }, 1000);
            finishTimeoutRef.current = timeoutId;
            hasContentInTurnRef.current = false;
            // Log request completion
            if (requestTraceRef.current) {
              requestTraceRef.current = null;
            }
          }
          break;
        case 'content':
          if (isUserCancelledContent(message)) {
            setRunning(false);
            runningRef.current = false;
            setAiProcessing(false);
            aiProcessingRef.current = false;
            setThought({ subject: '', description: '' });
            setProcessingStartTime(undefined);
            activeTurnStartTimeRef.current = undefined;
            hasContentInTurnRef.current = false;
            stopPendingRef.current = false;
            addOrUpdateMessage(transformedMessage);
            break;
          }
          if (stopPendingRef.current) {
            break;
          }
          // Mark that current turn has content output
          hasContentInTurnRef.current = true;
          // Auto-recover running/aiProcessing state if content arrives after finish
          if (!runningRef.current) {
            setRunning(true);
            runningRef.current = true;
          }
          if (!aiProcessingRef.current) {
            setAiProcessing(true);
            aiProcessingRef.current = true;
          }
          // Clear thought when final answer arrives
          setThought({ subject: '', description: '' });
          addOrUpdateMessage(transformedMessage);
          break;
        case 'agent_status': {
          if (stopPendingRef.current) {
            break;
          }
          // Transport readiness is independent of an active turn.
          const agentData = message.data as {
            status?: 'connecting' | 'connected' | 'authenticated' | 'session_active' | 'disconnected' | 'error';
            backend?: string;
          };
          if (isMountedRef.current && agentData?.status) {
            setAcpStatus(agentData.status);
            emitter.emit('agent.connection.status', conversation_id, agentData.status);
            // Reset all loading states on error or disconnect so UI doesn't stay stuck
            if (['error', 'disconnected'].includes(agentData.status)) {
              setRunning(false);
              runningRef.current = false;
              setAiProcessing(false);
              aiProcessingRef.current = false;
            }
          }
          break;
        }
        case 'user_content':
          addOrUpdateMessage(transformedMessage);
          break;
        case 'acp_permission':
          if (stopPendingRef.current) {
            break;
          }
          // Auto-recover running/aiProcessing state if permission request arrives after finish
          if (!runningRef.current) {
            setRunning(true);
            runningRef.current = true;
          }
          if (!aiProcessingRef.current) {
            setAiProcessing(true);
            aiProcessingRef.current = true;
          }
          addOrUpdateMessage(transformedMessage);
          break;
        case 'acp_model_info':
          // Model info updates are handled by AcpModelSelector, no action needed here
          break;
        case 'acp_context_usage': {
          const usageData = message.data as { used: number; size: number };
          if (isMountedRef.current && usageData && typeof usageData.used === 'number') {
            setTokenUsage({ totalTokens: usageData.used });
            if (usageData.size > 0) {
              setContextLimit(usageData.size);
            }
          }
          break;
        }
        case 'request_trace':
          {
            const trace = message.data as Record<string, unknown>;
            const timestamp = Number(trace.timestamp) || Date.now();
            requestTraceRef.current = {
              startTime: timestamp,
              backend: String(trace.backend || 'unknown'),
              modelId: String(trace.modelId || 'unknown'),
              sessionMode: trace.sessionMode as string | undefined,
            };
            if (!stopPendingRef.current) {
              setProcessingStartTime(timestamp);
            }
          }
          break;
        case 'error':
          // Stop all loading states when error occurs
          if (isMountedRef.current) {
            setRunning(false);
            runningRef.current = false;
            setAiProcessing(false);
            aiProcessingRef.current = false;
            setProcessingStartTime(undefined);
            activeTurnStartTimeRef.current = undefined;
            setThought({ subject: '', description: '' });
          }
          addOrUpdateMessage(transformedMessage);
          // Log request error
          if (requestTraceRef.current) {
            requestTraceRef.current = null;
          }
          break;
        default:
          if (stopPendingRef.current) {
            break;
          }
          // Only turn activity can reactivate execution. Late tips and usage
          // metadata may still update the transcript after a request ends.
          if (!runningRef.current && shouldCancelAcpFinishTimeout(message.type)) {
            setRunning(true);
            runningRef.current = true;
          }
          addOrUpdateMessage(transformedMessage);
          break;
      }
    },
    [conversation_id, addOrUpdateMessage, throttledSetThought, setThought, setRunning, setAiProcessing, setAcpStatus, setTokenUsage, setContextLimit, isMountedRef]
  );

  useEffect(() => {
    return ipcBridge.acpConversation.responseStream.on(handleResponseMessage);
  }, [handleResponseMessage]);

  // Reset state when conversation changes and restore actual running status
  useEffect(() => {
    // Clear pending finish timeout when conversation changes
    const pendingTimeout = finishTimeoutRef.current;
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      finishTimeoutRef.current = undefined;
    }

    setThought({ subject: '', description: '' });
    setAcpStatus(null);
    setTokenUsage(null);
    setContextLimit(0);
    hasContentInTurnRef.current = false;
    stopPendingRef.current = false;

    // Check actual conversation status from backend before resetting running/aiProcessing
    // to avoid flicker when switching to a running conversation
    // 先获取后端状态再重置 running/aiProcessing，避免切换到运行中的会话时闪烁
    void ipcBridge.conversation.get.invoke({ id: conversation_id }).then((res) => {
      if (!res) {
        setRunning(false);
        runningRef.current = false;
        setAiProcessing(false);
        aiProcessingRef.current = false;
        setProcessingStartTime(undefined);
        return;
      }
      const isRunning = res.status === 'running';
      // Use the cached processing state to determine if it's running
      // If we have a processingStartTime from backend, it implies the task is processing
      const isEffectivelyRunning = isRunning || res.processingStartTime !== undefined;

      setRunning(isEffectivelyRunning);
      runningRef.current = isEffectivelyRunning;
      setAiProcessing(isEffectivelyRunning);
      aiProcessingRef.current = isEffectivelyRunning;

      // Restore processingStartTime for timer restoration
      // 恢复 processingStartTime 用于计时器恢复
      if (res.processingStartTime) {
        setProcessingStartTime(res.processingStartTime);
      } else {
        setProcessingStartTime(undefined);
      }

      // Restore persisted context usage data
      if (res.type === 'acp' && res.extra?.lastTokenUsage) {
        const { lastTokenUsage, lastContextLimit } = res.extra;
        if (lastTokenUsage.totalTokens > 0) {
          setTokenUsage(lastTokenUsage);
        }
        if (lastContextLimit && lastContextLimit > 0) {
          setContextLimit(lastContextLimit);
        }
      }
    });
  }, [conversation_id]);

  const clearRuntimeState = useCallback(() => {
    // Clear pending finish timeout
    const pendingTimeout = finishTimeoutRef.current;
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      finishTimeoutRef.current = undefined;
    }

    setRunning(false);
    runningRef.current = false;
    setAiProcessing(false);
    aiProcessingRef.current = false;
    setThought({ subject: '', description: '' });
    setProcessingStartTime(undefined);
    activeTurnStartTimeRef.current = undefined;
    hasContentInTurnRef.current = false;
  }, []);

  const resetState = useCallback(() => {
    clearRuntimeState();
    stopPendingRef.current = false;
  }, [clearRuntimeState]);

  const beginStop = useCallback(() => {
    stopPendingRef.current = true;
    clearRuntimeState();
  }, [clearRuntimeState]);

  const endStop = useCallback(() => {
    stopPendingRef.current = false;
  }, []);

  const beginProcessing = useCallback((startTime = Date.now()) => {
    stopPendingRef.current = false;
    activeTurnStartTimeRef.current = startTime;
    setProcessingStartTime(startTime);
    setRunning(true);
    runningRef.current = true;
    setAiProcessing(true);
    aiProcessingRef.current = true;
  }, []);

  return { thought, running, acpStatus, aiProcessing, resetState, tokenUsage, contextLimit, processingStartTime, beginStop, endStop, beginProcessing, finishTimeoutRef };
}
