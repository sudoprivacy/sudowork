import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILocalPersonalAgent } from '@sudowork/common/personalAgents';

const state = vi.hoisted(() => ({ scope: 'account-a', request: vi.fn(), token: vi.fn(), write: vi.fn(), localAgents: {} as Record<string, ILocalPersonalAgent[]> }));
vi.mock('electron', () => ({ net: { fetch: state.request } }));
vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: (key: string) => ({ 'eeclaw.serverUrl': 'https://moss.example/', 'eeclaw.accountScope': state.scope, 'eeclaw.localAgents': state.localAgents })[key], set: state.write } }));
vi.mock('@process/bridge/eeclawBridge', () => ({ getValidToken: state.token }));
vi.mock('@process/utils', () => ({ getDataPath: () => 'C:/qa/data' }));
import { createMossPersonalAgent, listMossPersonalAgents, requireMossPersonalAgent, resolveMossLocalAgentReference, resolveMossPersonalRuntime } from '@process/services/mossPersonalAgents';

const agent = { ref: 'moss-agent:own:22222222-2222-4222-8222-222222222222', displayName: 'My Agent', kind: 'own' };
beforeEach(() => {
  vi.clearAllMocks();
  state.scope = 'account-a';
  state.localAgents = {};
  state.write.mockReset().mockImplementation(async (_key: string, value: Record<string, ILocalPersonalAgent[]>) => {
    state.localAgents = JSON.parse(JSON.stringify(value));
  });
  state.token.mockResolvedValue('current-token');
  state.request.mockImplementation(async () => Response.json({ success: true, data: [agent] }));
});

