import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

/**
 * 上游 Moss WS 连接（计划 3.5）：
 * - Moss 返回的 ws_url 不直接信任：pathname 必须是 /ws/sessions/:expectedSessionId，
 *   scheme/host 必须等于配置 moss.wsBaseUrl；拒绝 query credentials 与 session mismatch。
 * - 连接时由 Node 端设置 Authorization header（浏览器无法设置）。
 * - 上游无心跳（基线事实）；断线语义 = detach，由协调器决定是否重连（仅 idle）。
 */

export class MossWsValidationError extends Error {}

export function validateMossWsUrl(
  wsUrl: string,
  expectedSessionId: string,
  configuredWsBaseUrl: string,
): URL {
  let url: URL
  try {
    url = new URL(wsUrl)
  } catch {
    throw new MossWsValidationError(`invalid ws_url from moss`)
  }
  const configured = new URL(configuredWsBaseUrl)
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new MossWsValidationError(`ws_url scheme must be ws/wss`)
  }
  if (url.host !== configured.host) {
    throw new MossWsValidationError(
      `ws_url host ${url.host} does not match configured moss.wsBaseUrl host ${configured.host}`,
    )
  }
  const expectedPath = `/ws/sessions/${expectedSessionId}`
  if (decodeURIComponent(url.pathname) !== expectedPath) {
    throw new MossWsValidationError(
      `ws_url pathname ${url.pathname} does not match ${expectedPath}`,
    )
  }
  if ([...url.searchParams.keys()].length > 0) {
    throw new MossWsValidationError(`ws_url must not carry query credentials`)
  }
  return url
}

export interface MossUpstreamHandlers {
  onEvent(event: unknown): void
  onClose(code: number, reason: string): void
  onError(err: Error): void
}

export class MossUpstreamSocket {
  private ws: WebSocket
  private closed = false
  private suppressOnClose = false

  constructor(
    wsUrl: string,
    accessToken: string,
    expectedSessionId: string,
    configuredWsBaseUrl: string,
    handlers: MossUpstreamHandlers,
  ) {
    const url = validateMossWsUrl(wsUrl, expectedSessionId, configuredWsBaseUrl)
    this.ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      handshakeTimeout: 15_000,
    })

    this.ws.on('message', (data) => {
      const text = data.toString('utf8')
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        // 上游出现非 JSON 帧（基线协议为每帧一个 JSON 对象）；丢弃
        return
      }
      if (parsed && typeof parsed === 'object') {
        handlers.onEvent(parsed)
      }
    })
    this.ws.on('close', (code, reason) => {
      this.closed = true
      // suppressOnClose：接管方主动关闭旧连接时不视为异常断开（避免协调器误转 uncertain）
      if (!this.suppressOnClose) handlers.onClose(code, reason.toString('utf8'))
    })
    this.ws.on('error', (err) => handlers.onError(err))
    this.ws.on('open', () => {
      // 上游连接成功；hello 事件会作为首帧返回
    })
  }

  get isClosed(): boolean {
    return this.closed
  }

  private openPromise: Promise<void> | null = null

  /** 等待握手完成（发送前必须等待，否则消息会因 readyState=CONNECTING 丢失）。 */
  whenOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve()
    if (!this.openPromise) {
      this.openPromise = new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          this.ws.off('open', onOpen)
          this.ws.off('error', onFail)
          this.ws.off('close', onClose)
        }
        const onOpen = (): void => {
          cleanup()
          resolve()
        }
        const onFail = (err: Error): void => {
          cleanup()
          this.closed = true
          reject(err)
        }
        const onClose = (code: number): void => onFail(new Error(`upstream closed during handshake (${code})`))
        this.ws.once('open', onOpen)
        this.ws.once('error', onFail)
        this.ws.once('close', onClose)
      })
    }
    return this.openPromise
  }

  send(obj: unknown): boolean {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }
    this.ws.send(JSON.stringify(obj))
    return true
  }

  close(suppressOnClose = false): void {
    if (!this.closed) {
      this.closed = true
      this.suppressOnClose = suppressOnClose
      try {
        this.ws.close()
      } catch {
        // ignore
      }
    }
  }
}

// ---------- 浏览器 ⇄ Moss 协议转换（纯函数，便于单测） ----------

export interface OutgoingUserMessage {
  sessionId: string
  text: string
  images: { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }[]
  parentToolUseId: string | null
}

export function buildUserMessage(msg: OutgoingUserMessage): Record<string, unknown> {
  // Image blocks precede the text so the agent treats them as vision input,
  // matching the desktop vision fix (inline image attachments as vision blocks).
  // Text-first would risk the model hallucinating instead of analysing the image.
  const content: Record<string, unknown>[] = []
  for (const img of msg.images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    })
  }
  content.push({ type: 'text', text: msg.text })
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: msg.parentToolUseId,
    session_id: msg.sessionId,
    uuid: randomUUID(),
  }
}

export function buildAnswerQuestionMessage(
  sessionId: string,
  parentToolUseId: string,
  text: string,
): Record<string, unknown> {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: parentToolUseId,
    session_id: sessionId,
    uuid: randomUUID(),
  }
}

export function buildSetModelMessage(modelId: string): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: randomUUID(),
    request: { subtype: 'set_model', model_id: modelId },
  }
}

/** 停止当前回复（与 Sudowork MossWsConnection.sendInterruptAndWait 的消息形状一致；回执忽略） */
export function buildInterruptMessage(): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: randomUUID(),
    request: { subtype: 'interrupt' },
  }
}
