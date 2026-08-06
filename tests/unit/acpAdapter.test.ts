/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AcpAdapter } from '../../src/agent/acp/AcpAdapter';
import type { ToolCallUpdate, ToolCallUpdateStatus } from '../../src/types/acpTypes';

describe('AcpAdapter - rawInput merging (#1113)', () => {
  let adapter: AcpAdapter;
  const conversationId = 'test-conversation-id';

  beforeEach(() => {
    adapter = new AcpAdapter(conversationId, 'claude');
  });

  it('should create tool call message with initial empty rawInput', () => {
    const toolCallUpdate: ToolCallUpdate = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-123',
        status: 'pending',
        title: 'Test Tool',
        kind: 'execute',
        rawInput: {},
      },
    };

    const messages = adapter.convertSessionUpdate(toolCallUpdate);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('acp_tool_call');
    expect((messages[0] as any).content.update.rawInput).toEqual({});
  });

  it('should merge rawInput from tool_call_update into existing tool call', () => {
    const initialToolCall: ToolCallUpdate = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-123',
        status: 'pending',
        title: 'Test Tool',
        kind: 'execute',
        rawInput: {},
      },
    };

    adapter.convertSessionUpdate(initialToolCall);

    const toolCallUpdateStatus: ToolCallUpdateStatus = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-123',
        status: 'completed',
        rawInput: {
          include_dms: true,
          include_groups: true,
          include_spaces: false,
        },
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'Tool result',
            },
          },
        ],
      },
    };

    const messages = adapter.convertSessionUpdate(toolCallUpdateStatus);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('acp_tool_call');
    expect((messages[0] as any).content.update.rawInput).toEqual({
      include_dms: true,
      include_groups: true,
      include_spaces: false,
    });
  });

  it('should preserve existing rawInput if update has no rawInput', () => {
    const initialToolCall: ToolCallUpdate = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-456',
        status: 'in_progress',
        title: 'Another Tool',
        kind: 'read',
        rawInput: { path: '/some/file.txt' },
      },
    };

    adapter.convertSessionUpdate(initialToolCall);

    const toolCallUpdateStatus: ToolCallUpdateStatus = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-456',
        status: 'completed',
      },
    };

    const messages = adapter.convertSessionUpdate(toolCallUpdateStatus);

    expect(messages).toHaveLength(1);
    expect((messages[0] as any).content.update.rawInput).toEqual({ path: '/some/file.txt' });
  });

  it('should preserve previous rawInput when tool_call_update only changes status/content', () => {
    const initialToolCall: ToolCallUpdate = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-999',
        status: 'pending',
        title: 'Bash',
        kind: 'execute',
        rawInput: {
          command: 'bash write_file --path /tmp/demo.txt',
          description: 'write file',
        },
      },
    };

    adapter.convertSessionUpdate(initialToolCall);

    const toolCallUpdateStatus: ToolCallUpdateStatus = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-999',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'done',
            },
          },
        ],
      },
    };

    const messages = adapter.convertSessionUpdate(toolCallUpdateStatus);

    expect(messages).toHaveLength(1);
    expect((messages[0] as any).content.update.rawInput).toEqual({
      command: 'bash write_file --path /tmp/demo.txt',
      description: 'write file',
    });
  });

  it('should return null for tool_call_update without existing tool call', () => {
    const toolCallUpdateStatus: ToolCallUpdateStatus = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'non-existent-tool',
        status: 'completed',
        rawInput: { some: 'data' },
      },
    };

    const messages = adapter.convertSessionUpdate(toolCallUpdateStatus);
    expect(messages).toHaveLength(0);
  });
});

describe('AcpAdapter - ToolCallUpdateStatus type (#1113)', () => {
  it('should accept rawInput field in ToolCallUpdateStatus', () => {
    const update: ToolCallUpdateStatus = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-789',
        status: 'completed',
        rawInput: {
          command: 'ls -la',
          description: 'List directory contents',
        },
        content: [],
      },
    };

    expect(update.update.rawInput).toBeDefined();
    expect(update.update.rawInput?.command).toBe('ls -la');
  });
});

