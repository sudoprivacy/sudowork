import { ipcBridge } from '@/common';
import type { AcpBackend } from '@/types/acpTypes';
import { transformMessage, type TMessage } from '@/common/chatLib';
import type { IResponseMessage } from '@/common/ipcBridge';
import { uuid } from '@/common/utils';
import SendBox from '@/renderer/components/sendbox';
import ThoughtDisplay, { type ThoughtData } from '@/renderer/components/ThoughtDisplay';
import { getSendBoxDraftHook, type FileOrFolderItem } from '@/renderer/hooks/useSendBoxDraft';
import { createSetUploadFile, useSendBoxFiles } from '@/renderer/hooks/useSendBoxFiles';
import { useAddOrUpdateMessage, useUpdateMessageList } from '@/renderer/messages/hooks';
import { allSupportedExts } from '@/renderer/services/FileService';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { mergeFileSelectionItems } from '@/renderer/utils/fileSelection';
import { Button, Dropdown, Menu, Message, Tag } from '@arco-design/web-react';
import { Plus, Shield, UploadOne } from '@icon-park/react';
import { iconColors } from '@/renderer/theme/colors';
import BdpanLogo from '@/renderer/assets/logos/bdpan.png';
import BdpanFileSelector from '@/renderer/components/BdpanFileSelector';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FilePreview from '@/renderer/components/FilePreview';
import HorizontalFileList from '@/renderer/components/HorizontalFileList';
import { usePreviewContext } from '@/renderer/pages/conversation/preview';
import { useLatestRef } from '@/renderer/hooks/useLatestRef';
import { useOpenFileSelector } from '@/renderer/hooks/useOpenFileSelector';
import PwdLoginApprovalModal, { type PwdLoginApprovalDecision } from '@/renderer/components/PwdLoginApprovalModal';
import type { TokenUsageData } from '@/common/storage';
import ContextUsageIndicator from '@/renderer/components/ContextUsageIndicator';
import { useAutoTitle } from '@/renderer/hooks/useAutoTitle';
import AgentModeSelector from '@/renderer/components/AgentModeSelector';
import AcpConfigSelector from '@/renderer/components/AcpConfigSelector';
import { useSlashCommands } from '@/renderer/hooks/useSlashCommands';
import { filterUserVisibleAtPath, filterUserVisibleFiles } from '@/renderer/utils/messageFiles';
import { useWorkspaceFiles } from '@/renderer/hooks/useWorkspaceFiles';
import { shouldCancelAcpFinishTimeout } from './acpFinishTimeout';

const useAcpSendBoxDraft = getSendBoxDraftHook('acp', {
  _type: 'acp',
  atPath: [],
  content: '',
  uploadFile: [],
  selectedSkills: [],
});

