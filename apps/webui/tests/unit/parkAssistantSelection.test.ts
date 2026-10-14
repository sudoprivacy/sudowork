import { describe, expect, it, vi } from 'vitest'
import {
  createConversation,
  InvalidSelectionError,
  isParkAssignedAssistant,
} from '../../src/server/features/conversations/conversationService'
import type { MossCallContext, MossFetch, MossSessionPort } from '@sudowork/moss-client'
import type { ConversationDeps } from '../../src/server/features/conversations/conversationService'
import type { Principal } from '../../src/server/features/auth/principalRepository'

/** conversationService 放行分支回归（计划 5.5）：
 *  园区分配的 assistantName（跨 org，installed 列表不可见）通过校验；
 *  未分配 / moss 不可达 / 非 park 企业维持拒绝。 */

function makeFetch(response: unknown, ok = true): MossFetch {
  return (async () => {
    if (!ok) throw new Error('moss unreachable')
    return response
  }) as MossFetch
}

const ctx = { baseUrl: 'http://moss.test', accessToken: 't' } as MossCallContext

describe('conversationService 的 park assistant 放行分支', () => {
  it('会话创建仅放行企业已分配的园区 Assistant', async () => {
    const create = vi.fn().mockResolvedValue({ sessionId: 'session-1' })
    const assigned = [{ assistant_id: 'as-1', name: 'park-consultation', display_name: '园区咨询' }]
    const mossFetch = vi.fn(async (_base: string, request: { path: string }) => {
      if (request.path === '/api/v1/agent-templates/installed') return []
      if (request.path === '/api/v1/enterprise/assistant') return { items: assigned }
      throw new Error(`Unexpected path ${request.path}`)
    }) as MossFetch
    const deps = { moss: { create } as unknown as MossSessionPort, mossFetch } as ConversationDeps
    const principal = { id: 'principal-1', mossUserId: 'ent-user', orgId: 'ent-org' } as Principal
    const input = { assistantName: 'park-consultation', enabledSkills: [] }
    expect(await createConversation(deps, principal, input, ctx)).toEqual({
      id: 'session-1',
      taskId: 'session-1',
    })
    expect(create).toHaveBeenCalledWith(ctx, input)
    assigned.splice(0)
    await expect(createConversation(deps, principal, input, ctx)).rejects.toBeInstanceOf(
      InvalidSelectionError,
    )
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('assistant_id / name / display_name 命中即放行', async () => {
    const fetcher = makeFetch({
      items: [{ assistant_id: 'as-1', name: 'park-consultation', display_name: '园区咨询' }],
    })
    const deps = { mossFetch: fetcher } as never
    expect(await isParkAssignedAssistant(deps, ctx, 'as-1')).toBe(true)
    expect(await isParkAssignedAssistant(deps, ctx, 'park-consultation')).toBe(true)
    expect(await isParkAssignedAssistant(deps, ctx, '园区咨询')).toBe(true)
  })

  it('未分配的 assistant 拒绝', async () => {
    const deps = { mossFetch: makeFetch({ items: [] }) } as never
    expect(await isParkAssignedAssistant(deps, ctx, 'some-other')).toBe(false)
  })

  it('moss 不可达或响应非结构化时维持拒绝（原路径兜底）', async () => {
    expect(
      await isParkAssignedAssistant({ mossFetch: makeFetch(null, false) } as never, ctx, 'as-1'),
    ).toBe(false)
    expect(
      await isParkAssignedAssistant(
        { mossFetch: makeFetch({ unexpected: true }) } as never,
        ctx,
        'as-1',
      ),
    ).toBe(false)
  })
})
