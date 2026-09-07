import { describe, expect, test, vi } from 'vitest'
import { createMossSessionPort } from '@sudowork/moss-client'
import {
  buildAnswerQuestionMessage,
  buildControlResponseMessage,
  buildSetModelMessage,
  buildUserMessage,
  validateMossWsUrl,
  MossWsValidationError,
} from '@sudowork/moss-client'

const BASE = 'http://moss.test'
const CTX = { accessToken: 'tk', baseUrl: BASE }

describe('MossSessionPort request shapes (contract vs baseline)', () => {
  test('list calls GET /api/v1/sessions', async () => {
    const mock = vi.fn().mockResolvedValue({ sessions: [] })
    const port = createMossSessionPort(mock)
    await port.list(CTX)
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'GET',
      path: '/api/v1/sessions',
      accessToken: 'tk',
    })
  })

  test('create posts assistant_name + enabled_skills + explicit skip_permissions=false, never cwd/runtime', async () => {
    const mock = vi.fn().mockResolvedValue({
      session_id: 's1',
      ws_url: 'ws://moss.test/ws/sessions/s1',
      work_dir: '/home/x',
    })
    const port = createMossSessionPort(mock)
    const created = await port.create(CTX, { assistantName: 'helper', enabledSkills: ['a', 'b'] })
    expect(created).toEqual({ sessionId: 's1', wsUrl: 'ws://moss.test/ws/sessions/s1' })
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      path: '/api/v1/sessions',
      accessToken: 'tk',
      body: {
        assistant_name: 'helper',
        enabled_skills: ['a', 'b'],
        dangerously_skip_permissions: false,
      },
    })
  })

  test('setUserModel puts /api/v1/users/me/model with { modelId }', async () => {
    const mock = vi.fn().mockResolvedValue({ data: { modelId: 'gpt-4', updatedAt: 1 } })
    const port = createMossSessionPort(mock)
    await port.setUserModel(CTX, 'gpt-4')
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'PUT',
      path: '/api/v1/users/me/model',
      accessToken: 'tk',
      body: { modelId: 'gpt-4' },
    })
  })

  test('getUserModel gets /api/v1/users/me/model and reads modelId (camel/snake compatible)', async () => {
    const mock = vi.fn().mockResolvedValue({ modelId: 'gpt-4' })
    const port = createMossSessionPort(mock)
    await expect(port.getUserModel(CTX)).resolves.toBe('gpt-4')
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'GET',
      path: '/api/v1/users/me/model',
      accessToken: 'tk',
    })

    const snakeMock = vi.fn().mockResolvedValue({ model_id: 'claude-x' })
    await expect(createMossSessionPort(snakeMock).getUserModel(CTX)).resolves.toBe('claude-x')

    const unsetMock = vi.fn().mockResolvedValue({})
    await expect(createMossSessionPort(unsetMock).getUserModel(CTX)).resolves.toBeNull()
  })

  test('context/resume/terminate/workspace paths match baseline routes', async () => {
    const mock = vi
      .fn()
      .mockImplementation((_base: string, req: { method: string; path: string }) =>
        Promise.resolve(
          req.path.endsWith('/context')
            ? { context: { messages: [] } }
            : req.path.endsWith('/resume')
              ? {
                  session: { sessionId: 's1', userId: 'u', orgId: 'o', status: 'active' },
                  ws_url: 'ws://moss.test/ws/sessions/s1',
                }
              : req.path.includes('/workspace/tree')
                ? { root: { name: 'r', relativePath: '', isFile: false, isDir: true } }
                : { ok: true },
        ),
      )
    const port = createMossSessionPort(mock)

    await port.context(CTX, 's1')
    expect(mock).toHaveBeenLastCalledWith(BASE, {
      method: 'GET',
      path: '/api/v1/sessions/s1/context',
      accessToken: 'tk',
    })

    await port.resume(CTX, 's1')
    expect(mock).toHaveBeenLastCalledWith(BASE, {
      method: 'POST',
      path: '/api/v1/sessions/s1/resume',
      accessToken: 'tk',
    })

    await port.terminate(CTX, 's1')
    expect(mock).toHaveBeenLastCalledWith(BASE, {
      method: 'POST',
      path: '/api/v1/sessions/s1/terminate',
      accessToken: 'tk',
    })

    await port.workspaceTree(CTX, 's1', '')
    expect(mock).toHaveBeenLastCalledWith(BASE, {
      method: 'GET',
      path: '/api/v1/sessions/s1/workspace/tree',
      accessToken: 'tk',
      searchParams: {},
    })
  })

  test('session ids are uri-encoded once', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true })
    const port = createMossSessionPort(mock)
    await port.context(CTX, 'id with space/slash')
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'GET',
      path: '/api/v1/sessions/id%20with%20space%2Fslash/context',
      accessToken: 'tk',
    })
  })
})

