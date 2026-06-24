/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Drawer, Form, Input, Message, Select } from '@arco-design/web-react';
import { Close } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ICronJob } from '@/common/ipcBridge';
import type { TChatConversation } from '@/common/storage';
import type { AcpBackendAll } from '@/types/acpTypes';
import { DEFAULT_PRESET_AGENT_TYPE, resolvePresetAgentBackend } from '@/types/acpTypes';
import { useAssistantsForCron } from '@/renderer/pages/cron/hooks/useAssistantsForCron';
import type { FrequencyPreset } from '@/renderer/pages/cron/types';
import { FREQUENCY_PRESETS, WEEKDAYS, frequencyToSchedule, scheduleToFrequency, unwrapCronResult } from '@/renderer/pages/cron/utils';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';

const DEFAULT_ASSISTANT = '__default__';
const TextArea = Input.TextArea;
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: `${String(i).padStart(2, '0')}` }));
const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((minute) => ({ value: minute, label: String(minute).padStart(2, '0') }));

export default function CronJobFormDrawer({ visible, editJob, sessionMode, onClose, onSaved }: ICronJobFormDrawerProps) {
  const { t, i18n } = useTranslation();

  const localeKey = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
  const assistants = useAssistantsForCron();

  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [frequency, setFrequency] = useState<FrequencyPreset>('daily');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [weekday, setWeekday] = useState('MON');
  const [showMore, setShowMore] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const [conversationMode, setConversationMode] = useState<'new' | 'reuse'>('new');
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>(DEFAULT_ASSISTANT);
  const [selectedConversationId, setSelectedConversationId] = useState<string>('');
  const [conversations, setConversations] = useState<TChatConversation[]>([]);

  const frequencyLabels: Record<FrequencyPreset, string> = {
    manual: t('cron.create.frequency.manual'),
    hourly: t('cron.create.frequency.hourly'),
    daily: t('cron.create.frequency.daily'),
    weekdays: t('cron.create.frequency.weekdays'),
    weekly: t('cron.create.frequency.weekly'),
  };
  const weekdayLabels: Record<string, string> = {
    SUN: t('cron.create.weekday.SUN'),
    MON: t('cron.create.weekday.MON'),
    TUE: t('cron.create.weekday.TUE'),
    WED: t('cron.create.weekday.WED'),
    THU: t('cron.create.weekday.THU'),
    FRI: t('cron.create.weekday.FRI'),
    SAT: t('cron.create.weekday.SAT'),
  };

  useEffect(() => {
    if (visible) {
      if (editJob) {
        const parsed = scheduleToFrequency(editJob.schedule);
        setFrequency(parsed.preset);
        setHour(parsed.hour);
        setMinute(parsed.minute);
        setWeekday(parsed.weekday);
        setConversationMode(editJob.metadata.conversationMode ?? 'new');
        setWorkspace(editJob.metadata.workspace ?? '');
        setSelectedAssistantId(editJob.metadata.presetAssistantId || DEFAULT_ASSISTANT);
        setSelectedConversationId(editJob.metadata.conversationId || '');
        form.setFieldsValue({
          name: editJob.name,
          description: editJob.schedule.description,
          prompt: editJob.target.payload.text,
        });
      } else {
        form.resetFields();
        setFrequency('daily');
        setHour(9);
        setMinute(0);
        setWeekday('MON');
        setWorkspace('');
        setShowMore(false);
        setConversationMode('new');
        setSelectedAssistantId(DEFAULT_ASSISTANT);
        setSelectedConversationId('');
      }
    }
  }, [visible, editJob, form]);

  // Lazily fetch conversation list when reuse mode is selected. Filter out
  // health-check conversations (same predicate as `useConversations` hook).
  useEffect(() => {
    if (!visible || conversationMode !== 'reuse') return;
    let cancelled = false;
    ipcBridge.database.getUserConversations
      .invoke({ page: 0, pageSize: 10000 })
      .then((data) => {
        if (cancelled) return;
        if (data && Array.isArray(data)) {
          const filtered = data.filter((conv) => (conv.extra as { isHealthCheck?: boolean } | undefined)?.isHealthCheck !== true);
          setConversations(filtered);
        } else {
          setConversations([]);
        }
      })
      .catch(() => {
        if (!cancelled) setConversations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, conversationMode]);

  const handleSelectFolder = useCallback(async () => {
    try {
      const res = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory'] });
      if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
        setWorkspace(res.data.filePaths[0]);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSave = async () => {
    try {
      const values = await form.validate();
      setSaving(true);

      const schedule = frequencyToSchedule(frequency, { hour, minute, weekday }, t);
      const isManual = frequency === 'manual';

      // When a conversation is bound in reuse mode, assistant & workspace come from
      // that conversation — ignore the form values.
      const isBoundConversation = conversationMode === 'reuse' && !!selectedConversationId;
      const useBoundConversationDefaults = sessionMode !== 'remote' && isBoundConversation;

      // Derive agentType from selected assistant's presetAgentType; default to scode
      const isDefaultAssistant = selectedAssistantId === DEFAULT_ASSISTANT;
      const effectiveAssistantId = isDefaultAssistant ? undefined : selectedAssistantId;
      const selectedAssistant = effectiveAssistantId ? assistants.find((assistant) => assistant.id === effectiveAssistantId) : undefined;
      const presetAgentType = selectedAssistant?.presetAgentType || DEFAULT_PRESET_AGENT_TYPE;
      const agentType = resolvePresetAgentBackend(presetAgentType) as AcpBackendAll;

      // For reuse mode, allow optionally binding an existing conversation so the
      // very first run appends to it. New mode ignores the picker entirely.
      const reuseConvId = conversationMode === 'reuse' ? selectedConversationId : '';
      const reuseConvTitle = reuseConvId ? conversations.find((conversation) => conversation.id === reuseConvId)?.name : undefined;
      const effectiveWorkspace = sessionMode === 'remote' ? undefined : workspace || undefined;

      let result: unknown;
      if (editJob) {
        // Update existing job. JSON IPC strips `undefined`, so we pass an explicit
        // `null` sentinel when clearing the assistant back to Default — the backend
        // normalizes `null` → cleared field.
        result = await ipcBridge.cron.updateJob.invoke({
          jobId: editJob.id,
          updates: {
            name: values.name,
            enabled: isManual ? false : editJob.enabled,
            schedule: schedule || editJob.schedule,
            target: { payload: { kind: 'message', text: values.prompt } },
            metadata: {
              ...editJob.metadata,
              agentType: useBoundConversationDefaults ? editJob.metadata.agentType : agentType,
              conversationMode,
              // Bind/unbind conversation for reuse mode. New mode keeps the
              // existing conversationId untouched (it's auto-managed via state.lastConversationId).
              conversationId: conversationMode === 'reuse' ? reuseConvId : editJob.metadata.conversationId,
              conversationTitle: conversationMode === 'reuse' ? reuseConvTitle : editJob.metadata.conversationTitle,
              workspace: useBoundConversationDefaults ? editJob.metadata.workspace : effectiveWorkspace,
              presetAssistantId: useBoundConversationDefaults ? editJob.metadata.presetAssistantId : isDefaultAssistant ? null : effectiveAssistantId,
            },
          },
        });
      } else {
        result = await ipcBridge.cron.addJob.invoke({
          name: values.name,
          schedule: schedule || { kind: 'cron', expr: '0 9 * * *', description: values.description || values.name },
          message: values.prompt,
          conversationId: reuseConvId,
          conversationTitle: reuseConvTitle,
          agentType,
          createdBy: 'user',
          conversationMode,
          workspace: effectiveWorkspace,
          presetAssistantId: effectiveAssistantId,
        });
      }

      unwrapCronResult(result);

      Message.success(t('cron.drawer.saveSuccess'));
      onSaved();
      onClose();
    } catch (err: unknown) {
      // Arco form.validate() rejects with a non-Error object on validation
      // failure — only show a toast for actual runtime / IPC errors.
      if (err instanceof Error) {
        Message.error(err.message);
      } else if (typeof err === 'string') {
        Message.error(err);
      }
    } finally {
      setSaving(false);
    }
  };

  const showTimeSelector = frequency === 'daily' || frequency === 'weekdays' || frequency === 'weekly';

  return (
    <Drawer
      placement='right'
      width={520}
      title={
        <>
          <span className='text-16px font-medium'>{editJob ? t('cron.create.editTitle', { defaultValue: '编辑定时任务' }) : t('cron.create.title', { defaultValue: '创建定时任务' })}</span>
          <div
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className='absolute right-4 top-2 cursor-pointer text-secondary hover:text-foreground transition-colors p-1'
            style={{ zIndex: 10, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Close size={18} />
          </div>
        </>
      }
      closable={false}
      visible={visible}
      onCancel={onClose}
      footer={
        <div className='flex justify-end gap-8px'>
          <Button shape='round' onClick={onClose}>
            {t('cron.create.cancel', { defaultValue: '取消' })}
          </Button>
          <Button type='primary' shape='round' loading={saving} onClick={handleSave}>
            {t('cron.drawer.save')}
          </Button>
        </div>
      }
    >
      <Form form={form} layout='vertical'>
        <Form.Item label={t('cron.drawer.name')} field='name' rules={[{ required: true }]}>
          <Input placeholder='daily-briefing' />
        </Form.Item>

        <Form.Item label={t('cron.create.description', { defaultValue: '描述' })} field='description'>
          <Input placeholder={t('cron.create.descriptionPlaceholder', { defaultValue: '简述任务目的' })} />
        </Form.Item>

        <Form.Item label={t('cron.create.prompt', { defaultValue: '指令' })} field='prompt' rules={[{ required: true }]}>
          <TextArea placeholder={t('cron.create.promptPlaceholder', { defaultValue: '输入触发时要发送的指令...' })} autoSize={{ minRows: 4, maxRows: 10 }} />
        </Form.Item>

        <div className='mb-16px'>
          <div className='text-14px text-foreground mb-8px'>{t('cron.create.frequency', { defaultValue: '频率' })}</div>
          <Select value={frequency} onChange={(value) => setFrequency(value as FrequencyPreset)}>
            {FREQUENCY_PRESETS.map((preset) => (
              <Select.Option key={preset} value={preset}>
                {frequencyLabels[preset]}
              </Select.Option>
            ))}
          </Select>

          {showTimeSelector && (
            <div className='flex items-center gap-8px mt-8px'>
              <Select value={hour} onChange={(value) => setHour(value)} style={{ width: 80 }}>
                {HOUR_OPTIONS.map((option) => (
                  <Select.Option key={option.value} value={option.value}>
                    {option.label}
                  </Select.Option>
                ))}
              </Select>
              <span className='text-secondary'>:</span>
              <Select value={minute} onChange={(value) => setMinute(value)} style={{ width: 80 }}>
                {MINUTE_OPTIONS.map((option) => (
                  <Select.Option key={option.value} value={option.value}>
                    {option.label}
                  </Select.Option>
                ))}
              </Select>
            </div>
          )}

          {frequency === 'weekly' && (
            <div className='mt-8px'>
              <Select value={weekday} onChange={(value) => setWeekday(value)}>
                {WEEKDAYS.map((day) => (
                  <Select.Option key={day} value={day}>
                    {weekdayLabels[day]}
                  </Select.Option>
                ))}
              </Select>
            </div>
          )}

          <div className='text-12px text-secondary mt-4px'>{t('cron.create.frequencyHint', { defaultValue: '定时任务会有几分钟的随机延迟' })}</div>
        </div>

        <div>
          <div className='flex items-center gap-4px text-14px text-secondary cursor-pointer hover:text-foreground mb-12px' onClick={() => setShowMore(!showMore)}>
            <span>{t('cron.create.moreOptions', { defaultValue: '更多选项' })}</span>
            <span className={`transition-transform ${showMore ? 'rotate-180' : ''}`}>▾</span>
          </div>

          {showMore && (
            <div className='grid grid-cols-1 md:grid-cols-2 gap-12px'>
              <div className='col-span-2'>
                <div className='text-13px text-secondary mb-4px'>{t('cron.create.conversationMode', { defaultValue: '执行模式' })}</div>
                <Select value={conversationMode} onChange={(value) => setConversationMode(value as 'new' | 'reuse')}>
                  <Select.Option value='new'>{t('cron.create.conversationMode.new', { defaultValue: '每次新建会话（推荐）' })}</Select.Option>
                  <Select.Option value='reuse'>{t('cron.create.conversationMode.reuse', { defaultValue: '复用已有会话（适合持续追加）' })}</Select.Option>
                </Select>
              </div>

              {conversationMode === 'reuse' && (
                <div className='col-span-2'>
                  <div className='text-13px text-secondary mb-4px'>{t('cron.create.reuseConversation', { defaultValue: '绑定会话' })}</div>
                  <Select
                    value={selectedConversationId}
                    onChange={(value) => setSelectedConversationId(value as string)}
                    showSearch
                    filterOption={(inputValue, option) => {
                      const optionValue = (option as React.ReactElement<{ value?: string }>)?.props?.value;
                      if (!optionValue) return true; // keep the placeholder visible while searching
                      const conversation = conversations.find((item) => item.id === optionValue);
                      const label = conversation?.name || optionValue;
                      return label.toLowerCase().includes(inputValue.toLowerCase());
                    }}
                  >
                    <Select.Option value=''>
                      <span className='text-secondary'>{t('cron.create.reuseConversationPlaceholder', { defaultValue: '首次运行时自动创建' })}</span>
                    </Select.Option>
                    {conversations.map((conversation) => (
                      <Select.Option key={conversation.id} value={conversation.id}>
                        {conversation.name || conversation.id}
                      </Select.Option>
                    ))}
                  </Select>
                  <div className='text-12px text-secondary mt-4px'>{t('cron.create.reuseConversationHint', { defaultValue: '选择已有会话，首次运行将直接追加到该会话' })}</div>
                </div>
              )}

              {!(sessionMode !== 'remote' && conversationMode === 'reuse' && selectedConversationId) && (
                <div>
                  <div className='text-13px text-secondary mb-4px'>{t('cron.create.agent', { defaultValue: '数字助手' })}</div>
                  <Select value={selectedAssistantId} onChange={(value) => setSelectedAssistantId(value as string)} disabled={sessionMode !== 'remote' && editJob != null && conversationMode === 'reuse'}>
                    <Select.Option value={DEFAULT_ASSISTANT}>
                      <span className='text-secondary'>{t('cron.create.agentPlaceholder', { defaultValue: '默认 (Sudo Code)' })}</span>
                    </Select.Option>
                    {selectedAssistantId !== DEFAULT_ASSISTANT && !assistants.some((assistant) => assistant.id === selectedAssistantId) && (
                      <Select.Option value={selectedAssistantId}>
                        <span>{selectedAssistantId}</span>
                      </Select.Option>
                    )}
                    {assistants.map((assistant) => {
                      const avatarValue = assistant.avatar?.trim();
                      const resolvedAvatar = avatarValue ? resolveExtensionAssetUrl(avatarValue) : undefined;
                      const avatarImage = resolvedAvatar || avatarValue;
                      const isImageAvatar = Boolean(avatarImage && (/\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(avatarImage)));
                      return (
                        <Select.Option key={assistant.id} value={assistant.id}>
                          <span className='flex items-center gap-6px'>
                            {isImageAvatar ? <img src={avatarImage} alt='' width={16} height={16} style={{ objectFit: 'contain' }} /> : avatarValue ? <span style={{ fontSize: 14, lineHeight: '16px' }}>{avatarValue}</span> : null}
                            <span>{assistant.nameI18n?.[localeKey] || assistant.name}</span>
                          </span>
                        </Select.Option>
                      );
                    })}
                  </Select>
                </div>
              )}

              {sessionMode !== 'remote' && !(conversationMode === 'reuse' && selectedConversationId) && (
                <div>
                  <div className='text-13px text-secondary mb-4px'>{t('cron.create.workspace', { defaultValue: '工作目录' })}</div>
                  <Button long onClick={handleSelectFolder} className='!justify-start !text-left' disabled={editJob != null && conversationMode === 'reuse'}>
                    {workspace ? <span className='truncate'>{workspace.split('/').pop()}</span> : <span className='text-secondary'>{t('cron.create.selectFolder', { defaultValue: '选择文件夹' })}</span>}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Form>
    </Drawer>
  );
}

interface ICronJobFormDrawerProps {
  visible: boolean;
  editJob?: ICronJob | null;
  sessionMode: 'local' | 'remote';
  onClose: () => void;
  onSaved: () => void;
}
