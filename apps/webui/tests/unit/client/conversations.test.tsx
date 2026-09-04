import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import {
  initialStreamState,
  reduceStreamEvent,
  useConversationSocket,
  type ConversationStreamState,
} from '@client/features/conversations/useConversationSocket'
import { SendBox } from '@client/features/conversations/SendBox'

describe('reduceStreamEvent（上游事件聚合）', () => {
  test('assistant delta chunks with same uuid accumulate', () => {
    let state: ConversationStreamState = initialStreamState
    state = reduceStreamEvent(state, {
      kind: 'upstream',
      event: { type: 'assistant', uuid: 't1', delta: true, message: { content: [{ type: 'text', text: '你' }] } },
    })
    state = reduceStreamEvent(state, {
      kind: 'upstream',
      event: { type: 'assistant', uuid: 't1', delta: true, message: { content: [{ type: 'text', text: '好' }] } },
    })
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({ kind: 'assistant', id: 't1', text: '你好', done: false })
  })

  test('result marks assistant done', () => {
    let state: ConversationStreamState = reduceStreamEvent(initialStreamState, {
      kind: 'upstream',
      event: { type: 'assistant', uuid: 't1', delta: true, message: { content: [{ type: 'text', text: 'hi' }] } },
    })
    state = reduceStreamEvent(state, {
      kind: 'upstream',
      event: { type: 'result', session_id: 's', status: 'success' },
    })
    expect(state.messages[0]).toMatchObject({ kind: 'assistant', done: true })
  })

  test('AskUserQuestion tool_use becomes a question message', () => {
    const state = reduceStreamEvent(initialStreamState, {
      kind: 'upstream',
      event: {
        type: 'tool_use',
        uuid: 'q1',
        name: 'AskUserQuestion',
        input: JSON.stringify({ title: '选择颜色', description: '红或蓝' }),
      },
    })
    expect(state.messages[0]).toMatchObject({
      kind: 'question',
      id: 'q1',
      title: '选择颜色',
      answered: false,
    })
  })

  test('plain tool_use becomes a tool message; unknown types ignored', () => {
    let state: ConversationStreamState = reduceStreamEvent(initialStreamState, {
      kind: 'upstream',
      event: { type: 'tool_use', uuid: 't9', name: 'Read', input: '{"path":"x"}' },
    })
    state = reduceStreamEvent(state, {
      kind: 'upstream',
      event: { type: 'mystery_event', payload: 1 },
    })
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({ kind: 'tool', name: 'Read' })
  })

  test('lock/writer/error update control state', () => {
    let state: ConversationStreamState = initialStreamState
    state = reduceStreamEvent(state, { kind: 'lock', state: 'running' })
    expect(state.lockState).toBe('running')
    state = reduceStreamEvent(state, { kind: 'writer', isWriter: true })
    expect(state.isWriter).toBe(true)
    state = reduceStreamEvent(state, { kind: 'error', code: 'CONVERSATION_BUSY' })
    expect(state.lastError).toBe('CONVERSATION_BUSY')
  })

  test('error with pending model switch + whitelist code sets modelSwitchError, clears pending', () => {
    const pending: ConversationStreamState = { ...initialStreamState, modelSwitchPending: 'gpt-4' }
    const next = reduceStreamEvent(pending, { kind: 'error', code: 'CONVERSATION_BUSY' })
    expect(next.modelSwitchError).toBe('CONVERSATION_BUSY')
    expect(next.modelSwitchPending).toBeNull()
  })

  test('error without pending switch does not set modelSwitchError', () => {
    const next = reduceStreamEvent(initialStreamState, { kind: 'error', code: 'CONVERSATION_BUSY' })
    expect(next.modelSwitchError).toBeNull()
    expect(next.lastError).toBe('CONVERSATION_BUSY')
  })

  test('model_changed confirms pending switch: clears pending/error, updates currentModel, drops hydrated', () => {
    const pending: ConversationStreamState = {
      ...initialStreamState,
      modelSwitchPending: 'gpt-4',
      modelSwitchError: 'X',
      hydratedModel: 'seed',
    }
    const next = reduceStreamEvent(pending, {
      kind: 'upstream',
      event: { type: 'system', subtype: 'model_changed', model: 'proxy/gpt-4' },
    })
    expect(next.currentModel).toBe('proxy/gpt-4')
    expect(next.modelSwitchPending).toBeNull()
    expect(next.modelSwitchError).toBeNull()
    expect(next.hydratedModel).toBeNull()
  })
})

