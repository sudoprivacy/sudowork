import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import {
  initialStreamState,
  reduceStreamEvent,
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
      { name: 'helper', displayName: '帮助助手', emoji: '🤖', description: '帮你干活' },
      { name: 'writer', displayName: '写作助手', emoji: '', description: '' },
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
    // 选中态视图：返回箭头 + 名称 + 描述卡（名称与 chip 同文本，用 getAllByText 断言出现两处）
    await waitFor(() => expect(screen.getAllByText('帮助助手').length).toBeGreaterThanOrEqual(2), { timeout: 5000 })
    expect(screen.getByText('帮你干活')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toMatch(/^帮助助手, /)
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '帮我' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(createConversationMock).toHaveBeenCalled(), { timeout: 5000 })
    expect(createConversationMock).toHaveBeenCalledWith({
      assistantName: 'helper',
      enabledSkills: [],
    })
  })
})
