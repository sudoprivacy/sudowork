import { describe, expect, it } from 'vitest'
import { isParkAssignedAssistant } from '../../src/server/features/conversations/conversationService'
import type { MossCallContext, MossFetch } from '@sudowork/moss-client'

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
