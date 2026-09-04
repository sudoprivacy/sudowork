/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Avatar, Button, Collapse, Drawer, Input, Select, Typography } from '@arco-design/web-react';
import { Bot } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IInstalledSkillInfo } from '@sudowork/host-bridge/ipcBridge';
import { DEFAULT_PRESET_AGENT_TYPE } from '@sudowork/common/acpTypes';
import EmojiPicker from '@renderer/components/base/EmojiPicker';
import MarkdownView from '@renderer/components/Markdown';
import { isAssistantSkillSelected, toggleAssistantSkillSelection } from '../utils';
import SkillCard from './SkillCard';

export default function AssistantOperateDrawer({
  visible,
  isCreating,
  isReadonly,
  editAvatar,
  editAvatarImage,
  editName,
  editDescription,
  editContext,
  promptViewMode,
  customSelectableSkills,
  builtinSelectableSkills,
  selectedSkills,
  onClose,
  onSave,
  onAvatarChange,
  onNameChange,
  onDescriptionChange,
  onContextChange,
  onPromptViewModeChange,
  onSkillsChange,
}: IAssistantOperateDrawerProps) {
  const { t } = useTranslation();
  const textareaWrapperRef = useRef<HTMLDivElement>(null);
  const [drawerWidth, setDrawerWidth] = useState(500);

  useEffect(() => {
    const update = () => {
      if (typeof window === 'undefined') return;
      setDrawerWidth(Math.min(500, Math.max(320, Math.floor(window.innerWidth - 32))));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (visible && promptViewMode === 'edit') {
      const timer = setTimeout(() => {
        textareaWrapperRef.current?.querySelector('textarea')?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [visible, promptViewMode]);

  return (
    <Drawer
      title={isCreating ? t('settings.createAssistant', '创建智能体') : t('settings.editAssistant', '智能体详情')}
      closable
      visible={visible}
      placement='right'
      width={drawerWidth}
      zIndex={1200}
      autoFocus={false}
      onCancel={onClose}
      footer={
        <div className='flex justify-end gap-2'>
          <Button onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type='primary' onClick={onSave} disabled={!isCreating && isReadonly}>
            {isCreating ? t('common.create', 'Create') : t('common.save', 'Save')}
          </Button>
        </div>
      }
    >
      <div className='flex flex-col h-full overflow-hidden'>
        <div className='flex flex-col flex-1 gap-4 pr-2 overflow-y-auto'>
          {/* Name & Avatar */}
          <div className='flex-shrink-0'>
            <Typography.Text bold>
              <span className='text-red-500'>*</span> {t('settings.assistantNameAvatar', '名称及头像')}
            </Typography.Text>
            <div className='mt-2.5 flex items-center gap-3'>
              {isReadonly ? (
                <Avatar shape='square' size={40} className='rounded-lg'>
                  {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar ? <span className='text-24px'>{editAvatar}</span> : <Bot size={20} />}
                </Avatar>
              ) : (
                <EmojiPicker value={editAvatar} onChange={onAvatarChange} placement='br'>
                  <div className='cursor-pointer'>
                    <Avatar shape='square' size={40} className='rounded-lg hover:bg-control transition-colors'>
                      {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar ? <span className='text-24px'>{editAvatar}</span> : <Bot size={20} />}
                    </Avatar>
                  </div>
                </EmojiPicker>
              )}
              <Input value={editName} onChange={onNameChange} disabled={isReadonly} placeholder={t('settings.agentNamePlaceholder', 'Enter a name for this agent')} className='flex-1' />
            </div>
          </div>

          {/* Description */}
          <div className='flex-shrink-0'>
            <Typography.Text bold>{t('settings.assistantDescription', '智能体描述')}</Typography.Text>
            <Input className='mt-2.5' value={editDescription} onChange={onDescriptionChange} disabled={isReadonly} placeholder={t('settings.assistantDescriptionPlaceholder', '帮你解决什么问题')} />
          </div>

          {/* Main Agent - locked to Sudo Code */}
          <div className='flex-shrink-0'>
            <Typography.Text bold>{t('settings.assistantMainAgent', '主智能体')}</Typography.Text>
            <Select className='mt-2.5 w-full' value={DEFAULT_PRESET_AGENT_TYPE} disabled>
              <Select.Option key='scode' value='scode'>
                Sudo Code
              </Select.Option>
            </Select>
          </div>

          {/* Rules */}
          <div className='flex-shrink-0'>
            <Typography.Text bold className='flex-shrink-0'>
              {t('settings.assistantRules', '规则')}
            </Typography.Text>
            <div className='mt-2.5 overflow-hidden rounded-lg border border-light' style={{ height: '300px' }}>
              {!isReadonly && (
                <div className='flex items-center h-9 bg-control border-b border-light flex-shrink-0'>
                  <div className={`flex items-center h-full px-4 cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'edit' ? 'text-primary border-b-2px border-primary' : 'text-secondary hover:text-foreground'}`} onClick={() => onPromptViewModeChange('edit')}>
                    {t('settings.promptEdit', 'Edit')}
                  </div>
                  <div className={`flex items-center h-full px-4 cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'preview' ? 'text-primary border-b-2px border-primary' : 'text-secondary hover:text-foreground'}`} onClick={() => onPromptViewModeChange('preview')}>
                    {t('settings.promptPreview', 'Preview')}
                  </div>
                </div>
              )}
              <div className='' style={{ height: isReadonly ? '100%' : 'calc(100% - 36px)', overflow: 'auto' }}>
                {promptViewMode === 'edit' && !isReadonly ? (
                  <div ref={textareaWrapperRef} className='h-full'>
                    <Input.TextArea value={editContext} onChange={onContextChange} placeholder={t('settings.assistantRulesPlaceholder', '请输入 Markdown 格式的规则...')} autoSize={false} className='border-none rounded-none bg-transparent h-full resize-none' />
                  </div>
                ) : (
                  <div className='p-4'>{editContext ? <MarkdownView hiddenCodeCopyButton>{editContext}</MarkdownView> : <div className='text-secondary text-center py-8'>{t('settings.promptPreviewEmpty', 'No content to preview')}</div>}</div>
                )}
              </div>
            </div>
          </div>

          {/* Skills selection */}
          <div className='flex-shrink-0 mt-4'>
            <div className='flex items-center justify-between mb-3'>
              <Typography.Text bold>{t('settings.assistantSkills', '技能')}</Typography.Text>
            </div>
            <Collapse defaultActiveKey={['custom-skills']}>
              <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.customSkills', 'Custom Skills')}</span>} name='custom-skills' extra={<span className='text-12px text-secondary'>{customSelectableSkills.length}</span>}>
                <div className='grid gap-2' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                  {customSelectableSkills.map((skill) => (
                    <SkillCard
                      key={skill.name}
                      skill={skill}
                      checked={isAssistantSkillSelected(selectedSkills, skill)}
                      onToggle={() => {
                        if (isReadonly) return;
                        onSkillsChange(toggleAssistantSkillSelection(selectedSkills, skill));
                      }}
                      disabled={isReadonly}
                    />
                  ))}
                  {customSelectableSkills.length === 0 && <div className='text-center text-secondary text-12px py-4 col-span-full'>{t('settings.noCustomSkills', 'No custom skills available')}</div>}
                </div>
              </Collapse.Item>
              <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.builtinSkills', 'Builtin Skills')}</span>} name='builtin-skills' extra={<span className='text-12px text-secondary'>{builtinSelectableSkills.length}</span>}>
                <div className='grid gap-2' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                  {builtinSelectableSkills.map((skill) => (
                    <SkillCard
                      key={skill.name}
                      skill={skill}
                      checked={isAssistantSkillSelected(selectedSkills, skill)}
                      onToggle={() => {
                        if (isReadonly) return;
                        onSkillsChange(toggleAssistantSkillSelection(selectedSkills, skill));
                      }}
                      disabled={isReadonly}
                    />
                  ))}
                  {builtinSelectableSkills.length === 0 && <div className='text-center text-secondary text-12px py-4 col-span-full'>{t('settings.noBuiltinSkills', 'No builtin skills available')}</div>}
                </div>
              </Collapse.Item>
            </Collapse>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

interface IAssistantOperateDrawerProps {
  visible: boolean;
  isCreating: boolean;
  isReadonly: boolean;
  editAvatar: string;
  editAvatarImage: string | undefined;
  editName: string;
  editDescription: string;
  editContext: string;
  promptViewMode: 'edit' | 'preview';
  customSelectableSkills: IInstalledSkillInfo[];
  builtinSelectableSkills: IInstalledSkillInfo[];
  selectedSkills: string[];
  onClose: () => void;
  onSave: () => void;
  onAvatarChange: (emoji: string) => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onContextChange: (value: string) => void;
  onPromptViewModeChange: (mode: 'edit' | 'preview') => void;
  onSkillsChange: (skills: string[]) => void;
}
