import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ values: new Map<string, unknown>(), config: {} as Record<string, unknown>, root: '', clear: vi.fn(), sync: vi.fn() }));
vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: (key: string) => state.values.get(key), set: async (key: string, value: unknown) => state.values.set(key, value) } }));
vi.mock('@process/bridge/scodeBridge', () => ({
  readExistingConfig: () => state.config,
  writeConfig: (value: Record<string, unknown>) => {
    state.config = value;
  },
  writeScodeDefaultModel: vi.fn(),
}));
vi.mock('@process/services/scode/scodePaths', () => ({
  get SCODE_CONFIG_PATH() {
    return path.join(state.root, 'sudocode.json');
  },
}));
vi.mock('@process/services/authProxy/userKeySync', () => ({ syncUserKeyFromScodeConfig: state.sync }));
vi.mock('@/common/enterpriseDebugConfig', () => ({ setCachedLocalModeAvailable: vi.fn() }));
vi.mock('@process/WorkerManage', () => ({ default: { clear: state.clear } }));
vi.mock('@process/bridge/eeclawBridge', () => ({
  getValidToken: async () => 'test-token',
  withAuthStorageLock: async (fn: () => Promise<unknown>) => fn(),
}));

import { applyMossLocalRuntime, assertMossLocalExecutionAllowed, clearMossLocalRuntime, createMossAccountScope } from '@process/services/mossLocalRuntime';

function payload(userId = 'user-1', key = 'personal-1') {
  return {
    execution: { isLocalAllowed: true, isRemoteAllowed: true, defaultTarget: 'local' },
    localRuntime: { userId, organizationId: 'org-1', status: 'ready', protocol: 'openai-completions' },
    sudorouter_key: key,
    model_service_url: 'https://models.example/v1',
    models: ['chat-model'],
    scode_auto_model: 'chat-model',
  };
}

beforeEach(() => {
  state.values.clear();
  state.config = { originalSetting: true };
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-runtime-'));
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(state.root, { recursive: true, force: true });
});

describe('managed local runtime lifecycle', () => {
  it('scopes identities by server, organization and user', () => {
    expect(createMossAccountScope('https://moss.example/', 'u', 'o')).toBe(createMossAccountScope('https://moss.example', 'u', 'o'));
    expect(createMossAccountScope('https://moss.example', 'u', 'o')).not.toBe(createMossAccountScope('https://other.example', 'u', 'o'));
    expect(createMossAccountScope('https://moss.example', 'u', 'o')).not.toBe(createMossAccountScope('https://moss.example', 'v', 'o'));
  });
  it('returns no key to renderer and restores pre-login config on logout', async () => {
    const result = await applyMossLocalRuntime(payload(), 'https://moss.example');
    expect(JSON.stringify(result)).not.toContain('personal-1');
    expect(JSON.stringify(state.config)).toContain('personal-1');
    await clearMossLocalRuntime();
    expect(state.config).toEqual({ originalSetting: true });
    expect(state.values.get('eeclaw.accountScope')).toBeUndefined();
    expect(state.sync).toHaveBeenLastCalledWith({ originalSetting: true }, true);
    expect(state.clear).toHaveBeenCalledTimes(2);
  });
  it('stops workers when the account changes and replaces old credentials', async () => {
    await applyMossLocalRuntime(payload(), 'https://moss.example');
    await applyMossLocalRuntime(payload('user-2', 'personal-2'), 'https://moss.example');
    expect(state.clear).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(state.config)).not.toContain('personal-1');
    expect(JSON.stringify(state.config)).toContain('personal-2');
  });
  it('clears stale credentials when provisioning becomes unavailable', async () => {
    await applyMossLocalRuntime(payload(), 'https://moss.example');
    const next = { ...payload(), localRuntime: { ...payload().localRuntime, status: 'credential_pending' }, sudorouter_key: undefined, models: [] };
    await applyMossLocalRuntime(next, 'https://moss.example');
    expect(state.config).toEqual({});
    expect(state.sync).toHaveBeenLastCalledWith({}, true);
  });
  it('rejects malformed responses before writing state', async () => {
    await expect(applyMossLocalRuntime({ execution: {} }, 'https://moss.example')).rejects.toThrow();
    expect(state.config).toEqual({ originalSetting: true });
  });
  it('refreshes a cached ready session, removes revoked credentials and allows a later restored grant', async () => {
    await applyMossLocalRuntime(payload(), 'https://moss.example');
    state.values.set('eeclaw.serverUrl', 'https://moss.example');
    state.values.set('eeclaw.authStorage', { access_token: 'test-token' });
    const denied = {
      execution: { isLocalAllowed: false, isRemoteAllowed: true, defaultTarget: 'remote' },
      localRuntime: { ...payload().localRuntime, status: 'policy_denied' },
      models: [],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(denied)))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload())));
    vi.stubGlobal('fetch', fetch);
    await expect(assertMossLocalExecutionAllowed()).rejects.toThrow('authorization has been revoked');
    expect(state.config).toEqual({});
    expect(state.clear).toHaveBeenLastCalledWith(true);
    expect(state.values.get('eeclaw.localModeAvailable')).toBe(false);
    await expect(assertMossLocalExecutionAllowed()).resolves.toBeUndefined();
    expect(state.values.get('eeclaw.localModeAvailable')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not permit managed execution when the fresh permission check fails', async () => {
    await applyMossLocalRuntime(payload(), 'https://moss.example');
    state.values.set('eeclaw.serverUrl', 'https://moss.example');
    state.values.set('eeclaw.authStorage', { access_token: 'test-token' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(assertMossLocalExecutionAllowed()).rejects.toThrow('offline');
  });
  it('leaves model selection and credentials untouched when repeated permission checks return unchanged configuration', async () => {
    await applyMossLocalRuntime(payload(), 'https://moss.example');
    state.config.default_model = 'chat-model';
    const previous = state.config;
    const syncCount = state.sync.mock.calls.length;
    await applyMossLocalRuntime(payload(), 'https://moss.example');
    expect(state.config).toBe(previous);
    expect(state.config.default_model).toBe('chat-model');
    expect(state.sync).toHaveBeenCalledTimes(syncCount);
  });
});
