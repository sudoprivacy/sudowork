import { randomUUID } from 'node:crypto'

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

export class TerminalUnavailableError extends Error {
  constructor() {
    super('The Agent runtime does not provide a remote terminal')
  }
}

export type TerminalFactory = (
  conversationId: string,
  onOutput: (data: string) => void,
  onExit: () => void,
) => Omit<TerminalSession, 'terminalId' | 'conversationId'>

/** Track runtime terminals without starting a shell on the WebUI host. */
export class TerminalManager {
  private terminals = new Map<string, TerminalSession>()

  constructor(private readonly openTerminal?: TerminalFactory) {}

  create(
    conversationId: string,
    onOutput: (data: string) => void,
    onExit: () => void,
  ): TerminalSession {
    if (!this.openTerminal) throw new TerminalUnavailableError()
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
    let isDisposed = false
    const terminal = this.openTerminal(conversationId, onOutput, () => {
      isDisposed = true
      this.terminals.delete(terminalId)
      onExit()
    })
    const session: TerminalSession = {
      terminalId,
      conversationId,
      write: (data) => {
        if (!isDisposed) terminal.write(data)
      },
      resize: (cols, rows) => {
        if (!isDisposed) terminal.resize(cols, rows)
      },
      dispose: () => {
        if (isDisposed) return
        isDisposed = true
        this.terminals.delete(terminalId)
        terminal.dispose()
      },
    }
    if (!isDisposed) this.terminals.set(terminalId, session)
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
