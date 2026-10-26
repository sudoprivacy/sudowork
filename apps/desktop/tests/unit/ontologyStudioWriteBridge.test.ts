import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import { closeOntologyWriteBridge, ensureOntologyWriteBridge } from '@process/services/ontology/OntologyWriteBridge';

const mocks = vi.hoisted(() => ({
  authority: vi.fn(() => 'rdf'),
  invoke: vi.fn(),
  changed: vi.fn(),
  emit: vi.fn(),
  write: vi.fn(),
  registerSource: vi.fn(async () => ({ workspaceId: 'new-source', name: 'New source', authority: 'sudograph' })),
  execute: vi.fn(async (input: Record<string, unknown>) => ({ snapshot: { draft: { title: 'Unpublished changes' }, objects: [], relations: [] }, execution: { output: input } })),
}));
vi.mock('@/common', () => ({ ipcBridge: { ontology: { modelChanged: { emit: mocks.changed }, workbenchChanged: { emit: mocks.emit } } } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/ontology/OntologyService', () => ({
  ontologyService: {
    getModelAuthority: mocks.authority,
    invokeSudograph: mocks.invoke,
    connectStudioSource: mocks.registerSource,
    listWorkbenches: async () => ({ activeWorkspaceId: 'other-workspace' }),
    getWorkbench: async ({ workspaceId }: { workspaceId: string }) => {
      if (mocks.authority() === 'sudograph') throw new Error('Canonical projects cannot read RDF snapshots');
      return createDefaultOntologyWorkbenchSnapshot(1, { workspaceId });
    },
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
  mocks.authority.mockReturnValue('rdf');
});

describe('ontology project bridge scope', () => {
  it('registers a source from a canonical builder through the shared pipeline without reading RDF', async () => {
    const bridge = await ensureOntologyWriteBridge({ workspaceId: 'canonical', role: 'builder' });
    mocks.authority.mockReturnValue('sudograph');
    const input = { operationId: '123e4567-e89b-42d3-a456-426614174000', language: 'zh', connector: { kind: 'database', sourceType: 'mysql', name: 'Fixture', host: '127.0.0.1', database: 'fixture', username: 'reader', password: 'fixture-only', writable: false, metadata: {} } };
    const response = await fetch(`http://127.0.0.1:${bridge.port}/tool/register_source`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ input }) });
    expect(response.status).toBe(200);
    expect(mocks.registerSource).toHaveBeenCalledExactlyOnceWith(input);
    expect((await response.json()).data).toMatchObject({ workspaceId: 'new-source', open_path: '/app/ontology/new-source/model' });
  });
  it('requires a scoped registered model and emits the compiled revision after a successful edit', async () => {
    const scoped = await ensureOntologyWriteBridge({ workspaceId: 'canonical', role: 'builder' });
    const global = await ensureOntologyWriteBridge();
    const call = (token: string, workspaceId = 'canonical') =>
      fetch(`http://127.0.0.1:${scoped.port}/tool/sudograph_apply`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ workspaceId, input: { base_revision: 'r0', operation_id: 'edit-1', model: 'checked yaml' } }) });
    expect((await call(scoped.token)).status).toBe(403);
    mocks.authority.mockReturnValue('sudograph');
    expect((await call(global.token)).status).toBe(403);
    expect((await call(scoped.token, 'other')).status).toBe(403);
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValue({ revision: 'r1', context_digest: 'd1' });
    expect((await call(scoped.token)).status).toBe(200);
    expect(mocks.invoke).toHaveBeenCalledWith('canonical', { operation: 'apply', request: { base_revision: 'r0', operation_id: 'edit-1', model: 'checked yaml' } });
    expect(mocks.changed).toHaveBeenCalledWith({ workspaceId: 'canonical', revision: 'r1', contextDigest: 'd1' });
  });
  it('does not allow a notification binding to query or edit the ontology', async () => {
    const bridge = await ensureOntologyWriteBridge({ workspaceId: 'northwind', role: 'notification' });
    for (const route of ['execute_logic_function', 'get_snapshot', 'upsert_object', 'publish_current_draft', 'register_source']) {
      const response = await fetch('http://127.0.0.1:' + bridge.port + '/tool/' + route, { method: 'POST', headers: { Authorization: 'Bearer ' + bridge.token }, body: '{}' });
      expect(response.status).toBe(403);
    }
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe('studio builder bridge scope', () => {
  it('does not let generated script actions read files outside imported project assets', async () => {
    const bridge = await ensureOntologyWriteBridge({ workspaceId: 'orders', role: 'builder' });
    const response = await fetch('http://127.0.0.1:' + bridge.port + '/tool/upsert_action', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + bridge.token },
      body: JSON.stringify({ input: { executor: 'custom_script', configuration: { command: process.execPath, args: ['/private/unrelated-config.js'] } } }),
    });
    expect(response.status).toBe(403);
    expect(mocks.write).not.toHaveBeenCalled();
  });
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
