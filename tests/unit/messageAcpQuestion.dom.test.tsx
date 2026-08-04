/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mockSendMessage = vi.fn().mockResolvedValue({ success: true });
const mockAnswerQuestion = vi.fn().mockResolvedValue({ success: true });

vi.mock('@/common/ipcBridge', () => ({
  acpConversation: {
    sendMessage: {
      invoke: (...args: unknown[]) => mockSendMessage(...args),
    },
    answerQuestion: {
      invoke: (...args: unknown[]) => mockAnswerQuestion(...args),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const table: Record<string, string> = {
        'messages.chooseAction': 'Choose an action:',
        'messages.option': 'Option',
        'messages.processing': 'Processing...',
        'messages.confirm': 'Confirm',
        'messages.enterAnswer': 'Enter answer',
        'messages.completeRequiredAnswers': 'Please complete the required answers.',
        'messages.failedToSendQuestionAnswer': 'Failed to send question answer',
        'messages.questionAnswered': 'Answered',
        'messages.yes': 'Yes',
        'messages.no': 'No',
        'common.skip': 'Skip',
        'common.ariaLabel.back': 'Back',
        'common.ariaLabel.next': 'Next',
      };
      return table[key] || key;
    },
  }),
}));

import MessageAcpQuestion from '@/renderer/messages/acp/MessageAcpQuestion';
import AcpQuestionOverlay from '@/renderer/pages/conversation/acp/AcpQuestionOverlay';
import type { IMessageAcpQuestion } from '@/common/chatLib';
import { transformMessage } from '@/common/chatLib';

