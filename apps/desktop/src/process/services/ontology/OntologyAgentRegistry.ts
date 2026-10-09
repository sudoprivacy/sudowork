import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { IOntologyAgentBlueprint, IOntologyAgentBlueprintInput, IOntologyRegisterAgentInput, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyRepository, OntologyEngine } from '@sudowork/ontology-engine';

type AgentResult = { snapshot: IOntologyWorkbenchSnapshot; blueprint: IOntologyAgentBlueprint };
type AgentIdentity = Pick<IOntologyAgentBlueprint, 'id' | 'registeredAssistantId'>;
const queues = new WeakMap<IOntologyRepository, Map<string, Promise<unknown>>>();

/** Own one durable registration per published version, including retries and deletion recovery. */
export class OntologyAgentRegistry {
  onChanged: (snapshot: IOntologyWorkbenchSnapshot) => void = () => {};
  private readonly pending = new Map<string, Promise<AgentResult>>();
  private readonly operations: Map<string, Promise<unknown>>;

  constructor(
    private readonly repository: IOntologyRepository,
    private readonly engine: OntologyEngine,
    private readonly runtime: IOntologyAgentRuntime
  ) {
    this.operations = queues.get(repository) || new Map();
    queues.set(repository, this.operations);
  }

  withLock<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.operations.get(workspaceId) || Promise.resolve()).catch(() => {}).then(operation);
    this.operations.set(workspaceId, result);
    void result
      .finally(() => {
        if (this.operations.get(workspaceId) === result) this.operations.delete(workspaceId);
      })
      .catch(() => {});
    return result;
  }

  async refresh(snapshot: IOntologyWorkbenchSnapshot): Promise<IOntologyWorkbenchSnapshot> {
    if (!snapshot.agentBlueprints.length) return snapshot;
    if (this.operations.has(snapshot.workspaceId)) return this.read(snapshot.workspaceId);
    return this.withLock(snapshot.workspaceId, () => this.reconcile(snapshot.workspaceId));
  }

  create(input: IOntologyAgentBlueprintInput, workspaceId: string): Promise<AgentResult> {
    return this.withLock(workspaceId, async () => {
      const name = z.string().trim().min(1).max(100).safeParse(input.name);
      if (!name.success) throw new Error('ontology.studio.agentErrors.invalidName');
      await this.reconcile(workspaceId);
      const result = await this.engine.createAgentBlueprint({ ...input, name: name.data }, workspaceId);
      if (result.blueprint.status === 'draft' && !result.blueprint.registeredAssistantId && result.blueprint.name !== name.data) {
        const snapshot = await this.update(workspaceId, result.blueprint.id, { name: name.data });
        return { snapshot, blueprint: snapshot.agentBlueprints.find((item) => item.id === result.blueprint.id)! };
      }
      this.onChanged(result.snapshot);
      return result;
    });
  }

  async register(input: IOntologyRegisterAgentInput, workspaceId: string): Promise<AgentResult> {
    const initial = await this.read(workspaceId);
    const requested = input.blueprintId ? initial.agentBlueprints.find((item) => item.id === input.blueprintId || item.retiredRegistrations?.some((old) => old.id === input.blueprintId)) : initial.agentBlueprints.at(-1);
    if (!requested) throw new Error('ontology.studio.agentErrors.notFound');
    const key = JSON.stringify([workspaceId, requested.ontologyVersionId]);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const operation = this.withLock(workspaceId, async () => {
      const snapshot = await this.reconcile(workspaceId);
      const blueprint = snapshot.agentBlueprints.find((item) => item.ontologyVersionId === requested.ontologyVersionId);
      if (!blueprint) throw new Error('ontology.studio.agentErrors.notFound');
      if (!snapshot.publishedVersions.some((version) => version.id === blueprint.ontologyVersionId && version.status === 'published')) throw new Error('ontology.studio.agentErrors.versionUnavailable');
      const assistantId = blueprint.registeredAssistantId || `ontology-${blueprint.id}`;
      if (input.assistantId && input.assistantId.trim() !== assistantId) throw new Error('ontology.studio.agentErrors.identityConflict');
      if (blueprint.status === 'registered') return { snapshot, blueprint };
      const started = await this.update(workspaceId, blueprint.id, { status: 'registering', registeredAssistantId: assistantId, registrationError: undefined });
      const registering = started.agentBlueprints.find((item) => item.id === blueprint.id)!;
      try {
        await this.runtime.install(registering, started);
        await this.runtime.refresh();
        const result = await this.engine.registerAgentBlueprint({ blueprintId: blueprint.id, assistantId }, workspaceId);
        this.onChanged(result.snapshot);
        return result;
      } catch (error) {
        await this.runtime.suspend(registering).catch(() => {});
        await this.runtime.refresh().catch(() => {});
        const message = error instanceof Error ? error.message : String(error);
        await this.update(workspaceId, blueprint.id, { status: 'failed', registrationError: message.slice(0, 1000) });
        throw error;
      }
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, operation);
    return operation;
  }

  delete(workspaceId: string, blueprintId: string): Promise<IOntologyWorkbenchSnapshot> {
    return this.withLock(workspaceId, async () => {
      const snapshot = await this.reconcile(workspaceId);
      const blueprint = snapshot.agentBlueprints.find((item) => item.id === blueprintId);
      if (!blueprint) {
        const retired = snapshot.agentBlueprints.flatMap((item) => item.retiredRegistrations || []).find((item) => item.id === blueprintId);
        if (!retired) throw new Error('ontology.studio.agentErrors.notFound');
        await this.runtime.remove(retired);
        await this.runtime.refresh();
        return snapshot;
      }
      await this.runtime.remove(blueprint);
      const result = await this.engine.deleteAgentBlueprint({ id: blueprint.id }, workspaceId);
      this.onChanged(result);
      await this.runtime.refresh();
      return result;
    });
  }

  async deleteByAssistant(assistantId: string): Promise<boolean> {
    for (const snapshot of await this.repository.listSnapshots()) {
      const blueprint = snapshot.agentBlueprints.find((item) => item.registeredAssistantId === assistantId);
      if (blueprint) {
        await this.delete(snapshot.workspaceId, blueprint.id);
        return true;
      }
    }
    return false;
  }

  private async read(workspaceId: string): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.repository.getSnapshot(workspaceId);
    if (!snapshot) throw new Error('ontology.studio.errors.notFound');
    return snapshot;
  }

  private async update(workspaceId: string, blueprintId: string, changes: Partial<IOntologyAgentBlueprint>) {
    const before = await this.read(workspaceId);
    if (!before.agentBlueprints.some((item) => item.id === blueprintId)) throw new Error('ontology.studio.agentErrors.notFound');
    const snapshot = structuredClone(before);
    snapshot.agentBlueprints = snapshot.agentBlueprints.map((item) => (item.id === blueprintId ? { ...item, ...changes, updatedAt: Date.now() } : item));
    await this.repository.saveSnapshot(snapshot, before);
    this.onChanged(snapshot);
    return snapshot;
  }

  private async reconcile(workspaceId: string): Promise<IOntologyWorkbenchSnapshot> {
    const before = await this.read(workspaceId);
    if (!before.agentBlueprints.length) return before;
    const installed = new Map(await Promise.all(before.agentBlueprints.map(async (item) => [item.id, !!item.registeredAssistantId && (await this.runtime.isInstalled(item.registeredAssistantId))] as const)));
    const groups = new Map<string, IOntologyAgentBlueprint[]>();
    for (const item of before.agentBlueprints) groups.set(item.ontologyVersionId, [...(groups.get(item.ontologyVersionId) || []), item]);
    const blueprints: IOntologyAgentBlueprint[] = [];
    let isRuntimeChanged = false;
    for (const group of groups.values()) {
      group.sort((a, b) => Number(installed.get(b.id) && b.status === 'registered') - Number(installed.get(a.id) && a.status === 'registered') || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const [original, ...duplicates] = group;
      const current = structuredClone(original);
      for (const duplicate of duplicates) {
        await this.runtime.retire(duplicate.registeredAssistantId === current.registeredAssistantId ? { id: duplicate.id } : duplicate);
        current.retiredRegistrations = [...(current.retiredRegistrations || []), { id: duplicate.id, registeredAssistantId: duplicate.registeredAssistantId, registeredAt: duplicate.registeredAt }, ...(duplicate.retiredRegistrations || [])];
        isRuntimeChanged = true;
      }
      if (current.status === 'published') current.status = installed.get(current.id) ? 'registered' : 'draft';
      if (current.status === 'registering') {
        current.status = 'failed';
        current.registrationError = 'ontology.studio.agentErrors.interrupted';
        await this.runtime.suspend(current);
        isRuntimeChanged = true;
      } else if (current.status === 'registered' && !installed.get(current.id)) {
        await this.runtime.remove(current);
        current.status = 'deleted';
        current.registrationError = undefined;
        isRuntimeChanged = true;
      }
      blueprints.push(current);
    }
    if (isDeepStrictEqual(before.agentBlueprints, blueprints)) return before;
    const latest = await this.read(workspaceId);
    if (!isDeepStrictEqual(latest.agentBlueprints, before.agentBlueprints)) throw new Error('ontology.studio.errors.conflict');
    const snapshot = { ...latest, agentBlueprints: blueprints };
    await this.repository.saveSnapshot(snapshot, latest);
    this.onChanged(snapshot);
    if (isRuntimeChanged) await this.runtime.refresh();
    return snapshot;
  }
}

interface IOntologyAgentRuntime {
  isInstalled: (assistantId: string) => Promise<boolean>;
  install: (blueprint: IOntologyAgentBlueprint, snapshot: IOntologyWorkbenchSnapshot) => Promise<void>;
  suspend: (blueprint: AgentIdentity) => Promise<void>;
  retire: (blueprint: AgentIdentity) => Promise<void>;
  remove: (blueprint: AgentIdentity) => Promise<void>;
  refresh: () => Promise<void>;
}
