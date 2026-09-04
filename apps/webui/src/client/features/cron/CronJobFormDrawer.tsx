/**
 * 任务表单抽屉（布局对齐 Sudowork CronJobFormDrawer）：名称/描述/指令/频率块/更多选项。
 * 频率选择器把语义化选项组装成基线 schedule {kind, value}（无 expr）。
 */
import React, { useState } from 'react'
import { Button, Drawer, Form, Input, Message, Select } from '@arco-design/web-react'
import { ChevronDown } from 'lucide-react'
import useSWR from 'swr'
import { ApiError } from '@client/features/auth/authApi'
import {
  getConversationOptions,
  listConversations,
} from '@client/features/conversations/conversationApi'
import { cronApi, type CronJob } from './cronApi'

type FreqKey = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'cron'

const WEEK_OPTIONS = [
  { label: '周日', value: 0 },
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
]

export function CronJobFormDrawer({
  visible,
  onClose,
  onCreated,
  onCronDisabled,
  editJob,
}: {
  visible: boolean
  onClose: () => void
  onCreated: () => void
  onCronDisabled: () => void
  editJob?: CronJob
}): React.ReactElement {
  const editing = Boolean(editJob)
  const [name, setName] = useState(editJob?.name ?? '')
  const [description, setDescription] = useState(
    (editJob as { description?: string } | undefined)?.description ?? '',
  )
  const [prompt, setPrompt] = useState(editJob?.payloadMessage ?? '')
  // 编辑时保真 roundtrip：原 kind/value 直接以 cron 表达式形态展示
  const [freq, setFreq] = useState<FreqKey>(
    editJob?.schedule ? (editJob.schedule.kind === 'every' ? 'hourly' : 'cron') : 'daily',
  )
  const [hour, setHour] = useState('9')
  const [minute, setMinute] = useState('0')
  const [weekDay, setWeekDay] = useState(1)
  const [cronExpr, setCronExpr] = useState(
    editJob?.schedule ? (editJob.schedule.kind === 'every' ? '0 9 * * *' : editJob.schedule.value) : '0 9 * * *',
  )
  const [moreOpen, setMoreOpen] = useState(false)
  const [conversationMode, setConversationMode] = useState<'new' | 'reuse'>(
    editJob?.conversationMode === 'reuse' ? 'reuse' : 'new',
  )
  const [boundSessionId, setBoundSessionId] = useState<string | undefined>(
    editJob?.boundSessionId ?? undefined,
  )
  const [assistantName, setAssistantName] = useState<string | undefined>(
    editJob?.assistantName ?? undefined,
  )
  const [creating, setCreating] = useState(false)

  const { data: options } = useSWR(visible ? 'conversation-options' : null, getConversationOptions)
  const { data: conversations } = useSWR(
    visible && conversationMode === 'reuse' ? 'conversations' : null,
    listConversations,
  )

  function buildSchedule(): { kind: 'at' | 'every' | 'cron'; value: string } {
    const h = String(Number(hour))
    const m = String(Number(minute))
    if (freq === 'hourly') return { kind: 'every', value: '60m' }
    if (freq === 'daily') return { kind: 'cron', value: `${m} ${h} * * *` }
    if (freq === 'weekdays') return { kind: 'cron', value: `${m} ${h} * * 1-5` }
    if (freq === 'weekly') return { kind: 'cron', value: `${m} ${h} * * ${weekDay}` }
    return { kind: 'cron', value: cronExpr.trim() }
  }

  async function handleCreate(): Promise<void> {
    if (!name.trim() || !prompt.trim()) {
      Message.warning('请填写名称与指令')
      return
    }
    if (conversationMode === 'reuse' && !boundSessionId) {
      Message.warning('复用会话模式需选择绑定会话')
      return
    }
    setCreating(true)
    try {
      const body = {
        name: name.trim(),
        schedule: buildSchedule(),
        payloadMessage: prompt.trim(),
        conversationMode,
        boundSessionId: conversationMode === 'reuse' ? boundSessionId : undefined,
        assistantName: assistantName ?? undefined,
      }
      if (editing && editJob) {
        await cronApi.update(editJob.id, body)
        Message.success('已保存')
      } else {
        await cronApi.create(body)
        Message.success('创建成功')
      }
      setName('')
      setPrompt('')
      setDescription('')
      onCreated()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CRON_DISABLED_BY_ORG') {
        Message.warning('当前组织已停用客户端定时任务')
        onCronDisabled()
        onClose()
      } else {
        Message.error(`创建失败：${(err as Error).message}`)
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <Drawer
      title={editing ? '编辑定时任务' : '创建定时任务'}
      placement='right'
      width={520}
      visible={visible}
      closable
      onCancel={onClose}
      footer={
        <div className='flex justify-end gap-2'>
          <Button onClick={onClose}>取消</Button>
          <Button type='primary' loading={creating} onClick={() => void handleCreate()}>
            保存
          </Button>
        </div>
      }
      data-testid='cron-form-drawer'
    >
      <Form layout='vertical'>
        <Form.Item label='名称' required>
          <Input value={name} onChange={setName} placeholder='daily-briefing' />
        </Form.Item>
        <Form.Item label='描述'>
          <Input value={description} onChange={setDescription} placeholder='简述任务目的' />
        </Form.Item>
        <Form.Item label='指令' required>
          <Input.TextArea
            value={prompt}
            onChange={setPrompt}
            autoSize={{ minRows: 4, maxRows: 10 }}
            placeholder='输入触发时要发送的指令...'
          />
        </Form.Item>

        {/* 频率块 */}
        <div className='mb-4'>
          <div className='text-14px text-foreground mb-2'>频率</div>
          <Select value={freq} onChange={(v) => setFreq(v as FreqKey)}>
            <Select.Option value='hourly'>每小时</Select.Option>
            <Select.Option value='daily'>每天</Select.Option>
            <Select.Option value='weekdays'>工作日</Select.Option>
            <Select.Option value='weekly'>每周</Select.Option>
            <Select.Option value='cron'>Cron 表达式</Select.Option>
          </Select>
          {freq === 'daily' || freq === 'weekdays' ? (
            <div className='flex items-center gap-2 mt-2'>
              <Select value={hour} onChange={setHour} style={{ width: 80 }}>
                {Array.from({ length: 24 }, (_, i) => String(i)).map((h) => (
                  <Select.Option key={h} value={h}>
                    {h} 时
                  </Select.Option>
                ))}
              </Select>
              <span className='text-secondary'>:</span>
              <Select value={minute} onChange={setMinute} style={{ width: 80 }}>
                {Array.from({ length: 12 }, (_, i) => String(i * 5)).map((mm) => (
                  <Select.Option key={mm} value={mm}>
                    {mm} 分
                  </Select.Option>
                ))}
              </Select>
            </div>
          ) : null}
          {freq === 'weekly' ? (
            <div className='mt-2'>
              <Select value={weekDay} onChange={setWeekDay}>
                {WEEK_OPTIONS.map((w) => (
                  <Select.Option key={w.value} value={w.value}>
                    {w.label}
                  </Select.Option>
                ))}
              </Select>
            </div>
          ) : null}
          {freq === 'cron' ? (
            <div className='mt-2'>
              <Input value={cronExpr} onChange={setCronExpr} placeholder='0 9 * * *' />
            </div>
          ) : null}
          <div className='text-12px text-secondary mt-1'>定时任务会有几分钟的随机延迟</div>
        </div>

        {/* 更多选项 */}
        <div
          className='flex items-center gap-1 text-14px text-secondary cursor-pointer hover:text-foreground mb-3'
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span>更多选项</span>
          <ChevronDown size={16} className={moreOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </div>
        {moreOpen ? (
          <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
            <div className='col-span-2'>
              <div className='text-14px text-foreground mb-2'>执行模式</div>
              <Select
                value={conversationMode}
                onChange={(v) => setConversationMode(v as 'new' | 'reuse')}
              >
                <Select.Option value='new'>每次新建会话（推荐）</Select.Option>
                <Select.Option value='reuse'>复用已有会话（适合持续追加）</Select.Option>
              </Select>
            </div>
            {conversationMode === 'reuse' ? (
              <div className='col-span-2'>
                <div className='text-14px text-foreground mb-2'>绑定会话</div>
                <Select
                  showSearch
                  value={boundSessionId}
                  onChange={setBoundSessionId}
                  placeholder='选择本人会话'
                  data-testid='bound-session-select'
                >
                  {(conversations?.conversations ?? []).map((c) => (
                    <Select.Option key={c.id} value={c.id}>
                      {c.assistantName ?? '会话'} · {c.id.slice(0, 8)}
                    </Select.Option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className='col-span-2'>
              <div className='text-14px text-foreground mb-2'>智能体</div>
              <Select
                value={assistantName}
                onChange={setAssistantName}
                placeholder='默认'
                allowClear
              >
                {(options?.agents ?? []).map((a) => (
                  <Select.Option key={a.name} value={a.name}>
                    {a.name}
                  </Select.Option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
      </Form>
    </Drawer>
  )
}
