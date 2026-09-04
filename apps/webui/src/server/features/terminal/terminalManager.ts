/**
 * 服务器端终端管理（对齐 Sudowork terminalBridge 的语义，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * - shell 选择对齐 Sudowork：win=%ComSpec%（默认 cmd.exe），其他=$SHELL（默认 /bin/bash）
 * - cwd：每会话独立的服务器临时目录（webui 服务器上没有会话工作区——Moss 会话工作区在 Moss 服务器上）
 * - 上限对齐 Sudowork：全局 50（terminalBridge GLOBAL_PTY_HARD_LIMIT）、每会话 10
 *   （TerminalPanel PER_CONV_TAB_LIMIT，Sudowork 在 renderer 层限制，此处在 manager 层实现同等值）
 * - 生命周期：关闭终端/WS 断开即销毁 pty；会话 DELETE 时关闭该会话全部 pty（对齐 closeByConversation）
 */
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pty from '@lydell/node-pty'

const GLOBAL_HARD_LIMIT = 50
const PER_CONVERSATION_LIMIT = 10

export interface TerminalSession {
  terminalId: string
  conversationId: string
  write(data: string): void
  resize(cols: number, rows: number): void
  dispose(): void
}

export class TerminalLimitError extends Error {
  constructor(public readonly reason: 'GLOBAL_LIMIT' | 'PER_CONVERSATION_LIMIT') {
    super(reason)
  }
}

function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.ComSpec ?? 'cmd.exe'
  }
  return process.env.SHELL ?? '/bin/bash'
}

export class TerminalManager {
  private terminals = new Map<string, TerminalSession>()

  create(conversationId: string, onOutput: (data: string) => void, onExit: () => void): TerminalSession {
    if (this.terminals.size >= GLOBAL_HARD_LIMIT) {
      throw new TerminalLimitError('GLOBAL_LIMIT')
    }
    let perConversation = 0
    for (const t of this.terminals.values()) {
      if (t.conversationId === conversationId) perConversation++
    }
    if (perConversation >= PER_CONVERSATION_LIMIT) {
      throw new TerminalLimitError('PER_CONVERSATION_LIMIT')
    }

    const terminalId = randomUUID()
    const cwd = join(tmpdir(), 'sudowork-webui-terminal', conversationId)
    try {
      mkdirSync(cwd, { recursive: true })
    } catch {
      // 目录创建失败时退回系统临时目录
    }
    const proc = pty.spawn(defaultShell(), [], {
      name: 'xterm-256color',
      // 初始 120x30 对齐 Sudowork terminalBridge（前端 fit 后会发 resize 帧校正）
      cols: 120,
      rows: 30,
      cwd,
      env: process.env as Record<string, string>,
    })
    const session: TerminalSession = {
      terminalId,
      conversationId,
      write: (data) => {
        try {
          proc.write(data)
        } catch {
          /* 进程已退出 */
        }
      },
      resize: (cols, rows) => {
        try {
          proc.resize(cols, rows)
        } catch {
          /* 进程已退出 */
        }
      },
      dispose: () => {
        this.terminals.delete(terminalId)
        try {
          proc.kill()
        } catch {
          /* 已退出 */
        }
      },
    }
    proc.onData(onOutput)
    proc.onExit(() => {
      this.terminals.delete(terminalId)
      onExit()
    })
    this.terminals.set(terminalId, session)
    return session
  }

  get(terminalId: string): TerminalSession | undefined {
    return this.terminals.get(terminalId)
  }

  closeByConversation(conversationId: string): number {
    let closed = 0
    for (const t of [...this.terminals.values()]) {
      if (t.conversationId === conversationId) {
        t.dispose()
        closed++
      }
    }
    return closed
  }

  get size(): number {
    return this.terminals.size
  }
}
