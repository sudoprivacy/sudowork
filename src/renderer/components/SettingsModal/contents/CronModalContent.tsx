/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ICronJob } from '@/common/ipcBridge';
import type { TChatConversation } from '@/common/storage';
import { DEFAULT_PRESET_AGENT_TYPE, resolvePresetAgentBackend, type AcpBackendAll, type AcpBackendConfig } from '@/types/acpTypes';
import { fetchAssistantsAsConfigs } from '@/renderer/shared/agents/assistantAdapter';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import EmptyState from '@/renderer/components/base/EmptyState';
import { SettingsList, SettingsListItem } from '@/renderer/components/ui/SettingsList';
import { useAllCronJobs } from '@/renderer/pages/cron/hooks/useCronJobs';
import { type FrequencyPreset, FREQUENCY_PRESETS, WEEKDAYS, frequencyToSchedule, getJobStatusFlags, scheduleToFrequency } from '@/renderer/pages/cron/utils/cronUtils';
import { iconColors } from '@/renderer/theme/colors';
import { Button, Drawer, Form, Input, Message, Popconfirm, Select, Switch, Tag } from '@arco-design/web-react';
import { Add, AlarmClock, ArrowLeft, Close, DeleteOne, Edit, Info, PlayOne, Sun } from '@icon-park/react';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSettingsViewMode } from '../settingsViewContext';
import { useAppMode } from '@renderer/hooks/useAppMode';
import { useEnterpriseSessionMode } from '@renderer/hooks/useEnterpriseSessionMode';
import { emitter } from '@renderer/utils/emitter';
import { useAuth } from '@/renderer/context/AuthContext';
import { useConversationTabs } from '@/renderer/pages/conversation/context/ConversationTabsContext';

// Sentinel for "no assistant selected" (default → Sudo Code). Using an explicit
// sentinel instead of '' because Arco Select treats empty string as unset and
// won't reliably fire onChange when switching back to it.
const DEFAULT_ASSISTANT = '__default__';

function throwIfCronError(result: unknown): void {
  const errorEnvelope = result as { __error?: string } | null | undefined;
  if (errorEnvelope && typeof errorEnvelope === 'object' && typeof errorEnvelope.__error === 'string') {
    throw new Error(errorEnvelope.__error);
  }
}

function unwrapCronResult<T>(result: T): T {
  throwIfCronError(result);
  return result;
}

function getCronJobConversationTarget(job: ICronJob): string | undefined {
  const isNewMode = (job.metadata.conversationMode ?? 'new') === 'new';
  if (isNewMode) return job.state.lastConversationId;
  return job.metadata.conversationId || job.state.lastConversationId;
}

// ─── Hook: load preset assistants ───

function useAssistantsForCron(): AcpBackendConfig[] {
  const [assistants, setAssistants] = useState<AcpBackendConfig[]>([]);
  useEffect(() => {
    Promise.all([fetchAssistantsAsConfigs(), ipcBridge.extensions.getAssistants.invoke().catch(() => [] as Record<string, unknown>[])])
      .then(([local, ext]) => {
        const merged: AcpBackendConfig[] = [...local, ...((ext as unknown as AcpBackendConfig[]) || [])];
        setAssistants(merged.filter((a) => a.enabled !== false));
      })
      .catch(() => {});
  }, []);
  return assistants;
}

const TextArea = Input.TextArea;

// ─── Frequency i18n labels ───

function useFrequencyLabels(): Record<FrequencyPreset, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      manual: t('cron.create.frequency.manual'),
      hourly: t('cron.create.frequency.hourly'),
      daily: t('cron.create.frequency.daily'),
      weekdays: t('cron.create.frequency.weekdays'),
      weekly: t('cron.create.frequency.weekly'),
    }),
    [t]
  );
}

function useWeekdayLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      SUN: t('cron.create.weekday.SUN'),
      MON: t('cron.create.weekday.MON'),
      TUE: t('cron.create.weekday.TUE'),
      WED: t('cron.create.weekday.WED'),
      THU: t('cron.create.weekday.THU'),
      FRI: t('cron.create.weekday.FRI'),
      SAT: t('cron.create.weekday.SAT'),
    }),
    [t]
  );
}

// ─── Helper: format relative next run ───

