/**
 * 远程会话页（布局对齐 Sudowork ChatLayout/AcpChat/MessagetText/Sendbox）。
 * 消息列 max-w-800px 居中；气泡使用 --message-user/assistant-* 变量；
 * 输入区为 p-16px rd-20px bg-fill-1 卡片 + 底部工具行 + 圆形发送钮。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { Button, Input, Popover, Tag } from '@arco-design/web-react'
import type { RefTextAreaType } from '@arco-design/web-react/es/Input/textarea'
import { ArrowUp, Plus, Zap } from 'lucide-react'
import { getConversationContext, getConversationOptions } from './conversationApi'
import { useConversationSocket, type ChatMessage } from './useConversationSocket'
import { SkillSelectorMenu } from './SkillSelectorMenu'
import { stripAtQuery, useSkillSelector } from './useSkillSelector'
import { ConversationHeader } from './ConversationHeader'
import { RightPanel, RightPanelFloatingExpand } from './right-panel/RightPanel'
import type { PendingImage } from './SendBox'

/**
 * 剥离 user 消息头部的 <command-name>…</command-name> 技能注入标签（会话内 @技能的生效机制，
 * 对齐 Sudowork AcpAgent 的注入格式：N 条标签逐行 + 空行 + 正文）。
 * 锚定字符串起始、循环匹配"连续标签行 + 其后空白"——多技能时一次替换只剥第一条会泄漏剩余；
 * 锚定 ^ 保住正文中用户手打的字面量标签。历史渲染与去重比较共用。
 */
export function stripCommandNameTags(text: string): string {
  let out = text
  const tagLine = /^<command-name>[^\n]*<\/command-name>[^\S\n]*(?:\n|$)/
  while (tagLine.test(out)) {
    out = out.replace(tagLine, '')
  }
  return out.replace(/^[^\S\n]+/, '')
}

const FOCUS_RING = {
  light: { border: '#E1E0FF', shadow: '0 2px 20px rgba(225,224,255,.6)' },
  dark: { border: '#4D4B87', shadow: '0 2px 20px rgba(77,75,135,.45)' },
}

interface InitialState {
  initialMessage?: string
  initialImages?: PendingImage[]
  initialModel?: string
}

