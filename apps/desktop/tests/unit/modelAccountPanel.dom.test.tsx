import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModelAccountPanel from '@renderer/pages/settings/model-account';

const billing = vi.hoisted(() => ({
  identityKey: 'admin',
  account: { member_usage_status: 'available', org_id: 'org', can_manage: true, account_status: 'ready', model_balance_usd: '999.00', used_amount_usd: '888.00', member: { unlimited: false, remaining_limit_usd: '5.00', used_amount_usd: '1.00', effective_status: 'active' } as object | null },
  request: vi.fn(),
  refresh: vi.fn(),
  t: (key: string) => key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: billing.t }) }));
vi.mock('@renderer/pages/settings/model-account/useModelAccount', () => ({ useModelAccount: () => ({ ...billing, isLoading: false, error: undefined }) }));
// Keep pagination deterministic; exercise the actual panel's identity and asynchronous effects.
vi.mock('@arco-design/web-react', () => ({
  Alert: ({ content }: { content: React.ReactNode }) => <div>{content}</div>,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => <button onClick={onClick}>{children}</button>,
  Spin: () => <div>loading</div>,
  Pagination: ({ current, onChange }: { current: number; onChange(page: number): void }) => <button onClick={() => onChange(current + 1)}>page-{current}</button>,
  Table: ({ data }: { data: Array<{ id: string; model_name: string }> }) => (
    <div>
      {data.map((row) => (
        <p key={row.id}>{row.model_name}</p>
      ))}
    </div>
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  billing.identityKey = 'admin';
  billing.account.member_usage_status = 'available';
  billing.account.member = { unlimited: false, remaining_limit_usd: '5.00', used_amount_usd: '1.00', effective_status: 'active' };
});
describe('personal model usage', () => {
  it('shows only the administrator personal usage and no organization totals', async () => {
    billing.request.mockResolvedValue({ items: [{ id: '1', model_name: 'own-model' }], total: 1 });
    render(<ModelAccountPanel />);
    await screen.findByText('own-model');
    expect(screen.getByText('$1.00')).toBeTruthy();
    expect(screen.queryByText(/999.00|888.00/)).toBeNull();
    expect(screen.queryByText('modelBilling.organizationUsage')).toBeNull();
    expect(billing.request).toHaveBeenCalledWith('model-account/logs?page=1');
  });
  it('resets pagination on account switch and discards delayed previous-account logs', async () => {
    let finishOld: (value: unknown) => void = () => {};
    billing.request.mockImplementation((path: string) =>
      path.endsWith('page=2')
        ? new Promise((resolve) => {
            finishOld = resolve;
          })
        : Promise.resolve({ items: [{ id: 'old', model_name: 'old-user' }], total: 30 })
    );
    const view = render(<ModelAccountPanel />);
    await screen.findByText('old-user');
    fireEvent.click(screen.getByText('page-1'));
    await waitFor(() => expect(billing.request).toHaveBeenCalledWith('model-account/logs?page=2'));
    billing.identityKey = 'new-member';
    billing.request.mockResolvedValue({ items: [{ id: 'new', model_name: 'new-user' }], total: 1 });
    view.rerender(<ModelAccountPanel />);
    await screen.findByText('new-user');
    await act(async () => {
      finishOld({ items: [{ id: 'late', model_name: 'old-late' }], total: 30 });
    });
    expect(screen.queryByText('old-user')).toBeNull();
    expect(screen.queryByText('old-late')).toBeNull();
    expect(screen.getByText('page-1')).toBeTruthy();
  });
  it('shows pending member credentials without falling back to organization usage', async () => {
    billing.account.member = null;
    billing.request.mockResolvedValue({ items: [], total: 0 });
    await act(async () => {
      render(<ModelAccountPanel />);
    });
    expect(screen.getByText('modelBilling.memberPending')).toBeTruthy();
    expect(screen.queryByText(/999.00|888.00/)).toBeNull();
  });
});

it('distinguishes unavailable personal usage from pending credentials and recovers', async () => {
  billing.account.member = null;
  billing.account.member_usage_status = 'unavailable';
  billing.request.mockResolvedValue({ items: [], total: 0 });
  const view = render(<ModelAccountPanel />);
  expect(screen.getByText('modelBilling.memberUsageUnavailable')).toBeTruthy();
  expect(screen.queryByText('modelBilling.memberPending')).toBeNull();
  expect(screen.queryByText(/999.00|888.00/)).toBeNull();
  billing.account.member = { unlimited: true, used_amount_usd: '2.50', effective_status: 'active' };
  billing.account.member_usage_status = 'available';
  await act(async () => {
    view.rerender(<ModelAccountPanel />);
  });
  expect(screen.getByText('$2.50')).toBeTruthy();
  expect(screen.queryByText('modelBilling.memberUsageUnavailable')).toBeNull();
});
