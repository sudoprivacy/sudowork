/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { useCallback } from 'react';
import { type TFunction } from 'i18next';
import type { NavigateFunction } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { TProviderWithModel } from '@/common/storage';
import { emitter } from '@/renderer/utils/emitter';
import { updateWorkspaceTime } from '@/renderer/utils/workspaceHistory';
import { isAcpRoutedPresetType, type PresetAgentType } from '@/types/acpTypes';
import { getPresetByAgentId, resolveSessionMode } from '@/common/presets/presetResolver';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import type { AcpBackend, AvailableAgent, EffectiveAgentInfo } from '../types';

export type GuidSendDeps = {
  // Input state
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  files: string[];
  setFiles: React.Dispatch<React.SetStateAction<string[]>>;
  dir: string;
  setDir: React.Dispatch<React.SetStateAction<string>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  selectedSkills?: string[];

  // Agent state
  selectedAgent: AcpBackend | 'custom';
  selectedAgentKey: string;
  selectedAgentInfo: AvailableAgent | undefined;
  isPresetAgent: boolean;
  selectedMode: string;
  selectedAcpModel: string | null;
  currentModel: TProviderWithModel | undefined;

  /** Current session mode (remote/local) for enterprise mode */
  sessionMode: 'remote' | 'local';

  // Agent helpers
  findAgentByKey: (key: string) => AvailableAgent | undefined;
  getEffectiveAgentType: (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined) => EffectiveAgentInfo;
  resolvePresetRulesAndSkills: (agentInfo: { backend: AcpBackend; customAgentId?: string; context?: string } | undefined) => Promise<{ rules?: string; skills?: string }>;
  resolveEnabledSkills: (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined) => string[] | undefined;
  isMainAgentAvailable: (agentType: string) => boolean;
  getAvailableFallbackAgent: () => string | null;
  currentEffectiveAgentInfo: EffectiveAgentInfo;
  isGoogleAuth: boolean;

  // Mention state reset
  setMentionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMentionQuery: React.Dispatch<React.SetStateAction<string | null>>;
  setMentionSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMentionActiveIndex: React.Dispatch<React.SetStateAction<number>>;

  // Agent/skills reset
  resetAgentSelection: () => void;
  setSelectedSkills: React.Dispatch<React.SetStateAction<string[]>>;

  // Navigation & tabs
  navigate: NavigateFunction;
  closeAllTabs: () => void;
  openTab: (conversation: any) => void;
  t: TFunction;
};

export type GuidSendResult = {
  handleSend: () => Promise<void>;
  sendMessageHandler: () => void;
  isButtonDisabled: boolean;
};

/**
 * Hook that manages the send logic for all conversation types.
 */