export function ConversationPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const initial = (location.state ?? null) as InitialState | null
  // turn 进行中本地停轮询（发送即停）：进行中历史若拉回已落库的当前 turn 会与流副本同屏双份
  const [turnActive, setTurnActive] = useState(false)
  const { data: context, mutate: mutateContext } = useSWR(
    id ? ['conversation-context', id] : null,
    () => getConversationContext(id!),
    // 轻量轮询：中途打开的观察者在 turn 完成后也能看到完整历史
    { refreshInterval: turnActive ? 0 : 5_000 },
  )
  const socket = useConversationSocket(id)
  const { data: options } = useSWR('conversation-options', getConversationOptions)
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [images, setImages] = useState<PendingImage[]>([])
  const [initialSent, setInitialSent] = useState(false)
  // 会话页 @技能（对齐初始页与 Sudowork Sendbox）：受控弹层 + 光标触发 + 发送时注入标签
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<number | undefined>(undefined)
  const textareaRef = useRef<RefTextAreaType | null>(null)
  // 右面板默认收起（对齐 Sudowork sudowork_workspace_panel_collapsed 语义：无值即折叠）
  const [rightPanelOpen, setRightPanelOpen] = useState(() => localStorage.getItem('sudowork_workspace_panel_collapsed') !== 'false')
  // turn 完成计数（running→idle 递增）：驱动右面板工作空间/交付物刷新
  const [turnFinishedAt, setTurnFinishedAt] = useState(0)
  // 会话进行中刷新信号：tool 消息计数变化 300ms 防抖递增（Sudowork 用 agent_status=session_active
  // 事件，webui 事件流无此事件，以 tool_use 近似"会话进行中"；turn 结束刷新由 turnFinishedAt 覆盖）
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0)
  const toolCount = useMemo(
    () => socket.state.messages.reduce((n, m) => (m.kind === 'tool' ? n + 1 : n), 0),
    [socket.state.messages],
  )
  useEffect(() => {
    if (toolCount === 0) return
    const timer = setTimeout(() => setWorkspaceRefreshKey(Date.now()), 300)
    return () => clearTimeout(timer)
  }, [toolCount])
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const toggleRightPanel = useCallback((): void => {
    setRightPanelOpen((v) => {
      localStorage.setItem('sudowork_workspace_panel_collapsed', v ? 'false' : 'true')
      return !v
    })
  }, [])

  const isWriter = socket.state.isWriter
  const uncertain = socket.state.lockState === 'uncertain'
  const busyByOther = socket.state.lockState === 'running' && !isWriter
  const canSend = isWriter && !uncertain && socket.status === 'open'

  // turnActive 复位（多路信号——存在永不产生 result 的真实路径，缺一路会让轮询永久冻结）：
  // lock running→idle / lock 转 uncertain / 收到 error / socket 断开
  useEffect(() => {
    if (
      socket.state.lockState === 'idle' ||
      socket.state.lockState === 'uncertain' ||
      socket.state.lastError !== null ||
      socket.status === 'closed'
    ) {
      setTurnActive(false)
    }
  }, [socket.state.lockState, socket.state.lastError, socket.status])

  // guid 跳转携带的首条消息：WS 就绪后（可选切模型）自动发送
  useEffect(() => {
    if (!id || initialSent || socket.status !== 'open' || !initial?.initialMessage) return
    setInitialSent(true)
    setTurnActive(true)
    if (initial.initialModel) socket.setModel(initial.initialModel)
    socket.appendLocalUser(initial.initialMessage, initial.initialImages ?? [])
    socket.send(initial.initialMessage, initial.initialImages ?? [])
    void navigate(location.pathname, { replace: true, state: null })
  }, [id, initialSent, socket, initial, navigate, location.pathname])

  // 新消息自动滚动到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [socket.state.messages])

  // turn 结束（lock 回到 idle）后刷新历史：让中途打开的观察者也能看到完整回复
  const prevLockRef = useRef(socket.state.lockState)
  useEffect(() => {
    if (prevLockRef.current === 'running' && socket.state.lockState === 'idle') {
      setTurnFinishedAt(Date.now())
      void mutateContext()
    }
    prevLockRef.current = socket.state.lockState
  }, [socket.state.lockState, mutateContext])

  // @ 触发控制器（对齐初始页/Sudowork）；关闭 = 剥 @query + dismiss + 收弹层
  const skillSelector = useSkillSelector({
    input: text,
    cursorPosition,
    selectedSkills,
    onRemoveSkill: (name) => setSelectedSkills((prev) => prev.filter((x) => x !== name)),
  })
  useEffect(() => {
    if (skillSelector.isOpen) setSkillPopoverOpen(true)
  }, [skillSelector.isOpen])
  const closeSkillSelector = useCallback((): void => {
    setText((prev) => stripAtQuery(prev, cursorPosition))
    skillSelector.setDismissed(true)
    setSkillPopoverOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [cursorPosition, skillSelector])

  // 会话切换（同路由参数变更不重挂载组件）：清空已选技能与弹层状态，避免 A 会话技能注入 B 会话
  useEffect(() => {
    setSelectedSkills([])
    setSkillPopoverOpen(false)
  }, [id])

  // 渲染收敛过滤：流副本已确认落库（历史接管）则隐藏；流列表数据永不删除（宁多显示勿丢消息）
  const historyMessages = useMemo(() => context?.messages ?? [], [context])
  const visibleStreamMessages = useMemo(
    () => filterSettledStreamMessages(socket.state.messages, historyMessages),
    [socket.state.messages, historyMessages],
  )

  function handleSend(): void {
    const trimmed = text.trim()
    if (!trimmed || !canSend) return
    setTurnActive(true)
    // 会话内 @技能生效机制（对齐 Sudowork AcpAgent）：发送文本注入 <command-name> 标签前缀，
    // 本地气泡 appendLocalUser 仍传原文（moss 会把带标签的 user 消息原样持久化，渲染侧统一剥离）
    const skillsToSend = [...selectedSkills]
    const skillTags = skillsToSend.map((s) => `<command-name>${s}</command-name>`).join('\n')
    const outbound = skillsToSend.length > 0 ? `${skillTags}\n\n${trimmed}` : trimmed
    socket.appendLocalUser(trimmed, images)
    socket.send(outbound, images)
    setText('')
    setImages([])
    setSelectedSkills([])
  }

  /** Enter 发送 / Shift+Enter 换行（对齐初始页既有模式；Arco onPressEnter 已排除输入法组合期）。
   *  弹层打开时 Enter 由弹层消费（选中高亮技能）——Arco onPressEnter 不检查 defaultPrevented，须页面守卫。 */
  function handlePressEnter(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (skillSelector.isOpen) return
    if (e.nativeEvent.shiftKey) return
    e.preventDefault()
    handleSend()
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
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

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const ring = isDark ? FOCUS_RING.dark : FOCUS_RING.light

  return (
    <div className='size-full flex flex-col bg-1 overflow-hidden' data-testid='conversation-page'>
      {/* 左右并列（对齐 Sudowork ChatLayout 默认布局）：header 只覆盖左列，右侧面板通顶全高 */}
      <div className='flex-1 flex min-h-0 overflow-hidden'>
        <div className='flex-1 flex flex-col min-h-0 min-w-0'>
        <ConversationHeader
          title={context?.customTitle ?? context?.title ?? `会话 ${id?.slice(0, 8) ?? ''}`}
          socketStatus={socket.status}
          models={options?.models ?? []}
          currentModel={socket.state.currentModel}
          onSetModel={(modelId) => socket.setModel(modelId)}
          onTogglePanel={toggleRightPanel}
          statusHint={uncertain ? '状态不确定（写入端中断）' : busyByOther ? '只读（另一设备正在输入）' : null}
        />

        {uncertain ? (
          <div className='shrink-0 bg-[var(--warning-soft)] text-13px text-foreground px-4 py-2 border-b border-[var(--warning-line)]'>
            该会话写入端意外中断，已转为只读。请新建会话继续。
          </div>
        ) : null}

        {/* 消息区 + 输入区（保留 20px 内边距；header 贴列边不缩进，对齐 Sudowork 满列宽 header） */}
        <div className='flex-1 flex flex-col px-20px min-h-0'>
        <div className='flex-1 relative min-h-0'>
          <div
            ref={scrollRef}
            className='absolute size-full overflow-y-auto'
            data-testid='message-list'
          >
            {/* 历史消息（context） */}
            {(context?.messages ?? []).map((msg, i) => (
              <HistoryBubble key={i} msg={msg} />
            ))}
            {/* 实时流（收敛过滤后） */}
            {visibleStreamMessages.map((msg) => {
              if (msg.kind === 'user') {
                return (
                  <MessageShell key={msg.id} align='right'>
                    <div
                      className='min-w-0 box-border overflow-hidden p-8px border border-solid transition-colors duration-200 w-fit max-w-full'
                      style={{
                        borderRadius: '16px',
                        background: 'var(--message-user-bg)',
                        color: 'var(--message-user-text)',
                        borderColor: 'var(--message-user-border)',
                      }}
                    >
                      <div className='text-14px whitespace-pre-wrap break-words'>{msg.text}</div>
                    </div>
                  </MessageShell>
                )
              }
              if (msg.kind === 'assistant') {
                return (
                  <MessageShell key={msg.id} align='left'>
                    <div
                      className='min-w-0 box-border overflow-hidden p-8px border border-solid transition-colors duration-200 w-fit max-w-full'
                      style={{
                        borderRadius: '16px',
                        background: 'var(--message-assistant-bg)',
                        color: 'var(--message-assistant-text)',
                        borderColor: 'var(--message-assistant-border)',
                      }}
                      data-testid='assistant-message'
                    >
                      <div className='text-14px whitespace-pre-wrap break-words'>
                        {msg.text || '…'}
                        {!msg.done ? <span className='animate-pulse'>▍</span> : null}
                      </div>
                    </div>
                  </MessageShell>
                )
              }
              if (msg.kind === 'tool') {
                return (
                  <MessageShell key={msg.id} align='left'>
                    <div className='inline-flex items-center gap-4px px-12px py-2px rounded-full text-secondary bg-fill-2 text-12px'>
                      🛠 {msg.name}
                      {msg.status === 'completed' ? ' ✓' : ''}
                    </div>
                  </MessageShell>
                )
              }
              return (
                <MessageShell key={msg.id} align='left'>
                  <div className='bg-message-tips rd-8px p-x-12px p-y-8px text-13px' data-testid='question-card'>
                    <div className='font-600 text-foreground'>❓ {msg.title}</div>
                    {msg.description ? (
                      <div className='text-12px text-secondary mt-1'>{msg.description}</div>
                    ) : null}
                    {canSend ? (
                      <QuestionAnswer
                        onAnswer={(answer) => {
                          socket.answerQuestion(msg.id, answer)
                          void navigate(location.pathname, { state: null })
                        }}
                      />
                    ) : (
                      <div className='text-12px text-tertiary mt-1'>等待写入端回答…</div>
                    )}
                  </div>
                </MessageShell>
              )
            })}
            {visibleStreamMessages.length === 0 && (context?.messages ?? []).length === 0 ? (
              <div className='text-13px text-tertiary f-center py-8'>发送第一条消息开始对话</div>
            ) : null}
          </div>
        </div>

        {/* SendBox（max-w-800px 居中 + mb-16px） */}
        <div className='max-w-800px w-full mx-auto flex flex-col mt-auto mb-16px shrink-0'>
          {images.length > 0 ? (
            <div className='flex flex-wrap items-center gap-3 mb-2'>
              {images.map((img, i) => (
                <Tag key={i} closable onClose={() => setImages((prev) => prev.filter((_, j) => j !== i))}>
                  🖼 {img.mediaType}
                </Tag>
              ))}
            </div>
          ) : null}
          <div
            className='relative p-16px b b-solid flex flex-col z-10'
            style={{
              borderRadius: '20px',
              borderWidth: 1,
              backgroundColor: 'var(--color-fill-1)',
              borderColor: focused ? ring.border : 'var(--border-default, #e5e6eb)',
              boxShadow: focused ? ring.shadow : 'none',
              transition: 'box-shadow .25s ease, border-color .25s ease',
            }}
          >
            {/* 已选技能（对齐初始页"当前使用技能"区） */}
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
              autoSize={{ minRows: 2, maxRows: 5 }}
              value={text}
              onChange={(value, e) => {
                setText(value)
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
              placeholder={
                canSend
                  ? '发送消息…'
                  : socket.status === 'closed'
                    ? '连接已断开'
                    : uncertain
                      ? '会话状态不确定（只读）'
                      : busyByOther
                        ? '只读观察模式'
                        : '连接中…'
              }
              disabled={!canSend}
              className='pl-0 pr-0 !b-none focus:shadow-none m-0 !bg-transparent lh-[20px] !resize-none text-14px'
            />
            <div className='flex items-center justify-between gap-2 w-full mt-2'>
              <div className='flex items-center gap-3'>
                <span className='relative'>
                  <Button
                    shape='circle'
                    type='secondary'
                    icon={<Plus size={16} color='var(--text-secondary)' />}
                    onClick={() => fileRef.current?.click()}
                    disabled={!canSend}
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
                {/* @技能（与初始页对齐：受控弹层复用 SkillSelectorMenu；数据源为全局已安装技能） */}
                <Popover
                  trigger={[]}
                  position='tl'
                  popupVisible={skillPopoverOpen}
                  onVisibleChange={(visible) => {
                    if (!visible) closeSkillSelector()
                  }}
                  content={
                    <SkillSelectorMenu
                      skills={options?.skills ?? []}
                      selectedSkills={selectedSkills}
                      loading={options === undefined}
                      popupVisible={skillPopoverOpen}
                      onSelectItem={(skill) => {
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
                    disabled={!canSend}
                    onClick={() => setSkillPopoverOpen(true)}
                  >
                    <span className='text-14px font-700 leading-none shrink-0'>@</span>
                    <span className='min-w-0 truncate'>
                      {selectedSkills.length > 0 ? `技能 · ${selectedSkills.length}` : '技能'}
                    </span>
                  </button>
                </Popover>
              </div>
              {socket.state.lockState === 'running' && isWriter ? (
                /* 运行中：箭头变停止方块（对齐 Sudowork Sendbox），点击终止当前回复 */
                <Button
                  shape='circle'
                  type='secondary'
                  className='bg-animate'
                  disabled={socket.state.isStopping}
                  icon={<div className='mx-auto size-12px bg-6' />}
                  onClick={() => socket.stop()}
                  aria-label='停止'
                  data-testid='stop-button'
                />
              ) : (
                <Button
                  shape='circle'
                  type='primary'
                  className='send-arrow-btn'
                  disabled={!canSend || !text.trim()}
                  icon={<ArrowUp size={16} color='#fff' />}
                  onClick={handleSend}
                  aria-label='发送'
                />
              )}
            </div>
          </div>
        </div>
        </div>
        </div>
        {/* 右侧面板（工作空间/终端/交付物）与收起态浮动展开箭头（与左列并列，通顶全高） */}
        {id ? (
          rightPanelOpen ? (
            <RightPanel conversationId={id} open turnFinishedAt={turnFinishedAt} workspaceRefreshKey={workspaceRefreshKey} />
          ) : (
            <div className='relative w-0'>
              <RightPanelFloatingExpand onExpand={() => setRightPanelOpen(true)} />
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}

/**
 * 渲染收敛过滤（纯函数，每次渲染从两侧数据现算，无持久状态）：
 * - local user 副本：历史存在相同文本的 user 消息 → 已落库，隐藏（历史版本接管）
 * - 流 assistant（非空文本）：被历史任一 assistant 文本包含 → 隐藏；不被包含
 *   （如 SendUserQuestion turn 的 chunk 聚合文本上游永不落库）→ 保留显示
 * - 流 tool/question：uuid 存在于历史（tool_use 两侧同 uuid）→ 隐藏
 * 设计原则：宁多显示勿丢消息——判据偏差的最坏后果是某条消息双份显示至页面刷新。
 */
function historyTextOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        typeof b === 'object' && b && 'text' in b ? String((b as { text?: string }).text ?? '') : '',
      )
      .join('')
  }
  return ''
}

export function filterSettledStreamMessages(
  stream: ChatMessage[],
  history: Record<string, unknown>[],
): ChatMessage[] {
  const historyUserTexts = new Set<string>()
  const historyAssistantTexts: string[] = []
  const historyUuids = new Set<string>()
  for (const msg of history) {
    const type = String(msg.type ?? '')
    if (type === 'user') {
      // moss 持久化的 user 消息带 <command-name> 注入标签，与本地流副本（原文）比较需先剥离
      historyUserTexts.add(stripCommandNameTags(historyTextOf(msg.content)))
    } else if (type === 'assistant') {
      historyAssistantTexts.push(historyTextOf(msg.content))
    } else {
      const uuid = (msg as { uuid?: unknown }).uuid
      if (typeof uuid === 'string') historyUuids.add(uuid)
    }
  }
  return stream.filter((m) => {
    if (m.kind === 'user') return !historyUserTexts.has(m.text)
    if (m.kind === 'assistant') {
      const t = m.text.trim()
      if (!t) return true
      return !historyAssistantTexts.some((h) => h.includes(t))
    }
    return !historyUuids.has(m.id)
  })
}

/** 消息外壳：max-w-800px 居中，条目上间距 10px。 */
function MessageShell({
  align,
  children,
}: {
  align: 'left' | 'right' | 'center'
  children: React.ReactNode
}): React.ReactElement {
  const justify =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
  return (
    <div className={`min-w-0 flex w-full box-border m-t-10px max-w-full md:max-w-800px mx-auto items-start ${justify}`}>
      <div className='min-w-0'>{children}</div>
    </div>
  )
}

function QuestionAnswer({ onAnswer }: { onAnswer: (text: string) => void }): React.ReactElement {
  const [value, setValue] = useState('')
  return (
    <div className='flex gap-2 mt-2'>
      <Input
        size='small'
        value={value}
        onChange={setValue}
        placeholder='输入你的回答'
        aria-label='问题回答输入'
      />
      <Button size='mini' type='primary' disabled={!value.trim()} onClick={() => onAnswer(value.trim())}>
        回答
      </Button>
    </div>
  )
}

/** 历史消息气泡（context 投影）。 */
function HistoryBubble({ msg }: { msg: Record<string, unknown> }): React.ReactElement | null {
  const type = String(msg.type ?? '')
  const content = msg.content
  const extractText = (): string => {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((b) =>
          typeof b === 'object' && b && 'text' in b ? String((b as { text?: string }).text ?? '') : '',
        )
        .join('')
    }
    return ''
  }
  if (type === 'user') {
    return (
      <MessageShell align='right'>
        <div
          className='min-w-0 box-border overflow-hidden p-8px border border-solid w-fit max-w-full'
          style={{
            borderRadius: '16px',
            background: 'var(--message-user-bg)',
            color: 'var(--message-user-text)',
            borderColor: 'var(--message-user-border)',
          }}
        >
          <div className='text-14px whitespace-pre-wrap break-words'>{stripCommandNameTags(extractText())}</div>
        </div>
      </MessageShell>
    )
  }
  if (type === 'assistant') {
    return (
      <MessageShell align='left'>
        <div
          className='min-w-0 box-border overflow-hidden p-8px border border-solid w-fit max-w-full'
          style={{
            borderRadius: '16px',
            background: 'var(--message-assistant-bg)',
            color: 'var(--message-assistant-text)',
            borderColor: 'var(--message-assistant-border)',
          }}
        >
          <div className='text-14px whitespace-pre-wrap break-words'>{extractText()}</div>
        </div>
      </MessageShell>
    )
  }
  if (type === 'tool_use') {
    return (
      <MessageShell align='left'>
        <div className='inline-flex items-center gap-4px px-12px py-2px rounded-full text-secondary bg-fill-2 text-12px'>
          🛠 {String(msg.name ?? 'tool')}
        </div>
      </MessageShell>
    )
  }
  return null
}
