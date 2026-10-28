import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'opc-member', enterprise_code: 'opc' },
  list: vi.fn(),
  switchOrg: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: state.user, switchOrganization: state.switchOrg }) }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ eeclaw: { getOrganizations: { invoke: state.list } } }));
vi.mock('@arco-design/web-react', () => ({
  Modal: ({ visible, children, onOk, onCancel, confirmLoading }: { visible: boolean; children: React.ReactNode; onOk: () => void; onCancel: () => void; confirmLoading: boolean }) =>
    visible ? (
      <div role='dialog'>
        {children}
        <button disabled={confirmLoading} onClick={onOk}>
          Confirm
        </button>
        <button disabled={confirmLoading} onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
  Alert: ({ content }: { content: string }) => <div role='alert'>{content}</div>,
  Select: ({ options, value, onChange, ...props }: { options: Array<{ label: string; value: string }>; value: string; onChange: (value: string) => void; disabled?: boolean; 'aria-label'?: string }) => (
    <select aria-label={props['aria-label']} value={value} disabled={props.disabled} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
import OrganizationSwitcher from '@renderer/layouts/components/OrganizationSwitcher';

const memberships = {
  success: true,
  data: {
    organizations: [
      { id: 'opc', name: 'My OPC', userId: 'opc-member', role: 'admin' },
      { id: 'company', name: 'Company', userId: 'company-member', role: 'user' },
    ],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'opc-member', enterprise_code: 'opc' };
  state.list.mockResolvedValue(memberships);
});
afterEach(cleanup);

it('confirms before selecting an enterprise and hands off only after successful authentication', async () => {
  const onReload = vi.fn();
  state.switchOrg.mockResolvedValue({ success: true });
  render(<OrganizationSwitcher onReload={onReload} />);
  fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'company' } });
  expect(state.switchOrg).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').textContent).toContain('Company');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
  expect(state.switchOrg).toHaveBeenCalledWith('company');
  expect(onReload).toHaveBeenCalledTimes(1);
});

it('retains the original identity and reports a rejected enterprise selection', async () => {
  const onReload = vi.fn();
  state.switchOrg.mockResolvedValue({ success: false, message: 'Membership revoked' });
  render(<OrganizationSwitcher onReload={onReload} />);
  fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'company' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Membership revoked');
  expect(onReload).not.toHaveBeenCalled();
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('opc');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('reloads the actual identity after an unexpected transport failure', async () => {
  const onReload = vi.fn();
  state.switchOrg.mockRejectedValue(new Error('Network unavailable'));
  render(<OrganizationSwitcher onReload={onReload} />);
  fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'company' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('opc');
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false);
});

it.each(['networkError', 'timeout', 'setupError', 'invalidResponse'])('reloads the actual identity when the selection outcome is uncertain: %s', async (code) => {
  const onReload = vi.fn();
  state.switchOrg.mockResolvedValue({ success: false, code });
  render(<OrganizationSwitcher onReload={onReload} />);
  fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'company' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('discards a previous persons late membership response after the user changes', async () => {
  let finish!: (value: typeof memberships) => void;
  state.list
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce({ success: true, data: { organizations: [] } });
  const view = render(<OrganizationSwitcher onReload={() => {}} />);
  state.user = { id: 'another-person', enterprise_code: 'another-company' };
  view.rerender(<OrganizationSwitcher onReload={() => {}} />);
  await act(async () => finish(memberships));
  await waitFor(() => expect(state.list).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('combobox')).toBeNull();
});