describe('personal Agent authority in the desktop host', () => {
  it('keeps identity and memory stable while partitioning accounts and personal Agents', async () => {
    state.scope = 'a'.repeat(64);
    const first = await resolveMossPersonalRuntime(agent.ref, state.scope);
    expect(first.systemPromptAppend).toContain(JSON.stringify(agent.displayName));
    expect(first.systemPromptAppend).toContain(JSON.stringify(first.memoryDirectory));
    expect(first.systemPromptAppend).toContain('Do not search for or use a global memory directory');
    expect(first.systemPromptAppend).toMatch(/^\[Identity Override/);
    expect(first.systemPromptAppend).toContain('\n\n');
    expect(first.displayName).toBe(agent.displayName);
    expect(await resolveMossPersonalRuntime(agent.ref, state.scope)).toEqual(first);
    const other = { ...agent, ref: 'moss-agent:own:33333333-3333-4333-8333-333333333333' };
    state.request.mockImplementation(async () => Response.json({ success: true, data: [agent, other] }));
    expect(await resolveMossPersonalRuntime(other.ref, state.scope)).not.toEqual(first);
    state.scope = 'b'.repeat(64);
    expect(await resolveMossPersonalRuntime(agent.ref, state.scope)).not.toEqual(first);
    await expect(resolveMossPersonalRuntime(agent.ref, 'a'.repeat(64))).rejects.toThrow('different Moss account');
    await expect(resolveMossPersonalRuntime(agent.ref, '../escape')).rejects.toThrow('different Moss account');
    await expect(resolveMossPersonalRuntime(other.ref + '/../../escape', state.scope)).rejects.toThrow('unavailable');
  });
  it('uses the current session and refreshes a rejected token once', async () => {
    state.token.mockResolvedValueOnce('expired-token').mockResolvedValueOnce('refreshed-token');
    state.request.mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(Response.json({ success: true, data: [agent] }));
    expect(await listMossPersonalAgents()).toEqual([agent]);
    expect(state.token).toHaveBeenLastCalledWith(true);
    expect(state.request).toHaveBeenLastCalledWith('https://moss.example/api/v1/agents/mine', expect.objectContaining({ headers: { Authorization: 'Bearer refreshed-token' } }));
  });
  it('preserves the stable owned reference and rejects foreign or template identities', async () => {
    expect(await requireMossPersonalAgent(agent.ref)).toEqual(agent);
    await expect(requireMossPersonalAgent('moss-agent:own:foreign')).rejects.toThrow('unavailable');
    state.request.mockResolvedValue(Response.json({ success: true, data: [{ ...agent, kind: 'template' }] }));
    await expect(requireMossPersonalAgent(agent.ref)).rejects.toThrow('unavailable');
  });
  it('rejects malformed lists and upstream errors instead of reporting empty success', async () => {
    state.request.mockResolvedValue(Response.json({ data: [] }));
    await expect(listMossPersonalAgents()).rejects.toThrow();
    state.request.mockResolvedValue(new Response('', { status: 403 }));
    await expect(listMossPersonalAgents()).rejects.toThrow('HTTP 403');
  });
  it('rejects a response after the current account changes', async () => {
    state.request.mockImplementationOnce(async () => {
      state.scope = 'account-b';
      return Response.json({ success: true, data: [agent] });
    });
    await expect(listMossPersonalAgents()).rejects.toThrow('identity changed');
  });
  it('does not send credentials if the account changes while obtaining a token', async () => {
    state.token.mockImplementationOnce(async () => {
      state.scope = 'account-b';
      return 'other-account-token';
    });
    await expect(listMossPersonalAgents()).rejects.toThrow('identity changed');
    expect(state.request).not.toHaveBeenCalled();
  });
  it('does not refresh or retry a rejected request after the account changes', async () => {
    state.request.mockImplementationOnce(async () => {
      state.scope = 'account-b';
      return new Response('', { status: 401 });
    });
    await expect(listMossPersonalAgents()).rejects.toThrow('identity changed');
    expect(state.token).toHaveBeenCalledTimes(1);
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it('does not send refreshed credentials if the account changes during refresh', async () => {
    state.request.mockResolvedValueOnce(new Response('', { status: 401 }));
    state.token.mockResolvedValueOnce('expired-token').mockImplementationOnce(async () => {
      state.scope = 'account-b';
      return 'other-account-token';
    });
    await expect(listMossPersonalAgents()).rejects.toThrow('identity changed');
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, 'server'] as const)('preserves the original Moss creation payload with execution type %s', async (executionType) => {
    const created = { id: '22222222-2222-4222-8222-222222222222', displayName: 'My Agent', createdAt: 10 };
    state.request.mockResolvedValue(Response.json({ success: true, data: created }, { status: 201 }));
    expect(await createMossPersonalAgent({ displayName: '  My Agent  ', executionType })).toEqual(created);
    expect(state.request).toHaveBeenCalledExactlyOnceWith('https://moss.example/api/v1/user-agents', expect.objectContaining({ method: 'POST', body: JSON.stringify({ displayName: 'My Agent' }) }));
    expect(state.write).not.toHaveBeenCalled();
  });
  it('creates and restores a local identity and memory without any Moss request', async () => {
    state.scope = 'c'.repeat(64);
    state.request.mockRejectedValue(new Error('Moss unavailable'));
    const created = await createMossPersonalAgent({ displayName: '  Local Research  ', executionType: 'local' });
    expect(created).toMatchObject({ displayName: 'Local Research', createdAt: expect.any(Number), executionType: 'local' });
    expect(state.localAgents[state.scope]).toEqual([created]);
    const ref = `sudowork-agent:local:${created.id}`;
    const runtime = await resolveMossPersonalRuntime(ref, state.scope);
    expect(runtime.displayName).toBe('Local Research');
    vi.resetModules();
    const restarted = await import('@process/services/mossPersonalAgents');
    expect(await restarted.requireMossPersonalAgent(ref)).toEqual({ ref, displayName: created.displayName, kind: 'own', executionType: 'local' });
    expect(await restarted.resolveMossPersonalRuntime(ref, state.scope)).toEqual(runtime);
    expect(state.request).not.toHaveBeenCalled();
    expect(state.token).not.toHaveBeenCalled();
  });
  it('keeps local identities isolated by account and rejects unknown local references without a server lookup', async () => {
    const created = await createMossPersonalAgent({ displayName: 'Local', executionType: 'local' });
    const ref = `sudowork-agent:local:${created.id}`;
    state.scope = 'account-b';
    await expect(requireMossPersonalAgent(ref)).rejects.toThrow('unavailable');
    const other = await createMossPersonalAgent({ displayName: 'Local', executionType: 'local' });
    state.scope = 'account-a';
    expect((await requireMossPersonalAgent(ref)).displayName).toBe('Local');
    await expect(requireMossPersonalAgent(`sudowork-agent:local:${other.id}`)).rejects.toThrow('unavailable');
    expect(state.localAgents['account-a']).toEqual([created]);
    expect(state.localAgents['account-b']).toEqual([other]);
    expect(state.request).not.toHaveBeenCalled();
  });
  it('creates one persistent local default during concurrent and repeated inventory refreshes', async () => {
    const serverAgent = { ref: 'moss-agent:user:owner', displayName: '张冬冬', kind: 'default' };
    state.request.mockImplementation(async () => Response.json({ success: true, data: [serverAgent] }));
    const inventories = await Promise.all([listMossPersonalAgents(), listMossPersonalAgents(), listMossPersonalAgents()]);
    const [created] = state.localAgents[state.scope];
    for (const agents of inventories) {
      expect(agents).toEqual([serverAgent, { ref: `sudowork-agent:local:${created.id}`, displayName: '张冬冬-本地', kind: 'default', executionType: 'local' }]);
    }
    expect(created.isDefault).toBe(true);
    expect(await listMossPersonalAgents()).toEqual(inventories[0]);
    vi.resetModules();
    const restarted = await import('@process/services/mossPersonalAgents');
    expect(await restarted.resolveMossLocalAgentReference('Renamed user')).toBe(`sudowork-agent:local:${created.id}`);
    expect(await restarted.requireMossPersonalAgent(`sudowork-agent:local:${created.id}`)).toMatchObject({ kind: 'default' });
    expect(state.write).toHaveBeenCalledTimes(1);
    expect(state.request).toHaveBeenCalledTimes(4);
    for (const [url, options] of state.request.mock.calls) {
      expect(url).toBe('https://moss.example/api/v1/agents/mine');
      expect(options.method).toBe('GET');
      expect(options.body).toBeUndefined();
    }
  });
  it('keeps server identities on the server even when their names match the local default', async () => {
    const serverAgents = [
      { ref: 'moss-agent:user:owner', displayName: 'Research', kind: 'default' },
      { ...agent, displayName: 'Research-本地' },
    ];
    state.request.mockResolvedValue(Response.json({ success: true, data: serverAgents }));
    const agents = await listMossPersonalAgents();
    expect(agents.slice(0, 2)).toEqual(serverAgents);
    expect(agents[2]).toMatchObject({ displayName: 'Research-本地', executionType: 'local' });
    expect(agents[2].ref).toMatch(/^sudowork-agent:local:/);
  });
  it('preserves concurrent personal creations and creates a distinct system default', async () => {
    const created = await Promise.all(['First', 'Second', 'Third'].map((displayName) => createMossPersonalAgent({ displayName, executionType: 'local' })));
    expect(state.localAgents[state.scope]).toEqual(created);
    expect(new Set(created.map((item) => item.id)).size).toBe(3);
    const defaultRef = await resolveMossLocalAgentReference('Default');
    expect(created.some((agent) => `sudowork-agent:local:${agent.id}` === defaultRef)).toBe(false);
    expect(await requireMossPersonalAgent(defaultRef)).toMatchObject({ kind: 'default', displayName: 'Default-本地' });
    for (const agent of created) expect(await requireMossPersonalAgent(`sudowork-agent:local:${agent.id}`)).toMatchObject({ kind: 'own' });
    expect(await resolveMossLocalAgentReference('Default')).toBe(defaultRef);
    expect(state.write).toHaveBeenCalledTimes(4);
    expect(state.request).not.toHaveBeenCalled();
  });
  it('migrates an existing system local Agent without changing its identity or memory', async () => {
    state.scope = 'c'.repeat(64);
    const legacyDefault: ILocalPersonalAgent = { id: '22222222-2222-4222-8222-222222222222', displayName: 'Research-本地', createdAt: 10, executionType: 'local' };
    const personal: ILocalPersonalAgent = { id: '33333333-3333-4333-8333-333333333333', displayName: 'Personal', createdAt: 20, executionType: 'local' };
    state.localAgents[state.scope] = [legacyDefault, personal];
    const ref = `sudowork-agent:local:${legacyDefault.id}`;
    const runtime = await resolveMossPersonalRuntime(ref, state.scope);
    const serverAgent = { ref: 'moss-agent:user:owner', displayName: 'Research', kind: 'default' };
    state.request.mockResolvedValue(Response.json({ success: true, data: [serverAgent] }));
    expect(await listMossPersonalAgents()).toEqual([serverAgent, { ref, displayName: legacyDefault.displayName, kind: 'default', executionType: 'local' }, { ref: `sudowork-agent:local:${personal.id}`, displayName: personal.displayName, kind: 'own', executionType: 'local' }]);
    expect(state.localAgents[state.scope]).toEqual([{ ...legacyDefault, isDefault: true }, personal]);
    expect(await resolveMossPersonalRuntime(ref, state.scope)).toEqual(runtime);
    expect(await resolveMossLocalAgentReference('Research')).toBe(ref);
    expect(state.write).toHaveBeenCalledTimes(1);
    expect(state.request).toHaveBeenCalledExactlyOnceWith('https://moss.example/api/v1/agents/mine', expect.objectContaining({ method: 'GET' }));
  });
  it('does not promote a manually created Agent with the system default name', async () => {
    const personal = await createMossPersonalAgent({ displayName: 'Research-本地', executionType: 'local' });
    const defaultRef = await resolveMossLocalAgentReference('Research');
    expect(defaultRef).not.toBe(`sudowork-agent:local:${personal.id}`);
    expect(await requireMossPersonalAgent(`sudowork-agent:local:${personal.id}`)).toMatchObject({ kind: 'own' });
    expect(await requireMossPersonalAgent(defaultRef)).toMatchObject({ kind: 'default' });
    expect(state.localAgents[state.scope]).toHaveLength(2);
    expect(state.request).not.toHaveBeenCalled();
  });
  it('creates a bounded local default name without requiring a Moss inventory', async () => {
    const ref = await resolveMossLocalAgentReference('x'.repeat(60));
    const local = await requireMossPersonalAgent(ref);
    expect(local.displayName).toBe(`${'x'.repeat(57)}-本地`);
    expect(local.displayName).toHaveLength(60);
    expect(state.request).not.toHaveBeenCalled();
  });
  it('surfaces local persistence failures and allows a subsequent creation to retry', async () => {
    state.write.mockRejectedValueOnce(new Error('Disk full'));
    await expect(createMossPersonalAgent({ displayName: 'Local', executionType: 'local' })).rejects.toThrow('Disk full');
    expect(state.localAgents).toEqual({});
    await expect(createMossPersonalAgent({ displayName: 'Local', executionType: 'local' })).resolves.toMatchObject({ displayName: 'Local' });
    expect(state.request).not.toHaveBeenCalled();
  });
  it('rejects local creation without an account or after the account changes while queued', async () => {
    const pending = createMossPersonalAgent({ displayName: 'Local', executionType: 'local' });
    state.scope = 'account-b';
    await expect(pending).rejects.toThrow('identity changed');
    state.scope = '';
    await expect(createMossPersonalAgent({ displayName: 'Local', executionType: 'local' })).rejects.toThrow('identity is unavailable');
    expect(state.write).not.toHaveBeenCalled();
    expect(state.request).not.toHaveBeenCalled();
  });
  it.each([
    { displayName: ' ' },
    { displayName: 'x'.repeat(61) },
    { displayName: 'Valid', userId: 'victim' },
    { displayName: ' ', executionType: 'local' },
    { displayName: 'x'.repeat(61), executionType: 'local' },
    { displayName: 'Valid', executionType: 'local', userId: 'victim' },
    { displayName: 'Valid', executionType: 'other' },
  ])('rejects invalid creation input before making a request', async (input) => {
    await expect(createMossPersonalAgent(input)).rejects.toThrow();
    expect(state.request).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });
});
