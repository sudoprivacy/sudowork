import { Button, Dropdown, Message, Modal, Tag } from '@arco-design/web-react';
import { Plus, Shield, UploadOne } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { AcpBackend } from '@sudowork/common/acpTypes';
import type { AcpQuestionItem, IMessageAcpQuestion, TMessage } from '@sudowork/common/chatLib';
import { uuid } from '@sudowork/common/utils';
import { ConfigStorage } from '@sudowork/common/storage';
import SendBox from '@renderer/components/Sendbox';
import { openBrowserSessionWindow } from '@renderer/components/browser/BrowserSessionPanel';
import ThoughtDisplay from '@renderer/components/ThoughtDisplay';
import { getSendBoxDraftHook, type FileOrFolderItem } from '@renderer/hooks/useSendBoxDraft';
import { createSetUploadFile, useSendBoxFiles } from '@renderer/hooks/useSendBoxFiles';
import { useAddOrUpdateMessage } from '@renderer/messages/hooks';
import { allSupportedExts } from '@renderer/services/FileService';
import { emitter, useAddEventListener } from '@renderer/utils/emitter';
import { mergeFileSelectionItems } from '@renderer/utils/fileSelection';
import BdpanLogo from '@renderer/assets/logos/bdpan.png';
import BdpanImportFilePicker from '@renderer/components/base/BdpanImportFilePicker';
import FilePreview from '@renderer/components/FilePreview';
import HorizontalFileList from '@renderer/components/HorizontalFileList';
import { usePreviewContext } from '@renderer/pages/conversation/preview';
import { useLatestRef } from '@renderer/hooks/useLatestRef';
import { useOpenFileSelector } from '@renderer/hooks/useOpenFileSelector';
import PwdLoginApprovalModal, { type PwdLoginApprovalDecision } from '@renderer/components/PwdLoginApprovalModal';
import ContextUsageIndicator from '@renderer/components/ContextUsageIndicator';
import { useAutoTitle } from '@renderer/hooks/useAutoTitle';
import AgentModeSelector from '@renderer/components/AgentModeSelector';
import AcpConfigSelector from '@renderer/components/AcpConfigSelector';
import { useSlashCommands } from '@renderer/hooks/useSlashCommands';
import { filterUserVisibleAtPath, filterUserVisibleFiles } from '@renderer/utils/messageFiles';
import { isElectronDesktop } from '@renderer/utils/platform';
import { useWorkspaceFiles } from '@renderer/hooks/useWorkspaceFiles';
import { useAcpMessage } from './useAcpMessage';

const useAcpSendBoxDraft = getSendBoxDraftHook('acp', {
  _type: 'acp',
  atPath: [],
  content: '',
  uploadFile: [],
  selectedSkills: [],
});

function buildPendingQuestionItems(message: IMessageAcpQuestion): AcpQuestionItem[] {
  if (message.content.items?.length) {
    return message.content.items;
  }

  const legacyOptions = (message.content.options || []).map((option) => ({ label: option, value: option }));
  return [
    {
      id: 'q1',
      prompt: message.content.question || '',
      kind: legacyOptions.length > 0 ? 'single_select' : 'text',
      options: legacyOptions,
      allowCustomInput: legacyOptions.length === 0,
      optional: false,
    },
  ];
}

function getCurrentPendingQuestionItemFromItems(message: IMessageAcpQuestion, items: AcpQuestionItem[]): AcpQuestionItem | null {
  if (items.length === 0) return null;
  const answeredCount = message.content.answerItems?.length ?? 0;
  return items[Math.min(answeredCount, items.length - 1)] ?? null;
}

function buildQuestionAnswers(message: IMessageAcpQuestion, items: AcpQuestionItem[], input: string): Array<{ id: string; value: string; label?: string }> | null {
  const currentItem = getCurrentPendingQuestionItemFromItems(message, items);
  const normalizedInput = input.trim();
  if (!currentItem || !normalizedInput) return null;
  return [
    {
      id: currentItem.id,
      value: normalizedInput,
      label: normalizedInput,
    },
  ];
}

