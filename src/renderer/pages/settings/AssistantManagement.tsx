/**
 * AssistantManagement — Settings page for managing assistants.
 *
 * Editing permissions by assistant type:
 *
 * | Field          | Builtin | Extension | Custom |
 * |----------------|---------|-----------|--------|
 * | Save button    |  yes    |  no       |  yes   |
 * | Name           |  no     |  no       |  yes   |
 * | Description    |  no     |  no       |  yes   |
 * | Avatar         |  no     |  no       |  yes   |
 * | Main Agent     |  yes    |  no       |  yes   |
 * | Prompt editing |  no     |  no       |  yes   |
 * | Delete         |  no     |  no       |  yes   |
 *
 * Builtin assistants allow switching Main Agent and saving,
 * but their identity fields (name, description, avatar) and
 * prompt content are read-only.
 * Extension assistants are fully read-only.
 */
import { ipcBridge, skillHub } from '@/common';
import type { IInstalledSkillInfo } from '@/common/ipcBridge';
import { ASSISTANT_PRESETS } from '@/common/presets/assistantPresets';
import { ConfigStorage } from '@/common/storage';
import { resolveLocaleKey } from '@/common/utils';
import coworkSvg from '@/renderer/assets/cowork.svg';
import EmojiPicker from '@/renderer/components/EmojiPicker';
import MarkdownView from '@/renderer/components/Markdown';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { AcpBackendConfig } from '@/types/acpTypes';
import type { Message } from '@arco-design/web-react';
import { Avatar, Button, Checkbox, Collapse, Drawer, Input, Modal, Select, Switch, Tag, Typography } from '@arco-design/web-react';
import { Close, Lightning, Plus, Robot, SettingOne, Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';

// ==================== SkillCard Component ====================

interface SkillCardProps {
  skill: IInstalledSkillInfo;
  checked: boolean;
  onToggle: () => void;
}

const SkillCard: React.FC<SkillCardProps> = ({ skill, checked, onToggle }) => {
  const displayName =
    skill.meta?.display_name ||
    skill.name
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const description = skill.meta?.description;
  const icon = resolveExtensionAssetUrl(skill.meta?.icon) || skill.meta?.icon;
  const emoji = skill.meta?.emoji;

  return (
    <div className='bg-fill-1 rd-12px border border-line p-12px flex items-start gap-12px relative'>
      {/* Checkbox */}
      <Checkbox checked={checked} onChange={onToggle} className='mt-2px cursor-pointer' />

      {/* Icon */}
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

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-6px'>
          <span className='font-medium text-13px text-t-primary truncate'>{displayName}</span>
          {!skill.isBuiltin && <span className='px-5px py-0px bg-fill-3 text-t-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{skill.version}</span>}
          {skill.isBuiltin && <Shield size='14' className='text-primary flex-shrink-0' />}
        </div>
        {description && <div className='text-11px text-t-secondary mt-3px line-clamp-2 leading-relaxed'>{description}</div>}
      </div>
    </div>
  );
};

// ==================== AssistantManagement Component ====================

interface AssistantManagementProps {
  message: ReturnType<typeof Message.useMessage>[0];
}

type AssistantListItem = AcpBackendConfig & {
  _source?: string;
  _extensionName?: string;
  _kind?: string;
};

const AssistantManagement: React.FC<AssistantManagementProps> = ({ message }) => {
  const { t, i18n } = useTranslation();
  const [assistants, setAssistants] = useState<AssistantListItem[]>([]);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContext, setEditContext] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  // editAgent holds either a built-in PresetAgentType or an extension adapter ID (e.g. "ext-buddy")
  const [editAgent, setEditAgent] = useState<string>('sudoclaw');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [promptViewMode, setPromptViewMode] = useState<'edit' | 'preview'>('preview');
  const [drawerWidth, setDrawerWidth] = useState(500);
  // Skills 选择模式相关 state / Skills selection mode states
  const [installedSkills, setInstalledSkills] = useState<IInstalledSkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]); // 启用的 skills（勾选状态）/ Enabled skills
  const [availableBackends, setAvailableBackends] = useState<Set<string>>(new Set(['gemini']));
  const textareaWrapperRef = useRef<HTMLDivElement>(null);
  const localeKey = resolveLocaleKey(i18n.language);
  const avatarImageMap = React.useMemo<Record<string, string>>(
    () => ({
      'cowork.svg': coworkSvg,
      '🛠️': coworkSvg,
    }),
    []
  );

  // Load extension-contributed ACP adapters so they appear in the main agent dropdown
  const { data: extensionAcpAdapters } = useSWR('extensions.acpAdapters', () => ipcBridge.extensions.getAcpAdapters.invoke().catch(() => [] as Record<string, unknown>[]));

  // Load extension-contributed assistants for Settings > Assistants list
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
      // Small delay to ensure the drawer animation is complete
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

  // Load available agent backends from ACP detector
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

  // Load installed skills from Skill Hub
  const loadInstalledSkills = useCallback(async () => {
    if (!isElectronDesktop()) {
      setInstalledSkills([]);
      return;
    }
    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        setInstalledSkills(res.data);
      }
    } catch (error) {
      console.error('Failed to load installed skills:', error);
      setInstalledSkills([]);
    }
  }, []);

  const refreshAgentDetection = useCallback(async () => {
    try {
      await ipcBridge.acpConversation.refreshCustomAgents.invoke();
      await mutate('acp.agents.available');
    } catch {
      // ignore
    }
  }, []);

  // 从文件加载助手规则内容 / Load assistant rule content from file
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

  // Helper function to sort assistants according to ASSISTANT_PRESETS order
  // 根据 ASSISTANT_PRESETS 顺序排序助手的辅助函数
  const sortAssistants = useCallback((agents: AssistantListItem[]) => {
    const presetOrder = ASSISTANT_PRESETS.map((preset) => `builtin-${preset.id}`);
    return agents
      .filter((agent) => agent.isPreset)
      .sort((a, b) => {
        const indexA = presetOrder.indexOf(a.id);
        const indexB = presetOrder.indexOf(b.id);
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
      // 从配置中读取已存储的助手（包含内置助手和用户自定义助手）
      // Read stored assistants from config (includes builtin and user-defined)
      const localAgents: AssistantListItem[] = (await ConfigStorage.get('acp.customAgents')) || [];

      const mergedAgents = [...localAgents];
      for (const extAssistant of normalizedExtensionAssistants) {
        if (!mergedAgents.some((agent) => agent.id === extAssistant.id)) {
          mergedAgents.push(extAssistant);
        }
      }

      // 对于内置助手，使用 ASSISTANT_PRESETS 中的最新配置更新 presetAgentType
      // For builtin assistants, update presetAgentType from ASSISTANT_PRESETS
      for (const agent of mergedAgents) {
        if (agent.id.startsWith('builtin-')) {
          const presetId = agent.id.replace('builtin-', '');
          const preset = ASSISTANT_PRESETS.find((p) => p.id === presetId);
          if (preset && preset.presetAgentType) {
            agent.presetAgentType = preset.presetAgentType;
          }
        }
      }

      // 仅保留指定的内置助手
      // Keep only allowed builtin assistants
      let allowedPresetIds = ['builtin-ui-ux-pro-max', 'builtin-planning-with-files', 'builtin-beautiful-mermaid', 'builtin-moltbook', 'builtin-copilot', 'builtin-doctor', 'builtin-jiansheku'];
      const filteredAgents = mergedAgents.filter((agent) => {
        const otherAgents = mergedAgents.filter((_) => !_.id.startsWith('builtin-'));
        allowedPresetIds = allowedPresetIds.concat(otherAgents.map((_) => _.id));
        return allowedPresetIds.includes(agent.id);
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

  // Check if string is an emoji (simple check for common emoji patterns)
  const isEmoji = useCallback((str: string) => {
    if (!str) return false;
    // Check if it's a single emoji or emoji sequence
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

  const renderAvatarGroup = useCallback(
    (assistant: AssistantListItem, size = 32) => {
      const resolvedAvatar = assistant.avatar?.trim();
      const hasEmojiAvatar = Boolean(resolvedAvatar && isEmoji(resolvedAvatar));
      const avatarImage = resolveAvatarImageSrc(resolvedAvatar);
      const iconSize = Math.floor(size * 0.5);
      const emojiSize = Math.floor(size * 0.6);

      return (
        <Avatar.Group size={size}>
          <Avatar className='border-none' shape='square' style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}>
            {avatarImage ? <img src={avatarImage} alt='' width={emojiSize} height={emojiSize} style={{ objectFit: 'contain' }} /> : hasEmojiAvatar ? <span style={{ fontSize: emojiSize }}>{resolvedAvatar}</span> : <Robot theme='outline' size={iconSize} />}
          </Avatar>
        </Avatar.Group>
      );
    },
    [isEmoji, resolveAvatarImageSrc]
  );

  const handleEdit = async (assistant: AssistantListItem) => {
    setIsCreating(false);
    setActiveAssistantId(assistant.id);
    setEditName(assistant.name || '');
    setEditDescription(assistant.description || '');
    setEditAvatar(assistant.avatar || '');
    setEditAgent(assistant.presetAgentType || 'sudoclaw');
    setEditVisible(true);

    // 扩展助手直接展示扩展内 context，不走本地规则文件
    if (isExtensionAssistant(assistant)) {
      setPromptViewMode('preview');
      setEditContext(assistant.context || '');
      setInstalledSkills([]);
      setSelectedSkills(Array.isArray(assistant.enabledSkills) ? assistant.enabledSkills : []);
      return;
    }

    // 先加载规则内容 / Load rules content
    try {
      const context = await loadAssistantContext(assistant.id);
      setEditContext(context);

      // 加载已安装技能列表 / Load installed skills list
      await loadInstalledSkills();
      setSelectedSkills(assistant.enabledSkills || []);
    } catch (error) {
      console.error('Failed to load assistant content:', error);
      setEditContext('');
      setInstalledSkills([]);
      setSelectedSkills([]);
    }
  };

  // 创建助手功能 / Create assistant function
  const handleCreate = async () => {
    setIsCreating(true);
    setActiveAssistantId(null);
    setEditName('');
    setEditDescription('');
    setEditContext('');
    setEditAvatar('🤖');
    setEditAgent('sudoclaw');
    setSelectedSkills([]);
    setPromptViewMode('edit'); // 创建助手时，规则默认处于编辑状态 / Default to edit mode when creating
    setEditVisible(true);

    // 加载已安装技能列表 / Load installed skills list
    await loadInstalledSkills();
  };

  // 复制新建助手功能 / Duplicate assistant function
  const handleDuplicate = async (assistant: AssistantListItem) => {
    setIsCreating(true);
    setActiveAssistantId(null);
    setEditName(`${assistant.nameI18n?.[localeKey] || assistant.name} (Copy)`);
    setEditDescription(assistant.descriptionI18n?.[localeKey] || assistant.description || '');
    setEditAvatar(assistant.avatar || '🤖');
    setEditAgent(assistant.presetAgentType || 'sudoclaw');
    setPromptViewMode('edit');
    setEditVisible(true);

    // 加载原助手的规则内容 / Load original assistant's rules
    try {
      const context = isExtensionAssistant(assistant) ? assistant.context || '' : await loadAssistantContext(assistant.id);

      setEditContext(context);
      await loadInstalledSkills();
      setSelectedSkills(assistant.enabledSkills || []);
    } catch (error) {
      console.error('Failed to load assistant content for duplication:', error);
      setEditContext('');
      setInstalledSkills([]);
      setSelectedSkills([]);
    }
  };

  const handleSave = async () => {
    try {
      // 验证必填字段 / Validate required fields
      if (!editName.trim()) {
        message.error(t('settings.assistantNameRequired', { defaultValue: 'Assistant name is required' }));
        return;
      }

      // 扩展助手为只读配置，不能直接保存覆盖
      if (!isCreating && activeAssistant && isExtensionAssistant(activeAssistant)) {
        message.warning(t('settings.extensionAssistantReadonly', { defaultValue: 'Extension assistants are read-only. You can duplicate it and edit the copy.' }));
        return;
      }

      const agents = (await ConfigStorage.get('acp.customAgents')) || [];

      if (isCreating) {
        // 创建新助手 / Create new assistant
        const newId = `custom-${Date.now()}`;
        const newAssistant: AcpBackendConfig = {
          id: newId,
          name: editName,
          description: editDescription,
          avatar: editAvatar,
          isPreset: true,
          isBuiltin: false,
          presetAgentType: editAgent,
          enabled: true,
          enabledSkills: selectedSkills,
        };

        // 保存规则文件 / Save rule file
        if (editContext.trim()) {
          await ipcBridge.fs.writeAssistantRule.invoke({
            assistantId: newId,
            locale: localeKey,
            content: editContext,
          });
        }

        const updatedAgents = [...agents, newAssistant];
        await ConfigStorage.set('acp.customAgents', updatedAgents);
        setActiveAssistantId(newId);
        await loadAssistants();
        message.success(t('common.createSuccess', { defaultValue: 'Created successfully' }));
      } else {
        // 更新现有助手 / Update existing assistant
        if (!activeAssistant) return;

        const updatedAgent: AcpBackendConfig = {
          ...activeAssistant,
          name: editName,
          description: editDescription,
          avatar: editAvatar,
          presetAgentType: editAgent,
          enabledSkills: selectedSkills,
        };

        // 保存规则文件（如果有更改）/ Save rule file (if changed)
        if (editContext.trim()) {
          await ipcBridge.fs.writeAssistantRule.invoke({
            assistantId: activeAssistant.id,
            locale: localeKey,
            content: editContext,
          });
        }

        const updatedAgents = agents.map((agent) => (agent.id === activeAssistant.id ? updatedAgent : agent));
        await ConfigStorage.set('acp.customAgents', updatedAgents);
        await loadAssistants();
        message.success(t('common.saveSuccess', { defaultValue: 'Saved successfully' }));
      }

      setEditVisible(false);
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to save assistant:', error);
      message.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  const handleDeleteClick = () => {
    if (!activeAssistant) return;
    // 不能删除内置助手 / Cannot delete builtin assistants
    if (activeAssistant.isBuiltin) {
      message.warning(t('settings.cannotDeleteBuiltin', { defaultValue: 'Cannot delete builtin assistants' }));
      return;
    }
    // 扩展助手是扩展贡献，不允许在此处删除
    if (isExtensionAssistant(activeAssistant)) {
      message.warning(t('settings.extensionAssistantReadonly', { defaultValue: 'Extension assistants are read-only. You can duplicate it and edit the copy.' }));
      return;
    }
    setDeleteConfirmVisible(true);
  };

  const handleDeleteConfirm = async () => {
    if (!activeAssistant) return;
    try {
      // 1. 删除规则和技能文件 / Delete rule and skill files
      await Promise.all([ipcBridge.fs.deleteAssistantRule.invoke({ assistantId: activeAssistant.id }), ipcBridge.fs.deleteAssistantSkill.invoke({ assistantId: activeAssistant.id })]);

      // 2. 从配置中移除助手 / Remove assistant from config
      const agents = (await ConfigStorage.get('acp.customAgents')) || [];
      const updatedAgents = agents.filter((agent) => agent.id !== activeAssistant.id);
      await ConfigStorage.set('acp.customAgents', updatedAgents);

      // Reload merged assistant list (local + extensions)
      await loadAssistants();
      setDeleteConfirmVisible(false);
      setEditVisible(false);
      message.success(t('common.success', { defaultValue: 'Success' }));
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to delete assistant:', error);
      message.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  // Toggle assistant enabled state / 切换助手启用状态
  const handleToggleEnabled = async (assistant: AssistantListItem, enabled: boolean) => {
    if (isExtensionAssistant(assistant)) {
      message.warning(t('settings.extensionAssistantReadonly', { defaultValue: 'Extension assistants are read-only. You can duplicate it and edit the copy.' }));
      return;
    }

    try {
      const agents = (await ConfigStorage.get('acp.customAgents')) || [];
      const updatedAgents = agents.map((agent) => (agent.id === assistant.id ? { ...agent, enabled } : agent));
      await ConfigStorage.set('acp.customAgents', updatedAgents);

      // Reload merged assistant list (local + extensions)
      await loadAssistants();
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to toggle assistant:', error);
      message.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  const editAvatarImage = resolveAvatarImageSrc(editAvatar);

  return (
    <div>
      <Collapse.Item
        header={
          <div className='flex items-center justify-between w-full'>
            <span>{t('settings.assistants', { defaultValue: 'Assistants' })}</span>
          </div>
        }
        name='smart-assistants'
        extra={
          <Button
            type='text'
            size='small'
            style={{ color: 'var(--text-primary)' }}
            icon={<Plus size={14} fill='currentColor' />}
            onClick={(e) => {
              e.stopPropagation();
              void handleCreate();
            }}
          >
            {t('settings.createAssistant', { defaultValue: 'Create' })}
          </Button>
        }
      >
        <div className='py-2'>
          <div className='bg-fill-2 rounded-2xl p-20px'>
            <div className='text-14px text-t-secondary mb-12px'>{t('settings.assistantsList', { defaultValue: 'Available assistants' })}</div>
            {assistants.length > 0 ? (
              <div className='space-y-12px'>
                {assistants.map((assistant) => {
                  const assistantIsExtension = isExtensionAssistant(assistant);
                  return (
                    <div
                      key={assistant.id}
                      className='group bg-fill-0 rounded-lg px-16px py-12px flex items-center justify-between cursor-pointer hover:bg-fill-1 transition-colors'
                      onClick={() => {
                        setActiveAssistantId(assistant.id);
                        void handleEdit(assistant);
                      }}
                    >
                      <div className='flex items-center gap-12px min-w-0'>
                        {renderAvatarGroup(assistant, 28)}
                        <div className='min-w-0'>
                          <div className='font-medium text-t-primary truncate flex items-center gap-6px'>
                            <span className='truncate'>{assistant.nameI18n?.[localeKey] || assistant.name}</span>
                          </div>
                          <div className='text-12px text-t-secondary truncate'>{assistant.descriptionI18n?.[localeKey] || assistant.description || ''}</div>
                        </div>
                      </div>
                      <div className='flex items-center gap-12px text-t-secondary'>
                        <span
                          className='invisible group-hover:visible text-12px text-primary cursor-pointer hover:underline transition-all'
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDuplicate(assistant);
                          }}
                        >
                          {t('settings.duplicateAssistant', { defaultValue: 'Duplicate' })}
                        </span>
                        <Switch
                          size='small'
                          checked={assistantIsExtension ? true : assistant.enabled !== false}
                          disabled={assistantIsExtension}
                          onChange={(checked) => {
                            void handleToggleEnabled(assistant, checked);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Button
                          type='text'
                          size='small'
                          icon={<SettingOne size={16} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleEdit(assistant);
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className='text-center text-t-secondary py-12px'>{t('settings.assistantsEmpty', { defaultValue: 'No assistants configured.' })}</div>
            )}
          </div>
        </div>
      </Collapse.Item>

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
            <div className='flex-shrink-0'>
              <Typography.Text bold>{t('settings.assistantDescription', { defaultValue: 'Assistant Description' })}</Typography.Text>
              <Input className='mt-10px rounded-4px bg-bg-1' value={editDescription} onChange={(value) => setEditDescription(value)} disabled={activeAssistant?.isBuiltin || isReadonlyAssistant} placeholder={t('settings.assistantDescriptionPlaceholder', { defaultValue: 'What can this assistant help with?' })} />
            </div>
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
                {/* Extension-contributed ACP adapters */}
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
            <div className='flex-shrink-0'>
              <Typography.Text bold className='flex-shrink-0'>
                {t('settings.assistantRules', { defaultValue: 'Rules' })}
              </Typography.Text>
              {/* Prompt Edit/Preview Tabs */}
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
            {/* Skills 技能选择 / Skills selection */}
            <div className='flex-shrink-0 mt-16px'>
              <div className='flex items-center justify-between mb-12px'>
                <Typography.Text bold>{t('settings.assistantSkills', { defaultValue: 'Skills' })}</Typography.Text>
              </div>

              {/* Skills 折叠面板 / Skills Collapse */}
              <Collapse defaultActiveKey={['custom-skills']}>
                {/* 自定义技能 / Custom Skills */}
                <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.customSkills', { defaultValue: 'Custom Skills' })}</span>} name='custom-skills' className='mb-8px' extra={<span className='text-12px text-t-secondary'>{installedSkills.filter((s) => !s.isBuiltin).length}</span>}>
                  <div className='grid gap-8px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                    {installedSkills
                      .filter((s) => !s.isBuiltin)
                      .map((skill) => (
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
                    {installedSkills.filter((s) => !s.isBuiltin).length === 0 && <div className='text-center text-t-secondary text-12px py-16px col-span-full'>{t('settings.noCustomSkills', { defaultValue: 'No custom skills available' })}</div>}
                  </div>
                </Collapse.Item>

                {/* 内置技能 / Builtin Skills */}
                <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.builtinSkills', { defaultValue: 'Builtin Skills' })}</span>} name='builtin-skills' extra={<span className='text-12px text-t-secondary'>{installedSkills.filter((s) => s.isBuiltin).length}</span>}>
                  <div className='grid gap-8px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                    {installedSkills
                      .filter((s) => s.isBuiltin)
                      .map((skill) => (
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
                    {installedSkills.filter((s) => s.isBuiltin).length === 0 && <div className='text-center text-t-secondary text-12px py-16px col-span-full'>{t('settings.noBuiltinSkills', { defaultValue: 'No builtin skills available' })}</div>}
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
            {renderAvatarGroup(activeAssistant, 32)}
            <div>
              <div className='font-medium'>{activeAssistant.name}</div>
              <div className='text-12px text-t-secondary'>{activeAssistant.description}</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AssistantManagement;
