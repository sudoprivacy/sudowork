import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ServerInboundEvent } from '@shared/contracts/conversations'

/**
 * 浏览器 ⇄ WebUI 会话 WS。
 * 上游事件聚合为消息流（纯函数 reducer，便于单测）：
 * - assistant(delta:true) 按 uuid 聚合追加
 * - tool_use 生成工具消息（AskUserQuestion 单独建模，等待回答）
 * - result 结束当前 turn
 */

export type ChatMessage =
  | { kind: 'user'; id: string; text: string; images?: { mediaType: string; data: string }[] }
  | { kind: 'assistant'; id: string; text: string; done: boolean }
  | { kind: 'tool'; id: string; name: string; input: string; status?: string }
  | { kind: 'question'; id: string; title: string; description?: string; answered: boolean }

export interface ConversationStreamState {
  messages: ChatMessage[]
  lockState: 'idle' | 'running' | 'uncertain' | null
  isWriter: boolean
  lastError: string | null
}

export const initialStreamState: ConversationStreamState = {
  messages: [],
  lockState: null,
  isWriter: false,
  lastError: null,
}

interface UpstreamEvent {
  type?: string
  message?: { content?: { type?: string; text?: string }[] }
  uuid?: string
  name?: string
  input?: string
  status?: string
}

function parseAskUserQuestion(input: string): { title: string; description?: string } | null {
  try {
    const parsed = JSON.parse(input) as { title?: string; description?: string }
    if (typeof parsed.title === 'string') {
      return { title: parsed.title, description: parsed.description }
    }
    return null
  } catch {
    return null
  }
}

export function reduceStreamEvent(
  state: ConversationStreamState,
  inbound: ServerInboundEvent,
): ConversationStreamState {
  switch (inbound.kind) {
    case 'lock':
      return { ...state, lockState: inbound.state }
    case 'writer':
      return { ...state, isWriter: inbound.isWriter }
    case 'error':
      return { ...state, lastError: inbound.code }
    case 'upstream': {
      const event = inbound.event as UpstreamEvent
      const type = event?.type
      if (type === 'assistant') {
        const uuid = event.uuid ?? 'unknown'
        const text =
          event.message?.content
            ?.filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join('') ?? ''
        const existing = state.messages.find((m) => m.kind === 'assistant' && m.id === uuid)
        if (existing && existing.kind === 'assistant') {
          return {
            ...state,
            messages: state.messages.map((m) =>
              m.kind === 'assistant' && m.id === uuid ? { ...m, text: m.text + text } : m,
            ),
          }
        }
        return {
          ...state,
          messages: [...state.messages, { kind: 'assistant', id: uuid, text, done: false }],
        }
      }
      if (type === 'tool_use') {
        const uuid = event.uuid ?? `tool-${state.messages.length}`
        const name = event.name ?? 'tool'
        if (name === 'AskUserQuestion') {
          const q = parseAskUserQuestion(event.input ?? '')
          if (q) {
            return {
              ...state,
              messages: [
                ...state.messages,
                { kind: 'question', id: uuid, title: q.title, description: q.description, answered: false },
              ],
            }
          }
        }
        return {
          ...state,
          messages: [
            ...state.messages,
            { kind: 'tool', id: uuid, name, input: event.input ?? '', status: event.status },
          ],
        }
      }
      if (type === 'result') {
        return {
          ...state,
          messages: state.messages.map((m) =>
            m.kind === 'assistant' && !m.done ? { ...m, done: true } : m,
          ),
        }
      }
      return state
    }
    default:
      return state
  }
}

export interface ConversationSocket {
  status: 'connecting' | 'open' | 'closed'
  state: ConversationStreamState
  send: (text: string, images?: { mediaType: string; data: string }[]) => void
  answerQuestion: (parentToolUseId: string, text: string) => void
  setModel: (modelId: string) => void
  appendLocalUser: (text: string, images?: { mediaType: string; data: string }[]) => void
}

export function useConversationSocket(conversationId: string | undefined): ConversationSocket {
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [state, setState] = useState<ConversationStreamState>(initialStreamState)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!conversationId) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/conversations/${conversationId}`)
    wsRef.current = ws
    setStatus('connecting')

    ws.onopen = () => setStatus('open')
    ws.onclose = () => setStatus('closed')
    ws.onerror = () => setStatus('closed')
    ws.onmessage = (msg) => {
      try {
        const inbound = JSON.parse(msg.data as string) as ServerInboundEvent
        setState((prev) => reduceStreamEvent(prev, inbound))
      } catch {
        // ignore
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [conversationId])

  const rawSend = useCallback((payload: unknown): void => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
    }
  }, [])

  const send = useCallback(
    (text: string, images: { mediaType: string; data: string }[] = []): void => {
      rawSend({ kind: 'send', text, images })
    },
    [rawSend],
  )

  const answerQuestion = useCallback(
    (parentToolUseId: string, text: string): void => {
      rawSend({ kind: 'answer_question', parentToolUseId, text })
    },
    [rawSend],
  )

  const setModel = useCallback(
    (modelId: string): void => {
      rawSend({ kind: 'set_model', modelId })
    },
    [rawSend],
  )

  const appendLocalUser = useCallback(
    (text: string, images?: { mediaType: string; data: string }[]): void => {
      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { kind: 'user', id: `local-${Date.now()}`, text, images },
        ],
      }))
    },
    [],
  )

  return useMemo(
    () => ({ status, state, send, answerQuestion, setModel, appendLocalUser }),
    [status, state, send, answerQuestion, setModel, appendLocalUser],
  )
}
