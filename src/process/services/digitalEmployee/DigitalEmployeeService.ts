/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDefaultAcpModelId } from '@/common/acp/defaultModels';
import type { IDigitalEmployee, IDigitalEmployeeCreateInput, IDigitalEmployeeLaunchInput, IDigitalEmployeeLaunchResult, IDigitalEmployeeResource, IDigitalEmployeeResourceInput, DigitalEmployeeResourceType, IDigitalEmployeeUpdateInput, IDigitalEmployeeWorkRecord } from '@/common/digitalEmployee';
import type { TProviderWithModel } from '@/common/storage';
import { uuid } from '@/common/utils';
import type { AcpBackendAll } from '@/types/acpTypes';
import { getDatabase } from '@process/database';
import type { IQueryResult } from '@process/database/types';
import { ConversationService } from '@process/services/conversationService';
import { mainLog } from '@process/utils/mainLogger';

interface IDigitalEmployeeRow {
  id: string;
  user_id: string;
  name: string;
  role_name: string;
  description: string;
  persona_prompt: string;
  avatar?: string | null;
  source_type: IDigitalEmployee['sourceType'];
  status: IDigitalEmployee['status'];
  backend?: AcpBackendAll | null;
  default_mode?: string | null;
  model_config: string;
  metadata: string;
  created_at: number;
  updated_at: number;
}

