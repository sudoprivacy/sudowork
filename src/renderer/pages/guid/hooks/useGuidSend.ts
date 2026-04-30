/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TProviderWithModel } from '@/common/storage';
import { emitter } from '@/renderer/utils/emitter';
import { updateWorkspaceTime } from '@/renderer/utils/workspaceHistory';
import { isAcpRoutedPresetType, type PresetAgentType } from '@/types/acpTypes';
import { getPresetByAgentId, resolveSessionMode } from '@/common/presets/presetResolver';
import { Message } from '@arco-design/web-react';
import { useCallback } from 'react';
import { type TFunction } from 'i18next';
import type { NavigateFunction } from 'react-router-dom';
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
 * Hook that manages the send logic for all conversation types (acp/openclaw-gateway).
 */
export const useGuidSend = (deps: GuidSendDeps): GuidSendResult => {
  const { input, setInput, files, setFiles, dir, setDir, setLoading, selectedSkills, selectedAgent, selectedAgentKey, selectedAgentInfo, isPresetAgent, selectedMode, selectedAcpModel, currentModel, findAgentByKey, getEffectiveAgentType, resolvePresetRulesAndSkills, resolveEnabledSkills, isMainAgentAvailable, getAvailableFallbackAgent, currentEffectiveAgentInfo, isGoogleAuth, setMentionOpen, setMentionQuery, setMentionSelectorOpen, setMentionActiveIndex, resetAgentSelection, setSelectedSkills, navigate, closeAllTabs, openTab, t } = deps;

  const handleSend = useCallback(async () => {
    const isCustomWorkspace = !!dir;
    const finalWorkspace = dir || '';

    const agentInfo = selectedAgentInfo;
    const isPreset = isPresetAgent;

    const { agentType: effectiveAgentType } = getEffectiveAgentType(agentInfo);

    const { rules: presetRules } = await resolvePresetRulesAndSkills(agentInfo);
    const enabledSkills = resolveEnabledSkills(agentInfo);

    let finalEffectiveAgentType = effectiveAgentType;
    if (isPreset && !isMainAgentAvailable(effectiveAgentType)) {
      // Only fallback within the same routing category:
      // ACP types (claude, qwen, codebuddy, etc.) can fallback to each other,
      // but never to sudoclaw (OpenClaw Gateway) — they have different capabilities.
      const fallback = getAvailableFallbackAgent();
      const isSameCategory = fallback && fallback !== 'sudoclaw' && effectiveAgentType !== 'sudoclaw';
      if (fallback && fallback !== effectiveAgentType && isSameCategory) {
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

    // Remote Agent path (Moss Server - enterprise mode)
    if (selectedAgent === 'remote-agent' || selectedAgentKey === 'remote-agent') {
      console.log('Enterprise mode: Creating remote-agent conversation');

      try {
        // Directly call conversation.create, Provider handles Moss API internally
        // 直接调用 conversation.create，Provider 内部处理 Moss API 调用
        // This avoids duplicate Moss session creation
        // 这避免了重复创建 Moss session
        const conversation = await ipcBridge.conversation.create.invoke({
          type: 'remote-agent',
          name: input, // Use user input as initial name / 使用用户输入作为初始名称
          model: {} as TProviderWithModel,
          extra: {
            workspace: finalWorkspace,
            backend: 'remote-agent',
            agentName: agentInfo?.name || 'Moss Server',
            presetAssistantId: agentInfo?.name || 'Moss Server',
            sessionMode: selectedMode,
            dangerouslySkipPermissions: selectedMode === 'yolo',
          },
        });

        if (!conversation || !conversation.id) {
          alert('Failed to create remote agent conversation');
          return;
        }

        console.log(`Remote agent conversation created: ${conversation.id}`);

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

    // OpenClaw Gateway path (sudoclaw backend or preset with sudoclaw agent type)
    if (selectedAgent === 'openclaw-gateway' || finalEffectiveAgentType === 'sudoclaw') {
      const openclawAgentInfo = agentInfo || findAgentByKey(selectedAgentKey);

      // For sudoclaw preset, find the openclaw-gateway agent info
      const actualAgentInfo = finalEffectiveAgentType === 'sudoclaw' ? findAgentByKey('openclaw-gateway') : openclawAgentInfo;

      try {
        const conversation = await ipcBridge.conversation.create.invoke({
          type: 'openclaw-gateway',
          name: input,
          model: currentModel!,
          extra: {
            defaultFiles: files,
            workspace: finalWorkspace,
            customWorkspace: isCustomWorkspace,
            backend: actualAgentInfo?.backend,
            cliPath: actualAgentInfo?.cliPath,
            agentName: actualAgentInfo?.name,
            customAgentId: isPreset ? agentInfo?.customAgentId : undefined,
            runtimeValidation: {
              expectedWorkspace: finalWorkspace,
              expectedBackend: actualAgentInfo?.backend,
              expectedAgentName: actualAgentInfo?.name,
              expectedCliPath: actualAgentInfo?.cliPath,
              expectedModel: currentModel?.useModel,
              switchedAt: Date.now(),
            },
            enabledSkills: isPreset ? enabledSkills : undefined,
            // Use original agentInfo's customAgentId for preset assistant
            presetAssistantId: isPreset ? agentInfo?.customAgentId || openclawAgentInfo?.customAgentId : undefined,
            presetContext: isPreset ? presetRules : undefined,
            sessionMode: selectedMode,
            currentModelId: selectedAcpModel || undefined,
          },
        });

        if (!conversation || !conversation.id) {
          alert('Failed to create Sudoclaw conversation. Please ensure the Sudoclaw Gateway is running.');
          return;
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
        sessionStorage.setItem(`openclaw_initial_message_${conversation.id}`, JSON.stringify(initialMessage));

        await navigate(`/conversation/${conversation.id}`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        alert(`Failed to create Sudoclaw conversation: ${errorMessage}`);
        throw error;
      }
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
          },
        });

        if (!conversation || !conversation.id) {
          console.error('Failed to create ACP conversation - conversation object is null or missing id');
          return;
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
  }, [input, files, dir, selectedAgent, selectedAgentKey, selectedAgentInfo, isPresetAgent, selectedMode, selectedAcpModel, currentModel, findAgentByKey, getEffectiveAgentType, resolvePresetRulesAndSkills, resolveEnabledSkills, isMainAgentAvailable, getAvailableFallbackAgent, navigate, closeAllTabs, openTab, t]);

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
