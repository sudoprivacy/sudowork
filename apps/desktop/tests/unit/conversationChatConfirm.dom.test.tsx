import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfirmation } from '@sudowork/common/chatLib';

const state = vi.hoisted(() => ({
  list: vi.fn(),
  confirm: vi.fn(),
  listeners: new Map<string, (data: IConfirmation<string> & { conversation_id: string }) => void>(),
}));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  conversation: {
    confirmation: {
      list: { invoke: state.list },
      confirm: { invoke: state.confirm },
      ...Object.fromEntries(
        ['add', 'remove', 'update'].map((name) => [
          name,
          {
            on: (listener: (data: IConfirmation<string> & { conversation_id: string }) => void) => {
              state.listeners.set(name, listener);
              return () => state.listeners.delete(name);
            },
          },
        ])
      ),
    },
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import ConversationChatConfirm from '@renderer/pages/conversation/components/ConversationChatConfirm';

const request: IConfirmation<string> = {
  id: 'approval-1',
  callId: 'tool-1',
  title: 'Run Bash?',
  description: 'git status --short',
  options: [
    { label: 'Allow once', value: 'proceed_once' },
    { label: 'Always allow', value: 'proceed_always' },
    { label: 'Reject', value: 'cancel' },
  ],
};

beforeEach(() => {
  state.list.mockResolvedValue([request]);
  state.confirm.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.listeners.clear();
});

describe('shared approval panel', () => {
  it('submits the clicked action once without changing the protocol payload', async () => {
    render(
      <ConversationChatConfirm conversation_id='chat'>
        <input aria-label='Draft' />
      </ConversationChatConfirm>
    );
    fireEvent.click(await screen.findByRole('button', { name: /Reject/ }));
    expect(state.confirm).toHaveBeenCalledExactlyOnceWith({ conversation_id: 'chat', callId: 'tool-1', msg_id: 'approval-1', data: 'cancel' });
    expect(screen.queryByRole('region', { name: 'Run Bash?' })).toBeNull();
  });

  it.each([
    ['Enter', 'proceed_once'],
    ['Escape', 'cancel'],
    ['a', 'proceed_always'],
    ['2', 'proceed_always'],
  ])('preserves the %s shortcut', async (key, data) => {
    render(<ConversationChatConfirm conversation_id='chat' />);
    await screen.findByRole('button', { name: /Allow once/ });
    fireEvent.keyDown(document.body, { key });
    expect(state.confirm).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data }));
  });

  it('does not redirect Enter on a focused reject button to the first action', async () => {
    render(<ConversationChatConfirm conversation_id='chat' />);
    const reject = await screen.findByRole('button', { name: /Reject/ });
    reject.focus();
    fireEvent.keyDown(reject, { key: 'Enter' });
    expect(state.confirm).not.toHaveBeenCalled();
    fireEvent.click(reject);
    expect(state.confirm).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: 'cancel' }));
  });

  it('keeps the composer mounted and its draft when approval arrives and disappears', async () => {
    state.list.mockResolvedValue([]);
    const onMount = vi.fn();
    function Composer() {
      useEffect(onMount, []);
      return <input aria-label='Draft' defaultValue='Keep this draft' />;
    }
    render(
      <ConversationChatConfirm conversation_id='chat'>
        <Composer />
      </ConversationChatConfirm>
    );
    await waitFor(() => expect(state.listeners.has('add')).toBe(true));
    const input = screen.getByRole('textbox', { name: 'Draft' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(state.confirm).not.toHaveBeenCalled();
    act(() => state.listeners.get('add')!({ ...request, conversation_id: 'chat' }));
    fireEvent.click(await screen.findByRole('button', { name: /Allow once/ }));
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
    expect(input).toHaveValue('Keep this draft');
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});
