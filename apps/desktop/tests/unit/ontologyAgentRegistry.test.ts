import { isDeepStrictEqual } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyAgentBlueprint, IOntologyPublishedVersion, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import { OntologyEngine } from '@sudowork/ontology-engine';
import { OntologyAgentRegistry } from '@process/services/ontology/OntologyAgentRegistry';

class Repository {
  snapshots = new Map<string, IOntologyWorkbenchSnapshot>();
  getSnapshot(id: string) {
    return structuredClone(this.snapshots.get(id) || null);
  }
  listSnapshots() {
    return [...this.snapshots.values()].map((snapshot) => structuredClone(snapshot));
  }
  saveSnapshot(snapshot: IOntologyWorkbenchSnapshot, expected?: IOntologyWorkbenchSnapshot) {
    if (expected && !isDeepStrictEqual(this.getSnapshot(snapshot.workspaceId), expected)) throw new Error('ontology.studio.errors.conflict');
    this.snapshots.set(snapshot.workspaceId, structuredClone(snapshot));
  }
  deleteSnapshot(id: string) {
    this.snapshots.delete(id);
  }
  resetSnapshot(id: string) {
    this.deleteSnapshot(id);
  }
}
function fixture(id = 'workspace') {
  const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: id, title: 'Orders' });
  snapshot.publishedVersions = ['v1', 'v2'].map<IOntologyPublishedVersion>((version) => ({
    id: version,
    version,
    status: 'published',
    isActive: version === 'v2',
    objectCount: 0,
    relationCount: 0,
    summary: '',
    createdAt: 1,
    diff: { addedObjectIds: [], changedObjectIds: [], removedObjectIds: [], addedRelationIds: [], removedRelationIds: [], riskLevel: 'low', summary: '' },
    snapshot: { objects: [], relations: [], mappings: [], qualityRules: [], logicFunctions: [], actions: [], serviceEndpoints: [], businessDocuments: [] },
  }));
  return snapshot;
}
let repository: Repository;
let engine: OntologyEngine;
let registry: OntologyAgentRegistry;
let installed: Set<string>;
const runtime = { isInstalled: vi.fn(), install: vi.fn(), suspend: vi.fn(), retire: vi.fn(), remove: vi.fn(), refresh: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  repository = new Repository();
  repository.saveSnapshot(fixture());
  repository.saveSnapshot(fixture('other'));
  engine = new OntologyEngine(repository);
  installed = new Set();
  runtime.isInstalled.mockImplementation(async (id: string) => installed.has(id));
  runtime.install.mockImplementation(async (blueprint: IOntologyAgentBlueprint) => {
    installed.add(blueprint.registeredAssistantId!);
  });
  runtime.remove.mockImplementation(async (blueprint: IOntologyAgentBlueprint) => {
    installed.delete(blueprint.registeredAssistantId!);
  });
  runtime.suspend.mockResolvedValue(undefined);
  runtime.retire.mockResolvedValue(undefined);
  runtime.refresh.mockResolvedValue(undefined);
  registry = new OntologyAgentRegistry(repository, engine, runtime);
});
const create = (version = 'v1', workspace = 'workspace') => registry.create({ name: `Orders ${version}`, ontologyVersionId: version }, workspace);

