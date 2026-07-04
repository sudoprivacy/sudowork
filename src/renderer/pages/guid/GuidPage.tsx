/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { EditTwo, Left, Robot } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { mutate } from 'swr';
import { useAddEventListener } from '@/renderer/utils/emitter';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { skillHub } from '@/common/ipcBridge';
import { useAuth } from '@/renderer/context/AuthContext';
import { ipcBridge } from '@/common';
import { resolveAssistantName } from '@/renderer/shared/agents/assistantAdapter';
import SkillSelectorMenu, { type SkillSelectorMenuItem } from '@/renderer/components/SkillSelectorMenu';
import { useSkillSelectorController, type SkillSelectorItem, stripAtQuery } from '@/renderer/hooks/useSkillSelectorController';
import { getInstalledSkillDisplay, resolveSkillIcon } from '@/renderer/utils/skillDisplay';
import { useConversationTabs } from '@/renderer/pages/conversation/context/ConversationTabsContext';
import { openExternalUrl, isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { useInputFocusRing } from '@/renderer/hooks/useInputFocusRing';
import { resolveLocaleKey } from '@/common/utils';
import { DEFAULT_PRESET_AGENT_TYPE, normalizePresetAgentType } from '@/types/acpTypes';
import AssistantEditDrawer from '../agents/components/AssistantEditDrawer';
import AssistantSelectionArea from './components/AssistantSelectionArea';
import AssistantAgentDropdown from './components/AssistantAgentDropdown';
import { CUSTOM_AVATAR_IMAGE_MAP } from './constants';
import { AgentPillBarSkeleton, AssistantsSkeleton } from './components/GuidSkeleton';
import GuidActionRow from './components/GuidActionRow';
import AgentPillBar from './components/AgentPillBar';
import GuidInputCard from './components/GuidInputCard';
import GuidModelSelector from './components/GuidModelSelector';
import MentionDropdown from './components/MentionDropdown';
import MentionSelectorBadge from './components/MentionSelectorBadge';
import PromptTemplates from './components/PromptTemplates';
import QuickActionButtons from './components/QuickActionButtons';
import { useGuidAgentSelection } from './hooks/useGuidAgentSelection';
import { useGuidInput } from './hooks/useGuidInput';
import { useGuidMention } from './hooks/useGuidMention';
import { useGuidModelSelection } from './hooks/useGuidModelSelection';
import { useGuidSend } from './hooks/useGuidSend';
import { useTypewriterPlaceholder } from './hooks/useTypewriterPlaceholder';
import { getGuidDraft, setGuidDraft } from './hooks/useGuidDraft';
import type { AcpBackendConfig } from './types';
import styles from './index.module.css';

const GuidPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const guidContainerRef = useRef<HTMLDivElement>(null);
  const { closeAllTabs, openTab } = useConversationTabs();
  const { activeBorderColor, inactiveBorderColor, activeShadow } = useInputFocusRing();
  const localeKey = resolveLocaleKey(i18n.language);
  const { isEnterprise } = useAppMode();
  const { user } = useAuth();
  const draft = getGuidDraft();
  // Read current skill and assistant from URL query params
  const searchParams = new URLSearchParams(location.search);
  const skillParam = searchParams.get('skill');
  const assistantParam = searchParams.get('assistant');

  // Skill selector state
  const [installedSkills, setInstalledSkills] = useState<any[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(draft?.selectedSkills ?? []);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Edit drawer state
  const [editDrawerVisible, setEditDrawerVisible] = useState(false);

  // Close menu panel, return to normal GuidPage
  const handleBackToChat = useCallback(() => {
    void navigate('/guid', { replace: true });
  }, [navigate]);

  // Load installed skills
  const [installedSkillsLoaded, setInstalledSkillsLoaded] = useState(false);
  useEffect(() => {
    if (!isElectronDesktop()) return;
    const fetchInstalledSkills = async () => {
      try {
        const res = await skillHub.getInstalledSkills.invoke();
        if (res.success && res.data) {
          setInstalledSkills(res.data);
          setInstalledSkillsLoaded(true);
        } else {
          setInstalledSkillsLoaded(true);
        }
      } catch (err) {
        console.error('Failed to fetch installed skills:', err);
        setInstalledSkillsLoaded(true);
      }
    };
    void fetchInstalledSkills();
  }, []);

  // Re-fetch installed skills when skills are changed (install, uninstall, update, import, toggle)
  useAddEventListener('skills.changed', async () => {
    if (!isElectronDesktop()) return;
    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        setInstalledSkills(res.data);
      }
    } catch (err) {
      console.error('Failed to re-fetch installed skills after change:', err);
    }
  });

  // Handle skill parameter - auto-add skill to selected list
  useEffect(() => {
    if (skillParam && installedSkillsLoaded) {
      const skillExists = installedSkills.some((s) => s.name === skillParam);
      if (skillExists && !selectedSkills.includes(skillParam)) {
        setSelectedSkills([...selectedSkills, skillParam]);
        Message.success(t('guid.skillAdded', { name: skillParam }));
      } else if (!skillExists) {
        Message.warning(t('guid.skillNotInstalled', { name: skillParam }));
      }
      void navigate('/guid', { replace: true, state: location.state });
    }
  }, [skillParam, installedSkillsLoaded]);

  useEffect(() => {
    setGuidDraft({ selectedSkills });
  }, [selectedSkills]);

  // Open external link
  const openLink = useCallback(async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (error) {
      console.error('Failed to open external link:', error);
    }
  }, []);

  // --- Hooks ---
  const modelSelection = useGuidModelSelection();

  const agentSelection = useGuidAgentSelection({
    modelList: modelSelection.modelList,
    isGoogleAuth: modelSelection.isGoogleAuth,
    localeKey,
    assistantFromUrl: assistantParam,
  });

  const guidInput = useGuidInput({
    locationState: location.state as { workspace?: string } | null,
  });

  // Pre-fill input with defaultInitPrompt when assistant is pre-selected from URL parameter
  // Use a ref to track whether we've already pre-filled for this assistant
  const prefilledAssistantRef = useRef<string | null>(null);
  useEffect(() => {
    if (!assistantParam || !agentSelection.customAgents || agentSelection.customAgents.length === 0) return;
    if (!agentSelection.selectedAgentKey.startsWith('custom:')) return;

    const assistantId = agentSelection.selectedAgentKey.slice(7);

    // Skip if we've already pre-filled for this assistant
    if (prefilledAssistantRef.current === assistantId) return;

    const assistantConfig = agentSelection.customAgents.find((a) => a.id === assistantId);

    // Only pre-fill if input is empty and assistant has defaultInitPrompt
    if (assistantConfig?.defaultInitPrompt && !guidInput.input.trim()) {
      guidInput.setInput(assistantConfig.defaultInitPrompt);
      prefilledAssistantRef.current = assistantId;
    }
  }, [assistantParam, agentSelection.customAgents, agentSelection.selectedAgentKey, guidInput.input, guidInput.setInput]);

  // Reset prefilledAssistantRef when assistantParam changes or becomes empty
  useEffect(() => {
    if (!assistantParam) {
      prefilledAssistantRef.current = null;
    }
  }, [assistantParam]);

  // Get enabled skills list for the selected assistant
  const agentEnabledSkills = useMemo(() => {
    return agentSelection.resolveEnabledSkills(agentSelection.selectedAgentInfo);
  }, [agentSelection.selectedAgentInfo, agentSelection.resolveEnabledSkills]);

  // Convert installed skills to selector items (filtered by selected assistant)
  const skillSelectorItems = useMemo<SkillSelectorItem[]>(() => {
    const items = installedSkills
      .filter((skill) => !isEnterprise || skill.enabled !== false)
      .map((skill) => {
        const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skill);
        return {
          name: skill.name,
          displayName,
          description,
          icon: icon || resolveSkillIcon(skill.meta?.icon),
          emoji,
          enabled: skill.enabled,
        };
      });
    if (agentEnabledSkills && agentEnabledSkills.length > 0) {
      // Use Set for O(1) lookup and deduplicate agentEnabledSkills
      const enabledSkillSet = new Set(agentEnabledSkills);
      return items.filter((item) => enabledSkillSet.has(item.name));
    }
    // Deduplicate items by name to prevent duplicate keys
    const uniqueItems = Array.from(new Map(items.map((item) => [item.name, item])).values());
    return uniqueItems;
  }, [installedSkills, agentEnabledSkills, isEnterprise]);

  // Skill selector controller
  const skillSelectorController = useSkillSelectorController({
    input: guidInput.input,
    cursorPosition,
    skills: skillSelectorItems,
    selectedSkills,
    onSelectSkill: (skillName) => {
      if (!selectedSkills.includes(skillName)) {
        setSelectedSkills([...selectedSkills, skillName]);
      }
      // Strip the @query from input when selecting a skill, preserving user's other text
      guidInput.setInput(stripAtQuery(guidInput.input, cursorPosition));
    },
    onRemoveSkill: (skillName) => {
      setSelectedSkills(selectedSkills.filter((s) => s !== skillName));
    },
    filterDisabled: true, // Guide page should not show disabled skills
  });

  // Convert to menu items for rendering
  const skillMenuItems = useMemo<SkillSelectorMenuItem[]>(
    () =>
      skillSelectorController.filteredSkills.map((skill) => ({
        key: skill.name,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        icon: skill.icon,
        emoji: skill.emoji,
        enabled: skill.enabled,
      })),
    [skillSelectorController.filteredSkills]
  );

  const mention = useGuidMention({
    availableAgents: agentSelection.mentionAvailableAgents,
    customAgentAvatarMap: agentSelection.customAgentAvatarMap,
    selectedAgentKey: agentSelection.selectedAgentKey,
    setSelectedAgentKey: agentSelection.setSelectedAgentKey,
    setInput: guidInput.setInput,
    selectedAgentInfo: agentSelection.selectedAgentInfo,
  });

  const send = useGuidSend({
    // Input state
    input: guidInput.input,
    setInput: guidInput.setInput,
    files: guidInput.files,
    setFiles: guidInput.setFiles,
    dir: guidInput.dir,
    setDir: guidInput.setDir,
    setLoading: guidInput.setLoading,
    selectedSkills,

    // Agent state
    selectedAgent: agentSelection.selectedAgent,
    selectedAgentKey: agentSelection.selectedAgentKey,
    selectedAgentInfo: agentSelection.selectedAgentInfo,
    isPresetAgent: agentSelection.isPresetAgent,
    selectedMode: agentSelection.selectedMode,
    selectedAcpModel: agentSelection.selectedAcpModel,
    currentModel: modelSelection.currentModel,
    sessionMode: agentSelection.sessionMode,

    // Agent helpers
    findAgentByKey: agentSelection.findAgentByKey,
    getEffectiveAgentType: agentSelection.getEffectiveAgentType,
    resolvePresetRulesAndSkills: agentSelection.resolvePresetRulesAndSkills,
    resolveEnabledSkills: agentSelection.resolveEnabledSkills,
    isMainAgentAvailable: agentSelection.isMainAgentAvailable,
    getAvailableFallbackAgent: agentSelection.getAvailableFallbackAgent,
    currentEffectiveAgentInfo: agentSelection.currentEffectiveAgentInfo,
    isGoogleAuth: modelSelection.isGoogleAuth,

    // Mention state reset
    setMentionOpen: mention.setMentionOpen,
    setMentionQuery: mention.setMentionQuery,
    setMentionSelectorOpen: mention.setMentionSelectorOpen,
    setMentionActiveIndex: mention.setMentionActiveIndex,

    // Agent/skills reset
    resetAgentSelection: agentSelection.resetSelection,
    setSelectedSkills,

    // Navigation & tabs
    navigate,
    closeAllTabs,
    openTab,
    t,
  });

  // Listen for guid.reset event to reset agent/mention state only
  const handleGuidReset = useCallback(() => {
    setGuidDraft({ input: '' });
    agentSelection.resetSelection();
    setCursorPosition(0);
    mention.setMentionOpen(false);
    mention.setMentionQuery(null);
    mention.setMentionSelectorVisible(false);
    mention.setMentionSelectorOpen(false);
    mention.setMentionActiveIndex(0);
    prefilledAssistantRef.current = null;
  }, [agentSelection, mention]);

  useAddEventListener('guid.reset', handleGuidReset, [handleGuidReset]);

  // Trigger skill selector via @ button
  const handleTriggerSkillSelector = useCallback(() => {
    const currentInput = guidInput.input;
    const newInput = currentInput.trim() ? `${currentInput} @` : '@';
    guidInput.setInput(newInput);
    setCursorPosition(newInput.length);
    // Focus the textarea and move cursor to end so skill selector opens immediately
    setTimeout(() => {
      const textarea = guidContainerRef.current?.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        const len = newInput.length;
        textarea.setSelectionRange(len, len);
      }
    }, 0);
  }, [guidInput.input, guidInput.setInput]);

  // --- Coordinated handlers (depend on multiple hooks) ---
  const handleInputChange = useCallback(
    (value: string) => {
      guidInput.setInput(value);
      const match = value.match(mention.mentionMatchRegex);
      if (match) {
        mention.setMentionQuery(match[1]);
        mention.setMentionOpen(false);
      } else {
        mention.setMentionQuery(null);
        mention.setMentionOpen(false);
      }
    },
    [mention.mentionMatchRegex, guidInput.setInput, mention.setMentionQuery, mention.setMentionOpen]
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Handle skill selector keyboard events first
      if (skillSelectorController.isOpen) {
        const handled = skillSelectorController.onKeyDown(event);
        if (handled) return;
      }

      if ((mention.mentionOpen || mention.mentionSelectorOpen) && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        if (mention.filteredMentionOptions.length === 0) return;
        mention.setMentionActiveIndex((prev) => {
          if (event.key === 'ArrowDown') {
            return (prev + 1) % mention.filteredMentionOptions.length;
          }
          return (prev - 1 + mention.filteredMentionOptions.length) % mention.filteredMentionOptions.length;
        });
        return;
      }
      if ((mention.mentionOpen || mention.mentionSelectorOpen) && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (mention.filteredMentionOptions.length > 0) {
          const query = mention.mentionQuery?.toLowerCase();
          const exactMatch = query ? mention.filteredMentionOptions.find((option) => option.label.toLowerCase() === query || option.tokens.has(query)) : undefined;
          const selected = exactMatch || mention.filteredMentionOptions[mention.mentionActiveIndex] || mention.filteredMentionOptions[0];
          if (selected) {
            mention.selectMentionAgent(selected.key);
            return;
          }
        }
        mention.setMentionOpen(false);
        mention.setMentionQuery(null);
        mention.setMentionSelectorOpen(false);
        mention.setMentionActiveIndex(0);
        return;
      }
      if (mention.mentionOpen && (event.key === 'Backspace' || event.key === 'Delete') && !mention.mentionQuery) {
        mention.setMentionOpen(false);
        mention.setMentionQuery(null);
        mention.setMentionActiveIndex(0);
        return;
      }
      if (!mention.mentionOpen && mention.mentionSelectorVisible && !guidInput.input.trim() && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault();
        mention.setMentionSelectorVisible(false);
        mention.setMentionSelectorOpen(false);
        mention.setMentionActiveIndex(0);
        return;
      }
      if ((mention.mentionOpen || mention.mentionSelectorOpen) && event.key === 'Escape') {
        event.preventDefault();
        mention.setMentionOpen(false);
        mention.setMentionQuery(null);
        mention.setMentionSelectorOpen(false);
        mention.setMentionActiveIndex(0);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (!guidInput.input.trim()) return;
        send.sendMessageHandler();
      }
    },
    [mention, guidInput.input, send.sendMessageHandler]
  );

  const handleSelectAgentFromPillBar = useCallback(
    (key: string) => {
      // If clicking on the currently selected agent, deselect it and clear input
      // BUT: when only one agent is available (enterprise mode), don't allow deselection
      if (agentSelection.selectedAgentKey === key) {
        // Skip deselection when only one agent available (enterprise mode: single remote-agent)
        if (agentSelection.availableAgents && agentSelection.availableAgents.length === 1) {
          return;
        }
        agentSelection.resetSelection();
        guidInput.setInput('');
        prefilledAssistantRef.current = null;
      } else {
        agentSelection.setSelectedAgentKey(key);
      }
      mention.setMentionOpen(false);
      mention.setMentionQuery(null);
      mention.setMentionSelectorOpen(false);
      mention.setMentionActiveIndex(0);
    },
    [agentSelection.selectedAgentKey, agentSelection.availableAgents, agentSelection.setSelectedAgentKey, agentSelection.resetSelection, guidInput.setInput, mention.setMentionOpen, mention.setMentionQuery, mention.setMentionSelectorOpen, mention.setMentionActiveIndex]
  );

  const handleSelectAssistant = useCallback(
    (assistantId: string) => {
      agentSelection.setSelectedAgentKey(assistantId);
      mention.setMentionOpen(false);
      mention.setMentionQuery(null);
      mention.setMentionSelectorOpen(false);
      mention.setMentionActiveIndex(0);

      // Pre-fill input with defaultInitPrompt if available
      // assistantId format is "custom:xxx" or "builtin-xxx", need to strip prefix for lookup
      const lookupId = assistantId.startsWith('custom:') ? assistantId.slice(7) : assistantId;
      const assistantConfig = agentSelection.customAgents.find((a) => a.id === lookupId);
      if (assistantConfig?.defaultInitPrompt) {
        guidInput.setInput(assistantConfig.defaultInitPrompt);
      }
    },
    [agentSelection.setSelectedAgentKey, agentSelection.customAgents, mention.setMentionOpen, mention.setMentionQuery, mention.setMentionSelectorOpen, mention.setMentionActiveIndex, guidInput.setInput]
  );

  // Handle back button: deselect assistant and return to normal view
  const handleBackFromAssistant = useCallback(() => {
    agentSelection.resetSelection();
    guidInput.setInput('');
    prefilledAssistantRef.current = null;
  }, [agentSelection.resetSelection, guidInput.setInput]);

  // Handle changing the assistant's main agent type
  const handleChangeAssistantAgent = useCallback(
    async (newAgentType: string) => {
      const agentInfo = agentSelection.selectedAgentInfo;
      if (!agentInfo?.customAgentId) return;

      try {
        // Use assistantHub.updateAssistantMeta to save to _sudowork_meta.json
        const lookupName = resolveAssistantName(agentInfo.customAgentId);
        await ipcBridge.assistantHub.updateAssistantMeta.invoke({
          name: lookupName,
          updates: { presetAgentType: newAgentType },
        });

        // Refresh agents to pick up the change
        await ipcBridge.acpConversation.refreshCustomAgents.invoke();
        await mutate('acp.agents.available');

        // Refresh custom agents in the hook
        await agentSelection.refreshCustomAgents();
      } catch (error) {
        console.error('Failed to change assistant agent type:', error);
        Message.error(t('common.failed', { defaultValue: 'Failed' }));
      }
    },
    [agentSelection.selectedAgentInfo, agentSelection.refreshCustomAgents, t]
  );

  // Handle edit drawer saved
  const handleEditDrawerSaved = useCallback(async () => {
    await agentSelection.refreshCustomAgents();
  }, [agentSelection.refreshCustomAgents]);

  // Typewriter placeholder
  const typewriterPlaceholder = useTypewriterPlaceholder(t('conversation.welcome.placeholder'));

  // Determine if model selector should be in Gemini mode
  const isGeminiMode = (agentSelection.selectedAgent === 'gemini' && !agentSelection.isPresetAgent) || (agentSelection.isPresetAgent && agentSelection.currentEffectiveAgentInfo.agentType === 'gemini' && agentSelection.currentEffectiveAgentInfo.isAvailable);

  // Build the mention dropdown node
  const mentionDropdownNode = <MentionDropdown menuRef={mention.mentionMenuRef} options={mention.filteredMentionOptions} selectedKey={mention.mentionMenuSelectedKey} onSelect={mention.selectMentionAgent} />;

  // Build the model selector node
  const modelSelectorNode = (
    <GuidModelSelector
      isGeminiMode={isGeminiMode}
      modelList={modelSelection.modelList}
      currentModel={modelSelection.currentModel}
      setCurrentModel={modelSelection.setCurrentModel}
      geminiModeLookup={modelSelection.geminiModeLookup}
      currentAcpCachedModelInfo={agentSelection.currentAcpCachedModelInfo}
      selectedAcpModel={agentSelection.selectedAcpModel}
      setSelectedAcpModel={agentSelection.setSelectedAcpModel}
    />
  );

  // Build the action row
  const actionRowNode = (
    <GuidActionRow
      files={guidInput.files}
      onFilesUploaded={guidInput.handleFilesUploaded}
      onSelectWorkspace={(dir) => guidInput.setDir(dir)}
      modelSelectorNode={modelSelectorNode}
      selectedAgent={agentSelection.selectedAgent}
      effectiveModeAgent={agentSelection.currentEffectiveAgentInfo.agentType}
      selectedMode={agentSelection.selectedMode}
      onModeSelect={agentSelection.setSelectedMode}
      isPresetAgent={agentSelection.isPresetAgent}
      selectedAgentInfo={agentSelection.selectedAgentInfo}
      customAgents={agentSelection.customAgents}
      localeKey={localeKey}
      onClosePresetTag={() => {
        agentSelection.setSelectedAgentKey('gemini');
        guidInput.setInput('');
        prefilledAssistantRef.current = null;
      }}
      onTriggerSkillSelector={handleTriggerSkillSelector}
      loading={guidInput.loading}
      isButtonDisabled={send.isButtonDisabled}
      onSend={() => {
        send.sendMessageHandler();
      }}
    />
  );

  // --- Resolve selected assistant info for header ---
  const selectedAssistantConfig = useMemo(() => {
    // Show assistant header for any assistant (preset or user-created custom)
    if (!agentSelection.selectedAgentInfo) return null;
    const customAgentId = agentSelection.selectedAgentInfo.customAgentId;
    if (!customAgentId) return null;

    // Include preset agents (builtin + hub-installed) and user-created custom assistants
    const presetAgents = agentSelection.customAgents.filter((a) => a.isPreset);
    const customAgents = agentSelection.customAgents.filter((a) => !a.isPreset);

    // Filter builtin presets to allowed list
    // const allowedPresetIds = ['builtin-ui-ux-pro-max', 'builtin-planning-with-files', 'builtin-beautiful-mermaid', 'builtin-moltbook', 'builtin-copilot', 'builtin-doctor', 'builtin-jiansheku'];
    // const allowedBuiltinPresets = presetAgents.filter((a) => allowedPresetIds.includes(a.id));
    const allowedBuiltinPresets: AcpBackendConfig[] = []; // Hidden: builtin assistants temporarily disabled
    const hubInstalledPresets = presetAgents.filter((a) => !a.id.startsWith('builtin-'));

    // Combine: allowed builtin presets + hub-installed presets + user-created custom assistants
    const filteredAgents = [...allowedBuiltinPresets, ...hubInstalledPresets, ...customAgents];

    return filteredAgents.find((a) => a.id === customAgentId) || null;
  }, [agentSelection.selectedAgentInfo, agentSelection.customAgents]);

  // Resolve avatar for selected assistant header
  const selectedAssistantAvatar = useMemo(() => {
    if (!selectedAssistantConfig) return null;
    const avatarValue = selectedAssistantConfig.avatar?.trim();
    if (!avatarValue) return null;
    const mappedAvatar = CUSTOM_AVATAR_IMAGE_MAP[avatarValue];
    const resolvedAvatar = resolveExtensionAssetUrl(avatarValue);
    const avatarImage = mappedAvatar || resolvedAvatar;
    const isImageAvatar = Boolean(avatarImage && (/\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(avatarImage)));
    return { avatarValue, avatarImage, isImageAvatar };
  }, [selectedAssistantConfig]);

  // Resolve current assistant agent type for dropdown.
  // In enterprise mode, the runtime backend is determined by sessionMode (remote-agent / scode),
  // not by the assistant metadata's presetAgentType. Display the actual backend so the logo
  // matches the conversation that will be created (app logo for enterprise users).
  // 企业模式下真正的后端由 sessionMode 决定（remote-agent / scode），与助手元数据中的 presetAgentType 无关，
  // 这里按实际后端展示，避免本地元数据里残留的 'claude' 导致 logo 误显示。
  const currentAssistantAgentType = useMemo(() => {
    if (!selectedAssistantConfig) return DEFAULT_PRESET_AGENT_TYPE;
    if (isEnterprise) {
      return agentSelection.sessionMode === 'remote' ? 'remote-agent' : 'scode';
    }
    return normalizePresetAgentType(selectedAssistantConfig.presetAgentType) || DEFAULT_PRESET_AGENT_TYPE;
  }, [selectedAssistantConfig, isEnterprise, agentSelection.sessionMode]);

  // Whether we are in selected assistant mode (preset or user-created custom)
  const isAssistantMode = selectedAssistantConfig !== null;

  // Get the suggestion prompts for the selected assistant
  const assistantPrompts = useMemo(() => {
    if (!selectedAssistantConfig) return [];
    return selectedAssistantConfig.promptsI18n?.[localeKey] || selectedAssistantConfig.promptsI18n?.['en-US'] || selectedAssistantConfig.prompts || [];
  }, [selectedAssistantConfig, localeKey]);

  return (
    <div ref={guidContainerRef} className={styles.guidContainer}>
      {/* Normal/Assistant conversation area */}
      <div className={styles.guidLayout}>
        {isAssistantMode ? (
          /* ========== Selected Assistant Mode ========== */
          <>
            {/* Assistant Header: back + avatar + name + edit + agent dropdown */}
            <div className={styles.assistantHeader}>
              <div className='flex items-center gap-12px flex-1 min-w-0'>
                {/* Back button */}
                <div className='flex items-center justify-center w-32px h-32px rd-full cursor-pointer hover:bg-fill-2 transition-colors flex-shrink-0' onClick={handleBackFromAssistant}>
                  <Left theme='outline' size={18} style={{ color: 'var(--color-text-2)' }} />
                </div>

                {/* Avatar */}
                <div className='flex-shrink-0'>
                  {selectedAssistantAvatar?.isImageAvatar && selectedAssistantAvatar.avatarImage ? (
                    <img src={selectedAssistantAvatar.avatarImage} alt='' width={28} height={28} style={{ objectFit: 'contain' }} />
                  ) : selectedAssistantAvatar?.avatarValue ? (
                    <span style={{ fontSize: 24, lineHeight: '28px' }}>{selectedAssistantAvatar.avatarValue}</span>
                  ) : (
                    <Robot theme='outline' size={24} />
                  )}
                </div>

                {/* Name */}
                <span className='text-xl font-semibold text-foreground truncate'>{selectedAssistantConfig.nameI18n?.[localeKey] || selectedAssistantConfig.name}</span>

                {/* Edit button */}
                <div className='flex items-center justify-center w-28px h-28px rd-full cursor-pointer hover:bg-fill-2 transition-colors flex-shrink-0' onClick={() => setEditDrawerVisible(true)}>
                  <EditTwo theme='outline' size={16} style={{ color: 'var(--color-text-3)' }} />
                </div>
              </div>

              {/* Agent dropdown - disabled for preset assistants (builtin or hub-installed) */}
              {agentSelection.availableAgents && agentSelection.availableAgents.length > 0 && (
                <AssistantAgentDropdown availableAgents={agentSelection.availableAgents} currentAgentType={currentAssistantAgentType} onSelectAgent={handleChangeAssistantAgent} disabled={selectedAssistantConfig?.isPreset ?? false} />
              )}
            </div>

            {/* Agent Fallback Notice */}
            {agentSelection.currentEffectiveAgentInfo.isFallback && (
              <div className={styles.agentFallbackNotice}>
                <span>
                  {t('guid.agentFallbackNotice', {
                    original: agentSelection.currentEffectiveAgentInfo.originalType.charAt(0).toUpperCase() + agentSelection.currentEffectiveAgentInfo.originalType.slice(1),
                    fallback: agentSelection.currentEffectiveAgentInfo.agentType.charAt(0).toUpperCase() + agentSelection.currentEffectiveAgentInfo.agentType.slice(1),
                    defaultValue: `${agentSelection.currentEffectiveAgentInfo.originalType} is unavailable, using ${agentSelection.currentEffectiveAgentInfo.agentType} instead.`,
                  })}
                </span>
              </div>
            )}

            {/* Description */}
            <div className={styles.assistantDescription}>{selectedAssistantConfig.descriptionI18n?.[localeKey] || selectedAssistantConfig.description || t('settings.assistantDescriptionPlaceholder', { defaultValue: 'No description' })}</div>
          </>
        ) : (
          /* ========== Normal Mode ========== */
          <>
            <p className='text-2xl font-semibold mb-6 text-0 text-center' onClick={handleBackToChat}>
              {t('conversation.welcome.title')}
            </p>

            {agentSelection.availableAgents === undefined ? (
              <AgentPillBarSkeleton />
            ) : agentSelection.availableAgents.length > 0 ? (
              <AgentPillBar
                availableAgents={agentSelection.availableAgents}
                selectedAgentKey={agentSelection.selectedAgentKey}
                getAgentKey={agentSelection.getAgentKey}
                onSelectAgent={handleSelectAgentFromPillBar}
                sessionMode={agentSelection.sessionMode}
                onSessionModeChange={agentSelection.setSessionMode}
                isEnterprise={isEnterprise}
                localModeAvailable={user?.localModeAvailable}
              />
            ) : null}

            <PromptTemplates
              visible={!agentSelection.isPresetAgent}
              onSelectPrompt={(content) => {
                guidInput.setInput(content);
                guidInput.handleTextareaFocus();
              }}
            />
          </>
        )}

        {/* ========== Input Card (always shown) ========== */}
        <GuidInputCard
          input={guidInput.input}
          onInputChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onPaste={guidInput.onPaste}
          onFocus={guidInput.handleTextareaFocus}
          onBlur={guidInput.handleTextareaBlur}
          onSelect={(e) => {
            const target = e.currentTarget as HTMLTextAreaElement;
            setCursorPosition(target.selectionStart);
          }}
          placeholder={`${mention.selectedAgentLabel}, ${typewriterPlaceholder || t('conversation.welcome.placeholder')}`}
          isInputActive={guidInput.isInputFocused}
          isFileDragging={guidInput.isFileDragging}
          activeBorderColor={activeBorderColor}
          inactiveBorderColor={inactiveBorderColor}
          activeShadow={activeShadow}
          dragHandlers={guidInput.dragHandlers}
          mentionOpen={mention.mentionOpen}
          mentionSelectorBadge={
            <MentionSelectorBadge visible={mention.mentionSelectorVisible} open={mention.mentionSelectorOpen} onOpenChange={mention.setMentionSelectorOpen} agentLabel={mention.selectedAgentLabel} mentionMenu={mentionDropdownNode} onResetQuery={() => mention.setMentionQuery(null)} />
          }
          mentionDropdown={mentionDropdownNode}
          skillSelectorOpen={skillSelectorController.isOpen}
          skillSelectorMenu={
            skillSelectorController.isOpen ? (
              <SkillSelectorMenu
                title={t('guid.skillSelectorTitle')}
                items={skillMenuItems}
                selectedKeys={selectedSkills}
                activeIndex={skillSelectorController.activeIndex}
                onHoverItem={(index) => skillSelectorController.setActiveIndex(index)}
                onSelectItem={(_item) => skillSelectorController.onSelectByIndex(skillSelectorController.activeIndex)}
                emptyText={t('guid.noSkills')}
                searchQuery={skillSelectorController.searchQuery}
                onSearchChange={skillSelectorController.setSearchQuery}
                onDismiss={() => {
                  skillSelectorController.setDismissed(true);
                  guidInput.setInput(stripAtQuery(guidInput.input, cursorPosition));
                }}
              />
            ) : null
          }
          selectedSkills={selectedSkills}
          onRemoveSkill={(skillName) => setSelectedSkills(selectedSkills.filter((s) => s !== skillName))}
          getSkillDisplayName={(skillName) => {
            const skill = installedSkills.find((s) => s.name === skillName);
            const { displayName, emoji } = getInstalledSkillDisplay(skill || { name: skillName, version: '' });
            return { displayName, emoji: emoji || '⚡' };
          }}
          files={guidInput.files}
          onRemoveFile={guidInput.handleRemoveFile}
          dir={guidInput.dir}
          onClearDir={() => guidInput.setDir('')}
          actionRow={actionRowNode}
        />

        {/* ========== Bottom Section ========== */}
        {isAssistantMode ? (
          /* Suggestion prompts for selected assistant */
          assistantPrompts.length > 0 && (
            <div className='mt-16px w-full animate-fade-in'>
              <div className='text-13px mb-8px' style={{ color: 'var(--color-text-3)' }}>
                {t('guid.trySuggestionPrompts', { defaultValue: 'Try these clickable example prompts:' })}
              </div>
              <div className='flex flex-wrap gap-8px'>
                {assistantPrompts.map((prompt: string, index: number) => (
                  <div
                    key={index}
                    className='px-12px py-6px text-13px rd-16px cursor-pointer transition-colors shadow-sm'
                    style={{
                      background: 'var(--bg-2)',
                      color: 'var(--foreground)',
                      border: '1px solid var(--bg-3)',
                    }}
                    onClick={() => {
                      guidInput.setInput(prompt);
                      guidInput.handleTextareaFocus();
                    }}
                  >
                    {prompt}
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          /* Assistant selection grid */
          <>
            {agentSelection.availableAgents === undefined ? (
              <AssistantsSkeleton />
            ) : (
              <AssistantSelectionArea customAgents={agentSelection.customAgents} localeKey={localeKey} onSelectAssistant={handleSelectAssistant} availableAgents={agentSelection.availableAgents} sessionMode={agentSelection.sessionMode} isEnterprise={isEnterprise} />
            )}
          </>
        )}
      </div>

      <QuickActionButtons onOpenLink={openLink} inactiveBorderColor={inactiveBorderColor} activeShadow={activeShadow} />

      {/* Assistant Edit Drawer */}
      <AssistantEditDrawer visible={editDrawerVisible} assistantId={selectedAssistantConfig?.id || null} localeKey={localeKey} onClose={() => setEditDrawerVisible(false)} onSaved={handleEditDrawerSaved} />
    </div>
  );
};

export default GuidPage;
