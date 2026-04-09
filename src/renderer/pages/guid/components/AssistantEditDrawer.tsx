/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Assistant edit drawer for the GUID page.
 * Provides the same editing experience as the Settings > Assistants drawer,
 * allowing users to modify assistant details without leaving the conversation page.
 */

import { ipcBridge, skillHub } from '@/common';
import type { IInstalledSkillInfo } from '@/common/ipcBridge';
import { getPresetById } from '@/common/presets/presetResolver';
import { ConfigStorage } from '@/common/storage';
import type { AcpBackendConfig } from '@/types/acpTypes';
import { getAgentLogo } from '@/renderer/utils/agentLogo';
import { getInstalledSkillDisplay, normalizeSkillVersion } from '@/renderer/utils/skillDisplay';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import EmojiPicker from '@/renderer/components/EmojiPicker';
import MarkdownView from '@/renderer/components/Markdown';
import coworkSvg from '@/renderer/assets/cowork.svg';
import { Avatar, Button, Checkbox, Collapse, Drawer, Input, Message, Select, Typography } from '@arco-design/web-react';
import { Close, Lightning, Robot, Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mutate } from 'swr';

type AssistantEditDrawerProps = {
  visible: boolean;
  assistantId: string | null;
  localeKey: string;
  onClose: () => void;
  onSaved: () => void;
};

const AVATAR_IMAGE_MAP: Record<string, string> = {
  'cowork.svg': coworkSvg,
  '\u{1F6E0}\u{FE0F}': coworkSvg,
};

