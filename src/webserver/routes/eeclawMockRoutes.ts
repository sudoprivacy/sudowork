/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Express, type Request, type Response } from 'express';
import type {
  EeclawConversation,
  EeclawMessage,
  EeclawSkill,
  EeclawAssistant,
  EeclawTenantConfig,
  EeclawUserInfo,
} from '@/common/types/eeclawTypes';

/**
 * In-memory mock data stores
 */
const mockConversations: Map<string, EeclawConversation> = new Map();
const mockMessages: Map<string, EeclawMessage[]> = new Map();
const mockSkills: EeclawSkill[] = [
  {
    name: 'code-review',
    description: 'Automated code review skill for enterprise codebase',
    content: '# Code Review Skill\n\nReview all code changes before commit.\n\n## Rules\n- Check for security vulnerabilities\n- Verify coding standards\n- Suggest performance improvements',
    version: '1.0.0',
    updatedAt: Date.now(),
  },
  {
    name: 'doc-generator',
    description: 'Generate documentation from code comments',
    content: '# Documentation Generator\n\nAuto-generate API docs from code comments.\n\n## Rules\n- Extract JSDoc comments\n- Generate markdown output\n- Update README when APIs change',
    version: '1.0.0',
    updatedAt: Date.now(),
  },
];
const mockAssistants: EeclawAssistant[] = [
  {
    name: 'enterprise-coder',
    displayName: 'Enterprise Coder',
    description: 'Enterprise-grade coding assistant with company knowledge base',
    ruleContent: '# Enterprise Coder Rules\n\nYou are a coding assistant for the enterprise.\n\n- Follow company coding standards\n- Use approved libraries only\n- Ensure security compliance',
    skillContent: '# Enterprise Coder Skills\n\n- Code review\n- Refactoring\n- Debug assistance',
    version: '1.0.0',
    updatedAt: Date.now(),
  },
];

const mockTenantConfig: EeclawTenantConfig = {
  tenantId: 'tenant-001',
  tenantName: 'Enterprise Demo Corp',
  app_mode: 'e',
  agent: {
    remoteAgentEnabled: true,
    localAgentEnabled: false,
    maxConcurrentSessions: 3,
    skillPolicy: 'server-only',
  },
  maxUsers: 50,
  features: {
    localAgent: false,
    customSkills: false,
    fileUpload: true,
  },
};

const mockUserInfo: EeclawUserInfo = {
  userId: 'user-001',
  username: 'demo_user',
  email: 'demo@enterprise.local',
  tenantId: 'tenant-001',
  tenantName: 'Enterprise Demo Corp',
  token: 'mock-jwt-token-eeclaw-demo',
  canUseLocalAgent: false,
};

/**
 * Register eeclaw mock API routes
 * Only active when EECLAW_MOCK=1 environment variable is set
 */
export function registerEeclawMockRoutes(app: Express): void {
  /**
   * Health check
   */
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', mode: 'eeclaw-mock', timestamp: Date.now() });
  });

  /**
   * Get current user info
   * GET /api/v1/eeclaw/users/me
   */
  app.get('/api/v1/eeclaw/users/me', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: mockUserInfo,
    });
  });

  /**
   * Get skills list
   * GET /api/v1/eeclaw/skills
   */
  app.get('/api/v1/eeclaw/skills', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: mockSkills,
      total: mockSkills.length,
    });
  });

  /**
   * Get assistants list
   * GET /api/v1/eeclaw/assistants
   */
  app.get('/api/v1/eeclaw/assistants', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: mockAssistants,
      total: mockAssistants.length,
    });
  });

  /**
   * Create conversation
   * POST /api/v1/eeclaw/conversations
   */
  app.post('/api/v1/eeclaw/conversations', (req: Request, res: Response) => {
    const { name, model } = req.body || {};
    const cloudId = `cloud-${Date.now()}`;
    const conversation: EeclawConversation = {
      cloudId,
      name: name || 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'pending',
      model,
    };
    mockConversations.set(cloudId, conversation);
    mockMessages.set(cloudId, []);
    res.json({
      success: true,
      data: conversation,
    });
  });

  /**
   * Get conversations list
   * GET /api/v1/eeclaw/conversations
   */
  app.get('/api/v1/eeclaw/conversations', (_req: Request, res: Response) => {
    const conversations = Array.from(mockConversations.values());
    res.json({
      success: true,
      data: conversations,
      total: conversations.length,
    });
  });

  /**
   * Get conversation messages
   * GET /api/v1/eeclaw/conversations/:id/messages
   */
  app.get('/api/v1/eeclaw/conversations/:id/messages', (req: Request, res: Response) => {
    const { id } = req.params;
    const messages = mockMessages.get(id) || [];
    res.json({
      success: true,
      data: messages,
      total: messages.length,
    });
  });

  /**
   * Post message to conversation
   * POST /api/v1/eeclaw/conversations/:id/messages
   */
  app.post('/api/v1/eeclaw/conversations/:id/messages', (req: Request, res: Response) => {
    const { id } = req.params;
    const { role, content } = req.body || {};

    if (!mockConversations.has(id)) {
      res.status(404).json({ success: false, error: 'Conversation not found' });
      return;
    }

    const message: EeclawMessage = {
      msgId: `msg-${Date.now()}`,
      conversationId: id,
      role: role || 'user',
      content: content || '',
      createdAt: Date.now(),
      status: 'finish',
    };

    const messages = mockMessages.get(id)!;
    messages.push(message);

    // Auto-reply simulation
    const reply: EeclawMessage = {
      msgId: `msg-${Date.now() + 1}`,
      conversationId: id,
      role: 'assistant',
      content: `This is a mock response from the enterprise server.\n\nYou said: "${content}"`,
      createdAt: Date.now(),
      status: 'finish',
    };
    messages.push(reply);

    // Update conversation timestamp
    const conv = mockConversations.get(id)!;
    conv.updatedAt = Date.now();
    conv.status = 'finished';

    res.json({
      success: true,
      data: message,
    });
  });

  /**
   * Get tenant config
   * GET /api/v1/eeclaw/tenant/config
   */
  app.get('/api/v1/eeclaw/tenant/config', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: mockTenantConfig,
    });
  });

  /**
   * Login endpoint
   * POST /api/v1/eeclaw/auth/login
   */
  app.post('/api/v1/eeclaw/auth/login', (req: Request, res: Response) => {
    // Mock login - accepts any credentials
    res.json({
      success: true,
      data: mockUserInfo,
    });
  });
}

export default registerEeclawMockRoutes;
