import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { dialog } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import { OntologyEngine } from '@sudowork/ontology-engine';
import { buildOntologyArtifact, loadOntologyArtifact, readPackageFile } from '@sudowork/ontology-runtime/artifact';
import { exportOntologyArchive, extractOntologyArchive } from '@sudowork/ontology-runtime/archive';
import { OntologyService } from '@process/services/ontology/OntologyService';
import { pythonRuntimeService } from '@process/services/python/PythonRuntimeService';
import type { OntologyStudioDatabase } from '@process/services/ontology/OntologyStudioDatabase';

vi.mock('@process/services/ontology/OntologyStudioDatabase', () => ({ OntologyStudioDatabase: class {} }));
vi.mock('@/agent/acp/AcpConnection', () => ({ AcpConnection: class {} }));
vi.mock('@process/services/scode/ScodeInstallService', () => ({ getScodePath: () => null }));

class Repository {
  snapshots = new Map<string, IOntologyWorkbenchSnapshot>();
  getHostValue() {
    return null;
  }
  active = '';
  constructor(private readonly directory: string) {}
  getRuntimeDirectory() {
    return this.directory;
  }
  getSnapshot(id: string) {
    return structuredClone(this.snapshots.get(id) || null);
  }
  listSnapshots() {
    return [...this.snapshots.values()].map((snapshot) => structuredClone(snapshot));
  }
  saveSnapshot(snapshot: IOntologyWorkbenchSnapshot, before?: IOntologyWorkbenchSnapshot) {
    if (before && !isDeepStrictEqual(before, this.getSnapshot(snapshot.workspaceId))) throw new Error('conflict');
    snapshot.revision ??= 0;
    this.snapshots.set(snapshot.workspaceId, structuredClone(snapshot));
  }
  deleteSnapshot(id: string) {
    this.snapshots.delete(id);
  }
  resetSnapshot(id: string) {
    this.snapshots.delete(id);
  }
  getActiveWorkspaceId() {
    return this.active;
  }
  setActiveWorkspaceId(id: string) {
    this.active = id;
  }
  getProject(id: string) {
    const snapshot = this.snapshots.get(id);
    return snapshot ? { id, title: snapshot.draft.title, authority: 'rdf' as const, modelRef: null } : null;
  }
  listProjects() {
    return [...this.snapshots.keys()].map((id) => this.getProject(id)!);
  }
}

