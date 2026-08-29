import React, { useState } from 'react'
import type { ChatMessage } from './useConversationSocket'

export function MessageList({
  messages,
  canAnswer,
  onAnswer,
}: {
  messages: ChatMessage[]
  canAnswer: boolean
  onAnswer: (parentToolUseId: string, text: string) => void
}): React.ReactElement {
  return (
    <div className='flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3' data-testid='message-list'>
      {messages.length === 0 ? (
        <div className='text-13px text-tertiary f-center py-8'>发送第一条消息开始对话</div>
      ) : null}
      {messages.map((msg) => (
        <MessageItem key={msg.id} msg={msg} canAnswer={canAnswer} onAnswer={onAnswer} />
      ))}
    </div>
  )
}

function MessageItem({
  msg,
  canAnswer,
  onAnswer,
}: {
  msg: ChatMessage
  canAnswer: boolean
  onAnswer: (id: string, text: string) => void
}): React.ReactElement {
  if (msg.kind === 'user') {
    return (
      <div className='self-end max-w-[70%] rd-2 bg-[var(--ui-accent-orange)] text-white px-3 py-2 text-14px whitespace-pre-wrap break-words'>
        {msg.text}
      </div>
    )
  }
  if (msg.kind === 'assistant') {
    return (
      <div
        className='self-start max-w-[85%] rd-2 bg-subtle border border-tiny px-3 py-2 text-14px whitespace-pre-wrap break-words'
        data-testid='assistant-message'
      >
        {msg.text || '…'}
        {!msg.done ? <span className='animate-pulse'>▍</span> : null}
      </div>
    )
  }
  if (msg.kind === 'tool') {
    return (
      <div className='self-start rd-2 border border-light bg-faint px-3 py-1.5 text-12px text-secondary max-w-[85%] truncate'>
        🛠 {msg.name}
        {msg.status === 'completed' ? ' ✓' : ''}
      </div>
    )
  }
  return <QuestionCard key={msg.id} msg={msg} canAnswer={canAnswer} onAnswer={onAnswer} />
}

function QuestionCard({
  msg,
  canAnswer,
  onAnswer,
}: {
  msg: Extract<ChatMessage, { kind: 'question' }>
  canAnswer: boolean
  onAnswer: (id: string, text: string) => void
}): React.ReactElement {
  const [answer, setAnswer] = useState('')
  return (
    <div className='self-start rd-2 border border-[var(--warning-line)] bg-[var(--warning-soft)] px-3 py-2 max-w-[85%]' data-testid='question-card'>
      <div className='text-14px font-600 text-foreground'>❓ {msg.title}</div>
      {msg.description ? <div className='text-12px text-secondary mt-1'>{msg.description}</div> : null}
      {msg.answered ? (
        <div className='text-12px text-success mt-1'>已回答</div>
      ) : canAnswer ? (
        <div className='flex gap-2 mt-2'>
          <input
            className='flex-1 px-2 py-1 rd-1 border border-light text-13px bg-base'
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder='输入你的回答'
            aria-label='问题回答输入'
          />
          <button
            type='button'
            className='px-3 py-1 rd-1 bg-[var(--primary)] text-white text-13px'
            disabled={!answer.trim()}
            onClick={() => {
              onAnswer(msg.id, answer.trim())
              setAnswer('')
            }}
          >
            回答
          </button>
        </div>
      ) : (
        <div className='text-12px text-tertiary mt-1'>等待写入端回答…</div>
      )}
    </div>
  )
}
