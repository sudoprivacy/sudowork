import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { Button, Message } from '@arco-design/web-react'
import { createConversation, getConversationOptions } from './conversationApi'

/**
 * 新会话页（计划 3.10）：Agent / Skill / 模型选择（不含 Local 模式与本地 cwd）。
 * Agent/Skill 列表来自 Moss 当前可见集合；提交前后端会再次核验。
 */
export function NewConversationPage(): React.ReactElement {
  const navigate = useNavigate()
  const { data: options } = useSWR('conversation-options', getConversationOptions)
  const [assistantName, setAssistantName] = useState('')
  const [enabledSkills, setEnabledSkills] = useState<string[]>([])
  const [creating, setCreating] = useState(false)

  async function handleCreate(): Promise<void> {
    if (!assistantName) {
      Message.warning('请选择智能体')
      return
    }
    setCreating(true)
    try {
      const created = await createConversation({ assistantName, enabledSkills })
      void navigate(`/conversation/${created.id}`)
    } catch {
      Message.error('创建失败，请重试')
    } finally {
      setCreating(false)
    }
  }

  const skills = options?.skills ?? []
  const agents = options?.agents ?? []

  return (
    <div className='size-full overflow-y-auto p-6' data-testid='new-conversation-page'>
      <div className='max-w-xl mx-auto flex flex-col gap-5'>
        <h1 className='text-20px font-700 text-foreground m-0'>新会话</h1>

        <section className='flex flex-col gap-2'>
          <div className='text-14px font-600 text-foreground'>智能体</div>
          <div className='flex flex-wrap gap-2'>
            {agents.length === 0 ? <span className='text-13px text-tertiary'>加载中…</span> : null}
            {agents.map((a) => (
              <button
                key={a.name}
                type='button'
                data-testid={`agent-option-${a.name}`}
                className={
                  assistantName === a.name
                    ? 'category-chip category-chip-active'
                    : 'category-chip category-chip-idle'
                }
                onClick={() => setAssistantName(a.name)}
              >
                {a.name}
              </button>
            ))}
          </div>
        </section>

        <section className='flex flex-col gap-2'>
          <div className='text-14px font-600 text-foreground'>技能</div>
          <div className='flex flex-wrap gap-2'>
            {skills.map((s) => {
              const selected = enabledSkills.includes(s.name)
              return (
                <button
                  key={s.name}
                  type='button'
                  data-testid={`skill-option-${s.name}`}
                  className={selected ? 'category-chip category-chip-active' : 'category-chip category-chip-idle'}
                  onClick={() =>
                    setEnabledSkills((prev) =>
                      selected ? prev.filter((n) => n !== s.name) : [...prev, s.name],
                    )
                  }
                >
                  {s.name}
                </button>
              )
            })}
          </div>
        </section>

        <div className='text-12px text-tertiary'>
          模型可在会话内切换；默认模型在设置中管理。
        </div>

        <div>
          <Button type='primary' loading={creating} disabled={!assistantName} onClick={() => void handleCreate()}>
            开始会话
          </Button>
        </div>
      </div>
    </div>
  )
}