/** Built-in agent options with backend IDs for filtering */
const AGENT_OPTIONS = [
  { value: 'gemini', label: 'Gemini CLI' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'qwen', label: 'Qwen Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'codebuddy', label: 'CodeBuddy' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'sudoclaw', label: 'SudoClaw', backendId: 'openclaw-gateway' },
] as const;

const AssistantEditDrawer: React.FC<AssistantEditDrawerProps> = ({ visible, assistantId, localeKey, onClose, onSaved }) => {
  const { t } = useTranslation();
  const textareaWrapperRef = useRef<HTMLDivElement>(null);

  // Edit state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editAgent, setEditAgent] = useState<string>('sudoclaw');
  const [editContext, setEditContext] = useState('');
  const [promptViewMode, setPromptViewMode] = useState<'edit' | 'preview'>('preview');
  const [drawerWidth, setDrawerWidth] = useState(500);

  // Skills state
  const [installedSkills, setInstalledSkills] = useState<IInstalledSkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  // Available backends for agent selector filtering
  const [availableBackends, setAvailableBackends] = useState<Set<string>>(new Set(['gemini']));

  // Current assistant data
  const [assistant, setAssistant] = useState<AcpBackendConfig | null>(null);
  const isBuiltin = Boolean(assistant?.isBuiltin);
  // Extension assistants are loaded from extensions, not from acp.customAgents,
  // so they won't be found by the drawer loader. This check is a safety fallback.
  const isExtension = assistant?.id?.startsWith('ext-') ?? false;

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

  // Load available backends
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

  // Load assistant data when drawer opens
  useEffect(() => {
    if (!visible || !assistantId) return;
    let cancelled = false;

    const loadAssistant = async () => {
      try {
        const agents: AcpBackendConfig[] = (await ConfigStorage.get('acp.customAgents')) || [];
        const found = agents.find((a) => a.id === assistantId);
        if (cancelled || !found) return;

        // Update presetAgentType from presets for builtin
        if (found.id.startsWith('builtin-')) {
          const presetId = found.id.replace('builtin-', '');
          const preset = getPresetById(presetId);
          if (preset?.presetAgentType) {
            found.presetAgentType = preset.presetAgentType;
          }
        }

        setAssistant(found);
        setEditName(found.name || '');
        setEditDescription(found.description || '');
        setEditAvatar(found.avatar || '');
        setEditAgent(found.presetAgentType || 'sudoclaw');
        setSelectedSkills(found.enabledSkills || []);

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
              setInstalledSkills(res.data.filter((s) => s.isBuiltin || s.enabled !== false));
            }
          } catch {
            if (!cancelled) setInstalledSkills([]);
          }
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
    if (isExtension) {
      Message.warning(
        t('settings.extensionAssistantReadonly', {
          defaultValue: 'Extension assistants are read-only. You can duplicate it and edit the copy.',
        })
      );
      return;
    }

    try {
      const agents: AcpBackendConfig[] = (await ConfigStorage.get('acp.customAgents')) || [];
      const updatedAgent: AcpBackendConfig = {
        ...assistant,
        name: editName,
        description: editDescription,
        avatar: editAvatar,
        presetAgentType: editAgent,
        enabledSkills: selectedSkills,
      };

      // Save rules file if changed
      if (editContext.trim()) {
        await ipcBridge.fs.writeAssistantRule.invoke({
          assistantId: assistant.id,
          locale: localeKey,
          content: editContext,
        });
      }

      const updatedAgents = agents.map((a) => (a.id === assistant.id ? updatedAgent : a));
      await ConfigStorage.set('acp.customAgents', updatedAgents);

      // Refresh agent detection
      await ipcBridge.acpConversation.refreshCustomAgents.invoke();
      await mutate('acp.agents.available');

      Message.success(t('common.saveSuccess', { defaultValue: 'Saved successfully' }));
      onSaved();
      onClose();
    } catch (error) {
      console.error('Failed to save assistant:', error);
      Message.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  }, [assistant, isExtension, editName, editDescription, editAvatar, editAgent, editContext, selectedSkills, localeKey, onSaved, onClose, t]);

  const editAvatarImage = resolveAvatarImage(editAvatar);
  const isReadonly = isExtension;

  return (
    <Drawer
      title={
        <>
          <span>
            {t('settings.editAssistant', {
              defaultValue: 'Assistant Details',
            })}
          </span>
          <div
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className='absolute right-4 top-2 cursor-pointer text-t-secondary hover:text-t-primary transition-colors p-1'
            style={{ zIndex: 10, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Close size={18} />
          </div>
        </>
      }
      closable={false}
      visible={visible}
      placement='right'
      width={drawerWidth}
      zIndex={1200}
      autoFocus={false}
      onCancel={onClose}
      headerStyle={{ background: 'var(--color-bg-1)' }}
      bodyStyle={{ background: 'var(--color-bg-1)' }}
      footer={
        <div className='flex items-center justify-between w-full'>
          <div className='flex items-center gap-8px'>
            <Button type='primary' onClick={handleSave} disabled={isReadonly} className='w-[100px] rounded-[100px]'>
              {t('common.save', { defaultValue: 'Save' })}
            </Button>
            <Button onClick={onClose} className='w-[100px] rounded-[100px] bg-fill-2'>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </div>
      }
    >
      <div className='flex flex-col h-full overflow-hidden'>
        <div className='flex flex-col flex-1 gap-16px bg-fill-2 rounded-16px p-20px overflow-y-auto'>
          {/* Name & Avatar */}
          <div className='flex-shrink-0'>
            <Typography.Text bold>
              <span className='text-red-500'>*</span>{' '}
              {t('settings.assistantNameAvatar', {
                defaultValue: 'Name & Avatar',
              })}
            </Typography.Text>
            <div className='mt-10px flex items-center gap-12px'>
              {isBuiltin || isReadonly ? (
                <Avatar shape='square' size={40} className='bg-bg-1 rounded-4px'>
                  {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar && isEmoji(editAvatar) ? <span className='text-24px'>{editAvatar}</span> : <Robot theme='outline' size={20} />}
                </Avatar>
              ) : (
                <EmojiPicker value={editAvatar} onChange={(emoji) => setEditAvatar(emoji)} placement='br'>
                  <div className='cursor-pointer'>
                    <Avatar shape='square' size={40} className='bg-bg-1 rounded-4px hover:bg-fill-2 transition-colors'>
                      {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar && isEmoji(editAvatar) ? <span className='text-24px'>{editAvatar}</span> : <Robot theme='outline' size={20} />}
                    </Avatar>
                  </div>
                </EmojiPicker>
              )}
              <Input
                value={editName}
                onChange={(value) => setEditName(value)}
                disabled={isBuiltin || isReadonly}
                placeholder={t('settings.agentNamePlaceholder', {
                  defaultValue: 'Enter a name for this agent',
                })}
                className='flex-1 rounded-4px bg-bg-1'
              />
            </div>
          </div>

          {/* Description */}
          <div className='flex-shrink-0'>
            <Typography.Text bold>
              {t('settings.assistantDescription', {
                defaultValue: 'Assistant Description',
              })}
            </Typography.Text>
            <Input
              className='mt-10px rounded-4px bg-bg-1'
              value={editDescription}
              onChange={(value) => setEditDescription(value)}
              disabled={isBuiltin || isReadonly}
              placeholder={t('settings.assistantDescriptionPlaceholder', {
                defaultValue: 'What can this assistant help with?',
              })}
            />
          </div>

          {/* Main Agent */}
          <div className='flex-shrink-0'>
            <Typography.Text bold>
              {t('settings.assistantMainAgent', {
                defaultValue: 'Main Agent',
              })}
            </Typography.Text>
            <Select className='mt-10px w-full rounded-4px' value={editAgent} onChange={(value) => setEditAgent(value as string)} disabled={isReadonly}>
              {AGENT_OPTIONS.filter((opt) => availableBackends.has(opt.backendId || opt.value)).map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  <span className='flex items-center gap-6px'>
                    {getAgentLogo(opt.backendId || opt.value) && <img src={getAgentLogo(opt.backendId || opt.value) || undefined} alt='' width={16} height={16} style={{ objectFit: 'contain' }} />}
                    {opt.label}
                  </span>
                </Select.Option>
              ))}
            </Select>
          </div>

          {/* Rules */}
          <div className='flex-shrink-0'>
            <Typography.Text bold className='flex-shrink-0'>
              {t('settings.assistantRules', { defaultValue: 'Rules' })}
            </Typography.Text>
            <div className='mt-10px border border-border-2 overflow-hidden rounded-4px' style={{ height: '300px' }}>
              {!isBuiltin && !isReadonly && (
                <div className='flex items-center h-36px bg-fill-2 border-b border-border-2 flex-shrink-0'>
                  <div className={`flex items-center h-full px-16px cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'edit' ? 'text-primary border-b-2 border-primary bg-bg-1' : 'text-t-secondary hover:text-t-primary'}`} onClick={() => setPromptViewMode('edit')}>
                    {t('settings.promptEdit', { defaultValue: 'Edit' })}
                  </div>
                  <div className={`flex items-center h-full px-16px cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'preview' ? 'text-primary border-b-2 border-primary bg-bg-1' : 'text-t-secondary hover:text-t-primary'}`} onClick={() => setPromptViewMode('preview')}>
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
                    <Input.TextArea
                      value={editContext}
                      onChange={(value) => setEditContext(value)}
                      placeholder={t('settings.assistantRulesPlaceholder', {
                        defaultValue: 'Enter rules in Markdown format...',
                      })}
                      autoSize={false}
                      className='border-none rounded-none bg-transparent h-full resize-none'
                    />
                  </div>
                ) : (
                  <div className='p-16px'>
                    {editContext ? (
                      <MarkdownView hiddenCodeCopyButton>{editContext}</MarkdownView>
                    ) : (
                      <div className='text-t-secondary text-center py-32px'>
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
              <Typography.Text bold>{t('settings.assistantSkills', { defaultValue: 'Skills' })}</Typography.Text>
            </div>
            <Collapse defaultActiveKey={['custom-skills']}>
              <Collapse.Item
                header={
                  <span className='text-13px font-medium'>
                    {t('settings.customSkills', {
                      defaultValue: 'Custom Skills',
                    })}
                  </span>
                }
                name='custom-skills'
                className='mb-8px'
                extra={<span className='text-12px text-t-secondary'>{installedSkills.filter((s) => !s.isBuiltin).length}</span>}
              >
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
                        <div key={skill.name} className='bg-fill-1 rd-12px border border-line p-12px flex items-start gap-12px relative'>
                          <Checkbox
                            checked={selectedSkills.includes(skill.name)}
                            onChange={() => {
                              if (selectedSkills.includes(skill.name)) {
                                setSelectedSkills(selectedSkills.filter((s) => s !== skill.name));
                              } else {
                                setSelectedSkills([...selectedSkills, skill.name]);
                              }
                            }}
                            className='mt-2px cursor-pointer'
                          />
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
                    })}
                  {installedSkills.filter((s) => !s.isBuiltin).length === 0 && (
                    <div className='text-center text-t-secondary text-12px py-16px col-span-full'>
                      {t('settings.noCustomSkills', {
                        defaultValue: 'No custom skills available',
                      })}
                    </div>
                  )}
                </div>
              </Collapse.Item>
              <Collapse.Item
                header={
                  <span className='text-13px font-medium'>
                    {t('settings.builtinSkills', {
                      defaultValue: 'Builtin Skills',
                    })}
                  </span>
                }
                name='builtin-skills'
                extra={<span className='text-12px text-t-secondary'>{installedSkills.filter((s) => s.isBuiltin).length}</span>}
              >
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
                        <div key={skill.name} className='bg-fill-1 rd-12px border border-line p-12px flex items-start gap-12px relative'>
                          <Checkbox
                            checked={selectedSkills.includes(skill.name)}
                            onChange={() => {
                              if (selectedSkills.includes(skill.name)) {
                                setSelectedSkills(selectedSkills.filter((s) => s !== skill.name));
                              } else {
                                setSelectedSkills([...selectedSkills, skill.name]);
                              }
                            }}
                            className='mt-2px cursor-pointer'
                          />
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
                              {skill.isBuiltin && <Shield size='14' className='text-primary flex-shrink-0' />}
                            </div>
                            {description && <div className='text-11px text-t-secondary mt-3px line-clamp-2 leading-relaxed'>{description}</div>}
                          </div>
                        </div>
                      );
                    })}
                  {installedSkills.filter((s) => s.isBuiltin).length === 0 && (
                    <div className='text-center text-t-secondary text-12px py-16px col-span-full'>
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
