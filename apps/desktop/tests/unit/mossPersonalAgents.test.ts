import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ scope: 'account-a', request: vi.fn(), token: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: state.request } }));
vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: (key: string) => ({ 'eeclaw.serverUrl': 'https://moss.example/', 'eeclaw.accountScope': state.scope })[key] } }));
vi.mock('@process/bridge/eeclawBridge', () => ({ getValidToken: state.token }));
vi.mock('@process/utils', () => ({ getDataPath: () => 'C:/qa/data' }));
import { createMossPersonalAgent, listMossPersonalAgents, requireMossPersonalAgent, resolveMossPersonalRuntime } from '@process/services/mossPersonalAgents';

const agent = { ref: 'moss-agent:own:22222222-2222-4222-8222-222222222222', displayName: 'My Agent', kind: 'own' };
beforeEach(() => {
  vi.clearAllMocks();
  state.scope = 'account-a';
  state.token.mockResolvedValue('current-token');
  state.request.mockImplementation(async () => Response.json({ success: true, data: [agent] }));
});

describe('personal Agent authority in the desktop host', () => {
  it('keeps identity and memory stable while partitioning accounts and personal Agents', async () => {
    state.scope = 'a'.repeat(64);
    const first = await resolveMossPersonalRuntime(agent.ref, state.scope);
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
  it('creates using only a trimmed display name', async () => {
    const created = { id: '22222222-2222-4222-8222-222222222222', displayName: 'My Agent', createdAt: 10 };
    state.request.mockResolvedValue(Response.json({ success: true, data: created }, { status: 201 }));
    expect(await createMossPersonalAgent({ displayName: '  My Agent  ' })).toEqual(created);
    expect(state.request).toHaveBeenCalledWith('https://moss.example/api/v1/user-agents', expect.objectContaining({ method: 'POST', body: JSON.stringify({ displayName: 'My Agent' }) }));
  });
  it.each([{ displayName: ' ' }, { displayName: 'x'.repeat(61) }, { displayName: 'Valid', userId: 'victim' }])('rejects invalid creation input before making a request', async (input) => {
    await expect(createMossPersonalAgent(input)).rejects.toThrow();
    expect(state.request).not.toHaveBeenCalled();
  });
});
