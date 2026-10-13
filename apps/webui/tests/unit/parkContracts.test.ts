import { describe, expect, it } from 'vitest'
import {
  ParkContextSchema,
  LeadSchema,
  LeadDetailSchema,
  InquiryViewSchema,
  ParkMetricsSchema,
  RegisterEnterpriseRequestSchema,
  ServiceCatalogSchema,
} from '@sudowork/contracts/park'

describe('park contracts（园区契约 schema 解析）', () => {
  it('ParkContext：park 用户带角色、enterprise 用户带园区', () => {
    const ctx = ParkContextSchema.parse({
      org_type: 'park',
      park_role: 'park_leader',
      park_org_id: 'org-1',
      display_name: '园区',
    })
    expect(ctx.org_type).toBe('park')
    expect(ctx.park_role).toBe('park_leader')

    const ent = ParkContextSchema.parse({
      org_type: 'enterprise',
      park_role: null,
      park_org_id: 'org-1',
      display_name: null,
    })
    expect(ent.org_type).toBe('enterprise')
  })

  it('Lead：七状态枚举与来源枚举', () => {
    const lead = LeadSchema.parse({
      lead_id: 'l1',
      park_org_id: 'p',
      enterprise_org_id: 'e',
      source: 'inquiry',
      source_inquiry_id: 'i1',
      score: 80,
      score_explanation: '依据',
      industry_tags: ['AI'],
      policy_matches: null,
      suggested_action: null,
      owner_id: null,
      status: 'proposed',
      created_at: 1,
      updated_at: 1,
    })
    expect(lead.status).toBe('proposed')
    expect(() => LeadSchema.parse({ ...lead, status: 'closed' })).toThrow()
  })

  it('LeadDetail：inquiry_summary 脱敏视图（无原文 ref 字段）', () => {
    const detail = LeadDetailSchema.parse({
      lead_id: 'l1',
      park_org_id: 'p',
      enterprise_org_id: 'e',
      source: 'inquiry',
      source_inquiry_id: 'i1',
      score: 80,
      score_explanation: null,
      industry_tags: [],
      policy_matches: null,
      suggested_action: null,
      owner_id: null,
      status: 'proposed',
      created_at: 1,
      updated_at: 1,
      inquiry_summary: {
        inquiry_id: 'i1',
        redacted_question: '问题***',
        redacted_answer: '答***',
        intent: 'policy_inquiry',
        confidence: 60,
        created_at: 1,
      },
    })
    expect(detail.inquiry_summary?.redacted_question).toContain('***')
    // 契约层面不存在原文 ref 字段（parse 后 schema 白名单外字段被剥离）
    const raw = JSON.stringify(detail)
    expect(raw).not.toContain('question_ref')
    expect(raw).not.toContain('answer_ref')
  })

  it('InquiryView：脱敏字段 + source_refs 引用结构', () => {
    const view = InquiryViewSchema.parse({
      inquiry_id: 'i1',
      park_org_id: 'p',
      enterprise_org_id: 'e',
      user_id: 'u',
      redacted_question: 'q',
      redacted_answer: 'a',
      category: 'consultation',
      intent: null,
      confidence: null,
      source_refs: [{ file: '政策.md', line_no: 2, line: '…' }],
      created_at: 1,
      hasLead: true,
      enterprise_name: '企业',
    })
    expect(view.source_refs[0]?.file).toBe('政策.md')
  })

  it('ParkMetrics：漏斗/状态分布/高意向结构', () => {
    const metrics = ParkMetricsSchema.parse({
      funnel: { prospect: 2, active: 1, exiting: 0, exited: 0 },
      lead_status: { proposed: 3 },
      high_score_leads: [{ lead_id: 'l1', enterprise_org_id: 'e', score: 90, status: 'proposed' }],
      totals: { enterprises: 3, inquiries: 5, leads: 3 },
    })
    expect(metrics.funnel.prospect).toBe(2)
    expect(metrics.totals.leads).toBe(3)
  })

  it('RegisterEnterpriseRequest：必填校验与邀请码可选', () => {
    const ok = RegisterEnterpriseRequestSchema.parse({
      phone: '13800000000',
      sms_code: '123456',
      enterprise_name: '星澜智能',
      contact_name: '张三',
    })
    expect(ok.invite_token).toBeUndefined()
    expect(() =>
      RegisterEnterpriseRequestSchema.parse({
        phone: '1',
        sms_code: '',
        enterprise_name: '',
        contact_name: '',
      }),
    ).toThrow()
  })

  it('ServiceCatalog', () => {
    const catalog = ServiceCatalogSchema.parse({
      version: '1',
      items: [{ name: '工商注册协助', description: '全程代办' }],
    })
    expect(catalog.items[0]?.name).toBe('工商注册协助')
  })
})
