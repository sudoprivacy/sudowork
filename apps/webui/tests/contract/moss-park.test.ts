import { describe, expect, test, vi } from 'vitest'
import { createMossParkPort } from '@sudowork/moss-client'
import {
  AssistantAssignmentSchema,
  AuditEventSchema,
  BindingSchema,
  EnterpriseListItemSchema,
  InquiryViewSchema,
  LeadSchema,
  ParkContextSchema,
  ParkMemberSchema,
  RegisterEnterpriseResponseSchema,
} from '@sudowork/contracts/park'

const context = { baseUrl: 'http://moss.test', accessToken: 'token' }

describe('MossParkPort request contract', () => {
  test('park lead and enterprise endpoints preserve method, path and token', async () => {
    const fetcher = vi.fn().mockResolvedValue({ items: [] })
    const port = createMossParkPort(fetcher)

    await port.context(context)
    await port.leads(context, 'park/1', { status: 'proposed', watched: true })
    await port.leadDetail(context, 'park/1', 'lead/1')
    await port.claimLead(context, 'park/1', 'lead/1')
    await port.enterpriseInquiries(context)
    await port.consultations(context, 'park/1', {
      enterprise_org_id: 'ent/1',
      before_created_at: 100,
      after_created_at: 50,
    })

    expect(fetcher.mock.calls.map((call) => call[1])).toEqual([
      { method: 'GET', path: '/api/v1/park/context', accessToken: 'token' },
      {
        method: 'GET',
        path: '/api/v1/parks/park%2F1/leads?status=proposed&watched=1',
        accessToken: 'token',
      },
      { method: 'GET', path: '/api/v1/parks/park%2F1/leads/lead%2F1', accessToken: 'token' },
      { method: 'POST', path: '/api/v1/parks/park%2F1/leads/lead%2F1/claim', accessToken: 'token' },
      { method: 'GET', path: '/api/v1/enterprise/inquiries', accessToken: 'token' },
      {
        method: 'GET',
        path: '/api/v1/parks/park%2F1/consultations?enterprise_org_id=ent%2F1&before_created_at=100&after_created_at=50',
        accessToken: 'token',
      },
    ])
  })

  test('registerEnterprise passes clientIp as x-forwarded-for header（moss 限流 key）', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      enterprise_org_id: 'e1',
      park_org_id: 'p1',
      user_id: 'u1',
    })
    const port = createMossParkPort(fetcher)

    await port.registerEnterprise('http://moss.test', { phone: '13800000000' }, '203.0.113.7')

    expect(fetcher).toHaveBeenCalledWith('http://moss.test', {
      method: 'POST',
      path: '/api/v1/park/register-enterprise',
      body: { phone: '13800000000' },
      headers: { 'x-forwarded-for': '203.0.113.7' },
    })
  })

  test('端点返回数据可被 contracts schema 解析（port 与契约一致，计划 5.5 contract 层）', async () => {
    const leadRow = {
      lead_id: 'l1',
      park_org_id: 'p1',
      enterprise_org_id: 'e1',
      source: 'inquiry',
      source_inquiry_id: null,
      score: 80,
      score_explanation: '依据',
      industry_tags: ['AI'],
      policy_matches: null,
      suggested_action: null,
      owner_id: null,
      status: 'proposed',
      created_at: 1,
      updated_at: 1,
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        org_type: 'park',
        park_role: 'park_leader',
        park_org_id: 'p1',
        display_name: '园区',
      })
      .mockResolvedValueOnce({
        items: [
          {
            enterprise_org_id: 'e1',
            enterprise_name: '星澜智能',
            lifecycle: 'prospect',
            tags: [],
            assigned_owner_id: null,
            created_at: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ items: [leadRow] })
      .mockResolvedValueOnce({
        items: [
          {
            inquiry_id: 'i1',
            park_org_id: 'p1',
            enterprise_org_id: 'e1',
            user_id: 'u1',
            redacted_question: '问题***',
            redacted_answer: null,
            category: 'consultation',
            intent: 'policy_inquiry',
            confidence: 60,
            source_refs: [],
            created_at: 1,
            hasLead: false,
            enterprise_name: '星澜智能',
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            audit_id: 'au1',
            action: 'park.lead_claim',
            target_type: 'lead',
            target_id: 'l1',
            actor_user_id: 'ops',
            reason: null,
            before: null,
            after: null,
            result: null,
            created_at: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          { id: 'm1', park_org_id: 'p1', user_id: 'u1', park_role: 'park_ops', created_at: 1 },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'as1',
            park_org_id: 'p1',
            assistant_id: 'a1',
            enterprise_org_id: 'e1',
            created_at: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ binding_id: 'b1' })
      .mockResolvedValueOnce({ enterprise_org_id: 'e1', park_org_id: 'p1', user_id: 'u1' })
    const port = createMossParkPort(fetcher)
    const firstItem = async (call: Promise<unknown>): Promise<unknown> =>
      ((await call) as { items: unknown[] }).items[0]

    expect(ParkContextSchema.safeParse(await port.context(context)).success).toBe(true)
    expect(
      EnterpriseListItemSchema.safeParse(await firstItem(port.enterprises(context, 'p1'))).success,
    ).toBe(true)
    expect(LeadSchema.safeParse(await firstItem(port.leads(context, 'p1'))).success).toBe(true)
    expect(
      InquiryViewSchema.safeParse(await firstItem(port.consultations(context, 'p1'))).success,
    ).toBe(true)
    expect(
      AuditEventSchema.safeParse(await firstItem(port.auditEvents(context, 'p1'))).success,
    ).toBe(true)
    expect(ParkMemberSchema.safeParse(await firstItem(port.members(context, 'p1'))).success).toBe(
      true,
    )
    expect(
      AssistantAssignmentSchema.safeParse(await firstItem(port.assignments(context, 'p1'))).success,
    ).toBe(true)
    expect(
      BindingSchema.pick({ binding_id: true }).safeParse(
        await port.createBinding(context, 'p1', {}),
      ).success,
    ).toBe(true)
    expect(
      RegisterEnterpriseResponseSchema.safeParse(
        await port.registerEnterprise('http://moss.test', {}),
      ).success,
    ).toBe(true)
  })

  test('policy management uses existing document and Wiki APIs', async () => {
    const fetcher = vi.fn().mockResolvedValue({})
    const port = createMossParkPort(fetcher)
    const upload = { file_name: '政策.md', content_base64: 'YQ==', mime_type: 'text/markdown' }
    const wiki = { name: '政策库', source_mode: 'files', source_document_ids: ['doc-1'] }

    await port.documentTree(context)
    await port.createDocumentNode(context, '政策')
    await port.uploadDocument(context, 'node-1', upload)
    await port.deleteDocument(context, 'doc-1')
    await port.createWiki(context, wiki)
    await port.updateWiki(context, 'wiki-1', { source_document_ids: ['doc-2'] })
    await port.buildWiki(context, 'wiki-1')
    await port.wikiBuildStatus(context, 'wiki-1')

    expect(fetcher.mock.calls.map((call) => call[1])).toEqual([
      { method: 'GET', path: '/api/v1/documents/tree', accessToken: 'token' },
      {
        method: 'POST',
        path: '/api/v1/documents/tree/nodes',
        accessToken: 'token',
        body: { name: '政策' },
      },
      {
        method: 'POST',
        path: '/api/v1/documents/tree/nodes/node-1/documents',
        accessToken: 'token',
        body: upload,
      },
      { method: 'DELETE', path: '/api/v1/documents/doc-1', accessToken: 'token' },
      { method: 'POST', path: '/api/v1/wikis', accessToken: 'token', body: wiki },
      {
        method: 'PATCH',
        path: '/api/v1/wikis/wiki-1',
        accessToken: 'token',
        body: { source_document_ids: ['doc-2'] },
      },
      { method: 'POST', path: '/api/v1/wikis/wiki-1/build', accessToken: 'token' },
      { method: 'GET', path: '/api/v1/wikis/wiki-1/build-status', accessToken: 'token' },
    ])
  })
})