describe('ws_url validation (计划 3.5)', () => {
  test('accepts exact /ws/sessions/:id on configured host', () => {
    expect(() =>
      validateMossWsUrl('ws://moss.test:9000/ws/sessions/s1', 's1', 'ws://moss.test:9000'),
    ).not.toThrow()
  })

  test('rejects session mismatch', () => {
    expect(() =>
      validateMossWsUrl('ws://moss.test/ws/sessions/other', 's1', 'ws://moss.test'),
    ).toThrow(MossWsValidationError)
  })

  test('rejects foreign host', () => {
    expect(() =>
      validateMossWsUrl('ws://evil.example/ws/sessions/s1', 's1', 'ws://moss.test'),
    ).toThrow(MossWsValidationError)
  })

  test('rejects query credentials', () => {
    expect(() =>
      validateMossWsUrl('ws://moss.test/ws/sessions/s1?token=x', 's1', 'ws://moss.test'),
    ).toThrow(MossWsValidationError)
  })

  test('rejects non-ws scheme and encoded traversal', () => {
    expect(() =>
      validateMossWsUrl('http://moss.test/ws/sessions/s1', 's1', 'ws://moss.test'),
    ).toThrow(MossWsValidationError)
    expect(() =>
      validateMossWsUrl('ws://moss.test/ws/sessions/s1%2Fevil', 's1', 'ws://moss.test'),
    ).toThrow(MossWsValidationError)
  })
})

describe('protocol builders (browser message -> moss acp wire format)', () => {
  test('buildUserMessage: image + text blocks with uuid', () => {
    const msg = buildUserMessage({
      sessionId: 's1',
      text: 'hello',
      images: [{ mediaType: 'image/png', data: 'AAAA' }],
      parentToolUseId: null,
    })
    expect(msg.type).toBe('user')
    expect(msg.parent_tool_use_id).toBeNull()
    expect(msg.session_id).toBe('s1')
    expect(typeof msg.uuid).toBe('string')
    const content = (msg.message as { content: { type: string }[] }).content
    // Image blocks precede text on purpose — see MossWebSocket.buildUserMessage
    // (vision input first, matching the desktop vision fix).
    expect(content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'hello' },
    ])
  })

  test('buildAnswerQuestionMessage uses parent_tool_use_id', () => {
    const msg = buildAnswerQuestionMessage('s1', 'tool-use-uuid', 'A')
    expect(msg.parent_tool_use_id).toBe('tool-use-uuid')
    expect(msg.type).toBe('user')
  })

  test('buildSetModelMessage is the only supported control_request', () => {
    const msg = buildSetModelMessage('gpt-x')
    expect(msg).toMatchObject({
      type: 'control_request',
      request: { subtype: 'set_model', model_id: 'gpt-x' },
    })
    expect(typeof msg.request_id).toBe('string')
  })

  test('buildControlResponseMessage mirrors the desktop permission-answer shape', () => {
    const msg = buildControlResponseMessage('req-1', 'allow_once')
    expect(msg).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-1',
        response: { behavior: 'allow_once' },
      },
    })
  })
})