const useAcpMessage = (conversation_id: string) => {
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
  // Throttle thought updates to reduce render frequency
  const thoughtThrottleRef = useRef<{
    lastUpdate: number;
    pending: ThoughtData | null;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ lastUpdate: 0, pending: null, timer: null });

  const throttledSetThought = useMemo(() => {
    const THROTTLE_MS = 50;
    return (data: ThoughtData) => {
      const now = Date.now();
      const ref = thoughtThrottleRef.current;
      if (now - ref.lastUpdate >= THROTTLE_MS) {
        ref.lastUpdate = now;
        ref.pending = null;
        if (ref.timer) {
          clearTimeout(ref.timer);
          ref.timer = null;
        }
        setThought(data);
      } else {
        ref.pending = data;
        if (!ref.timer) {
          ref.timer = setTimeout(
            () => {
              ref.lastUpdate = Date.now();
              ref.timer = null;
              if (ref.pending) {
                setThought(ref.pending);
                ref.pending = null;
              }
            },
            THROTTLE_MS - (now - ref.lastUpdate)
          );
        }
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
      const pendingTimeout = (window as unknown as { __acpFinishTimeout?: ReturnType<typeof setTimeout> }).__acpFinishTimeout;
      if (pendingTimeout && shouldCancelAcpFinishTimeout(message.type)) {
        clearTimeout(pendingTimeout);
        (window as unknown as { __acpFinishTimeout?: ReturnType<typeof setTimeout> }).__acpFinishTimeout = undefined;
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
              (window as unknown as { __acpFinishTimeout?: ReturnType<typeof setTimeout> }).__acpFinishTimeout = undefined;
            }, 1000);
            (window as unknown as { __acpFinishTimeout?: ReturnType<typeof setTimeout> }).__acpFinishTimeout = timeoutId;
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
          // Auto-recover running state if agent_status arrives after finish
          if (!runningRef.current) {
            setRunning(true);
            runningRef.current = true;
          }
          // Update ACP/Agent status
          const agentData = message.data as {
            status?: 'connecting' | 'connected' | 'authenticated' | 'session_active' | 'disconnected' | 'error';
            backend?: string;
          };
          if (isMountedRef.current && agentData?.status) {
            setAcpStatus(agentData.status);
            emitter.emit('agent.connection.status', conversation_id, agentData.status);
            // Reset running state when authentication is complete
            if (['authenticated', 'session_active'].includes(agentData.status)) {
              setRunning(false);
              runningRef.current = false;
            }
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
          // Auto-recover running state if other messages arrive after finish
          if (!runningRef.current) {
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
    const pendingTimeout = (window as unknown as { __acpFinishTimeout?: ReturnType<typeof setTimeout> }).__acpFinishTimeout;
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      (window as unknown as { __acpFinishTimeout?: ReturnType<typeof setTimeout> }).__acpFinishTimeout = undefined;
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
    const pendingTimeout = (window as unknown as { __acpFinishTimeout?: ReturnType<typeof setTimeout> }).__acpFinishTimeout;
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      (window as unknown as { __acpFinishTimeout?: ReturnType<typeof setTimeout> }).__acpFinishTimeout = undefined;
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

  return { thought, running, acpStatus, aiProcessing, resetState, tokenUsage, contextLimit, processingStartTime, beginStop, endStop, beginProcessing };
};

const EMPTY_AT_PATH: Array<string | FileOrFolderItem> = [];
const EMPTY_UPLOAD_FILES: string[] = [];
const USER_CANCELLED_TEXT = '请求已被用户终止';

const isUserCancelledContent = (message: IResponseMessage): boolean => {
  return message.type === 'content' && message.data === USER_CANCELLED_TEXT;
};

const useSendBoxDraft = (conversation_id: string) => {
  const { data, mutate } = useAcpSendBoxDraft(conversation_id);
  const atPath = data?.atPath ?? EMPTY_AT_PATH;
  const uploadFile = data?.uploadFile ?? EMPTY_UPLOAD_FILES;
  const content = data?.content ?? '';
  const selectedSkills = data?.selectedSkills ?? [];
  const setSelectedSkills = useCallback(
    (skills: string[] | ((prev: string[]) => string[])) => {
      mutate((prev) => {
        const previousSkills = prev?.selectedSkills ?? [];
        const nextSkills = typeof skills === 'function' ? skills(previousSkills) : skills;
        return { ...prev!, selectedSkills: nextSkills };
      });
    },
    [mutate]
  );

  const setAtPath = useCallback(
    (atPath: Array<string | FileOrFolderItem>) => {
      mutate((prev) => ({ ...prev, atPath }));
    },
    [data, mutate]
  );

  const setUploadFile = createSetUploadFile(mutate, data);

  const setContent = useCallback(
    (content: string) => {
      mutate((prev) => ({ ...prev, content }));
    },
    [data, mutate]
  );

  return {
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
    content,
    setContent,
    selectedSkills,
    setSelectedSkills,
  };
};

const AcpSendBox: React.FC<{
  conversation_id: string;
  backend: AcpBackend;
  sessionMode?: string;
  agentName?: string;
  onAiProcessingChange?: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({ conversation_id, backend, sessionMode, agentName, onAiProcessingChange }) => {
  const { thought, running, acpStatus, aiProcessing, resetState, tokenUsage, contextLimit, processingStartTime, beginStop, endStop, beginProcessing } = useAcpMessage(conversation_id);
  const { t } = useTranslation();
  const workspaceFiles = useWorkspaceFiles();
  const { checkAndUpdateTitle } = useAutoTitle();
  const slashCommands = useSlashCommands(conversation_id, { agentStatus: acpStatus });
  const { atPath, uploadFile, setAtPath, setUploadFile, content, setContent, selectedSkills, setSelectedSkills } = useSendBoxDraft(conversation_id);
  const { setSendBoxHandler } = usePreviewContext();
  // Sync local aiProcessing state to parent via onAiProcessingChange
  // 将本地 aiProcessing 状态同步到父组件
  useEffect(() => {
    if (onAiProcessingChange) {
      onAiProcessingChange(aiProcessing);
    }
  }, [aiProcessing, onAiProcessingChange]);

  // 使用 useRef 来跟踪组件是否已经挂载，避免重复初始化
  const hasInitialized = useRef(false);

  // 添加组件挂载日志
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;

      // 清除任何残留的定时器
      const pendingTimeout = (window as unknown as { __acpFinishTimeout?: ReturnType<typeof setTimeout> }).__acpFinishTimeout;
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        (window as unknown as { __acpFinishTimeout?: ReturnType<typeof setTimeout> }).__acpFinishTimeout = undefined;
      }
    }

    // 组件卸载时的清理
    return () => {
      hasInitialized.current = false;
    };
  }, [conversation_id]);

  // 使用 useLatestRef 保存最新的 setContent/atPath，避免重复注册 handler
  // Use useLatestRef to keep latest setters to avoid re-registering handler
  const setContentRef = useLatestRef(setContent);
  const atPathRef = useLatestRef(atPath);

  const addOrUpdateMessage = useAddOrUpdateMessage(); // Move this here so it's available in useEffect
  const addOrUpdateMessageRef = useLatestRef(addOrUpdateMessage);

  // 使用共享的文件处理逻辑
  const { handleFilesAdded, clearFiles } = useSendBoxFiles({
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
  });

  // 注册预览面板添加到发送框的 handler
  // Register handler for adding text from preview panel to sendbox
  useEffect(() => {
    const handler = (text: string) => {
      // 如果已有内容，添加换行和新文本；否则直接设置文本
      // If there's existing content, add newline and new text; otherwise just set the text
      const newContent = content ? `${content}\n${text}` : text;
      setContentRef.current(newContent);
    };
    setSendBoxHandler(handler);
  }, [setSendBoxHandler, content]);

  // Listen for sendbox.fill event to populate input from external sources
  useAddEventListener(
    'sendbox.fill',
    (text: string) => {
      setContentRef.current(text);
    },
    []
  );

  // Check for and send initial message from guid page
  // Note: We don't wait for acpStatus because:
  // 1. ACP connection is initialized when first message is sent
  // 2. Waiting for 'session_active' creates a deadlock (status only updates after message is sent)
  // 3. This matches the behavior of onSendHandler which sends immediately
  useEffect(() => {
    // Check both ACP and remote-agent initial message keys
    const acpStorageKey = `acp_initial_message_${conversation_id}`;
    const remoteStorageKey = `remote_initial_message_${conversation_id}`;
    const storedMessage = sessionStorage.getItem(acpStorageKey) || sessionStorage.getItem(remoteStorageKey);

    if (!storedMessage) {
      return;
    }

    // Clear both keys to prevent duplicate sends
    sessionStorage.removeItem(acpStorageKey);
    sessionStorage.removeItem(remoteStorageKey);

    const sendInitialMessage = async () => {
      try {
        const initialMessage = JSON.parse(storedMessage);
        const { input, files, skills = [] } = initialMessage;

        // ACP: 不使用 buildDisplayMessage，直接传原始 input
        // 文件引用由后端 ACP agent 负责添加（使用复制后的实际路径）
        // 避免消息中出现两套不一致的文件引用
        const msg_id = uuid();

        // Start AI processing loading state (user message will be added via backend response)
        beginProcessing();

        // Send the message
        const result = await ipcBridge.acpConversation.sendMessage.invoke({
          input,
          msg_id,
          conversation_id,
          files,
          skills: skills,
        });

        if (result && result.success === true) {
          // Initial message sent successfully
          void checkAndUpdateTitle(conversation_id, input);
          emitter.emit('chat.history.refresh');
          if (backend === 'remote-agent') emitter.emit('remote-agent.workspace.refresh');
        } else {
          // Handle send failure
          // Create error message in UI
          const errorMessage: TMessage = {
            id: uuid(),
            msg_id: uuid(),
            conversation_id,
            type: 'tips',
            position: 'center',
            content: {
              content: 'Failed to send message. Please try again.',
              type: 'error',
            },
            createdAt: Date.now() + 2,
          };
          addOrUpdateMessageRef.current(errorMessage, true);
          resetState(); // Stop loading state on failure
        }
      } catch (error) {
        // Stop loading state on error
        resetState();
      }
    };

    sendInitialMessage().catch((error) => {
      console.error('Failed to send initial message:', error);
    });
  }, [conversation_id, backend, checkAndUpdateTitle, addOrUpdateMessageRef, beginProcessing, resetState]);

  const onSendHandler = async (message: string, skills?: string[]) => {
    // /login <title> — intercept BEFORE agent send. Text never leaves the renderer.
    const loginMatch = /^\/login\s+(.+)$/.exec(message.trim());
    if (loginMatch) {
      const title = loginMatch[1].trim();
      if (!title) {
        messageApiRef.current.warning(t('pwdLogin.slash.missingTitle', { defaultValue: 'Usage: /login <title>' }));
        return;
      }
      setPwdLoginModal({ visible: true, title });
      return;
    }

    // Fallback to local state if skills not provided by event (rare, but safer)
    const activeSkills = skills || selectedSkills;

    const msg_id = uuid();

    // ACP: 不使用 buildDisplayMessage，直接传原始 message
    // 文件引用由后端 ACP agent 负责添加（使用复制后的实际路径）
    // 避免消息中出现两套不一致的文件引用导致 Claude 读取错误文件

    // 合并 uploadFile 和 atPath（工作空间选择的文件）
    // Merge uploadFile and atPath (workspace selected files)
    const atPathFiles = atPath.map((item) => (typeof item === 'string' ? item : item.path));
    const allFiles = [...uploadFile, ...atPathFiles];

    // Content is already cleared by the shared SendBox component (setInput(''))
    // before calling onSend — no need to clear again here.
    clearFiles();

    // Start AI processing loading state
    beginProcessing();

    // Send message via ACP
    try {
      const result = await ipcBridge.acpConversation.sendMessage.invoke({
        input: message,
        msg_id,
        conversation_id,
        files: allFiles,
        skills: activeSkills,
      });

      void checkAndUpdateTitle(conversation_id, message);
      emitter.emit('chat.history.refresh');
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Check if it's an ACP authentication error
      const isAuthError = errorMsg.includes('[ACP-AUTH-') || errorMsg.includes('authentication failed') || errorMsg.includes('认证失败');

      if (isAuthError) {
        // Create error message in conversation instead of alert
        const errorMessage = {
          id: uuid(),
          msg_id: uuid(),
          conversation_id,
          type: 'error',
          data: t('acp.auth.failed', {
            backend,
            error: errorMsg,
            defaultValue: `${backend} authentication failed:\n\n{{error}}\n\nPlease check your local CLI tool authentication status`,
          }),
        };

        // Add error message to conversation
        ipcBridge.acpConversation.responseStream.emit(errorMessage);

        // Stop loading state since AI won't respond
        resetState();
        return; // Don't re-throw error, just show the message
      }
      // Stop loading state for other errors too
      resetState();
      throw error;
    }

    // Clear selected files (similar to GeminiSendBox)
    emitter.emit('acp.selected.file.clear');
    if (backend === 'remote-agent') {
      emitter.emit('remote-agent.workspace.refresh');
    } else if (allFiles.length) {
      emitter.emit('acp.workspace.refresh');
    }
  };

  const appendSelectedFiles = useCallback(
    (files: string[]) => {
      setUploadFile((prev) => [...prev, ...files]);
    },
    [setUploadFile]
  );
  const { openFileSelector, onSlashBuiltinCommand } = useOpenFileSelector({
    onFilesSelected: appendSelectedFiles,
  });
  const [bdpanSelectorVisible, setBdpanSelectorVisible] = useState(false);
  const [pwdLoginModal, setPwdLoginModal] = useState<{ visible: boolean; title: string }>({ visible: false, title: '' });
  const [messageApi, messageContextHolder] = Message.useMessage();
  const messageApiRef = useRef(messageApi);
  messageApiRef.current = messageApi;

  // /login <title> — user-triggered auto-login via saved credentials.
  // Intercepted in onSendHandler before the text hits the agent, so the
  // title + pwd_login machinery never crosses the LLM boundary.
  const handlePwdLoginDecision = useCallback(
    async (decision: PwdLoginApprovalDecision) => {
      const title = pwdLoginModal.title;
      setPwdLoginModal({ visible: false, title: '' });
      if (!title) return;
      try {
        const result = await ipcBridge.pwdLogin.start.invoke({
          title,
          optionId: decision,
          conversation_id,
        });
        if (result.ok) {
          messageApiRef.current.success(t('pwdLogin.result.success', { title, defaultValue: 'Logged into {{title}}' }));
        } else {
          messageApiRef.current.error(
            t('pwdLogin.result.failure', {
              title,
              error: result.error ?? 'unknown',
              defaultValue: 'Auto-login failed ({{error}})',
            })
          );
        }
      } catch (err) {
        messageApiRef.current.error(t('pwdLogin.result.exception', { defaultValue: 'Auto-login error' }));
        console.error('[pwdLogin] invoke failed:', err);
      }
    },
    [pwdLoginModal.title, conversation_id, t]
  );

  useEffect(() => {
    return ipcBridge.bdpan.downloadResult.on((result) => {
      if (result.success) {
        messageApiRef.current.success(t('conversation.bdpan.download.success'));
      } else {
        messageApiRef.current.error(result.error ?? t('conversation.bdpan.download.failed'));
      }
    });
  }, [t]);

  useAddEventListener('acp.selected.file', setAtPath);
  useAddEventListener('acp.selected.file.append', (items: Array<string | FileOrFolderItem>) => {
    const merged = mergeFileSelectionItems(atPathRef.current, items);
    if (merged !== atPathRef.current) {
      setAtPath(merged as Array<string | FileOrFolderItem>);
    }
  });

  // 停止会话处理函数 Stop conversation handler
  const handleStop = async (): Promise<void> => {
    beginStop();
    try {
      await ipcBridge.conversation.stop.invoke({ conversation_id });
    } finally {
      endStop();
    }
  };

  const selectedFileCount = filterUserVisibleFiles(uploadFile).length + filterUserVisibleAtPath(atPath).filter((item) => (typeof item === 'string' ? true : item.isFile)).length;

  return (
    <div className='max-w-800px w-full mx-auto flex flex-col mt-auto mb-16px'>
      {messageContextHolder}
      <ThoughtDisplay thought={thought} running={running || aiProcessing} onStop={handleStop} startTime={processingStartTime} />

      <SendBox
        value={content}
        onChange={setContent}
        initialSelectedSkills={selectedSkills}
        loading={running || aiProcessing}
        disabled={false}
        placeholder={t('acp.sendbox.placeholder', { backend: agentName || backend, defaultValue: `Send message to {{backend}}...` })}
        onStop={handleStop}
        className='z-10'
        onFilesAdded={handleFilesAdded}
        supportedExts={allSupportedExts}
        defaultMultiLine={true}
        lockMultiLine={true}
        tools={
          <div className='flex items-center gap-3'>
            <Dropdown
              trigger='click'
              droplist={
                <Menu
                  className='min-w-200px'
                  onClickMenuItem={(key) => {
                    if (key === 'file') {
                      openFileSelector();
                    } else if (key === 'bdpan') {
                      setBdpanSelectorVisible(true);
                    }
                  }}
                >
                  <Menu.Item key='file'>
                    <div className='flex items-center gap-2'>
                      <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
                      <span>{t('conversation.welcome.downloadLocalFile')}</span>
                    </div>
                  </Menu.Item>
                  <Menu.Item key='bdpan'>
                    <div className='flex items-center gap-2'>
                      <img src={BdpanLogo} alt='Bdpan' style={{ width: 16, height: 16 }} />
                      <span>{t('conversation.welcome.downloadBdpanFile')}</span>
                    </div>
                  </Menu.Item>
                </Menu>
              }
            >
              <span className='relative'>
                <Button shape='circle' type='secondary' title={t('conversation.welcome.downloadLocalFile')} icon={<Plus theme='outline' strokeWidth={4} fill='white' />} />
                {selectedFileCount > 0 && <span className='absolute -right-3px -top-3px flex-center min-w-14px h-14px rounded-full bg-[var(--ui-accent-orange)] px-3px text-9px text-white font-600 pointer-events-none'>{selectedFileCount}</span>}
              </span>
            </Dropdown>
            <AgentModeSelector backend={backend} conversationId={conversation_id} compact initialMode={sessionMode} compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />} modeLabelFormatter={(mode) => t(`agentMode.${mode.value}`, { defaultValue: mode.label })} compactLabelPrefix={t('agentMode.permission')} hideCompactLabelPrefixOnMobile />
            <AcpConfigSelector conversationId={conversation_id} backend={backend} />
          </div>
        }
        prefix={
          <>
            {/* Files on top - hide internal temp workspace paths from user */}
            {(() => {
              const visibleUploadFile = filterUserVisibleFiles(uploadFile);
              const visibleAtPath = filterUserVisibleAtPath(atPath);
              const hasVisibleFiles = visibleUploadFile.length > 0 || visibleAtPath.some((item) => (typeof item === 'string' ? true : item.isFile));
              const hasVisibleFolders = visibleAtPath.some((item) => (typeof item === 'string' ? false : !item.isFile));
              return (
                <>
                  {hasVisibleFiles && (
                    <HorizontalFileList>
                      {visibleUploadFile.map((path) => (
                        <FilePreview key={path} path={path} onRemove={() => setUploadFile(uploadFile.filter((v) => v !== path))} />
                      ))}
                      {visibleAtPath.map((item) => {
                        const isFile = typeof item === 'string' ? true : item.isFile;
                        const path = typeof item === 'string' ? item : item.path;
                        if (isFile) {
                          return (
                            <FilePreview
                              key={path}
                              path={path}
                              onRemove={() => {
                                const newAtPath = atPath.filter((v) => (typeof v === 'string' ? v !== path : v.path !== path));
                                emitter.emit('acp.selected.file', newAtPath);
                                setAtPath(newAtPath);
                              }}
                            />
                          );
                        }
                        return null;
                      })}
                    </HorizontalFileList>
                  )}
                  {hasVisibleFolders && (
                    <div className='flex flex-wrap items-center gap-8px mb-8px'>
                      {visibleAtPath.map((item) => {
                        if (typeof item === 'string') return null;
                        if (!item.isFile) {
                          return (
                            <Tag
                              key={item.path}
                              color='blue'
                              closable
                              onClose={() => {
                                const newAtPath = atPath.filter((v) => (typeof v === 'string' ? true : v.path !== item.path));
                                emitter.emit('acp.selected.file', newAtPath);
                                setAtPath(newAtPath);
                              }}
                            >
                              {item.name}
                            </Tag>
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </>
        }
        onSend={onSendHandler}
        slashCommands={slashCommands}
        onSlashBuiltinCommand={onSlashBuiltinCommand}
        onSkillsChange={(skills) => {
          setSelectedSkills(skills);
        }}
        sendButtonPrefix={tokenUsage ? <ContextUsageIndicator tokenUsage={tokenUsage} contextLimit={contextLimit > 0 ? contextLimit : undefined} size={18} /> : undefined}
        workspaceFiles={workspaceFiles}
        onAtFileSelected={(file) => {
          const item: FileOrFolderItem = {
            path: file.fullPath,
            name: file.name,
            isFile: file.isFile,
            relativePath: file.relativePath,
          };
          const newAtPath = mergeFileSelectionItems([...atPath], [item]);
          setAtPath(newAtPath);
          emitter.emit('acp.selected.file.append', [item]);
        }}
      ></SendBox>
      <BdpanFileSelector
        visible={bdpanSelectorVisible}
        onCancel={() => setBdpanSelectorVisible(false)}
        onConfirm={(paths) => {
          setBdpanSelectorVisible(false);
          appendSelectedFiles(paths);
        }}
      />
      <PwdLoginApprovalModal
        visible={pwdLoginModal.visible}
        title={pwdLoginModal.title}
        onDecide={(decision) => {
          void handlePwdLoginDecision(decision);
        }}
        onCancel={() => setPwdLoginModal({ visible: false, title: '' })}
      />
    </div>
  );
};

export default AcpSendBox;
