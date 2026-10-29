import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MossCatalogBrowser from '@renderer/components/MossCatalogBrowser';

const state = vi.hoisted(() => ({ mode: 'local' as 'local' | 'remote', user: { id: 'a', enterprise_code: 'org' }, list: vi.fn(), installed: vi.fn(), install: vi.fn(), detail: vi.fn(), remove: vi.fn(), navigate: vi.fn(), error: vi.fn(), history: vi.fn(), emit: vi.fn() }));
vi.mock('@renderer/pages/guid/hooks/useGuidAgentSelection', () => ({ getRendererSessionMode: () => state.mode }));
vi.mock('@renderer/pages/conversation/context/ConversationHistoryContext', () => ({ useConversationHistory: () => ({ scopeKey: `${state.user.id}:${state.user.enterprise_code}`, getFreshConversations: state.history }) }));
vi.mock('@renderer/utils/emitter', () => ({ emitter: { emit: state.emit } }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key.split('.').at(-1);
  return { useTranslation: () => ({ t }) };
});
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  mossCatalog: {
    list: { invoke: (...args: unknown[]) => state.list(...args) },
    installed: { invoke: () => state.installed() },
    install: { invoke: (...args: unknown[]) => state.install(...args) },
    remove: { invoke: (...args: unknown[]) => state.remove(...args) },
    changed: { on: () => () => {} },
    detail: { invoke: (...args: unknown[]) => state.detail(...args) },
    setEnabled: { invoke: vi.fn() },
  },
}));
vi.mock('@arco-design/web-react', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Tabs = ({ children, onChange }: { children: React.ReactNode; onChange: (key: string) => void }) => <div>{React.Children.map(children, (child) => React.isValidElement<{ title: string }>(child) && <button onClick={() => onChange(String(child.key))}>{child.props.title}</button>)}</div>;
  return {
    Tabs: Object.assign(Tabs, { TabPane: Box }),
    Card: ({ title, children }: { title: React.ReactNode; children: React.ReactNode }) => (
      <section>
        {title}
        {children}
      </section>
    ),
    Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) => (
      <button disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    Input: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <input value={value} onChange={(event) => onChange(event.target.value)} />,
    Select: ({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) => (
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
    Space: Box,
    Spin: Box,
    Switch: () => null,
    Tag: Box,
    Typography: { Paragraph: Box, Title: Box },
    Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? <div>{children}</div> : null),
    Alert: ({ content }: { content: string }) => <div role='alert'>{content}</div>,
    Message: { success: vi.fn(), error: state.error },
  };
});
const remote = { kind: 'agents', source: 'hub', id: 'a1', name: 'Agent', displayName: 'Catalog agent', description: '', categories: [], version: '1', isAvailable: true };
const props = { kind: 'agents' as const, customContent: React.createElement('div', null, 'Local custom'), onCreate: vi.fn(), onInstalled: vi.fn(async () => {}) };
beforeEach(() => {
  vi.clearAllMocks();
  state.mode = 'local';
  state.user = { id: 'a', enterprise_code: 'org' };
  state.list.mockResolvedValue({ success: true, data: { items: [remote], categories: [], nextCursor: null } });
  state.installed.mockResolvedValue({ success: true, data: [] });
  state.history.mockResolvedValue([]);
  state.detail.mockResolvedValue({ success: true, data: { ...remote, content: '# Published instructions' } });
});

it('opens published details without a download and keeps image failure usable', async () => {
  state.list.mockResolvedValue({ success: true, data: { items: [{ ...remote, icon: 'https://example.test/icon.png', emoji: '🧭' }], categories: [], nextCursor: null } });
  render(<MossCatalogBrowser {...props} />);
  fireEvent.error(await screen.findByRole('img', { name: 'Catalog agent' }));
  expect(screen.getByText('🧭')).toBeTruthy();
  fireEvent.click(screen.getByText('details'));
  await screen.findByText('Published instructions');
  expect(state.detail).toHaveBeenCalledWith({ kind: 'agents', source: 'hub', id: 'a1', isLocal: false });
  expect(state.install).not.toHaveBeenCalled();
});

it('shows account-owned resources in My resources without duplicating published catalog entries', async () => {
  state.installed.mockResolvedValue({ success: true, data: [{ ...remote, isEnabled: true }] });
  render(<MossCatalogBrowser {...props} />);
  await screen.findByText('Catalog agent');
  fireEvent.click(screen.getByText('我的专家'));
  expect(screen.getByText('Local custom')).toBeTruthy();
  expect(screen.queryByText('Catalog agent')).toBeNull();
});
afterEach(cleanup);

it('opens the installed server identity latest Session through the shared Agent entry', async () => {
  state.install.mockResolvedValue({ success: true, data: { id: 'a1', runtimeName: 'Agent' } });
  state.history.mockResolvedValue([{ id: 'previous-session', createTime: 1, modifyTime: 1, extra: { mossAssistantRef: 'a1' } }]);
  render(<MossCatalogBrowser {...props} />);
  fireEvent.click(await screen.findByText('use'));
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/conversation/previous-session'));
  expect(state.emit).toHaveBeenCalledWith('guid.reset');
});

