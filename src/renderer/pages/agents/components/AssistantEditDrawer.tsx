/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent edit drawer for the GUID page.
 * Provides the same editing experience as the Settings > Agents drawer,
 * allowing users to modify agent details without leaving the conversation page.
 */

import { Avatar, Button, Checkbox, Collapse, Drawer, Input, Message, Select, Typography } from '@arco-design/web-react';
import { Bot, Shield, Zap } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mutate } from 'swr';
import { ipcBridge, skillHub } from '@/common';
import type { IInstalledSkillInfo } from '@/common/ipcBridge';
import { getPresetById } from '@/common/presets/presetResolver';
import { resolveAssistantName } from '@/renderer/shared/agents/assistantAdapter';
import type { AcpBackendConfig } from '@/types/acpTypes';
import { DEFAULT_PRESET_AGENT_TYPE, normalizePresetAgentType } from '@/types/acpTypes';
import { getAgentLogo } from '@/renderer/utils/agentLogo';
import { getInstalledSkillDisplay, normalizeSkillVersion, handleSkillIconError } from '@/renderer/utils/skillDisplay';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import EmojiPicker from '@/renderer/components/EmojiPicker';
import MarkdownView from '@/renderer/components/Markdown';
import coworkSvg from '@/renderer/assets/cowork.svg';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { isAssistantSkillSelected, sanitizeAssistantEnabledSkills, toggleAssistantSkillSelection } from '../utils';

type AssistantEditDrawerProps = {
  visible: boolean;
  assistantId: string | null;
  localeKey: string;
  onClose: () => void;
  onSaved: () => void;
};

/** Extended assistant config with hub-installed flag for readonly check */
type AssistantConfigWithMeta = AcpBackendConfig & {
  _isHubInstalled?: boolean;
};

const AVATAR_IMAGE_MAP: Record<string, string> = {
  'cowork.svg': coworkSvg,
  '\u{1F6E0}\u{FE0F}': coworkSvg,
};

