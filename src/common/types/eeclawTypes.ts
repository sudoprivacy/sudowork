/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Enterprise (eeclaw) type definitions
 * Types for server-side agent, cloud conversations, skills, and assistants
 */

/**
 * App mode: consumer (c) or enterprise (e)
 */
export type AppMode = 'c' | 'e';

/**
 * User info returned from enterprise server
 */
export interface EeclawUserInfo {
  userId: string;
  username: string;
  email?: string;
  tenantId: string;
  tenantName?: string;
  token: string;
  /** Whether user can use local CLI agent / 是否允许使用本地 CLI agent */
  canUseLocalAgent: boolean;
  /** Allowed local agent types when server permits / 允许的本地 agent 类型 */
  localAgentTypes?: string[];
}

/**
 * Agent configuration from enterprise server
 */
export interface EeclawAgentConfig {
  /** Server-side agent is enabled / 服务端 agent 是否启用 */
  remoteAgentEnabled: boolean;
  /** Whether local CLI agent is allowed / 是否允许使用本地 CLI agent */
  localAgentEnabled: boolean;
  /** Allowed local agent backend types (e.g. 'claude', 'codex') */
  localAgentTypes?: string[];
  /** Max concurrent sessions */
  maxConcurrentSessions?: number;
  /** Skill policy: 'server-only' | 'allow-custom' */
  skillPolicy?: 'server-only' | 'allow-custom';
}

/**
 * Enterprise conversation from server
 */
export interface EeclawConversation {
  cloudId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status?: 'pending' | 'running' | 'finished';
  model?: string;
}

/**
 * Enterprise message from server
 */
export interface EeclawMessage {
  msgId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  status?: 'finish' | 'pending' | 'error';
}

/**
 * Skill from enterprise server
 */
export interface EeclawSkill {
  name: string;
  description: string;
  content: string; // SKILL.md content
  version?: string;
  updatedAt?: number;
}

/**
 * Assistant from enterprise server
 */
export interface EeclawAssistant {
  name: string;
  displayName: string;
  description?: string;
  ruleContent?: string;
  skillContent?: string;
  avatar?: string;
  version?: string;
  updatedAt?: number;
}

/**
 * Tenant configuration from enterprise server
 */
export interface EeclawTenantConfig {
  tenantId: string;
  tenantName: string;
  /** App mode from server perspective */
  app_mode: 'c' | 'e';
  /** Agent config */
  agent?: EeclawAgentConfig;
  /** Max users */
  maxUsers?: number;
  /** Feature flags */
  features?: Record<string, boolean>;
}

/**
 * Sync state tracking
 */
export interface EeclawLastSync {
  conversations: number;
  skills: number;
  assistants: number;
}
