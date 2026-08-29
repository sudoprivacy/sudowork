import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { Button, Message } from '@arco-design/web-react'
import { getConversationContext, terminateConversation } from './conversationApi'
import { MessageList } from './MessageList'
import { SendBox, type PendingImage } from './SendBox'
import { useConversationSocket } from './useConversationSocket'

/**
 * 远程会话页（计划 Task 5）：
 * - 历史来自 context；实时输出经 WebUI WS 订阅
 * - 只有 writer 可发送/回答；uncertain 提示终止或新建
 */
export function ConversationPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: context } = useSWR(id ? ['conversation-context', id] : null, () =>
    getConversationContext(id!),
  )
  const socket = useConversationSocket(id)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // 历史消息在 WS 首条事件前注入（简化：只注入一次）
  useEffect(() => {
    if (context && !historyLoaded) {
      setHistoryLoaded(true)
    }
  }, [context, historyLoaded])

  const historyMessages = context?.messages ?? []
  const isWriter = socket.state.isWriter
  const uncertain = socket.state.lockState === 'uncertain'
  const busyByOther = socket.state.lockState === 'running' && !isWriter
  const canSend = isWriter && !uncertain && socket.status === 'open'

  async function handleTerminate(): Promise<void> {
    if (!id) return
    try {
      await terminateConversation(id)
      Message.success('会话已终止')
      void navigate('/guid')
    } catch {
      Message.error('终止失败，请重试')
    }
  }

  function handleSend(text: string, images: PendingImage[]): void {
    socket.appendLocalUser(text, images)
    socket.send(text, images)
  }

  return (
    <div className='size-full flex flex-col min-h-0' data-testid='conversation-page'>
      <div className='shrink-0 h-12 border-b border-light flex items-center justify-between px-4'>
        <div className='text-14px font-600 text-foreground truncate'>
          {context?.customTitle ?? `会话 ${id?.slice(0, 8) ?? ''}`}
        </div>
        <div className='flex items-center gap-2'>
          {uncertain ? (
            <span className='text-12px text-warning'>状态不确定（写入端中断）</span>
          ) : busyByOther ? (
            <span className='text-12px text-secondary'>只读（另一设备正在输入）</span>
          ) : null}
          <Button size='mini' status='danger' onClick={() => void handleTerminate()}>
            终止会话
          </Button>
        </div>
      </div>

      {uncertain ? (
        <div className='shrink-0 bg-[var(--warning-soft)] text-13px text-foreground px-4 py-2 border-b border-[var(--warning-line)]'>
          该会话写入端意外中断，已转为只读。可终止会话或新建会话继续。
        </div>
      ) : null}

      {historyLoaded && historyMessages.length > 0 ? (
        <HistoryBlock messages={historyMessages} />
      ) : null}

      <MessageList
        messages={socket.state.messages}
        canAnswer={canSend}
        onAnswer={(questionId, text) => {
          socket.answerQuestion(questionId, text)
        }}
      />

      <SendBox
        disabled={!canSend}
        disabledReason={uncertain ? '会话状态不确定' : busyByOther ? '只读观察模式' : '连接中…'}
        onSend={handleSend}
      />
    </div>
  )
}

/** 历史消息只读渲染（与实时流并列，不参与聚合）。 */
function HistoryBlock({ messages }: { messages: Record<string, unknown>[] }): React.ReactElement {
  return (
    <div className='shrink-0 max-h-64 overflow-y-auto border-b border-light bg-faint px-4 py-2 flex flex-col gap-1.5' data-testid='history-block'>
      <div className='text-12px text-tertiary'>历史消息（{messages.length}）</div>
      {messages.map((msg, i) => {
        const type = String(msg.type ?? '')
        if (type === 'user') {
          const content = msg.content
          const text =
            typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? content.map((b) => (typeof b === 'object' && b && 'text' in b ? String((b as { text?: string }).text ?? '') : '')).join('')
                : ''
          return (
            <div key={i} className='self-end max-w-[70%] rd-2 bg-emphasis px-3 py-1.5 text-13px text-foreground'>
              {text}
            </div>
          )
        }
        if (type === 'assistant') {
          const content = msg.content
          const text = Array.isArray(content)
            ? content.map((b) => (typeof b === 'object' && b && 'text' in b ? String((b as { text?: string }).text ?? '') : '')).join('')
            : ''
          return (
            <div key={i} className='self-start max-w-[85%] rd-2 bg-base border border-tiny px-3 py-1.5 text-13px'>
              {text}
            </div>
          )
        }
        if (type === 'tool_use') {
          return (
            <div key={i} className='self-start text-12px text-tertiary'>
              🛠 {String(msg.name ?? 'tool')}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
