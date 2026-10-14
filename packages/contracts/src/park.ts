import { z } from 'zod'

/**
 * 园区 AI 招商 P0 契约：moss park 业务域 API 的 Zod schema。
 * 原文 ref（question_ref/answer_ref）永不出现——园区侧只见 redacted 字段。
 */

export const ParkContextSchema = z.object({
  org_type: z.enum(['park', 'enterprise']).nullable(),
  park_role: z.enum(['park_leader', 'park_ops', 'park_system_operator']).nullable(),
  park_org_id: z.string().nullable(),
  display_name: z.string().nullable(),
})
export type ParkContext = z.infer<typeof ParkContextSchema>

export const RegisterEnterpriseRequestSchema = z.object({
  phone: z.string().min(5),
  sms_code: z.string().min(1),
  enterprise_name: z.string().min(1),
  contact_name: z.string().min(1),
  invite_token: z.string().optional(),
})
export type RegisterEnterpriseRequest = z.infer<typeof RegisterEnterpriseRequestSchema>

export const RegisterEnterpriseResponseSchema = z.object({
  enterprise_org_id: z.string(),
  park_org_id: z.string(),
  user_id: z.string(),
})

export const EnterpriseProfileSchema = z.object({
  enterprise_org_id: z.string(),
  park_org_id: z.string(),
  enterprise_name: z.string(),
  industry: z.string().nullable(),
  scale: z.string().nullable(),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  lifecycle: z.string(),
  tags: z.array(z.string()),
  created_at: z.number(),
})
export type EnterpriseProfile = z.infer<typeof EnterpriseProfileSchema>

export const EnterpriseListItemSchema = z.object({
  enterprise_org_id: z.string(),
  enterprise_name: z.string(),
  lifecycle: z.string(),
  tags: z.array(z.string()),
  assigned_owner_id: z.string().nullable(),
  created_at: z.number(),
  industry: z.string().nullable().optional(),
  scale: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  lead_count: z.number().optional(),
})

export const EnterpriseDetailSchema = z.object({
  enterprise_org_id: z.string(),
  park_org_id: z.string(),
  enterprise_name: z.string(),
  industry: z.string().nullable(),
  scale: z.string().nullable(),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  assigned_owner_id: z.string().nullable(),
  tags: z.array(z.string()),
  lifecycle: z.string(),
  lead_summary: z.object({
    total: z.number(),
    by_status: z.record(z.string(), z.number()),
  }),
  created_at: z.number(),
})
export type EnterpriseDetail = z.infer<typeof EnterpriseDetailSchema>

export const LeadSchema = z.object({
  lead_id: z.string(),
  park_org_id: z.string(),
  enterprise_org_id: z.string(),
  source: z.enum(['inquiry', 'manual']),
  source_inquiry_id: z.string().nullable(),
  score: z.number().nullable(),
  score_explanation: z.string().nullable(),
  industry_tags: z.array(z.string()),
  policy_matches: z.unknown().nullable(),
  suggested_action: z.string().nullable(),
  owner_id: z.string().nullable(),
  status: z.enum(['proposed', 'confirmed', 'assigned', 'following_up', 'converted', 'lost', 'rejected']),
  created_at: z.number(),
  updated_at: z.number(),
})
export type Lead = z.infer<typeof LeadSchema>

export const LeadDetailSchema = LeadSchema.extend({
  inquiry_summary: z
    .object({
      inquiry_id: z.string(),
      redacted_question: z.string().nullable(),
      redacted_answer: z.string().nullable(),
      intent: z.string().nullable(),
      confidence: z.number().nullable(),
      created_at: z.number(),
    })
    .nullable(),
})
export type LeadDetail = z.infer<typeof LeadDetailSchema>

export const InquiryViewSchema = z.object({
  inquiry_id: z.string(),
  park_org_id: z.string(),
  enterprise_org_id: z.string(),
  user_id: z.string(),
  redacted_question: z.string().nullable(),
  redacted_answer: z.string().nullable(),
  category: z.enum(['consultation', 'service_request']),
  intent: z.string().nullable(),
  confidence: z.number().nullable(),
  source_refs: z.array(
    z.object({ file: z.string(), line_no: z.number(), line: z.string() }),
  ),
  created_at: z.number(),
  hasLead: z.boolean().optional(),
  enterprise_name: z.string().optional(),
})
export type InquiryView = z.infer<typeof InquiryViewSchema>

export const ParkMetricsSchema = z.object({
  funnel: z.record(z.string(), z.number()),
  lead_status: z.record(z.string(), z.number()),
  high_score_leads: z.array(
    z.object({
      lead_id: z.string(),
      enterprise_org_id: z.string(),
      score: z.number(),
      status: z.string(),
    }),
  ),
  totals: z.object({
    enterprises: z.number(),
    inquiries: z.number(),
    leads: z.number(),
  }),
})
export type ParkMetrics = z.infer<typeof ParkMetricsSchema>

export const PolicySummarySchema = z.object({
  wikis: z.array(
    z.object({
      wiki_id: z.string(),
      wiki_name: z.string(),
      files: z.array(z.string()),
    }),
  ),
})
export type PolicySummary = z.infer<typeof PolicySummarySchema>

export const ServiceCatalogSchema = z.object({
  version: z.string(),
  items: z.array(z.object({ name: z.string(), description: z.string().optional() })),
})
export type ServiceCatalog = z.infer<typeof ServiceCatalogSchema>

export const ParkAssistantInfoSchema = z.object({
  assistant_id: z.string(),
  name: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  avatar: z.string().nullable(),
  emoji: z.string().nullable(),
  enabled_wikis: z.array(z.string()),
})
export type ParkAssistantInfo = z.infer<typeof ParkAssistantInfoSchema>

export const AuditEventSchema = z.object({
  audit_id: z.string(),
  action: z.string(),
  target_type: z.string(),
  target_id: z.string().nullable(),
  actor_user_id: z.string(),
  reason: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  result: z.string().nullable(),
  created_at: z.number(),
})
export type AuditEvent = z.infer<typeof AuditEventSchema>

export const ParkMemberSchema = z.object({
  id: z.string(),
  park_org_id: z.string(),
  user_id: z.string(),
  park_role: z.enum(['park_leader', 'park_ops', 'park_system_operator']),
  created_at: z.number(),
})
export type ParkMember = z.infer<typeof ParkMemberSchema>

/** 园区-企业绑定资源（park_enterprise_bindings 读形态；创建端点返回薄确认 { binding_id }）。 */
export const BindingSchema = z.object({
  binding_id: z.string(),
  park_org_id: z.string(),
  enterprise_org_id: z.string(),
  lifecycle: z.enum(['prospect', 'active', 'exiting', 'exited']),
  relationship_type: z.string().nullable(),
  assigned_owner_id: z.string().nullable(),
  joined_at: z.number().nullable(),
  exited_at: z.number().nullable(),
})
export type Binding = z.infer<typeof BindingSchema>

export const AssistantAssignmentSchema = z.object({
  id: z.string(),
  park_org_id: z.string(),
  assistant_id: z.string(),
  enterprise_org_id: z.string(),
  created_at: z.number(),
})
export type AssistantAssignment = z.infer<typeof AssistantAssignmentSchema>
