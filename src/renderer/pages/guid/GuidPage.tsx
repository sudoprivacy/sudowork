/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveLocaleKey } from '@/common/utils';
import { useInputFocusRing } from '@/renderer/hooks/useInputFocusRing';
import { openExternalUrl, isElectronDesktop } from '@/renderer/utils/platform';
import { useConversationTabs } from '@/renderer/pages/conversation/context/ConversationTabsContext';
import { ThemeSwitcher } from '@/renderer/components/ThemeSwitcher';
import { getInstalledSkillDisplay, resolveSkillIcon } from '@/renderer/utils/skillDisplay';
import { useSkillSelectorController, type SkillSelectorItem, stripAtQuery } from '@/renderer/hooks/useSkillSelectorController';
import { useDirectoryFiles } from '@/renderer/hooks/useWorkspaceFiles';
import SkillSelectorMenu, { type SkillSelectorMenuItem } from '@/renderer/components/SkillSelectorMenu';
import AgentPillBar from './components/AgentPillBar';
import AssistantSelectionArea from './components/AssistantSelectionArea';
import { AgentPillBarSkeleton, AssistantsSkeleton } from './components/GuidSkeleton';
import GuidActionRow from './components/GuidActionRow';
import SkillSettings from '../settings/SkillSettings';
import AgentSettings from '../settings/AgentSettings';
import SecuritySettings from '../settings/SecuritySettings';
import WebuiSettings from '../settings/WebuiSettings';
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
import { ConfigProvider, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { skillHub } from '@/common/ipcBridge';
import { useAddEventListener } from '@/renderer/utils/emitter';
import styles from './index.module.css';

const GuidPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const guidContainerRef = useRef<HTMLDivElement>(null);
  const { closeAllTabs, openTab } = useConversationTabs();
  const { activeBorderColor, inactiveBorderColor, activeShadow } = useInputFocusRing();
  const localeKey = resolveLocaleKey(i18n.language);
  // 从 URL query param 读取当前功能菜单和 skill
  const searchParams = new URLSearchParams(location.search);
  const selectedMenu = searchParams.get('menu');
  const skillParam = searchParams.get('skill');

  // 技能选择器状态
  const [installedSkills, setInstalledSkills] = useState<any[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  // 关闭功能菜单面板，回到普通 GuidPage
  const handleBackToChat = useCallback(() => {
    void navigate('/guid', { replace: true });
  }, [navigate]);

  // 获取已安装的技能
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

  // 处理 skill 参数 - 自动添加技能到选中列表
  useEffect(() => {
    if (skillParam && installedSkillsLoaded) {
      // 检查技能是否存在于已安装列表中
      const skillExists = installedSkills.some((s) => s.name === skillParam);
      if (skillExists && !selectedSkills.includes(skillParam)) {
        setSelectedSkills([...selectedSkills, skillParam]);
        Message.success(`已添加技能：${skillParam}`);
      } else if (!skillExists) {
        Message.warning(`技能未安装：${skillParam}`);
      }
      // 清理 URL 参数
      void navigate('/guid', { replace: true, state: location.state });
    }
  }, [skillParam, installedSkillsLoaded]);

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
  });

  const guidInput = useGuidInput({
    locationState: location.state as { workspace?: string } | null,
  });

  // 获取当前选中助手的 enabledSkills 列表
  const agentEnabledSkills = useMemo(() => {
    return agentSelection.resolveEnabledSkills(agentSelection.selectedAgentInfo);
  }, [agentSelection.selectedAgentInfo, agentSelection.resolveEnabledSkills]);

  // 转换已安装技能为选择器项（根据选中助手过滤）
  const skillSelectorItems = useMemo<SkillSelectorItem[]>(() => {
    const items = installedSkills.map((skill) => {
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
    // 如果当前助手指定了关联技能列表，则只显示关联的技能
    if (agentEnabledSkills && agentEnabledSkills.length > 0) {
      return items.filter((item) => agentEnabledSkills.includes(item.name));
    }
    return items;
  }, [installedSkills, agentEnabledSkills]);

  // Fetch workspace files for @ file references (only when dir is set)
  const dirFiles = useDirectoryFiles(guidInput.dir);

  // 技能选择器控制器
  const skillSelectorController = useSkillSelectorController({
    input: guidInput.input,
    skills: skillSelectorItems,
    files: dirFiles.files,
    hasFiles: !!guidInput.dir,
    selectedSkills,
    onSelectSkill: (skillName) => {
      if (!selectedSkills.includes(skillName)) {
        setSelectedSkills([...selectedSkills, skillName]);
      }
      // Strip @query from input
      const cleaned = stripAtQuery(guidInput.input);
      guidInput.setInput(cleaned.trim() ? cleaned : '');
    },
    onSelectFile: (_file, newInput) => {
      guidInput.setInput(newInput);
    },
    onRemoveSkill: (skillName) => {
      setSelectedSkills(selectedSkills.filter((s) => s !== skillName));
    },
  });

  // Tab definitions for the selector menu
  const guidSelectorTabs = useMemo(() => {
    if (!skillSelectorController.showFilesTab) return undefined;
    return [
      { key: 'skills' as const, label: t('messages.skills.title', { defaultValue: 'Skills' }) },
      { key: 'files' as const, label: t('messages.files.title', { defaultValue: 'Files' }) },
    ];
  }, [skillSelectorController.showFilesTab, t]);

  // 转换为菜单项用于渲染
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
    availableAgents: agentSelection.availableAgents,
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

  // 监听 guid.reset 事件，重置所有用户输入状态（新建会话时触发）
  const handleGuidReset = useCallback(() => {
    // 重置输入内容
    guidInput.setInput('');
    guidInput.setFiles([]);
    guidInput.setDir('');
    // 重置助手选择
    agentSelection.resetSelection();
    // 重置技能选择
    setSelectedSkills([]);
    // 重置 mention 状态
    mention.setMentionOpen(false);
    mention.setMentionQuery(null);
    mention.setMentionSelectorVisible(false);
    mention.setMentionSelectorOpen(false);
    mention.setMentionActiveIndex(0);
  }, [guidInput, agentSelection, mention]);

  useAddEventListener('guid.reset', handleGuidReset, [handleGuidReset]);

  // 通过 @ 按钮触发技能选择器
  const handleTriggerSkillSelector = useCallback(() => {
    guidInput.setInput('@');
    guidInput.handleTextareaFocus();
  }, [guidInput.setInput, guidInput.handleTextareaFocus]);

  // --- Coordinated handlers (depend on multiple hooks) ---
  const handleInputChange = useCallback(
    (value: string) => {
      guidInput.setInput(value);
      const match = value.match(mention.mentionMatchRegex);
      // 首页不根据输入 @ 呼起 mention 列表，占位符里的 @agent 仅为提示，选 agent 用顶部栏或下拉手动选
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
      // 优先处理技能选择器键盘事件
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
      agentSelection.setSelectedAgentKey(key);
      mention.setMentionOpen(false);
      mention.setMentionQuery(null);
      mention.setMentionSelectorOpen(false);
      mention.setMentionActiveIndex(0);
    },
    [agentSelection.setSelectedAgentKey, mention.setMentionOpen, mention.setMentionQuery, mention.setMentionSelectorOpen, mention.setMentionActiveIndex]
  );

  const handleSelectAssistant = useCallback(
    (assistantId: string) => {
      agentSelection.setSelectedAgentKey(assistantId);
      mention.setMentionOpen(false);
      mention.setMentionQuery(null);
      mention.setMentionSelectorOpen(false);
      mention.setMentionActiveIndex(0);
    },
    [agentSelection.setSelectedAgentKey, mention.setMentionOpen, mention.setMentionQuery, mention.setMentionSelectorOpen, mention.setMentionActiveIndex]
  );

  // Typewriter placeholder
  const typewriterPlaceholder = useTypewriterPlaceholder(t('conversation.welcome.placeholder'));

  // Determine if model selector should be in Gemini mode
  const isGeminiMode = (agentSelection.selectedAgent === 'gemini' && !agentSelection.isPresetAgent) || (agentSelection.isPresetAgent && agentSelection.currentEffectiveAgentInfo.agentType === 'gemini' && agentSelection.currentEffectiveAgentInfo.isAvailable);

  // Build the mention dropdown node
  const mentionDropdownNode = <MentionDropdown menuRef={mention.mentionMenuRef} options={mention.filteredMentionOptions} selectedKey={mention.mentionMenuSelectedKey} onSelect={mention.selectMentionAgent} />;

  // Build the model selector node
  const modelSelectorNode = <GuidModelSelector isGeminiMode={isGeminiMode} modelList={modelSelection.modelList} currentModel={modelSelection.currentModel} setCurrentModel={modelSelection.setCurrentModel} geminiModeLookup={modelSelection.geminiModeLookup} currentAcpCachedModelInfo={agentSelection.currentAcpCachedModelInfo} selectedAcpModel={agentSelection.selectedAcpModel} setSelectedAcpModel={agentSelection.setSelectedAcpModel} />;

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
      onClosePresetTag={() => agentSelection.setSelectedAgentKey('gemini')}
      onTriggerSkillSelector={handleTriggerSkillSelector}
      loading={guidInput.loading}
      isButtonDisabled={send.isButtonDisabled}
      onSend={() => {
        send.handleSend().catch((error) => {
          console.error('Failed to send message:', error);
        });
      }}
    />
  );

  return (
    <ConfigProvider getPopupContainer={() => guidContainerRef.current || document.body}>
      <div ref={guidContainerRef} className={styles.guidContainer}>
        <div className='absolute top-12px right-16px z-10'>
          <ThemeSwitcher />
        </div>
        {selectedMenu ? (
          /* 功能菜单内容区域 - 完全清空展示新内容 */
          <div className={styles.functionMenuContainer}>
            {selectedMenu === 'skill-store' && <SkillSettings />}
            {selectedMenu === 'agent' && <AgentSettings />}
            {selectedMenu === 'security' && <SecuritySettings />}
            {selectedMenu === 'webui' && <WebuiSettings />}
          </div>
        ) : (
          /* 正常会话区域 */
          <div className={styles.guidLayout}>
            <p className='text-2xl font-semibold mb-6 text-0 text-center' onClick={handleBackToChat}>
              {t('conversation.welcome.title')}
            </p>

            {agentSelection.availableAgents === undefined ? <AgentPillBarSkeleton /> : agentSelection.availableAgents.length > 0 ? <AgentPillBar availableAgents={agentSelection.availableAgents} selectedAgentKey={agentSelection.selectedAgentKey} getAgentKey={agentSelection.getAgentKey} onSelectAgent={handleSelectAgentFromPillBar} /> : null}

            <PromptTemplates
              visible={!agentSelection.isPresetAgent && !guidInput.input.trim()}
              onSelectPrompt={(content) => {
                guidInput.setInput(content);
                guidInput.handleTextareaFocus();
              }}
            />

            <GuidInputCard
              input={guidInput.input}
              onInputChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onPaste={guidInput.onPaste}
              onFocus={guidInput.handleTextareaFocus}
              onBlur={guidInput.handleTextareaBlur}
              placeholder={`${mention.selectedAgentLabel}, ${typewriterPlaceholder || t('conversation.welcome.placeholder')}`}
              isInputActive={guidInput.isInputFocused}
              isFileDragging={guidInput.isFileDragging}
              activeBorderColor={activeBorderColor}
              inactiveBorderColor={inactiveBorderColor}
              activeShadow={activeShadow}
              dragHandlers={guidInput.dragHandlers}
              mentionOpen={mention.mentionOpen}
              mentionSelectorBadge={<MentionSelectorBadge visible={mention.mentionSelectorVisible} open={mention.mentionSelectorOpen} onOpenChange={mention.setMentionSelectorOpen} agentLabel={mention.selectedAgentLabel} mentionMenu={mentionDropdownNode} onResetQuery={() => mention.setMentionQuery(null)} />}
              mentionDropdown={mentionDropdownNode}
              skillSelectorOpen={skillSelectorController.isOpen}
              skillSelectorMenu={
                skillSelectorController.isOpen ? (
                  <SkillSelectorMenu
                    title='技能'
                    items={skillMenuItems}
                    selectedKeys={selectedSkills}
                    activeIndex={skillSelectorController.activeIndex}
                    onHoverItem={(index) => skillSelectorController.setActiveIndex(index)}
                    onSelectItem={(item) => {
                      const targetIndex = skillSelectorController.filteredSkills.findIndex((skill) => skill.name === item.name);
                      if (targetIndex >= 0) {
                        skillSelectorController.onSelectByIndex(targetIndex);
                      }
                    }}
                    emptyText='暂无技能'
                    tabs={guidSelectorTabs}
                    activeTab={skillSelectorController.activeTab}
                    onTabChange={skillSelectorController.setActiveTab}
                    fileItems={skillSelectorController.filteredFiles}
                    onSelectFile={(file) => {
                      const idx = skillSelectorController.filteredFiles.findIndex((f) => f.fullPath === file.fullPath);
                      if (idx >= 0) {
                        skillSelectorController.onSelectByIndex(idx);
                      }
                    }}
                    fileEmptyText='暂无文件'
                    fileLoading={dirFiles.loading}
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

            {agentSelection.availableAgents === undefined ? <AssistantsSkeleton /> : <AssistantSelectionArea isPresetAgent={agentSelection.isPresetAgent} selectedAgentInfo={agentSelection.selectedAgentInfo} customAgents={agentSelection.customAgents} localeKey={localeKey} currentEffectiveAgentInfo={agentSelection.currentEffectiveAgentInfo} onSelectAssistant={handleSelectAssistant} onSetInput={guidInput.setInput} onFocusInput={guidInput.handleTextareaFocus} />}
          </div>
        )}

        <QuickActionButtons onOpenLink={openLink} inactiveBorderColor={inactiveBorderColor} activeShadow={activeShadow} />
      </div>
    </ConfigProvider>
  );
};

export default GuidPage;