export const useGuidSend = (deps: GuidSendDeps): GuidSendResult => {
  const {
    input,
    setInput,
    files,
    setFiles,
    dir,
    setDir,
    setLoading,
    selectedSkills,
    selectedAgent,
    selectedAgentKey,
    selectedAgentInfo,
    isPresetAgent,
    selectedMode,
    selectedAcpModel,
    currentModel,
    sessionMode,
    findAgentByKey,
    getEffectiveAgentType,
    resolvePresetRulesAndSkills,
    resolveEnabledSkills,
    isMainAgentAvailable,
    getAvailableFallbackAgent,
    setMentionOpen,
    setMentionQuery,
    setMentionSelectorOpen,
    setMentionActiveIndex,
    resetAgentSelection,
    setSelectedSkills,
    navigate,
    closeAllTabs,
    openTab,
    t,
  } = deps;

  const { isEnterprise } = useAppMode();

  const handleSend = useCallback(async () => {
    const isCustomWorkspace = !!dir;
    const finalWorkspace = dir || '';

    const agentInfo = selectedAgentInfo;
    const isPreset = isPresetAgent;

    const { agentType: effectiveAgentType } = getEffectiveAgentType(agentInfo);

    const { rules: presetRules } = await resolvePresetRulesAndSkills(agentInfo);
    const enabledSkills = resolveEnabledSkills(agentInfo);
    const scodeAgentInfo = findAgentByKey('scode');
    const hasScodeCli = Boolean(scodeAgentInfo?.cliPath);

    let finalEffectiveAgentType = effectiveAgentType;
    if (isPreset && !isMainAgentAvailable(effectiveAgentType)) {
      const fallback = getAvailableFallbackAgent();
      if (fallback && fallback !== effectiveAgentType) {
        finalEffectiveAgentType = fallback;
        Message.info(
          t('guid.autoSwitchedAgent', {
            defaultValue: `${effectiveAgentType} is not available, switched to ${fallback}`,
            from: effectiveAgentType,
            to: fallback,
          })
        );
      }
    }

    // Enterprise Remote mode: route through remote-agent
    // 企业 Remote 模式：使用 remote-agent
    // Local mode in enterprise: use ACP scode path (same as consumer)
    // 企业 Local 模式：使用 ACP scode 路径（与 C 端相同）
    if ((isEnterprise && sessionMode === 'remote') || selectedAgentKey === 'remote-agent') {
      console.log('Enterprise mode: Creating remote-agent conversation');

      try {
        // Directly call conversation.create, Provider handles Moss API internally
        // 直接调用 conversation.create，Provider 内部处理 Moss API 调用
        // This avoids duplicate Moss session creation
        // 这避免了重复创建 Moss session
        const conversation = await ipcBridge.conversation.create.invoke({
          type: 'remote-agent',
          name: input,
          model: {} as TProviderWithModel,
          extra: {
            workspace: finalWorkspace,
            backend: 'remote-agent',
            agentName: agentInfo?.name || 'Moss Server',
            presetAssistantId: agentInfo?.customAgentId || agentInfo?.name || 'Moss Server',
            enabledSkills: isEnterprise && isPreset ? enabledSkills : undefined,
            sessionMode: selectedMode,
            dangerouslySkipPermissions: selectedMode === 'yolo',
            sessionModeParam: 'remote',
          },
        });

        if (!conversation || !conversation.id) {
          alert('Failed to create remote agent conversation');
          return;
        }

        console.log(`Remote agent conversation created: ${conversation.id}`);

        // Bind the conversation to the Dify enhancement orchestrator if the
        // chosen assistant has Dify enhancement enabled. This is a best-effort
        // call: failures (offline server, non-enhanced assistant, missing
        // token) just leave the session unbound and AcpAgent runs as today.
        try {
          const { bindAssistantSession } = await import('@/renderer/shared/dify/sessionBinding');
          await bindAssistantSession({
            conversationId: conversation.id,
            presetAssistantIdOrName: agentInfo?.customAgentId || agentInfo?.name,
          });
        } catch (bindErr) {
          console.warn('[Dify] bindSession on create failed:', bindErr);
        }

        // Store initial message for AcpSendBox to read
        // 存储初始消息供 AcpSendBox 使用
        const initialMessageData = {
          input,
          files: files.length > 0 ? files : undefined,
          skills: selectedSkills || [],
        };
        sessionStorage.setItem(`remote_initial_message_${conversation.id}`, JSON.stringify(initialMessageData));

        // Navigate to conversation page
        // 导航到会话页面
        await navigate(`/conversation/${conversation.id}`);
        emitter.emit('chat.history.refresh');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        alert(`Failed to create remote agent conversation: ${errorMessage}`);
        throw error;
      }
      return;
    }

    // Non-enterprise: scode availability check
    if ((selectedAgent === 'scode' || finalEffectiveAgentType === 'scode') && !hasScodeCli) {
      Message.error(
        t('guid.agentNotAvailable', {
          defaultValue: 'Sudo Code is not available. Please install or repair the runtime.',
        })
      );
      return;
    }

    // ACP path (including preset with claude agent type)
    {
      // Local mode: ACP path
      // Agent-type fallback only applies to preset assistants whose primary agent
      // was unavailable and got switched (e.g. claude → gemini).  For non-preset
      // agents (including extension-contributed ACP adapters with backend='custom'),
      // we must keep the original selectedAgent so the correct backend/cliPath is used.
      const agentTypeChanged = isPreset && selectedAgent !== finalEffectiveAgentType;
      const acpBackend: string | undefined = agentTypeChanged ? finalEffectiveAgentType : isPreset && isAcpRoutedPresetType(finalEffectiveAgentType as PresetAgentType) ? finalEffectiveAgentType : selectedAgent;

      const acpAgentInfo = agentTypeChanged ? findAgentByKey(acpBackend as string) : agentInfo || findAgentByKey(selectedAgentKey);

      if (!acpAgentInfo && !isPreset) {
        console.warn(`${acpBackend} CLI not found, but proceeding to let conversation panel handle it.`);
      }

      try {
        // For presets with a non-gemini backend (e.g. claude), don't pass the
        // UI's Gemini model — let the backend resolve the model itself.
        const isGeminiBackend = acpBackend === 'gemini';
        const conversation = await ipcBridge.conversation.create.invoke({
          type: 'acp',
          name: input,
          model: isGeminiBackend ? currentModel! : ({} as TProviderWithModel),
          extra: {
            defaultFiles: files,
            workspace: finalWorkspace,
            customWorkspace: isCustomWorkspace,
            backend: acpBackend as import('@/types/acpTypes').AcpBackendAll | undefined,
            cliPath: acpAgentInfo?.cliPath,
            agentName: acpAgentInfo?.name,
            customAgentId: acpAgentInfo?.customAgentId,
            presetContext: isPreset ? presetRules : undefined,
            enabledSkills: isPreset ? enabledSkills : undefined,
            presetAssistantId: isPreset ? agentInfo?.customAgentId || acpAgentInfo?.customAgentId : undefined,
            sessionMode: isPreset ? resolveSessionMode(getPresetByAgentId(agentInfo?.customAgentId)?.defaultMode, acpBackend, selectedMode) : selectedMode,
            currentModelId: selectedAcpModel || undefined,
            sessionModeParam: 'local',
          },
        });

        if (!conversation || !conversation.id) {
          console.error('Failed to create ACP conversation - conversation object is null or missing id');
          return;
        }

        // Bind the conversation to Dify enhancement when the chosen assistant
        // is a sudohub preset. Non-preset / custom assistants get a no-op since
        // resolveSudohubAssistantId returns null for them.
        if (isPreset) {
          try {
            const { bindAssistantSession } = await import('@/renderer/shared/dify/sessionBinding');
            await bindAssistantSession({
              conversationId: conversation.id,
              presetAssistantIdOrName: agentInfo?.customAgentId || acpAgentInfo?.customAgentId,
            });
          } catch (bindErr) {
            console.warn('[Dify] bindSession on ACP create failed:', bindErr);
          }
        }

        if (isCustomWorkspace) {
          closeAllTabs();
          updateWorkspaceTime(finalWorkspace);
          openTab(conversation);
        }

        emitter.emit('chat.history.refresh');

        const initialMessage = {
          input,
          files: files.length > 0 ? files : undefined,
          skills: selectedSkills || [],
        };
        sessionStorage.setItem(`acp_initial_message_${conversation.id}`, JSON.stringify(initialMessage));

        await navigate(`/conversation/${conversation.id}`);
      } catch (error: unknown) {
        console.error('Failed to create ACP conversation:', error);
        throw error;
      }
    }
  }, [
    input,
    files,
    dir,
    selectedAgent,
    selectedAgentKey,
    selectedAgentInfo,
    isPresetAgent,
    selectedMode,
    selectedAcpModel,
    currentModel,
    sessionMode,
    findAgentByKey,
    getEffectiveAgentType,
    resolvePresetRulesAndSkills,
    resolveEnabledSkills,
    isMainAgentAvailable,
    getAvailableFallbackAgent,
    navigate,
    closeAllTabs,
    openTab,
    t,
  ]);

  const sendMessageHandler = useCallback(() => {
    setLoading(true);
    handleSend()
      .then(() => {
        setInput('');
        setMentionOpen(false);
        setMentionQuery(null);
        setMentionSelectorOpen(false);
        setMentionActiveIndex(0);
        setFiles([]);
        setDir('');
        // 重置助手选择和技能，确保返回 Guide 页面时为初始状态
        resetAgentSelection();
        setSelectedSkills([]);
      })
      .catch((error) => {
        console.error('Failed to send message:', error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [handleSend, setLoading, setInput, setMentionOpen, setMentionQuery, setMentionSelectorOpen, setMentionActiveIndex, setFiles, setDir, resetAgentSelection, setSelectedSkills]);

  // Calculate button disabled state
  const isButtonDisabled = !input.trim();

  return {
    handleSend,
    sendMessageHandler,
    isButtonDisabled,
  };
};
