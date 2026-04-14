/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge, skillHub } from '@/common';
import type { IInstalledSkillInfo } from '@/common/ipcBridge';
import { toBackendConfig, resolveAssistantName } from '@/renderer/shared/agents/assistantAdapter';
import type { AssistantCategory } from '@/process/AssistantManager';
import { resolveLocaleKey } from '@/common/utils';
import coworkSvg from '@/renderer/assets/cowork.svg';
import EmojiPicker from '@/renderer/components/EmojiPicker';
import MarkdownView from '@/renderer/components/Markdown';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { getSelectableAssistantSkills, isAutoInjectedBuiltinSkill, sanitizeAssistantEnabledSkills } from '@/renderer/pages/settings/assistantSkillSelection';
import { getInstalledSkillDisplay, normalizeSkillVersion } from '@/renderer/utils/skillDisplay';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { AcpBackendConfig } from '@/types/acpTypes';
import { Avatar, Button, Checkbox, Collapse, Drawer, Input, Message, Modal, Popconfirm, Select, Switch, Tag, Typography } from '@arco-design/web-react';
import { Close, Delete, Lightning, Plus, Robot, Shield } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';
import { useSettingsViewMode } from '../settingsViewContext';

// ==================== Types ====================

type AssistantListItem = AcpBackendConfig & {
  _source?: string;
  _extensionName?: string;
  _kind?: string;
  _category?: AssistantCategory;
  _isHubInstalled?: boolean;
};

type AssistantStoreTab = 'store' | 'exclusive' | 'installed';

// ==================== SkillCard (for drawer skill selection) ====================

interface SkillCardProps {
  skill: IInstalledSkillInfo;
  checked: boolean;
  onToggle: () => void;
}

const SkillCard: React.FC<SkillCardProps> = ({ skill, checked, onToggle }) => {
  const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skill);
  const displayVersion = normalizeSkillVersion(skill.version);

  return (
    <div className='bg-fill-1 rd-12px border border-line p-12px flex items-start gap-12px relative'>
      <Checkbox checked={checked} onChange={onToggle} className='mt-2px cursor-pointer' />
      <div className='w-48px h-48px flex-shrink-0 rd-8px overflow-hidden bg-fill-2'>
        {icon ? (
          <img src={icon} alt={displayName} className='w-full h-full object-cover' />
        ) : emoji ? (
          <div className='w-full h-full flex items-center justify-center text-22px'>{emoji}</div>
        ) : (
          <div className='w-full h-full flex items-center justify-center bg-primary-light'>
            <Lightning size='22' className='text-primary' />
          </div>
        )}
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-6px'>
          <span className='font-medium text-13px text-t-primary truncate'>{displayName}</span>
          {!skill.isBuiltin && displayVersion && <span className='px-5px py-0px bg-fill-3 text-t-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{displayVersion}</span>}
          {skill.isBuiltin && <Shield size='14' className='text-primary flex-shrink-0' />}
        </div>
        {description && <div className='text-11px text-t-secondary mt-3px line-clamp-2 leading-relaxed'>{description}</div>}
      </div>
    </div>
  );
};

// ==================== InstalledAssistantCard ====================

