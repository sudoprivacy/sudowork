import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserSessionState } from '@sudowork/contracts/browser-session';
import BrowserSessionPanel from '@renderer/components/browser/BrowserSessionPanel';

const host = vi.hoisted(() => ({ invoke: vi.fn(), ownerInfo: vi.fn(), terminate: vi.fn(), error: vi.fn(), confirm: vi.fn(), info: vi.fn() }));

vi.mock('@renderer/components/browser/WindowStreamSurface', () => ({
  default: () => <div data-testid='streamed-window' />,
}));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  browserSession: {
    invoke: { invoke: (...args: unknown[]) => host.invoke(...args) },
    ownerInfo: { invoke: (...args: unknown[]) => host.ownerInfo(...args) },
  },
  conversation: { terminateMossSession: { invoke: (...args: unknown[]) => host.terminate(...args) } },
}));
vi.mock('react-i18next', () => {
  const t = (key: string) => key.split('.').at(-1);
  return { useTranslation: () => ({ t }) };
});
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, disabled }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Input: () => null,
  Select: () => null,
  Empty: () => null,
  Collapse: Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ header, children }: { header: React.ReactNode; children: React.ReactNode }) => (
      <details>
        <summary>{header}</summary>
        {children}
      </details>
    ),
  }),
  Spin: () => null,
  Modal: { confirm: host.confirm, info: host.info },
  Message: { error: host.error },
}));

function activeSession(): BrowserSessionState {
  return {
    browserSessionId: 'owned-browser',
    profileId: 'owned-profile',
    state: 'human',
    controlEpoch: 4,
    targetEpoch: 2,
    isController: true,
    isHeadless: true,
    transport: 'extension',
    capabilities: { conversationControl: true, pageView: true, windowView: false, persistentProfile: true },
    activeTargetId: 'owned-tab',
    tabs: [{ id: 'owned-tab', title: 'Form', url: 'https://example.test/' }],
    error: null,
  };
}

/** Passive state polls reject with browser_profile_in_use; the occupied view replaces the error banner. */
function occupyProfile(owner: { desiredState: string }, browserRunning: boolean): void {
  host.invoke.mockImplementation(async (request: { action: { kind: string } }) => (request.action.kind === 'state' ? { success: false, msg: 'browser_profile_in_use' } : { success: true, data: activeSession() }));
  host.ownerInfo.mockResolvedValue({ success: true, data: { owner: { sessionId: 'occupant-session-123456789', desiredState: owner.desiredState }, browserRunning } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  host.invoke.mockReset();
  host.ownerInfo.mockReset();
  host.terminate.mockReset();
});

it('shows who holds the profile and keeps takeover disabled while the occupant runs', async () => {
  occupyProfile({ desiredState: 'active' }, true);
  render(<BrowserSessionPanel conversationId='conversation-a' />);
  await waitFor(() => expect(screen.getByText('occupiedRunning')).toBeTruthy());
  expect(screen.getByText('takeover').closest('button')?.disabled).toBe(true);
  expect(screen.getByText('terminateOccupant').closest('button')?.disabled).toBe(false);
});

it('takes over an idle browser through the explicit start action', async () => {
  occupyProfile({ desiredState: 'active' }, false);
  render(<BrowserSessionPanel conversationId='conversation-a' />);
  await waitFor(() => expect(screen.getByText('occupiedIdle')).toBeTruthy());
  const takeover = screen.getByText('takeover').closest('button');
  expect(takeover?.disabled).toBe(false);
  fireEvent.click(takeover!);
  await waitFor(() => expect(host.invoke).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ kind: 'start' }) })));
});

it('ends the occupying conversation on demand and then allows takeover', async () => {
  occupyProfile({ desiredState: 'active' }, true);
  host.terminate.mockResolvedValue({ success: true });
  render(<BrowserSessionPanel conversationId='conversation-a' />);
  await waitFor(() => expect(screen.getByText('terminateOccupant').closest('button')?.disabled).toBe(false));
  fireEvent.click(screen.getByText('terminateOccupant').closest('button')!);
  await waitFor(() => expect(host.terminate).toHaveBeenCalledWith({ conversation_id: 'occupant-session-123456789' }));
  await waitFor(() => expect(screen.getByText('takeover').closest('button')?.disabled).toBe(false));
});
