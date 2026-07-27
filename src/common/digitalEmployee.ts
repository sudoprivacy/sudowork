/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackendAll } from '@/types/acpTypes';

export type DigitalEmployeeStatus = 'active' | 'disabled';
export type DigitalEmployeeSourceType = 'staffdeck_seed' | 'custom' | 'hub' | 'tenant';
export type DigitalEmployeeResourceType = 'assistant' | 'skill' | 'general_skill' | 'mcp' | 'knowledge' | 'sop' | 'tool';
export type DigitalEmployeeWorkStatus = 'created' | 'running' | 'completed' | 'failed';
export type DigitalEmployeeSopStatus = 'draft' | 'published' | 'archived';

export interface IDigitalEmployeeSopNode {
  nodeId: string;
  type: string;
  name: string;
  instruction: string;
  optional: boolean;
  condition?: string;
  expectedUserInfo: string[];
  allowedActions: string[];
  knowledgeScope: Record<string, unknown>;
  retryPolicy: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface IDigitalEmployeeSopEdge {
  sourceNodeId: string;
  nextNodeId: string;
  condition?: string;
  priority: number;
  label?: string;
}

export interface IDigitalEmployeeSopContent {
  sopKey: string;
  name: string;
  version: string;
  businessDomain?: string;
  description: string;
  triggerIntents: string[];
  userUtteranceExamples: string[];
  goals: string[];
  requiredInfo: string[];
  slotFillingPolicy: Record<string, unknown>;
  responseRules: string[];
  nodes: IDigitalEmployeeSopNode[];
  edges: IDigitalEmployeeSopEdge[];
  startNodeId: string;
  terminalNodeIds: string[];
  interruptionPolicy: Record<string, string>;
}

export interface IDigitalEmployeeResource {
  id: string;
  employeeId: string;
  resourceType: DigitalEmployeeResourceType;
  resourceId: string;
  resourceName?: string;
  config: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface IDigitalEmployee {
  id: string;
  name: string;
  roleName: string;
  description: string;
  personaPrompt: string;
  avatar?: string;
  sourceType: DigitalEmployeeSourceType;
  status: DigitalEmployeeStatus;
  backend?: AcpBackendAll;
  defaultMode?: string;
  modelConfig: Record<string, unknown>;
  metadata: Record<string, unknown>;
  resources: IDigitalEmployeeResource[];
  workRecordCount: number;
  lastWorkedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface IDigitalEmployeeWorkRecord {
  id: string;
  employeeId: string;
  conversationId?: string;
  title: string;
  status: DigitalEmployeeWorkStatus;
  summary?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IDigitalEmployeeSop {
  id: string;
  employeeId: string;
  sopKey: string;
  name: string;
  businessDomain?: string;
  description: string;
  status: DigitalEmployeeSopStatus;
  version: string;
  content: IDigitalEmployeeSopContent;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface IDigitalEmployeeCreateInput {
  name: string;
  roleName: string;
  description?: string;
  personaPrompt?: string;
  avatar?: string;
  sourceType?: DigitalEmployeeSourceType;
  status?: DigitalEmployeeStatus;
  backend?: AcpBackendAll;
  defaultMode?: string;
  modelConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface IDigitalEmployeeUpdateInput {
  name?: string;
  roleName?: string;
  description?: string;
  personaPrompt?: string;
  avatar?: string;
  status?: DigitalEmployeeStatus;
  backend?: AcpBackendAll;
  defaultMode?: string;
  modelConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface IDigitalEmployeeResourceInput {
  resourceType: DigitalEmployeeResourceType;
  resourceId: string;
  resourceName?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  sortOrder?: number;
}

export interface IDigitalEmployeeSopCreateInput {
  sopKey?: string;
  name: string;
  businessDomain?: string;
  description?: string;
  status?: DigitalEmployeeSopStatus;
  content?: Partial<IDigitalEmployeeSopContent>;
  metadata?: Record<string, unknown>;
}

export interface IDigitalEmployeeSopUpdateInput {
  name?: string;
  businessDomain?: string;
  description?: string;
  status?: DigitalEmployeeSopStatus;
  content?: Partial<IDigitalEmployeeSopContent>;
  metadata?: Record<string, unknown>;
}

export interface IDigitalEmployeeSopDistillInput {
  employeeId: string;
  title: string;
  rawContent: string;
  businessDomain?: string;
}

export interface IDigitalEmployeeSopDistillResult {
  draft: IDigitalEmployeeSopContent;
  warnings: string[];
}

export interface IDigitalEmployeeLaunchInput {
  employeeId: string;
  initialMessage: string;
  workspace?: string;
  workspaceDisplayName?: string;
}

export interface IDigitalEmployeeLaunchResult {
  conversationId: string;
  employee: IDigitalEmployee;
  enabledSkills: string[];
}
