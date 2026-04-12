/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ICronJob } from '@/common/ipcBridge';
import type { AcpBackendAll, AcpBackendConfig } from '@/types/acpTypes';
import { fetchAssistantsAsConfigs } from '@/renderer/shared/agents/assistantAdapter';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useAllCronJobs } from '@/renderer/pages/cron/hooks/useCronJobs';
import { type FrequencyPreset, FREQUENCY_PRESETS, WEEKDAYS, frequencyToSchedule, getJobStatusFlags, scheduleToFrequency } from '@/renderer/pages/cron/utils/cronUtils';
import { iconColors } from '@/renderer/theme/colors';
import { Button, Drawer, Empty, Form, Input, Message, Popconfirm, Select, Switch, Tag } from '@arco-design/web-react';
import { Add, ArrowLeft, Close, DeleteOne, Edit, Info, PlayOne, Sun } from '@icon-park/react';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSettingsViewMode } from '../settingsViewContext';

// Sentinel for "no assistant selected" (default → Sudoclaw). Using an explicit
// sentinel instead of '' because Arco Select treats empty string as unset and
// won't reliably fire onChange when switching back to it.
const DEFAULT_ASSISTANT = '__default__';

// ─── Hook: load preset assistants ───

function useAssistantsForCron(): AcpBackendConfig[] {
  const [assistants, setAssistants] = useState<AcpBackendConfig[]>([]);
  useEffect(() => {
    Promise.all([fetchAssistantsAsConfigs(), ipcBridge.extensions.getAssistants.invoke().catch(() => [] as Record<string, unknown>[])])
      .then(([local, ext]) => {
        const merged: AcpBackendConfig[] = [...local, ...((ext as unknown as AcpBackendConfig[]) || [])];
        setAssistants(merged.filter((a) => a.isPreset === true));
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
  const assistantName = selectedAssistant ? selectedAssistant.nameI18n?.[localeKey] || selectedAssistant.name || 'Sudoclaw' : 'Sudoclaw';

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
            {selectedAssistant?.avatar && <span>{selectedAssistant.avatar}</span>}
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
        const targetConvId = isNewMode ? job.state.lastConversationId : job.metadata.conversationId;
        const targetConvTitle = isNewMode ? t('cron.goToLastConversation', { defaultValue: '查看最近执行会话' }) : job.metadata.conversationTitle;
        if (!targetConvId) return null;
        return (
          <div>
            <div className='text-13px text-t-secondary mb-4px'>{t('cron.goToConversation')}</div>
            <span className='text-14px text-primary cursor-pointer hover:underline' onClick={() => onNavigate(targetConvId)}>
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
  onClose: () => void;
  onSaved: () => void;
}> = ({ visible, editJob, onClose, onSaved }) => {
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
      }
    }
  }, [visible, editJob, form]);

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

      // Derive agentType from selected assistant's presetAgentType; default to openclaw-gateway (Sudoclaw)
      const isDefaultAssistant = selectedAssistantId === DEFAULT_ASSISTANT;
      const effectiveAssistantId = isDefaultAssistant ? undefined : selectedAssistantId;
      const selectedAssistant = effectiveAssistantId ? assistants.find((a) => a.id === effectiveAssistantId) : undefined;
      const presetAgentType = selectedAssistant?.presetAgentType || 'sudoclaw';
      const agentType = (presetAgentType === 'sudoclaw' ? 'openclaw-gateway' : presetAgentType) as AcpBackendAll;

      if (editJob) {
        // Update existing job. JSON IPC strips `undefined`, so we pass an explicit
        // `null` sentinel when clearing the assistant back to Default — the backend
        // normalizes `null` → cleared field.
        await ipcBridge.cron.updateJob.invoke({
          jobId: editJob.id,
          updates: {
            name: values.name,
            enabled: isManual ? false : editJob.enabled,
            schedule: schedule || editJob.schedule,
            target: { payload: { kind: 'message', text: values.prompt } },
            metadata: {
              ...editJob.metadata,
              agentType,
              conversationMode,
              workspace: workspace || undefined,
              presetAssistantId: isDefaultAssistant ? null : effectiveAssistantId,
            },
          },
        });
      } else {
        await ipcBridge.cron.addJob.invoke({
          name: values.name,
          schedule: schedule || { kind: 'cron', expr: '0 9 * * *', description: values.description || values.name },
          message: values.prompt,
          conversationId: '',
          agentType,
          createdBy: 'user',
          conversationMode,
          workspace: workspace || undefined,
          presetAssistantId: effectiveAssistantId,
        });
      }

      Message.success(t('cron.drawer.saveSuccess'));
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof Error) {
        Message.error(err.message);
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
        <Form.Item label={t('cron.create.description', { defaultValue: '描述' })} field='description' rules={[{ required: true }]}>
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
              {/* Agent/Assistant selector */}
              <div>
                <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.agent', { defaultValue: '数字助手' })}</div>
                <Select value={selectedAssistantId} onChange={(v) => setSelectedAssistantId(v as string)}>
                  <Select.Option value={DEFAULT_ASSISTANT}>
                    <span className='text-t-secondary'>{t('cron.create.agentPlaceholder', { defaultValue: '默认 (Sudoclaw)' })}</span>
                  </Select.Option>
                  {assistants.map((a) => (
                    <Select.Option key={a.id} value={a.id}>
                      <span className='flex items-center gap-6px'>
                        {a.avatar && <span>{a.avatar}</span>}
                        <span>{a.nameI18n?.[localeKey] || a.name}</span>
                      </span>
                    </Select.Option>
                  ))}
                </Select>
              </div>

              {/* Workspace selector */}
              <div>
                <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.workspace', { defaultValue: '工作目录' })}</div>
                <Button long onClick={handleSelectFolder} className='!justify-start !text-left'>
                  {workspace ? <span className='truncate'>{workspace.split('/').pop()}</span> : <span className='text-t-secondary'>{t('cron.create.selectFolder', { defaultValue: '选择文件夹' })}</span>}
                </Button>
              </div>

              {/* Execution mode */}
              <div className='col-span-2'>
                <div className='text-13px text-t-secondary mb-4px'>{t('cron.create.conversationMode', { defaultValue: '执行模式' })}</div>
                <Select value={conversationMode} onChange={(v) => setConversationMode(v as 'new' | 'reuse')}>
                  <Select.Option value='new'>{t('cron.create.conversationMode.new', { defaultValue: '每次新建会话（推荐）' })}</Select.Option>
                  <Select.Option value='reuse'>{t('cron.create.conversationMode.reuse', { defaultValue: '复用已有会话（适合持续追加）' })}</Select.Option>
                </Select>
              </div>
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
  const { jobs, loading, pauseJob, resumeJob, deleteJob, refetch } = useAllCronJobs();

  // Keep-awake toggle state
  const [keepAwake, setKeepAwake] = useState(false);
  useEffect(() => {
    ipcBridge.cron.getPowerSaveActive
      .invoke()
      .then((active) => {
        setKeepAwake(active);
      })
      .catch(() => {});
  }, []);

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
      await ipcBridge.cron.triggerJob.invoke({ jobId });
      Message.success(t('cron.runNowSuccess'));
      void refetch();
    } catch (err) {
      Message.error(String(err));
    }
  };

  const handleEdit = (job: ICronJob) => {
    setEditingJob(job);
    setDrawerVisible(true);
  };

  const handleCreate = () => {
    setEditingJob(null);
    setDrawerVisible(true);
  };

  return (
    <div className='flex flex-col h-full w-full'>
      <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        {/* ── DETAIL VIEW ── */}
        {currentJob ? (
          <CronJobDetail job={currentJob} onBack={() => setSelectedJob(null)} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} onTrigger={handleTrigger} onNavigate={handleNavigate} />
        ) : (
          /* ── LIST VIEW ── */
          <div className='space-y-16px'>
            {/* Header */}
            <div className='flex items-start justify-between'>
              <div>
                <h2 className='text-20px font-bold text-t-primary m-0 mb-4px'>{t('cron.scheduledTasks')}</h2>
                <div className='text-13px text-t-secondary'>{t('cron.create.listSubtitle', { defaultValue: '设定定时任务，让 Agent 按计划自动执行' })}</div>
              </div>
              <Button type='primary' shape='round' icon={<Add theme='outline' size={14} />} onClick={handleCreate}>
                {t('cron.create.button', { defaultValue: '新建任务' })}
              </Button>
            </div>

            {/* Info banner */}
            <div className='bg-2 rd-12px px-16px py-12px flex items-center justify-between'>
              <div className='flex items-center gap-8px text-13px text-t-secondary'>
                <Info theme='outline' size={16} fill={iconColors.secondary} />
                <span>{t('cron.create.awakeBanner', { defaultValue: '定时任务仅在电脑唤醒时运行' })}</span>
              </div>
              <div className='flex items-center gap-8px text-13px text-t-secondary'>
                <Sun theme='outline' size={16} />
                <span>{t('cron.create.keepAwake', { defaultValue: '保持唤醒' })}</span>
                <Switch size='small' checked={keepAwake} onChange={handleKeepAwakeChange} />
              </div>
            </div>

            {/* Job cards or empty state */}
            {!loading && jobs.length === 0 ? (
              <div className='bg-2 rd-12px px-16px py-40px flex flex-col items-center gap-16px'>
                <Empty description={t('cron.noTasks', { defaultValue: '暂无定时任务' })} />
                <Button type='primary' shape='round' icon={<Add theme='outline' size={14} />} onClick={handleCreate}>
                  {t('cron.create.button', { defaultValue: '新建任务' })}
                </Button>
              </div>
            ) : (
              <CronJobCardGrid jobs={jobs} onSelectJob={setSelectedJob} />
            )}
          </div>
        )}
      </AionScrollArea>

      <CronJobFormDrawer visible={drawerVisible} editJob={editingJob} onClose={() => setDrawerVisible(false)} onSaved={() => void refetch()} />
    </div>
  );
};

export default CronModalContent;
