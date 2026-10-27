import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchSnapshot, IOntologyScriptResponse } from '@sudowork/ontology-common';
import { buildOntologyArtifact, canonicalJson, loadOntologyArtifact, sealPackage, verifyPackage } from '@sudowork/ontology-runtime/artifact';
import { exportOntologyArchive, extractOntologyArchive } from '@sudowork/ontology-runtime/archive';

const cliFile = path.resolve(__dirname, '../../resources/ontology-cli/ontology.cjs');
let directory: string;
let databasePath: string;
let snapshot: IOntologyWorkbenchSnapshot;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-script-package-'));
  databasePath = path.join(directory, 'business.db');
  const database = new DatabaseSync(databasePath);
  database.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL); WITH RECURSIVE numbers(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 250) INSERT INTO orders SELECT value, value * 10 FROM numbers;');
  database.close();
  snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'portable', title: 'Portable Orders' });
  snapshot.connectors = [{ id: 'business', name: 'Business database', sourceType: 'sqlite', kind: 'database', path: databasePath, password: 'never-export-this-password', writable: false, metadata: {}, probeStatus: 'reachable', createdAt: 1, updatedAt: 1 }];
  snapshot.assets = [
    {
      id: 'orders-table',
      kind: 'table',
      name: 'orders',
      path: databasePath,
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
      id: 'orders',
      code: 'orders',
      name: 'Orders',
      description: 'Business orders',
      tier: 1,
      status: 'active',
      sourceAssetIds: ['orders-table'],
      attributes: [{ id: 'order-id', code: 'id', name: 'ID', dataType: 'integer', required: true, description: '', mappedField: { assetId: 'orders-table', fieldName: 'id' } }],
      reviewDecision: 'approved',
      updatedAt: 1,
    },
  ];
  snapshot.logicFunctions = [
    {
      id: 'sales-report',
      code: 'sales_report',
      name: 'Sales report',
      displayName: 'Sales report',
      description: 'Read the complete dataset',
      displayDescription: 'Read the complete dataset',
      runtime: 'sql',
      objectIds: ['orders'],
      signature: 'sales_report()',
      returnType: 'Rows',
      parameters: [],
      body: 'SELECT COUNT(*) AS count, SUM(amount) AS total FROM orders',
      configuration: { connectorId: 'business' },
      origin: 'manual',
      status: 'active',
      executionCount: 0,
      updatedAt: 1,
    },
  ];
  snapshot.actions = [
    {
      id: 'update-order',
      code: 'update_order',
      name: 'Update order',
      description: 'Update an order',
      displayName: 'Update order',
      displayDescription: 'Update an order',
      executor: 'sql',
      objectIds: ['orders'],
      configuration: { connectorId: 'business', statement: 'UPDATE orders SET amount = 1 WHERE id = 1' },
      parameters: [],
      outputSchema: [],
      origin: 'manual',
      status: 'active',
      executionCount: 0,
      updatedAt: 1,
    },
  ];
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

