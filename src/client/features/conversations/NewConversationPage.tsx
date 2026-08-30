/**
 * 新建会话页（布局对齐 Sudowork guid 页，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 结构：欢迎标题 → SudoCode 胶囊 → 提示词模板（默认收起）→ 输入卡片 → 底部智能体列表
 *       （空则不渲染；点击进入选中态视图）。发送与是否选中智能体无关：不选走 Moss 默认，
 *       选中则以其 name 创建会话。发送入口：箭头按钮 / Enter（Shift+Enter 换行）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { Button, Dropdown, Input, Menu, Message, Popover, Tag } from '@arco-design/web-react'
import type { RefTextAreaType } from '@arco-design/web-react/es/Input/textarea'
import { ArrowUp, AtSign, Bot, Brain, Plus, Zap } from 'lucide-react'
import { ApiError } from '../auth/authApi'
import { createConversation, getConversationOptions } from './conversationApi'
import { AgentSelectedView, type SelectedAgentInfo } from './AgentSelectedView'
import { SkillSelectorMenu } from './SkillSelectorMenu'
import { stripAtQuery, useSkillSelector } from './useSkillSelector'
import { useTypewriterPlaceholder } from './useTypewriterPlaceholder'
import type { PendingImage } from './SendBox'
import sudoworkIcon from '@client/assets/sudowork-icon-dark.svg'

/** 后端错误码 → 用户可读文案（UNKNOWN 之类无信息量的兜底不再出现）。 */
const SEND_ERROR_MESSAGES: Record<string, string> = {
  MOSS_UNAUTHORIZED: '登录已过期，请重新登录',
  MOSS_UNAVAILABLE: 'Moss 服务暂不可用，请稍后重试',
  MOSS_ERROR: 'Moss 服务错误，请稍后重试',
  INTERNAL: '服务器内部错误，请稍后重试',
  INVALID_REQUEST: '请求参数无效',
  SELECTION_NOT_AVAILABLE: '所选智能体或技能当前不可用',
}

/** 提示词模板分类（文案与图标逐字对齐 Sudowork guid.json / DEFAULT_PROMPT_CATEGORIES）：
 *  按钮显示短文案 label，点击填入完整模板 content。 */
const PROMPT_CATEGORIES: {
  key: string
  label: string
  icon: string
  prompts: { label: string; content: string }[]
}[] = [
  {
    key: 'coding',
    label: '编程',
    icon: '💻',
    prompts: [
      { label: '帮我写一个脚本', content: '帮我写一个 Python 脚本，用于...' },
      { label: '帮我 Review 代码', content: '请帮我 review 以下代码，指出潜在问题并给出优化建议：\n\n```\n// 粘贴代码\n```' },
      { label: '帮我调试报错', content: '我遇到了以下报错，请帮我分析原因并给出解决方案：\n\n错误信息：' },
      { label: '解释这段代码', content: '请解释以下代码的工作原理，用简单易懂的方式说明：\n\n```\n// 粘贴代码\n```' },
    ],
  },
  {
    key: 'writing',
    label: '写作',
    icon: '✍️',
    prompts: [
      { label: '帮我撰写文章', content: '请帮我撰写一篇关于...的文章，要求...' },
      { label: '润色一段文字', content: '请帮我润色以下文字，使其更加专业流畅：\n\n' },
      { label: '帮我写封邮件', content: '请帮我写一封邮件，主题是...，收件人是...' },
    ],
  },
  {
    key: 'translation',
    label: '翻译',
    icon: '🌐',
    prompts: [
      { label: '翻译为英文', content: '请将以下内容翻译为英文，保持原文风格：\n\n' },
      { label: '翻译为中文', content: '请将以下内容翻译为中文，要求信达雅：\n\n' },
    ],
  },
  {
    key: 'analysis',
    label: '分析',
    icon: '📊',
    prompts: [
      { label: '分析数据趋势', content: '请分析以下数据，找出关键趋势和洞察：\n\n' },
      { label: '总结要点', content: '请总结以下内容的要点，用简洁的 bullet points 列出：\n\n' },
    ],
  },
  {
    key: 'creative',
    label: '创意',
    icon: '🎨',
    prompts: [
      { label: '头脑风暴', content: '请帮我就...这个主题进行头脑风暴，给出 10 个创意想法' },
      { label: '取名字', content: '请帮我为...取一个好听且有意义的名字，给出 5 个备选' },
    ],
  },
  {
    key: 'learning',
    label: '学习',
    icon: '📚',
    prompts: [
      { label: '解释一个概念', content: '请用通俗易懂的方式解释...这个概念，并举例说明' },
      { label: '对比两个事物', content: '请对比...和...的区别，从原理、优缺点、适用场景等方面分析' },
    ],
  },
]

