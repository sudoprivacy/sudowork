import { describe, expect, it } from 'vitest'
import {
  AssistantAssignmentSchema,
  AssistantCandidatesSchema,
  AuditEventSchema,
  BindableEnterprisesSchema,
  BindingSchema,
  EnterpriseDetailSchema,
  EnterpriseListItemSchema,
  EnterpriseProfileSchema,
  MemberCandidatesSchema,
  ParkAssistantInfoSchema,
  ParkContextSchema,
  ParkMemberSchema,
  RegisterEnterpriseRequestSchema,
  RegisterEnterpriseResponseSchema,
  LeadSchema,
  LeadDetailSchema,
  InquiryViewSchema,
  ParkMetricsSchema,
  PolicySummarySchema,
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
      owner_name: null,
      status: 'proposed',
      created_at: 1,
      updated_at: 1,
    })
    expect(lead.status).toBe('proposed')
    expect(lead.owner_name).toBeNull()
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
      owner_name: null,
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
      high_score_leads: [
        {
          lead_id: 'l1',
          enterprise_org_id: 'e',
          enterprise_name: '星澜智能',
          score: 90,
          status: 'proposed',
        },
      ],
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

  it('RegisterEnterpriseResponse：注册返回三元组', () => {
    const res = RegisterEnterpriseResponseSchema.parse({
      enterprise_org_id: 'e1',
      park_org_id: 'p1',
      user_id: 'u1',
    })
    expect(res.enterprise_org_id).toBe('e1')
    expect(() => RegisterEnterpriseResponseSchema.parse({ enterprise_org_id: 'e1' })).toThrow()
  })

  it('EnterpriseProfile：可空字段与标签数组', () => {
    const profile = EnterpriseProfileSchema.parse({
      enterprise_org_id: 'e1',
      park_org_id: 'p1',
      enterprise_name: '星澜智能',
      industry: null,
      scale: null,
      contact_name: '张三',
      contact_phone: null,
      lifecycle: 'prospect',
      tags: ['AI'],
      created_at: 1,
    })
    expect(profile.tags).toEqual(['AI'])
    expect(profile.industry).toBeNull()
  })

  it('EnterpriseListItem：必填基础 + 可选画像字段', () => {
    const item = EnterpriseListItemSchema.parse({
      enterprise_org_id: 'e1',
      enterprise_name: '星澜智能',
      lifecycle: 'prospect',
      tags: [],
      assigned_owner_id: null,
      created_at: 1,
    })
    expect(item.lead_count).toBeUndefined()
    expect(() => EnterpriseListItemSchema.parse({ enterprise_org_id: 'e1' })).toThrow()
  })

  it('EnterpriseDetail：lead_summary 聚合结构', () => {
    const detail = EnterpriseDetailSchema.parse({
      enterprise_org_id: 'e1',
      park_org_id: 'p1',
      enterprise_name: '星澜智能',
      industry: null,
      scale: null,
      contact_name: null,
      contact_phone: null,
      assigned_owner_id: null,
      assigned_owner_name: null,
      tags: [],
      lifecycle: 'active',
      lead_summary: { total: 3, by_status: { proposed: 2, confirmed: 1 } },
      created_at: 1,
    })
    expect(detail.lead_summary.by_status.proposed).toBe(2)
  })

  it('PolicySummary：wiki 与文件列表', () => {
    const summary = PolicySummarySchema.parse({
      wikis: [{ wiki_id: 'w1', wiki_name: '政策库', files: ['租金.md'] }],
    })
    expect(summary.wikis[0]?.files).toEqual(['租金.md'])
  })

  it('ParkAssistantInfo：完整展示字段（跨 org 可见）', () => {
    const assistant = ParkAssistantInfoSchema.parse({
      assistant_id: 'a1',
      name: 'park-consultation',
      display_name: '园区咨询',
      description: null,
      avatar: null,
      emoji: null,
      enabled_wikis: ['w1'],
    })
    expect(assistant.enabled_wikis).toEqual(['w1'])
  })

  it('AuditEvent：before/after 摘要可空', () => {
    const event = AuditEventSchema.parse({
      audit_id: 'au1',
      action: 'park.lead_claim',
      target_type: 'lead',
      target_id: 'l1',
      target_name: '星澜智能',
      actor_user_id: 'ops',
      actor_name: '运营',
      reason: null,
      before: { status: 'proposed' },
      after: { status: 'confirmed' },
      result: null,
      created_at: 1,
    })
    expect(event.action).toBe('park.lead_claim')
    expect(event.actor_name).toBe('运营')
    expect(() => AuditEventSchema.parse({ audit_id: 'au1' })).toThrow()
  })

  it('ParkMember：三角色枚举', () => {
    const member = ParkMemberSchema.parse({
      id: 'm1',
      park_org_id: 'p1',
      user_id: 'u1',
      user_name: '运营',
      park_role: 'park_ops',
      created_at: 1,
    })
    expect(member.park_role).toBe('park_ops')
    expect(member.user_name).toBe('运营')
    expect(() => ParkMemberSchema.parse({ ...member, park_role: 'admin' })).toThrow()
  })

  it('AssistantAssignment：跨组织分配记录', () => {
    const assignment = AssistantAssignmentSchema.parse({
      id: 'as1',
      park_org_id: 'p1',
      assistant_id: 'a1',
      assistant_name: '园区咨询',
      enterprise_org_id: 'e1',
      enterprise_name: '星澜智能',
      created_at: 1,
    })
    expect(assignment.enterprise_org_id).toBe('e1')
    expect(assignment.assistant_name).toBe('园区咨询')
  })

  it('候选端点：助手 / 未绑定企业 / 成员搜索（admin Modal 下拉）', () => {
    const assistants = AssistantCandidatesSchema.parse({
      items: [{ assistant_id: 'a1', name: 'park-consultation', display_name: '园区咨询' }],
    })
    expect(assistants.items[0]?.display_name).toBe('园区咨询')
    const bindable = BindableEnterprisesSchema.parse({
      items: [{ enterprise_org_id: 'e1', display_name: '未绑企业' }],
    })
    expect(bindable.items[0]?.display_name).toBe('未绑企业')
    const members = MemberCandidatesSchema.parse({
      items: [{ user_id: 'u1', display_name: '张三' }],
    })
    expect(members.items[0]?.user_id).toBe('u1')
  })

  it('Binding：生命周期四态枚举', () => {
    const binding = BindingSchema.parse({
      binding_id: 'b1',
      park_org_id: 'p1',
      enterprise_org_id: 'e1',
      lifecycle: 'prospect',
      relationship_type: null,
      assigned_owner_id: null,
      joined_at: null,
      exited_at: null,
    })
    expect(binding.lifecycle).toBe('prospect')
    expect(() => BindingSchema.parse({ ...binding, lifecycle: 'closed' })).toThrow()
  })
})
