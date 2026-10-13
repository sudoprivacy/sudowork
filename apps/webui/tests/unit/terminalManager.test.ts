import { describe, expect, it, vi } from 'vitest'
import {
  TerminalManager,
  TerminalUnavailableError,
  type TerminalFactory,
} from '@server/features/terminal/terminalManager.js'

describe('cloud terminal placement', () => {
  it('refuses a terminal when the Agent runtime has no terminal provider', () => {
    const manager = new TerminalManager()
    expect(() => manager.create('owner-session', vi.fn(), vi.fn())).toThrow(
      TerminalUnavailableError,
    )
    expect(manager.size).toBe(0)
  })

  it('closes only the requested conversation and disposes each remote terminal once', () => {
    const terminals: Array<{ write: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> =
      []
    const openTerminal: TerminalFactory = () => {
      const terminal = { write: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
      terminals.push(terminal)
      return terminal
    }
    const manager = new TerminalManager(openTerminal)
    const alice = manager.create('alice', vi.fn(), vi.fn())
    const bob = manager.create('bob', vi.fn(), vi.fn())
    expect(manager.closeByConversation('alice')).toBe(1)
    alice.dispose()
    alice.write('ignored')
    bob.write('still available')
    expect(terminals[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(terminals[0]!.write).not.toHaveBeenCalled()
    expect(terminals[1]!.write).toHaveBeenCalledWith('still available')
    expect(manager.get(bob.terminalId)).toBe(bob)
    bob.dispose()
    expect(manager.size).toBe(0)
  })

  it('does not retain a terminal that exits while the provider is opening it', () => {
    const onExit = vi.fn()
    const manager = new TerminalManager((_conversationId, _onOutput, onRuntimeExit) => {
      onRuntimeExit()
      return { write: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
    })
    manager.create('session', vi.fn(), onExit)
    expect(onExit).toHaveBeenCalledOnce()
    expect(manager.size).toBe(0)
  })
})