const EMPTY_AT_PATH: Array<string | FileOrFolderItem> = [];
const EMPTY_UPLOAD_FILES: string[] = [];

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
  /** Team override: when set, sends route through the team API instead of the single-chat ACP API (附录 II.8). */
  teamSendMessage?: (params: { input: string; files?: string[]; msg_id?: string; skills?: string[] }) => Promise<void>;
  /** Team override: when set, the stop button routes through the team API (pauseMember) — team
   * agents are built with skipCache and are invisible to conversation.stop. */
  teamStop?: () => Promise<void>;
  teamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<{ success: boolean; msg?: string } | void>;
  pendingQuestion?: IMessageAcpQuestion | null;
  pendingQuestionItems?: AcpQuestionItem[];
  isAwaitingUserInput?: boolean;
  onAiProcessingChange?: React.Dispatch<React.SetStateAction<boolean>>;
  onProcessingChange?: (isProcessing: boolean) => void;
}> = ({ conversation_id, backend, sessionMode, agentName, teamSendMessage, teamStop, teamAnswerQuestion, pendingQuestion, pendingQuestionItems, isAwaitingUserInput = false, onAiProcessingChange, onProcessingChange }) => {
  const { thought, running, acpStatus, aiProcessing, resetState, tokenUsage, contextLimit, processingStartTime, beginStop, endStop, beginProcessing, finishTimeoutRef } = useAcpMessage(conversation_id);
  const { t } = useTranslation();
  const isProcessing = (running || aiProcessing) && !isAwaitingUserInput;
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

  useEffect(() => {
    onProcessingChange?.(isProcessing);
    return () => onProcessingChange?.(false);
  }, [isProcessing, onProcessingChange]);

  // 使用 useRef 来跟踪组件是否已经挂载，避免重复初始化
  const hasInitialized = useRef(false);

  // 添加组件挂载日志
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;

      // 清除任何残留的定时器
      const pendingTimeout = finishTimeoutRef.current;
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        finishTimeoutRef.current = undefined;
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
    (payload: string | { text: string; conversationId?: string }) => {
      if (typeof payload === 'string') {
        setContentRef.current(payload);
        return;
      }
      if (payload.conversationId && payload.conversationId !== conversation_id) return;
      setContentRef.current(payload.text);
    },
    [conversation_id]
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
        if (teamSendMessage) {
          await teamSendMessage({ input, files, msg_id, ...(skills.length ? { skills } : {}) });
          return;
        }
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
      } catch {
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
        Message.warning(t('pwdLogin.slash.missingTitle', { defaultValue: 'Usage: /login <title>' }));
        return;
      }
      setPwdLoginModal({ visible: true, title });
      return;
    }

    if (pendingQuestion) {
      const answers = buildQuestionAnswers(pendingQuestion, pendingQuestionItems ?? buildPendingQuestionItems(pendingQuestion), message);
      const toolCallId = pendingQuestion.content.responseToolCallId || pendingQuestion.content.toolCallId;
      if (!answers || !toolCallId) {
        Message.warning(t('messages.completeRequiredAnswers'));
        return;
      }
      clearFiles();

      try {
        if (teamAnswerQuestion) {
          const result = await teamAnswerQuestion({ conversationId: pendingQuestion.content.conversationId, toolCallId, answers });
          if (result && result.success === false) {
            Message.error(result.msg || t('messages.failedToSendQuestionAnswer'));
          }
        } else {
          const result = await ipcBridge.acpConversation.answerQuestion.invoke({
            conversationId: pendingQuestion.content.conversationId,
            toolCallId,
            answers,
          });
          if (!result || result.success !== true) {
            Message.error(result?.msg || t('messages.failedToSendQuestionAnswer'));
            return;
          }
        }
      } catch (error) {
        console.error('[AcpSendBox] Failed to answer pending question:', error);
        Message.error(t('messages.failedToSendQuestionAnswer'));
      }
      return;
    }

    // First-interrupt confirm: only when auto-interrupt is on and a turn is running (queue
    // mode doesn't interrupt, so no confirm). Answering "打断" persists so it asks only once.
    if ((running || aiProcessing) && autoInterruptEnabled && !autoInterruptConfirmed) {
      const ok = await confirmFirstInterrupt();
      if (!ok) return;
      setAutoInterruptConfirmed(true);
      void ConfigStorage.set('agent.autoInterruptConfirmed', true).catch(() => {});
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
      if (teamSendMessage) {
        await teamSendMessage({ input: message, files: allFiles, msg_id, ...(activeSkills?.length ? { skills: activeSkills } : {}) });
        return;
      }
      await ipcBridge.acpConversation.sendMessage.invoke({
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
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [pwdLoginModal, setPwdLoginModal] = useState<{ visible: boolean; title: string }>({ visible: false, title: '' });
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
          Message.success(t('pwdLogin.result.success', { title, defaultValue: 'Logged into {{title}}' }));
        } else {
          Message.error(
            t('pwdLogin.result.failure', {
              title,
              error: result.error ?? 'unknown',
              defaultValue: 'Auto-login failed ({{error}})',
            })
          );
        }
      } catch (err) {
        Message.error(t('pwdLogin.result.exception', { defaultValue: 'Auto-login error' }));
        console.error('[pwdLogin] invoke failed:', err);
      }
    },
    [pwdLoginModal.title, conversation_id, t]
  );

  useEffect(() => {
    return ipcBridge.bdpan.downloadResult.on((result) => {
      if (result.success) {
        Message.success(t('conversation.bdpan.download.success'));
      } else {
        Message.error(result.error ?? t('conversation.bdpan.download.failed'));
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
      // Team override: team agents are built with skipCache and are invisible to
      // conversation.stop (WorkerManage.getTaskById finds nothing) — route through the team API.
      if (teamStop) await teamStop();
      else await ipcBridge.conversation.stop.invoke({ conversation_id });
    } finally {
      endStop();
    }
  };

  const selectedFileCount = filterUserVisibleFiles(uploadFile).length + filterUserVisibleAtPath(atPath).filter((item) => (typeof item === 'string' ? true : item.isFile)).length;

  // 对话打断 / 消息队列：允许回复中提交（任一开关开启即可）+ 反射当前输入队列（用于 chips）。
  // 决策矩阵在进程侧 turnInputCoordinator（SSOT）；这里只读设置 + 展示。
  const [allowSubmitWhileRunning, setAllowSubmitWhileRunning] = useState(false);
  const [autoInterruptEnabled, setAutoInterruptEnabled] = useState(false);
  const [autoInterruptConfirmed, setAutoInterruptConfirmed] = useState(false);
  const [queuedInputs, setQueuedInputs] = useState<Array<{ id: string; preview: string }>>([]);
  useEffect(() => {
    let alive = true;
    void Promise.all([ConfigStorage.get('agent.autoInterrupt').catch(() => false), ConfigStorage.get('agent.messageQueue').catch(() => true), ConfigStorage.get('agent.autoInterruptConfirmed').catch(() => false)]).then(([ai, mq, confirmed]) => {
      if (!alive) return;
      setAllowSubmitWhileRunning(ai === true || mq !== false);
      setAutoInterruptEnabled(ai === true);
      setAutoInterruptConfirmed(confirmed === true);
    });
    return () => {
      alive = false;
    };
  }, []);
  // First time an auto-interrupt would fire, confirm once — the first interrupt of a live
  // reply can surprise even after opting in. Answering "打断" persists so it never asks again.
  const confirmFirstInterrupt = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: t('conversation.interruptConfirm.title'),
          content: t('conversation.interruptConfirm.body'),
          okText: t('conversation.interruptConfirm.ok'),
          cancelText: t('common.cancel'),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    [t]
  );
  useEffect(() => {
    return ipcBridge.conversation.inputQueueUpdate.on((data) => {
      if (data.conversation_id === conversation_id) setQueuedInputs(data.queue);
    });
  }, [conversation_id]);
  const handleDequeueLast = useCallback(async () => {
    const res = await ipcBridge.conversation.dequeueInput.invoke({ conversation_id });
    const dequeued = res?.success ? res.data?.content : undefined;
    if (dequeued) setContent(dequeued);
  }, [conversation_id, setContent]);

  return (
    <div className='max-w-800px w-full mx-auto flex flex-col mt-auto mb-16px'>
      <ThoughtDisplay thought={isAwaitingUserInput ? { subject: t('messages.waitingForUserInput'), description: t('messages.enterAnswer') } : thought} running={isProcessing} state={isAwaitingUserInput ? 'waiting' : 'processing'} onStop={handleStop} startTime={processingStartTime} />

      <SendBox
        value={content}
        onChange={setContent}
        initialSelectedSkills={selectedSkills}
        loading={isProcessing}
        disabled={false}
        topAttached={Boolean(thought?.subject) || isProcessing || isAwaitingUserInput}
        placeholder={isAwaitingUserInput ? t('messages.enterAnswer') : t('acp.sendbox.placeholder', { backend: agentName || backend, defaultValue: `Send message to {{backend}}...` })}
        onStop={handleStop}
        allowSubmitWhileRunning={allowSubmitWhileRunning}
        queuedInputs={queuedInputs}
        onDequeueLast={handleDequeueLast}
        className='z-10'
        onFilesAdded={handleFilesAdded}
        supportedExts={allSupportedExts}
        defaultMultiLine={true}
        lockMultiLine={true}
        tools={
          <div className='flex items-center gap-3'>
            <Dropdown
              trigger='click'
              popupVisible={fileMenuOpen}
              onVisibleChange={setFileMenuOpen}
              droplist={
                <div className='flex flex-col gap-2px p-6px rd-12px border bg-popup' style={{ minWidth: 200, boxShadow: '0 8px 28px rgba(0, 0, 0, 0.12)' }}>
                  <div
                    className='flex items-center gap-10px px-10px h-38px rd-8px cursor-pointer text-14px text-foreground transition-colors hover:bg-hover active:bg-active'
                    onClick={() => {
                      setFileMenuOpen(false);
                      openFileSelector();
                    }}
                  >
                    <UploadOne theme='outline' size='16' fill={'var(--text-secondary)'} style={{ lineHeight: 0 }} />
                    <span>{t('conversation.welcome.downloadLocalFile')}</span>
                  </div>
                  {/* bdpan is a desktop-only bridge (mossAdapter has no bdpan.* mappings on the
                      web host), so hide this entry there. */}
                  {isElectronDesktop() && (
                    <div
                      className='flex items-center gap-10px px-10px h-38px rd-8px cursor-pointer text-14px text-foreground transition-colors hover:bg-hover active:bg-active'
                      onClick={() => {
                        setFileMenuOpen(false);
                        setBdpanSelectorVisible(true);
                      }}
                    >
                      <img src={BdpanLogo} alt='Bdpan' style={{ width: 16, height: 16 }} />
                      <span>{t('conversation.welcome.downloadBdpanFile')}</span>
                    </div>
                  )}
                </div>
              }
            >
              <span className='relative'>
                <Button shape='circle' type='secondary' title={t('conversation.welcome.downloadLocalFile')} icon={<Plus theme='outline' strokeWidth={4} fill={'var(--text-secondary)'} />} />
                {selectedFileCount > 0 && <span className='absolute -right-3px -top-3px f-center min-w-14px h-14px rounded-full bg-primary px-3px text-9px text-white font-600 pointer-events-none'>{selectedFileCount}</span>}
              </span>
            </Dropdown>
            <AgentModeSelector
              backend={backend}
              conversationId={conversation_id}
              compact
              initialMode={sessionMode}
              compactLeadingIcon={<Shield theme='outline' fill='currentColor' />}
              modeLabelFormatter={(mode) => t(`agentMode.${mode.value}`, { defaultValue: mode.label })}
              compactLabelPrefix={t('agentMode.permission')}
            />
            <AcpConfigSelector conversationId={conversation_id} backend={backend} />
            <Button size='mini' type='text' onClick={() => openBrowserSessionWindow(conversation_id, true)}>
              {t('conversation.browserSession.controls')}
            </Button>
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
      <BdpanImportFilePicker
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