let root: string;
let sourceDatabase: string;
let author: OntologyService;
let recipient: OntologyService;
let authorRepository: Repository;
let recipientRepository: Repository;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sudoonto-roundtrip-'));
  sourceDatabase = path.join(root, 'business.db');
  const database = new DatabaseSync(sourceDatabase);
  database.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL); INSERT INTO orders VALUES (1, 10), (2, 20)');
  database.close();
  authorRepository = new Repository(path.join(root, 'author'));
  recipientRepository = new Repository(path.join(root, 'recipient'));
  const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'orders', title: 'Orders', description: 'Order analysis', businessGoal: 'Explain sales from actual orders.' });
  snapshot.connectors = [{ id: 'business', name: 'Business', sourceType: 'sqlite', kind: 'database', path: sourceDatabase, writable: false, metadata: {}, probeStatus: 'reachable', createdAt: 1, updatedAt: 1 }];
  snapshot.assets = [
    {
      id: 'orders-table',
      kind: 'table',
      name: 'orders',
      fields: [
        { name: 'id', dataType: 'INTEGER', nullable: true },
        { name: 'amount', dataType: 'INTEGER', nullable: false },
      ],
      profileStatus: 'ready',
      metadata: { connectorId: 'business' },
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  snapshot.objects = [
    {
      id: 'orders-object',
      code: 'orders',
      name: 'Orders',
      description: 'Business orders',
      tier: 1,
      status: 'active',
      sourceAssetIds: ['orders-table'],
      attributes: [{ id: 'order-id', code: 'id', name: 'ID', dataType: 'integer', required: true, mappedField: { assetId: 'orders-table', fieldName: 'id' } }],
      reviewDecision: 'approved',
      updatedAt: 1,
    },
  ];
  snapshot.logicFunctions = [
    {
      id: 'total',
      code: 'total',
      name: 'Total',
      displayName: 'Total',
      description: 'Sum order values',
      displayDescription: 'Sum order values',
      runtime: 'sql',
      objectIds: ['orders-object'],
      signature: 'total()',
      returnType: 'Rows',
      parameters: [],
      body: 'SELECT SUM(amount) AS total FROM orders',
      configuration: { connectorId: 'business' },
      origin: 'manual',
      status: 'active',
      executionCount: 0,
      updatedAt: 1,
    },
  ];
  snapshot.agentDefinition = { name: 'Sales analyst', description: 'Uses order evidence', instructions: 'Explain totals with the actual order query. Never invent sales.' };
  authorRepository.saveSnapshot(snapshot);
  author = new OntologyService(authorRepository as unknown as OntologyStudioDatabase, new OntologyEngine(authorRepository));
  recipient = new OntologyService(recipientRepository as unknown as OntologyStudioDatabase, new OntologyEngine(recipientRepository));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function publish(service: OntologyService, workspaceId: string) {
  await service.getWorkbench({ workspaceId });
  const candidate = await service.publishCurrentDraft({ workspaceId });
  await service.approvePublishedVersion({ workspaceId, versionId: candidate.version.id });
  return candidate.version;
}

async function exportPackage(service: OntologyService, workspaceId: string, versionId: string, filename: string, embeddedResourceIds: string[] = []) {
  const target = path.join(root, filename);
  vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: target });
  await service.exportRuntimePackage({ requestId: filename, workspaceId, versionId, embeddedResourceIds });
  return target;
}