describe('useConversationSocket 切换会话重置（防消息泄漏）', () => {
  // 极简 WebSocket 桩：hook 的连接 effect 需要构造 WebSocket，但本用例只验证切换重置、不依赖 WS 消息
  class StubWebSocket {
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    onmessage: ((ev: { data: string }) => void) | null = null
    readyState = 0
    send(): void {}
    close(): void {}
  }

  test('切换 conversationId 后，上一会话的本地消息与控制态不残留', () => {
    const original = globalThis.WebSocket
    globalThis.WebSocket = StubWebSocket as unknown as typeof WebSocket
    try {
      const { result, rerender } = renderHook(({ id }: { id: string }) => useConversationSocket(id), {
        initialProps: { id: 'conv-a' },
      })

      act(() => result.current.appendLocalUser('会话A的本地消息'))
      expect(result.current.state.messages).toHaveLength(1)

      rerender({ id: 'conv-b' })
      expect(result.current.state.messages).toHaveLength(0)
      expect(result.current.state.lockState).toBeNull()
      expect(result.current.state.isWriter).toBe(false)
    } finally {
      globalThis.WebSocket = original
    }
  })

  test('hydrateModel seeds hydratedModel; setModel while socket not open reports UPSTREAM_NOT_CONNECTED', () => {
    const original = globalThis.WebSocket
    globalThis.WebSocket = StubWebSocket as unknown as typeof WebSocket
    try {
      const { result } = renderHook(({ id }: { id: string }) => useConversationSocket(id), {
        initialProps: { id: 'conv-a' },
      })

      act(() => result.current.hydrateModel('gpt-4'))
      expect(result.current.state.hydratedModel).toBe('gpt-4')

      // StubWebSocket.readyState=0（非 OPEN）→ setModel 立即置错，不进入 pending
      act(() => result.current.setModel('gpt-5'))
      expect(result.current.state.modelSwitchError).toBe('UPSTREAM_NOT_CONNECTED')
      expect(result.current.state.modelSwitchPending).toBeNull()
    } finally {
      globalThis.WebSocket = original
    }
  })
})

describe('SendBox', () => {
  test('disabled box does not submit; enabled box sends text and images', () => {
    const onSend = vi.fn()
    const { rerender } = render(<SendBox disabled onSend={onSend} />)
    const disabledBox = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(disabledBox, { target: { value: 'text' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onSend).not.toHaveBeenCalled()

    rerender(<SendBox disabled={false} onSend={onSend} />)
    const box = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '你好' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onSend).toHaveBeenCalledWith('你好', [])
  })
})

const createConversationMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'sess-9' }))

vi.mock('@client/features/conversations/conversationApi', () => ({
  getConversationOptions: vi.fn().mockResolvedValue({
    models: [{ id: 'm1', name: 'M1' }],
    agents: [
      { name: 'helper', displayName: '帮助助手', emoji: '🤖', description: '帮你干活', avatar: '', defaultInitPrompt: '', promptsI18n: { 'zh-CN': [] } },
      { name: 'writer', displayName: '写作助手', emoji: '', description: '', avatar: '', defaultInitPrompt: '', promptsI18n: { 'zh-CN': [] } },
      {
        name: 'guide',
        displayName: '上手向导',
        emoji: '🧭',
        description: '带你快速上手',
        avatar: '',
        defaultInitPrompt: '请帮我从零开始',
        promptsI18n: { 'zh-CN': ['案例一：生成周报', '案例二：整理表格'] },
      },
    ],
    skills: [{ name: 'pdf' }, { name: 'search' }],
  }),
  createConversation: createConversationMock,
  listConversations: vi.fn().mockResolvedValue({ conversations: [] }),
  getConversationContext: vi.fn(),
  terminateConversation: vi.fn(),
}))

import { NewConversationPage } from '@client/features/conversations/NewConversationPage'

describe('NewConversationPage', () => {
  test('sends without selecting an agent (empty assistantName) with skills', async () => {
    render(
      <MemoryRouter initialEntries={['/guid']}>
        <NewConversationPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Hi，今天有什么安排？')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText('CTCode')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'CTCode' })).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toMatch(/^CTCode, /)
    fireEvent.click(screen.getByText('技能'))
    fireEvent.click(screen.getByTestId('skill-option-pdf'))
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '你好' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(createConversationMock).toHaveBeenCalled(), { timeout: 5000 })
    expect(createConversationMock).toHaveBeenCalledWith({
      assistantName: '',
      enabledSkills: ['pdf'],
    })
  })

  test('selecting an agent chip switches to selected view and sends with its name', async () => {
    render(
      <MemoryRouter initialEntries={['/guid']}>
        <NewConversationPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('assistant-chip-helper')).toBeTruthy(), { timeout: 5000 })
    fireEvent.click(screen.getByTestId('assistant-chip-helper'))
    // 选中后 chip 列表隐藏（helper 无案例提示词，底部整块不渲染），名称仅出现在选中态视图
    await waitFor(() => expect(screen.getByText('帮你干活')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText('帮助助手')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toMatch(/^帮助助手, /)
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '帮我' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(createConversationMock).toHaveBeenCalled(), { timeout: 5000 })
    expect(createConversationMock).toHaveBeenCalledWith({
      assistantName: 'helper',
      enabledSkills: [],
    })
  })

  test('selecting an agent with prompts prefills input and renders clickable examples', async () => {
    render(
      <MemoryRouter initialEntries={['/guid']}>
        <NewConversationPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('assistant-chip-guide')).toBeTruthy(), { timeout: 5000 })
    fireEvent.click(screen.getByTestId('assistant-chip-guide'))

    // 行为A：defaultInitPrompt 预填输入框
    const box = (await waitFor(() => screen.getByLabelText('消息输入框'), { timeout: 5000 })) as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe('请帮我从零开始'), { timeout: 5000 })

    // 行为A：promptsI18n['zh-CN'] 案例可点击，点击写入输入框
    expect(screen.getByTestId('agent-example-prompts')).toBeTruthy()
    fireEvent.click(screen.getByText('案例二：整理表格'))
    expect(box.value).toBe('案例二：整理表格')
  })
})
