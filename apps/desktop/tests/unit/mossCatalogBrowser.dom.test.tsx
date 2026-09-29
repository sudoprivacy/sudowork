import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MossCatalogBrowser from '@renderer/components/MossCatalogBrowser';

const state = vi.hoisted(() => ({ user: { id: 'a', enterprise_code: 'org' }, list: vi.fn(), installed: vi.fn(), install: vi.fn(), detail: vi.fn(), remove: vi.fn(), navigate: vi.fn(), error: vi.fn() }));
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
    Typography: { Paragraph: Box },
    Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? <div>{children}</div> : null),
    Alert: ({ content }: { content: string }) => <div role='alert'>{content}</div>,
    Message: { success: vi.fn(), error: state.error },
  };
});
const remote = { kind: 'agents', source: 'hub', id: 'a1', name: 'Agent', displayName: 'Catalog agent', description: '', categories: [], version: '1', isAvailable: true };
const props = { kind: 'agents' as const, customContent: React.createElement('div', null, 'Local custom'), onCreate: vi.fn(), onInstalled: vi.fn(async () => {}) };
beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'a', enterprise_code: 'org' };
  state.list.mockResolvedValue({ success: true, data: { items: [remote], categories: [], nextCursor: null } });
  state.installed.mockResolvedValue({ success: true, data: [] });
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

it('opens My resource details from the downloaded version and displays failures', async () => {
  state.installed.mockResolvedValue({ success: true, data: [{ ...remote, isEnabled: true }] });
  state.detail.mockResolvedValue({ success: false, msg: 'Snapshot missing' });
  render(<MossCatalogBrowser {...props} />);
  await screen.findByText('Catalog agent');
  fireEvent.click(screen.getByText('myAgents'));
  fireEvent.click(screen.getByText('details'));
  await screen.findByRole('alert', { name: '' });
  await screen.findByText('Snapshot missing');
  expect(state.detail).toHaveBeenCalledWith({ kind: 'agents', source: 'hub', id: 'a1', isLocal: true });
});
afterEach(cleanup);

it('shows the server catalog before any download, and My contains only local records', async () => {
  render(<MossCatalogBrowser {...props} />);
  await screen.findByText('Catalog agent');
  expect(state.install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('myAgents'));
  expect(screen.queryByText('Catalog agent')).toBeNull();
  expect(screen.getByText('Local custom')).toBeTruthy();
});

it('does not enter a conversation or show an installation when preparation fails', async () => {
  state.install.mockResolvedValue({ success: false, msg: 'Dependency failed' });
  render(<MossCatalogBrowser {...props} />);
  fireEvent.click(await screen.findByText('use'));
  await waitFor(() => expect(state.error).toHaveBeenCalledWith('Dependency failed'));
  expect(state.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('myAgents'));
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