function useFormatNextRunRelative() {
  const { t } = useTranslation();
  return useCallback(
    (nextRunAtMs?: number): string => {
      if (!nextRunAtMs) return '';
      const d = dayjs(nextRunAtMs);
      const now = dayjs();
      const time = d.format('HH:mm');
      if (d.isSame(now, 'day')) return t('cron.create.nextRunToday', { time });
      if (d.isSame(now.add(1, 'day'), 'day')) return t('cron.create.nextRunTomorrow', { time });
      return d.format('MM-DD HH:mm');
    },
    [t]
  );
}

// ─── Time options ───

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: `${String(i).padStart(2, '0')}` }));
const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => ({ value: m, label: String(m).padStart(2, '0') }));

// ═══════════════════════════════════════════════════
// 1. LIST VIEW — Card Grid
// ═══════════════════════════════════════════════════

const CronJobCardGrid: React.FC<{
  jobs: ICronJob[];
  onSelectJob: (job: ICronJob) => void;
}> = ({ jobs, onSelectJob }) => {
  const { t } = useTranslation();
  const formatNextRun = useFormatNextRunRelative();
  return (
    <div className='grid grid-cols-1 md:grid-cols-2 gap-12px'>
      {jobs.map((job) => {
        const { isPaused } = getJobStatusFlags(job);
        return (
          <div key={job.id} className='bg-2 rd-12px px-20px py-16px cursor-pointer hover:bg-3 transition-colors border border-transparent hover:border-border-2' onClick={() => onSelectJob(job)}>
            <div className='text-15px font-medium text-t-primary mb-8px'>{job.name}</div>
            {!isPaused && job.schedule.description && <div className='text-13px text-t-secondary mb-8px'>{job.schedule.description}</div>}
            {!isPaused && job.state.nextRunAtMs && (
              <div className='text-13px text-t-secondary'>
                {t('cron.create.nextRun')} <span className='font-medium text-t-primary'>{formatNextRun(job.state.nextRunAtMs)}</span>
              </div>
            )}
            {isPaused && <div className='text-13px text-t-secondary'>{t('cron.status.paused')}</div>}
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════
// 2. DETAIL VIEW — Single job details
// ═══════════════════════════════════════════════════

const CronJobDetail: React.FC<{
  job: ICronJob;
  onBack: () => void;
  onEdit: (job: ICronJob) => void;
  onDelete: (jobId: string) => void;
  onToggle: (jobId: string, enabled: boolean) => void;
  onTrigger: (jobId: string) => void;
  onNavigate: (conversationId: string) => void;
}> = ({ job, onBack, onEdit, onDelete, onToggle, onTrigger, onNavigate }) => {
  const { t, i18n } = useTranslation();
  const formatNextRun = useFormatNextRunRelative();
  const { hasError, isPaused } = getJobStatusFlags(job);
  const assistants = useAssistantsForCron();
  const localeKey = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
  const selectedAssistant = job.metadata.presetAssistantId ? assistants.find((a) => a.id === job.metadata.presetAssistantId) : undefined;
  const assistantName = selectedAssistant ? selectedAssistant.nameI18n?.[localeKey] || selectedAssistant.name || 'Sudo Code' : job.metadata.presetAssistantId || 'Sudo Code';

  return (
    <div className='space-y-24px'>
      {/* Back nav */}
      <div className='flex items-center gap-4px text-13px text-t-secondary cursor-pointer hover:text-t-primary' onClick={onBack}>
        <ArrowLeft theme='outline' size={14} />
        <span>{t('cron.allScheduledTasks', { defaultValue: '全部定时任务' })}</span>
      </div>

      {/* Header */}
      <div className='flex items-start justify-between gap-16px'>
        <div>
          <h2 className='text-22px font-bold text-t-primary m-0 mb-8px'>{job.name}</h2>
          <div className='flex items-center gap-8px'>
            <Tag color={hasError ? 'red' : isPaused ? 'orangered' : 'green'} size='small'>
              {hasError ? t('cron.status.error') : isPaused ? t('cron.status.paused') : t('cron.status.active')}
            </Tag>
            {!isPaused && job.state.nextRunAtMs && (
              <span className='text-13px text-t-secondary'>
                {t('cron.create.nextRun')} {formatNextRun(job.state.nextRunAtMs)}
              </span>
            )}
          </div>
        </div>
        <div className='flex items-center gap-8px shrink-0'>
          <Button type='text' size='small' icon={<Edit theme='outline' size={16} />} onClick={() => onEdit(job)} />
          <Popconfirm title={t('cron.confirmDelete')} onOk={() => onDelete(job.id)}>
            <Button type='text' size='small' status='danger' icon={<DeleteOne theme='outline' size={16} />} />
          </Popconfirm>
          <Button type='primary' size='small' shape='round' icon={<PlayOne theme='outline' size={14} />} onClick={() => onTrigger(job.id)}>
            {t('cron.actions.runNow', { defaultValue: '立即执行' })}
          </Button>
        </div>
      </div>

      {/* Info sections */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-24px'>
        {/* Description */}
        <div>
          <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.description', { defaultValue: '描述' })}</div>
          <div className='text-14px text-t-primary'>{job.schedule.description || '-'}</div>
        </div>
        {/* Instructions / Prompt */}
        <div>
          <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.prompt', { defaultValue: '指令' })}</div>
          <div className='bg-2 rd-8px px-12px py-8px text-13px text-t-primary break-words whitespace-pre-wrap max-h-120px overflow-y-auto'>{job.target.payload.text}</div>
        </div>
        {/* Execution mode */}
        <div>
          <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.conversationMode', { defaultValue: '执行模式' })}</div>
          <div className='text-14px text-t-primary'>{(job.metadata.conversationMode ?? 'new') === 'new' ? t('cron.create.conversationMode.new', { defaultValue: '每次新建会话' }) : t('cron.create.conversationMode.reuse', { defaultValue: '复用已有会话' })}</div>
        </div>
        {/* Working directory */}
        {job.metadata.workspace && (
          <div>
            <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.workspace', { defaultValue: '工作目录' })}</div>
            <div className='text-14px text-t-primary truncate' title={job.metadata.workspace}>
              {job.metadata.workspace.split('/').pop() || job.metadata.workspace}
            </div>
          </div>
        )}
        {/* Assistant */}
        <div>
          <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.agent', { defaultValue: '数字助手' })}</div>
          <div className='text-14px text-t-primary flex items-center gap-6px'>
            {(() => {
              const avatarValue = selectedAssistant?.avatar?.trim();
              if (!avatarValue) return null;
              const resolvedAvatar = resolveExtensionAssetUrl(avatarValue);
              const avatarImage = resolvedAvatar || avatarValue;
              const isImageAvatar = /\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(avatarImage);
              return isImageAvatar ? <img src={avatarImage} alt='' width={16} height={16} style={{ objectFit: 'contain' }} /> : <span style={{ fontSize: 14, lineHeight: '16px' }}>{avatarValue}</span>;
            })()}
            <span>{assistantName}</span>
          </div>
        </div>
      </div>

      {/* Error info */}
      {hasError && job.state.lastError && (
        <div className='bg-red-1 rd-8px px-12px py-8px text-13px text-red-6'>
          <span className='font-medium'>{t('cron.lastError')}:</span> {job.state.lastError}
        </div>
      )}

      {/* Repeats */}
      <div>
        <div className='text-13px text-t-secondary mb-8px'>{t('cron.create.frequency', { defaultValue: '重复' })}</div>
        <div className='flex items-center gap-12px'>
          <Switch size='small' checked={job.enabled} onChange={(checked) => onToggle(job.id, checked)} />
          <span className='text-14px text-t-primary'>{job.schedule.description}</span>
        </div>
      </div>

      {/* Conversation link */}
      {(() => {
        const isNewMode = (job.metadata.conversationMode ?? 'new') === 'new';
        const targetConvId = getCronJobConversationTarget(job);
        let targetConvTitle: string;
        if (isNewMode) {
          targetConvTitle = t('cron.goToLastConversation', { defaultValue: '查看最近执行会话' });
        } else if (job.metadata.conversationId) {
          targetConvTitle = job.metadata.conversationTitle || t('cron.goToConversationLink', { defaultValue: '查看会话' });
        } else {
          // reuse mode without pre-binding — fall back to lastConversationId
          targetConvTitle = t('cron.goToConversationLink', { defaultValue: '查看会话' });
        }
        if (!targetConvId) return null;
        const convId = targetConvId;
        return (
          <div>
            <div className='text-13px text-t-secondary mb-4px'>{t('cron.goToConversation')}</div>
            <span className='text-14px text-primary cursor-pointer hover:underline' onClick={() => onNavigate(convId)}>
              {targetConvTitle}
            </span>
          </div>
        );
      })()}
    </div>
  );
};

// ═══════════════════════════════════════════════════
// 3. CREATE/EDIT DRAWER
// ═══════════════════════════════════════════════════

const CronJobFormDrawer: React.FC<{
  visible: boolean;
  editJob?: ICronJob | null;
  sessionMode: 'local' | 'remote';
  onClose: () => void;
  onSaved: () => void;
}> = ({ visible, editJob, sessionMode, onClose, onSaved }) => {
  const { t } = useTranslation();
  const frequencyLabels = useFrequencyLabels();
  const weekdayLabels = useWeekdayLabels();
  const { i18n } = useTranslation();
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
      const selectedAssistant = effectiveAssistantId ? assistants.find((a) => a.id === effectiveAssistantId) : undefined;
      const presetAgentType = selectedAssistant?.presetAgentType || DEFAULT_PRESET_AGENT_TYPE;
      const agentType = resolvePresetAgentBackend(presetAgentType) as AcpBackendAll;

      // For reuse mode, allow optionally binding an existing conversation so the
      // very first run appends to it. New mode ignores the picker entirely.
      const reuseConvId = conversationMode === 'reuse' ? selectedConversationId : '';
      const reuseConvTitle = reuseConvId ? conversations.find((c) => c.id === reuseConvId)?.name : undefined;
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

      // The cron bridge wraps provider errors in an envelope so the IPC layer
      // (which has no rejection path) doesn't hang the UI. Unwrap it here.
      throwIfCronError(result);

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
        {/* Name */}
        <Form.Item label={t('cron.drawer.name')} field='name' rules={[{ required: true }]}>
          <Input placeholder='daily-briefing' />
        </Form.Item>

        {/* Description */}
        <Form.Item label={t('cron.create.description', { defaultValue: '描述' })} field='description'>
          <Input placeholder={t('cron.create.descriptionPlaceholder', { defaultValue: '简述任务目的' })} />
        </Form.Item>

        {/* Prompt */}
        <Form.Item label={t('cron.create.prompt', { defaultValue: '指令' })} field='prompt' rules={[{ required: true }]}>
          <TextArea placeholder={t('cron.create.promptPlaceholder', { defaultValue: '输入触发时要发送的指令...' })} autoSize={{ minRows: 4, maxRows: 10 }} />
        </Form.Item>

        {/* Frequency */}
        <div className='mb-16px'>
          <div className='text-14px text-t-primary mb-8px'>{t('cron.create.frequency', { defaultValue: '频率' })}</div>
          <Select value={frequency} onChange={(v) => setFrequency(v as FrequencyPreset)}>
            {FREQUENCY_PRESETS.map((preset) => (
              <Select.Option key={preset} value={preset}>
                {frequencyLabels[preset]}
              </Select.Option>
            ))}
          </Select>

          {/* Time selector */}
          {showTimeSelector && (
            <div className='flex items-center gap-8px mt-8px'>
              <Select value={hour} onChange={(v) => setHour(v)} style={{ width: 80 }}>
                {HOUR_OPTIONS.map((o) => (
                  <Select.Option key={o.value} value={o.value}>
                    {o.label}
                  </Select.Option>
                ))}
              </Select>
              <span className='text-t-secondary'>:</span>
              <Select value={minute} onChange={(v) => setMinute(v)} style={{ width: 80 }}>
                {MINUTE_OPTIONS.map((o) => (
                  <Select.Option key={o.value} value={o.value}>
                    {o.label}
                  </Select.Option>
                ))}
              </Select>
            </div>
          )}

          {/* Weekday selector */}
          {frequency === 'weekly' && (
            <div className='mt-8px'>
              <Select value={weekday} onChange={(v) => setWeekday(v)}>
                {WEEKDAYS.map((day) => (
                  <Select.Option key={day} value={day}>
                    {weekdayLabels[day]}
                  </Select.Option>
                ))}
              </Select>
            </div>
          )}

          <div className='text-12px text-t-secondary mt-4px'>{t('cron.create.frequencyHint', { defaultValue: '定时任务会有几分钟的随机延迟' })}</div>
        </div>

        {/* More options */}
        <div>
          <div className='flex items-center gap-4px text-14px text-t-secondary cursor-pointer hover:text-t-primary mb-12px' onClick={() => setShowMore(!showMore)}>
            <span>{t('cron.create.moreOptions', { defaultValue: '更多选项' })}</span>
            <span className={`transition-transform ${showMore ? 'rotate-180' : ''}`}>▾</span>
          </div>

          {showMore && (
            <div className='grid grid-cols-1 md:grid-cols-2 gap-12px'>
              {/* Execution mode */}
              <div className='col-span-2'>
                <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.conversationMode', { defaultValue: '执行模式' })}</div>
                <Select value={conversationMode} onChange={(v) => setConversationMode(v as 'new' | 'reuse')}>
                  <Select.Option value='new'>{t('cron.create.conversationMode.new', { defaultValue: '每次新建会话（推荐）' })}</Select.Option>
                  <Select.Option value='reuse'>{t('cron.create.conversationMode.reuse', { defaultValue: '复用已有会话（适合持续追加）' })}</Select.Option>
                </Select>
              </div>

              {/* Reuse-mode conversation picker — optional. Empty means "auto-create on first run". */}
              {conversationMode === 'reuse' && (
                <div className='col-span-2'>
                  <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.reuseConversation', { defaultValue: '绑定会话' })}</div>
                  <Select
                    value={selectedConversationId}
                    onChange={(v) => setSelectedConversationId(v as string)}
                    showSearch
                    filterOption={(inputValue, option) => {
                      const optionValue = (option as React.ReactElement<{ value?: string }>)?.props?.value;
                      if (!optionValue) return true; // keep the placeholder visible while searching
                      const conv = conversations.find((c) => c.id === optionValue);
                      const label = conv?.name || optionValue;
                      return label.toLowerCase().includes(inputValue.toLowerCase());
                    }}
                  >
                    <Select.Option value=''>
                      <span className='text-t-secondary'>{t('cron.create.reuseConversationPlaceholder', { defaultValue: '首次运行时自动创建' })}</span>
                    </Select.Option>
                    {conversations.map((c) => (
                      <Select.Option key={c.id} value={c.id}>
                        {c.name || c.id}
                      </Select.Option>
                    ))}
                  </Select>
                  <div className='text-12px text-t-secondary mt-4px'>{t('cron.create.reuseConversationHint', { defaultValue: '选择已有会话，首次运行将直接追加到该会话' })}</div>
                </div>
              )}

              {/* Agent/Assistant selector */}
              {!(sessionMode !== 'remote' && conversationMode === 'reuse' && selectedConversationId) && (
                <div>
                  <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.agent', { defaultValue: '数字助手' })}</div>
                  <Select value={selectedAssistantId} onChange={(v) => setSelectedAssistantId(v as string)} disabled={sessionMode !== 'remote' && editJob != null && conversationMode === 'reuse'}>
                    <Select.Option value={DEFAULT_ASSISTANT}>
                      <span className='text-t-secondary'>{t('cron.create.agentPlaceholder', { defaultValue: '默认 (Sudo Code)' })}</span>
                    </Select.Option>
                    {selectedAssistantId !== DEFAULT_ASSISTANT && !assistants.some((a) => a.id === selectedAssistantId) && (
                      <Select.Option value={selectedAssistantId}>
                        <span>{selectedAssistantId}</span>
                      </Select.Option>
                    )}
                    {assistants.map((a) => {
                      const avatarValue = a.avatar?.trim();
                      const resolvedAvatar = avatarValue ? resolveExtensionAssetUrl(avatarValue) : undefined;
                      const avatarImage = resolvedAvatar || avatarValue;
                      const isImageAvatar = Boolean(avatarImage && (/\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(avatarImage)));
                      return (
                        <Select.Option key={a.id} value={a.id}>
                          <span className='flex items-center gap-6px'>
                            {isImageAvatar ? <img src={avatarImage} alt='' width={16} height={16} style={{ objectFit: 'contain' }} /> : avatarValue ? <span style={{ fontSize: 14, lineHeight: '16px' }}>{avatarValue}</span> : null}
                            <span>{a.nameI18n?.[localeKey] || a.name}</span>
                          </span>
                        </Select.Option>
                      );
                    })}
                  </Select>
                </div>
              )}

              {/* Workspace selector — local mode only */}
              {sessionMode !== 'remote' && !(conversationMode === 'reuse' && selectedConversationId) && (
                <div>
                  <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.workspace', { defaultValue: '工作目录' })}</div>
                  <Button long onClick={handleSelectFolder} className='!justify-start !text-left' disabled={editJob != null && conversationMode === 'reuse'}>
                    {workspace ? <span className='truncate'>{workspace.split('/').pop()}</span> : <span className='text-t-secondary'>{t('cron.create.selectFolder', { defaultValue: '选择文件夹' })}</span>}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Form>
    </Drawer>
  );
};

// ═══════════════════════════════════════════════════
// MAIN COMPONENT — 3-level view
// ═══════════════════════════════════════════════════

const CronModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const navigate = useNavigate();
  const { isEnterprise } = useAppMode();
  const { user } = useAuth();
  const { openTab } = useConversationTabs();
  const canUseLocalCronMode = !isEnterprise || user?.localModeAvailable === true;
  const { sessionMode, setSessionMode } = useEnterpriseSessionMode({
    localModeAvailable: canUseLocalCronMode,
    remoteModeAvailable: isEnterprise,
  });
  const { jobs, loading, error, pauseJob, resumeJob, deleteJob, refetch } = useAllCronJobs();

  // Keep-awake toggle state (only for local mode)
  const [keepAwake, setKeepAwake] = useState(false);
  useEffect(() => {
    if (sessionMode === 'remote') return; // Remote mode doesn't support power save
    ipcBridge.cron.getPowerSaveActive
      .invoke()
      .then((active) => {
        setKeepAwake(active);
      })
      .catch(() => {});
  }, [sessionMode]);

  const handleKeepAwakeChange = async (checked: boolean) => {
    setKeepAwake(checked);
    try {
      await ipcBridge.cron.setPowerSave.invoke({ enabled: checked });
    } catch {
      // revert on failure
      setKeepAwake(!checked);
    }
  };

  // View state
  const [selectedJob, setSelectedJob] = useState<ICronJob | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [editingJob, setEditingJob] = useState<ICronJob | null>(null);

  // Refresh selected job when jobs list updates
  const currentJob = useMemo(() => {
    if (!selectedJob) return null;
    return jobs.find((j) => j.id === selectedJob.id) || null;
  }, [jobs, selectedJob]);

  const handleToggle = async (jobId: string, enabled: boolean) => {
    try {
      if (enabled) {
        await resumeJob(jobId);
        Message.success(t('cron.resumeSuccess'));
      } else {
        await pauseJob(jobId);
        Message.success(t('cron.pauseSuccess'));
      }
    } catch (err) {
      Message.error(String(err));
    }
  };

  const handleDelete = async (jobId: string) => {
    try {
      await deleteJob(jobId);
      Message.success(t('cron.deleteSuccess'));
      setSelectedJob(null);
    } catch (err) {
      Message.error(String(err));
    }
  };

  const handleNavigate = (conversationId: string) => {
    void navigate(`/conversation/${conversationId}`);
  };

  const handleTrigger = async (jobId: string) => {
    try {
      unwrapCronResult(await ipcBridge.cron.triggerJob.invoke({ jobId }));
      const updatedJob = unwrapCronResult(await ipcBridge.cron.getJob.invoke({ jobId }));
      Message.success(t('cron.runNowSuccess'));
      emitter.emit('chat.history.refresh');
      const targetConversationId = updatedJob ? getCronJobConversationTarget(updatedJob) : undefined;
      if (targetConversationId) {
        void navigate(`/conversation/${targetConversationId}`);
        emitter.emit('conversation.remote.sync', targetConversationId);
        window.setTimeout(() => emitter.emit('conversation.remote.sync', targetConversationId), 1000);
        window.setTimeout(() => emitter.emit('conversation.remote.sync', targetConversationId), 3000);
      }
      void refetch();
    } catch (err) {
      Message.error(String(err));
    }
  };

  const handleEdit = (job: ICronJob) => {
    setEditingJob(job);
    setDrawerVisible(true);
  };

  const handleBackToList = useCallback(() => {
    setSelectedJob(null);
  }, []);

  const handleCreate = () => {
    setEditingJob(null);
    setDrawerVisible(true);
  };

  const handleSelectJob = useCallback(
    async (job: ICronJob) => {
      setSelectedJob(job);
      const targetConversationId = getCronJobConversationTarget(job);
      if (targetConversationId) {
        try {
          const result = (await ipcBridge.conversation.get.invoke({ id: targetConversationId })) as TChatConversation | null;
          if (result) {
            openTab(result);
          }
        } catch (error) {
          console.warn('Failed to open cron target conversation:', error);
        }
        emitter.emit('conversation.remote.sync', targetConversationId);
      }
    },
    [openTab]
  );

  return (
    <div className='flex flex-col h-full w-full'>
      <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        {/* ── DETAIL VIEW ── */}
        {currentJob ? (
          <CronJobDetail job={currentJob} onBack={handleBackToList} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} onTrigger={handleTrigger} onNavigate={handleNavigate} />
        ) : (
          /* ── LIST VIEW ── */
          <div className='space-y-16px'>
            {/* Header */}
            <div className='flex items-center justify-between gap-16px'>
              <div className='min-w-0'>
                <h2 className='text-20px font-bold text-t-primary m-0 mb-4px'>{t('cron.scheduledTasks')}</h2>
                <div className='text-13px text-t-secondary'>{t('cron.create.listSubtitle', { defaultValue: '设定定时任务，让 Agent 按计划自动执行' })}</div>
              </div>
              {jobs.length > 0 && (
                <Button type='primary' shape='round' className='cron-create-chip' onClick={handleCreate}>
                  <span className='inline-flex items-center justify-center gap-4px'>
                    <Add theme='outline' size={14} className='block' />
                    <span>{t('cron.create.button', { defaultValue: '新建任务' })}</span>
                  </span>
                </Button>
              )}
            </div>

            {/* Enterprise mode: Remote/Local switcher */}
            {isEnterprise && (
              <div className='bg-2 rd-12px px-16px py-12px flex items-center justify-between'>
                <div className='flex items-center gap-8px text-13px text-t-secondary'>
                  <Info theme='outline' size={16} fill={iconColors.secondary} />
                  <span>{t('cron.mode.select', { defaultValue: '数据存储位置' })}</span>
                </div>
                <div className='flex items-center gap-4px'>
                  {canUseLocalCronMode && (
                    <Button size='small' shape='round' type={sessionMode === 'local' ? 'primary' : 'text'} onClick={() => setSessionMode('local')}>
                      {t('cron.mode.local', { defaultValue: '本地' })}
                    </Button>
                  )}
                  <Button size='small' shape='round' type={sessionMode === 'remote' ? 'primary' : 'text'} onClick={() => setSessionMode('remote')}>
                    {t('cron.mode.remote', { defaultValue: '云端' })}
                  </Button>
                </div>
              </div>
            )}

            {/* Error state (remote mode: Moss API unavailable) */}
            {error && sessionMode === 'remote' && (
              <div className='bg-red-1 rd-12px px-16px py-12px flex items-center justify-between'>
                <div className='flex items-center gap-8px text-13px text-red-6'>
                  <Info theme='outline' size={16} />
                  <span>{t('cron.error.serverUnavailable', { defaultValue: '无法连接服务器' })}</span>
                </div>
                <Button size='small' shape='round' onClick={() => void refetch()}>
                  {t('common.retry', { defaultValue: '重试' })}
                </Button>
              </div>
            )}

            {/* Info banner (local mode only) */}
            {sessionMode === 'local' && (
              <SettingsList>
                <SettingsListItem icon={<Sun theme='outline' size={20} />} title={t('cron.create.keepAwake', { defaultValue: '保持唤醒' })} description={t('cron.create.awakeBanner', { defaultValue: '定时任务仅在电脑唤醒时运行' })} status={<span className='text-13px text-t-secondary'>{keepAwake ? t('common.enabled', { defaultValue: '已启用' }) : t('common.disabled', { defaultValue: '已关闭' })}</span>} action={<Switch size='small' className='cron-keep-awake-switch' checked={keepAwake} onChange={handleKeepAwakeChange} />} />
              </SettingsList>
            )}

            {/* Job cards or empty state */}
            {!loading && jobs.length === 0 ? <EmptyState simple icon={<AlarmClock theme='outline' size={56} className='text-[var(--ui-accent-orange)]' />} title={t('cron.noTasks', { defaultValue: '暂无定时任务' })} description={t('cron.create.emptyHint', { defaultValue: '创建自动执行的 Agent 任务' })} actions={[{ label: t('cron.create.button', { defaultValue: '新建任务' }), onClick: handleCreate, className: 'cron-create-chip' }]} /> : <CronJobCardGrid jobs={jobs} onSelectJob={handleSelectJob} />}
          </div>
        )}
      </AionScrollArea>

      <CronJobFormDrawer visible={drawerVisible} editJob={editingJob} sessionMode={sessionMode} onClose={() => setDrawerVisible(false)} onSaved={() => void refetch()} />
    </div>
  );
};

export default CronModalContent;
