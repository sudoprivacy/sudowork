/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chatLib';
import { transformMessage } from '@/common/chatLib';
import { uuid } from '@/common/utils';
import SendBox from '@/renderer/components/sendbox';
import { getSendBoxDraftHook, type FileOrFolderItem } from '@/renderer/hooks/useSendBoxDraft';
import { createSetUploadFile } from '@/renderer/hooks/useSendBoxFiles';
import { useAddOrUpdateMessage, useMessageList } from '@/renderer/messages/hooks';
import { allSupportedExts, type FileMetadata } from '@/renderer/services/FileService';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { mergeFileSelectionItems } from '@/renderer/utils/fileSelection';
import { Button, Dropdown, Menu, Message, Tag } from '@arco-design/web-react';
import { Plus, UploadOne } from '@icon-park/react';
import { iconColors } from '@/renderer/theme/colors';
import BdpanLogo from '@/renderer/assets/logos/bdpan.png';
import BdpanFileSelector from '@/renderer/components/BdpanFileSelector';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildDisplayMessage, filterUserVisibleAtPath, filterUserVisibleFiles } from '@/renderer/utils/messageFiles';
import ThoughtDisplay, { type ThoughtData } from '@/renderer/components/ThoughtDisplay';
import FilePreview from '@/renderer/components/FilePreview';
import HorizontalFileList from '@/renderer/components/HorizontalFileList';
import { usePreviewContext } from '@/renderer/pages/conversation/preview';
import { useLatestRef } from '@/renderer/hooks/useLatestRef';
import { useOpenFileSelector } from '@/renderer/hooks/useOpenFileSelector';
import { useAutoTitle } from '@/renderer/hooks/useAutoTitle';
import { useSlashCommands } from '@/renderer/hooks/useSlashCommands';
import { useWorkspaceFiles } from '@/renderer/hooks/useWorkspaceFiles';
import { AIProcessingContext } from './OpenClawChat';

interface OpenClawDraftData {
  _type: 'openclaw-gateway';
  atPath: Array<string | FileOrFolderItem>;
  content: string;
  uploadFile: string[];
}

const useOpenClawSendBoxDraft = getSendBoxDraftHook('openclaw-gateway', {
  _type: 'openclaw-gateway',
  atPath: [],
  content: '',
  uploadFile: [],
});

/**
 * Validate that the OpenClaw runtime matches the expected configuration.
 * Returns true if validation passes, false otherwise (with user-facing error).
 */
const validateRuntimeMismatch = async (conversationId: string): Promise<boolean> => {
  const runtimeResult = await ipcBridge.openclawConversation.getRuntime.invoke({ conversation_id: conversationId });
  if (!runtimeResult?.success || !runtimeResult.data) {
    Message.error('Failed to validate agent runtime');
    return false;
  }

  const runtime = runtimeResult.data.runtime || {};
  const expected = runtimeResult.data.expected || {};
  const mismatches: string[] = [];

  const norm = (v?: string | null) => (v || '').trim();
  const eqPath = (a?: string | null, b?: string | null) => norm(a).replace(/[\\/]+$/, '') === norm(b).replace(/[\\/]+$/, '');

  if (expected.expectedWorkspace && !eqPath(expected.expectedWorkspace, runtime.workspace)) {
    mismatches.push(`workspace: expected=${expected.expectedWorkspace || '-'} actual=${runtime.workspace || '-'}`);
  }
  if (expected.expectedBackend && norm(expected.expectedBackend) !== norm(runtime.backend)) {
    mismatches.push(`backend: expected=${expected.expectedBackend || '-'} actual=${runtime.backend || '-'}`);
  }
  if (expected.expectedAgentName && norm(expected.expectedAgentName) !== norm(runtime.agentName)) {
    mismatches.push(`agent: expected=${expected.expectedAgentName || '-'} actual=${runtime.agentName || '-'}`);
  }
  if (expected.expectedCliPath && norm(expected.expectedCliPath) !== norm(runtime.cliPath)) {
    mismatches.push(`cliPath: expected=${expected.expectedCliPath || '-'} actual=${runtime.cliPath || '-'}`);
  }
  if (expected.expectedModel && norm(expected.expectedModel) !== norm(runtime.model)) {
    mismatches.push(`model: expected=${expected.expectedModel || '-'} actual=${runtime.model || '-'}`);
  }
  if (expected.expectedIdentityHash && norm(expected.expectedIdentityHash) !== norm(runtime.identityHash)) {
    mismatches.push(`identity: expected=${expected.expectedIdentityHash || '-'} actual=${runtime.identityHash || '-'}`);
  }

  if (mismatches.length > 0) {
    Message.error(`Agent switch validation failed: ${mismatches.join(' | ')}`);
    return false;
  }
  return true;
};

