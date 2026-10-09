import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@client/bridgeAdapter/mossAdapter'
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge'
import type { IResponseMessage } from '@sudowork/host-bridge/ipcBridge'

class SessionSocket extends EventTarget {
  static readonly OPEN = 1
  static instances: SessionSocket[] = []
  readyState = SessionSocket.OPEN
  readonly sent: unknown[] = []

  constructor(readonly url: string) {
    super()
    SessionSocket.instances.push(this)
  }

  send(payload: string): void {
    this.sent.push(JSON.parse(payload))
  }

  receive(event: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify({ kind: 'upstream', event }) }),
    )
  }

  close(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

const SESSION_A = 'same-agent-session-a'
const SESSION_B = 'same-agent-session-b'
const frames: IResponseMessage[] = []
let offStream: () => void

function socketFor(sessionId: string): SessionSocket {
  const socket = [...SessionSocket.instances]
    .reverse()
    .find((item) => item.url.endsWith(`/${sessionId}`))
  if (!socket) throw new Error(`No socket for ${sessionId}`)
  return socket
}

function permission(toolName: string) {
  return {
    type: 'control_request',
    request_id: 'request-1',
    request: {
      tool_name: toolName,
      input: { command: toolName },
      options: [{ optionId: 'allow_once', name: 'Allow' }],
    },
  }
}

function reply(text: string) {
  return { type: 'assistant', uuid: 'message-1', message: { content: [{ type: 'text', text }] } }
}

describe('WebUI conversations belonging to the same agent', () => {
  beforeEach(async () => {
    localStorage.clear()
    SessionSocket.instances = []
    frames.length = 0
    vi.stubGlobal('WebSocket', SessionSocket)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/conversations')) {
          return Response.json({
            conversations: [SESSION_A, SESSION_B].map((id) => ({
              id,
              assistantName: 'user-owner',
              title: `Conversation ${id}`,
            })),
          })
        }
        if (url.endsWith('/deliverables')) return Response.json({ files: [] })
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
    offStream = ipcBridge.conversation.responseStream.on((frame) => frames.push(frame))
    await ipcBridge.moss.resumeSession.invoke({ sessionId: SESSION_A })
    await ipcBridge.moss.resumeSession.invoke({ sessionId: SESSION_B })
  })

  afterEach(() => {
    for (const socket of SessionSocket.instances) socket.close()
    offStream()
    vi.unstubAllGlobals()
  })

  it('keeps two conversations and routes interleaved replies and sends by session', async () => {
    const conversations = await ipcBridge.database.getUserConversations.invoke({})
    expect(conversations.map((item) => [item.id, item.extra?.agentName])).toEqual([
      [SESSION_A, 'user-owner'],
      [SESSION_B, 'user-owner'],
    ])

    await ipcBridge.moss.sendMessage.invoke({
      sessionId: SESSION_A,
      wsUrl: socketFor(SESSION_A).url,
      content: 'First task',
    })
    await ipcBridge.moss.sendMessage.invoke({
      sessionId: SESSION_B,
      wsUrl: socketFor(SESSION_B).url,
      content: 'Second task',
    })
    socketFor(SESSION_B).receive(reply('Second reply'))
    socketFor(SESSION_A).receive(reply('First reply'))

    expect(socketFor(SESSION_A).sent).toEqual([{ kind: 'send', text: 'First task' }])
    expect(socketFor(SESSION_B).sent).toEqual([{ kind: 'send', text: 'Second task' }])
    expect(frames.map((frame) => [frame.conversation_id, frame.msg_id, frame.data])).toEqual([
      [SESSION_B, 'message-1', 'Second reply'],
      [SESSION_A, 'message-1', 'First reply'],
    ])
  })

  it('keeps approvals separate when both runtimes issue the same request id', async () => {
    socketFor(SESSION_A).receive(permission('Read'))
    socketFor(SESSION_B).receive(permission('Write'))

    const pending = (sessionId: string) =>
      ipcBridge.conversation.confirmation.list.invoke({ conversation_id: sessionId })
    expect(await pending(SESSION_A)).toMatchObject([{ id: 'request-1', title: 'Read' }])
    expect(await pending(SESSION_B)).toMatchObject([{ id: 'request-1', title: 'Write' }])

    await ipcBridge.conversation.confirmation.confirm.invoke({
      conversation_id: SESSION_A,
      msg_id: 'request-1',
      callId: 'request-1',
      data: 'allow_once',
    })
    expect(socketFor(SESSION_A).sent).toEqual([
      { kind: 'control_response', requestId: 'request-1', optionId: 'allow_once' },
    ])
    expect(socketFor(SESSION_B).sent).toEqual([])
    expect(await pending(SESSION_A)).toEqual([])
    expect(await pending(SESSION_B)).toMatchObject([{ id: 'request-1', title: 'Write' }])
  })

  it('cancels one conversation while the other keeps receiving replies', async () => {
    await ipcBridge.conversation.stop.invoke({ conversation_id: SESSION_A })
    expect(socketFor(SESSION_A).sent).toEqual([{ kind: 'stop' }])
    expect(socketFor(SESSION_B).sent).toEqual([])

    socketFor(SESSION_A).receive({ type: 'result', result_type: 'user' })
    socketFor(SESSION_A).receive(reply('Late reply from cancelled turn'))
    socketFor(SESSION_B).receive(reply('Other conversation continues'))
    expect(frames.filter((frame) => frame.type === 'content')).toMatchObject([
      { conversation_id: SESSION_B, data: 'Other conversation continues' },
    ])

    await ipcBridge.moss.sendMessage.invoke({
      sessionId: SESSION_A,
      wsUrl: socketFor(SESSION_A).url,
      content: 'Next turn',
    })
    socketFor(SESSION_A).receive(reply('Next reply'))
    expect(frames.at(-1)).toMatchObject({ conversation_id: SESSION_A, data: 'Next reply' })
  })

  it('reopens only the disconnected session and retains the other session approval', async () => {
    const firstSocket = socketFor(SESSION_A)
    const otherSocket = socketFor(SESSION_B)
    firstSocket.receive(permission('Read'))
    otherSocket.receive(permission('Write'))
    firstSocket.close()

    await ipcBridge.moss.resumeSession.invoke({ sessionId: SESSION_A })
    await ipcBridge.moss.resumeSession.invoke({ sessionId: SESSION_B })
    expect(SessionSocket.instances).toHaveLength(3)
    expect(socketFor(SESSION_A)).not.toBe(firstSocket)
    expect(socketFor(SESSION_B)).toBe(otherSocket)
    expect(
      await ipcBridge.conversation.confirmation.list.invoke({ conversation_id: SESSION_A }),
    ).toEqual([])
    expect(
      await ipcBridge.conversation.confirmation.list.invoke({ conversation_id: SESSION_B }),
    ).toMatchObject([{ id: 'request-1', title: 'Write' }])

    socketFor(SESSION_A).receive(reply('Resumed reply'))
    otherSocket.receive(reply('Uninterrupted reply'))
    expect(frames.map((frame) => [frame.conversation_id, frame.data])).toEqual([
      [SESSION_A, 'Resumed reply'],
      [SESSION_B, 'Uninterrupted reply'],
    ])
  })
})
