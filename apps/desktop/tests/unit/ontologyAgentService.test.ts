import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IAssistantMeta } from '@sudowork/common/assistantTypes';
import { OntologyEngine } from '@sudowork/ontology-engine';
import { OntologyService } from '@process/services/ontology/OntologyService';
import type { OntologyStudioDatabase } from '@process/services/ontology/OntologyStudioDatabase';

const mocks = vi.hoisted(() => ({ getMeta: vi.fn(), create: vi.fn(), enable: vi.fn(), disable: vi.fn(), uninstall: vi.fn(), installMcp: vi.fn(), removeMcp: vi.fn(), refresh: vi.fn(), skillRoot: '/tmp/ontology-agent-service-skills' }));
vi.mock('@process/AssistantManager', () => ({ assistantManager: { getAssistantMetaWithDir: mocks.getMeta, createAssistant: mocks.create, enableAssistant: mocks.enable, disableAssistant: mocks.disable, uninstallAssistant: mocks.uninstall } }));
vi.mock('@process/services/ontology/OntologyStudioDatabase', () => ({ OntologyStudioDatabase: class {} }));
vi.mock('@process/services/ontology/OntologyMcpRegistration', () => ({ installOntologyMcpServer: mocks.installMcp, removeOntologyMcpServer: mocks.removeMcp }));
vi.mock('@/agent/acp/AcpDetector', () => ({ acpDetector: { refreshCustomAgents: mocks.refresh } }));
vi.mock('@/agent/acp/AcpConnection', () => ({ AcpConnection: class {} }));
vi.mock('@process/initStorage', async (importOriginal) => ({ ...(await importOriginal<typeof import('@process/initStorage')>()), getCustomSkillsDir: () => mocks.skillRoot }));