const AssistantEditDrawer: React.FC<AssistantEditDrawerProps> = ({ visible, assistantId, localeKey, onClose, onSaved }) => {
  const { t } = useTranslation();
  const { isEnterprise } = useAppMode();
  const textareaWrapperRef = useRef<HTMLDivElement>(null);

  // Edit state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editAgent, setEditAgent] = useState<string>(DEFAULT_PRESET_AGENT_TYPE);
  const [editContext, setEditContext] = useState('');
  const [promptViewMode, setPromptViewMode] = useState<'edit' | 'preview'>('preview');
  const [drawerWidth, setDrawerWidth] = useState(500);

  // Skills state
  const [installedSkills, setInstalledSkills] = useState<IInstalledSkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  // Current assistant data
  const [assistant, setAssistant] = useState<AssistantConfigWithMeta | null>(null);
  const isBuiltin = Boolean(assistant?.isBuiltin);
  const isHubInstalled = Boolean(assistant?._isHubInstalled);
  // Extension assistants are loaded from extensions, not from acp.customAgents,
  // so they won't be found by the drawer loader. This check is a safety fallback.
  const isExtension = assistant?.id?.startsWith('ext-') ?? false;
  // Only custom agents can be edited; hub-installed, builtin, and extension agents are readonly
  const isReadonly = isExtension || isHubInstalled || isBuiltin;

  // Responsive drawer width
  useEffect(() => {
    const updateWidth = () => {
      if (typeof window === 'undefined') return;
      setDrawerWidth(Math.min(500, Math.max(320, Math.floor(window.innerWidth - 32))));
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Load agent data when drawer opens
  useEffect(() => {
    if (!visible || !assistantId) return;
    let cancelled = false;

    const loadAssistant = async () => {
      try {
        // Load from assistantHub (new architecture) to get full info including _isHubInstalled
        const res = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
        if (!res.success || !res.data) return;

        // Find the assistant by id (directory name), meta.id (UUID), or display name
        // assistantId can be: directory name (UUID), builtin-xxx, or display name
        const foundInfo = res.data.find((a) => {
          // Match by directory name (a.name)
          if (a.name === assistantId) return true;
          // Match by meta.id (UUID from server)
          if (a.meta?.id === assistantId) return true;
          // Match by display name (nameI18n or meta.name)
          const displayName = a.meta?.nameI18n?.['zh-CN'] || a.meta?.nameI18n?.['en-US'] || a.meta?.name;
          if (displayName === assistantId) return true;
          // Match by builtin prefix (builtin-xxx)
          if (a.isBuiltin && `builtin-${a.name}` === assistantId) return true;
          return false;
        });
        if (cancelled || !foundInfo) {
          console.warn(
            '[AssistantEditDrawer] Assistant not found:',
            assistantId,
            'Available:',
            res.data.map((a) => ({ name: a.name, metaId: a.meta?.id, displayName: a.meta?.nameI18n?.['zh-CN'] || a.meta?.name }))
          );
          return;
        }

        // Convert to config format, preserving isHubInstalled flag
        const found: AssistantConfigWithMeta = {
          id: foundInfo.isBuiltin ? `builtin-${foundInfo.name}` : foundInfo.name,
          name: foundInfo.meta.nameI18n?.['zh-CN'] || foundInfo.meta.nameI18n?.['en-US'] || foundInfo.meta.id || foundInfo.name,
          nameI18n: foundInfo.meta.nameI18n,
          descriptionI18n: foundInfo.meta.descriptionI18n,
          avatar: foundInfo.meta.avatar,
          enabled: foundInfo.enabled,
          isPreset: true,
          presetAgentType: foundInfo.meta.presetAgentType,
          promptsI18n: foundInfo.meta.promptsI18n,
          enabledSkills: foundInfo.meta.enabledSkills ?? foundInfo.meta.defaultEnabledSkills,
          isBuiltin: foundInfo.isBuiltin,
          apiKeyFields: foundInfo.meta.apiKeyFields,
          _isHubInstalled: foundInfo.isHubInstalled,
        };

        // Fall back to preset default presetAgentType only when the user hasn't saved one yet.
        // Preserving the stored value ensures the dropdown reflects (and lets the user modify)
        // the main agent of a builtin assistant instead of snapping back to the hardcoded default.
        if (found.id.startsWith('builtin-') && !found.presetAgentType) {
          const presetId = found.id.replace('builtin-', '');
          const preset = getPresetById(presetId);
          if (preset?.presetAgentType) {
            found.presetAgentType = preset.presetAgentType;
          }
        }

        setAssistant(found);
        setEditName(found.nameI18n?.[localeKey] || found.name || '');
        setEditDescription(found.descriptionI18n?.[localeKey] || found.description || '');
        setEditAvatar(found.avatar || '');
        setEditAgent(normalizePresetAgentType(found.presetAgentType) || DEFAULT_PRESET_AGENT_TYPE);

        // Load rules content
        try {
          const context = await ipcBridge.fs.readAssistantRule.invoke({
            assistantId: found.id,
            locale: localeKey,
          });
          if (!cancelled) setEditContext(context || '');
        } catch {
          if (!cancelled) setEditContext('');
        }

        // Load installed skills
        if (isElectronDesktop()) {
          try {
            const res = await skillHub.getInstalledSkills.invoke();
            if (!cancelled && res.success && res.data) {
              const availableSkills = res.data.filter((s) => s.isBuiltin || s.enabled !== false);
              setInstalledSkills(availableSkills);
              setSelectedSkills(sanitizeAssistantEnabledSkills(found.enabledSkills || [], availableSkills));
            }
          } catch {
            if (!cancelled) setInstalledSkills([]);
          }
        } else {
          setSelectedSkills(found.enabledSkills || []);
        }
      } catch (error) {
        console.error('Failed to load assistant for editing:', error);
      }
    };

    void loadAssistant();
    return () => {
      cancelled = true;
    };
  }, [visible, assistantId, localeKey]);

  // Reset prompt view mode when drawer opens
  useEffect(() => {
    if (visible) {
      setPromptViewMode('preview');
    }
  }, [visible]);

  // Resolve avatar image source
  const resolveAvatarImage = useCallback((avatar: string | undefined): string | undefined => {
    const value = avatar?.trim();
    if (!value) return undefined;
    const mapped = AVATAR_IMAGE_MAP[value];
    if (mapped) return mapped;
    const resolved = resolveExtensionAssetUrl(value) || value;
    const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(resolved);
    return isImage ? resolved : undefined;
  }, []);

  const isEmoji = useCallback((str: string) => {
    if (!str) return false;
    const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
    return emojiRegex.test(str);
  }, []);

  const handleSave = useCallback(async () => {
    if (!assistant) return;

    // Block saving for readonly agents (hub, builtin, extension)
    if (isReadonly) {
      Message.warning(
        t('settings.assistantReadonly', {
          defaultValue: 'Hub 安装的助手和内置助手不可修改，可复制到自定义列表后编辑',
        })
      );
      return;
    }

    try {
      // Use assistantHub.updateAssistantMeta to save to _sudowork_meta.json
      const lookupName = resolveAssistantName(assistant.id);

      // For custom assistants, save all fields (presetAgentType stays locked to Sudo Code)
      const updateResult = await ipcBridge.assistantHub.updateAssistantMeta.invoke({
        name: lookupName,
        updates: {
          nameI18n: { 'zh-CN': editName },
          descriptionI18n: editDescription ? { 'zh-CN': editDescription } : undefined,
          avatar: editAvatar,
          presetAgentType: normalizePresetAgentType(editAgent) || DEFAULT_PRESET_AGENT_TYPE,
          enabledSkills: sanitizeAssistantEnabledSkills(selectedSkills, installedSkills),
        },
      });

      if (!updateResult.success) {
        Message.error(t('settings.assistant.saveFailed', { msg: updateResult.msg || 'Unknown error', defaultValue: `保存失败: ${updateResult.msg || '未知错误'}` }));
        return;
      }

      // Save rules file if changed
      if (editContext.trim()) {
        await ipcBridge.fs.writeAssistantRule.invoke({
          assistantId: assistant.id,
          locale: localeKey,
          content: editContext,
        });
      }

      // Refresh agent detection - use different refresh logic based on mode
      if (isEnterprise) {
        // Enterprise mode: refresh local assistants from hub/tenant/custom/system directories
        await mutate('assistantHub.installed');
      } else {
        // Personal mode: refresh ACP agents
        await ipcBridge.acpConversation.refreshCustomAgents.invoke();
        await mutate('acp.agents.available');
      }

      Message.success(t('common.saveSuccess', { defaultValue: 'Saved successfully' }));
      onSaved();
      onClose();
    } catch (error) {
      console.error('Failed to save assistant:', error);
      Message.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  }, [assistant, isReadonly, isEnterprise, editName, editDescription, editAvatar, editAgent, editContext, selectedSkills, installedSkills, localeKey, onSaved, onClose, t]);

  const editAvatarImage = resolveAvatarImage(editAvatar);

  return (
    <Drawer
      title={t('settings.editAssistant', { defaultValue: '智能体详情' })}
      closable
      visible={visible}
      placement='right'
      width={drawerWidth}
      zIndex={1200}
      autoFocus={false}
      onCancel={onClose}
      headerStyle={{ background: 'var(--color-bg-1)' }}
      bodyStyle={{ background: 'var(--color-bg-1)' }}
      footer={
        <div className='flex justify-end gap-2'>
          <Button onClick={onClose} className='w-[100px] rounded-[100px] bg-fill-2'>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type='primary' onClick={handleSave} disabled={isReadonly} className='w-[100px] rounded-[100px]'>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      }
    >
      <div className='flex flex-col h-full overflow-hidden'>
        <div className='flex flex-col flex-1 gap-16px bg-fill-2 rounded-16px p-20px overflow-y-auto'>
          {/* Name & Avatar */}
          <div className='flex-shrink-0'>
            <Typography.Text bold>
              <span className='text-red-500'>*</span> {t('settings.assistantNameAvatar', { defaultValue: '名称及头像' })}
            </Typography.Text>
            <div className='mt-10px flex items-center gap-12px'>
              {isBuiltin || isReadonly ? (
                <Avatar shape='square' size={40} className='rounded-4px'>
                  {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar && isEmoji(editAvatar) ? <span className='text-24px'>{editAvatar}</span> : <Bot size={20} />}
                </Avatar>
              ) : (
                <EmojiPicker value={editAvatar} onChange={(emoji) => setEditAvatar(emoji)} placement='br'>
                  <div className='cursor-pointer'>
                    <Avatar shape='square' size={40} className='rounded-4px hover:bg-fill-2 transition-colors'>
                      {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar && isEmoji(editAvatar) ? <span className='text-24px'>{editAvatar}</span> : <Bot size={20} />}
                    </Avatar>
                  </div>
                </EmojiPicker>
              )}
              <Input value={editName} onChange={(value) => setEditName(value)} disabled={isBuiltin || isReadonly} placeholder={t('settings.agentNamePlaceholder', { defaultValue: '请输入智能体名称' })} className='flex-1' />
            </div>
          </div>

          {/* Description */}
          <div className='flex-shrink-0'>
            <Typography.Text bold>{t('settings.assistantDescription', { defaultValue: '智能体描述' })}</Typography.Text>
            <Input className='mt-10px' value={editDescription} onChange={(value) => setEditDescription(value)} disabled={isBuiltin || isReadonly} placeholder={t('settings.assistantDescriptionPlaceholder', { defaultValue: '帮你解决什么问题' })} />
          </div>

          {/* Main Agent - locked to Sudo Code */}
          <div className='flex-shrink-0'>
            <Typography.Text bold>{t('settings.assistantMainAgent', { defaultValue: '主智能体' })}</Typography.Text>
            <Select className='mt-10px w-full' value={DEFAULT_PRESET_AGENT_TYPE} disabled>
              <Select.Option key='scode' value='scode'>
                <span className='flex items-center gap-6px'>
                  {getAgentLogo('scode') && <img src={getAgentLogo('scode') || undefined} alt='' width={16} height={16} style={{ objectFit: 'contain' }} />}
                  Sudo Code
                </span>
              </Select.Option>
            </Select>
          </div>

          {/* Rules */}
          <div className='flex-shrink-0'>
            <Typography.Text bold className='flex-shrink-0'>
              {t('settings.assistantRules', { defaultValue: '规则' })}
            </Typography.Text>
            <div className='mt-10px border overflow-hidden rounded-4px' style={{ height: '300px' }}>
              {!isBuiltin && !isReadonly && (
                <div className='flex items-center h-36px bg-fill-2 border-b flex-shrink-0'>
                  <div className={`flex items-center h-full px-16px cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'edit' ? 'text-primary border-b-2px border-solid border-primary' : 'text-secondary hover:text-foreground'}`} onClick={() => setPromptViewMode('edit')}>
                    {t('settings.promptEdit', { defaultValue: 'Edit' })}
                  </div>
                  <div className={`flex items-center h-full px-16px cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'preview' ? 'text-primary border-b-2px border-solid border-primary' : 'text-secondary hover:text-foreground'}`} onClick={() => setPromptViewMode('preview')}>
                    {t('settings.promptPreview', { defaultValue: 'Preview' })}
                  </div>
                </div>
              )}
              <div
                className='bg-fill-2'
                style={{
                  height: isBuiltin || isReadonly ? '100%' : 'calc(100% - 36px)',
                  overflow: 'auto',
                }}
              >
                {promptViewMode === 'edit' && !isBuiltin && !isReadonly ? (
                  <div ref={textareaWrapperRef} className='h-full'>
                    <Input.TextArea value={editContext} onChange={(value) => setEditContext(value)} placeholder={t('settings.assistantRulesPlaceholder', { defaultValue: '请输入 Markdown 格式的规则...' })} autoSize={false} className='border-none rounded-none bg-transparent h-full resize-none' />
                  </div>
                ) : (
                  <div className='p-16px'>
                    {editContext ? (
                      <MarkdownView hiddenCodeCopyButton>{editContext}</MarkdownView>
                    ) : (
                      <div className='text-secondary text-center py-32px'>
                        {t('settings.promptPreviewEmpty', {
                          defaultValue: 'No content to preview',
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Skills */}
          <div className='flex-shrink-0 mt-16px'>
            <div className='flex items-center justify-between mb-12px'>
              <Typography.Text bold>{t('settings.assistantSkills', { defaultValue: '技能' })}</Typography.Text>
            </div>
            <Collapse defaultActiveKey={['custom-skills']}>
              <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.customSkills', { defaultValue: '自定义技能' })}</span>} name='custom-skills' className='mb-8px' extra={<span className='text-12px text-secondary'>{installedSkills.filter((s) => !s.isBuiltin).length}</span>}>
                <div
                  className='grid gap-8px'
                  style={{
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  }}
                >
                  {installedSkills
                    .filter((s) => !s.isBuiltin)
                    .map((skill) => {
                      const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skill);
                      const displayVersion = normalizeSkillVersion(skill.version);
                      return (
                        <div key={skill.name} className={`bg-fill-1 rd-12px border p-12px flex items-start gap-12px relative ${isReadonly ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <Checkbox
                            checked={isAssistantSkillSelected(selectedSkills, skill)}
                            onChange={() => {
                              if (isReadonly) return;
                              setSelectedSkills(toggleAssistantSkillSelection(selectedSkills, skill));
                            }}
                            disabled={isReadonly}
                            className={`mt-2px ${isReadonly ? '' : 'cursor-pointer'}`}
                          />
                          <div className='w-48px h-48px flex-shrink-0 rd-8px overflow-hidden bg-fill-2'>
                            {icon ? (
                              <img src={icon} alt={displayName} className='w-full h-full object-cover' onError={handleSkillIconError} />
                            ) : emoji ? (
                              <div className='w-full h-full f-center text-22px'>{emoji}</div>
                            ) : (
                              <div className='w-full h-full f-center'>
                                <Zap size={22} className='text-primary' />
                              </div>
                            )}
                          </div>
                          <div className='flex-1 min-w-0'>
                            <div className='flex items-center gap-6px'>
                              <span className='font-medium text-13px text-foreground truncate'>{displayName}</span>
                              {!skill.isBuiltin && displayVersion && <span className='px-5px py-0px bg-fill-3 text-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{displayVersion}</span>}
                              {skill.isBuiltin && <Shield size={14} className='text-primary flex-shrink-0' />}
                            </div>
                            {description && <div className='text-11px text-secondary mt-3px line-clamp-2 leading-relaxed'>{description}</div>}
                          </div>
                        </div>
                      );
                    })}
                  {installedSkills.filter((s) => !s.isBuiltin).length === 0 && (
                    <div className='text-center text-secondary text-12px py-16px col-span-full'>
                      {t('settings.noCustomSkills', {
                        defaultValue: 'No custom skills available',
                      })}
                    </div>
                  )}
                </div>
              </Collapse.Item>
              <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.builtinSkills', { defaultValue: '内置技能' })}</span>} name='builtin-skills' extra={<span className='text-12px text-secondary'>{installedSkills.filter((s) => s.isBuiltin).length}</span>}>
                <div
                  className='grid gap-8px'
                  style={{
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  }}
                >
                  {installedSkills
                    .filter((s) => s.isBuiltin)
                    .map((skill) => {
                      const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skill);
                      return (
                        <div key={skill.name} className={`bg-fill-1 rd-12px border p-12px flex items-start gap-12px relative ${isReadonly ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <Checkbox
                            checked={isAssistantSkillSelected(selectedSkills, skill)}
                            onChange={() => {
                              if (isReadonly) return;
                              setSelectedSkills(toggleAssistantSkillSelection(selectedSkills, skill));
                            }}
                            disabled={isReadonly}
                            className={`mt-2px ${isReadonly ? '' : 'cursor-pointer'}`}
                          />
                          <div className='w-48px h-48px flex-shrink-0 rd-8px overflow-hidden bg-fill-2'>
                            {icon ? (
                              <img src={icon} alt={displayName} className='w-full h-full object-cover' onError={handleSkillIconError} />
                            ) : emoji ? (
                              <div className='w-full h-full f-center text-22px'>{emoji}</div>
                            ) : (
                              <div className='w-full h-full f-center'>
                                <Zap size={22} className='text-primary' />
                              </div>
                            )}
                          </div>
                          <div className='flex-1 min-w-0'>
                            <div className='flex items-center gap-6px'>
                              <span className='font-medium text-13px text-foreground truncate'>{displayName}</span>
                              {skill.isBuiltin && <Shield size={14} className='text-primary flex-shrink-0' />}
                            </div>
                            {description && <div className='text-11px text-secondary mt-3px line-clamp-2 leading-relaxed'>{description}</div>}
                          </div>
                        </div>
                      );
                    })}
                  {installedSkills.filter((s) => s.isBuiltin).length === 0 && (
                    <div className='text-center text-secondary text-12px py-16px col-span-full'>
                      {t('settings.noBuiltinSkills', {
                        defaultValue: 'No builtin skills available',
                      })}
                    </div>
                  )}
                </div>
              </Collapse.Item>
            </Collapse>
          </div>
        </div>
      </div>
    </Drawer>
  );
};

export default AssistantEditDrawer;