// A circulation case publishes, exports, imports and validates full CLI artifacts.
// Windows first-read scanning takes about 2.3 s for each newly materialized CLI;
// several complete archive round trips exceed the unit-test budget without CPU contention.
describe('Sudowork ontology package circulation', () => {
  it('discovers Python only when the package requires it and preserves an explicit interpreter', async () => {
    const discovery = vi.spyOn(pythonRuntimeService, 'checkInstalled').mockResolvedValue({ installed: true, path: '/fixture/python', version: '3.12.0' });
    const snapshot = authorRepository.getSnapshot('orders')!;
    await author.scripts.build(snapshot);
    expect(discovery).not.toHaveBeenCalled();
    snapshot.logicFunctions[0] = { ...snapshot.logicFunctions[0], runtime: 'python', body: 'print(1)', configuration: {} };
    expect((await author.scripts.build(snapshot)).bindings.python).toBe('/fixture/python');
    expect(discovery).toHaveBeenCalledTimes(1);
    snapshot.runtimeBindings = { python: '/configured/python' };
    expect((await author.scripts.build(snapshot)).bindings.python).toBe('/configured/python');
    expect(discovery).toHaveBeenCalledTimes(1);
  });
  it('retains disabled implementations and secret slots without exporting credentials or losing request headers', async () => {
    const snapshot = authorRepository.getSnapshot('orders')!;
    snapshot.logicFunctions.push({ ...snapshot.logicFunctions[0], id: 'draft-logic', code: 'draft_logic', runtime: 'typescript', status: 'disabled', body: 'return { retained: true };', configuration: {} });
    snapshot.actions = [
      {
        id: 'webhook',
        code: 'webhook',
        name: 'Webhook',
        displayName: 'Webhook',
        description: 'Send report',
        displayDescription: 'Send report',
        executor: 'api',
        objectIds: [],
        parameters: [],
        outputSchema: [],
        origin: 'manual',
        status: 'active',
        executionCount: 0,
        updatedAt: 1,
        configuration: { url: 'https://example.test/report', method: 'POST', headers: { Authorization: 'private-header', 'X-Report-Format': 'v2' }, body: { apiToken: 'private-body' } },
      },
    ];
    authorRepository.saveSnapshot(snapshot);
    const version = await publish(author, 'orders');
    const filePath = await exportPackage(author, 'orders', version.id, 'editable.sudoonto', ['business']);
    const preview = await recipient.previewRuntimePackage({ filePath });
    const imported = await recipient.importRuntimePackage({ filePath, fingerprint: preview.fingerprint });
    expect(imported.logicFunctions.find((item) => item.id === 'draft-logic')).toMatchObject({ status: 'disabled', body: 'return { retained: true };' });
    expect(imported.actions[0].configuration).toMatchObject({ headers: { Authorization: { $secret: 'action:webhook/headers/Authorization' }, 'X-Report-Format': 'v2' }, body: { apiToken: { $secret: 'action:webhook/body/apiToken' } } });
    const environment = await recipient.getRuntimeEnvironment({ workspaceId: imported.workspaceId });
    expect(environment.missingBindings).toEqual(expect.arrayContaining(['action:webhook', 'action:webhook/headers/Authorization', 'action:webhook/body/apiToken']));
    expect(JSON.stringify(imported)).not.toContain('private-header');
    expect(JSON.stringify(imported)).not.toContain('private-body');
    await recipient.configureRuntimeEnvironment({ workspaceId: imported.workspaceId, bindings: { actions: { webhook: { url: 'https://deployment.test/report' } }, secrets: { 'action:webhook/headers/Authorization': 'new-header', 'action:webhook/body/apiToken': 'new-body' } } });
    const artifact = await recipient.scripts.build(recipientRepository.getSnapshot(imported.workspaceId)!);
    const loaded = await loadOntologyArtifact(artifact.directory, artifact.bindings);
    expect(loaded.snapshot.actions[0].configuration).toMatchObject({ url: 'https://deployment.test/report', headers: { Authorization: 'new-header', 'X-Report-Format': 'v2' }, body: { apiToken: 'new-body' } });
    expect(loaded.missingBindings).toEqual([]);
  }, 60_000);

  it('previews and imports a package without executing its CLI', async () => {
    const version = await publish(author, 'orders');
    const marker = path.join(root, 'must-not-exist');
    const cliFile = path.join(root, 'untrusted.cjs');
    await fs.writeFile(cliFile, 'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "executed");');
    const artifact = await buildOntologyArtifact(authorRepository.getSnapshot('orders')!, { root: path.join(root, 'foreign-artifacts'), cliFile, versionId: version.id });
    const filePath = path.join(root, 'foreign.sudoonto');
    await exportOntologyArchive(artifact, { targetPath: filePath, embeddedResourceIds: [] });
    const preview = await recipient.previewRuntimePackage({ filePath });
    const imported = await recipient.importRuntimePackage({ filePath, fingerprint: preview.fingerprint });
    await recipient.configureRuntimeEnvironment({ workspaceId: imported.workspaceId, bindings: { connections: { business: { sourceType: 'sqlite', path: sourceDatabase } } } });
    await exportPackage(recipient, imported.workspaceId, version.id, 'foreign-reexport.sudoonto', ['business']);
    await expect(fs.access(marker)).rejects.toThrow();
  }, 60_000);

  it('creates the same editable workbench from a database without a Sudograph runtime', async () => {
    const register = vi.spyOn(recipient, 'registerSudographSourceProject');
    const input = { operationId: '123e4567-e89b-42d3-a456-426614174000', language: 'en' as const, connector: { name: 'From database', sourceType: 'sqlite' as const, kind: 'database' as const, path: sourceDatabase, writable: false, metadata: {} } };
    const [first, repeated] = await Promise.all([recipient.connectStudioSource(input), recipient.connectStudioSource(input)]);
    expect(first).toMatchObject({ authority: 'rdf', name: 'From database' });
    expect(repeated.workspaceId).toBe(first.workspaceId);
    expect(recipientRepository.listSnapshots()).toHaveLength(1);
    expect(await recipient.resumeStudioSource({ operationId: input.operationId })).toEqual(first);
    const snapshot = await recipient.getWorkbench({ workspaceId: first.workspaceId });
    expect(snapshot.objects).toHaveLength(1);
    await expect(recipient.connectStudioSource({ ...input, connector: { ...input.connector, name: 'Changed input' } })).rejects.toThrow('operationConflict');
    expect(snapshot.logicFunctions[0].configuration.builtIn).toBe('lookup');
    expect((await recipient.executeLogicFunction({ workspaceId: first.workspaceId, id: snapshot.logicFunctions[0].id, arguments: { query: {} } })).execution.output).toEqual([
      { id: 1, amount: 10 },
      { id: 2, amount: 20 },
    ]);
    expect(register).not.toHaveBeenCalled();
  });

  it('restores editable materials and agent instructions, reexports the same release, then publishes a derived version', async () => {
    const version = await publish(author, 'orders');
    const filePath = await exportPackage(author, 'orders', version.id, 'orders.sudoonto', ['business']);
    const preview = await recipient.previewRuntimePackage({ filePath });
    expect(preview.agent.instructions).toContain('Never invent sales');
    const imported = await recipient.importRuntimePackage({ filePath, fingerprint: preview.fingerprint });
    expect(imported.workspaceId).not.toBe('orders');
    expect(imported.logicFunctions[0].body).toBe('SELECT SUM(amount) AS total FROM orders');
    expect(imported.draft.businessGoal).toBe('Explain sales from actual orders.');
    expect(imported.agentDefinition).toEqual(preview.agent);
    expect(imported.agentBlueprints).toEqual([]);
    expect(imported.packageIdentity).toMatchObject({ ontologyId: preview.manifest.ontologyId, source: { runtimeDigest: version.runtimeDigest } });
    await expect(recipient.configureRuntimeEnvironment({ workspaceId: imported.workspaceId, bindings: { connections: { business: { writable: true } } } })).rejects.toThrow('outside the managed runtime');
    await fs.rename(sourceDatabase, sourceDatabase + '.unavailable');
    await fs.rm(author.scripts.directory, { recursive: true, force: true });
    expect((await recipient.executeLogicFunction({ workspaceId: imported.workspaceId, code: 'total', arguments: {} })).execution.output).toEqual([{ total: 30 }]);
    const unchanged = await exportPackage(recipient, imported.workspaceId, version.id, 'unchanged.sudoonto', ['business']);
    expect((await recipient.previewRuntimePackage({ filePath: unchanged })).manifest.runtimeDigest).toBe(version.runtimeDigest);
    const externalOnly = await exportPackage(recipient, imported.workspaceId, version.id, 'external-only.sudoonto');
    const externalPreview = await recipient.previewRuntimePackage({ filePath: externalOnly });
    expect(externalPreview.manifest.resources[0].embeddedPath).toBeUndefined();
    expect(externalPreview.missingBindings).toEqual(['business']);
    await recipient.upsertLogicFunction({ ...imported.logicFunctions[0], workspaceId: imported.workspaceId, body: 'SELECT SUM(amount) + 5 AS total FROM orders' });
    await recipient.updateAgentDefinition({ workspaceId: imported.workspaceId, expectedRevision: 0, definition: { ...imported.agentDefinition!, instructions: 'Explain the adjusted total and its source.' } });
    const updatedVersion = await publish(recipient, imported.workspaceId);
    const updated = await exportPackage(recipient, imported.workspaceId, updatedVersion.id, 'updated.sudoonto', ['business']);
    const updatedPreview = await recipient.previewRuntimePackage({ filePath: updated });
    expect(updatedPreview.manifest).toMatchObject({ ontologyId: preview.manifest.ontologyId, derivedFrom: { ontologyId: preview.manifest.ontologyId, versionId: version.id, runtimeDigest: version.runtimeDigest } });
    expect(updatedPreview.manifest.runtimeDigest).not.toBe(version.runtimeDigest);
    expect(updatedPreview.agent.instructions).toContain('adjusted total');
    expect((await recipient.executeLogicFunction({ workspaceId: imported.workspaceId, code: 'total', versionId: updatedVersion.id })).execution.output).toEqual([{ total: 35 }]);
    expect((await recipient.executeLogicFunction({ workspaceId: imported.workspaceId, code: 'total', versionId: version.id })).execution.output).toEqual([{ total: 30 }]);
    const independent = path.join(root, 'server');
    await extractOntologyArchive(updated, independent);
    const loaded = await loadOntologyArtifact(independent);
    expect(loaded.missingBindings).toEqual([]);
    const agent = JSON.parse((await readPackageFile(independent, loaded.manifest.entrypoints.agent)).toString());
    expect(agent).toMatchObject({ id: 'default', requirements: { commandExecution: true }, authorization: { credentials: 'host-only' }, capabilityRefs: ['logic.total'] });
  }, 60_000);

  it('imports without database credentials, binds a different host database and preserves the fixed runtime digest', async () => {
    vi.spyOn(pythonRuntimeService, 'checkInstalled').mockResolvedValue({ installed: true, path: '/bundled/python', version: '3.12.0' });
    const version = await publish(author, 'orders');
    const filePath = await exportPackage(author, 'orders', version.id, 'external.sudoonto');
    const preview = await recipient.previewRuntimePackage({ filePath });
    expect(preview.missingBindings).toEqual(['business']);
    const imported = await recipient.importRuntimePackage({ filePath, fingerprint: preview.fingerprint });
    expect((await recipient.getRuntimeEnvironment({ workspaceId: imported.workspaceId })).missingBindings).toEqual(['business']);
    const target = path.join(root, 'enterprise.db');
    const database = new DatabaseSync(target);
    database.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL); INSERT INTO orders VALUES (1, 99)');
    database.close();
    await recipient.configureRuntimeEnvironment({ workspaceId: imported.workspaceId, bindings: { python: '/deployment/python', connections: { business: { sourceType: 'sqlite', path: target, writable: false } } } });
    expect((await recipient.scripts.build(recipientRepository.getSnapshot(imported.workspaceId)!)).bindings.python).toBe('/deployment/python');
    expect((await recipient.scripts.published(recipientRepository.getSnapshot(imported.workspaceId)!, version.id)).bindings.python).toBe('/deployment/python');
    expect(await recipient.verifyRuntimeEnvironment({ workspaceId: imported.workspaceId })).toMatchObject({ isValid: true });
    expect((await recipient.executeLogicFunction({ workspaceId: imported.workspaceId, code: 'total', versionId: version.id })).execution.output).toEqual([{ total: 99 }]);
    expect((await recipient.planRuntimePackage({ workspaceId: imported.workspaceId, versionId: version.id })).versionId).toBe(version.id);
    const fork = await recipient.importRuntimePackage({ filePath, fingerprint: preview.fingerprint, isFork: true, name: 'My derivative' });
    expect(fork.packageIdentity?.ontologyId).not.toBe(preview.manifest.ontologyId);
    expect(fork.packageIdentity?.source?.runtimeDigest).toBe(version.runtimeDigest);
    expect(fork.publishedVersions).toEqual([]);
    expect(fork.draft.title).toBe('My derivative');
  }, 60_000);

  it('rejects files changed after preview without creating a partial project', async () => {
    const version = await publish(author, 'orders');
    const filePath = await exportPackage(author, 'orders', version.id, 'changed.sudoonto');
    await expect(recipient.importRuntimePackage({ filePath, fingerprint: '0'.repeat(64) })).rejects.toThrow('fileChanged');
    expect(recipientRepository.listSnapshots()).toEqual([]);
    expect(await fs.readdir(recipient.scripts.directory)).not.toContain('.import-');
  }, 60_000);
});
