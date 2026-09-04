import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ServerInboundEvent } from '@sudowork/contracts/conversations'

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
  /** hydrateModel 最近写入的值（重开会话回读种子） */
  hydratedModel: string | null
  /** 发出 set_model 待确认的目标模型（裸 id）；model_changed 到达 / 白名单 error / 15s 超时清空 */
  modelSwitchPending: string | null
  /** 模型切换失败错误 code（服务端白名单内 code 或本地 SET_MODEL_TIMEOUT） */
  modelSwitchError: string | null
}

function createInitialStreamState(initialModel: string | null = null): ConversationStreamState {
  return {
    messages: [],
    lockState: null,
    isWriter: false,
    lastError: null,
    isStopping: false,
    currentModel: initialModel,
    hydratedModel: null,
    modelSwitchPending: null,
    modelSwitchError: null,
  }
}

export const initialStreamState: ConversationStreamState = createInitialStreamState()

/** 服务端可归因为「模型切换失败」的 error code 白名单（其余 error 不置 modelSwitchError） */
export const MODEL_SWITCH_ERROR_CODES = new Set([
  'LOCK_UNCERTAIN',
  'CONVERSATION_BUSY',
  'UPSTREAM_NOT_CONNECTED',
  'UPSTREAM_FAILED',
  'UPSTREAM_OWNER_MISMATCH',
  'SESSION_NOT_FOUND',
  'MOSS_UNAVAILABLE',
])

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
    case 'error': {
      // 模型切换归因：有 pending 且 code 在白名单内 → 记为切换失败并清 pending
      const modelPatch =
        state.modelSwitchPending !== null && MODEL_SWITCH_ERROR_CODES.has(inbound.code)
          ? { modelSwitchError: inbound.code, modelSwitchPending: null }
          : {}
      // 抢占失败：复位乐观 isWriter，随后的 lock:running + writer:false 会落入只读观察
      if (inbound.code === 'CONVERSATION_BUSY') {
        return { ...state, lastError: inbound.code, isWriter: false, ...modelPatch }
      }
      return { ...state, lastError: inbound.code, ...modelPatch }
    }
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
        // model_changed 到达即确认：清 pending/error；hydratedModel 归零（已由真实 currentModel 取代）
        const confirmed = state.modelSwitchPending !== null
        return {
          ...state,
          currentModel: event.model ?? state.currentModel,
          hydratedModel: null,
          ...(confirmed ? { modelSwitchPending: null, modelSwitchError: null } : {}),
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
  /** 重开会话回读：用本地持久化的 modelId 种子化显示（不触发 set_model，仅显示，等 model_changed 覆盖） */
  hydrateModel: (modelId: string) => void
  /** 停止当前回复（转发上游 interrupt）；isStopping 由 reducer 在 result/lock idle 复位 */
  stop: () => void
  appendLocalUser: (text: string, images?: { mediaType: string; data: string }[]) => void
}

export function useConversationSocket(
  conversationId: string | undefined,
  initialModel: string | null = null,
): ConversationSocket {
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [state, setState] = useState<ConversationStreamState>(() => createInitialStreamState(initialModel))
  const modelSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // useLayoutEffect（非 useEffect）：会话切换的整体重置须在 paint 前 flush——passive effect
  // 在 paint 后运行，id 变化的首帧仍持旧会话 messages，会把上一会话消息泄漏渲染到新会话底部。
  useLayoutEffect(() => {
    if (!conversationId) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/conversations/${conversationId}`)
    wsRef.current = ws
    // 会话切换：整体重置（messages/lockState/isWriter/lastError/isStopping/模型态 不得跨会话继承——
    // lock/writer 由服务端连接即推重建，currentModel 由 initialModel 种子 + 后续 model_changed 回填）
    if (modelSwitchTimerRef.current) clearTimeout(modelSwitchTimerRef.current)
    setState(createInitialStreamState(initialModel))
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
      if (modelSwitchTimerRef.current) clearTimeout(modelSwitchTimerRef.current)
    }
  }, [conversationId, initialModel])

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

  const setModel = useCallback((modelId: string): void => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setState((prev) => ({ ...prev, modelSwitchError: 'UPSTREAM_NOT_CONNECTED', modelSwitchPending: null }))
      return
    }
    ws.send(JSON.stringify({ kind: 'set_model', modelId }))
    setState((prev) => ({ ...prev, modelSwitchPending: modelId, modelSwitchError: null }))
    if (modelSwitchTimerRef.current) clearTimeout(modelSwitchTimerRef.current)
    // 15s 未收到 model_changed / 白名单 error：本地判超时（避免 pending 永久转圈）
    modelSwitchTimerRef.current = setTimeout(() => {
      setState((prev) =>
        prev.modelSwitchPending === modelId
          ? { ...prev, modelSwitchPending: null, modelSwitchError: 'SET_MODEL_TIMEOUT' }
          : prev,
      )
    }, 15_000)
  }, [])

  const hydrateModel = useCallback((modelId: string): void => {
    // 重开会话回读：仅写显示种子（不发 set_model）；真实 model_changed 到达后 reducer 会清零
    setState((prev) => (prev.hydratedModel === modelId ? prev : { ...prev, hydratedModel: modelId }))
  }, [])

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
    () => ({ status, state, send, answerQuestion, setModel, hydrateModel, stop, appendLocalUser }),
    [status, state, send, answerQuestion, setModel, hydrateModel, stop, appendLocalUser],
  )
}