interface IDigitalEmployeeResourceRow {
  id: string;
  employee_id: string;
  resource_type: DigitalEmployeeResourceType;
  resource_id: string;
  resource_name?: string | null;
  config: string;
  enabled: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface IDigitalEmployeeWorkRecordRow {
  id: string;
  employee_id: string;
  conversation_id?: string | null;
  title: string;
  status: IDigitalEmployeeWorkRecord['status'];
  summary?: string | null;
  created_at: number;
  updated_at: number;
}

interface IDigitalEmployeeStatsRow {
  employee_id: string;
  work_record_count: number;
  last_worked_at?: number | null;
}

interface ISeedEmployee {
  id: string;
  staffdeckAgentId: string;
  name: string;
  roleName: string;
  description: string;
  personaPrompt: string;
  resources: Array<Omit<IDigitalEmployeeResourceInput, 'sortOrder'> & { id: string }>;
}

const DEFAULT_BACKEND: AcpBackendAll = 'scode';
const STAFFDECK_SEED_VERSION = 2;

const RESOURCE_TYPE_LABELS: Record<DigitalEmployeeResourceType, string> = {
  assistant: '助手',
  skill: '技能',
  general_skill: '通用技能',
  mcp: 'MCP',
  knowledge: '知识库',
  sop: 'SOP',
  tool: '工具',
};

const STAFFDECK_RESOURCE_DETAILS: Record<string, Record<string, unknown>> = {
  skill_1161c63fbfef49db: {
    staffdeckSkillId: 'skill_1161c63fbfef49db',
    businessSkillId: 'partner_onboarding_dd',
    businessDomain: '采购与供应链合规',
    goals: ['完成新合作方背景调查', '输出合规入库意见或升级法务'],
    nodes: ['收集合作方基本信息', '检索历史合同与涉诉记录', '尽调合规判定', '出具入库意见', '风险升级法务专员'],
  },
  skill_14ba724b7b4649ff: {
    staffdeckSkillId: 'skill_14ba724b7b4649ff',
    businessSkillId: 'leave_apply_v1',
    businessDomain: '人力资源',
    goals: ['完成请假申请提交或转交HR处理'],
    nodes: ['收集请假基本信息', '检索假期政策', '查询假期余额', '判定是否符合条件', '确认请假申请详情', '提交请假申请', '转交HR负责人', '回复申请成功'],
  },
  skill_267c8402280545bc: {
    staffdeckSkillId: 'skill_267c8402280545bc',
    businessSkillId: 'skill_office_supply_request',
    businessDomain: '行政后勤',
    goals: ['收集申领信息', '判断审批规则', '完成登记或转交审批', '反馈处理结果'],
    nodes: ['收集申领信息', '审批规则判断', '直接登记确认', '主管审批确认', '提交申领登记', '转交行政主管', '结果反馈'],
  },
  skill_450216e2d92c4c82: {
    staffdeckSkillId: 'skill_450216e2d92c4c82',
    businessSkillId: 'skill_perm_grant_routing_001',
    businessDomain: 'IT服务与权限管理',
    goals: ['准确收集员工工号、目标系统、权限级别及访问范围', '根据权限敏感度自动分流处理路径', '普通权限自动开通并返回结果，高权限安全转交人工审批'],
    nodes: ['收集权限申请信息', '权限级别分流判断', '权限开通确认', '调用权限开通接口', '开通成功回复', '转交IT主管审批', '开通失败处理'],
  },
  skill_46adc7884618470c: {
    staffdeckSkillId: 'skill_46adc7884618470c',
    businessSkillId: 'skill_hr_cert_issue_001',
    businessDomain: 'HR员工服务',
    goals: ['收集员工身份及证明需求信息', '核对并确认关键开具参数', '调用系统接口生成证明文书', '特殊用途按规定转交审批流程'],
    nodes: ['收集证明需求信息', '判断用途是否需审批', '确认开具信息', '调用证明开具接口', '返回开具结果', '转接人工审批', '处理开具失败'],
  },
  skill_47993266379d4269: {
    staffdeckSkillId: 'skill_47993266379d4269',
    businessSkillId: 'expense_over_limit_approval',
    businessDomain: '财务报销',
    goals: ['收集超标金额与超标原因', '计算超标比例并路由审批链', '生成特批申请单', '告知用户审批时效'],
    nodes: ['收集超标信息', '审批链路由与确认', '生成特批申请单', '告知审批结果与时效'],
  },
  skill_4d7c5c2505d6418a: {
    staffdeckSkillId: 'skill_4d7c5c2505d6418a',
    businessSkillId: 'skill_overtime_compensatory_leave',
    businessDomain: 'HR考勤与假期管理',
    goals: ['完成加班调休申请的信息收集', '核对调休政策与额度', '提交调休申请并返回结果', '异常情形转交HR负责人'],
    nodes: ['收集加班调休基础信息', '查询假期余额与加班记录', '核对调休条件与折算比例', '确认调休申请信息', '提交调休申请', '返回申请结果', '转交HR负责人'],
  },
  skill_682bf14c3a904510: {
    staffdeckSkillId: 'skill_682bf14c3a904510',
    businessSkillId: 'skill_meeting_room_book',
    businessDomain: '行政办公服务',
    goals: ['完成会议室预订', '告知预订结果与会议室信息', '按需设置会议前提醒'],
    nodes: ['收集预订信息', '检查信息完整性', '确认预订详情', '调用会议室预订接口', '输出预订结果'],
  },
  skill_7d69abc5aebe4fc4: {
    staffdeckSkillId: 'skill_7d69abc5aebe4fc4',
    businessSkillId: 'fault_report_v1',
    businessDomain: 'general',
    goals: ['收集故障现象和影响范围', '如无法提供自助方案，登记工单并转交人工工程师'],
    nodes: ['开始', '收集故障信息', '无法自助解决', '登记工单', '工单已登记并转人工'],
  },
  skill_9762a830431243b1: {
    staffdeckSkillId: 'skill_9762a830431243b1',
    businessSkillId: 'contract_risk_review',
    businessDomain: '法务与合同管理',
    goals: ['识别合同类型与核心条款', '对照审查标准清单逐条核查', '检索历史判例作为法律依据', '输出风险点与修改建议', '高风险或无先例时升级处理'],
    nodes: ['收集合同信息', '检索审查标准', '检索历史判例', '评估风险等级', '输出审查报告', '升级法务专员'],
  },
  skill_a3b641f12d7349da: {
    staffdeckSkillId: 'skill_a3b641f12d7349da',
    businessSkillId: 'expense_travel_reimbursement',
    businessDomain: '财务报销',
    goals: ['完成差旅报销申请的信息收集', '根据差旅补助标准自动判断是否超标', '超标时转入人工财务负责人审批', '未超标时收集发票信息', '用户确认后提交报销单并反馈结果'],
    nodes: ['收集报销基本信息', '查询差旅补助标准', '判断是否超标', '收集发票信息', '确认报销信息并提交', '转交财务负责人审批', '结束回复'],
  },
  skill_b5c89be95a514c31: {
    staffdeckSkillId: 'skill_b5c89be95a514c31',
    businessSkillId: 'skill_leave_balance_query',
    businessDomain: '人力资源/员工服务',
    goals: ['准确识别员工身份与假期类型', '调用系统查询假期已用/剩余天数及有效期', '清晰反馈查询结果'],
    nodes: ['收集员工工号与假期类型', '调用假期余额查询接口', '回复假期余额结果', '处理查询异常或转人工'],
  },
  skill_c78c1c52fb614c12: {
    staffdeckSkillId: 'skill_c78c1c52fb614c12',
    businessSkillId: 'skill_clause_modification',
    businessDomain: '法务与合同管理',
    goals: ['明确待修改条款内容及用户具体诉求', '检索并对照相关合规要求或历史判例', '生成修改后的条款表述及详细理由', '输出完整建议并提示法务复核'],
    nodes: ['收集修改诉求', '检索合规与判例参考', '输出修改建议与理由'],
  },
  skill_cf26a936ba7241a6: {
    staffdeckSkillId: 'skill_cf26a936ba7241a6',
    businessSkillId: 'seal_application_approval',
    businessDomain: '行政与印章管理',
    goals: ['收集用章类型、用途及文件信息', '核对用章管理规定', '判断是否属于重要合同', '完成用印登记或转交审批'],
    nodes: ['收集用章基础信息', '检索用章管理规定', '合规与重要性判定', '申请信息确认', '普通用章登记转交', '重要合同审批转交', '不合规申请回复'],
  },
  skill_ede3a4d634404794: {
    staffdeckSkillId: 'skill_ede3a4d634404794',
    businessSkillId: 'skill_expense_quota_query',
    businessDomain: '财务报销',
    goals: ['获取员工指定月份或当月的报销总额度、已用金额及剩余额度', '支持按月份查询，默认查询当月', '清晰反馈额度明细与币种'],
    nodes: ['收集查询条件', '调用额度查询接口', '返回额度结果'],
  },
  'admin.room_book': {
    staffdeckToolId: 'tool_962e7019ed4f4370',
    displayName: '会议室预订',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/admin/room_book',
    requiredFields: ['employee_id', 'date', 'start_time', 'end_time'],
    inputFields: ['employee_id', 'employee_name', 'date', 'start_time', 'end_time', 'attendees', 'equipment', 'room_preference', 'topic'],
    outputFields: ['booking_id', 'status', 'room_name', 'capacity', 'location', 'date', 'time_slot', 'alternatives', 'message'],
  },
  'admin.supply_request': {
    staffdeckToolId: 'tool_28bfd6abf6454953',
    displayName: '办公用品申领',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/admin/supply_request',
    requiredFields: ['employee_id', 'items'],
    inputFields: ['employee_id', 'employee_name', 'department', 'items', 'reason', 'needed_by'],
    outputFields: ['request_id', 'status', 'approved_items', 'pickup_location', 'message', 'submitted_at'],
  },
  'contract.archive_query': {
    staffdeckToolId: 'tool_c27c82b0bdb146ec',
    displayName: '合同判例检索',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/contract/archive_query',
    requiredFields: ['query'],
    inputFields: ['query', 'doc_type', 'keywords', 'date_from', 'date_to', 'top_k'],
    outputFields: ['query', 'total', 'results', 'message'],
  },
  'expense.quota_query': {
    staffdeckToolId: 'tool_ffcb6ab0306f412d',
    displayName: '报销额度查询',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/expense/quota_query',
    requiredFields: ['employee_id'],
    inputFields: ['employee_id', 'month'],
    outputFields: ['employee_id', 'month', 'total_quota', 'used', 'remaining', 'currency', 'message'],
  },
  'expense.submit': {
    staffdeckToolId: 'tool_7ff3a99fb1e745ed',
    displayName: '报销单提交',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/expense/submit',
    requiredFields: ['employee_id', 'category', 'amount'],
    inputFields: ['employee_id', 'employee_name', 'category', 'amount', 'currency', 'invoice_no', 'expense_date', 'description'],
    outputFields: ['expense_id', 'status', 'message', 'submitted_at'],
  },
  'hr.balance_query': {
    staffdeckToolId: 'tool_a85461cd17ab4ca1',
    displayName: '假期考勤查询',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/hr/balance_query',
    requiredFields: ['employee_id'],
    inputFields: ['employee_id', 'month', 'include_attendance'],
    outputFields: ['employee_id', 'month', 'leave_balance', 'attendance', 'message'],
  },
  'hr.cert_issue': {
    staffdeckToolId: 'tool_ecba5f40d1f048c2',
    displayName: '在职收入证明开具',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/hr/cert_issue',
    requiredFields: ['employee_id', 'cert_type'],
    inputFields: ['employee_id', 'employee_name', 'cert_type', 'purpose', 'language', 'include_income'],
    outputFields: ['cert_id', 'status', 'cert_type', 'content', 'download_url', 'message', 'issued_at'],
  },
  'hr.leave_apply': {
    staffdeckToolId: 'tool_1d6aa1c5ced942bd',
    displayName: '请假调休申请',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/hr/leave_apply',
    requiredFields: ['employee_id', 'leave_type', 'start_date', 'end_date'],
    inputFields: ['employee_id', 'employee_name', 'leave_type', 'start_date', 'end_date', 'days', 'reason'],
    outputFields: ['application_id', 'status', 'approver', 'message', 'submitted_at'],
  },
  'invoice.verify': {
    staffdeckToolId: 'tool_d65ea7f31c424a94',
    displayName: '发票查验',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/invoice/verify',
    requiredFields: ['invoice_code', 'invoice_number'],
    inputFields: ['invoice_code', 'invoice_number', 'invoice_date', 'amount', 'check_code', 'seller', 'buyer'],
    outputFields: ['authentic', 'fields_complete', 'missing_fields', 'risk_level', 'message'],
  },
  'it.grant_permission': {
    staffdeckToolId: 'tool_9122b5c6804b4d17',
    displayName: '系统权限开通',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/it/grant_permission',
    requiredFields: ['employee_id', 'system', 'permission'],
    inputFields: ['employee_id', 'employee_name', 'system', 'permission', 'access_level', 'reason', 'duration'],
    outputFields: ['grant_id', 'status', 'system', 'permission', 'approver', 'effective_at', 'message'],
  },
  'it.ticket_create': {
    staffdeckToolId: 'tool_d75c1fe0a1754626',
    displayName: 'IT工单登记',
    method: 'POST',
    url: 'http://58.57.119.30:52008/api/mock/it/ticket_create',
    requiredFields: ['employee_id', 'title'],
    inputFields: ['employee_id', 'employee_name', 'category', 'title', 'description', 'priority', 'contact'],
    outputFields: ['ticket_id', 'status', 'priority', 'category', 'assignee', 'sla', 'message', 'created_at'],
  },
};

const STAFFDECK_SEED_EMPLOYEES: ISeedEmployee[] = [
  {
    id: 'de_staffdeck_finance',
    staffdeckAgentId: 'agent_f2828efc2a2a476d',
    name: '财务',
    roleName: '报销管家',
    description: '熟悉公司报销、差旅、预算与发票全流程，能解答报销政策、核对单据合规性、发起报销与额度查询，遇到超标或特殊情形时把问题带上下文交还给财务负责人。',
    personaPrompt: '你是 StaffDeck 财务数字员工，负责把报销和票据事项拆成清晰步骤，校验材料完整性，提示风险，并在需要审批时生成可执行的交接说明。',
    resources: [
      { id: 'der_staffdeck_finance_01', resourceType: 'knowledge', resourceId: 'kb_894511261b6d402f', resourceName: '财务-报销政策手册', config: { summary: '由文档 财务-报销政策手册.md 创建', staffdeckKnowledgeBaseId: 'kb_894511261b6d402f' } },
      { id: 'der_staffdeck_finance_02', resourceType: 'knowledge', resourceId: 'kb_5f26d5f1fceb4f02', resourceName: '财务-发票与单据规范', config: { summary: '由文档 财务-发票与单据规范.md 创建', staffdeckKnowledgeBaseId: 'kb_5f26d5f1fceb4f02' } },
      { id: 'der_staffdeck_finance_03', resourceType: 'knowledge', resourceId: 'kb_067d71b1f22c48bc', resourceName: '财务-报销办理流程说明', config: { summary: '由文档 财务-报销办理流程说明.md 创建', staffdeckKnowledgeBaseId: 'kb_067d71b1f22c48bc' } },
      {
        id: 'der_staffdeck_finance_04',
        resourceType: 'general_skill',
        resourceId: 'genskill_d471d37e88fa45bb',
        resourceName: '票据字段提取',
        config: { summary: '从发票文本 / 图片中提取金额、抬头、税号等结构化字段', staffdeckGeneralSkillId: 'genskill_d471d37e88fa45bb', slug: 'bill-field-extract' },
      },
      { id: 'der_staffdeck_finance_05', resourceType: 'general_skill', resourceId: 'genskill_7ac06bdc04594d58', resourceName: '数据统计分析', config: { summary: '对报销明细做汇总、分类统计', staffdeckGeneralSkillId: 'genskill_7ac06bdc04594d58', slug: 'data-statistical-analysis' } },
      {
        id: 'der_staffdeck_finance_06',
        resourceType: 'tool',
        resourceId: 'expense.submit',
        resourceName: 'expense.submit',
        config: { summary: '提交报销单，返回报销单号与受理状态', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/expense/submit', staffdeckToolId: 'tool_7ff3a99fb1e745ed' },
      },
      {
        id: 'der_staffdeck_finance_07',
        resourceType: 'tool',
        resourceId: 'expense.quota_query',
        resourceName: 'expense.quota_query',
        config: { summary: '查询员工本月报销额度（已用 / 剩余）', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/expense/quota_query', staffdeckToolId: 'tool_ffcb6ab0306f412d' },
      },
      {
        id: 'der_staffdeck_finance_08',
        resourceType: 'tool',
        resourceId: 'invoice.verify',
        resourceName: 'invoice.verify',
        config: { summary: '校验发票真伪与要素完整性', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/invoice/verify', staffdeckToolId: 'tool_d65ea7f31c424a94' },
      },
      {
        id: 'der_staffdeck_finance_09',
        resourceType: 'sop',
        resourceId: 'skill_ede3a4d634404794',
        resourceName: '报销额度查询',
        config: { summary: '识别用户查询报销额度的意图，收集员工工号与查询月份，调用额度查询接口获取已用与剩余额度并反馈。', staffdeckSkillId: 'skill_ede3a4d634404794', businessDomain: '财务报销' },
      },
      {
        id: 'der_staffdeck_finance_10',
        resourceType: 'sop',
        resourceId: 'skill_47993266379d4269',
        resourceName: '超标报销特批',
        config: { summary: '处理用户差旅报销超标情况，收集超标金额与原因，按超标比例自动路由审批链，生成特批申请单并告知预计时效。', staffdeckSkillId: 'skill_47993266379d4269', businessDomain: '财务报销' },
      },
      {
        id: 'der_staffdeck_finance_11',
        resourceType: 'sop',
        resourceId: 'skill_a3b641f12d7349da',
        resourceName: '差旅报销申请',
        config: { summary: '帮助员工提交差旅报销申请：收集报销事由、金额、行程，核对差旅补助标准，超标时转交财务负责人审批，未超标时收集发票信息，确认后提交报销单。', staffdeckSkillId: 'skill_a3b641f12d7349da', businessDomain: '财务报销' },
      },
    ],
  },
  {
    id: 'de_staffdeck_legal',
    staffdeckAgentId: 'agent_7d062081c03b4e16',
    name: '法务',
    roleName: '合规审查官',
    description: '覆盖合同审查、条款风险识别与合规咨询，依据企业合规制度和历史判例给出审查意见，遇到高风险或无先例的条款自动升级给法务专员。',
    personaPrompt: '你是 StaffDeck 法务数字员工，负责识别合同和合作方流程中的合规风险，输出风险分级、修改建议和需要人工法务确认的问题清单。',
    resources: [
      { id: 'der_staffdeck_legal_01', resourceType: 'knowledge', resourceId: 'kb_dee9ad74d3a24492', resourceName: '法务-历史条款判例库', config: { summary: '由文档 法务-历史条款判例库.md 创建', staffdeckKnowledgeBaseId: 'kb_dee9ad74d3a24492' } },
      { id: 'der_staffdeck_legal_02', resourceType: 'knowledge', resourceId: 'kb_43fee5729c5e4c98', resourceName: '法务-企业合规制度汇编', config: { summary: '由文档 法务-企业合规制度汇编.md 创建', staffdeckKnowledgeBaseId: 'kb_43fee5729c5e4c98' } },
      { id: 'der_staffdeck_legal_03', resourceType: 'knowledge', resourceId: 'kb_5aa59d228eb54e4d', resourceName: '法务-合同审查标准清单', config: { summary: '由文档 法务-合同审查标准清单.md 创建', staffdeckKnowledgeBaseId: 'kb_5aa59d228eb54e4d' } },
      { id: 'der_staffdeck_legal_04', resourceType: 'knowledge', resourceId: 'kb_94d8f9e7ffb24fb0', resourceName: '法务-高风险条款识别指南', config: { summary: '由文档 法务-高风险条款识别指南.md 创建', staffdeckKnowledgeBaseId: 'kb_94d8f9e7ffb24fb0' } },
      { id: 'der_staffdeck_legal_05', resourceType: 'general_skill', resourceId: 'genskill_74c4d318e3c34c79', resourceName: '合同条款提取', config: { summary: '从合同文本中拆解出付款、违约、保密等关键条款', staffdeckGeneralSkillId: 'genskill_74c4d318e3c34c79', slug: 'contract-term-extraction' } },
      {
        id: 'der_staffdeck_legal_06',
        resourceType: 'tool',
        resourceId: 'contract.archive_query',
        resourceName: 'contract.archive_query',
        config: { summary: '检索历史合同与判例库', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/contract/archive_query', staffdeckToolId: 'tool_c27c82b0bdb146ec' },
      },
      {
        id: 'der_staffdeck_legal_07',
        resourceType: 'sop',
        resourceId: 'skill_9762a830431243b1',
        resourceName: '合同条款风险审查',
        config: { summary: '自动识别合同类型，对照审查标准核查条款，检索历史判例依据，输出风险点与修改建议；高风险或无先例时升级至法务专员。', staffdeckSkillId: 'skill_9762a830431243b1', businessDomain: '法务与合同管理' },
      },
      { id: 'der_staffdeck_legal_08', resourceType: 'sop', resourceId: 'skill_1161c63fbfef49db', resourceName: '合作方入库尽调', config: { summary: '新合作方入库前的背景调查与合规核查流程', staffdeckSkillId: 'skill_1161c63fbfef49db', businessDomain: '采购与供应链合规' } },
      {
        id: 'der_staffdeck_legal_09',
        resourceType: 'sop',
        resourceId: 'skill_c78c1c52fb614c12',
        resourceName: '条款修改建议',
        config: { summary: '协助用户明确合同修改诉求，检索相关合规要求与历史判例，生成修改后的条款表述及合规理由。', staffdeckSkillId: 'skill_c78c1c52fb614c12', businessDomain: '法务与合同管理' },
      },
    ],
  },
  {
    id: 'de_staffdeck_hr',
    staffdeckAgentId: 'agent_9d3d1fdf171049ed',
    name: '人事',
    roleName: '员工服务助手',
    description: '面向全体在职员工的 HR 服务窗口，解答假期、社保公积金、薪酬福利、考勤等高频制度问题，可发起请假 / 开具在职证明等事务申请，遇到超出制度规定或需要人工判断的情形交还给 HR 负责人。',
    personaPrompt: '你是 StaffDeck 人事数字员工，负责按员工服务政策收集必要信息、核对规则、生成办理结果，并在政策冲突或敏感场景中建议转人工。',
    resources: [
      { id: 'der_staffdeck_hr_01', resourceType: 'knowledge', resourceId: 'kb_02d1509fe23c4984', resourceName: '人事-薪酬福利与证明办理指南', config: { summary: '由文档 人事-薪酬福利与证明办理指南.md 创建', staffdeckKnowledgeBaseId: 'kb_02d1509fe23c4984' } },
      { id: 'der_staffdeck_hr_02', resourceType: 'knowledge', resourceId: 'kb_f1a95c02b53e49ed', resourceName: '人事-社保公积金政策说明', config: { summary: '由文档 人事-社保公积金政策说明.md 创建', staffdeckKnowledgeBaseId: 'kb_f1a95c02b53e49ed' } },
      { id: 'der_staffdeck_hr_03', resourceType: 'knowledge', resourceId: 'kb_b647bfb9822c4e80', resourceName: '人事-员工手册与假期政策', config: { summary: '由文档 人事-员工手册与假期政策.md 创建', staffdeckKnowledgeBaseId: 'kb_b647bfb9822c4e80' } },
      {
        id: 'der_staffdeck_hr_04',
        resourceType: 'tool',
        resourceId: 'hr.leave_apply',
        resourceName: 'hr.leave_apply',
        config: { summary: '提交请假 / 调休申请', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/hr/leave_apply', staffdeckToolId: 'tool_1d6aa1c5ced942bd' },
      },
      { id: 'der_staffdeck_hr_05', resourceType: 'tool', resourceId: 'hr.cert_issue', resourceName: 'hr.cert_issue', config: { summary: '开具在职 / 收入证明', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/hr/cert_issue', staffdeckToolId: 'tool_ecba5f40d1f048c2' } },
      {
        id: 'der_staffdeck_hr_06',
        resourceType: 'tool',
        resourceId: 'hr.balance_query',
        resourceName: 'hr.balance_query',
        config: { summary: '查询假期余额与考勤记录', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/hr/balance_query', staffdeckToolId: 'tool_a85461cd17ab4ca1' },
      },
      { id: 'der_staffdeck_hr_07', resourceType: 'general_skill', resourceId: 'genskill_0051132033724b98', resourceName: '数据统计分析', config: { summary: '部门考勤、假期余额等 HR 数据统计', staffdeckGeneralSkillId: 'genskill_0051132033724b98', slug: 'statistical-data-analysis' } },
      { id: 'der_staffdeck_hr_08', resourceType: 'general_skill', resourceId: 'genskill_db937dd1fe4c4aec', resourceName: '证明文书生成', config: { summary: '按模板生成在职证明、收入证明等文书', staffdeckGeneralSkillId: 'genskill_db937dd1fe4c4aec', slug: 'document-generation-for-proofs' } },
      {
        id: 'der_staffdeck_hr_09',
        resourceType: 'sop',
        resourceId: 'skill_4d7c5c2505d6418a',
        resourceName: '加班调休申请',
        config: { summary: '支持员工自助申请加班调休，自动收集关键信息、核对政策与额度、确认并提交申请，异常情形自动转交HR负责人。', staffdeckSkillId: 'skill_4d7c5c2505d6418a', businessDomain: 'HR考勤与假期管理' },
      },
      { id: 'der_staffdeck_hr_10', resourceType: 'sop', resourceId: 'skill_46adc7884618470c', resourceName: '在职证明开具', config: { summary: '协助员工开具在职证明或收入证明，支持常规用途自动开具与特殊用途审批转接。', staffdeckSkillId: 'skill_46adc7884618470c', businessDomain: 'HR员工服务' } },
      {
        id: 'der_staffdeck_hr_11',
        resourceType: 'sop',
        resourceId: 'skill_b5c89be95a514c31',
        resourceName: '假期余额查询',
        config: { summary: '员工查询假期余额时，识别要查的假期类型（年假 / 调休 / 病假），调用余额查询接口返回已用和剩余天数，并提示有效期。', staffdeckSkillId: 'skill_b5c89be95a514c31', businessDomain: '人力资源/员工服务' },
      },
      {
        id: 'der_staffdeck_hr_12',
        resourceType: 'sop',
        resourceId: 'skill_14ba724b7b4649ff',
        resourceName: '请假申请办理',
        config: { summary: '员工申请请假时，收集请假类型、起止时间和事由，核对假期政策并查询假期余额，符合条件则提交请假申请，否则转交HR负责人', staffdeckSkillId: 'skill_14ba724b7b4649ff', businessDomain: '人力资源' },
      },
    ],
  },
  {
    id: 'de_staffdeck_it',
    staffdeckAgentId: 'agent_258e75c664b34151',
    name: 'IT',
    roleName: '内部支持工程师',
    description: '处理账号权限、设备申领、常见故障排查等 IT 服务请求，能按 SOP 分流工单、调用内部系统接口开通权限，复杂问题转交人工工程师。',
    personaPrompt: '你是 StaffDeck IT 数字员工，负责把内部支持请求拆成可执行工单，先定位影响范围和紧急程度，再选择权限、账号、网络或设备处理路径。',
    resources: [
      { id: 'der_staffdeck_it_01', resourceType: 'knowledge', resourceId: 'kb_a20ad54438a349d8', resourceName: 'IT-服务目录与权限说明', config: { summary: '由文档 IT-服务目录与权限说明.md 创建', staffdeckKnowledgeBaseId: 'kb_a20ad54438a349d8' } },
      { id: 'der_staffdeck_it_02', resourceType: 'knowledge', resourceId: 'kb_6170222d9b2a41c4', resourceName: 'IT-常见故障排查手册', config: { summary: '由文档 IT-常见故障排查手册.md 创建', staffdeckKnowledgeBaseId: 'kb_6170222d9b2a41c4' } },
      {
        id: 'der_staffdeck_it_03',
        resourceType: 'tool',
        resourceId: 'it.grant_permission',
        resourceName: 'it.grant_permission',
        config: { summary: '开通系统权限', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/it/grant_permission', staffdeckToolId: 'tool_9122b5c6804b4d17' },
      },
      { id: 'der_staffdeck_it_04', resourceType: 'tool', resourceId: 'it.ticket_create', resourceName: 'it.ticket_create', config: { summary: '登记 IT 工单', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/it/ticket_create', staffdeckToolId: 'tool_d75c1fe0a1754626' } },
      { id: 'der_staffdeck_it_05', resourceType: 'general_skill', resourceId: 'genskill_0e98d0473cf1469a', resourceName: '日志分析', config: { summary: '分析报错日志、定位问题原因', staffdeckGeneralSkillId: 'genskill_0e98d0473cf1469a', slug: 'log-analysis' } },
      { id: 'der_staffdeck_it_06', resourceType: 'general_skill', resourceId: 'genskill_449f4bd354274d40', resourceName: '文本翻译', config: { summary: '翻译英文报错信息与技术文档', staffdeckGeneralSkillId: 'genskill_449f4bd354274d40', slug: 'text-translation' } },
      { id: 'der_staffdeck_it_07', resourceType: 'general_skill', resourceId: 'genskill_d49afcdc8a424dbe', resourceName: '诊断脚本执行', config: { summary: '在沙箱内运行诊断脚本并返回结果', staffdeckGeneralSkillId: 'genskill_d49afcdc8a424dbe', slug: 'diagnostic-script-execution' } },
      {
        id: 'der_staffdeck_it_08',
        resourceType: 'sop',
        resourceId: 'skill_450216e2d92c4c82',
        resourceName: '权限开通工单分流',
        config: { summary: '处理用户系统权限申请，自动收集关键信息并根据权限级别分流：普通权限自动调用接口开通，高权限（生产环境/敏感数据）转交IT主管审批。', staffdeckSkillId: 'skill_450216e2d92c4c82', businessDomain: 'IT服务与权限管理' },
      },
      {
        id: 'der_staffdeck_it_09',
        resourceType: 'sop',
        resourceId: 'skill_7d69abc5aebe4fc4',
        resourceName: '故障报修受理',
        config: { summary: '用户报修故障时，先收集故障现象和影响范围，由于无法自动检索故障排查手册，直接登记工单转交人工工程师。', staffdeckSkillId: 'skill_7d69abc5aebe4fc4', businessDomain: 'general' },
      },
    ],
  },
  {
    id: 'de_staffdeck_admin',
    staffdeckAgentId: 'agent_30b8f623c6fe445b',
    name: '行政',
    roleName: '事务管家',
    description: '统筹会议室预订、办公用品申领、用章申请等行政事务，把琐碎的事务性沟通标准化，让行政团队从重复问答中解放出来。',
    personaPrompt: '你是 StaffDeck 行政数字员工，负责快速收集行政事务所需字段，检查库存、时间和审批要求，输出可直接提交的办理单。',
    resources: [
      { id: 'der_staffdeck_admin_01', resourceType: 'knowledge', resourceId: 'kb_8e03cb0777a44f50', resourceName: '行政-会议室与用章管理规定', config: { summary: '由文档 行政-会议室与用章管理规定.md 创建', staffdeckKnowledgeBaseId: 'kb_8e03cb0777a44f50' } },
      { id: 'der_staffdeck_admin_02', resourceType: 'knowledge', resourceId: 'kb_eb7d5194c1b04805', resourceName: '行政-行政服务手册', config: { summary: '由文档 行政-行政服务手册.md 创建', staffdeckKnowledgeBaseId: 'kb_eb7d5194c1b04805' } },
      {
        id: 'der_staffdeck_admin_03',
        resourceType: 'tool',
        resourceId: 'admin.room_book',
        resourceName: 'admin.room_book',
        config: { summary: '查询并预订会议室', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/admin/room_book', staffdeckToolId: 'tool_962e7019ed4f4370' },
      },
      {
        id: 'der_staffdeck_admin_04',
        resourceType: 'tool',
        resourceId: 'admin.supply_request',
        resourceName: 'admin.supply_request',
        config: { summary: '办公用品申领登记', staffdeckTool: true, method: 'POST', url: 'http://58.57.119.30:52008/api/mock/admin/supply_request', staffdeckToolId: 'tool_28bfd6abf6454953' },
      },
      { id: 'der_staffdeck_admin_05', resourceType: 'general_skill', resourceId: 'genskill_56e8f6f45a8b4aa0', resourceName: '数据统计分析', config: { summary: '办公用品库存、会议室使用率统计', staffdeckGeneralSkillId: 'genskill_56e8f6f45a8b4aa0', slug: 'admin-data-analysis' } },
      {
        id: 'der_staffdeck_admin_06',
        resourceType: 'sop',
        resourceId: 'skill_682bf14c3a904510',
        resourceName: '会议室预订',
        config: { summary: '支持用户通过自然语言收集预订信息、确认详情、调用系统接口完成会议室预订，并反馈结果与提醒设置。', staffdeckSkillId: 'skill_682bf14c3a904510', businessDomain: '行政办公服务' },
      },
      {
        id: 'der_staffdeck_admin_07',
        resourceType: 'sop',
        resourceId: 'skill_267c8402280545bc',
        resourceName: '办公用品申领',
        config: { summary: '处理用户办公用品申领请求，收集物品与数量，依据规定判断审批路径，完成系统登记或转交主管审批，并反馈结果。', staffdeckSkillId: 'skill_267c8402280545bc', businessDomain: '行政后勤' },
      },
      {
        id: 'der_staffdeck_admin_08',
        resourceType: 'sop',
        resourceId: 'skill_cf26a936ba7241a6',
        resourceName: '用章申请审批',
        config: { summary: '处理用户用章申请，核对用章类型与用途，依据管理规定进行合规判断，区分普通用章登记与重要合同审批流转。', staffdeckSkillId: 'skill_cf26a936ba7241a6', businessDomain: '行政与印章管理' },
      },
    ],
  },
];

function getNow(): number {
  return Date.now();
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed persisted metadata
  }
  return {};
}

function stringifyJsonObject(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {});
}

function getSeedVersion(metadata: Record<string, unknown>): number {
  const version = metadata.seedVersion;
  return typeof version === 'number' ? version : 0;
}

function buildSeedMetadata(employee: ISeedEmployee, existingMetadata?: string): string {
  return JSON.stringify({
    ...parseJsonObject(existingMetadata),
    importedFrom: 'StaffDeck',
    seedVersion: STAFFDECK_SEED_VERSION,
    staffdeckAgentId: employee.staffdeckAgentId,
  });
}

function mergeStaffDeckResourceDetails(resource: IDigitalEmployeeResource | IDigitalEmployeeResourceInput): Record<string, unknown> {
  return {
    ...(STAFFDECK_RESOURCE_DETAILS[resource.resourceId] || {}),
    ...(resource.config || {}),
  };
}

function getStringConfig(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getStringArrayConfig(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function formatContextList(label: string, values: string[]): string | undefined {
  return values.length ? `${label}: ${values.join(', ')}` : undefined;
}

function requireQueryResult<T>(result: IQueryResult<T>, action: string): T {
  if (!result.success) {
    throw new Error(result.error || `Failed to ${action}`);
  }
  return result.data as T;
}

function normalizeText(value: string | undefined, fallback = ''): string {
  return value?.trim() || fallback;
}

function rowToResource(row: IDigitalEmployeeResourceRow): IDigitalEmployeeResource {
  return {
    id: row.id,
    employeeId: row.employee_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceName: row.resource_name || undefined,
    config: parseJsonObject(row.config),
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkRecord(row: IDigitalEmployeeWorkRecordRow): IDigitalEmployeeWorkRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    conversationId: row.conversation_id || undefined,
    title: row.title,
    status: row.status,
    summary: row.summary || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEmployee(row: IDigitalEmployeeRow, resources: IDigitalEmployeeResource[], stats?: IDigitalEmployeeStatsRow): IDigitalEmployee {
  return {
    id: row.id,
    name: row.name,
    roleName: row.role_name,
    description: row.description,
    personaPrompt: row.persona_prompt,
    avatar: row.avatar || undefined,
    sourceType: row.source_type,
    status: row.status,
    backend: row.backend || undefined,
    defaultMode: row.default_mode || undefined,
    modelConfig: parseJsonObject(row.model_config),
    metadata: parseJsonObject(row.metadata),
    resources,
    workRecordCount: stats?.work_record_count ?? 0,
    lastWorkedAt: stats?.last_worked_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildResourceContext(resources: IDigitalEmployeeResource[]): string {
  const enabledResources = resources.filter((resource) => resource.enabled).sort((a, b) => a.sortOrder - b.sortOrder || a.resourceName?.localeCompare(b.resourceName || '') || 0);

  if (!enabledResources.length) {
    return '- 暂无绑定资源。';
  }

  return enabledResources
    .map((resource) => {
      const label = RESOURCE_TYPE_LABELS[resource.resourceType];
      const name = resource.resourceName || resource.resourceId;
      const config = mergeStaffDeckResourceDetails(resource);
      const businessDomain = getStringConfig(config, 'businessDomain');
      const method = getStringConfig(config, 'method');
      const url = getStringConfig(config, 'url');
      const details = [
        getStringConfig(config, 'summary'),
        getStringConfig(config, 'displayName') ? `显示名: ${getStringConfig(config, 'displayName')}` : undefined,
        businessDomain ? `领域: ${businessDomain}` : undefined,
        formatContextList('目标', getStringArrayConfig(config, 'goals')),
        formatContextList('流程', getStringArrayConfig(config, 'nodes')),
        method || url ? `调用: ${[method, url].filter(Boolean).join(' ')}` : undefined,
        formatContextList('必填字段', getStringArrayConfig(config, 'requiredFields')),
        formatContextList('输入字段', getStringArrayConfig(config, 'inputFields')),
        formatContextList('输出字段', getStringArrayConfig(config, 'outputFields')),
      ].filter(Boolean);
      return `- ${label} ${name} (${resource.resourceId})${details.length ? `：${details.join('；')}` : ''}`;
    })
    .join('\n');
}

function buildDigitalEmployeeContext(employee: IDigitalEmployee): string {
  return [
    '# Sudowork Digital Employee',
    '',
    `你当前以数字员工身份工作：${employee.name}`,
    `岗位：${employee.roleName}`,
    employee.description ? `职责：${employee.description}` : '',
    '',
    '## 人设与工作原则',
    employee.personaPrompt || '按岗位职责处理用户任务，缺少必要信息时先向用户确认。',
    '',
    '## 已绑定能力',
    buildResourceContext(employee.resources),
    '',
    '## 执行要求',
    '1. 以该数字员工的岗位边界、语气和专业职责处理任务。',
    '2. 优先遵循绑定的 SOP；SOP 不完整时，先列出缺失字段再继续。',
    '3. 绑定的工具表示可用业务动作或外部系统能力；无法直接调用时，输出可交接的操作单和参数。',
    '4. 绑定的技能表示当前会话允许调用的 Sudowork skills；需要时主动使用。',
    '5. 遇到审批、权限、合规或高风险事项时，明确指出需要人工确认的环节。',
  ]
    .filter(Boolean)
    .join('\n');
}

function getEnabledSkillNames(employee: IDigitalEmployee): string[] {
  const skillNames = new Set<string>();
  for (const resource of employee.resources) {
    if (!resource.enabled) continue;
    if (resource.resourceType === 'skill') {
      skillNames.add(resource.resourceId);
    }
    const configuredSkills = resource.config.enabledSkills;
    if (Array.isArray(configuredSkills)) {
      for (const skill of configuredSkills) {
        if (typeof skill === 'string' && skill.trim()) {
          skillNames.add(skill.trim());
        }
      }
    }
  }
  return Array.from(skillNames);
}

function getCurrentModelId(employee: IDigitalEmployee): string | undefined {
  const configuredModelId = employee.modelConfig.currentModelId;
  if (typeof configuredModelId === 'string' && configuredModelId.trim()) {
    return configuredModelId.trim();
  }
  const backend = employee.backend || DEFAULT_BACKEND;
  return getDefaultAcpModelId(backend) || undefined;
}

export class DigitalEmployeeService {
  private isSeedChecked = false;

  private getUserId(): string {
    return getDatabase().getDefaultUserId();
  }

  private ensureSeedEmployees(): void {
    if (this.isSeedChecked) return;
    const db = getDatabase();
    const seedRows = requireQueryResult(db.query<Pick<IDigitalEmployeeRow, 'id' | 'metadata'>>("SELECT id, metadata FROM digital_employees WHERE source_type = 'staffdeck_seed'"), 'list digital employee seeds');
    const seedRowsById = new Map(seedRows.map((row) => [row.id, row]));
    const needsSeedSync = STAFFDECK_SEED_EMPLOYEES.some((employee) => {
      const existing = seedRowsById.get(employee.id);
      return !existing || getSeedVersion(parseJsonObject(existing.metadata)) < STAFFDECK_SEED_VERSION;
    });

    if (!needsSeedSync) {
      this.isSeedChecked = true;
      return;
    }

    const now = getNow();
    const userId = this.getUserId();
    const result = db.runTransaction(() => {
      for (const employee of STAFFDECK_SEED_EMPLOYEES) {
        requireQueryResult(
          db.mutate(
            `INSERT OR IGNORE INTO digital_employees
              (id, user_id, name, role_name, description, persona_prompt, avatar, source_type, status, backend, default_mode, model_config, metadata, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, 'staffdeck_seed', 'active', ?, 'default', '{}', ?, ?, ?)`,
            employee.id,
            userId,
            employee.name,
            employee.roleName,
            employee.description,
            employee.personaPrompt,
            DEFAULT_BACKEND,
            buildSeedMetadata(employee, seedRowsById.get(employee.id)?.metadata),
            now,
            now
          ),
          'insert digital employee seed'
        );

        requireQueryResult(
          db.mutate(
            `UPDATE digital_employees
             SET metadata = ?
             WHERE id = ? AND source_type = 'staffdeck_seed'`,
            buildSeedMetadata(employee, seedRowsById.get(employee.id)?.metadata),
            employee.id
          ),
          'update digital employee seed metadata'
        );

        employee.resources.forEach((resource, index) => {
          requireQueryResult(
            db.mutate(
              `INSERT INTO digital_employee_resources
                (id, employee_id, resource_type, resource_id, resource_name, config, enabled, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 employee_id = excluded.employee_id,
                 resource_type = excluded.resource_type,
                 resource_id = excluded.resource_id,
                 resource_name = excluded.resource_name,
                 config = excluded.config,
                 sort_order = excluded.sort_order,
                 updated_at = excluded.updated_at`,
              resource.id,
              employee.id,
              resource.resourceType,
              resource.resourceId,
              resource.resourceName || null,
              stringifyJsonObject(mergeStaffDeckResourceDetails(resource)),
              index,
              now,
              now
            ),
            'insert digital employee resource seed'
          );
        });
      }
    });

    requireQueryResult(result, 'seed digital employees');
    this.isSeedChecked = true;
    mainLog('DigitalEmployeeService', 'Synchronized StaffDeck digital employees');
  }

  listEmployees(): IDigitalEmployee[] {
    this.ensureSeedEmployees();
    const db = getDatabase();
    const userId = this.getUserId();
    const rows = requireQueryResult(
      db.query<IDigitalEmployeeRow>(
        `SELECT * FROM digital_employees
         WHERE user_id = ?
         ORDER BY CASE source_type WHEN 'staffdeck_seed' THEN 0 ELSE 1 END, updated_at DESC, created_at DESC`,
        userId
      ),
      'list digital employees'
    );
    const resources = requireQueryResult(
      db.query<IDigitalEmployeeResourceRow>(
        `SELECT r.*
         FROM digital_employee_resources r
         INNER JOIN digital_employees e ON e.id = r.employee_id
         WHERE e.user_id = ?
         ORDER BY r.sort_order ASC, r.created_at ASC`,
        userId
      ),
      'list digital employee resources'
    ).map(rowToResource);
    const statsRows = requireQueryResult(
      db.query<IDigitalEmployeeStatsRow>(
        `SELECT wr.employee_id, COUNT(*) AS work_record_count, MAX(wr.updated_at) AS last_worked_at
         FROM digital_employee_work_records wr
         INNER JOIN digital_employees e ON e.id = wr.employee_id
         WHERE e.user_id = ?
         GROUP BY wr.employee_id`,
        userId
      ),
      'list digital employee stats'
    );
    const resourcesByEmployee = new Map<string, IDigitalEmployeeResource[]>();
    for (const resource of resources) {
      const grouped = resourcesByEmployee.get(resource.employeeId) || [];
      grouped.push(resource);
      resourcesByEmployee.set(resource.employeeId, grouped);
    }
    const statsByEmployee = new Map(statsRows.map((row) => [row.employee_id, row]));

    return rows.map((row) => rowToEmployee(row, resourcesByEmployee.get(row.id) || [], statsByEmployee.get(row.id)));
  }

  getEmployee(employeeId: string): IDigitalEmployee | null {
    this.ensureSeedEmployees();
    const db = getDatabase();
    const row = requireQueryResult(db.queryOne<IDigitalEmployeeRow>('SELECT * FROM digital_employees WHERE id = ? AND user_id = ?', employeeId, this.getUserId()), 'get digital employee');
    if (!row) return null;
    const resources = requireQueryResult(db.query<IDigitalEmployeeResourceRow>('SELECT * FROM digital_employee_resources WHERE employee_id = ? ORDER BY sort_order ASC, created_at ASC', employeeId), 'get digital employee resources').map(rowToResource);
    const stats = requireQueryResult(
      db.queryOne<IDigitalEmployeeStatsRow>(
        `SELECT employee_id, COUNT(*) AS work_record_count, MAX(updated_at) AS last_worked_at
         FROM digital_employee_work_records
         WHERE employee_id = ?
         GROUP BY employee_id`,
        employeeId
      ),
      'get digital employee stats'
    );
    return rowToEmployee(row, resources, stats || undefined);
  }

  createEmployee(input: IDigitalEmployeeCreateInput): IDigitalEmployee {
    const name = normalizeText(input.name);
    const roleName = normalizeText(input.roleName);
    if (!name || !roleName) {
      throw new Error('Digital employee name and role are required');
    }

    const now = getNow();
    const employeeId = `de_${uuid(16)}`;
    requireQueryResult(
      getDatabase().mutate(
        `INSERT INTO digital_employees
          (id, user_id, name, role_name, description, persona_prompt, avatar, source_type, status, backend, default_mode, model_config, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        employeeId,
        this.getUserId(),
        name,
        roleName,
        normalizeText(input.description),
        normalizeText(input.personaPrompt),
        normalizeText(input.avatar) || null,
        input.sourceType || 'custom',
        input.status || 'active',
        input.backend || DEFAULT_BACKEND,
        normalizeText(input.defaultMode, 'default'),
        stringifyJsonObject(input.modelConfig),
        stringifyJsonObject(input.metadata),
        now,
        now
      ),
      'create digital employee'
    );

    const employee = this.getEmployee(employeeId);
    if (!employee) throw new Error('Created digital employee was not found');
    return employee;
  }

  updateEmployee(employeeId: string, updates: IDigitalEmployeeUpdateInput): IDigitalEmployee {
    const current = this.getEmployee(employeeId);
    if (!current) throw new Error('Digital employee not found');

    const name = updates.name !== undefined ? normalizeText(updates.name) : current.name;
    const roleName = updates.roleName !== undefined ? normalizeText(updates.roleName) : current.roleName;
    if (!name || !roleName) {
      throw new Error('Digital employee name and role are required');
    }

    const now = getNow();
    requireQueryResult(
      getDatabase().mutate(
        `UPDATE digital_employees
         SET name = ?, role_name = ?, description = ?, persona_prompt = ?, avatar = ?, status = ?, backend = ?, default_mode = ?, model_config = ?, metadata = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        name,
        roleName,
        updates.description !== undefined ? normalizeText(updates.description) : current.description,
        updates.personaPrompt !== undefined ? normalizeText(updates.personaPrompt) : current.personaPrompt,
        updates.avatar !== undefined ? normalizeText(updates.avatar) || null : current.avatar || null,
        updates.status || current.status,
        updates.backend || current.backend || DEFAULT_BACKEND,
        updates.defaultMode !== undefined ? normalizeText(updates.defaultMode, 'default') : current.defaultMode || 'default',
        stringifyJsonObject(updates.modelConfig ?? current.modelConfig),
        stringifyJsonObject(updates.metadata ?? current.metadata),
        now,
        employeeId,
        this.getUserId()
      ),
      'update digital employee'
    );

    const employee = this.getEmployee(employeeId);
    if (!employee) throw new Error('Updated digital employee was not found');
    return employee;
  }

  removeEmployee(employeeId: string): void {
    requireQueryResult(getDatabase().mutate('DELETE FROM digital_employees WHERE id = ? AND user_id = ?', employeeId, this.getUserId()), 'remove digital employee');
  }

  duplicateEmployee(employeeId: string): IDigitalEmployee {
    const source = this.getEmployee(employeeId);
    if (!source) throw new Error('Digital employee not found');

    const now = getNow();
    const employeeIdCopy = `de_${uuid(16)}`;
    const result = getDatabase().runTransaction(() => {
      requireQueryResult(
        getDatabase().mutate(
          `INSERT INTO digital_employees
            (id, user_id, name, role_name, description, persona_prompt, avatar, source_type, status, backend, default_mode, model_config, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?, ?, ?, ?)`,
          employeeIdCopy,
          this.getUserId(),
          `${source.name} Copy`,
          source.roleName,
          source.description,
          source.personaPrompt,
          source.avatar || null,
          source.status,
          source.backend || DEFAULT_BACKEND,
          source.defaultMode || 'default',
          stringifyJsonObject(source.modelConfig),
          stringifyJsonObject({ ...source.metadata, duplicatedFrom: source.id }),
          now,
          now
        ),
        'duplicate digital employee'
      );

      source.resources.forEach((resource, index) => {
        requireQueryResult(
          getDatabase().mutate(
            `INSERT INTO digital_employee_resources
              (id, employee_id, resource_type, resource_id, resource_name, config, enabled, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            `der_${uuid(16)}`,
            employeeIdCopy,
            resource.resourceType,
            resource.resourceId,
            resource.resourceName || null,
            stringifyJsonObject(resource.config),
            resource.enabled ? 1 : 0,
            index,
            now,
            now
          ),
          'duplicate digital employee resources'
        );
      });
    });
    requireQueryResult(result, 'duplicate digital employee');

    const employee = this.getEmployee(employeeIdCopy);
    if (!employee) throw new Error('Duplicated digital employee was not found');
    return employee;
  }

  bindResource(employeeId: string, input: IDigitalEmployeeResourceInput): IDigitalEmployeeResource {
    const employee = this.getEmployee(employeeId);
    if (!employee) throw new Error('Digital employee not found');

    const resourceId = normalizeText(input.resourceId);
    if (!resourceId) {
      throw new Error('Resource id is required');
    }

    const existing = requireQueryResult(getDatabase().queryOne<IDigitalEmployeeResourceRow>('SELECT * FROM digital_employee_resources WHERE employee_id = ? AND resource_type = ? AND resource_id = ?', employeeId, input.resourceType, resourceId), 'get digital employee resource');
    const now = getNow();
    if (existing) {
      requireQueryResult(
        getDatabase().mutate(
          `UPDATE digital_employee_resources
           SET resource_name = ?, config = ?, enabled = ?, sort_order = ?, updated_at = ?
           WHERE id = ?`,
          normalizeText(input.resourceName) || existing.resource_name || null,
          stringifyJsonObject(input.config ?? parseJsonObject(existing.config)),
          input.enabled === false ? 0 : 1,
          input.sortOrder ?? existing.sort_order,
          now,
          existing.id
        ),
        'update digital employee resource'
      );
      const row = requireQueryResult(getDatabase().queryOne<IDigitalEmployeeResourceRow>('SELECT * FROM digital_employee_resources WHERE id = ?', existing.id), 'get updated digital employee resource');
      if (!row) throw new Error('Updated resource was not found');
      return rowToResource(row);
    }

    const id = `der_${uuid(16)}`;
    requireQueryResult(
      getDatabase().mutate(
        `INSERT INTO digital_employee_resources
          (id, employee_id, resource_type, resource_id, resource_name, config, enabled, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        employeeId,
        input.resourceType,
        resourceId,
        normalizeText(input.resourceName) || resourceId,
        stringifyJsonObject(input.config),
        input.enabled === false ? 0 : 1,
        input.sortOrder ?? employee.resources.length,
        now,
        now
      ),
      'bind digital employee resource'
    );

    const row = requireQueryResult(getDatabase().queryOne<IDigitalEmployeeResourceRow>('SELECT * FROM digital_employee_resources WHERE id = ?', id), 'get digital employee resource');
    if (!row) throw new Error('Created resource was not found');
    return rowToResource(row);
  }

  unbindResource(resourceId: string): void {
    requireQueryResult(
      getDatabase().mutate(
        `DELETE FROM digital_employee_resources
         WHERE id = ?
           AND employee_id IN (SELECT id FROM digital_employees WHERE user_id = ?)`,
        resourceId,
        this.getUserId()
      ),
      'unbind digital employee resource'
    );
  }

  listWorkRecords(employeeId: string): IDigitalEmployeeWorkRecord[] {
    const employee = this.getEmployee(employeeId);
    if (!employee) throw new Error('Digital employee not found');
    const rows = requireQueryResult(getDatabase().query<IDigitalEmployeeWorkRecordRow>('SELECT * FROM digital_employee_work_records WHERE employee_id = ? ORDER BY updated_at DESC, created_at DESC', employeeId), 'list digital employee work records');
    return rows.map(rowToWorkRecord);
  }

  async launchConversation(input: IDigitalEmployeeLaunchInput): Promise<IDigitalEmployeeLaunchResult> {
    const employee = this.getEmployee(input.employeeId);
    if (!employee) throw new Error('Digital employee not found');
    if (employee.status !== 'active') {
      throw new Error('Digital employee is disabled');
    }

    const initialMessage = normalizeText(input.initialMessage, `${employee.name} ${employee.roleName}`);
    const backend = employee.backend || DEFAULT_BACKEND;
    const enabledSkills = getEnabledSkillNames(employee);
    const result = await ConversationService.createConversation({
      type: 'acp',
      name: initialMessage,
      model: {} as TProviderWithModel,
      source: 'digital-employee',
      extra: {
        workspace: normalizeText(input.workspace) || undefined,
        customWorkspace: Boolean(normalizeText(input.workspace)),
        workspaceDisplayName: normalizeText(input.workspaceDisplayName) || undefined,
        backend,
        agentName: employee.name,
        presetContext: buildDigitalEmployeeContext(employee),
        enabledSkills,
        sessionMode: employee.defaultMode || 'default',
        currentModelId: getCurrentModelId(employee),
        sessionModeParam: 'local',
        digitalEmployeeId: employee.id,
        digitalEmployeeRole: employee.roleName,
        digitalEmployeeSourceType: employee.sourceType,
      },
    });

    if (!result.success || !result.conversation) {
      throw new Error(result.error || 'Failed to create digital employee conversation');
    }

    const now = getNow();
    requireQueryResult(
      getDatabase().mutate(
        `INSERT INTO digital_employee_work_records
          (id, employee_id, conversation_id, title, status, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
        `dewr_${uuid(16)}`,
        employee.id,
        result.conversation.id,
        initialMessage,
        `${employee.name} / ${employee.roleName}`,
        now,
        now
      ),
      'create digital employee work record'
    );

    return {
      conversationId: result.conversation.id,
      employee,
      enabledSkills,
    };
  }
}

export const digitalEmployeeService = new DigitalEmployeeService();
