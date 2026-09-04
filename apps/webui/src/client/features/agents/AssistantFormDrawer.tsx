import React, { useState } from 'react'
import { Button, Drawer, Form, Input, Message } from '@arco-design/web-react'
import { agentApi } from './agentApi'

/** 表单创建（POST /api/v1/agents/create，admin:settings，服务端强制）。 */
export function AssistantFormDrawer({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean
  onClose: () => void
  onCreated: () => void
}): React.ReactElement {
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleCreate(): Promise<void> {
    if (!name.trim() || !displayName.trim()) {
      Message.warning('请填写名称与显示名')
      return
    }
    setCreating(true)
    try {
      await agentApi.create({
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        prompt: prompt.trim() || undefined,
      })
      Message.success('创建成功')
      setName('')
      setDisplayName('')
      setDescription('')
      setPrompt('')
      onCreated()
    } catch (err) {
      Message.error(`创建失败：${(err as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Drawer
      title='创建智能体'
      width={420}
      visible={visible}
      footer={
        <div className='flex justify-end gap-2'>
          <Button size='small' onClick={onClose}>
            取消
          </Button>
          <Button size='small' type='primary' loading={creating} onClick={() => void handleCreate()}>
            创建
          </Button>
        </div>
      }
      onCancel={onClose}
      data-testid='assistant-form-drawer'
    >
      <Form layout='vertical' size='small'>
        <Form.Item label='标识名（name）' required>
          <Input value={name} onChange={setName} placeholder='如 data-analyst' />
        </Form.Item>
        <Form.Item label='显示名' required>
          <Input value={displayName} onChange={setDisplayName} placeholder='如 数据分析助手' />
        </Form.Item>
        <Form.Item label='描述'>
          <Input.TextArea value={description} onChange={setDescription} rows={2} />
        </Form.Item>
        <Form.Item label='系统提示词'>
          <Input.TextArea value={prompt} onChange={setPrompt} rows={6} />
        </Form.Item>
      </Form>
    </Drawer>
  )
}