const InstalledAssistantCard: React.FC<{
  assistant: AssistantListItem;
  isExtension: boolean;
  localeKey: string;
  avatarImageMap: Record<string, string>;
  onToggleEnabled: (enabled: boolean) => void;
  onDelete: () => void;
  onClick: () => void;
}> = ({ assistant, isExtension, localeKey, avatarImageMap, onToggleEnabled, onDelete, onClick }) => {
  const isCustom = !assistant.isBuiltin && !isExtension;
  const isEnabled = isExtension ? true : assistant.enabled !== false;

  const resolvedAvatar = assistant.avatar?.trim();
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
  const hasEmojiAvatar = Boolean(resolvedAvatar && emojiRegex.test(resolvedAvatar));

  const resolveAvatarImage = (avatar: string | undefined): string | undefined => {
    const value = avatar?.trim();
    if (!value) return undefined;
    const mapped = avatarImageMap[value];
    if (mapped) return mapped;
    const resolved = resolveExtensionAssetUrl(value) || value;
    const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(resolved);
    return isImage ? resolved : undefined;
  };

  const avatarImage = resolveAvatarImage(resolvedAvatar);
  const displayName = assistant.nameI18n?.[localeKey] || assistant.name;
  const description = assistant.descriptionI18n?.[localeKey] || assistant.description || '';

  return (
    <div
      className={classNames('bg-fill-1 rd-12px border border-line p-12px flex items-start gap-12px relative overflow-hidden transition-colors cursor-pointer hover:bg-fill-2', !isEnabled && 'opacity-65')}
      onClick={onClick}
    >
      {/* Avatar + toggle */}
      <div className='w-48px flex-shrink-0 flex flex-col items-center'>
        <div className='w-48px h-48px rd-8px overflow-hidden bg-fill-2'>
          {avatarImage ? (
            <img src={avatarImage} alt={displayName} className='w-full h-full object-cover' />
          ) : hasEmojiAvatar ? (
            <div className='w-full h-full flex items-center justify-center text-22px'>{resolvedAvatar}</div>
          ) : (
            <div className='w-full h-full flex items-center justify-center bg-primary-light'>
              <Robot theme='filled' size='22' className='text-primary' />
            </div>
          )}
        </div>
        {isCustom && (
          <div
            className='mt-6px w-full flex justify-center'
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Switch size='small' checked={isEnabled} onChange={(checked) => onToggleEnabled(checked)} className={isEnabled ? '!bg-primary !border-primary' : ''} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0 pr-28px'>
        <div className='h-20px flex items-center'>
          <span className='font-medium text-13px text-t-primary truncate'>{displayName}</span>
        </div>
        <div className='mt-3px min-h-30px'>
          {description ? <div className='text-11px text-t-secondary line-clamp-2 leading-15px'>{description}</div> : <div className='text-11px text-t-tertiary italic line-clamp-2 leading-15px'>{assistant.id}</div>}
        </div>
      </div>

      {/* Top-right: shield (builtin) or delete (custom) */}
      <div className='absolute top-10px right-10px' onClick={(e) => e.stopPropagation()}>
        {assistant.isBuiltin || isExtension ? (
          <div className='w-22px h-22px flex items-center justify-center text-primary' title='内置助手'>
            <Shield size='15' />
          </div>
        ) : (
          <Popconfirm title='确认删除该助手？' onOk={onDelete} okText='删除' cancelText='取消' okButtonProps={{ status: 'danger' }}>
            <div className='w-22px h-22px flex items-center justify-center text-t-tertiary hover:text-danger cursor-pointer transition-colors'>
              <Delete size='15' />
            </div>
          </Popconfirm>
        )}
      </div>
    </div>
  );
};

// ==================== AgentModalContent ====================

const AgentModalContent: React.FC = () => {
  const { t, i18n } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const [agentMessage, agentMessageContext] = Message.useMessage({ maxCount: 10 });
  const localeKey = resolveLocaleKey(i18n.language);

  // Tab state
  const [activeTab, setActiveTab] = useState<AssistantStoreTab>('installed');

  // Assistant list state
  const [assistants, setAssistants] = useState<AssistantListItem[]>([]);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);

  // Drawer state
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContext, setEditContext] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editAgent, setEditAgent] = useState<string>('sudoclaw');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [promptViewMode, setPromptViewMode] = useState<'edit' | 'preview'>('preview');
  const [drawerWidth, setDrawerWidth] = useState(500);

  // Skills state
  const [installedSkills, setInstalledSkills] = useState<IInstalledSkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [availableBackends, setAvailableBackends] = useState<Set<string>>(new Set(['gemini']));
  const textareaWrapperRef = useRef<HTMLDivElement>(null);

  const avatarImageMap = React.useMemo<Record<string, string>>(
    () => ({
      'cowork.svg': coworkSvg,
      '🛠️': coworkSvg,
    }),
    []
  );

  // Extension data
  const { data: extensionAcpAdapters } = useSWR('extensions.acpAdapters', () => ipcBridge.extensions.getAcpAdapters.invoke().catch(() => [] as Record<string, unknown>[]));
  const { data: extensionAssistants } = useSWR('extensions.assistants', () => ipcBridge.extensions.getAssistants.invoke().catch(() => [] as Record<string, unknown>[]));

  const normalizedExtensionAssistants = React.useMemo<AssistantListItem[]>(() => {
    if (!Array.isArray(extensionAssistants) || extensionAssistants.length === 0) return [];
    return extensionAssistants
      .map((ext) => {
        const id = typeof ext.id === 'string' ? ext.id : '';
        const name = typeof ext.name === 'string' ? ext.name : '';
        if (!id || !name) return null;
        return {
          id,
          name,
          nameI18n: ext.nameI18n as Record<string, string> | undefined,
          description: typeof ext.description === 'string' ? ext.description : undefined,
          descriptionI18n: ext.descriptionI18n as Record<string, string> | undefined,
          avatar: typeof ext.avatar === 'string' ? ext.avatar : undefined,
          presetAgentType: typeof ext.presetAgentType === 'string' ? ext.presetAgentType : undefined,
          context: typeof ext.context === 'string' ? ext.context : undefined,
          contextI18n: ext.contextI18n as Record<string, string> | undefined,
          models: Array.isArray(ext.models) ? (ext.models as string[]) : undefined,
          enabledSkills: Array.isArray(ext.enabledSkills) ? (ext.enabledSkills as string[]) : undefined,
          prompts: Array.isArray(ext.prompts) ? (ext.prompts as string[]) : undefined,
          promptsI18n: ext.promptsI18n as Record<string, string[]> | undefined,
          isPreset: true,
          isBuiltin: false,
          enabled: true,
          _source: 'extension',
          _extensionName: typeof ext._extensionName === 'string' ? ext._extensionName : undefined,
          _kind: typeof ext._kind === 'string' ? ext._kind : undefined,
        } as AssistantListItem;
      })
      .filter((item): item is AssistantListItem => item !== null);
  }, [extensionAssistants]);

  const isExtensionAssistant = useCallback((assistant: AssistantListItem | null | undefined) => {
    if (!assistant) return false;
    return assistant._source === 'extension' || assistant.id.startsWith('ext-');
  }, []);

  // Auto focus textarea when drawer opens
  useEffect(() => {
    if (editVisible && promptViewMode === 'edit') {
      const timer = setTimeout(() => {
        const textarea = textareaWrapperRef.current?.querySelector('textarea');
        textarea?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [editVisible, promptViewMode]);

  useEffect(() => {
    const updateDrawerWidth = () => {
      if (typeof window === 'undefined') return;
      const nextWidth = Math.min(500, Math.max(320, Math.floor(window.innerWidth - 32)));
      setDrawerWidth(nextWidth);
    };
    updateDrawerWidth();
    window.addEventListener('resize', updateDrawerWidth);
    return () => window.removeEventListener('resize', updateDrawerWidth);
  }, []);

  // Load available agent backends
  useEffect(() => {
    void (async () => {
      try {
        const resp = await ipcBridge.acpConversation.getAvailableAgents.invoke();
        if (resp.success && resp.data) {
          setAvailableBackends(new Set(resp.data.map((a) => a.backend)));
        }
      } catch {
        // fallback to default
      }
    })();
  }, []);

  // Load installed skills
  const loadInstalledSkills = useCallback(async (): Promise<IInstalledSkillInfo[]> => {
    if (!isElectronDesktop()) {
      setInstalledSkills([]);
      return [];
    }
    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        const selectableSkills = getSelectableAssistantSkills(res.data);
        setInstalledSkills(selectableSkills);
        return selectableSkills;
      }
    } catch (error) {
      console.error('Failed to load installed skills:', error);
    }
    setInstalledSkills([]);
    return [];
  }, []);

  const customSelectableSkills = installedSkills.filter((skill) => !skill.isBuiltin);
  const builtinSelectableSkills = installedSkills.filter((skill) => skill.isBuiltin && !isAutoInjectedBuiltinSkill(skill));

  const refreshAgentDetection = useCallback(async () => {
    try {
      await ipcBridge.acpConversation.refreshCustomAgents.invoke();
      await mutate('acp.agents.available');
    } catch {
      // ignore
    }
  }, []);

  const loadAssistantContext = useCallback(
    async (assistantId: string): Promise<string> => {
      try {
        const content = await ipcBridge.fs.readAssistantRule.invoke({ assistantId, locale: localeKey });
        return content || '';
      } catch (error) {
        console.error(`Failed to load rule for ${assistantId}:`, error);
        return '';
      }
    },
    [localeKey]
  );

  const sortAssistants = useCallback((agents: AssistantListItem[]) => {
    const builtinOrder = ['builtin-copilot', 'builtin-sudoclaw-doctor'];
    return agents
      .filter((agent) => agent.isPreset)
      .sort((a, b) => {
        const indexA = builtinOrder.indexOf(a.id);
        const indexB = builtinOrder.indexOf(b.id);
        if (indexA !== -1 || indexB !== -1) {
          if (indexA === -1) return 1;
          if (indexB === -1) return -1;
          return indexA - indexB;
        }
        return 0;
      });
  }, []);

  const loadAssistants = useCallback(async () => {
    try {
      // Fetch raw IAssistantInfo[] and convert to AssistantListItem with _category preserved
      const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
      const localAgents: AssistantListItem[] = (result?.data ?? []).map((info) => ({
        ...toBackendConfig(info),
        _category: info.category,
        _isHubInstalled: info.isHubInstalled,
      }));

      const mergedAgents = [...localAgents];
      for (const extAssistant of normalizedExtensionAssistants) {
        if (!mergedAgents.some((agent) => agent.id === extAssistant.id)) {
          mergedAgents.push(extAssistant);
        }
      }

      const allowedBuiltinIds = new Set(['builtin-copilot', 'builtin-sudoclaw-doctor']);
      const filteredAgents = mergedAgents.filter((agent) => {
        // Builtin assistants: only show explicitly allowed ones
        if (agent.isBuiltin) return allowedBuiltinIds.has(agent.id);
        // All non-builtin assistants (custom, hub, extension) pass through
        return true;
      });

      const sortedAssistants = sortAssistants(filteredAgents);
      setAssistants(sortedAssistants);
      setActiveAssistantId((prev) => {
        if (prev && sortedAssistants.some((assistant) => assistant.id === prev)) return prev;
        return sortedAssistants[0]?.id || null;
      });
    } catch (error) {
      console.error('Failed to load assistant presets:', error);
    }
  }, [normalizedExtensionAssistants, sortAssistants]);

  useEffect(() => {
    void loadAssistants();
  }, [loadAssistants]);

  const activeAssistant = assistants.find((assistant) => assistant.id === activeAssistantId) || null;
  const isReadonlyAssistant = Boolean(activeAssistant && isExtensionAssistant(activeAssistant));

  // Categorize assistants into 3 groups by metadata (mirrors skill pattern: source_type / isBuiltin)
  const hubAssistants = assistants.filter((a) => !a.isBuiltin && a._isHubInstalled);
  const builtinAssistants = assistants.filter((a) => a.isBuiltin || isExtensionAssistant(a));
  const customAssistants = assistants.filter((a) => !a.isBuiltin && !a._isHubInstalled && !isExtensionAssistant(a));

  // Avatar helpers
  const isEmoji = useCallback((str: string) => {
    if (!str) return false;
    const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
    return emojiRegex.test(str);
  }, []);

  const resolveAvatarImageSrc = useCallback(
    (avatar: string | undefined): string | undefined => {
      const value = avatar?.trim();
      if (!value) return undefined;
      const mapped = avatarImageMap[value];
      if (mapped) return mapped;
      const resolved = resolveExtensionAssetUrl(value) || value;
      const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(resolved);
      return isImage ? resolved : undefined;
    },
    [avatarImageMap]
  );

  // ==================== CRUD Handlers ====================

  const handleEdit = async (assistant: AssistantListItem) => {
    setIsCreating(false);
    setActiveAssistantId(assistant.id);
    setEditName(assistant.nameI18n?.[localeKey] || assistant.name || '');
    setEditDescription(assistant.descriptionI18n?.[localeKey] || assistant.description || '');
    setEditAvatar(assistant.avatar || '');
    setEditAgent(assistant.presetAgentType || 'sudoclaw');
    setEditVisible(true);

    if (isExtensionAssistant(assistant)) {
      setPromptViewMode('preview');
      setEditContext(assistant.context || '');
      setInstalledSkills([]);
      setSelectedSkills(Array.isArray(assistant.enabledSkills) ? assistant.enabledSkills : []);
      return;
    }

    try {
      const context = await loadAssistantContext(assistant.id);
      setEditContext(context);
      const availableSkills = await loadInstalledSkills();
      setSelectedSkills(sanitizeAssistantEnabledSkills(assistant.enabledSkills, availableSkills));
    } catch (error) {
      console.error('Failed to load assistant content:', error);
      setEditContext('');
      setInstalledSkills([]);
      setSelectedSkills([]);
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setActiveAssistantId(null);
    setEditName('');
    setEditDescription('');
    setEditContext('');
    setEditAvatar('🤖');
    setEditAgent('sudoclaw');
    setSelectedSkills([]);
    setPromptViewMode('edit');
    setEditVisible(true);
    await loadInstalledSkills();
  };

  const handleSave = async () => {
    try {
      if (!editName.trim()) {
        agentMessage.error(t('settings.assistantNameRequired', { defaultValue: 'Assistant name is required' }));
        return;
      }

      if (!isCreating && activeAssistant && isExtensionAssistant(activeAssistant)) {
        agentMessage.warning(t('settings.extensionAssistantReadonly', { defaultValue: 'Extension assistants are read-only. You can duplicate it and edit the copy.' }));
        return;
      }

      if (isCreating) {
        const newId = `custom-${Date.now()}`;
        await ipcBridge.assistantHub.createAssistant.invoke({
          meta: {
            id: newId,
            nameI18n: { 'zh-CN': editName },
            descriptionI18n: editDescription ? { 'zh-CN': editDescription } : undefined,
            avatar: editAvatar,
            presetAgentType: editAgent,
            enabled: true,
            source_type: 'custom',
            enabledSkills: sanitizeAssistantEnabledSkills(selectedSkills, installedSkills),
          },
          ruleContent: editContext.trim() || undefined,
        });
        setActiveAssistantId(newId);
        await loadAssistants();
        agentMessage.success(t('common.createSuccess', { defaultValue: 'Created successfully' }));
      } else {
        if (!activeAssistant) return;
        const lookupName = resolveAssistantName(activeAssistant.id);
        await ipcBridge.assistantHub.updateAssistantMeta.invoke({
          name: lookupName,
          updates: {
            nameI18n: { 'zh-CN': editName },
            descriptionI18n: editDescription ? { 'zh-CN': editDescription } : undefined,
            avatar: editAvatar,
            presetAgentType: editAgent,
            enabledSkills: sanitizeAssistantEnabledSkills(selectedSkills, installedSkills),
          },
        });

        if (editContext.trim()) {
          await ipcBridge.fs.writeAssistantRule.invoke({
            assistantId: activeAssistant.id,
            locale: localeKey,
            content: editContext,
          });
        }

        await loadAssistants();
        agentMessage.success(t('common.saveSuccess', { defaultValue: 'Saved successfully' }));
      }

      setEditVisible(false);
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to save assistant:', error);
      agentMessage.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  const handleDeleteClick = () => {
    if (!activeAssistant) return;
    if (activeAssistant.isBuiltin) {
      agentMessage.warning(t('settings.cannotDeleteBuiltin', { defaultValue: 'Cannot delete builtin assistants' }));
      return;
    }
    if (isExtensionAssistant(activeAssistant)) {
      agentMessage.warning(t('settings.extensionAssistantReadonly', { defaultValue: 'Extension assistants are read-only. You can duplicate it and edit the copy.' }));
      return;
    }
    setDeleteConfirmVisible(true);
  };

  const handleDeleteConfirm = async () => {
    if (!activeAssistant) return;
    try {
      const lookupName = resolveAssistantName(activeAssistant.id);
      await ipcBridge.assistantHub.uninstallAssistant.invoke({ name: lookupName });
      await loadAssistants();
      setDeleteConfirmVisible(false);
      setEditVisible(false);
      agentMessage.success(t('common.success', { defaultValue: 'Success' }));
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to delete assistant:', error);
      agentMessage.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  const handleDeleteFromCard = async (assistant: AssistantListItem) => {
    try {
      const lookupName = resolveAssistantName(assistant.id);
      await ipcBridge.assistantHub.uninstallAssistant.invoke({ name: lookupName });
      await loadAssistants();
      agentMessage.success(t('common.success', { defaultValue: 'Success' }));
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to delete assistant:', error);
      agentMessage.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  const handleToggleEnabled = async (assistant: AssistantListItem, enabled: boolean) => {
    if (isExtensionAssistant(assistant)) {
      agentMessage.warning(t('settings.extensionAssistantReadonly', { defaultValue: 'Extension assistants are read-only. You can duplicate it and edit the copy.' }));
      return;
    }
    try {
      const lookupName = resolveAssistantName(assistant.id);
      if (enabled) {
        await ipcBridge.assistantHub.enableAssistant.invoke({ name: lookupName });
      } else {
        await ipcBridge.assistantHub.disableAssistant.invoke({ name: lookupName });
      }
      await loadAssistants();
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to toggle assistant:', error);
      agentMessage.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  // ==================== Render helpers ====================

  const editAvatarImage = resolveAvatarImageSrc(editAvatar);

  const renderAssistantGrid = (list: AssistantListItem[]) => (
    <div className='grid grid-cols-2 gap-8px'>
      {list.map((assistant) => (
        <InstalledAssistantCard
          key={assistant.id}
          assistant={assistant}
          isExtension={isExtensionAssistant(assistant)}
          localeKey={localeKey}
          avatarImageMap={avatarImageMap}
          onToggleEnabled={(enabled) => void handleToggleEnabled(assistant, enabled)}
          onDelete={() => void handleDeleteFromCard(assistant)}
          onClick={() => void handleEdit(assistant)}
        />
      ))}
    </div>
  );

  // ==================== Main render ====================

  return (
    <div className='flex flex-col h-full w-full'>
      {agentMessageContext}

      {/* Header: tabs + create button */}
      <div className='flex items-center gap-12px mb-12px'>
        {/* Tab switcher */}
        <div className='flex items-center bg-fill-2 rd-8px p-2px gap-1px flex-shrink-0'>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'store' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('store')}>
            {t('settings.assistant.storeTab', { defaultValue: '助手库' })}
          </button>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'exclusive' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('exclusive')}>
            {t('settings.assistant.exclusiveTab', { defaultValue: '专属助手' })}
          </button>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'installed' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('installed')}>
            {t('settings.assistant.installedTab', { defaultValue: '我的助手' })}
            {assistants.length > 0 && <span className='ml-5px px-5px py-0px bg-primary text-white text-10px rd-full leading-16px'>{assistants.length}</span>}
          </button>
        </div>

        {/* Spacer */}
        <div className='flex-1' />

        {/* Create button — only on installed tab */}
        {activeTab === 'installed' && (
          <button
            type='button'
            className='group h-34px px-4 py-0 border border-solid rd-999px flex items-center gap-8px flex-shrink-0 cursor-pointer transition-all outline-none bg-[color-mix(in_srgb,var(--color-fill-2)_84%,transparent)] border-[color-mix(in_srgb,var(--color-border-2)_70%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-primary-light-1)_58%,transparent)] hover:border-[color-mix(in_srgb,var(--color-primary)_36%,transparent)]'
            onClick={() => void handleCreate()}
          >
            <span className='w-22px h-22px rd-full flex items-center justify-center bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-[var(--color-primary)] transition-transform group-hover:scale-105'>
              <Plus size='13' />
            </span>
            <span className='flex items-baseline gap-5px leading-none'>
              <span className='text-12px font-medium text-t-primary'>{t('settings.createAssistant', { defaultValue: '创建' })}</span>
              <span className='text-11px text-t-secondary'>{t('settings.customAssistants', { defaultValue: '自定义助手' })}</span>
            </span>
          </button>
        )}
      </div>

      {/* ===== STORE TAB (placeholder) ===== */}
      {activeTab === 'store' && (
        <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode}>
          <div className='flex flex-col items-center justify-center py-48px text-t-secondary gap-8px'>
            <Robot theme='outline' size={32} className='text-t-tertiary' />
            <span className='text-13px'>{t('settings.assistant.comingSoon', { defaultValue: '敬请期待' })}</span>
          </div>
        </AionScrollArea>
      )}

      {/* ===== EXCLUSIVE TAB (placeholder) ===== */}
      {activeTab === 'exclusive' && (
        <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode}>
          <div className='flex flex-col items-center justify-center py-48px text-t-secondary gap-8px'>
            <Shield size={32} className='text-t-tertiary' />
            <span className='text-13px'>{t('settings.assistant.comingSoon', { defaultValue: '敬请期待' })}</span>
          </div>
        </AionScrollArea>
      )}

      {/* ===== INSTALLED TAB ===== */}
      {activeTab === 'installed' && (
        <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode}>
          {assistants.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-48px gap-8px'>
              <Robot theme='outline' size={32} className='text-t-tertiary' />
              <div className='text-13px text-t-secondary'>{t('settings.assistantsEmpty', { defaultValue: '暂无助手' })}</div>
              <div className='text-12px text-t-tertiary'>{t('settings.assistantsEmptyHint', { defaultValue: '点击下方"创建助手"按钮添加你的助手' })}</div>
              <Button size='small' type='outline' className='mt-4px' onClick={() => handleCreate()}>
                {t('settings.createAssistant', { defaultValue: '创建助手' })}
              </Button>
            </div>
          ) : (
            <div className='pb-16px space-y-20px'>
              {/* Custom assistants section */}
              <section>
                <div className='flex items-center justify-between gap-8px mb-10px'>
                  <div className='text-13px font-medium text-t-primary'>{t('settings.customAssistants', { defaultValue: '自定义助手' })}</div>
                  <span className='px-6px py-0px bg-fill-2 text-t-secondary text-11px rd-full leading-18px'>{customAssistants.length}</span>
                </div>
                {customAssistants.length > 0 ? (
                  renderAssistantGrid(customAssistants)
                ) : (
                  <div className='bg-fill-1 border border-dashed border-line rd-12px px-14px py-18px text-12px text-t-tertiary'>{t('settings.noCustomAssistants', { defaultValue: '暂无自定义助手' })}</div>
                )}
              </section>

              {/* Hub/store assistants section */}
              <section>
                <div className='flex items-center justify-between gap-8px mb-10px'>
                  <div className='text-13px font-medium text-t-primary'>{t('settings.hubAssistants', { defaultValue: '商店助手' })}</div>
                  <span className='px-6px py-0px bg-fill-2 text-t-secondary text-11px rd-full leading-18px'>{hubAssistants.length}</span>
                </div>
                {hubAssistants.length > 0 ? (
                  renderAssistantGrid(hubAssistants)
                ) : (
                  <div className='bg-fill-1 border border-dashed border-line rd-12px px-14px py-18px text-12px text-t-tertiary'>{t('settings.noHubAssistants', { defaultValue: '暂无商店助手' })}</div>
                )}
              </section>

              {/* Builtin assistants section */}
              <section>
                <div className='flex items-center justify-between gap-8px mb-10px'>
                  <div className='text-13px font-medium text-t-primary'>{t('settings.builtinAssistants', { defaultValue: '内置助手' })}</div>
                  <span className='px-6px py-0px bg-fill-2 text-t-secondary text-11px rd-full leading-18px'>{builtinAssistants.length}</span>
                </div>
                {builtinAssistants.length > 0 ? (
                  renderAssistantGrid(builtinAssistants)
                ) : (
                  <div className='bg-fill-1 border border-dashed border-line rd-12px px-14px py-18px text-12px text-t-tertiary'>{t('settings.noBuiltinAssistants', { defaultValue: '暂无内置助手' })}</div>
                )}
              </section>
            </div>
          )}
        </AionScrollArea>
      )}

      {/* ==================== Edit Drawer ==================== */}
      <Drawer
        title={
          <>
            <span>{isCreating ? t('settings.createAssistant', { defaultValue: 'Create Assistant' }) : t('settings.editAssistant', { defaultValue: 'Assistant Details' })}</span>
            <div
              onClick={(e) => {
                e.stopPropagation();
                setEditVisible(false);
              }}
              className='absolute right-4 top-2 cursor-pointer text-t-secondary hover:text-t-primary transition-colors p-1'
              style={{ zIndex: 10, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Close size={18} />
            </div>
          </>
        }
        closable={false}
        visible={editVisible}
        placement='right'
        width={drawerWidth}
        zIndex={1200}
        autoFocus={false}
        onCancel={() => {
          setEditVisible(false);
        }}
        headerStyle={{ background: 'var(--color-bg-1)' }}
        bodyStyle={{ background: 'var(--color-bg-1)' }}
        footer={
          <div className='flex items-center justify-between w-full'>
            <div className='flex items-center gap-8px'>
              <Button type='primary' onClick={handleSave} disabled={!isCreating && isReadonlyAssistant} className='w-[100px] rounded-[100px]'>
                {isCreating ? t('common.create', { defaultValue: 'Create' }) : t('common.save', { defaultValue: 'Save' })}
              </Button>
              <Button
                onClick={() => {
                  setEditVisible(false);
                }}
                className='w-[100px] rounded-[100px] bg-fill-2'
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
            </div>
            {!isCreating && !activeAssistant?.isBuiltin && !isExtensionAssistant(activeAssistant) && (
              <Button status='danger' onClick={handleDeleteClick} className='rounded-[100px]' style={{ backgroundColor: 'rgb(var(--danger-1))' }}>
                {t('common.delete', { defaultValue: 'Delete' })}
              </Button>
            )}
          </div>
        }
      >
        <div className='flex flex-col h-full overflow-hidden'>
          <div className='flex flex-col flex-1 gap-16px bg-fill-2 rounded-16px p-20px overflow-y-auto'>
            {/* Name & Avatar */}
            <div className='flex-shrink-0'>
              <Typography.Text bold>
                <span className='text-red-500'>*</span> {t('settings.assistantNameAvatar', { defaultValue: 'Name & Avatar' })}
              </Typography.Text>
              <div className='mt-10px flex items-center gap-12px'>
                {activeAssistant?.isBuiltin || isReadonlyAssistant ? (
                  <Avatar shape='square' size={40} className='bg-bg-1 rounded-4px'>
                    {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar ? <span className='text-24px'>{editAvatar}</span> : <Robot theme='outline' size={20} />}
                  </Avatar>
                ) : (
                  <EmojiPicker value={editAvatar} onChange={(emoji) => setEditAvatar(emoji)} placement='br'>
                    <div className='cursor-pointer'>
                      <Avatar shape='square' size={40} className='bg-bg-1 rounded-4px hover:bg-fill-2 transition-colors'>
                        {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar ? <span className='text-24px'>{editAvatar}</span> : <Robot theme='outline' size={20} />}
                      </Avatar>
                    </div>
                  </EmojiPicker>
                )}
                <Input value={editName} onChange={(value) => setEditName(value)} disabled={activeAssistant?.isBuiltin || isReadonlyAssistant} placeholder={t('settings.agentNamePlaceholder', { defaultValue: 'Enter a name for this agent' })} className='flex-1 rounded-4px bg-bg-1' />
              </div>
            </div>

            {/* Description */}
            <div className='flex-shrink-0'>
              <Typography.Text bold>{t('settings.assistantDescription', { defaultValue: 'Assistant Description' })}</Typography.Text>
              <Input className='mt-10px rounded-4px bg-bg-1' value={editDescription} onChange={(value) => setEditDescription(value)} disabled={activeAssistant?.isBuiltin || isReadonlyAssistant} placeholder={t('settings.assistantDescriptionPlaceholder', { defaultValue: 'What can this assistant help with?' })} />
            </div>

            {/* Main Agent */}
            <div className='flex-shrink-0'>
              <Typography.Text bold>{t('settings.assistantMainAgent', { defaultValue: 'Main Agent' })}</Typography.Text>
              <Select className='mt-10px w-full rounded-4px' value={editAgent} onChange={(value) => setEditAgent(value as string)} disabled={isReadonlyAssistant}>
                {[
                  { value: 'gemini', label: 'Gemini CLI' },
                  { value: 'claude', label: 'Claude Code' },
                  { value: 'qwen', label: 'Qwen Code' },
                  { value: 'codex', label: 'Codex' },
                  { value: 'codebuddy', label: 'CodeBuddy' },
                  { value: 'opencode', label: 'OpenCode' },
                  { value: 'sudoclaw', label: 'SudoClaw', backendId: 'openclaw-gateway' },
                ]
                  .filter((opt) => availableBackends.has(opt.backendId || opt.value))
                  .map((opt) => (
                    <Select.Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Option>
                  ))}
                {extensionAcpAdapters?.map((adapter) => {
                  const id = adapter.id as string;
                  const name = (adapter.name as string) || id;
                  return (
                    <Select.Option key={id} value={id}>
                      <span className='flex items-center gap-6px'>
                        {name}
                        <Tag size='small' color='arcoblue'>
                          ext
                        </Tag>
                      </span>
                    </Select.Option>
                  );
                })}
              </Select>
            </div>

            {/* Rules */}
            <div className='flex-shrink-0'>
              <Typography.Text bold className='flex-shrink-0'>
                {t('settings.assistantRules', { defaultValue: 'Rules' })}
              </Typography.Text>
              <div className='mt-10px border border-border-2 overflow-hidden rounded-4px' style={{ height: '300px' }}>
                {!activeAssistant?.isBuiltin && !isReadonlyAssistant && (
                  <div className='flex items-center h-36px bg-fill-2 border-b border-border-2 flex-shrink-0'>
                    <div className={`flex items-center h-full px-16px cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'edit' ? 'text-primary border-b-2 border-primary bg-bg-1' : 'text-t-secondary hover:text-t-primary'}`} onClick={() => setPromptViewMode('edit')}>
                      {t('settings.promptEdit', { defaultValue: 'Edit' })}
                    </div>
                    <div className={`flex items-center h-full px-16px cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'preview' ? 'text-primary border-b-2 border-primary bg-bg-1' : 'text-t-secondary hover:text-t-primary'}`} onClick={() => setPromptViewMode('preview')}>
                      {t('settings.promptPreview', { defaultValue: 'Preview' })}
                    </div>
                  </div>
                )}
                <div className='bg-fill-2' style={{ height: activeAssistant?.isBuiltin || isReadonlyAssistant ? '100%' : 'calc(100% - 36px)', overflow: 'auto' }}>
                  {promptViewMode === 'edit' && !activeAssistant?.isBuiltin && !isReadonlyAssistant ? (
                    <div ref={textareaWrapperRef} className='h-full'>
                      <Input.TextArea value={editContext} onChange={(value) => setEditContext(value)} placeholder={t('settings.assistantRulesPlaceholder', { defaultValue: 'Enter rules in Markdown format...' })} autoSize={false} className='border-none rounded-none bg-transparent h-full resize-none' />
                    </div>
                  ) : (
                    <div className='p-16px'>{editContext ? <MarkdownView hiddenCodeCopyButton>{editContext}</MarkdownView> : <div className='text-t-secondary text-center py-32px'>{t('settings.promptPreviewEmpty', { defaultValue: 'No content to preview' })}</div>}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Skills selection */}
            <div className='flex-shrink-0 mt-16px'>
              <div className='flex items-center justify-between mb-12px'>
                <Typography.Text bold>{t('settings.assistantSkills', { defaultValue: 'Skills' })}</Typography.Text>
              </div>
              <Collapse defaultActiveKey={['custom-skills']}>
                <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.customSkills', { defaultValue: 'Custom Skills' })}</span>} name='custom-skills' className='mb-8px' extra={<span className='text-12px text-t-secondary'>{customSelectableSkills.length}</span>}>
                  <div className='grid gap-8px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                    {customSelectableSkills.map((skill) => (
                      <SkillCard
                        key={skill.name}
                        skill={skill}
                        checked={selectedSkills.includes(skill.name)}
                        onToggle={() => {
                          if (selectedSkills.includes(skill.name)) {
                            setSelectedSkills(selectedSkills.filter((s) => s !== skill.name));
                          } else {
                            setSelectedSkills([...selectedSkills, skill.name]);
                          }
                        }}
                      />
                    ))}
                    {customSelectableSkills.length === 0 && <div className='text-center text-t-secondary text-12px py-16px col-span-full'>{t('settings.noCustomSkills', { defaultValue: 'No custom skills available' })}</div>}
                  </div>
                </Collapse.Item>
                <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.builtinSkills', { defaultValue: 'Builtin Skills' })}</span>} name='builtin-skills' extra={<span className='text-12px text-t-secondary'>{builtinSelectableSkills.length}</span>}>
                  <div className='grid gap-8px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                    {builtinSelectableSkills.map((skill) => (
                      <SkillCard
                        key={skill.name}
                        skill={skill}
                        checked={selectedSkills.includes(skill.name)}
                        onToggle={() => {
                          if (selectedSkills.includes(skill.name)) {
                            setSelectedSkills(selectedSkills.filter((s) => s !== skill.name));
                          } else {
                            setSelectedSkills([...selectedSkills, skill.name]);
                          }
                        }}
                      />
                    ))}
                    {builtinSelectableSkills.length === 0 && <div className='text-center text-t-secondary text-12px py-16px col-span-full'>{t('settings.noBuiltinSkills', { defaultValue: 'No builtin skills available' })}</div>}
                  </div>
                </Collapse.Item>
              </Collapse>
            </div>
          </div>
        </div>
      </Drawer>

      {/* Delete Confirmation Modal */}
      <Modal title={t('settings.deleteAssistantTitle', { defaultValue: 'Delete Assistant' })} visible={deleteConfirmVisible} onCancel={() => setDeleteConfirmVisible(false)} onOk={handleDeleteConfirm} okButtonProps={{ status: 'danger' }} okText={t('common.delete', { defaultValue: 'Delete' })} cancelText={t('common.cancel', { defaultValue: 'Cancel' })} className='w-[90vw] md:w-[400px]' wrapStyle={{ zIndex: 10000 }} maskStyle={{ zIndex: 9999 }}>
        <p>{t('settings.deleteAssistantConfirm', { defaultValue: 'Are you sure you want to delete this assistant? This action cannot be undone.' })}</p>
        {activeAssistant && (
          <div className='mt-12px p-12px bg-fill-2 rounded-lg flex items-center gap-12px'>
            <Avatar.Group size={32}>
              <Avatar className='border-none' shape='square' style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}>
                {(() => {
                  const resolvedAvatar = activeAssistant.avatar?.trim();
                  const avatarImg = resolveAvatarImageSrc(resolvedAvatar);
                  const hasEmoji = Boolean(resolvedAvatar && isEmoji(resolvedAvatar));
                  if (avatarImg) return <img src={avatarImg} alt='' width={19} height={19} style={{ objectFit: 'contain' }} />;
                  if (hasEmoji) return <span style={{ fontSize: 19 }}>{resolvedAvatar}</span>;
                  return <Robot theme='outline' size={16} />;
                })()}
              </Avatar>
            </Avatar.Group>
            <div>
              <div className='font-medium'>{activeAssistant.nameI18n?.[localeKey] || activeAssistant.name}</div>
              <div className='text-12px text-t-secondary'>{activeAssistant.descriptionI18n?.[localeKey] || activeAssistant.description}</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AgentModalContent;
