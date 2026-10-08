import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), emit: vi.fn(), history: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ eeclaw: { getMyAgents: { invoke: mocks.list }, createUserAgent: { invoke: mocks.create } }, database: { getUserConversations: { invoke: mocks.history } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/utils/emitter', () => ({ emitter: { emit: mocks.emit } }));
import MyAgents from '@renderer/pages/my-agents';

const owned = { ref: 'moss-agent:own:mine', displayName: 'Private assistant', kind: 'own' };
function Location() {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname + location.search}</div>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ success: true, data: [owned, { ref: 'template', displayName: 'Shared template', kind: 'template' }] });
  mocks.create.mockResolvedValue({ success: true, data: { id: 'new', displayName: 'New Agent' } });
  mocks.history.mockResolvedValue([]);
});
afterEach(cleanup);
function renderPage() {
  render(
    <MemoryRouter>
      <MyAgents />
      <Location />
    </MemoryRouter>
  );
}

describe('My Agents page', () => {
  it('starts a conversation using the stable owned identity', async () => {
    renderPage();
    await screen.findByText(owned.displayName);
    expect(screen.queryByText('Shared template')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'agent.mine.startConversation' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/guid?assistant=moss-agent%3Aown%3Amine');
  });
  it('opens the latest conversation for this Agent and preserves a separate new-conversation action', async () => {
    mocks.history.mockResolvedValue([
      { id: 'older', createTime: 1, modifyTime: 1, extra: { mossAssistantRef: owned.ref } },
      { id: 'foreign-agent', createTime: 30, modifyTime: 30, extra: { mossAssistantRef: 'moss-agent:own:other' } },
      { id: 'latest', createTime: 2, modifyTime: 20, extra: { mossAssistantRef: owned.ref, pinned: true } },
    ]);
    renderPage();
    await screen.findByText(owned.displayName);
    fireEvent.click(screen.getByRole('button', { name: `agent.mine.open ${owned.displayName}` }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/conversation/latest'));
    fireEvent.click(screen.getByRole('button', { name: 'agent.mine.startConversation' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/guid?assistant=moss-agent%3Aown%3Amine');
  });
  it('starts the first conversation when opening an unused Agent', async () => {
    renderPage();
    await screen.findByText(owned.displayName);
    fireEvent.click(screen.getByRole('button', { name: `agent.mine.open ${owned.displayName}` }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/guid?assistant=moss-agent%3Aown%3Amine'));
  });
  it('shows an actionable failure and reloads after retry', async () => {
    mocks.list.mockResolvedValueOnce({ success: false });
    renderPage();
    await screen.findByText('agent.mine.loadFailed');
    expect(screen.getByRole('button', { name: 'agent.mine.create' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'agent.mine.retry' }));
    await screen.findByText(owned.displayName);
    expect(screen.queryByText('agent.mine.loadFailed')).toBeNull();
  });
  it('rejects a blank name, creates with the trimmed name, and refreshes both lists', async () => {
    renderPage();
    await screen.findByText(owned.displayName);
    fireEvent.click(screen.getByRole('button', { name: 'agent.mine.create' }));
    const input = await screen.findByRole('textbox', { name: 'agent.mine.name' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '  New Agent  ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ displayName: 'New Agent' }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.emit).toHaveBeenCalledWith('chat.history.refresh');
  });
});