const FOCUS_RING = {
  light: { border: '#E1E0FF', shadow: '0 2px 20px rgba(225,224,255,.6)' },
  dark: { border: '#4D4B87', shadow: '0 2px 20px rgba(77,75,135,.45)' },
}

export function NewConversationPage(): React.ReactElement {
  const navigate = useNavigate()
  const { data: options } = useSWR('conversation-options', getConversationOptions)

  const [selectedAgent, setSelectedAgent] = useState<SelectedAgentInfo | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [input, setInput] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [focused, setFocused] = useState(false)
  const [category, setCategory] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // @技能弹层（受控）：按钮点击与 @ 输入触发共用同一 open state（对齐 Sudowork guid 全受控方案）
  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false)
  /** 光标位置（@ 触发按光标匹配——整段匹配会在多行编辑时漏触发/误维持） */
  const [cursorPosition, setCursorPosition] = useState<number | undefined>(undefined)
  const textareaRef = useRef<RefTextAreaType | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const agents = options?.agents ?? []
  const skills = options?.skills ?? []
  const models = options?.models ?? []

  // @ 触发控制器（对齐 Sudowork useSkillSelectorController）
  const skillSelector = useSkillSelector({
    input,
    cursorPosition,
    selectedSkills,
    onRemoveSkill: (name) => setSelectedSkills((prev) => prev.filter((x) => x !== name)),
  })
  // @ 命中 → 打开弹层；关闭（dismiss/Escape）→ 收起
  useEffect(() => {
    if (skillSelector.isOpen) setSkillPopoverOpen(true)
  }, [skillSelector.isOpen])

  /** 统一关闭：剥掉输入框 @query + controller 置 dismissed + 收起弹层 + 焦点回输入框
   *  （对齐 Sudowork 三合一接线；Arco Popover 无 onAfterClose，回焦在关闭路径内完成） */
  const closeSkillSelector = useCallback((): void => {
    setInput((prev) => stripAtQuery(prev, cursorPosition))
    skillSelector.setDismissed(true)
    setSkillPopoverOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [cursorPosition, skillSelector])

  const canSend = Boolean(input.trim()) && !sending

  async function handleSend(): Promise<void> {
    if (!canSend) return
    setSending(true)
    try {
      const created = await createConversation({
        assistantName: selectedAgent?.name ?? '',
        enabledSkills: selectedSkills,
      })
      void navigate(`/conversation/${created.id}`, {
        state: { initialMessage: input.trim(), initialImages: images, initialModel: selectedModel || undefined },
      })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : (err as Error).message
      Message.error(`发送失败：${SEND_ERROR_MESSAGES[code] ?? code ?? '请稍后重试'}`)
      // moss 侧登录态失效：提示后自动回登录页（重新登录即恢复）
      if (err instanceof ApiError && err.status === 401) {
        navigate('/login')
      }
    } finally {
      setSending(false)
    }
  }

  /** Enter 发送 / Shift+Enter 换行（对齐 Sudowork guid；Arco onPressEnter 不排除 Shift，需手动判定）。
   *  弹层打开时 Enter 由弹层消费（选中高亮技能），不触发发送——Arco 的 onPressEnter 不检查
   *  defaultPrevented（useComposition.js），弹层的 preventDefault 拦不住，必须页面级守卫。 */
  function handlePressEnter(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (skillSelector.isOpen) return
    if (e.nativeEvent.shiftKey) return
    e.preventDefault()
    void handleSend()
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
  const activeCategory = category ? PROMPT_CATEGORIES.find((c) => c.key === category) : undefined
  // placeholder 打字机动画（后半段逐字打出；前缀为 agent 名，对齐 Sudowork guid/index.tsx:699）
  const typewriter = useTypewriterPlaceholder('发消息、上传文件或打开文件夹...')

  return (
    <div className='page-wrapper w-full min-h-full box-border overflow-y-auto px-10 pb-4' data-testid='new-conversation-page'>
      <div className='page-content mx-auto w-full !max-w-[70%] h-full f-center flex-col'>
        <div className='w-full px-4 box-border mx-auto mt-[-5vh] flex flex-col'>
          {selectedAgent ? (
            /* 选中态视图（返回 + 头像 + 名称 + 描述卡），替换欢迎语/胶囊/模板区 */
            <AgentSelectedView agent={selectedAgent} onBack={() => setSelectedAgent(null)} />
          ) : (
            <>
              {/* 欢迎标题 */}
              <p className='text-2xl font-semibold mb-6 text-0 text-center'>Hi，今天有什么安排？</p>

              {/* SudoCode 胶囊（对齐 Sudowork AgentPillBar 固定单胶囊形态） */}
              <div className='w-full flex justify-center mb-5'>
                <div className='f-center p-1.5 rd-30px bg-guid-agent-bar w-fit max-w-full text-foreground'>
                  <div className='group relative flex items-center whitespace-nowrap px-3 py-2 rd-20px mx-0.5 bg-fill-0'>
                    <span className='inline-flex h-5 w-5 shrink-0 items-center justify-center leading-none'>
                      <img src={sudoworkIcon} alt='SudoCode' width={20} height={20} className='block object-contain' />
                    </span>
                    <span className='font-semibold text-14px ml-1 text-foreground'>SudoCode</span>
                  </div>
                </div>
              </div>

              {/* 提示词模板（默认收起，点击分类展开——对齐 Sudowork） */}
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
                      onClick={() => setCategory(category === c.key ? null : c.key)}
                    >
                      <span className='inline-flex h-3.5 w-3.5 items-center justify-center'>{c.icon}</span>
                      {c.label}
                    </button>
                  ))}
                </div>
                {activeCategory ? (
                  <div className='flex flex-wrap gap-2 mt-2 animate-fade-in animate-duration-400'>
                    {activeCategory.prompts.map((p) => (
                      <Button key={p.label} size='small' shape='square' className='!border !border-default' onClick={() => setInput(p.content)}>
                        {p.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          )}

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
              ref={textareaRef}
              aria-label='消息输入框'
              autoSize={{ minRows: 3, maxRows: 20 }}
              value={input}
              onChange={(value, e) => {
                setInput(value)
                setCursorPosition((e?.target as HTMLTextAreaElement | undefined)?.selectionStart)
              }}
              onSelect={(e) => {
                setCursorPosition((e.target as HTMLTextAreaElement).selectionStart)
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onPressEnter={handlePressEnter}
              onKeyDown={(e) => {
                if (skillSelector.onKeyDown(e)) return
              }}
              placeholder={`${selectedAgent?.displayName ?? 'SudoCode'}, ${typewriter || '发消息、上传文件或打开文件夹...'}`}
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

                {/* 技能选择（受控 Popover：按钮点击与输入 @ 触发共用 open state，对齐 Sudowork） */}
                <Popover
                  trigger={[]}
                  position='tl'
                  popupVisible={skillPopoverOpen}
                  onVisibleChange={(visible) => {
                    if (!visible) closeSkillSelector()
                  }}
                  content={
                    <SkillSelectorMenu
                      skills={skills}
                      selectedSkills={selectedSkills}
                      popupVisible={skillPopoverOpen}
                      onSelectItem={(skill) => {
                        // 对齐 Sudowork guid：加入已选（不重复）→ 关闭并剥掉 @query
                        setSelectedSkills((prev) =>
                          prev.includes(skill.name) ? prev : [...prev, skill.name],
                        )
                        closeSkillSelector()
                      }}
                      onDismiss={closeSkillSelector}
                    />
                  }
                >
                  <button
                    type='button'
                    className='inline-flex h-7 min-w-0 items-center gap-2 rd-full border px-3 text-13px font-500 transition-colors bg-fill-2 text-secondary hover:bg-fill-3 hover:text-foreground'
                    onClick={() => setSkillPopoverOpen(true)}
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
                className='send-arrow-btn'
                loading={sending}
                disabled={!input.trim() || sending}
                icon={<ArrowUp size={16} color='#fff' />}
                onClick={() => void handleSend()}
                aria-label='发送'
              />
            </div>
          </div>

          {/* 底部智能体列表（对齐 Sudowork AssistantSelectionArea：空列表整块不渲染） */}
          {agents.length > 0 ? (
            <div className='mt-16px w-full' data-testid='assistant-list'>
              <div className='f-center flex-wrap gap-2'>
                {agents.map((a) => (
                  <div
                    key={a.name}
                    data-testid={`assistant-chip-${a.name}`}
                    className='h-28px group flex items-center gap-8px px-16px rd-100px cursor-pointer transition-all b-1 b-solid bg-fill-0 hover:bg-fill-1 select-none'
                    style={{ borderWidth: 1, borderColor: 'var(--bg-3)' }}
                    onClick={() =>
                      setSelectedAgent(
                        selectedAgent?.name === a.name
                          ? null
                          : { name: a.name, displayName: a.displayName, emoji: a.emoji, description: a.description },
                      )
                    }
                  >
                    <span className='inline-flex h-16px w-16px shrink-0 items-center justify-center leading-none'>
                      {a.emoji ? <span className='text-16px leading-none'>{a.emoji}</span> : <Bot size={16} />}
                    </span>
                    <span className='text-14px text-2 hover:text-1'>{a.displayName}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
