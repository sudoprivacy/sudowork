import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetchConfig: vi.fn(), sync: vi.fn(async () => {}) }));
vi.mock('@sudowork/common/systemConfig', () => ({ fetchSystemConfig: mocks.fetchConfig }));
vi.mock('@sudowork/host-bridge/authServer', () => ({ getAuthServerBaseUrl: async () => 'https://moss.test' }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ systemConfig: { syncFromRenderer: { invoke: mocks.sync } } }));
import { useSystemLoginMethod } from '@renderer/hooks/useSystemLoginMethod';

describe('organization login discovery', () => {
  it('keys login policy by organization and server without overwriting global runtime configuration', async () => {
    mocks.fetchConfig.mockImplementation(async (_base, _custom, code) => ({ login_method: code === 'ORG-A' ? 0 : 1, auth_methods: code === 'ORG-A' ? ['phone'] : ['password'] }));
    const { result, rerender } = renderHook(({ code, server }) => useSystemLoginMethod(code, server), { initialProps: { code: 'ORG-A', server: 'https://first.test' } });
    await waitFor(() => expect(result.current.authMethods).toEqual(['phone']));
    rerender({ code: 'ORG-B', server: 'https://first.test' });
    await waitFor(() => expect(result.current.authMethods).toEqual(['password']));
    rerender({ code: 'ORG-A', server: 'https://first.test' });
    await waitFor(() => expect(result.current.authMethods).toEqual(['phone']));
    expect(mocks.fetchConfig).toHaveBeenCalledTimes(2);
    rerender({ code: 'ORG-A', server: 'https://second.test' });
    await waitFor(() => expect(mocks.fetchConfig).toHaveBeenCalledTimes(3));
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('ignores an earlier organization response that finishes late', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.fetchConfig.mockImplementation(async (_base, _custom, code) => code === 'SLOW' ? new Promise(resolve => { resolveOld = resolve; }) : { login_method: 1, auth_methods: ['password'] });
    const { result, rerender } = renderHook(({ code }) => useSystemLoginMethod(code), { initialProps: { code: 'SLOW' } });
    await waitFor(() => expect(resolveOld).toBeDefined());
    rerender({ code: 'FAST' });
    await waitFor(() => expect(result.current.authMethods).toEqual(['password']));
    await act(async () => { resolveOld({ login_method: 0, auth_methods: ['phone'] }); });
    expect(result.current.authMethods).toEqual(['password']);
  });
  it('leaves login unavailable on an invalid organization and permits retry', async () => {
    mocks.fetchConfig.mockResolvedValueOnce(null).mockResolvedValue({ login_method: 0, auth_methods: ['phone'] });
    const { result, rerender } = renderHook(({ retry }) => useSystemLoginMethod('RETRY-ORG', undefined, retry), { initialProps: { retry: 0 } });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.authMethods).toEqual([]);
    rerender({ retry: 1 });
    await waitFor(() => expect(result.current.authMethods).toEqual(['phone']));
    expect(result.current.error).toBeNull();
  });
});
