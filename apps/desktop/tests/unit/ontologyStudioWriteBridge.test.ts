import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import { closeOntologyWriteBridge, ensureOntologyWriteBridge } from '@process/services/ontology/OntologyWriteBridge';

const mocks = vi.hoisted(() => ({ emit: vi.fn(), write: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { ontology: { workbenchChanged: { emit: mocks.emit } } } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/ontology/OntologyService', () => ({
  ontologyService: {
    listWorkbenches: async () => ({ activeWorkspaceId: 'other-workspace' }),
    getWorkbench: async ({ workspaceId }: { workspaceId: string }) => createDefaultOntologyWorkbenchSnapshot(1, { workspaceId }),
    upsertObject: async (input: Record<string, unknown>) => {
      mocks.write(input);
      return createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: String(input.workspaceId) });
    },
  },
}));
afterEach(async () => {
  await closeOntologyWriteBridge();
  vi.clearAllMocks();
});

describe('studio builder bridge scope', () => {
  it('binds writes to the session ontology and emits a workspace change', async () => {
    const bridge = await ensureOntologyWriteBridge({ workspaceId: 'orders', role: 'builder' });
    const response = await fetch(`http://127.0.0.1:${bridge.port}/tool/upsert_object`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ input: { name: 'Order', workspaceId: 'other-workspace' } }) });
    expect(response.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'orders', name: 'Order' }));
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'orders' }));
  });
  it('rejects cross-ontology writes and autonomous publication or actions', async () => {
    const bridge = await ensureOntologyWriteBridge({ workspaceId: 'orders', role: 'builder' });
    for (const request of [
      { route: 'upsert_object', workspaceId: 'elsewhere' },
      { route: 'execute_action', workspaceId: 'orders' },
      { route: 'publish_current_draft', workspaceId: 'orders' },
      { route: 'approve_all', workspaceId: 'orders' },
    ]) {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/tool/${request.route}`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ workspaceId: request.workspaceId, input: {} }) });
      expect(response.status).toBe(403);
    }
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
