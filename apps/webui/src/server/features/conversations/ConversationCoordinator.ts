import type { Pool } from 'pg'
import type WebSocket from 'ws'
import type { AppConfig } from '../../config.js'
import type { AuthDeps } from '../auth/authService.js'
import { getMossContext } from '../auth/authService.js'
import type { WebSessionRow } from '../auth/sessionRepository.js'
import type { MossSessionPort } from '@sudowork/moss-client'
import { MossHttpError, MossNetworkError, deriveWsBaseUrl } from '@sudowork/moss-client'
import {
  MossUpstreamSocket,
  buildAnswerQuestionMessage,
  buildInterruptMessage,
  buildSetModelMessage,
  buildUserMessage,
} from '@sudowork/moss-client'
import {
  UPSTREAM_EVENT_TYPES,
  ClientOutboundMessageSchema,
  type ServerInboundEvent,
} from '@sudowork/contracts/conversations'
import {
  acquireWriteLock,
  clearWriterIfIdle,
  deleteLock,
  getLock,
  markUncertain,
  releaseToIdle,
  releaseToIdleIfHeld,
} from './lockRepository.js'
import { upsertConversationModel } from './conversationMetaRepository.js'

/**
 * 会话协调器（计划 3.3/3.8）：
 * - 每个 principalId + mossSessionId 一条上游 Moss WS；多个浏览器可订阅，仅一个 writer
 * - writer 首次发送才以自己的 token resume 并建立上游 WS；idle 才允许 writer/token 切换
 * - 上游事件白名单转发；result → idle；running 期间断线（writer 或上游）→ uncertain
 */

export interface BrowserConnection {
  ws: WebSocket
  webSession: WebSessionRow
  principalId: string
  mossSessionId: string
}

interface Entry {
  principalId: string
  mossSessionId: string
  subscribers: Set<BrowserConnection>
  upstream: MossUpstreamSocket | null
  upstreamOwnerWebSessionId: string | null
}

export interface CoordinatorDeps {
  pool: Pool
  config: AppConfig
  auth: AuthDeps
  moss: MossSessionPort
}

export class ConversationCoordinator {
  private entries = new Map<string, Entry>()

  constructor(private deps: CoordinatorDeps) {}

  private key(principalId: string, mossSessionId: string): string {
    return `${principalId}:${mossSessionId}`
  }

  private entryFor(principalId: string, mossSessionId: string): Entry {
    const k = this.key(principalId, mossSessionId)
    let entry = this.entries.get(k)
    if (!entry) {
      entry = {
        principalId,
        mossSessionId,
        subscribers: new Set(),
        upstream: null,
        upstreamOwnerWebSessionId: null,
      }
      this.entries.set(k, entry)
    }
    return entry
  }

