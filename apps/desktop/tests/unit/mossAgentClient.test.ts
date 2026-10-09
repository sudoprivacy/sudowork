import { describe, expect, it, vi } from 'vitest';
import { createMossAgentPort } from '@sudowork/moss-client/agents';

const agent = { ref: 'moss-agent:user:owner', displayName: 'My Agent', kind: 'default' };

describe('shared personal Agent contract', () => {
  it('preserves the inventory order and identities without requiring a conversation', async () => {
    const agents = [agent, { ref: 'moss-agent:own:other', displayName: 'My Agent', kind: 'own' }];
    const request = vi.fn().mockResolvedValue({ success: true, data: agents });
    expect(await createMossAgentPort(request).listMine()).toEqual(agents);
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/api/v1/agents/mine' });
  });

  it.each([null, {}, { success: false, data: [] }, { success: true, data: null }, { success: true, data: [{ ...agent, kind: 'unknown' }] }])('rejects an invalid inventory instead of returning empty success: %j', async (response) => {
    await expect(createMossAgentPort(vi.fn().mockResolvedValue(response)).listMine()).rejects.toThrow();
  });

  it('creates a named personal identity through the same contract in either host', async () => {
    const created = { id: '22222222-2222-4222-8222-222222222222', displayName: 'My Agent', createdAt: 10 };
    const request = vi.fn().mockResolvedValue({ success: true, data: created });
    expect(await createMossAgentPort(request).createOwned({ displayName: '  My Agent  ' })).toEqual(created);
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/user-agents', body: { displayName: 'My Agent' } });
  });

  it.each([{ displayName: ' ' }, { displayName: 'x'.repeat(61) }, { displayName: 'Valid', userId: 'foreign-owner' }])('rejects invalid creation input before transport: %j', async (input) => {
    const request = vi.fn();
    await expect(createMossAgentPort(request).createOwned(input)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('propagates transport and creation-response failures', async () => {
    const error = new Error('HTTP 403');
    await expect(createMossAgentPort(vi.fn().mockRejectedValue(error)).listMine()).rejects.toBe(error);
    const request = vi.fn().mockResolvedValue({ success: true, data: { id: 'not-a-uuid', displayName: 'My Agent', createdAt: 10 } });
    await expect(createMossAgentPort(request).createOwned({ displayName: 'My Agent' })).rejects.toThrow();
  });
});
