import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import { closeOntologyWriteBridge, ensureOntologyWriteBridge } from '@process/services/ontology/OntologyWriteBridge';

const mocks = vi.hoisted(() => ({ emit: vi.fn(), write: vi.fn(), execute: vi.fn(async (input: Record<string, unknown>) => ({ snapshot: { draft: { title: 'Unpublished changes' }, objects: [], relations: [] }, execution: { output: input } })) }));
vi.mock('@/common', () => ({ ipcBridge: { ontology: { workbenchChanged: { emit: mocks.emit } } } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/ontology/OntologyService', () => ({
  ontologyService: {
    listWorkbenches: async () => ({ activeWorkspaceId: 'other-workspace' }),
    getWorkbench: async ({ workspaceId }: { workspaceId: string }) => createDefaultOntologyWorkbenchSnapshot(1, { workspaceId }),
    executeLogicFunction: mocks.execute,
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

describe('published ontology runtime bridge scope', () => {
  it('pins queries to the registered ontology version', async () => {
    const bridge = await ensureOntologyWriteBridge({ workspaceId: 'northwind', versionId: 'v1', role: 'runtime' });
    const response = await fetch(`http://127.0.0.1:${bridge.port}/tool/execute_logic_function`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ input: { code: 'low_stock', arguments: {} } }) });
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith({ workspaceId: 'northwind', versionId: 'v1', code: 'low_stock', arguments: {} });
    expect(await response.json()).toEqual({ ok: true, data: { workspaceId: 'northwind', versionId: 'v1', execution: { output: { workspaceId: 'northwind', versionId: 'v1', code: 'low_stock', arguments: {} } } } });
  });

  it('rejects switching versions, switching ontologies, and editing the workbench', async () => {
    const bridge = await ensureOntologyWriteBridge({ workspaceId: 'northwind', versionId: 'v1', role: 'runtime' });
    for (const request of [
      { route: 'execute_logic_function', input: { versionId: 'v2' } },
      { route: 'execute_logic_function', input: { workspaceId: 'another' } },
      { route: 'upsert_object', input: {} },
      { route: 'publish_current_draft', input: {} },
      { route: 'get_snapshot', input: {} },
    ]) {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/tool/${request.route}`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ input: request.input }) });
      expect(response.status).toBe(403);
    }
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
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
