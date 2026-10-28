import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ changePassword: vi.fn(), logout: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => mocks }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@arco-design/web-react', async (original) => ({ ...(await original<typeof import('@arco-design/web-react')>()), Message: { error: mocks.error, warning: mocks.warning, success: vi.fn() } }));
import ChangePasswordModal from '@renderer/pages/settings/profile/components/ChangePasswordModal';
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);
function fill(confirmation: string) {
  fireEvent.change(screen.getByPlaceholderText('settings.changePassword.oldPasswordPlaceholder'), { target: { value: 'OldPassword1!' } });
  fireEvent.change(screen.getByPlaceholderText('settings.changePassword.newPasswordPlaceholder'), { target: { value: 'NewPassword1!' } });
  fireEvent.change(screen.getByPlaceholderText('settings.changePassword.confirmPassword'), { target: { value: confirmation } });
  fireEvent.click(screen.getByText('settings.changePassword.confirm'));
}
it('does not send a mismatched password confirmation', () => {
  render(<ChangePasswordModal visible isEnterprise onClose={vi.fn()} />);
  fill('Different1!');
  expect(mocks.changePassword).not.toHaveBeenCalled();
  expect(mocks.logout).not.toHaveBeenCalled();
});
it('retains the session on failure and signs out only after a successful password change', async () => {
  render(<ChangePasswordModal visible isEnterprise onClose={vi.fn()} />);
  mocks.changePassword.mockResolvedValueOnce({ success: false, message: 'wrong password' });
  fill('NewPassword1!');
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('wrong password'));
  expect(mocks.logout).not.toHaveBeenCalled();
  mocks.changePassword.mockResolvedValueOnce({ success: true });
  fill('NewPassword1!');
  await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
});
