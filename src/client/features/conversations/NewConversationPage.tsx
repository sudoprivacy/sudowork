/**
 * 新建会话页（布局对齐 Sudowork guid 页，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 结构：欢迎标题 → 智能体胶囊条 → 提示词模板 → 输入卡片（技能标签+文本域+操作行）
 *       → 底部助手 chips。发送即创建 Moss 远程会话并携带首条消息跳转。
 */
import React, { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { Button, Dropdown, Input, Menu, Popover, Tag } from '@arco-design/web-react'
import { ArrowUp, AtSign, Bot, Brain, Plus, Zap } from 'lucide-react'
import { createConversation, getConversationOptions } from './conversationApi'
import type { PendingImage } from './SendBox'

const PROMPT_CATEGORIES: { key: string; label: string; prompts: string[] }[] = [
  {
    key: 'coding',
    label: '编程',
    prompts: ['帮我审查这段代码的性能问题', '写一个单元测试', '解释这段报错的含义'],
  },
  {
    key: 'writing',
    label: '写作',
    prompts: ['帮我润色这段文字', '写一封商务邮件', '总结这篇文档要点'],
  },
  {
    key: 'analysis',
    label: '分析',
    prompts: ['用表格对比这两个方案', '分析这份数据的趋势', '列出这个决策的风险'],
  },
]

const FOCUS_RING = {
  light: { border: '#E1E0FF', shadow: '0 2px 20px rgba(225,224,255,.6)' },
  dark: { border: '#4D4B87', shadow: '0 2px 20px rgba(77,75,135,.45)' },
}

export function NewConversationPage(): React.ReactElement {
  const navigate = useNavigate()
  const { data: options } = useSWR('conversation-options', getConversationOptions)

  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [input, setInput] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [focused, setFocused] = useState(false)
  const [category, setCategory] = useState<string>(PROMPT_CATEGORIES[0]!.key)
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const agents = options?.agents ?? []
  const skills = options?.skills ?? []
  const models = options?.models ?? []

  const canSend = Boolean(selectedAgent && input.trim()) && !sending

  async function handleSend(): Promise<void> {
    if (!canSend) return
    setSending(true)
    try {
      const created = await createConversation({
        assistantName: selectedAgent,
        enabledSkills: selectedSkills,
      })
      void navigate(`/conversation/${created.id}`, {
        state: { initialMessage: input.trim(), initialImages: images, initialModel: selectedModel || undefined },
      })
    } finally {
      setSending(false)
    }
  }

  async function handleFiles(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(e.target.files ?? [])
    const next: PendingImage[] = []
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) continue
      if (file.size > 10 * 1024 * 1024) continue
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const r = String(reader.result ?? '')
          resolve(r.slice(r.indexOf(',') + 1))
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      next.push({ mediaType: file.type as PendingImage['mediaType'], data })
    }
    setImages((prev) => [...prev, ...next].slice(0, 4))
    if (fileRef.current) fileRef.current.value = ''
  }

  const isDark = useMemo(
    () => document.documentElement.getAttribute('data-theme') === 'dark',
    [],
  )
  const ring = isDark ? FOCUS_RING.dark : FOCUS_RING.light
  const activeCategory = PROMPT_CATEGORIES.find((c) => c.key === category)!

  return (
    <div className='page-wrapper w-full min-h-full box-border overflow-y-auto px-10 pb-4' data-testid='new-conversation-page'>
      <div className='page-content mx-auto w-full !max-w-[70%] h-full f-center flex-col'>
        <div className='w-full px-4 box-border mx-auto mt-[-5vh] flex flex-col'>
          {/* 欢迎标题 */}
          <p className='text-2xl font-semibold mb-6 text-0 text-center'>有什么可以帮您？</p>

          {/* 智能体胶囊条（AgentPillBar） */}
          <div className='w-full flex justify-center mb-5'>
            <div className='f-center p-1.5 rd-30px bg-guid-agent-bar w-fit max-w-full overflow-hidden gap-1 flex-nowrap text-foreground'>
              {agents.map((a) => {
                const active = selectedAgent === a.name
                return (
                  <div
                    key={a.name}
                    data-testid={`agent-option-${a.name}`}
                    className={`group relative flex items-center cursor-pointer whitespace-nowrap overflow-hidden transition-all duration-250 ${
                      active
                        ? 'opacity-100 px-3 py-2 rd-20px mx-0.5 bg-fill-0'
                        : 'opacity-60 p-1 hover:opacity-100'
                    }`}
                    onClick={() => setSelectedAgent(active ? '' : a.name)}
                  >
                    <span className='inline-flex h-5 w-5 shrink-0 items-center justify-center'>
                      <Bot size={18} />
                    </span>
                    <span
                      className={`text-14px text-foreground ${active ? 'font-semibold ml-1' : 'font-medium ml-1'}`}
                    >
                      {a.name}
                    </span>
                  </div>
                )
              })}
              {agents.length === 0 ? (
                <span className='text-13px text-secondary px-3 py-2'>加载智能体中…</span>
              ) : null}
            </div>
          </div>

          {/* 提示词模板 */}
          <div className='w-full mb-4 animate-fade-in animate-duration-400 animate-ease-out'>
            <div className='flex items-center gap-6px mb-10px'>
              <span className='text-13px text-secondary'>💡 常用提示词</span>
            </div>
            <div className='flex flex-wrap gap-2 mb-1'>
              {PROMPT_CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type='button'
                  className={`inline-flex items-center gap-1.5 h-7 border rd-full px-3 text-xs transition-all active:scale-96 ${
                    category === c.key
                      ? 'border-primary bg-primary font-semibold text-white'
                      : 'bg-fill-2 text-foreground hover:bg-fill-3'
                  }`}
                  onClick={() => setCategory(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className='flex flex-wrap gap-2 mt-2 animate-fade-in animate-duration-400'>
              {activeCategory.prompts.map((p) => (
                <Button key={p} size='small' onClick={() => setInput(p)}>
                  {p}
                </Button>
              ))}
            </div>
          </div>

          {/* 输入卡片（GuidInputCard） */}
          <div
            className='w-full box-border relative p-16px b b-solid rd-20px flex flex-col overflow-hidden transition-all duration-200'
            style={{
              zIndex: 1,
              backgroundColor: 'var(--color-fill-1)',
              borderWidth: 1,
              borderColor: focused ? ring.border : 'var(--border-default, #e5e6eb)',
              boxShadow: focused ? ring.shadow : 'none',
              transition: 'box-shadow .25s ease, border-color .25s ease',
            }}
          >
            {/* 已选技能 */}
            {selectedSkills.length > 0 ? (
              <div className='flex flex-col gap-6px mb-8px'>
                <div className='flex items-center gap-4px text-11px text-secondary'>
                  <Zap size={12} /> 当前使用技能
                </div>
                <div className='flex flex-wrap gap-6px'>
                  {selectedSkills.map((s) => (
                    <Tag
                      key={s}
                      closable
                      className='text-12px rd-full'
                      onClose={() => setSelectedSkills((prev) => prev.filter((x) => x !== s))}
                    >
                      {s}
                    </Tag>
                  ))}
                </div>
              </div>
            ) : null}

            <Input.TextArea
              aria-label='消息输入框'
              autoSize={{ minRows: 3, maxRows: 20 }}
              value={input}
              onChange={setInput}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={selectedAgent ? `向 ${selectedAgent} 提问…` : '请先选择智能体，然后输入消息'}
              className='text-16px rounded-xl !bg-transparent !b-none !resize-none !p-0'
              style={{ '--w-e-textarea-height': 'auto' } as React.CSSProperties}
            />

            {images.length > 0 ? (
              <div className='flex flex-wrap items-center gap-3 my-3 text-12px text-secondary'>
                {images.map((img, i) => (
                  <Tag key={i} closable onClose={() => setImages((prev) => prev.filter((_, j) => j !== i))}>
                    🖼 {img.mediaType}
                  </Tag>
                ))}
              </div>
            ) : null}

            {/* 操作行（GuidActionRow） */}
            <div className='flex items-center justify-between w-full gap-2 mt-3'>
              <div className='inline-flex items-center gap-2.5 shrink min-w-0'>
                <span className='relative'>
                  <Button
                    shape='circle'
                    type='secondary'
                    icon={<Plus size={16} color='var(--text-secondary)' />}
                    onClick={() => fileRef.current?.click()}
                    aria-label='添加图片'
                  />
                  {images.length > 0 ? (
                    <span className='absolute -right-3px -top-3px f-center min-w-14px h-14px rounded-full bg-primary px-3px text-9px text-white font-600'>
                      {images.length}
                    </span>
                  ) : null}
                  <input
                    ref={fileRef}
                    type='file'
                    accept='image/png,image/jpeg,image/webp'
                    multiple
                    className='hidden'
                    onChange={(e) => void handleFiles(e)}
                  />
                </span>

                {/* 技能选择 */}
                <Popover
                  trigger='click'
                  position='tl'
                  content={
                    <div className='w-64 max-h-80 overflow-y-auto p-2 flex flex-col gap-1'>
                      {skills.map((s) => {
                        const on = selectedSkills.includes(s.name)
                        return (
                          <div
                            key={s.name}
                            data-testid={`skill-option-${s.name}`}
                            className={`flex items-center gap-8px px-10px h-38px rd-8px cursor-pointer text-14px transition-colors ${
                              on ? 'bg-2 text-foreground' : 'text-foreground hover:bg-hover active:bg-active'
                            }`}
                            onClick={() =>
                              setSelectedSkills((prev) =>
                                on ? prev.filter((x) => x !== s.name) : [...prev, s.name],
                              )
                            }
                          >
                            <span className='inline-flex size-4 items-center justify-center'>
                              {on ? <Zap size={12} color='var(--ui-accent-orange)' /> : <Zap size={12} />}
                            </span>
                            <span className='truncate'>{s.name}</span>
                          </div>
                        )
                      })}
                      {skills.length === 0 ? (
                        <div className='text-13px text-secondary p-2'>暂无可选技能</div>
                      ) : null}
                    </div>
                  }
                >
                  <button
                    type='button'
                    className='inline-flex h-7 min-w-0 items-center gap-2 rd-full border px-3 text-13px font-500 transition-colors bg-fill-2 text-secondary hover:bg-fill-3 hover:text-foreground'
                  >
                    <span className='inline-flex size-4 shrink-0 items-center justify-center text-inherit'>
                      <AtSign size={14} />
                    </span>
                    <span className='min-w-0 truncate'>
                      {selectedSkills.length > 0 ? `技能 · ${selectedSkills.length}` : '技能'}
                    </span>
                  </button>
                </Popover>

                {/* 模型选择 */}
                <Dropdown
                  trigger='click'
                  position='top'
                  droplist={
                    <Menu style={{ minWidth: 220, maxHeight: 360, overflowY: 'auto' }}>
                      {models.map((m) => (
                        <Menu.Item key={m.id} onClick={() => setSelectedModel(m.id)}>
                          <span className='flex items-center gap-2'>
                            <span
                              className='inline-block size-1.5 rounded-full'
                              style={{ background: selectedModel === m.id ? 'var(--primary)' : 'var(--color-text-4)' }}
                            />
                            <span className='truncate'>{m.name}</span>
                          </span>
                        </Menu.Item>
                      ))}
                    </Menu>
                  }
                >
                  <button
                    type='button'
                    className='inline-flex h-7 min-w-0 items-center gap-2 rd-full border px-3 text-13px font-500 transition-colors bg-fill-2 text-secondary hover:bg-fill-3 hover:text-foreground'
                  >
                    <span className='inline-flex size-4 shrink-0 items-center justify-center text-inherit'>
                      <Brain size={14} />
                    </span>
                    <span className='min-w-0 truncate'>
                      {selectedModel || (models[0]?.name ?? '模型')}
                    </span>
                  </button>
                </Dropdown>
              </div>

              <Button
                shape='circle'
                type='primary'
                loading={sending}
                disabled={!canSend}
                icon={<ArrowUp size={16} color='#fff' />}
                onClick={() => void handleSend()}
                aria-label='发送'
              />
            </div>
          </div>

          {/* 底部助手 chips（AssistantSelectionArea） */}
          <div className='mt-16px w-full'>
            <div className='f-center flex-wrap gap-2'>
              {agents.map((a) => (
                <div
                  key={a.name}
                  data-testid={`assistant-chip-${a.name}`}
                  className='h-28px group flex items-center gap-8px px-16px rd-100px cursor-pointer transition-all b-1 b-solid bg-fill-0 hover:bg-fill-1 select-none'
                  style={{ borderWidth: 1, borderColor: 'var(--bg-3)' }}
                  onClick={() => setSelectedAgent(a.name)}
                >
                  <span className='inline-flex h-16px w-16px shrink-0 items-center justify-center'>
                    <Bot size={16} />
                  </span>
                  <span className='text-14px text-2 hover:text-1'>{a.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
