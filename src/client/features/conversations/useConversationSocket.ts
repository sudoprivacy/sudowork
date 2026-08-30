import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ServerInboundEvent } from '@shared/contracts/conversations'

/**
 * 浏览器 ⇄ WebUI 会话 WS。
 * 上游事件聚合为消息流（纯函数 reducer，便于单测）：
 * - assistant(delta:true) 按 uuid 聚合追加
 * - tool_use 生成工具消息（AskUserQuestion 单独建模，等待回答）；
 *   turn 结束时上游会对每个 toolCallId 再发一条 status:'completed' 的 tool_use（uuid=tool_use_id，
 *   不落库，acpBridge 基线行为）——按 toolUseId 更新已有消息而非追加，保证流侧单条
 * - result 结束当前 turn（并复位 isStopping）
 * - system/model_changed 更新当前模型
 */

export type ChatMessage =
  | { kind: 'user'; id: string; text: string; images?: { mediaType: string; data: string }[] }
  | { kind: 'assistant'; id: string; text: string; done: boolean }
  | { kind: 'tool'; id: string; toolUseId?: string; name: string; input: string; status?: string }
  | { kind: 'question'; id: string; title: string; description?: string; answered: boolean }

export interface ConversationStreamState {
  messages: ChatMessage[]
  lockState: 'idle' | 'running' | 'uncertain' | null
  isWriter: boolean
  lastError: string | null
  /** 发出 stop 后置位；收到 result / lock idle 复位（另在 hook 内超时兜底） */
  isStopping: boolean
  /** 最近一次 system/model_changed 的模型标识（上游带 proxy/ 前缀） */
  currentModel: string | null
}

export const initialStreamState: ConversationStreamState = {
  messages: [],
  lockState: null,
  isWriter: false,
  lastError: null,
  isStopping: false,
  currentModel: null,
}

interface UpstreamEvent {
  type?: string
  subtype?: string
  message?: { content?: { type?: string; text?: string }[] }
  uuid?: string
  name?: string
  input?: string
  status?: string
  tool_use_id?: string
  model?: string
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
      if (inbound.state === 'idle' && state.isStopping) {
        return { ...state, lockState: inbound.state, isStopping: false }
      }
      return { ...state, lockState: inbound.state }
    case 'writer':
      return { ...state, isWriter: inbound.isWriter }
    case 'error':
      // 抢占失败：复位乐观 isWriter，随后的 lock:running + writer:false 会落入只读观察
      if (inbound.code === 'CONVERSATION_BUSY') {
        return { ...state, lastError: inbound.code, isWriter: false }
      }
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
        // completed 事件（uuid=原始事件的 tool_use_id，无 input，不落库）：更新已有消息状态
        if (event.status === 'completed' && event.uuid) {
          const target = state.messages.find(
            (m) => m.kind === 'tool' && m.toolUseId === event.uuid,
          )
          if (target) {
            return {
              ...state,
              messages: state.messages.map((m) => (m === target ? { ...m, status: 'completed' } : m)),
            }
          }
          return state
        }
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
            {
              kind: 'tool',
              id: uuid,
              toolUseId: event.tool_use_id,
              name,
              input: event.input ?? '',
              status: event.status,
            },
          ],
        }
      }
      if (type === 'result') {
        return {
          ...state,
          isStopping: false,
          messages: state.messages.map((m) =>
            m.kind === 'assistant' && !m.done ? { ...m, done: true } : m,
          ),
        }
      }
      if (type === 'system' && event.subtype === 'model_changed') {
        return { ...state, currentModel: event.model ?? state.currentModel }
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
  /** 停止当前回复（转发上游 interrupt）；isStopping 由 reducer 在 result/lock idle 复位 */
  stop: () => void
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
      // 先解绑 handlers 再 close：StrictMode 双挂载下 ws1 迟到的 open/close 事件
      // 不应再污染 status 或触发误发送（close 后事件仍可能异步到达）
      ws.onopen = null
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
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

  const stop = useCallback((): void => {
    rawSend({ kind: 'stop' })
    setState((prev) => ({ ...prev, isStopping: true }))
    // 兜底：上游异常未回 result/lock idle 时按钮不能永久禁用
    setTimeout(() => {
      setState((prev) => ({ ...prev, isStopping: prev.isStopping ? false : prev.isStopping }))
    }, 15_000)
  }, [rawSend])

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
    () => ({ status, state, send, answerQuestion, setModel, stop, appendLocalUser }),
    [status, state, send, answerQuestion, setModel, stop, appendLocalUser],
  )
}
