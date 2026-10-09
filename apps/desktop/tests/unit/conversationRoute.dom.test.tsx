import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationPage from '@renderer/pages/conversation';

const bridge = vi.hoisted(() => ({ get: vi.fn(), openTab: vi.fn(), closePreview: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  conversation: { get: { invoke: bridge.get } },
  skillHub: { changed: { on: () => () => {} } },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/pages/conversation/preview', () => ({ usePreviewContext: () => ({ closePreview: bridge.closePreview }) }));
vi.mock('@renderer/pages/conversation/context/ConversationTabsContext', () => ({ useConversationTabs: () => ({ openTab: bridge.openTab }) }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: false }) }));
vi.mock('@renderer/utils/platform', () => ({ isWebBridgeAvailable: () => true }));
vi.mock('@renderer/utils/emitter', () => ({ addEventListener: () => () => {}, emitter: { emit: vi.fn() } }));
vi.mock('@renderer/pages/conversation/ChatConversation', () => ({
  default: ({ conversation }: { conversation?: { id: string } }) => <div>Conversation {conversation?.id}</div>,
}));

function mount() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, revalidateOnFocus: false }}>
      <MemoryRouter initialEntries={['/conversation/old-link']}>
        <Routes>
          <Route path='/conversation/:id' element={<ConversationPage />} />
          <Route path='/guid' element={<div>New task</div>} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>
  );
}

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('conversation route recovery', () => {
  it('waits for the lookup before returning a missing conversation to new task', async () => {
    let resolveLookup!: (value: undefined) => void;
    bridge.get.mockReturnValue(
      new Promise<undefined>((resolve) => {
        resolveLookup = resolve;
      })
    );
    mount();
    await waitFor(() => expect(bridge.get).toHaveBeenCalledWith({ id: 'old-link' }));
    expect(screen.queryByText('New task')).not.toBeInTheDocument();
    resolveLookup(undefined);
    expect(await screen.findByText('New task')).toBeInTheDocument();
    expect(bridge.openTab).not.toHaveBeenCalled();
  });

  it('keeps failed requests on the conversation page and lets the user retry', async () => {
    bridge.get.mockRejectedValueOnce(new Error('Network unavailable'));
    bridge.get.mockResolvedValue({ id: 'old-link', type: 'gemini', extra: {} });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'common.retry' }));
    expect(await screen.findByText('Conversation old-link')).toBeInTheDocument();
    expect(screen.queryByText('New task')).not.toBeInTheDocument();
    expect(bridge.get).toHaveBeenCalledTimes(2);
  });

  it('opens an existing conversation without redirecting', async () => {
    bridge.get.mockResolvedValue({ id: 'old-link', type: 'gemini', extra: {} });
    mount();
    expect(await screen.findByText('Conversation old-link')).toBeInTheDocument();
    expect(screen.queryByText('New task')).not.toBeInTheDocument();
  });
});
