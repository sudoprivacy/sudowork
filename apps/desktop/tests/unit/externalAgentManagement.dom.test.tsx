import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => Object.fromEntries(['adminAgents', 'members', 'policy', 'savePolicy', 'inspect', 'onboard', 'update', 'review', 'rotate', 'archive', 'testAgent'].map((key) => [key, vi.fn()])));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ externalProviders: Object.fromEntries(Object.entries(mocks).map(([key, invoke]) => [key, { invoke }])) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import ExternalAgentManagement from '@renderer/pages/external-agents/ExternalAgentManagement';
const key = (name: string) => `agent.external.manage.${name}`;
const onChanged = vi.fn(async () => {});
beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  mocks.adminAgents.mockResolvedValue({ success: true, data: [] });
  mocks.members.mockResolvedValue({ success: true, data: [{ id: 'u', name: 'User' }] });
  mocks.policy.mockResolvedValue({ success: true, data: { enabled: true, endpoints: ['http://127.0.0.1:8089/v1'], revision: 4 } });
  mocks.savePolicy.mockResolvedValue({ success: true, data: { enabled: false, endpoints: [], revision: 5 } });
});
afterEach(cleanup);
function page(isPlatformAdmin = true, isCredentialStorageAvailable = true) {
  render(<ExternalAgentManagement isPlatformAdmin={isPlatformAdmin} isCredentialStorageAvailable={isCredentialStorageAvailable} onChanged={onChanged} />);
}
it('only platform administrators can configure endpoint scope; missing Secret disables onboarding', async () => {
  page(false, false);
  await screen.findByText(key('empty'));
  expect(screen.queryByRole('button', { name: key('configureScope') })).toBeNull();
  expect(screen.getByRole('button', { name: key('add') })).toBeDisabled();
  expect(screen.getByText(key('noSecretService'))).toBeVisible();
});
it('saves pilot policy with the loaded revision', async () => {
  page();
  await screen.findByText(key('empty'));
  fireEvent.click(screen.getByRole('button', { name: key('configureScope') }));
  fireEvent.change(screen.getByRole('textbox', { name: key('endpoints') }), { target: { value: 'http://127.0.0.2/v1' } });
  fireEvent.click(screen.getByRole('button', { name: key('save') }));
  await waitFor(() => expect(mocks.savePolicy).toHaveBeenCalledWith({ enabled: true, endpoints: ['http://127.0.0.2/v1'], revision: 4 }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});
it('failed key verification cannot advance or register and shows a safe error', async () => {
  mocks.inspect.mockResolvedValue({ success: false, msg: 'PROVIDER_PREFLIGHT_FAILED' });
  page();
  await screen.findByText(key('empty'));
  fireEvent.click(screen.getByRole('button', { name: key('add') }));
  fireEvent.change(screen.getByLabelText(key('apiKey')), { target: { value: 'synthetic-key' } });
  fireEvent.click(screen.getByRole('button', { name: key('testAndNext') }));
  await screen.findByText(key('errors.PROVIDER_PREFLIGHT_FAILED'));
  expect(mocks.onboard).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(key('appId'))).toBeNull();
});
it('tests the selected endpoint and key, requires metadata, and clears the key when cancelled', async () => {
  mocks.inspect.mockResolvedValue({ success: true, data: { name: 'Test agent', parameters_digest: 'sha256:abc', checked_at: Date.now() } });
  page();
  await screen.findByText(key('empty'));
  fireEvent.click(screen.getByRole('button', { name: key('add') }));
  fireEvent.change(screen.getByLabelText(key('apiKey')), { target: { value: 'synthetic-key' } });
  fireEvent.click(screen.getByRole('button', { name: key('testAndNext') }));
  await screen.findByLabelText(key('appId'));
  expect(mocks.inspect).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8089/v1', api_key: 'synthetic-key' });
  expect(screen.getByRole('button', { name: key('saveDraft') })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: key('cancel') }));
  fireEvent.click(screen.getByRole('button', { name: key('add') }));
  expect(await screen.findByLabelText(key('apiKey'))).toHaveValue('');
});
it('renders a working review confirmation and sends the selected revision', async () => {
  const agent = { id: 'a', name: 'Review candidate', approved: false, revision: 3, allowed_user_ids: ['u'], source_digest: 'sha256:abc', review_note: 'Reviewed synthetic data', app_id: 'app', endpoint: 'http://127.0.0.1:8089/v1' };
  mocks.adminAgents.mockResolvedValue({ success: true, data: [agent] });
  mocks.review.mockResolvedValue({ success: true, data: { ...agent, approved: true, revision: 4 } });
  page();
  await screen.findByText('Review candidate');
  fireEvent.click(screen.getByRole('button', { name: key('approve') }));
  expect(await screen.findByText(key('approveTitle'))).toBeVisible();
  expect(screen.getByText('Reviewed synthetic data')).toBeVisible();
  fireEvent.click(screen.getAllByRole('button', { name: key('approve') }).at(-1)!);
  await waitFor(() => expect(mocks.review).toHaveBeenCalledWith({ agentId: 'a', approved: true, revision: 3, review_days: 7 }));
});
