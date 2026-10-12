import { expect, it, vi } from 'vitest';
import { createMossExternalProviderPort } from '@sudowork/moss-client/external-providers';

it('rejects invalid task input and path injection before transport', async () => {
  const request = vi.fn(),
    port = createMossExternalProviderPort(request);
  expect(() => port.create({ agent_id: 'agent', query: 'test', idempotency_key: 'key' })).toThrow();
  expect(() => port.history('../secret')).toThrow();
  expect(() => port.events('task-1', -1)).toThrow();
  expect(request).not.toHaveBeenCalled();
});

it('cursor reads and history use the same generic task API', async () => {
  const request = vi.fn().mockResolvedValue({ success: true, data: [] }),
    port = createMossExternalProviderPort(request);
  expect(await port.history('session-1')).toEqual([]);
  expect(request).toHaveBeenLastCalledWith({ method: 'GET', path: '/api/v1/external-sessions/session-1/tasks' });
  await expect(port.events('task-1', 12)).rejects.toThrow();
  expect(request).toHaveBeenLastCalledWith({ method: 'GET', path: '/api/v1/tasks/task-1/events?cursor=12' });
});

it.each([null, { success: false }, { success: true, data: [{ id: 'fake' }] }])('rejects malformed agent responses: %j', async (response) => {
  await expect(createMossExternalProviderPort(vi.fn().mockResolvedValue(response)).agents()).rejects.toThrow();
});