describe('ontology version agent lifecycle', () => {
  it('uses the user-selected name before first registration and preserves it on later reuse', async () => {
    const initial = await create();
    const selected = await registry.create({ name: '  Procurement assistant  ', ontologyVersionId: 'v1' }, 'workspace');
    expect(selected.blueprint).toMatchObject({ id: initial.blueprint.id, name: 'Procurement assistant' });
    await registry.register({ blueprintId: selected.blueprint.id }, 'workspace');
    expect(runtime.install).toHaveBeenCalledWith(expect.objectContaining({ name: 'Procurement assistant' }), expect.anything());
    const reused = await registry.create({ name: 'Another name', ontologyVersionId: 'v1' }, 'workspace');
    expect(reused.blueprint.name).toBe('Procurement assistant');
    expect(repository.getSnapshot('workspace')?.agentBlueprints).toHaveLength(1);
  });

  it.each(['', '   ', 'a'.repeat(101)])('rejects invalid names without creating a record: %j', async (name) => {
    await expect(registry.create({ name, ontologyVersionId: 'v1' }, 'workspace')).rejects.toThrow('ontology.studio.agentErrors.invalidName');
    expect(repository.getSnapshot('workspace')?.agentBlueprints).toHaveLength(0);
  });

  it('reuses one blueprint per version while keeping versions and workspaces independent', async () => {
    const results = await Promise.all([create(), create(), create()]);
    expect(new Set(results.map((item) => item.blueprint.id)).size).toBe(1);
    expect(repository.getSnapshot('workspace')?.agentBlueprints).toHaveLength(1);
    const newer = await create('v2');
    const other = await create('v1', 'other');
    expect(newer.blueprint.id).not.toBe(results[0].blueprint.id);
    expect(other.blueprint.id).not.toBe(results[0].blueprint.id);
    expect(repository.getSnapshot('workspace')?.agentBlueprints).toHaveLength(2);
  });

  it('coalesces registration, publishes progress, and treats subsequent registration as a no-op', async () => {
    const { blueprint } = await create();
    let finish!: () => void;
    runtime.install.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      installed.add(`ontology-${blueprint.id}`);
    });
    const changes: string[] = [];
    registry.onChanged = (snapshot) => changes.push(snapshot.agentBlueprints[0].status);
    const first = registry.register({ blueprintId: blueprint.id }, 'workspace');
    await vi.waitFor(() => expect(runtime.install).toHaveBeenCalledTimes(1));
    const second = registry.register({ blueprintId: blueprint.id }, 'workspace');
    expect((await registry.refresh(repository.getSnapshot('workspace')!)).agentBlueprints[0].status).toBe('registering');
    finish();
    const [one, two] = await Promise.all([first, second]);
    expect(one.blueprint.registeredAssistantId).toBe(two.blueprint.registeredAssistantId);
    expect(changes).toContain('registering');
    expect(changes.at(-1)).toBe('registered');
    await registry.register({ blueprintId: blueprint.id }, 'workspace');
    expect(runtime.install).toHaveBeenCalledTimes(1);
  });

  it('retries a failed installation with the same identity and retains a recoverable record', async () => {
    const { blueprint } = await create();
    runtime.install.mockRejectedValueOnce(new Error('MCP unavailable'));
    await expect(registry.register({ blueprintId: blueprint.id }, 'workspace')).rejects.toThrow('MCP unavailable');
    const failed = repository.getSnapshot('workspace')!.agentBlueprints[0];
    expect(failed).toMatchObject({ status: 'failed', registrationError: 'MCP unavailable', registeredAssistantId: `ontology-${blueprint.id}` });
    expect(runtime.suspend).toHaveBeenCalled();
    const retried = await registry.register({ blueprintId: blueprint.id }, 'workspace');
    expect(retried.blueprint).toMatchObject({ id: failed.id, status: 'registered', registeredAssistantId: failed.registeredAssistantId });
    expect(repository.getSnapshot('workspace')?.agentBlueprints).toHaveLength(1);
  });

  it('restores a removed assistant using its original version binding', async () => {
    const { blueprint } = await create();
    const registered = await registry.register({ blueprintId: blueprint.id }, 'workspace');
    await expect(registry.deleteByAssistant(registered.blueprint.registeredAssistantId!)).resolves.toBe(true);
    expect(repository.getSnapshot('workspace')!.agentBlueprints[0].status).toBe('deleted');
    const recreated = await create();
    expect(recreated.blueprint.id).toBe(blueprint.id);
    const restored = await registry.register({ blueprintId: blueprint.id }, 'workspace');
    expect(restored.blueprint.registeredAssistantId).toBe(registered.blueprint.registeredAssistantId);
    expect(installed.size).toBe(1);
  });

  it('detects an externally removed assistant when refreshing the workbench', async () => {
    const { blueprint } = await create();
    await registry.register({ blueprintId: blueprint.id }, 'workspace');
    installed.clear();
    const refreshed = await registry.refresh(repository.getSnapshot('workspace')!);
    expect(refreshed.agentBlueprints[0]).toMatchObject({ id: blueprint.id, status: 'deleted' });
  });

  it('recovers an interrupted registration after a process restart', async () => {
    const { blueprint } = await create();
    const snapshot = repository.getSnapshot('workspace')!;
    snapshot.agentBlueprints[0] = { ...blueprint, status: 'registering', registeredAssistantId: `ontology-${blueprint.id}` };
    repository.saveSnapshot(snapshot);
    const refreshed = await registry.refresh(snapshot);
    expect(refreshed.agentBlueprints[0]).toMatchObject({ status: 'failed', registrationError: 'ontology.studio.agentErrors.interrupted' });
    const result = await registry.register({ blueprintId: blueprint.id }, 'workspace');
    expect(result.blueprint.registeredAssistantId).toBe(`ontology-${blueprint.id}`);
  });

  it('consolidates historical duplicates by retiring extra registrations without deleting configurations', async () => {
    const { blueprint } = await create();
    const snapshot = repository.getSnapshot('workspace')!;
    const primary = { ...blueprint, status: 'registered' as const, registeredAssistantId: 'original', createdAt: 1 };
    const duplicate = { ...primary, id: 'duplicate', registeredAssistantId: 'extra', createdAt: 2 };
    snapshot.agentBlueprints = [duplicate, primary];
    repository.saveSnapshot(snapshot);
    installed.add('original');
    installed.add('extra');
    const result = await registry.refresh(snapshot);
    expect(result.agentBlueprints).toHaveLength(1);
    expect(result.agentBlueprints[0]).toMatchObject({ id: blueprint.id, registeredAssistantId: 'original', retiredRegistrations: [{ id: 'duplicate', registeredAssistantId: 'extra' }] });
    expect(runtime.retire).toHaveBeenCalledWith(duplicate);
    expect(runtime.remove).not.toHaveBeenCalled();
    await registry.register({ blueprintId: 'duplicate' }, 'workspace');
    expect(runtime.install).not.toHaveBeenCalled();
  });

  it('serializes deletion with registration so an in-flight install cannot resurrect a deleted agent', async () => {
    const { blueprint } = await create();
    let finish!: () => void;
    runtime.install.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      installed.add(`ontology-${blueprint.id}`);
    });
    const registering = registry.register({ blueprintId: blueprint.id }, 'workspace');
    await vi.waitFor(() => expect(runtime.install).toHaveBeenCalled());
    const deleting = registry.delete('workspace', blueprint.id);
    finish();
    await registering;
    await deleting;
    expect(repository.getSnapshot('workspace')?.agentBlueprints[0].status).toBe('deleted');
    expect(installed.size).toBe(0);
  });

  it('refuses a new identity or a version that is not published', async () => {
    const { blueprint } = await create();
    await expect(registry.register({ blueprintId: blueprint.id, assistantId: 'different' }, 'workspace')).rejects.toThrow('identityConflict');
    const snapshot = repository.getSnapshot('workspace')!;
    snapshot.publishedVersions[0].status = 'submitted';
    repository.saveSnapshot(snapshot);
    await expect(registry.register({ blueprintId: blueprint.id }, 'workspace')).rejects.toThrow('versionUnavailable');
    expect(runtime.install).not.toHaveBeenCalled();
  });
});
