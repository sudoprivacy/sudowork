import { beforeEach, expect, it, vi } from 'vitest';
import type { IConfigStorageRefer } from '@sudowork/common/storage';

const state = vi.hoisted(() => ({ config: {} as IConfigStorageRefer, provider: vi.fn(), rendererGet: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ sudoworkServer: { getConfig: { provider: state.provider }, updateConfig: { provider: vi.fn() } } }));
vi.mock('@sudowork/common/storage', () => ({ ConfigStorage: { get: state.rendererGet } }));
vi.mock('@process/initStorage', async () => {
  const { resolveMossServerPolicy } = await import('@sudowork/common/sudoworkServer');
  return { getSudoworkServerBaseUrlSync: () => resolveMossServerPolicy(state.config).serverUrl };
});
import { initSudoworkServerBridge } from '@process/bridge/sudoworkServerBridge';

beforeEach(() => {
  vi.clearAllMocks();
  state.config = { 'system.sudoworkServerUrl': 'https://retired.example', 'eeclaw.serverUrl': 'https://moss.example' };
  // A main-process invocation of the renderer storage adapter cannot be answered.
  state.rendererGet.mockImplementation(() => new Promise(() => undefined));
  initSudoworkServerBridge();
});

it('answers account-page configuration from local state without a reverse IPC deadlock', async () => {
  const provider = state.provider.mock.calls[0][0];
  expect(await provider()).toEqual({ baseUrl: 'https://moss.example' });
  expect(state.rendererGet).not.toHaveBeenCalled();
  state.config['system.managedMossServerUrl'] = 'https://managed.example';
  state.config['system.mossServerUrlLocked'] = true;
  expect(await provider()).toEqual({ baseUrl: 'https://managed.example' });
});
