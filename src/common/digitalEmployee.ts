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