const EMPTY_AT_PATH: Array<string | FileOrFolderItem> = [];
const EMPTY_UPLOAD_FILES: string[] = [];
const OpenClawSendBox: React.FC<{
  conversation_id: string;
  onAiProcessingChange?: React.Dispatch<React.SetStateAction<boolean>>;
  agentName?: string;
}> = ({ conversation_id, onAiProcessingChange, agentName }) => {
  const aiProcessingContext = React.useContext(AIProcessingContext);
  const [workspacePath, setWorkspacePath] = useState('');
  const { t } = useTranslation();
  const workspaceFiles = useWorkspaceFiles();
  const { checkAndUpdateTitle } = useAutoTitle();
  const slashCommands = useSlashCommands(conversation_id);
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const messageList = useMessageList();
  const { setSendBoxHandler } = usePreviewContext();

  const [aiProcessing, setAiProcessing] = useState(false);
  const [openclawStatus, setOpenClawStatus] = useState<string | null>(null);
  const [thought, setThought] = useState<ThoughtData>({
    description: '',
    subject: '',
  });
  const [stopStatus, setStopStatus] = useState<'stopped' | null>(null);
  const stopStatusRef = useRef<'stopped' | null>(null);

  // Use ref to sync state for immediate access in event handlers
  // 使用 ref 同步状态，以便在事件处理程序中立即访问
  const aiProcessingRef = useRef(aiProcessing);

  // Sync local aiProcessing state to parent via onAiProcessingChange
  React.useEffect(() => {
    if (onAiProcessingChange) {
      onAiProcessingChange(aiProcessing);
    }
  }, [aiProcessing, onAiProcessingChange]);

  // Reset aiProcessing when conversation changes
  // 切换会话时重置 aiProcessing 状态
  React.useEffect(() => {
    setAiProcessing(false);
  }, [conversation_id]);

  // Restore stopStatus from message list on load
  // 从消息列表恢复停止状态
  React.useEffect(() => {
    if (!messageList.length) return;
    // Find last agent_status message
    // 查找最后一条 agent_status 消息
    const agentStatusMessages = messageList.filter(
      (m) => m.type === 'agent_status' && m.conversation_id === conversation_id
    );
    if (!agentStatusMessages.length) return;

    const lastAgentStatus = agentStatusMessages[agentStatusMessages.length - 1];
    const status = (lastAgentStatus?.content as { status?: string })?.status;
    if (status !== 'stopped') return;

    // Check if there's any content message after the stopped message
    // If there's content after stopped, the conversation continued and we shouldn't show stopped status
    // 检查停止消息之后是否有任何内容消息（包括AI回复）
    // 如果有内容，说明会话继续了，不应该显示停止状态
    const stoppedCreatedAt = lastAgentStatus.createdAt;
    const hasContentAfter = messageList.some(
      (m) =>
        m.conversation_id === conversation_id &&
        m.type === 'text' &&
        m.createdAt > stoppedCreatedAt
    );

    // If no content after stopped, restore stopStatus
    // 如果停止后没有内容消息，恢复停止状态
    if (!hasContentAfter) {
      setStopStatus('stopped');
      stopStatusRef.current = 'stopped';
    }
  }, [conversation_id, messageList]);

  // Track whether current turn has content output
  // Only reset aiProcessing when finish arrives after content (not after tool calls)
  const hasContentInTurnRef = useRef(false);

  // Track whether the current turn was triggered by a Star Office install request
  const starOfficeInstallInFlightRef = useRef(false);

  // Delayed finish timeout to detect true end of task
  const finishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (thoughtThrottleRef.current.timer) {
        clearTimeout(thoughtThrottleRef.current.timer);
      }
    };
  }, []);

  const { data: draftData, mutate: mutateDraft } = useOpenClawSendBoxDraft(conversation_id);
  const atPath = draftData?.atPath ?? EMPTY_AT_PATH;
  const uploadFile = draftData?.uploadFile ?? EMPTY_UPLOAD_FILES;
  const content = draftData?.content ?? '';

  const setAtPath = useCallback(
    (val: Array<string | FileOrFolderItem>) => {
      mutateDraft((prev) => ({ ...(prev as OpenClawDraftData), atPath: val }));
    },
    [mutateDraft]
  );

  const setUploadFile = createSetUploadFile(mutateDraft, draftData);

  const setContent = useCallback(
    (val: string) => {
      mutateDraft((prev) => ({ ...(prev as OpenClawDraftData), content: val }));
    },
    [mutateDraft]
  );

  const setContentRef = useLatestRef(setContent);
  const atPathRef = useLatestRef(atPath);
  const immediateSendRef = useRef<((text: string) => Promise<void>) | null>(null);
  // Reset state when conversation changes and restore actual running status
  useEffect(() => {
    // Clear pending finish timeout when conversation changes
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }

    setOpenClawStatus(null);
    setThought({ subject: '', description: '' });
    hasContentInTurnRef.current = false;

    // Check actual conversation status from backend before resetting aiProcessing
    // to avoid flicker when switching to a running conversation
    // 先获取后端状态再重置 aiProcessing，避免切换到运行中的会话时闪烁
    void ipcBridge.conversation.get.invoke({ id: conversation_id }).then((res) => {
      if (!res) {
        setAiProcessing(false);
        aiProcessingRef.current = false;
        return;
      }
      const isRunning = res.status === 'running';
      setAiProcessing(isRunning);
      aiProcessingRef.current = isRunning;
    });

    // Eagerly initialize the OpenClaw agent and recover its connection status.
    // The agent may have already emitted 'session_active' before this listener was set up
    // (race condition: agent starts in constructor during conversation.create, before navigation).
    // getRuntime awaits bootstrap, so by the time it returns the agent is fully connected.
    void ipcBridge.openclawConversation.getRuntime
      .invoke({ conversation_id })
      .then((res) => {
        if (res?.success && res.data?.runtime?.hasActiveSession) {
          setOpenClawStatus('session_active');
        }
      })
      .catch(() => {
        // Agent not ready or conversation not found – ignore
      });
  }, [conversation_id, addOrUpdateMessage]);

  useEffect(() => {
    const handler = (text: string) => {
      const newContent = content ? `${content}\n${text}` : text;
      setContentRef.current(newContent);
    };
    setSendBoxHandler(handler);
  }, [setSendBoxHandler, content]);

  useAddEventListener(
    'sendbox.fill',
    (text: string) => {
      setContentRef.current(text);
    },
    []
  );

  useEffect(() => {
    return ipcBridge.openclawConversation.responseStream.on((message) => {
      if (conversation_id !== message.conversation_id) {
        return;
      }

      const safeTransformMessage = (): TMessage | undefined => {
        try {
          return transformMessage(message);
        } catch (error) {
          console.warn('[OpenClawSendBox] Ignoring unsupported response message', {
            conversation_id,
            type: message.type,
            error,
          });
          return undefined;
        }
      };

      // Cancel pending finish timeout if new message arrives
      if (finishTimeoutRef.current && message.type !== 'finish') {
        clearTimeout(finishTimeoutRef.current);
        finishTimeoutRef.current = null;
      }

      switch (message.type) {
        case 'thought':
          // Clear stop status when starting new task
          // 开始新任务时清除停止状态
          setStopStatus(null);
          stopStatusRef.current = null;
          // Auto-recover aiProcessing state if thought arrives after finish
          // 如果 thought 在 finish 后到达，自动恢复 aiProcessing 状态
          if (!aiProcessingRef.current) {
            setAiProcessing(true);
            aiProcessingRef.current = true;
          }
          throttledSetThought(message.data as ThoughtData);
          break;
        case 'finish':
          {
            const isIntermediate = (message.data as { isIntermediate?: boolean })?.isIntermediate;
            // 如果是中间步骤完成，不重置状态，任务可能继续执行
            // If intermediate step finish, don't reset state, task may continue
            if (isIntermediate) {
              break;
            }

            // Use delayed reset to detect true end of task
            // 使用延迟重置来检测任务的真正结束
            finishTimeoutRef.current = setTimeout(() => {
              setAiProcessing(false);
              aiProcessingRef.current = false;
              setThought({ subject: '', description: '' });
              // Only clear stopStatus if no stop was received (use ref for immediate access)
              // 只有在没有收到停止状态时才清除 stopStatus
              if (!stopStatusRef.current) {
                setStopStatus(null);
                stopStatusRef.current = null;
              }
              finishTimeoutRef.current = null;
              // Notify StarOfficeMonitorCard to re-detect and auto-open panel
              if (starOfficeInstallInFlightRef.current) {
                starOfficeInstallInFlightRef.current = false;
                emitter.emit('staroffice.install.finished', { conversationId: conversation_id });
              }
            }, 1000);
            hasContentInTurnRef.current = false;
          }
          break;
        case 'content':
        case 'acp_permission': {
          // Mark that current turn has content output
          hasContentInTurnRef.current = true;
          // Clear stop status when new content arrives (conversation continued)
          // 新内容到达时清除停止状态（会话继续了）
          if (stopStatusRef.current === 'stopped') {
            setStopStatus(null);
            stopStatusRef.current = null;
          }
          // Auto-recover aiProcessing state if content arrives after finish
          if (!aiProcessingRef.current) {
            setAiProcessing(true);
            aiProcessingRef.current = true;
          }
          setThought({ subject: '', description: '' });
          const transformedMessage = safeTransformMessage();
          if (transformedMessage) {
            addOrUpdateMessage(transformedMessage);
          }
          break;
        }
        case 'agent_status': {
          // If already stopped, ignore any subsequent agent_status messages
          // 如果已经停止，忽略后续的 agent_status 消息
          if (stopStatusRef.current === 'stopped') {
            return;
          }
          const statusData = message.data as { status: string; message?: string };
          // Handle stop status
          if (statusData.status === 'stopped') {
            // Cancel pending finish timeout
            if (finishTimeoutRef.current) {
              clearTimeout(finishTimeoutRef.current);
              finishTimeoutRef.current = null;
            }
            setStopStatus('stopped');
            stopStatusRef.current = 'stopped';
            setAiProcessing(false);
            aiProcessingRef.current = false;
            setThought({ subject: '', description: '' });
            setOpenClawStatus(null);
            return;
          }
          setOpenClawStatus(statusData.status);
          emitter.emit('agent.connection.status', conversation_id, statusData.status);
          break;
        }
        default: {
          setThought({ subject: '', description: '' });
          const transformedMessage = safeTransformMessage();
          if (transformedMessage) {
            addOrUpdateMessage(transformedMessage);
          }
        }
      }
    });
  }, [conversation_id, addOrUpdateMessage]);

  useEffect(() => {
    void ipcBridge.conversation.get.invoke({ id: conversation_id }).then((res) => {
      if (!res?.extra?.workspace) return;
      setWorkspacePath(res.extra.workspace);
    });
  }, [conversation_id]);

  useAddEventListener(
    'staroffice.install.request',
    ({ conversationId, text }) => {
      if (conversationId !== conversation_id) return;
      // Show the simplified prompt to user, inject star-office-helper skill via main process
      const msg_id = uuid();
      const userMessage: TMessage = {
        id: msg_id,
        msg_id,
        conversation_id,
        type: 'text',
        position: 'right',
        content: { content: text },
        createdAt: Date.now(),
      };
      addOrUpdateMessage(userMessage, true);
      setAiProcessing(true);
      aiProcessingRef.current = true;
      starOfficeInstallInFlightRef.current = true;
      ipcBridge.openclawConversation.sendMessage
        .invoke({ input: text, msg_id, conversation_id, skills: ['star-office-helper'] })
        .then(() => {
          void checkAndUpdateTitle(conversation_id, text);
          emitter.emit('chat.history.refresh');
        })
        .catch(() => {
          setAiProcessing(false);
          aiProcessingRef.current = false;
          starOfficeInstallInFlightRef.current = false;
        });
    },
    [conversation_id, addOrUpdateMessage, checkAndUpdateTitle]
  );

  const handleFilesAdded = useCallback(
    (pastedFiles: FileMetadata[]) => {
      const filePaths = pastedFiles.map((file) => file.path);
      setUploadFile((prev) => [...prev, ...filePaths]);
    },
    [setUploadFile]
  );

  useAddEventListener('openclaw-gateway.selected.file', (convId: string, items: Array<string | FileOrFolderItem>) => {
    if (convId !== conversation_id) return;
    setTimeout(() => {
      setAtPath(items);
    }, 10);
  });

  useAddEventListener('openclaw-gateway.selected.file.append', (convId: string, items: Array<string | FileOrFolderItem>) => {
    if (convId !== conversation_id) return;
    setTimeout(() => {
      const merged = mergeFileSelectionItems(atPathRef.current, items);
      if (merged !== atPathRef.current) {
        setAtPath(merged as Array<string | FileOrFolderItem>);
      }
    }, 10);
  });

  const sendOpenClawMessage = useCallback(
    async (message: string, skills?: string[]) => {
      const runtimeOk = await validateRuntimeMismatch(conversation_id);
      if (!runtimeOk) return;

      const msg_id = uuid();
      // Content is already cleared by the shared SendBox component (setInput(''))
      // before calling onSend — no need to clear again here.
      emitter.emit('openclaw-gateway.selected.file.clear');
      const currentAtPath = [...atPath];
      const currentUploadFile = [...uploadFile];
      setAtPath([]);
      setUploadFile([]);

      // Collect explicitly selected files/folders from workspace tree and uploads
      const atPathStrings = currentAtPath.map((item) => (typeof item === 'string' ? item : item.path));
      const filesToSend = [...currentUploadFile, ...atPathStrings];

      // Display message only shows user-selected files (workspace context is injected by the backend)
      const displayMessage = buildDisplayMessage(message, filesToSend, workspacePath);

      const userMessage: TMessage = {
        id: msg_id,
        msg_id,
        conversation_id,
        type: 'text',
        position: 'right',
        content: { content: displayMessage, skills: skills || [] },
        createdAt: Date.now(),
      };
      addOrUpdateMessage(userMessage, true);
      setAiProcessing(true);
      aiProcessingRef.current = true;
      try {
        await ipcBridge.openclawConversation.sendMessage.invoke({
          input: displayMessage,
          msg_id,
          conversation_id,
          files: filesToSend,
          skills: skills || [],
        });
        void checkAndUpdateTitle(conversation_id, message);
        emitter.emit('chat.history.refresh');
      } catch (error) {
        // Only reset aiProcessing on error, normal flow is reset by 'finish' event
        setAiProcessing(false);
        aiProcessingRef.current = false;
        throw error;
      }
    },
    [conversation_id, atPath, uploadFile, workspacePath, addOrUpdateMessage, checkAndUpdateTitle, setAtPath, setUploadFile]
  );

  const onSendHandler = async (message: string, skills?: string[]) => {
    await sendOpenClawMessage(message, skills);
  };

  useEffect(() => {
    immediateSendRef.current = sendOpenClawMessage;
    return () => {
      immediateSendRef.current = null;
    };
  }, [sendOpenClawMessage]);

  const appendSelectedFiles = useCallback(
    (files: string[]) => {
      setUploadFile((prev) => [...prev, ...files]);
    },
    [setUploadFile]
  );
  const { openFileSelector, onSlashBuiltinCommand } = useOpenFileSelector({
    onFilesSelected: appendSelectedFiles,
  });
  const [isPlusDropdownOpen, setIsPlusDropdownOpen] = useState(false);
  const [bdpanSelectorVisible, setBdpanSelectorVisible] = useState(false);
  const [messageApi, messageContextHolder] = Message.useMessage();
  const messageApiRef = useRef(messageApi);
  messageApiRef.current = messageApi;

  useEffect(() => {
    return ipcBridge.bdpan.downloadResult.on((result) => {
      if (result.success) {
        messageApiRef.current.success(t('conversation.bdpan.download.success'));
      } else {
        messageApiRef.current.error(result.error ?? t('conversation.bdpan.download.failed'));
      }
    });
  }, [t]);

  // Handle initial message from guid page
  useEffect(() => {
    if (!conversation_id || !openclawStatus) return;
    if (openclawStatus !== 'session_active') return;

    const storageKey = `openclaw_initial_message_${conversation_id}`;
    const processedKey = `openclaw_initial_processed_${conversation_id}`;

    const processInitialMessage = async () => {
      const stored = sessionStorage.getItem(storageKey);
      if (!stored) return;
      if (sessionStorage.getItem(processedKey)) return;

      try {
        const runtimeOk = await validateRuntimeMismatch(conversation_id);
        if (!runtimeOk) return;

        sessionStorage.setItem(processedKey, 'true');
        setAiProcessing(true);
        aiProcessingRef.current = true;
        const { input, files = [], skills = [] } = JSON.parse(stored) as { input: string; files?: string[]; skills?: string[] };
        const msg_id = `initial_${conversation_id}_${Date.now()}`;
        const loading_id = uuid();
        const initialDisplayMessage = buildDisplayMessage(input, files, workspacePath);

        const userMessage: TMessage = {
          id: msg_id,
          msg_id,
          conversation_id,
          type: 'text',
          position: 'right',
          content: { content: initialDisplayMessage, skills: skills.length > 0 ? skills : undefined },
          createdAt: Date.now(),
        };
        addOrUpdateMessage(userMessage, true);

        await ipcBridge.openclawConversation.sendMessage.invoke({ input: initialDisplayMessage, msg_id, conversation_id, files, loading_id, skills: skills.length > 0 ? skills : undefined });
        void checkAndUpdateTitle(conversation_id, input);
        emitter.emit('chat.history.refresh');
        sessionStorage.removeItem(storageKey);
      } catch (err) {
        sessionStorage.removeItem(processedKey);
        // Only reset aiProcessing on error, normal flow is reset by 'finish' event
        setAiProcessing(false);
        aiProcessingRef.current = false;
      }
    };

    const timer = setTimeout(() => {
      processInitialMessage().catch((error) => {
        console.error('Failed to process initial message:', error);
      });
    }, 200);

    return () => {
      clearTimeout(timer);
    };
  }, [conversation_id, openclawStatus, addOrUpdateMessage]);

  const handleStop = async (): Promise<void> => {
    try {
      await ipcBridge.conversation.stop.invoke({ conversation_id });
    } finally {
      // Clear pending finish timeout
      if (finishTimeoutRef.current) {
        clearTimeout(finishTimeoutRef.current);
        finishTimeoutRef.current = null;
      }

      setAiProcessing(false);
      aiProcessingRef.current = false;
      setThought({ subject: '', description: '' });
      // Don't clear stopStatus here - let it persist until user sends new message
      // 不在这里清除 stopStatus - 让它保持显示直到用户发送新消息
      hasContentInTurnRef.current = false;
    }
  };

  return (
    <div className='max-w-800px w-full mx-auto flex flex-col mt-auto mb-16px'>
      {messageContextHolder}
      <ThoughtDisplay thought={thought} running={aiProcessing} onStop={handleStop} stopStatus={stopStatus} />

      <SendBox
        value={content}
        onChange={setContent}
        loading={aiProcessing}
        disabled={false}
        className='z-10'
        placeholder={
          aiProcessing
            ? t('conversation.chat.processing')
            : t('acp.sendbox.placeholder', {
                backend: agentName || 'Sudoclaw',
                defaultValue: `Send message to {{backend}}...`,
              })
        }
        onStop={handleStop}
        onFilesAdded={handleFilesAdded}
        supportedExts={allSupportedExts}
        defaultMultiLine={true}
        lockMultiLine={true}
        tools={
          <Dropdown
            trigger='hover'
            onVisibleChange={setIsPlusDropdownOpen}
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
                  <div className='flex items-center gap-8px'>
                    <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
                    <span>{t('conversation.welcome.downloadLocalFile')}</span>
                  </div>
                </Menu.Item>
                <Menu.Item key='bdpan'>
                  <div className='flex items-center gap-8px'>
                    <img src={BdpanLogo} alt='Bdpan' style={{ width: 16, height: 16 }} />
                    <span>{t('conversation.welcome.downloadBdpanFile')}</span>
                  </div>
                </Menu.Item>
              </Menu>
            }
          >
            <span>
              <Button type='secondary' shape='circle' className={isPlusDropdownOpen ? 'rotate-45' : ''} icon={<Plus theme='outline' size='14' strokeWidth={2} fill={iconColors.primary} />} />
            </span>
          </Dropdown>
        }
        prefix={
          <>
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
                                emitter.emit('openclaw-gateway.selected.file', conversation_id, newAtPath);
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
                                emitter.emit('openclaw-gateway.selected.file', conversation_id, newAtPath);
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
          // Store skills in ref or state if needed for session management
          // For now, they're passed directly to onSend
        }}
        workspaceFiles={workspaceFiles}
      ></SendBox>
      <BdpanFileSelector
        visible={bdpanSelectorVisible}
        onCancel={() => setBdpanSelectorVisible(false)}
        onConfirm={(paths) => {
          setBdpanSelectorVisible(false);
          appendSelectedFiles(paths);
        }}
      />
    </div>
  );
};

export default OpenClawSendBox;
