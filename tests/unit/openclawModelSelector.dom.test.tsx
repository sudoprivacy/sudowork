/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OpenClawModelSelector from '@/renderer/components/OpenClawModelSelector';

const { mockGetModelsInvoke, mockSelectModelInvoke, mockSetSessionModelInvoke, mockConversationGetInvoke, mockConversationUpdateInvoke } = vi.hoisted(() => ({
  mockGetModelsInvoke: vi.fn(),
  mockSelectModelInvoke: vi.fn(),
  mockSetSessionModelInvoke: vi.fn(),
  mockConversationGetInvoke: vi.fn(),
  mockConversationUpdateInvoke: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    openclaw: {
      getModels: {
        invoke: mockGetModelsInvoke,
      },
      selectModel: {
        invoke: mockSelectModelInvoke,
      },
    },
    openclawConversation: {
      setSessionModel: {
        invoke: mockSetSessionModelInvoke,
      },
    },
    conversation: {
      get: {
        invoke: mockConversationGetInvoke,
      },
      update: {
        invoke: mockConversationUpdateInvoke,
      },
    },
  },
}));

vi.mock('@/renderer/context/LayoutContext', () => ({
  useLayoutContext: () => ({
    isMobile: false,
  }),
}));

vi.mock('@/renderer/pages/conversation/preview', () => ({
  usePreviewContext: () => ({
    isOpen: false,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('OpenClawModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetModelsInvoke.mockResolvedValue({
      success: true,
      data: [
        {
          model_id: 'gemini-3-pro-preview',
          model_ratio: 1,
          isPrimary: true,
        },
      ],
    });
    mockSelectModelInvoke.mockResolvedValue(undefined);
    mockSetSessionModelInvoke.mockResolvedValue({ success: true });
    mockConversationGetInvoke.mockResolvedValue({
      id: 'conv-1',
      extra: {},
    });
    mockConversationUpdateInvoke.mockResolvedValue(true);
  });

  it('syncs the selected model to the active session and persists it to conversation extra', async () => {
    render(<OpenClawModelSelector conversationId='conv-1' />);

    await waitFor(() => {
      expect(mockSelectModelInvoke).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        modelId: 'gemini-3-pro-preview',
        modelRatio: 1,
      });
    });

    expect(mockSetSessionModelInvoke).toHaveBeenCalledWith({
      conversation_id: 'conv-1',
      modelId: 'gemini-3-pro-preview',
    });

    expect(mockConversationUpdateInvoke).toHaveBeenCalledWith({
      id: 'conv-1',
      updates: {
        extra: {
          openclawModelId: 'gemini-3-pro-preview',
        },
      },
    });
  });
});
