import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BoundModelReviewAction from '@renderer/components/browser/BoundModelReviewAction';

const host = vi.hoisted(() => ({ project: vi.fn(), review: vi.fn(), browser: vi.fn(), error: vi.fn(), viewer: vi.fn(), stream: vi.fn() }));
let onStream: ((message: { conversation_id: string; type: string; data?: { status: string } }) => void) | undefined;
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  ontology: { getSessionProject: { invoke: host.project }, openSessionReview: { invoke: host.review } },
  browserSession: { invoke: { invoke: host.browser } },
  conversation: { responseStream: { on: host.stream } },
}));
vi.mock('@renderer/components/browser/openBrowserSessionWindow', () => ({ openBrowserSessionWindow: host.viewer }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, disabled, title }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button disabled={disabled} title={title} onClick={onClick}>
      {children}
    </button>
  ),
  Message: { error: host.error },
}));
const project = { projectId: 'project', authorityRef: 'source', modelRef: 'model', sourceRefs: ['source'] };
const session = {
  browserSessionId: 'browser',
  profileId: 'profile',
  state: 'human',
  controlEpoch: 4,
  targetEpoch: 7,
  isController: true,
  isHeadless: false,
  transport: 'cdp',
  capabilities: { pageView: true, windowView: false, persistentProfile: true },
  activeTargetId: 'tab',
  tabs: [{ id: 'tab', title: 'Model', url: 'https://host.invalid/' }],
  error: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  onStream = undefined;
  host.stream.mockImplementation((listener: typeof onStream) => {
    onStream = listener;
    return () => {
      onStream = undefined;
    };
  });
  host.project.mockResolvedValue({ success: true, data: project });
  host.review.mockResolvedValue({ success: true, data: { surface: 'viewer', conversationId: 'conversation' } });
  host.browser.mockResolvedValue({ success: true, data: { session } });
});
afterEach(cleanup);

it('opens the existing browser viewer using only the current generations and conversation identity', async () => {
  render(<BoundModelReviewAction conversationId='conversation' />);
  fireEvent.click(await screen.findByRole('button', { name: 'ontology.studio.openReview' }));
  await waitFor(() => expect(host.viewer).toHaveBeenCalledExactlyOnceWith('conversation'));
  expect(host.review).toHaveBeenCalledExactlyOnceWith({ conversationId: 'conversation', epochs: { controlEpoch: 4, targetEpoch: 7 } });
  expect(host.browser).toHaveBeenCalledExactlyOnceWith({ conversationId: 'conversation', action: { kind: 'state' } });
});

it('ordinary conversations do not gain another model surface or start a browser', async () => {
  host.project.mockResolvedValue({ success: true, data: null });
  render(<BoundModelReviewAction conversationId='ordinary' />);
  await waitFor(() => expect(host.project).toHaveBeenCalled());
  expect(screen.queryByRole('button')).toBeNull();
  expect(host.browser).not.toHaveBeenCalled();
});

it('review does not interrupt an agent or silently take its browser control', async () => {
  host.browser.mockResolvedValue({ success: true, data: { session: { ...session, state: 'ai', isController: false } } });
  render(<BoundModelReviewAction conversationId='conversation' />);
  fireEvent.click(await screen.findByRole('button'));
  await waitFor(() => expect(host.error).toHaveBeenCalledWith('ontology.studio.reviewBrowserRequired'));
  expect(host.browser).toHaveBeenCalledTimes(1);
  expect(host.review).not.toHaveBeenCalled();
  expect(host.viewer).not.toHaveBeenCalled();
});

it('an explicit review action starts an unoccupied browser through the normal browser port', async () => {
  host.browser.mockResolvedValueOnce({ success: true, data: { session: { ...session, state: 'stopped' } } });
  render(<BoundModelReviewAction conversationId='conversation' />);
  fireEvent.click(await screen.findByRole('button'));
  await waitFor(() => expect(host.viewer).toHaveBeenCalled());
  expect(host.browser).toHaveBeenNthCalledWith(2, { conversationId: 'conversation', action: { kind: 'start', isHeadless: false, transport: 'cdp' } });
});

it('leaving the conversation before a state read completes cannot start or open its browser', async () => {
  let finish!: (value: unknown) => void;
  host.browser.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const view = render(<BoundModelReviewAction conversationId='conversation' />);
  fireEvent.click(await screen.findByRole('button'));
  view.unmount();
  finish({ success: true, data: { session: { ...session, state: 'stopped' } } });
  await waitFor(() => expect(host.browser).toHaveBeenCalledTimes(1));
  expect(host.review).not.toHaveBeenCalled();
  expect(host.viewer).not.toHaveBeenCalled();
});

it('a response for another conversation cannot open a viewer', async () => {
  host.review.mockResolvedValue({ success: true, data: { surface: 'viewer', conversationId: 'other' } });
  render(<BoundModelReviewAction conversationId='conversation' />);
  fireEvent.click(await screen.findByRole('button'));
  await waitFor(() => expect(host.error).toHaveBeenCalledWith('ontology.studio.reviewUnavailable'));
  expect(host.viewer).not.toHaveBeenCalled();
});

it('discovers a model created during this conversation through the normal completed-turn event', async () => {
  host.project.mockResolvedValueOnce({ success: true, data: null });
  render(<BoundModelReviewAction conversationId='conversation' />);
  await waitFor(() => expect(host.project).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button')).toBeNull();
  act(() => onStream?.({ conversation_id: 'other', type: 'finish' }));
  expect(host.project).toHaveBeenCalledTimes(1);
  act(() => onStream?.({ conversation_id: 'conversation', type: 'finish' }));
  expect(await screen.findByRole('button', { name: 'ontology.studio.openReview' })).toBeTruthy();
  expect(host.project).toHaveBeenCalledTimes(2);
  expect(host.browser).not.toHaveBeenCalled();
  expect(host.review).not.toHaveBeenCalled();
});

it('an old discovery response cannot hide the model returned after session recovery', async () => {
  let finish!: (value: unknown) => void;
  host.project.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  render(<BoundModelReviewAction conversationId='conversation' />);
  act(() => onStream?.({ conversation_id: 'conversation', type: 'agent_status', data: { status: 'session_active' } }));
  expect(await screen.findByRole('button')).toBeTruthy();
  await act(async () => finish({ success: true, data: null }));
  expect(screen.getByRole('button')).toBeTruthy();
});

it('a current binding failure disables review and a later authoritative refresh can recover', async () => {
  render(<BoundModelReviewAction conversationId='conversation' />);
  await screen.findByRole('button');
  host.project.mockResolvedValueOnce({ success: false });
  act(() => onStream?.({ conversation_id: 'conversation', type: 'finish' }));
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true));
  act(() => onStream?.({ conversation_id: 'conversation', type: 'finish' }));
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(false));
  expect(host.browser).not.toHaveBeenCalled();
});
