import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  availableModels: vi.fn(),
  userModel: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('swr', () => ({ default: () => ({ data: [] }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ isGuest: false }) }));
vi.mock('@renderer/pages/conversation/preview', () => ({ usePreviewContext: () => ({ isOpen: false }) }));
vi.mock('@sudowork/common/storage', () => ({ ConfigStorage: { get: vi.fn().mockResolvedValue([]) } }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  moss: { getAvailableModels: { invoke: state.availableModels }, getUserModel: { invoke: state.userModel } },
  acpConversation: { responseStream: { on: () => () => undefined } },
}));

import AcpModelSelector from '@renderer/components/AcpModelSelector';

const models = [
  { id: 'legacy-default:claude-haiku-5-5', name: 'Owner Haiku' },
  { id: 'legacy-default:gpt-5-codex', name: 'Admin GPT' },
];

beforeEach(() => {
  state.availableModels.mockReset().mockResolvedValue({ success: true, data: models });
  state.userModel.mockReset().mockResolvedValue({ success: true, data: { modelId: 'legacy-default:gpt-5-codex' } });
});

afterEach(cleanup);

describe('remote conversation model selection', () => {
  it('preserves the owner conversation model instead of applying the administrator preference', async () => {
    render(React.createElement(AcpModelSelector, { conversationId: 'managed-owner', backend: 'remote-agent', initialModelId: 'claude-haiku-5-5' }));
    await waitFor(() => expect(state.userModel).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Owner Haiku' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Admin GPT' })).toBeNull();
  });

  it('uses the user preference when the conversation has no selected model', async () => {
    render(React.createElement(AcpModelSelector, { conversationId: 'new-owner', backend: 'remote-agent' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Admin GPT' })).toBeTruthy());
  });

  it('ignores a cancelled conversation model request after another conversation opens', async () => {
    let finishFirst!: (result: { success: boolean; data: typeof models }) => void;
    state.availableModels.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        })
    );
    const { rerender } = render(React.createElement(AcpModelSelector, { conversationId: 'first-owner', backend: 'remote-agent', initialModelId: 'claude-haiku-5-5' }));
    await waitFor(() => expect(state.availableModels).toHaveBeenCalledTimes(1));
    rerender(React.createElement(AcpModelSelector, { conversationId: 'second-owner', backend: 'remote-agent', initialModelId: 'legacy-default:gpt-5-codex' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Admin GPT' })).toBeTruthy());
    await act(async () => finishFirst({ success: true, data: [{ id: 'claude-haiku-5-5', name: 'Owner Haiku' }] }));
    expect(screen.getByRole('button', { name: 'Admin GPT' })).toBeTruthy();
  });
});
