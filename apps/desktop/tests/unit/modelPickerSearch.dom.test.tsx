import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpModelInfo } from '@sudowork/common/acpTypes';

const state = vi.hoisted(() => ({
  availableModels: vi.fn(),
  userModel: vi.fn(),
  setUserModel: vi.fn(),
  setModel: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('swr', () => ({ default: () => ({ data: providers }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ isGuest: false }) }));
vi.mock('@renderer/pages/conversation/preview', () => ({ usePreviewContext: () => ({ isOpen: false }) }));
vi.mock('@sudowork/common/storage', () => ({ ConfigStorage: { get: vi.fn().mockResolvedValue([]) } }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  moss: {
    getAvailableModels: { invoke: state.availableModels },
    getUserModel: { invoke: state.userModel },
    setUserModel: { invoke: state.setUserModel },
  },
  acpConversation: { setModel: { invoke: state.setModel }, responseStream: { on: () => () => undefined } },
}));

import AcpModelSelector from '@renderer/components/AcpModelSelector';
import GuidModelSelector from '@renderer/pages/guid/components/GuidModelSelector';

const models = [
  ...Array.from({ length: 43 }, (_, index) => ({ id: `openai:gpt-option-${index}`, label: `GPT option ${index}`, provider: 'openai', providerLabel: 'OpenAI' })),
  ...Array.from({ length: 14 }, (_, index) => ({ id: `anthropic:claude-option-${index}`, label: `Claude option ${index}`, provider: 'anthropic', providerLabel: 'Anthropic' })),
];
const providers = ['OpenAI', 'Anthropic'].map((name) => ({ id: name, name, model: models.filter((model) => model.providerLabel === name).map((model) => model.id) }));
const modelInfo: AcpModelInfo = { source: 'models', currentModelId: models[0].id, currentModelLabel: models[0].label, canSwitch: true, availableModels: models };

beforeEach(() => {
  state.availableModels.mockReset().mockResolvedValue({ success: true, data: models });
  state.userModel.mockReset().mockResolvedValue({ success: true, data: { modelId: models[0].id } });
  state.setUserModel.mockReset().mockResolvedValue({ success: true });
  state.setModel.mockReset().mockResolvedValue({ success: true });
});

afterEach(cleanup);

describe.each(['new conversation', 'existing conversation'])('model search in %s', (location) => {
  async function openSelector() {
    const onSelect = vi.fn();
    if (location === 'new conversation') {
      render(<GuidModelSelector isGeminiMode={false} modelList={[]} currentModel={undefined} setCurrentModel={vi.fn()} geminiModeLookup={new Map()} currentAcpCachedModelInfo={modelInfo} selectedAcpModel={models[0].id} setSelectedAcpModel={onSelect} />);
    } else {
      render(<AcpModelSelector conversationId='cloud-conversation' backend='remote-agent' initialModelId={models[0].id} />);
      await waitFor(() => expect(state.userModel).toHaveBeenCalled());
    }
    const trigger = await screen.findByRole('button', { name: location === 'new conversation' ? 'conversation.welcome.selectModel' : models[0].label });
    fireEvent.click(trigger);
    const search = await screen.findByRole('textbox', { name: 'common.searchModels' });
    return { onSelect, search, trigger };
  }

  it('finds and selects Claude below a long OpenAI list', async () => {
    const { onSelect, search } = await openSelector();
    expect(screen.getByText('GPT option 42')).toBeTruthy();
    fireEvent.change(search, { target: { value: '  cLaUdE  ' } });
    expect(screen.queryByText('GPT option 42')).toBeNull();
    fireEvent.click(screen.getByText('Claude option 13'));

    if (location === 'new conversation') {
      expect(onSelect).toHaveBeenCalledWith('anthropic:claude-option-13');
    } else {
      await waitFor(() => expect(state.setUserModel).toHaveBeenCalledWith({ modelId: 'anthropic:claude-option-13' }));
      await waitFor(() => expect(state.setModel).toHaveBeenCalledWith({ conversationId: 'cloud-conversation', modelId: 'anthropic:claude-option-13' }));
    }
  });

  it('searches provider names and exact model identifiers', async () => {
    const { search } = await openSelector();
    fireEvent.change(search, { target: { value: 'Anthropic' } });
    expect(screen.getByText('Claude option 0')).toBeTruthy();
    expect(screen.getByText('Claude option 13')).toBeTruthy();
    expect(screen.queryByText('GPT option 42')).toBeNull();
    fireEvent.change(search, { target: { value: 'anthropic:claude-option-13' } });
    expect(screen.getByText('Claude option 13')).toBeTruthy();
    expect(screen.queryByText('Claude option 0')).toBeNull();
  });

  it('shows an empty result and restores all models when cleared or reopened', async () => {
    const { search, trigger } = await openSelector();
    fireEvent.change(search, { target: { value: 'missing-provider' } });
    expect(screen.getByRole('status').textContent).toBe('common.noMatchingModels');
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('GPT option 42')).toBeTruthy();
    expect(screen.getByText('Claude option 13')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'claude' } });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'common.searchModels' })).toHaveValue(''));
    expect(screen.getByText('GPT option 42')).toBeTruthy();
  });
});
