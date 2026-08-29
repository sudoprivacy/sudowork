/**
 * 远程会话页（布局对齐 Sudowork ChatLayout/AcpChat/MessagetText/Sendbox）。
 * 消息列 max-w-800px 居中；气泡使用 --message-user/assistant-* 变量；
 * 输入区为 p-16px rd-20px bg-fill-1 卡片 + 底部工具行 + 圆形发送钮。
 */
import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { Button, Input, Message as ArcoMessage, Tag } from '@arco-design/web-react'
import { ArrowUp, Plus } from 'lucide-react'
import { getConversationContext, terminateConversation } from './conversationApi'
import { useConversationSocket } from './useConversationSocket'
import type { PendingImage } from './SendBox'

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
  const { data: context, mutate: mutateContext } = useSWR(
    id ? ['conversation-context', id] : null,
    () => getConversationContext(id!),
    // 轻量轮询：中途打开的观察者在 turn 完成后也能看到完整历史
    { refreshInterval: 5_000 },
  )
  const socket = useConversationSocket(id)
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [images, setImages] = useState<PendingImage[]>([])
  const [initialSent, setInitialSent] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const isWriter = socket.state.isWriter
  const uncertain = socket.state.lockState === 'uncertain'
  const busyByOther = socket.state.lockState === 'running' && !isWriter
  const canSend = isWriter && !uncertain && socket.status === 'open'

  // guid 跳转携带的首条消息：WS 就绪后（可选切模型）自动发送
  useEffect(() => {
    if (!id || initialSent || socket.status !== 'open' || !initial?.initialMessage) return
    setInitialSent(true)
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
      void mutateContext()
    }
    prevLockRef.current = socket.state.lockState
  }, [socket.state.lockState, mutateContext])

  function handleSend(): void {
    const trimmed = text.trim()
    if (!trimmed || !canSend) return
    socket.appendLocalUser(trimmed, images)
    socket.send(trimmed, images)
    setText('')
    setImages([])
  }

  async function handleTerminate(): Promise<void> {
    if (!id) return
    try {
      await terminateConversation(id)
      ArcoMessage.success('会话已终止')
      void navigate('/guid')
    } catch {
      ArcoMessage.error('终止失败，请重试')
    }
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
      {/* Header（h-9 bg-1） */}
      <div className='h-9 flex items-center justify-between p-4 gap-4 !bg-1 chat-layout-header overflow-hidden shrink-0'>
        <div className='shrink-0 text-14px font-600 text-foreground truncate'>
          {context?.customTitle ?? `会话 ${id?.slice(0, 8) ?? ''}`}
        </div>
        <div className='flex items-center gap-3 shrink-0'>
          {uncertain ? (
            <span className='text-12px text-warning'>状态不确定（写入端中断）</span>
          ) : busyByOther ? (
            <span className='text-12px text-secondary'>只读（另一设备正在输入）</span>
          ) : null}
          <Button size='mini' status='danger' type='text' onClick={() => void handleTerminate()}>
            终止会话
          </Button>
        </div>
      </div>

      {uncertain ? (
        <div className='shrink-0 bg-[var(--warning-soft)] text-13px text-foreground px-4 py-2 border-b border-[var(--warning-line)]'>
          该会话写入端意外中断，已转为只读。可终止会话或新建会话继续。
        </div>
      ) : null}

      {/* 消息区（px-20px + max-w-800px 居中） */}
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
            {/* 实时流 */}
            {socket.state.messages.map((msg) => {
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
            {socket.state.messages.length === 0 && (context?.messages ?? []).length === 0 ? (
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
            <Input.TextArea
              aria-label='消息输入框'
              autoSize={{ minRows: 2, maxRows: 5 }}
              value={text}
              onChange={setText}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={canSend ? '发送消息…' : uncertain ? '会话状态不确定（只读）' : busyByOther ? '只读观察模式' : '连接中…'}
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
              </div>
              <Button
                shape='circle'
                type='primary'
                disabled={!canSend || !text.trim()}
                icon={<ArrowUp size={16} color='#fff' />}
                onClick={handleSend}
                aria-label='发送'
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
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
          <div className='text-14px whitespace-pre-wrap break-words'>{extractText()}</div>
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
