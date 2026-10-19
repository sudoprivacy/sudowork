import { describe, expect, test, vi } from 'vitest'
import { createServer } from 'node:http'
import { convertMossMessagesToTMessages } from '@sudowork/common/chatLib'
import { createMossSessionPort, mossRequest } from '@sudowork/moss-client'
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
  test('keeps the actual HTTP attemptId from resume for live activity reconciliation', async () => {
    const mock = vi.fn().mockResolvedValue({
      session: {
        sessionId: 's1',
        userId: 'owner',
        orgId: 'org',
        status: 'active',
        attemptId: 'a1',
      },
      ws_url: 'ws://moss.test/ws/sessions/s1',
    })
    expect((await createMossSessionPort(mock).resume(CTX, 's1')).session.attemptId).toBe('a1')
  })
  test('activity reads a generation-bound live observation and rejects incomplete replies', async () => {
    const mock = vi.fn().mockResolvedValue({ attemptId: 'a1', state: 'idle' })
    const port = createMossSessionPort(mock)
    await expect(port.activity(CTX, 's/1')).resolves.toEqual({ attemptId: 'a1', state: 'idle' })
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'GET',
      path: '/api/v1/sessions/s%2F1/activity',
      accessToken: 'tk',
    })
    mock.mockResolvedValue({ state: 'idle' })
    await expect(port.activity(CTX, 's1')).rejects.toThrow()
  })
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
      task_id: 't1',
      attempt_id: 'a1',
      ws_url: 'ws://moss.test/ws/sessions/s1',
      work_dir: '/home/x',
    })
    const port = createMossSessionPort(mock)
    const created = await port.create(CTX, { assistantName: 'helper', enabledSkills: ['a', 'b'] })
    expect(created).toEqual({
      sessionId: 's1',
      taskId: 't1',
      attemptId: 'a1',
      wsUrl: 'ws://moss.test/ws/sessions/s1',
    })
    expect(mock).toHaveBeenCalledWith(
      BASE,
      {
        method: 'POST',
        path: '/api/v1/sessions',
        accessToken: 'tk',
        body: {
          assistant_name: 'helper',
          enabled_skills: ['a', 'b'],
          dangerously_skip_permissions: false,
        },
      },
      180_000,
    )
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

  // 上游真实形状是 { success, data: {...}, systemDefaultModel }（moss server.ts
  // /api/v1/users/:id/model）。早先这里 mock 的是顶层 { modelId }，测试因此恒绿
  // 而线上恒 null —— 断言必须照上游的包封写，否则它保护的是一个不存在的上游。
  test('getUserModel reads modelId out of the data envelope and keeps systemDefaultModel', async () => {
    const mock = vi.fn().mockResolvedValue({
      success: true,
      data: { modelId: 'gpt-4', updatedAt: 1 },
      systemDefaultModel: 'sonnet',
    })
    const port = createMossSessionPort(mock)
    await expect(port.getUserModel(CTX)).resolves.toEqual({
      modelId: 'gpt-4',
      systemDefaultModel: 'sonnet',
    })
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'GET',
      path: '/api/v1/users/me/model',
      accessToken: 'tk',
    })

    const snakeMock = vi.fn().mockResolvedValue({
      success: true,
      data: { model_id: 'claude-x' },
      systemDefaultModel: 'sonnet',
    })
    await expect(createMossSessionPort(snakeMock).getUserModel(CTX)).resolves.toEqual({
      modelId: 'claude-x',
      systemDefaultModel: 'sonnet',
    })

    // 未设偏好：data 为 null，但 systemDefaultModel 仍要带回，
    // 否则调用方的第二级兜底拿不到东西，只能塌到「列表首项」。
    const unsetMock = vi
      .fn()
      .mockResolvedValue({ success: true, data: null, systemDefaultModel: 'sonnet' })
    await expect(createMossSessionPort(unsetMock).getUserModel(CTX)).resolves.toEqual({
      modelId: null,
      systemDefaultModel: 'sonnet',
    })
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
    expect(mock).toHaveBeenLastCalledWith(
      BASE,
      {
        method: 'POST',
        path: '/api/v1/sessions/s1/resume',
        accessToken: 'tk',
      },
      180_000,
    )

    await port.terminate(CTX, 's1')
    expect(mock).toHaveBeenLastCalledWith(BASE, {
      method: 'POST',
      path: '/api/v1/sessions/s1/terminate',
      accessToken: 'tk',
    })

    await port.workspaceTree(CTX, 's1', '')
    expect(mock).toHaveBeenLastCalledWith(
      BASE,
      {
        method: 'GET',
        path: '/api/v1/sessions/s1/workspace/tree',
        accessToken: 'tk',
        searchParams: {},
      },
      90_000,
    )
  })

  test.each(['tree', 'read', 'write', 'create', 'resume'] as const)(
    '%s waits for cold runtime readiness beyond the metadata timeout',
    async (operation) => {
      vi.useFakeTimers()
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: unknown, init: RequestInit) =>
            new Promise<Response>((resolve, reject) => {
              const timer = setTimeout(
                () =>
                  resolve(
                    new Response(
                      JSON.stringify({
                        root: { name: 'workspace', relativePath: '', isFile: false, isDir: true },
                        session_id: 's1',
                        session: { sessionId: 's1', userId: 'u', orgId: 'o', status: 'active' },
                        ws_url: 'ws://moss.test/ws/sessions/s1',
                      }),
                    ),
                  ),
                20_000,
              )
              init.signal?.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer)
                  reject(init.signal?.reason)
                },
                { once: true },
              )
            }),
        ),
      )
      try {
        const port = createMossSessionPort(mossRequest)
        const pending =
          operation === 'tree'
            ? port.workspaceTree(CTX, 's1', '')
            : operation === 'read'
              ? port.workspaceFileGet(CTX, 's1', 'note.txt')
              : operation === 'write'
                ? port.workspaceFilePost(CTX, 's1', 'note.txt', 'b2s=')
                : operation === 'create'
                  ? port.create(CTX, { assistantName: 'helper', enabledSkills: [] })
                  : port.resume(CTX, 's1')
        const assertion = expect(pending).resolves.toBeDefined()
        await vi.advanceTimersByTimeAsync(20_000)
        await assertion
      } finally {
        vi.unstubAllGlobals()
        vi.useRealTimers()
      }
    },
  )

  test('context accepts persisted top-level thinking messages', async () => {
    const context = {
      context: {
        messages: [{ type: 'thinking', uuid: 'thinking-1', content: 'reasoning' }],
      },
    }
    const mock = vi.fn().mockResolvedValue(context)
    const port = createMossSessionPort(mock)

    await expect(port.context(CTX, 's1')).resolves.toEqual(context)
  })

  test('context preserves conversation history containing persisted artifact frames', async () => {
    // Real Moss transcripts append artifacts after each completed model turn.
    const context = {
      context: {
        messages: [
          { type: 'user', uuid: 'user-1', content: 'Review the shared browser' },
          { type: 'tool_use', uuid: 'tool-1', name: 'browser_observe', input: {} },
          { type: 'tool_result', uuid: 'result-1', content: 'Human review 12345678' },
          { type: 'assistant', uuid: 'assistant-1', content: 'Human review 12345678' },
          {
            type: 'artifacts',
            uuid: 'artifacts-1',
            v: 1,
            workspace: '/workspace',
            records: [
              {
                sessionId: 's1',
                relativePath: 'review.txt',
                intent: 'final',
                origin: 'generated',
                size: 21,
              },
            ],
          },
          { type: 'artifacts', uuid: 'artifacts-2', v: 1, records: [] },
        ],
      },
    }
    const port = createMossSessionPort(vi.fn().mockResolvedValue(context))

    await expect(port.context(CTX, 's1')).resolves.toEqual(context)
  })

  test('context still rejects unknown transcript message types', async () => {
    const port = createMossSessionPort(
      vi.fn().mockResolvedValue({ context: { messages: [{ type: 'unknown-frame' }] } }),
    )
    await expect(port.context(CTX, 's1')).rejects.toThrow()
  })

  test('restores terminal failures through HTTP context validation and shared message conversion', async () => {
    const timestamp = '2026-10-19T00:00:00.000Z'
    const interruptionError = 'Execution outcome is unknown. Check effects before retrying.'
    const messages = [
      { type: 'user', uuid: 'user', timestamp, content: 'Run the task' },
      {
        type: 'result',
        uuid: 'interrupted',
        timestamp,
        subtype: 'error_interrupted',
        is_error: true,
        errors: [interruptionError],
      },
      { type: 'result', uuid: 'finished', timestamp, subtype: 'success', is_error: false },
      {
        type: 'result',
        uuid: 'cancelled',
        timestamp,
        result_type: 'user',
        is_error: true,
        result: 'Request was aborted',
      },
      {
        type: 'result',
        uuid: 'failure',
        timestamp,
        subtype: 'error_execution',
        is_error: true,
        errors: ['Provider unavailable'],
      },
    ]
    const requests: Array<{ path: string | undefined; authorization: string | undefined }> = []
    const server = createServer((req, res) => {
      requests.push({ path: req.url, authorization: req.headers.authorization })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ context: { messages } }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('Expected an ephemeral HTTP port')
      const context = (await createMossSessionPort(mossRequest).context(
        { ...CTX, baseUrl: `http://127.0.0.1:${address.port}` },
        's1',
      )) as { context: { messages: unknown[] } }
      expect(context.context.messages).toEqual(messages)
      const restored = convertMossMessagesToTMessages(
        context.context.messages,
        'conversation',
        's1',
      ).messages
      const errors = restored.filter((message) => message.type === 'tips')
      expect(errors).toHaveLength(2)
      expect(errors[0]).toMatchObject({
        content: { type: 'error', errorClass: 'interrupted', content: interruptionError },
      })
      expect(errors[1]).toMatchObject({
        content: { type: 'error', content: 'Provider unavailable' },
      })
      expect(requests).toEqual([
        { path: '/api/v1/sessions/s1/context', authorization: 'Bearer tk' },
      ])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
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