class Repository {
  snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'workspace', title: 'Orders' });
  getSnapshot(id: string) {
    return id === 'workspace' ? structuredClone(this.snapshot) : null;
  }
  listSnapshots() {
    return [this.getSnapshot('workspace')!];
  }
  saveSnapshot(snapshot: IOntologyWorkbenchSnapshot, expected?: IOntologyWorkbenchSnapshot) {
    if (expected && !isDeepStrictEqual(expected, this.snapshot)) throw new Error('conflict');
    this.snapshot = structuredClone(snapshot);
  }
  deleteSnapshot() {}
  resetSnapshot() {}
  getMcpExportPath() {
    return '/synthetic/ontology.json';
  }
}
let repository: Repository;
let service: OntologyService;
let agents: Map<string, IAssistantMeta>;
beforeEach(async () => {
  vi.resetAllMocks();
  await fs.rm(mocks.skillRoot, { recursive: true, force: true });
  repository = new Repository();
  repository.snapshot.publishedVersions = [
    {
      id: 'v1',
      version: 'v1',
      status: 'published',
      isActive: true,
      objectCount: 0,
      relationCount: 0,
      summary: '',
      createdAt: 1,
      diff: { addedObjectIds: [], changedObjectIds: [], removedObjectIds: [], addedRelationIds: [], removedRelationIds: [], summary: '', riskLevel: 'low' },
      snapshot: { objects: [], relations: [], mappings: [], qualityRules: [], logicFunctions: [], actions: [], serviceEndpoints: [], businessDocuments: [] },
    },
  ];
  repository.snapshot.skillBlueprints = [
    {
      id: 'skill-v1',
      name: 'Orders skill',
      description: 'Order operations',
      status: 'published',
      ontologyVersionId: 'v1',
      version: '1.0.0',
      entityIds: [],
      toolManifest: [],
      registeredSkillId: 'ontology-skill-v1',
      publishedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  agents = new Map();
  mocks.getMeta.mockImplementation(async (id: string) => (agents.has(id) ? { meta: structuredClone(agents.get(id)), category: 'custom', dir: `/synthetic/${id}` } : null));
  mocks.create.mockImplementation(async (meta: IAssistantMeta) => {
    agents.set(meta.id!, structuredClone(meta));
    return { success: true };
  });
  mocks.enable.mockImplementation(async (id: string) => {
    agents.get(id)!.enabled = true;
    return { success: true };
  });
  mocks.disable.mockImplementation(async (id: string) => {
    agents.get(id)!.enabled = false;
    return { success: true };
  });
  mocks.uninstall.mockImplementation(async (id: string) => {
    agents.delete(id);
    return { success: true };
  });
  mocks.installMcp.mockResolvedValue(undefined);
  mocks.removeMcp.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  service = new OntologyService(repository as unknown as OntologyStudioDatabase, new OntologyEngine(repository));
});
afterEach(async () => fs.rm(mocks.skillRoot, { recursive: true, force: true }));
const create = () => service.createAgentBlueprint({ workspaceId: 'workspace', skillBlueprintId: 'skill-v1', name: 'Orders v1' });

describe('ontology agent runtime integration', () => {
  it('publishes an ontology skill into the shared skill library with immutable provenance', async () => {
    repository.snapshot.skillBlueprints[0] = { ...repository.snapshot.skillBlueprints[0], status: 'draft', registeredSkillId: undefined, publishedAt: undefined };
    const result = await service.publishSkillBlueprint({ workspaceId: 'workspace', skillBlueprintId: 'skill-v1', name: 'Orders skill', description: 'Order queries and calculations' });
    expect(result.blueprint).toMatchObject({ status: 'published', registeredSkillId: 'ontology-skill-skill-v1' });
    const directory = path.join(mocks.skillRoot, 'ontology-skill-skill-v1');
    expect(await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8')).toContain('Use this skill for questions and operations grounded in Orders v1.');
    expect(JSON.parse(await fs.readFile(path.join(directory, '_sudowork_meta.json'), 'utf8'))).toMatchObject({
      id: 'ontology-skill-skill-v1',
      display_name: 'Orders skill',
      ontologyBinding: { workspaceId: 'workspace', versionId: 'v1', skillBlueprintId: 'skill-v1' },
    });
    expect(mocks.installMcp).toHaveBeenCalledWith({ blueprintId: 'skill-v1', workspaceId: 'workspace', versionId: 'v1', exportFile: '/synthetic/ontology.json' });
  });

  it('keeps the skill draft and removes partial files when runtime publication fails', async () => {
    repository.snapshot.skillBlueprints[0] = { ...repository.snapshot.skillBlueprints[0], status: 'draft', registeredSkillId: undefined, publishedAt: undefined };
    mocks.installMcp.mockRejectedValueOnce(new Error('MCP unavailable'));
    await expect(service.publishSkillBlueprint({ workspaceId: 'workspace', skillBlueprintId: 'skill-v1', name: 'Orders skill', description: 'Order queries' })).rejects.toThrow('MCP unavailable');
    expect(repository.snapshot.skillBlueprints[0]).toMatchObject({ status: 'failed', publicationError: 'MCP unavailable' });
    await expect(fs.stat(path.join(mocks.skillRoot, 'ontology-skill-skill-v1'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(mocks.removeMcp).toHaveBeenCalledWith('skill-v1');
  });

  it('loads the registered version rules and refuses disabled or mismatched agents', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-agent-runtime-'));
    try {
      const { blueprint } = await create();
      const registered = await service.registerAgentBlueprint({ workspaceId: 'workspace', blueprintId: blueprint.id });
      const id = registered.blueprint.registeredAssistantId!;
      const meta = agents.get(id)!;
      await fs.writeFile(path.join(directory, 'AGENT.md'), 'Use the published v1 ontology.');
      mocks.getMeta.mockImplementation(async () => ({ meta, category: 'custom', dir: directory }));
      expect(await service.getRegisteredAgentRuntime(id)).toMatchObject({ meta: { ontologyBinding: { workspaceId: 'workspace', versionId: 'v1', skillBlueprintId: 'skill-v1', blueprintId: blueprint.id } }, presetContext: expect.stringContaining('published v1') });
      expect((await service.getRegisteredAgentRuntime(id))?.mcpRegistration).toEqual({ workspaceId: 'workspace', versionId: 'v1', skillBlueprintId: 'skill-v1', blueprintId: blueprint.id, exportFile: '/synthetic/ontology.json' });
      meta.enabled = false;
      await expect(service.getRegisteredAgentRuntime(id)).rejects.toThrow('notFound');
      meta.enabled = true;
      meta.ontologyBinding!.versionId = 'unrelated';
      await expect(service.getRegisteredAgentRuntime(id)).rejects.toThrow('identityConflict');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects rule files outside the registered agent directory', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-agent-path-'));
    try {
      const agentDir = path.join(directory, 'agent');
      await fs.mkdir(agentDir);
      await fs.writeFile(path.join(directory, 'other.md'), 'Unrelated rules');
      const { blueprint } = await create();
      const registered = await service.registerAgentBlueprint({ workspaceId: 'workspace', blueprintId: blueprint.id });
      const id = registered.blueprint.registeredAssistantId!;
      mocks.getMeta.mockResolvedValue({ meta: { ...agents.get(id), ruleFile: '../other.md' }, category: 'custom', dir: agentDir });
      await expect(service.getRegisteredAgentRuntime(id)).rejects.toThrow('identityConflict');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('creates an owned agent that references the already-published ontology skill', async () => {
    const { blueprint } = await create();
    const result = await service.registerAgentBlueprint({ workspaceId: 'workspace', blueprintId: blueprint.id });
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ enabled: false, enabledSkills: ['ontology-skill-v1'], ontologyBinding: { workspaceId: 'workspace', versionId: 'v1', skillBlueprintId: 'skill-v1', blueprintId: blueprint.id } });
    expect(mocks.installMcp).not.toHaveBeenCalled();
    expect(agents.get(result.blueprint.registeredAssistantId!)?.enabled).toBe(true);
    await service.registerAgentBlueprint({ workspaceId: 'workspace', blueprintId: blueprint.id });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.installMcp).not.toHaveBeenCalled();
  });

  it('keeps a failed installation disabled and resumes it with the same agent ID', async () => {
    const { blueprint } = await create();
    mocks.enable.mockResolvedValueOnce({ success: false, msg: 'Enable failed' });
    await expect(service.registerAgentBlueprint({ workspaceId: 'workspace', blueprintId: blueprint.id })).rejects.toThrow('Enable failed');
    const failed = repository.snapshot.agentBlueprints[0];
    expect(failed.status).toBe('failed');
    expect(agents.get(failed.registeredAssistantId!)?.enabled).toBe(false);
    const retried = await service.registerAgentBlueprint({ workspaceId: 'workspace', blueprintId: blueprint.id });
    expect(retried.blueprint.registeredAssistantId).toBe(failed.registeredAssistantId);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(agents.size).toBe(1);
  });

  it('records deletion from the general agent page and restores the same binding', async () => {
    const { blueprint } = await create();
    const result = await service.registerAgentBlueprint({ workspaceId: 'workspace', blueprintId: blueprint.id });
    const id = result.blueprint.registeredAssistantId!;
    await expect(service.deleteRegisteredAssistant(id, 'custom')).resolves.toBe(true);
    expect(agents.has(id)).toBe(false);
    expect(repository.snapshot.agentBlueprints[0]).toMatchObject({ id: blueprint.id, status: 'deleted', registeredAssistantId: id });
    const restored = await service.registerAgentBlueprint({ workspaceId: 'workspace', blueprintId: blueprint.id });
    expect(restored.blueprint.registeredAssistantId).toBe(id);
  });

  it('does not overwrite or disable an unrelated assistant with the reserved ID', async () => {
    const { blueprint } = await create();
    const id = `ontology-${blueprint.id}`;
    agents.set(id, { id, enabled: true, nameI18n: { 'en-US': 'Unrelated agent' } });
    await expect(service.registerAgentBlueprint({ workspaceId: 'workspace', blueprintId: blueprint.id })).rejects.toThrow('identityConflict');
    expect(agents.get(id)).toMatchObject({ enabled: true, nameI18n: { 'en-US': 'Unrelated agent' } });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.disable).not.toHaveBeenCalled();
  });

  it('disables historical duplicates while retaining their configuration and a single active association', async () => {
    const { blueprint } = await create();
    repository.snapshot.agentBlueprints = [
      { ...blueprint, status: 'registered', registeredAssistantId: 'original', createdAt: 1 },
      { ...blueprint, id: 'duplicate', status: 'registered', registeredAssistantId: 'extra', createdAt: 2 },
    ];
    agents.set('original', { id: 'original', enabled: true });
    agents.set('extra', { id: 'extra', enabled: true });
    const snapshot = await service.getWorkbench({ workspaceId: 'workspace' });
    expect(snapshot.agentBlueprints).toHaveLength(1);
    expect(snapshot.agentBlueprints[0].registeredAssistantId).toBe('original');
    expect(agents.get('extra')?.enabled).toBe(false);
    expect(agents.has('extra')).toBe(true);
    expect(mocks.uninstall).not.toHaveBeenCalled();
  });
});