async function invoke(root: string, command: string[], bindings?: string, inputArguments: Record<string, unknown> = {}): Promise<IOntologyScriptResponse> {
  const args = [path.join(root, 'scripts/ontology.cjs'), ...command, '--package', root, ...(bindings ? ['--bindings', bindings] : [])];
  const inputPath = path.join(directory, 'request.json');
  await fs.writeFile(inputPath, JSON.stringify({ protocolVersion: 1, requestId: 'test', arguments: inputArguments }));
  args.push('--input-file', inputPath);
  try {
    const result = await promisify(execFile)(process.execPath, args, { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '' }, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(result.stdout) as IOntologyScriptResponse;
  } catch (error) {
    const output = (error as { stdout?: string }).stdout;
    if (!output) throw error;
    return JSON.parse(output) as IOntologyScriptResponse;
  }
}

describe('portable ontology scripts', () => {
  it('requires the target host to authorize writable connections independently from the package author', async () => {
    snapshot.connectors[0].writable = true;
    const artifact = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    const bindings = path.join(directory, 'bindings.json');
    const targetBindings = { connections: { business: { sourceType: 'sqlite', path: databasePath } }, allowedActions: ['update-order'] };
    await fs.writeFile(bindings, canonicalJson(targetBindings));
    expect((await invoke(artifact.directory, ['invoke', 'action.update_order'], bindings)).isSuccess).toBe(false);
    expect(await invoke(artifact.directory, ['invoke', 'logic.sales_report'], bindings)).toMatchObject({ isSuccess: true, data: [{ count: 250, total: 313750 }] });
    await fs.writeFile(bindings, canonicalJson({ ...targetBindings, connections: { business: { ...targetBindings.connections.business, writable: true } } }));
    expect(await invoke(artifact.directory, ['invoke', 'action.update_order'], bindings)).toMatchObject({ isSuccess: true });
    expect(await invoke(artifact.directory, ['invoke', 'logic.sales_report'], bindings)).toMatchObject({ isSuccess: true, data: [{ count: 250, total: 313741 }] });
  });

  it('preserves existing nested credential and provider parameter bindings', async () => {
    const definitions = [
      { sourceType: 'mysql' as const, host: 'database.internal', database: 'orders', credential: { username: 'reader' } },
      { sourceType: 'kafka' as const, params: { brokers: 'broker.internal:9092' } },
      { sourceType: 's3' as const, params: { bucket: 'orders' } },
      { sourceType: 'rest' as const, params: { base_url: 'https://example.test/orders' } },
    ];
    for (const definition of definitions) {
      snapshot.connectors[0] = { ...snapshot.connectors[0], ...definition, host: 'host' in definition ? definition.host : undefined, username: undefined, params: definition.params, credential: definition.credential };
      const artifact = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
      expect((await loadOntologyArtifact(artifact.directory, artifact.bindings)).missingBindings).toEqual([]);
      expect((await loadOntologyArtifact(artifact.directory)).missingBindings).toEqual(['business']);
    }
  });

  it('only requires the bindings used by the invoked capability, including function action dependencies', async () => {
    snapshot.actions.push(
      { ...snapshot.actions[0], id: 'notify', code: 'notify', executor: 'notification', configuration: { title: 'Report', body: 'Complete' } },
      { ...snapshot.actions[0], id: 'report-action', code: 'report_action', executor: 'function', configuration: { functionCode: 'sales_report' } }
    );
    const artifact = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    const report = artifact.capabilities.find((item) => item.id === 'action.report_action')!;
    expect(report.resourceRefs).toEqual(['business']);
    expect(await invoke(artifact.directory, ['invoke', 'action.report_action'])).toMatchObject({ isSuccess: false, error: { code: 'BINDING_REQUIRED' } });
    const archive = path.join(directory, 'orders.ontology.zip');
    const exported = await exportOntologyArchive(artifact, { targetPath: archive, embeddedResourceIds: ['business'] });
    expect(exported.requiresBindings).toEqual(['action:notify']);
    const target = path.join(directory, 'independent');
    await extractOntologyArchive(archive, target);
    await fs.rename(databasePath, databasePath + '.unavailable');
    expect(await invoke(target, ['invoke', 'logic.sales_report'])).toMatchObject({ isSuccess: true, data: [{ count: 250, total: 313750 }] });
    expect(await invoke(target, ['invoke', 'action.notify'])).toMatchObject({ isSuccess: false, error: { code: 'BINDING_REQUIRED' } });
    expect(await invoke(target, ['validate'])).toMatchObject({ isSuccess: false, error: { code: 'BINDING_REQUIRED' } });
    const bindings = path.join(directory, 'bindings.json');
    await fs.writeFile(bindings, canonicalJson({ allowedActions: ['report-action'] }));
    expect(await invoke(target, ['invoke', 'action.report_action'], bindings)).toMatchObject({ isSuccess: true, data: [{ count: 250, total: 313750 }], meta: { executedFunctionIds: ['sales-report'] } });
  });

  it('executes the same immutable scripts locally and from an exported database snapshot without the original source', async () => {
    snapshot.assets[0].fields[0].sampleValues = ['private-preview-row'];
    const artifact = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    const bindings = path.join(directory, 'bindings.json');
    await fs.writeFile(bindings, canonicalJson(artifact.bindings));
    expect(await invoke(artifact.directory, ['invoke', 'logic.sales_report'], bindings)).toMatchObject({ isSuccess: true, data: [{ count: 250, total: 313750 }] });
    const archive = path.join(directory, 'orders.ontology.zip');
    const exported = await exportOntologyArchive(artifact, { targetPath: archive, embeddedResourceIds: ['business'] });
    expect(exported.requiresBindings).toEqual([]);
    const target = path.join(directory, 'another-machine');
    await extractOntologyArchive(archive, target);
    await fs.rename(databasePath, databasePath + '.unavailable');
    await fs.rm(artifact.directory, { recursive: true, force: true });
    expect(await invoke(target, ['invoke', 'logic.sales_report'])).toMatchObject({ isSuccess: true, data: [{ count: 250, total: 313750 }] });
    expect((await verifyPackage(target)).runtimeDigest).toBe(artifact.manifest.runtimeDigest);
    expect((await invoke(target, ['verify'])).isSuccess).toBe(true);
    const model = await fs.readFile(path.join(target, 'ontology/runtime-model.json'), 'utf8');
    expect(model).not.toContain(databasePath);
    expect(model).not.toContain('never-export-this-password');
    expect(model).not.toContain('private-preview-row');
    const examples = await fs.readFile(path.join(target, 'environment/bindings.example.json'), 'utf8');
    expect(examples).not.toContain('never-export-this-password');
  });

  it('reports external bindings and refuses package tampering before executing a capability', async () => {
    const artifact = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    expect(await invoke(artifact.directory, ['validate'])).toMatchObject({ isSuccess: false, error: { code: 'BINDING_REQUIRED' } });
    const implementation = artifact.capabilities.find((item) => item.id === 'logic.sales_report')!.implementation!;
    await fs.writeFile(path.join(artifact.directory, implementation.file), 'DELETE FROM orders');
    expect(await invoke(artifact.directory, ['invoke', 'logic.sales_report'])).toMatchObject({ isSuccess: false, error: { code: 'PACKAGE_INTEGRITY_FAILED' } });
    const database = new DatabaseSync(databasePath);
    expect(database.prepare('SELECT COUNT(*) AS count FROM orders').get()?.count).toBe(250);
    database.close();
  });

  it('keeps model changes in a different artifact and requires explicit action authorization', async () => {
    const original = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    snapshot.logicFunctions[0].body = 'SELECT 1 AS count';
    const changed = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    expect(changed.manifest.runtimeDigest).not.toBe(original.manifest.runtimeDigest);
    const bindings = path.join(directory, 'bindings.json');
    await fs.writeFile(bindings, canonicalJson({ ...original.bindings, allowedActions: [] }));
    expect(await invoke(original.directory, ['invoke', 'action.update_order'], bindings)).toMatchObject({ isSuccess: false, error: { code: 'WRITE_NOT_AUTHORIZED' } });
    expect(await invoke(original.directory, ['invoke', 'logic.sales_report'], bindings)).toMatchObject({ isSuccess: true, data: [{ count: 250, total: 313750 }] });
  });

  it('rejects archive traversal and does not leave partially extracted files', async () => {
    const zip = new JSZip();
    zip.file('../escaped', 'not allowed');
    const archive = path.join(directory, 'invalid.zip');
    await fs.writeFile(archive, await zip.generateAsync({ type: 'nodebuffer' }));
    const target = path.join(directory, 'invalid-output');
    await expect(extractOntologyArchive(archive, target)).rejects.toThrow();
    await expect(fs.access(path.join(directory, 'escaped'))).rejects.toThrow();
    await expect(fs.access(target)).rejects.toThrow();
  });

  it('pins custom script source and runs it after the original file is removed', async () => {
    const source = path.join(directory, 'increment.cjs');
    await fs.writeFile(source, 'let input = ""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.stringify({ result: JSON.parse(input).value + 1 })));');
    snapshot.actions = [
      {
        id: 'increment',
        code: 'increment',
        name: 'Increment',
        displayName: 'Increment',
        description: '',
        displayDescription: '',
        executor: 'custom_script',
        objectIds: [],
        configuration: { command: process.execPath, args: [source] },
        parameters: [{ name: 'value', type: 'number', required: true }],
        outputSchema: [{ name: 'result', type: 'number', description: '' }],
        origin: 'manual',
        status: 'active',
        executionCount: 0,
        updatedAt: 1,
      },
    ];
    const artifact = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    const bindings = path.join(directory, 'script-bindings.json');
    await fs.writeFile(bindings, canonicalJson(artifact.bindings));
    await fs.rm(source);
    expect(await invoke(artifact.directory, ['invoke', 'action.increment'], bindings, { value: 4 })).toMatchObject({ isSuccess: true, data: { result: 5 } });
    const model = await fs.readFile(path.join(artifact.directory, 'ontology/runtime-model.json'), 'utf8');
    expect(model).not.toContain(source);
    expect(model).not.toContain(process.execPath);
  });

  it('keeps action credentials in private bindings without dropping the request template', async () => {
    snapshot.actions = [{ ...snapshot.actions[0], executor: 'api', configuration: { url: 'https://service.example/submit', method: 'POST', body: { apiToken: 'private-action-token', orderId: '{{id}}' } }, parameters: [{ name: 'id', type: 'integer', required: true }] }];
    const artifact = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    expect(artifact.bindings.secrets?.['action:update-order/body/apiToken']).toBe('private-action-token');
    const model = await fs.readFile(path.join(artifact.directory, 'ontology/runtime-model.json'), 'utf8');
    expect(model).not.toContain('private-action-token');
    expect(model).toContain('{{id}}');
    expect(model).toContain('$secret');
  });

  it('detects a changed implementation even if its checksum index was regenerated', async () => {
    const artifact = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    const implementation = artifact.capabilities.find((item) => item.id === 'logic.sales_report')!.implementation!;
    await fs.writeFile(path.join(artifact.directory, implementation.file), 'SELECT 0 AS count');
    await sealPackage(artifact.directory);
    await expect(verifyPackage(artifact.directory)).rejects.toThrow('published digest');
  });

  it('cancels export without overwriting an existing destination', async () => {
    const artifact = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    const target = path.join(directory, 'existing.zip');
    await fs.writeFile(target, 'existing user export');
    const controller = new AbortController();
    controller.abort();
    await expect(exportOntologyArchive(artifact, { targetPath: target, embeddedResourceIds: ['business'], signal: controller.signal })).rejects.toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe('existing user export');
  });

  it('reuses identical scripts after local execution updates usage counters', async () => {
    const original = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    snapshot.logicFunctions[0].executionCount = 20;
    snapshot.logicFunctions[0].lastExecutedAt = Date.now();
    snapshot.logicFunctions[0].updatedAt = Date.now();
    snapshot.actions[0].executionCount = 3;
    snapshot.actions[0].lastExecutedAt = Date.now();
    const repeated = await buildOntologyArtifact(snapshot, { root: path.join(directory, 'artifacts'), cliFile });
    expect(repeated.manifest.runtimeDigest).toBe(original.manifest.runtimeDigest);
    expect(repeated.directory).toBe(original.directory);
  });
});