  private sendTo(ws: WebSocket, event: ServerInboundEvent): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(event))
    }
  }

  private broadcast(entry: Entry, event: ServerInboundEvent): void {
    for (const conn of entry.subscribers) {
      this.sendTo(conn.ws, event)
    }
  }

  private async broadcastLockState(entry: Entry): Promise<void> {
    const lock = await getLock(this.deps.pool, {
      principalId: entry.principalId,
      mossSessionId: entry.mossSessionId,
    })
    if (!lock) {
      this.broadcast(entry, { kind: 'lock', state: 'idle' })
      for (const conn of entry.subscribers) {
        this.sendTo(conn.ws, { kind: 'writer', isWriter: true })
      }
      return
    }
    this.broadcast(entry, { kind: 'lock', state: lock.state })
    for (const conn of entry.subscribers) {
      this.sendTo(
        conn.ws,
        {
          kind: 'writer',
          // idle（无进行中回合）乐观可写，首个发送者经 acquireWriteLock 的 idle 抢占成为 writer；
          // running 仅 holder 可写；uncertain 恒只读
          isWriter: lock.state === 'idle' || lock.writerWebSessionId === conn.webSession.id,
        },
      )
    }
  }

  subscribe(conn: BrowserConnection): void {
    const entry = this.entryFor(conn.principalId, conn.mossSessionId)
    entry.subscribers.add(conn)
    // 不发 WebUI 自制 hello；上游 hello 事件会作为首帧转发
    void this.broadcastLockState(entry)
  }

  async unsubscribe(conn: BrowserConnection): Promise<void> {
    const k = this.key(conn.principalId, conn.mossSessionId)
    const entry = this.entries.get(k)
    if (!entry) return
    entry.subscribers.delete(conn)

    const lock = await getLock(this.deps.pool, {
      principalId: conn.principalId,
      mossSessionId: conn.mossSessionId,
    })
    const isWriter = lock?.writerWebSessionId === conn.webSession.id

    if (isWriter && lock) {
      if (lock.state === 'running') {
        // running 断线：uncertain；上游保留让 observer 看到 result（不自动重发）
        await markUncertain(this.deps.pool, {
          principalId: conn.principalId,
          mossSessionId: conn.mossSessionId,
          webSessionId: conn.webSession.id,
        })
      } else {
        await clearWriterIfIdle(this.deps.pool, {
          principalId: conn.principalId,
          mossSessionId: conn.mossSessionId,
          webSessionId: conn.webSession.id,
        })
      }
    }

    if (entry.subscribers.size === 0) {
      // 无订阅者：上游在 idle 直接关闭；running/uncertain 保留到 turn 结束或 terminate
      const current = await getLock(this.deps.pool, {
        principalId: conn.principalId,
        mossSessionId: conn.mossSessionId,
      })
      if (!current || current.state === 'idle') {
        entry.upstream?.close()
        this.entries.delete(k)
      } else {
        // 保留 entry 供 result 到达时收尾；result 处理器会在 idle 后清理
        entry.upstream?.close()
      }
    }

    await this.broadcastLockState(entry)
  }

  /** writer 首次写入时以其 token resume 并建立上游 WS。 */
  private async ensureUpstream(entry: Entry, conn: BrowserConnection): Promise<void> {
    if (entry.upstream && !entry.upstream.isClosed) {
      if (entry.upstreamOwnerWebSessionId !== conn.webSession.id) {
        // 仅当前锁持有者可接管旧上游重建（send 路径 acquire 后 writer=conn；
        // set_model/stop 路径调用前已校验 writer）。抑制 onClose：接管关闭不应
        // 触发 handleUpstreamClose 把新 writer 刚置的 running 误转 uncertain
        const lock = await getLock(this.deps.pool, {
          principalId: entry.principalId,
          mossSessionId: entry.mossSessionId,
        })
        if (lock?.writerWebSessionId !== conn.webSession.id) {
          throw new Error('UPSTREAM_OWNER_MISMATCH')
        }
        entry.upstream.close(true)
        entry.upstream = null
      } else {
        return
      }
    }

    const ctx = await getMossContext(this.deps.auth, conn.webSession)
    const resumed = await this.deps.moss.resume(ctx, entry.mossSessionId).catch((err: unknown) => {
      if (err instanceof MossHttpError && err.status === 404) {
        throw new Error('SESSION_NOT_FOUND')
      }
      if (err instanceof MossNetworkError) {
        throw new Error('MOSS_UNAVAILABLE')
      }
      throw err
    })

    entry.upstream = new MossUpstreamSocket(
      resumed.wsUrl,
      ctx.accessToken,
      entry.mossSessionId,
      // WS 校验基准用会话生效地址（自定义 moss 会话的 ws 在其自定义 host）
      deriveWsBaseUrl(ctx.baseUrl),
      {
        onEvent: (event) => void this.handleUpstreamEvent(entry, event),
        onClose: () => void this.handleUpstreamClose(entry),
        onError: (err) => {
          console.warn(
            `[coordinator] upstream ws error (principal=${entry.principalId.slice(0, 8)} session=${entry.mossSessionId.slice(0, 8)}): ${err.message}`,
          )
        },
      },
    )
    entry.upstreamOwnerWebSessionId = conn.webSession.id
    await entry.upstream.whenOpen()
  }

  private async handleUpstreamEvent(entry: Entry, event: unknown): Promise<void> {
    const type = (event as { type?: unknown })?.type
    if (typeof type !== 'string' || !UPSTREAM_EVENT_TYPES.has(type)) {
      return // 白名单外事件不透传
    }
    this.broadcast(entry, { kind: 'upstream', event })

    // 会话内切模型：本地持久化（重开会话时回读显示）。失败隔离：写库失败不影响事件转发
    // （对齐 generateTitleIfMissing 吞错模式）。上游 model 带 proxy/ 前缀，剥离后落库。
    if (type === 'system') {
      const subtype = (event as { subtype?: unknown }).subtype
      const model = (event as { model?: unknown }).model
      if (subtype === 'model_changed' && typeof model === 'string' && model) {
        await upsertConversationModel(
          this.deps.pool,
          entry.principalId,
          entry.mossSessionId,
          model.replace(/^proxy\//, ''),
        ).catch((err: unknown) =>
          console.warn(
            `[coordinator] persist model failed (session=${entry.mossSessionId.slice(0, 8)}): ${(err as Error).message}`,
          ),
        )
      }
    }

    if (type === 'result') {
      await releaseToIdle(this.deps.pool, {
        principalId: entry.principalId,
        mossSessionId: entry.mossSessionId,
      })
      await this.broadcastLockState(entry)
    }
  }

  private async handleUpstreamClose(entry: Entry): Promise<void> {
    const lock = await getLock(this.deps.pool, {
      principalId: entry.principalId,
      mossSessionId: entry.mossSessionId,
    })
    if (lock?.state === 'running') {
      // 上游在 running 断开：无法收到 result，保守转 uncertain（计划 3.8）
      await this.deps.pool
        .query(
          `UPDATE conversation_locks SET state='uncertain', writer_web_session_id=NULL, updated_at=now()
           WHERE principal_id=$1 AND moss_session_id=$2 AND state='running'`,
          [entry.principalId, entry.mossSessionId],
        )
        .catch(() => {})
      await this.broadcastLockState(entry)
    }
    if (entry.upstream?.isClosed) {
      entry.upstream = null
      entry.upstreamOwnerWebSessionId = null
    }
  }

  async handleClientMessage(conn: BrowserConnection, raw: unknown): Promise<void> {
    const parsed = ClientOutboundMessageSchema.safeParse(raw)
    if (!parsed.success) {
      this.sendTo(conn.ws, { kind: 'error', code: 'INVALID_MESSAGE' })
      return
    }
    const msg = parsed.data
    const entry = this.entryFor(conn.principalId, conn.mossSessionId)

    try {
      if (msg.kind === 'send' || msg.kind === 'answer_question') {
        const acquired = await acquireWriteLock(this.deps.pool, {
          principalId: conn.principalId,
          mossSessionId: entry.mossSessionId,
          webSessionId: conn.webSession.id,
        })
        if (!acquired.ok) {
          const code = acquired.reason === 'UNCERTAIN' ? 'LOCK_UNCERTAIN' : 'CONVERSATION_BUSY'
          this.sendTo(conn.ws, { kind: 'error', code })
          return
        }
        await this.broadcastLockState(entry)

        await this.ensureUpstream(entry, conn)
        const payload =
          msg.kind === 'send'
            ? buildUserMessage({
                sessionId: entry.mossSessionId,
                text: msg.text,
                images: msg.images,
                parentToolUseId: null,
              })
            : buildAnswerQuestionMessage(entry.mossSessionId, msg.parentToolUseId, msg.text)

        if (!entry.upstream?.send(payload)) {
          this.sendTo(conn.ws, { kind: 'error', code: 'UPSTREAM_NOT_CONNECTED' })
        }
        return
      }

      if (msg.kind === 'set_model') {
        const lock = await getLock(this.deps.pool, {
          principalId: conn.principalId,
          mossSessionId: entry.mossSessionId,
        })
        if (lock?.state === 'uncertain') {
          this.sendTo(conn.ws, { kind: 'error', code: 'LOCK_UNCERTAIN' })
          return
        }
        // 有进行中回合且 writer 是他人：拒绝（不打断对方回合）
        if (lock?.state === 'running' && lock.writerWebSessionId !== conn.webSession.id) {
          this.sendTo(conn.ws, { kind: 'error', code: 'CONVERSATION_BUSY' })
          return
        }
        // idle 期任意订阅者可切模型：非 writer 先经 idle 抢占成为 writer，切完守卫回收
        const isWriter = lock?.writerWebSessionId === conn.webSession.id
        if (!isWriter) {
          const acquired = await acquireWriteLock(this.deps.pool, {
            principalId: conn.principalId,
            mossSessionId: entry.mossSessionId,
            webSessionId: conn.webSession.id,
          })
          if (!acquired.ok) {
            const code = acquired.reason === 'UNCERTAIN' ? 'LOCK_UNCERTAIN' : 'CONVERSATION_BUSY'
            this.sendTo(conn.ws, { kind: 'error', code })
            return
          }
        }
        try {
          if (!isWriter) await this.broadcastLockState(entry)
          await this.ensureUpstream(entry, conn)
          if (!entry.upstream?.send(buildSetModelMessage(msg.modelId))) {
            this.sendTo(conn.ws, { kind: 'error', code: 'UPSTREAM_NOT_CONNECTED' })
          }
        } finally {
          if (!isWriter) {
            const released = await releaseToIdleIfHeld(this.deps.pool, {
              principalId: conn.principalId,
              mossSessionId: entry.mossSessionId,
              webSessionId: conn.webSession.id,
            })
            if (released) {
              await this.broadcastLockState(entry).catch((err: unknown) =>
                console.warn(`[coordinator] broadcast after set_model release failed: ${(err as Error).message}`),
              )
            }
          }
        }
      }

      if (msg.kind === 'stop') {
        const lock = await getLock(this.deps.pool, {
          principalId: conn.principalId,
          mossSessionId: entry.mossSessionId,
        })
        if (lock?.writerWebSessionId !== conn.webSession.id) {
          this.sendTo(conn.ws, { kind: 'error', code: 'NOT_WRITER' })
          return
        }
        await this.ensureUpstream(entry, conn)
        if (!entry.upstream?.send(buildInterruptMessage())) {
          this.sendTo(conn.ws, { kind: 'error', code: 'UPSTREAM_NOT_CONNECTED' })
        }
      }
    } catch (err) {
      const code =
        err instanceof Error && ['SESSION_NOT_FOUND', 'MOSS_UNAVAILABLE', 'UPSTREAM_OWNER_MISMATCH'].includes(err.message)
          ? err.message
          : 'UPSTREAM_FAILED'
      this.sendTo(conn.ws, { kind: 'error', code })
    }
  }

  /** REST terminate 成功后调用：关闭上游、清锁、通知订阅者。 */
  async terminate(principalId: string, mossSessionId: string): Promise<void> {
    const k = this.key(principalId, mossSessionId)
    const entry = this.entries.get(k)
    if (entry) {
      entry.upstream?.close()
      const notify = [...entry.subscribers]
      this.entries.delete(k)
      for (const conn of notify) {
        this.sendTo(conn.ws, { kind: 'error', code: 'SESSION_TERMINATED' })
      }
    }
    await deleteLock(this.deps.pool, { principalId, mossSessionId })
  }

  /** 服务启动恢复：遗留 running → uncertain（计划 2.1）。 */
  async startupRecovery(pool: Pool): Promise<void> {
    const { rowCount } = await pool.query(
      `UPDATE conversation_locks SET state='uncertain', writer_web_session_id=NULL, updated_at=now()
       WHERE state='running'`,
    )
    if (rowCount && rowCount > 0) {
      console.warn(`[coordinator] startup: ${rowCount} running lock(s) marked uncertain`)
    }
  }
}
