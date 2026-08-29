import React, { useState } from 'react'
import { Button, Drawer, Form, Input, Message, Radio, Select } from '@arco-design/web-react'
import useSWR from 'swr'
import { ApiError } from '@client/features/auth/authApi'
import { getConversationOptions } from '@client/features/conversations/conversationApi'
import { listConversations } from '@client/features/conversations/conversationApi'
import { cronApi } from './cronApi'

/**
 * 任务表单（计划 Task 7）：schedule 统一 value 字段（at/every/cron），
 * new/reuse 两种模式；reuse 需选择本人会话（服务端校验归属）。
 */
export function CronJobFormDrawer({
  visible,
  onClose,
  onCreated,
  onCronDisabled,
}: {
  visible: boolean
  onClose: () => void
  onCreated: () => void
  onCronDisabled: () => void
}): React.ReactElement {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'at' | 'every' | 'cron'>('cron')
  const [value, setValue] = useState('')
  const [payloadMessage, setPayloadMessage] = useState('')
  const [conversationMode, setConversationMode] = useState<'new' | 'reuse'>('new')
  const [boundSessionId, setBoundSessionId] = useState<string | undefined>(undefined)
  const [assistantName, setAssistantName] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)

  const { data: options } = useSWR(visible ? 'conversation-options' : null, getConversationOptions)
  const { data: conversations } = useSWR(
    visible && conversationMode === 'reuse' ? 'conversations' : null,
    listConversations,
  )

  async function handleCreate(): Promise<void> {
    if (!name.trim() || !value.trim()) {
      Message.warning('请填写名称与调度值')
      return
    }
    if (conversationMode === 'reuse' && !boundSessionId) {
      Message.warning('复用会话模式需选择绑定会话')
      return
    }
    setCreating(true)
    try {
      await cronApi.create({
        name: name.trim(),
        schedule: { kind, value: value.trim() },
        payloadMessage: payloadMessage.trim() || undefined,
        conversationMode,
        boundSessionId: conversationMode === 'reuse' ? boundSessionId : undefined,
        assistantName: assistantName ?? undefined,
      })
      Message.success('创建成功')
      setName('')
      setValue('')
      setPayloadMessage('')
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
      title='新建定时任务'
      width={440}
      visible={visible}
      onCancel={onClose}
      footer={
        <div className='flex justify-end gap-2'>
          <Button size='small' onClick={onClose}>取消</Button>
          <Button size='small' type='primary' loading={creating} onClick={() => void handleCreate()}>
            创建
          </Button>
        </div>
      }
      data-testid='cron-form-drawer'
    >
      <Form layout='vertical' size='small'>
        <Form.Item label='任务名称' required>
          <Input value={name} onChange={setName} placeholder='如 每日日报' />
        </Form.Item>
        <Form.Item label='调度类型' required>
          <Radio.Group
            type='button'
            value={kind}
            onChange={(v) => setKind(v as 'at' | 'every' | 'cron')}
          >
            <Radio value='cron'>Cron 表达式</Radio>
            <Radio value='every'>固定间隔</Radio>
            <Radio value='at'>指定时间</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          label={kind === 'cron' ? 'Cron 表达式（value）' : kind === 'every' ? '间隔（value）' : '时间（value）'}
          required
        >
          <Input value={value} onChange={setValue} placeholder={kind === 'cron' ? '0 9 * * *' : '如 30m / 2026-09-01T09:00:00'} />
        </Form.Item>
        <Form.Item label='执行消息'>
          <Input.TextArea value={payloadMessage} onChange={setPayloadMessage} rows={3} />
        </Form.Item>
        <Form.Item label='会话模式' required>
          <Radio.Group
            type='button'
            value={conversationMode}
            onChange={(v) => setConversationMode(v as 'new' | 'reuse')}
          >
            <Radio value='new'>新会话</Radio>
            <Radio value='reuse'>复用会话</Radio>
          </Radio.Group>
        </Form.Item>
        {conversationMode === 'reuse' ? (
          <Form.Item label='绑定会话' required>
            <Select
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
          </Form.Item>
        ) : null}
        <Form.Item label='智能体'>
          <Select
            value={assistantName}
            onChange={setAssistantName}
            placeholder='选择智能体（可选）'
            allowClear
          >
            {(options?.agents ?? []).map((a) => (
              <Select.Option key={a.name} value={a.name}>
                {a.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      </Form>
    </Drawer>
  )
}
