import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(window, 'electronAPI', { value: undefined, configurable: true, writable: true });
});
const mocks = vi.hoisted(() => ({ logout: vi.fn(), set: vi.fn(), verify: vi.fn(), get: vi.fn(), fetch: vi.fn() }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ logout: mocks.logout }) }));
vi.mock('@sudowork/common/storage', () => ({ ConfigStorage: { get: mocks.get, set: mocks.set } }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ eeclaw: { verifyServer: { invoke: mocks.verify } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/components/base/PageWrapper', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Input: ({ value, onChange, disabled, ...props }: { value: string; onChange: (value: string) => void; disabled: boolean }) => <input {...props} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />,
  Spin: () => <span>spinner</span>,
  Message: { error: vi.fn(), success: vi.fn() },
}));

// This module runs in the WebUI host, whose active identity is a cookie session.
import EnterpriseSettings from '@renderer/pages/settings/enterprise';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('login.mossBaseUrl', 'http://old.test');
  mocks.get.mockResolvedValue('Original Company');
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps the active connection and session after an invalid draft, and clears the error on return to the saved URL', async () => {
  render(<EnterpriseSettings />);
  await screen.findByText('settings.enterpriseConnection.connected');
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'file:///bad' } });
  fireEvent.click(screen.getByText('common.save'));
  expect(screen.getByRole('alert').textContent).toContain('invalidUrl');
  expect(screen.getByText('settings.enterpriseConnection.connected')).toBeTruthy();
  expect(localStorage.getItem('login.mossBaseUrl')).toBe('http://old.test');
  expect(mocks.logout).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: ' http://old.test/// ' } });
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByText('common.save') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('settings.enterpriseConnection.recheck'));
  await screen.findByText('settings.enterpriseConnection.connected');
  expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining('http%3A%2F%2Fold.test'), expect.anything());
});

it('rejects failed remote validation without replacing the saved address, then accepts a corrected address', async () => {
  render(<EnterpriseSettings />);
  await screen.findByText('settings.enterpriseConnection.connected');
  mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 502 }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'http://bad.test' } });
  fireEvent.click(screen.getByText('common.save'));
  await screen.findByRole('alert');
  expect(screen.getByText('settings.enterpriseConnection.connected')).toBeTruthy();
  expect(mocks.logout).not.toHaveBeenCalled();
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {} })));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: ' http://new.test/ ' } });
  fireEvent.click(screen.getByText('common.save'));
  await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem('login.mossBaseUrl')).toBe('http://new.test');
});

it('ignores a late successful verification after the settings page is unmounted', async () => {
  const view = render(<EnterpriseSettings />);
  await screen.findByText('settings.enterpriseConnection.connected');
  let finish!: (response: Response) => void;
  mocks.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'http://new.test' } });
  fireEvent.click(screen.getByText('common.save'));
  view.unmount();
  await act(async () => {
    finish(new Response(JSON.stringify({ success: true, data: {} })));
  });
  expect(localStorage.getItem('login.mossBaseUrl')).toBe('http://old.test');
  expect(mocks.logout).not.toHaveBeenCalled();
});