describe('AcpAdapter - AskUserQuestion v2', () => {
  let adapter: AcpAdapter;

  beforeEach(() => {
    adapter = new AcpAdapter('test-conversation-id', 'claude');
  });

  it('should build an interactive structured question from tool_call rawInput before completion', () => {
    const toolCallUpdate: ToolCallUpdate = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'ask-tool-1',
        status: 'pending',
        title: 'AskUserQuestion',
        kind: 'execute',
        rawInput: {
          title: '首次设置',
          description: '没有找到 EXTEND.md 文件，请进行首次设置。',
          questions: [
            {
              id: 'save_scope',
              prompt: '保存到哪里？',
              kind: 'single_select',
              required: true,
              options: [
                { label: 'Project', value: 'project' },
                { label: 'User', value: 'user' },
              ],
            },
            {
              id: 'default_language',
              prompt: '默认语言？',
              kind: 'single_select',
              required: true,
              allowCustomInput: false,
              options: [
                { label: 'zh-CN', value: 'zh-CN' },
                { label: 'en-US', value: 'en-US' },
              ],
            },
          ],
        },
      },
    };

    adapter.convertSessionUpdate(toolCallUpdate);
    const questionMessage = adapter.buildQuestionMessageFromToolCall(toolCallUpdate);

    expect(questionMessage).not.toBeNull();
    expect(questionMessage?.type).toBe('acp_question');
    expect(questionMessage?.content.question).toBe('首次设置');
    expect(questionMessage?.content.intro).toBe('没有找到 EXTEND.md 文件，请进行首次设置。');
    expect(questionMessage?.content.items).toEqual([
      expect.objectContaining({
        id: 'save_scope',
        prompt: '保存到哪里？',
        allowCustomInput: undefined,
        options: [expect.objectContaining({ label: 'Project', value: 'project' }), expect.objectContaining({ label: 'User', value: 'user' })],
      }),
      expect.objectContaining({
        id: 'default_language',
        prompt: '默认语言？',
        allowCustomInput: false,
        options: [expect.objectContaining({ label: 'zh-CN', value: 'zh-CN' }), expect.objectContaining({ label: 'en-US', value: 'en-US' })],
      }),
    ]);
  });

  it('should mark AskUserQuestion as answered when completed result includes structured answers', () => {
    const toolCallUpdate: ToolCallUpdate = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'ask-tool-2',
        status: 'pending',
        title: 'AskUserQuestion',
        kind: 'execute',
        rawInput: {
          title: '首次设置',
          questions: [
            {
              id: 'save_scope',
              prompt: '保存到哪里？',
              options: [
                { label: 'Project', value: 'project' },
                { label: 'User', value: 'user' },
              ],
            },
          ],
        },
      },
    };

    adapter.convertSessionUpdate(toolCallUpdate);

    const toolCallUpdateStatus: ToolCallUpdateStatus = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'ask-tool-2',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: JSON.stringify({
                title: '首次设置',
                questions: [
                  {
                    id: 'save_scope',
                    prompt: '保存到哪里？',
                    options: [
                      { label: 'Project', value: 'project' },
                      { label: 'User', value: 'user' },
                    ],
                  },
                ],
                answers: [{ id: 'save_scope', value: 'project', label: 'Project' }],
              }),
            },
          },
        ],
      },
    };

    adapter.convertSessionUpdate(toolCallUpdateStatus);
    const userMessage = adapter.generateUserMessageFromToolCall(toolCallUpdateStatus);

    expect(userMessage).not.toBeNull();
    expect(userMessage?.type).toBe('acp_question');
    expect((userMessage as any).content.answered).toBe(true);
    expect((userMessage as any).content.selectedAnswer).toBe('1. Project');
    expect((userMessage as any).content.answerItems).toEqual([
      expect.objectContaining({
        id: 'save_scope',
        index: 1,
        submissionValue: 'project',
        displayValue: 'Project',
      }),
    ]);
  });

  it('should preserve structured answer ids and values when completed result includes answers array', () => {
    const toolCallUpdate: ToolCallUpdate = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'ask-tool-3',
        status: 'pending',
        title: 'AskUserQuestion',
        kind: 'execute',
        rawInput: {
          title: '首次设置',
          questions: [
            {
              id: 'save_scope',
              prompt: '保存到哪里？',
              options: [
                { label: 'Project', value: 'project' },
                { label: 'User', value: 'user' },
              ],
            },
            {
              id: 'default_language',
              prompt: '默认语言？',
              options: [
                { label: 'zh-CN', value: 'zh-CN' },
                { label: 'en-US', value: 'en-US' },
              ],
            },
          ],
        },
      },
    };

    adapter.convertSessionUpdate(toolCallUpdate);

    const toolCallUpdateStatus: ToolCallUpdateStatus = {
      sessionId: 'test-session',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'ask-tool-3',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: JSON.stringify({
                title: '首次设置',
                questions: [
                  {
                    id: 'save_scope',
                    prompt: '保存到哪里？',
                    options: [
                      { label: 'Project', value: 'project' },
                      { label: 'User', value: 'user' },
                    ],
                  },
                  {
                    id: 'default_language',
                    prompt: '默认语言？',
                    options: [
                      { label: 'zh-CN', value: 'zh-CN' },
                      { label: 'en-US', value: 'en-US' },
                    ],
                  },
                ],
                answers: [
                  { id: 'save_scope', value: 'project', label: 'Project' },
                  { id: 'default_language', value: 'zh-CN', label: 'zh-CN' },
                ],
              }),
            },
          },
        ],
      },
    };

    adapter.convertSessionUpdate(toolCallUpdateStatus);
    const userMessage = adapter.generateUserMessageFromToolCall(toolCallUpdateStatus);

    expect(userMessage).not.toBeNull();
    expect((userMessage as any).content.answerItems).toEqual([
      expect.objectContaining({
        id: 'save_scope',
        index: 1,
        submissionValue: 'project',
        displayValue: 'Project',
      }),
      expect.objectContaining({
        id: 'default_language',
        index: 2,
        submissionValue: 'zh-CN',
        displayValue: 'zh-CN',
      }),
    ]);
    expect((userMessage as any).content.selectedAnswer).toBe('1. Project\n2. zh-CN');
  });
});