describe('MessageAcpQuestion', () => {
  it('should preserve answer hydration after transformMessage recovery', () => {
    const recovered = transformMessage({
      type: 'acp_question',
      msg_id: 'msg-recovered',
      conversation_id: 'conv-1',
      data: {
        question: 'Setup questions',
        intro: 'Please answer these questions:',
        options: [],
        conversationId: 'conv-1',
        answered: true,
        selectedAnswer: '1. Project\n2. zh-CN',
        answerItems: [
          {
            id: 'q1',
            index: 1,
            submissionValue: 'Project',
            displayValue: 'Project',
          },
          {
            id: 'q2',
            index: 2,
            submissionValue: 'zh-CN',
            displayValue: 'zh-CN',
          },
        ],
        items: [
          {
            id: 'q1',
            prompt: 'Where to save preferences?',
            options: ['Project', 'User'],
            allowCustomInput: false,
          },
          {
            id: 'q2',
            prompt: 'Default language?',
            options: ['zh-CN', 'en-US'],
            allowCustomInput: false,
          },
        ],
      },
    }) as IMessageAcpQuestion;

    render(<MessageAcpQuestion message={recovered} />);

    expect(screen.getByText('✓ Project')).toBeInTheDocument();
    expect(screen.getByText('✓ zh-CN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Project' })).not.toBeInTheDocument();
  });

  it('should hydrate answered state consistently from structured answer items', () => {
    const message: IMessageAcpQuestion = {
      id: 'msg-hydrated',
      msg_id: 'msg-hydrated',
      type: 'acp_question',
      position: 'left',
      conversation_id: 'conv-1',
      createdAt: Date.now(),
      content: {
        question: 'Setup questions',
        intro: 'Please answer these questions:',
        options: [],
        conversationId: 'conv-1',
        answered: true,
        selectedAnswer: '1. Project\n2. zh-CN',
        answerItems: [
          {
            id: 'q1',
            index: 1,
            submissionValue: 'Project',
            displayValue: 'Project',
          },
          {
            id: 'q2',
            index: 2,
            submissionValue: 'zh-CN',
            displayValue: 'zh-CN',
          },
        ],
        items: [
          {
            id: 'q1',
            prompt: 'Where to save preferences?',
            options: ['Project', 'User'],
            allowCustomInput: false,
          },
          {
            id: 'q2',
            prompt: 'Default language?',
            options: ['zh-CN', 'en-US'],
            allowCustomInput: false,
          },
        ],
      },
    };

    render(<MessageAcpQuestion message={message} />);

    expect(screen.getByText('✓ Project')).toBeInTheDocument();
    expect(screen.getByText('✓ zh-CN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Project' })).not.toBeInTheDocument();
  });

  it('should submit structured answers for multi-question prompts', async () => {
    mockSendMessage.mockClear();

    const message: IMessageAcpQuestion = {
      id: 'msg-structured',
      msg_id: 'msg-structured',
      type: 'acp_question',
      position: 'left',
      conversation_id: 'conv-1',
      createdAt: Date.now(),
      content: {
        question: 'Setup questions',
        intro: 'Please answer these questions:',
        options: [],
        conversationId: 'conv-1',
        items: [
          {
            id: 'q1',
            prompt: 'Where to save preferences?',
            options: ['Project', 'User'],
            allowCustomInput: false,
          },
          {
            id: 'q2',
            prompt: 'Default language?',
            options: ['zh-CN', 'en-US'],
            allowCustomInput: false,
          },
        ],
      },
    };

    render(<MessageAcpQuestion message={message} />);

    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'zh-CN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mockSendMessage).toHaveBeenCalledWith({
      input: 'Q1: Project\nQ2: zh-CN',
      msg_id: expect.any(String),
      conversation_id: 'conv-1',
    });
  });

  it('should inject Yes/No fallback options for boolean kind questions', async () => {
    mockSendMessage.mockClear();

    const message: IMessageAcpQuestion = {
      id: 'msg-boolean',
      msg_id: 'msg-boolean',
      type: 'acp_question',
      position: 'left',
      conversation_id: 'conv-1',
      createdAt: Date.now(),
      content: {
        question: 'Add watermark?',
        options: [],
        conversationId: 'conv-1',
        items: [
          {
            id: 'q1',
            prompt: 'Add watermark to images?',
            kind: 'boolean',
            options: [],
          },
        ],
      },
    };

    render(<MessageAcpQuestion message={message} />);

    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mockSendMessage).toHaveBeenCalledWith({
      input: 'true',
      msg_id: expect.any(String),
      conversation_id: 'conv-1',
    });
  });

  it('should submit tool call answers through the ACP answerQuestion API in normal chats', () => {
    mockSendMessage.mockClear();
    mockAnswerQuestion.mockClear();

    const message: IMessageAcpQuestion = {
      id: 'msg-tool-call',
      msg_id: 'msg-tool-call',
      type: 'acp_question',
      position: 'left',
      conversation_id: 'conv-1',
      createdAt: Date.now(),
      content: {
        question: 'Pick one',
        options: [],
        conversationId: 'conv-1',
        toolCallId: 'tool-1',
        items: [{ id: 'q1', prompt: 'Choose?', options: ['A', 'B'] }],
      },
    };

    render(<MessageAcpQuestion message={message} />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mockAnswerQuestion).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      toolCallId: 'tool-1',
      answers: [{ id: 'q1', value: 'A', label: 'A' }],
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('should submit team tool call answers through the injected team handler', () => {
    mockSendMessage.mockClear();
    mockAnswerQuestion.mockClear();
    const onTeamAnswerQuestion = vi.fn().mockResolvedValue({ success: true });

    const message: IMessageAcpQuestion = {
      id: 'msg-team-tool-call',
      msg_id: 'msg-team-tool-call',
      type: 'acp_question',
      position: 'left',
      conversation_id: 'conv-1',
      createdAt: Date.now(),
      content: {
        question: 'Pick one',
        options: [],
        conversationId: 'conv-1',
        toolCallId: 'tool-1',
        items: [{ id: 'q1', prompt: 'Choose?', options: ['A', 'B'] }],
      },
    };

    render(<MessageAcpQuestion message={message} onTeamAnswerQuestion={onTeamAnswerQuestion} />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onTeamAnswerQuestion).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      toolCallId: 'tool-1',
      answers: [{ id: 'q1', value: 'A', label: 'A' }],
    });
    expect(mockAnswerQuestion).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('should submit team fallback answers through the injected team send handler', () => {
    mockSendMessage.mockClear();
    mockAnswerQuestion.mockClear();
    const onTeamQuestionFallbackSend = vi.fn().mockResolvedValue({ success: true });

    const message: IMessageAcpQuestion = {
      id: 'msg-team-fallback',
      msg_id: 'msg-team-fallback',
      type: 'acp_question',
      position: 'left',
      conversation_id: 'conv-1',
      createdAt: Date.now(),
      content: {
        question: 'Setup questions',
        options: [],
        conversationId: 'conv-1',
        items: [
          { id: 'q1', prompt: 'Where to save preferences?', options: ['Project', 'User'], allowCustomInput: false },
          { id: 'q2', prompt: 'Default language?', options: ['zh-CN', 'en-US'], allowCustomInput: false },
        ],
      },
    };

    render(<MessageAcpQuestion message={message} onTeamQuestionFallbackSend={onTeamQuestionFallbackSend} />);

    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'zh-CN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onTeamQuestionFallbackSend).toHaveBeenCalledWith({ input: 'Q1: Project\nQ2: zh-CN', msg_id: expect.any(String) });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockAnswerQuestion).not.toHaveBeenCalled();
  });

  it('should render a pending history entry without duplicate controls', () => {
    const message: IMessageAcpQuestion = {
      id: 'msg-history',
      msg_id: 'msg-history',
      type: 'acp_question',
      position: 'left',
      conversation_id: 'conv-1',
      createdAt: Date.now(),
      content: {
        question: 'Choose a mode',
        options: ['Fast', 'Safe'],
        conversationId: 'conv-1',
      },
    };

    render(<MessageAcpQuestion message={message} isInteractive={false} />);

    expect(screen.getByText('messages.waitingForUserInput')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fast' })).not.toBeInTheDocument();
  });

  it('should keep custom input visible in the bottom overlay', () => {
    const message: IMessageAcpQuestion = {
      id: 'msg-overlay-custom',
      msg_id: 'msg-overlay-custom',
      type: 'acp_question',
      position: 'left',
      conversation_id: 'conv-1',
      createdAt: Date.now(),
      content: {
        question: 'Choose a mode',
        options: [],
        conversationId: 'conv-1',
        items: [
          {
            id: 'q1',
            prompt: 'Choose a mode',
            options: ['Fast', 'Safe'],
            allowCustomInput: true,
            customInputHint: 'Type another mode',
          },
        ],
      },
    };

    render(<AcpQuestionOverlay message={message} onAnswered={vi.fn()} />);

    expect(screen.getByPlaceholderText('Type another mode')).toBeInTheDocument();
  });

  it('should submit a pending question from the bottom overlay', async () => {
    const onAnswered = vi.fn();
    const message: IMessageAcpQuestion = {
      id: 'msg-overlay',
      msg_id: 'msg-overlay',
      type: 'acp_question',
      position: 'left',
      conversation_id: 'conv-1',
      createdAt: Date.now(),
      content: {
        question: 'Choose a mode',
        options: ['Fast', 'Safe'],
        conversationId: 'conv-1',
        toolCallId: 'tool-overlay',
      },
    };

    render(<AcpQuestionOverlay message={message} onAnswered={onAnswered} />);

    expect(screen.getByRole('region', { name: 'messages.waitingForUserInput' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Safe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(onAnswered).toHaveBeenCalledWith({
        selectedAnswer: 'Safe',
        answerItems: [{ id: 'q1', index: 1, submissionValue: 'Safe', displayValue: 'Safe', skipped: false }],
      })
    );
  });

  it('should show one step at a time and advance after selecting an option', () => {
    const message: IMessageAcpQuestion = {
      id: 'msg-1',
      msg_id: 'msg-1',
      type: 'acp_question',
      position: 'left',
      conversation_id: 'conv-1',
      createdAt: Date.now(),
      content: {
        question: 'Setup questions',
        intro: 'Please answer these questions:',
        options: [],
        conversationId: 'conv-1',
        items: [
          {
            id: 'q1',
            prompt: 'Where to save preferences?',
            options: ['Project', 'User'],
            allowCustomInput: false,
          },
          {
            id: 'q2',
            prompt: 'Default visual style preference?',
            options: ['None (Recommended)', 'cute', 'notion'],
            allowCustomInput: true,
            customInputHint: 'Type another style name',
          },
        ],
      },
    };

    render(<MessageAcpQuestion message={message} />);

    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('1. Where to save preferences?')).toBeInTheDocument();
    expect(screen.queryByText('2. Default visual style preference?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Project' }));

    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByText('2. Default visual style preference?')).toBeInTheDocument();
    expect(screen.queryByText('1. Where to save preferences?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'None (Recommended)' })).toBeInTheDocument();
  });
});