it('opens a draft for an installed Agent without history', async () => {
  state.install.mockResolvedValue({ success: true, data: { id: 'a1', runtimeName: 'Agent' } });
  render(<MossCatalogBrowser {...props} />);
  fireEvent.click(await screen.findByText('use'));
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/guid?assistant=a1'));
});

it('shows the server catalog before any download, and My contains only local records', async () => {
  render(<MossCatalogBrowser {...props} />);
  await screen.findByText('Catalog agent');
  expect(state.install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('我的专家'));
  expect(screen.queryByText('Catalog agent')).toBeNull();
  expect(screen.getByText('Local custom')).toBeTruthy();
});

it('shows organization-published and hosted agents in the available directory', async () => {
  render(<MossCatalogBrowser {...props} publishedContent={(query) => <div>Organization agent: {query}</div>} hostedContent={(query) => <div>Hosted agent: {query}</div>} />);
  await screen.findByText('Catalog agent');
  expect(screen.getByText('Organization agent:')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dify' } });
  expect(screen.getByText('Organization agent: Dify')).toBeTruthy();
  expect(screen.getByText('Hosted agent: Dify')).toBeTruthy();
  fireEvent.click(screen.getByText('我的专家'));
  expect(screen.getByText('Local custom')).toBeTruthy();
  expect(state.install).not.toHaveBeenCalled();
});

it('does not enter a conversation or show an installation when preparation fails', async () => {
  state.install.mockResolvedValue({ success: false, msg: 'Dependency failed' });
  render(<MossCatalogBrowser {...props} />);
  fireEvent.click(await screen.findByText('use'));
  await waitFor(() => expect(state.error).toHaveBeenCalledWith('Dependency failed'));
  expect(state.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('我的专家'));
  expect(screen.queryByText('Catalog agent')).toBeNull();
});

it('discards a download response when the account changes', async () => {
  let resolve!: (value: unknown) => void;
  state.install.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const view = render(<MossCatalogBrowser {...props} />);
  fireEvent.click(await screen.findByText('use'));
  state.user = { id: 'b', enterprise_code: 'other' };
  view.rerender(<MossCatalogBrowser {...props} />);
  await act(async () => resolve({ success: true, data: { ...remote, runtimeName: 'local-a1' } }));
  expect(state.navigate).not.toHaveBeenCalled();
  expect(props.onInstalled).not.toHaveBeenCalled();
});

it('uses remote experts without downloading packages on the desktop', async () => {
  state.mode = 'remote';
  render(<MossCatalogBrowser {...props} />);
  fireEvent.click(await screen.findByText('use'));
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/guid?assistant=a1'));
  expect(state.install).not.toHaveBeenCalled();
});

it('automatically refreshes a cached local expert when the published version changes', async () => {
  state.installed.mockResolvedValue({ success: true, data: [{ ...remote, version: 'old', isEnabled: true }] });
  state.install.mockResolvedValue({ success: true, data: { id: 'a1', runtimeName: 'Agent' } });
  render(<MossCatalogBrowser {...props} />);
  fireEvent.click(await screen.findByText('use'));
  await waitFor(() => expect(state.install).toHaveBeenCalledWith({ kind: 'agents', source: 'hub', id: 'a1', isUpdate: true }));
});

it('shows service experts beside file experts and refreshes the entire directory', async () => {
  const onRefresh = vi.fn();
  window.addEventListener('expert-library-refresh', onRefresh);
  try {
    render(<MossCatalogBrowser {...props} publishedContent={() => <article>Dify arithmetic expert</article>} hostedContent={() => <article>Runtime expert</article>} />);
    const file = await screen.findByText('Catalog agent');
    const service = screen.getByText('Dify arithmetic expert');
    const runtime = screen.getByText('Runtime expert');
    expect(file.closest('article')?.parentElement).toBe(service.parentElement);
    expect(runtime.parentElement).toBe(service.parentElement);
    fireEvent.click(screen.getByText('refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener('expert-library-refresh', onRefresh);
  }
});

it('replaces a Hub listing with its published organization revision', async () => {
  state.list.mockImplementation(async ({ source }: { source: string }) => ({
    success: true,
    data: { items: source === 'hub' ? [remote] : [{ ...remote, id: 'organization-v2', source: 'tenant', displayName: 'Published revision', replacesId: remote.id, version: '2' }], categories: [], nextCursor: null },
  }));
  render(<MossCatalogBrowser {...props} />);
  await screen.findByText('Published revision');
  expect(screen.queryByText('Catalog agent')).toBeNull();
});

it.each(['agents', 'skills'] as const)('shows the published %s version on cards and details instead of the cache revision', async (kind) => {
  const item = { ...remote, kind, source: 'tenant', displayVersion: '1.0.1', version: '2026-10-28T01:02:03Z' };
  state.list.mockResolvedValue({ success: true, data: { items: [item], categories: [], nextCursor: null } });
  state.detail.mockResolvedValue({ success: true, data: { ...item, content: 'Published content' } });
  render(<MossCatalogBrowser {...props} kind={kind} />);
  await screen.findByText('version: 1.0.1');
  expect(screen.queryByText(/2026-10-28T/)).toBeNull();
  fireEvent.click(screen.getByText('details'));
  await waitFor(() => expect(screen.getAllByText('version: 1.0.1')).toHaveLength(2));
  expect(screen.queryByText(/2026-10-28T/)).toBeNull();
});
