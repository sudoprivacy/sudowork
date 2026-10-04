import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runLogin, type IAuthenticatedLogin } from '@sudowork/common/authLogin';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  pricing: vi.fn(),
  imagePricing: vi.fn(),
  image: vi.fn(),
  restore: vi.fn(),
  defaultModel: vi.fn(),
}));
vi.mock('@sudowork/common/storage', () => ({ ConfigStorage: { get: state.get, set: state.set } }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  scode: {
    getConfig: { invoke: state.getConfig },
    saveConfig: { invoke: state.saveConfig },
    fetchSpecificPricing: { invoke: state.pricing },
    fetchSpecificImagePricing: { invoke: state.imagePricing },
    setImageModel: { invoke: state.image },
    restoreCustomModelProviders: { invoke: state.restore },
    setDefaultModel: { invoke: state.defaultModel },
  },
}));
import { prepareDesktopLogin } from '@sudowork/host-bridge/desktopLoginSetup';

const data: IAuthenticatedLogin = {
  access_token: 'test-token',
  expires_in: 3600,
  user: { id: 'user', name: 'User', role: 'USER', orgId: 'org', localAuth: true },
  sudorouter_key: 'model-key',
  model_service_url: 'https://models.example/v1',
  models: ['model'],
  scode_auto_model: 'model',
};
const request = { grant_type: 'phone' as const, phone: '13800138000', code: '123456' };
const commit = vi.fn();
const login = (payload = data, timeoutMs = 1000) => runLogin(request, 'device', { authenticate: async () => ({ success: true, data: payload }), prepareSession: prepareDesktopLogin }, commit, { timeoutMs });

beforeEach(() => {
  vi.resetAllMocks();
  state.get.mockResolvedValue(undefined);
  state.set.mockResolvedValue(undefined);
  state.getConfig.mockResolvedValue({ success: true, data: {} });
  state.saveConfig.mockResolvedValue({ success: true });
  state.pricing.mockResolvedValue({ success: true, data: [] });
  state.imagePricing.mockResolvedValue({ success: true, data: [] });
  state.image.mockResolvedValue({ success: true });
  state.restore.mockResolvedValue({ success: true, data: { default_model: 'my-custom-model' } });
  state.defaultModel.mockResolvedValue({ success: true });
});
afterEach(() => vi.useRealTimers());

it('prepares legacy models before committing, preserves custom selection and leaves main-owned auth storage alone', async () => {
  expect(await login()).toEqual({ success: true });
  expect(state.saveConfig.mock.calls[0][0].config.auth_modes.proxy.sudorouter).toEqual({ apiKey: 'model-key', baseUrl: 'https://models.example/v1' });
  expect(state.defaultModel).toHaveBeenCalledWith({ modelId: 'my-custom-model' });
  expect(state.restore).toHaveBeenCalledWith({ userId: 'user' });
  expect(state.set.mock.calls.map(([key]) => key)).not.toContain('eeclaw.authStorage');
  expect(commit).toHaveBeenCalledTimes(1);
  expect(state.defaultModel.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]);
});

it('does not overwrite the managed model configuration applied by main', async () => {
  expect(await login({ ...data, execution: { isLocalAllowed: true, isRemoteAllowed: true, defaultTarget: 'local' }, localRuntime: { userId: 'user', organizationId: 'org', status: 'ready' } })).toEqual({ success: true });
  expect(state.saveConfig).not.toHaveBeenCalled();
  expect(state.pricing).not.toHaveBeenCalled();
  expect(state.set).toHaveBeenCalledWith('acp.config', { scode: { preferredModelId: 'auto' } });
});

it('does not enter an authenticated UI when required configuration cannot be saved', async () => {
  state.saveConfig.mockResolvedValue({ success: false, msg: 'disk write failed' });
  expect(await login()).toMatchObject({ success: false, code: 'setupError' });
  expect(commit).not.toHaveBeenCalled();
  expect(state.restore).not.toHaveBeenCalled();
});

it('stops a stalled configuration IPC without writing models or committing after its late response', async () => {
  vi.useFakeTimers();
  let resolveConfig!: (value: unknown) => void;
  state.getConfig.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveConfig = resolve;
      })
  );
  const result = login(data, 100);
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toMatchObject({ success: false, code: 'timeout' });
  resolveConfig({ success: true, data: {} });
  await vi.advanceTimersByTimeAsync(1);
  expect(state.saveConfig).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
