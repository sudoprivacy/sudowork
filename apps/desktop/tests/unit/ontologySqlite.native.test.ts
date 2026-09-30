import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OntologyEngine } from '@sudowork/ontology-engine';
import type { IOntologyEnvironmentAsset, IOntologyObjectDraft } from '@sudowork/ontology-common';
import { OntologyService } from '@process/services/ontology/OntologyService';
import type { OntologyStudioDatabase } from '@process/services/ontology/OntologyStudioDatabase';

const isNativeRuntime = !!process.versions.electron;
const runtime = vi.hoisted(() => ({ metadata: new Map<string, any>(), install: vi.fn() }));
vi.mock('@process/services/ontology/OntologyStudioDatabase', () => ({ OntologyStudioDatabase: class {} }));
vi.mock('@/agent/acp/AcpConnection', () => ({ AcpConnection: class {} }));
vi.mock('@/agent/acp/AcpDetector', () => ({ acpDetector: { refreshCustomAgents: async () => {} } }));
vi.mock('@process/services/ontology/OntologyMcpRegistration', () => ({ installOntologyMcpServer: runtime.install, removeOntologyMcpServer: async () => {} }));
vi.mock('@process/AssistantManager', () => ({
  assistantManager: {
    getAssistantMetaWithDir: async (id: string) => (runtime.metadata.has(id) ? { meta: runtime.metadata.get(id), category: 'custom' } : null),
    createAssistant: async (meta: any) => {
      runtime.metadata.set(meta.id, { ...meta });
      return { success: true };
    },
    enableAssistant: async (id: string) => {
      runtime.metadata.get(id).enabled = true;
      return { success: true };
    },
    disableAssistant: async (id: string) => {
      if (runtime.metadata.has(id)) runtime.metadata.get(id).enabled = false;
      return { success: true };
    },
    uninstallAssistant: async (id: string) => {
      runtime.metadata.delete(id);
      return { success: true };
    },
  },
}));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '', getPath: () => os.tmpdir(), getName: () => 'sqlite-test', getVersion: () => 'test', on: () => {}, once: () => {} }, safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: vi.fn() }));

it.skipIf(isNativeRuntime)(
  'verifies SQLite with the desktop Electron native driver',
  async (context) => {
    const require = createRequire(import.meta.url);
    let electron: string;
    try {
      electron = require('electron') as string;
      await fs.access(electron);
    } catch {
      context.skip('Electron runtime is required for the native SQLite integration test');
      return;
    }
    const cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
    const { stdout } = await promisify(execFile)(electron, [cli, 'run', 'tests/unit/ontologySqlite.native.test.ts', '--maxWorkers=1'], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(stdout).toContain('SQLITE_NATIVE_VERIFIED');
  },
  100_000
);

describe.runIf(isNativeRuntime)('SQLite business ingestion with the real driver', () => {
  let directory: string;
  let source: string;
  let store: OntologyStudioDatabase;
  let service: OntologyService;
  let workspaceId: string;
  let assets: IOntologyEnvironmentAsset[];
  let connectorId: string;
  beforeEach(async () => {
    runtime.metadata.clear();
    runtime.install.mockReset().mockResolvedValue(undefined);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-sqlite-business-'));
    source = path.join(directory, 'commerce 数据#source.sqlite');
    const db = new BetterSqlite3(source);
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), status TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE order_lines (order_id INTEGER NOT NULL REFERENCES orders(id), line_no INTEGER NOT NULL, product_id INTEGER REFERENCES products(id), quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, total_cents INTEGER GENERATED ALWAYS AS (quantity * unit_price_cents) STORED, PRIMARY KEY(order_id, line_no)) WITHOUT ROWID;
      CREATE VIEW order_totals AS SELECT order_id, SUM(total_cents) AS total_cents FROM order_lines GROUP BY order_id;
      CREATE TABLE empty_records (id INTEGER PRIMARY KEY, note TEXT);
      CREATE TABLE big_ids (id INTEGER PRIMARY KEY, payload BLOB, note TEXT);
      INSERT INTO big_ids VALUES (9223372036854775807, x'0001ff', NULL);
      CREATE TABLE "audit ""records" ("编号" INTEGER PRIMARY KEY, "value" TEXT);
      INSERT INTO "audit ""records" VALUES (1, 'quoted name');
    `);
    db.transaction(() => {
      for (let i = 1; i <= 150; i++) db.prepare('INSERT INTO customers VALUES (?, ?)').run(i, `Customer ${i}`);
      db.prepare('INSERT INTO products VALUES (1, ?, 1250)').run('Coffee');
      for (let i = 1; i <= 240; i++) {
        db.prepare('INSERT INTO orders(id, customer_id) VALUES (?, ?)').run(i, ((i - 1) % 150) + 1);
        db.prepare('INSERT INTO order_lines(order_id,line_no,product_id,quantity,unit_price_cents) VALUES (?,1,1,2,1250)').run(i);
      }
    })();
    db.close();
    const actual = await vi.importActual<typeof import('@process/services/ontology/OntologyStudioDatabase')>('@process/services/ontology/OntologyStudioDatabase');
    store = new actual.OntologyStudioDatabase(path.join(directory, 'workbench'));
    service = new OntologyService(store, new OntologyEngine(store));
    workspaceId = (await service.createWorkbench({ name: 'Commerce', code: 'commerce' })).snapshot.workspaceId;
    const connected = await service.probeConnector({ workspaceId, connector: { name: 'Commerce SQLite', sourceType: 'sqlite', kind: 'database', path: source, writable: false } });
    assets = connected.assets;
    connectorId = connected.connector.id;
  });
  afterEach(async () => {
    store?.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const asset = (name: string) => assets.find((item) => item.name === name)!;
  const fingerprint = async () =>
    createHash('sha256')
      .update(await fs.readFile(source))
      .digest('hex');
  async function mappedObject(table: string, names: string[]): Promise<IOntologyObjectDraft> {
    const data = asset(table);
    let snapshot = await service.upsertObject({ workspaceId, name: table, code: table, sourceAssetIds: [data.id] });
    const objectId = snapshot.objects.find((item) => item.code === table)!.id;
    for (const name of names) {
      snapshot = await service.upsertAttribute({ workspaceId, objectId, name, code: name, dataType: name === 'name' || name === 'status' ? 'string' : 'number', required: name === 'id', mappedField: { assetId: data.id, fieldName: name } });
    }
    return snapshot.objects.find((item) => item.id === objectId)!;
  }

  it('discovers tables, views, generated fields, composite primary keys and foreign keys', () => {
    expect(assets.map((item) => item.name)).toContain('order_totals');
    expect(asset('order_lines').fields.find((field) => field.name === 'total_cents')).toMatchObject({ isGenerated: true });
    expect(asset('order_lines').fields.find((field) => field.name === 'line_no')).toMatchObject({ isPrimaryKey: true, primaryKeyPosition: 2, nullable: false });
    expect(asset('orders').fields.find((field) => field.name === 'customer_id')?.references).toEqual([expect.objectContaining({ table: 'customers', field: 'id' })]);
    expect(asset('orders').fields.find((field) => field.name === 'status')?.defaultValue).toBe("'pending'");
    expect(asset('audit "records').fields.map((field) => field.name)).toEqual(['编号', 'value']);
  });

  it('previews empty tables and views and preserves 64-bit IDs, BLOBs and NULLs', async () => {
    await expect(service.previewAsset({ workspaceId, id: asset('empty_records').id, limit: 100 })).resolves.toMatchObject({ columns: ['id', 'note'], rows: [] });
    const totals = await service.previewAsset({ workspaceId, id: asset('order_totals').id, limit: 100 });
    expect(totals.rows).toHaveLength(100);
    expect(totals.truncated).toBe(true);
    expect(totals.rows[0]).toEqual([1, 2500]);
    await expect(service.previewAsset({ workspaceId, id: asset('big_ids').id })).resolves.toMatchObject({ rows: [['9223372036854775807', 'AAH/', null]] });
    await expect(service.previewAsset({ workspaceId, id: asset('audit "records').id })).resolves.toMatchObject({ rows: [[1, 'quoted name']] });
  });

  it('finds a mapped business record beyond the 100-row preview window', async () => {
    const object = await mappedObject('customers', ['id', 'name']);
    const fn = store.getSnapshot(workspaceId)!.logicFunctions.find((item) => item.configuration.builtIn === 'lookup' && item.objectIds.includes(object.id))!;
    const result = await service.executeLogicFunction({ workspaceId, id: fn.id, arguments: { query: { id: 149 } } });
    expect(result.execution.output).toEqual([{ id: 149, name: 'Customer 149' }]);
    const big = await mappedObject('big_ids', ['id', 'note']);
    const bigFn = store.getSnapshot(workspaceId)!.logicFunctions.find((item) => item.configuration.builtIn === 'lookup' && item.objectIds.includes(big.id))!;
    const bigResult = await service.executeLogicFunction({ workspaceId, id: bigFn.id, arguments: { query: { id: '9223372036854775807' } } });
    expect(bigResult.execution.output).toEqual([{ id: '9223372036854775807', note: null }]);
  });

  it('queries a SQLite relation beyond the preview window in both directions', async () => {
    const customer = await mappedObject('customers', ['id', 'name']);
    const order = await mappedObject('orders', ['id', 'customer_id', 'status']);
    const snapshot = await service.upsertRelation({
      workspaceId,
      name: 'places',
      code: 'places',
      fromObjectId: customer.id,
      toObjectId: order.id,
      cardinality: 'one_to_many',
      relationType: 'object_property',
      isAcyclic: false,
      dataBinding: { mode: 'direct', joinKeys: [{ fromAttributeId: customer.attributes.find((item) => item.code === 'id')!.id, toAttributeId: order.attributes.find((item) => item.code === 'customer_id')!.id }] },
    });
    const relation = snapshot.relations.find((item) => item.code === 'places')!;
    const forward = await service.executeRelation({ workspaceId, id: relation.id, arguments: { query: { id: 149 } } });
    expect(forward.execution.output).toMatchObject({ totalMatches: 1, rows: [expect.objectContaining({ target: expect.objectContaining({ id: 149 }) })] });
    const reverse = await service.executeRelation({ workspaceId, id: relation.id, arguments: { direction: 'reverse', query: { id: 240 } } });
    expect(reverse.execution.output).toMatchObject({ totalMatches: 1, rows: [expect.objectContaining({ target: expect.objectContaining({ id: 90 }) })] });
    await service.upsertRelation({ ...relation, workspaceId, cardinality: 'one_to_one' });
    const check = await service.runConsistencyCheck({ workspaceId });
    expect(check.isValid).toBe(false);
    expect(check.issues).toEqual(expect.arrayContaining([expect.objectContaining({ targetId: relation.id, message: expect.stringContaining('90') })]));
  });

  it('executes many-to-many joins through SQLite junction tables with accurate totals', async () => {
    const order = await mappedObject('orders', ['id', 'customer_id', 'status']);
    const product = await mappedObject('products', ['id', 'name']);
    const snapshot = await service.upsertRelation({
      workspaceId,
      name: 'contains',
      code: 'contains',
      fromObjectId: order.id,
      toObjectId: product.id,
      cardinality: 'many_to_many',
      relationType: 'object_property',
      isAcyclic: false,
      dataBinding: {
        mode: 'junction',
        junctionAssetId: asset('order_lines').id,
        joinKeys: [{ fromAttributeId: order.attributes.find((item) => item.code === 'id')!.id, toAttributeId: product.attributes.find((item) => item.code === 'id')!.id, junctionFromFieldName: 'order_id', junctionToFieldName: 'product_id' }],
      },
    });
    const relation = snapshot.relations.find((item) => item.code === 'contains')!;
    const forward = await service.executeRelation({ workspaceId, id: relation.id, arguments: { query: { id: 240 } } });
    expect(forward.execution.output).toMatchObject({ totalMatches: 1, rows: [expect.objectContaining({ target: { id: 1, name: 'Coffee' } })] });
    const reverse = await service.executeRelation({ workspaceId, id: relation.id, arguments: { direction: 'reverse', query: { id: 1 }, limit: 3 } });
    expect(reverse.execution.output).toMatchObject({ totalMatches: 240, isTruncated: true });
    expect((reverse.execution.output as { rows: unknown[] }).rows).toHaveLength(3);
  });

  it('executes a full-dataset CTE report, publishes it, and runs the pinned version without changing source data', async () => {
    const before = await fingerprint();
    const order = await mappedObject('orders', ['id', 'customer_id', 'status']);
    const snapshot = await service.upsertLogicFunction({
      workspaceId,
      code: 'sales_report',
      name: 'Sales report',
      description: 'All orders',
      runtime: 'sql',
      body: "WITH totals AS (SELECT SUM(total_cents) AS cents FROM order_lines) SELECT cents, ';' AS marker FROM totals",
      objectIds: [order.id],
      signature: 'sales_report()',
      returnType: 'Rows',
      status: 'active',
      parameters: [],
      configuration: { connectorId },
    });
    const fn = snapshot.logicFunctions.find((item) => item.code === 'sales_report')!;
    const report = await service.executeLogicFunction({ workspaceId, id: fn.id });
    expect(report.execution.output).toEqual([{ cents: 600000, marker: ';' }]);
    const candidate = await service.publishCurrentDraft({ workspaceId });
    await service.approvePublishedVersion({ workspaceId, versionId: candidate.version.id });
    await service.upsertLogicFunction({ ...fn, workspaceId, body: 'SELECT 999 AS cents' });
    const pinned = await service.executeLogicFunction({ workspaceId, versionId: candidate.version.id, id: fn.id });
    expect(pinned.execution.output).toEqual([{ cents: 600000, marker: ';' }]);
    const blueprint = await service.createAgentBlueprint({ workspaceId, ontologyVersionId: candidate.version.id, name: 'Commerce agent' });
    const registered = await service.registerAgentBlueprint({ workspaceId, blueprintId: blueprint.blueprint.id });
    expect(registered.blueprint.status).toBe('registered');
    expect(runtime.install).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, versionId: candidate.version.id }));
    expect(await fingerprint()).toBe(before);
    console.log('SQLITE_NATIVE_VERIFIED');
  });

  it('rejects missing or invalid files without creating a replacement database', async () => {
    const missing = path.join(directory, 'missing.db');
    await expect(service.probeConnector({ workspaceId, connector: { name: 'Missing', sourceType: 'sqlite', kind: 'database', path: missing } })).rejects.toThrow();
    await expect(fs.stat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
    const invalid = path.join(directory, 'invalid.db');
    await fs.writeFile(invalid, 'not a database');
    await expect(service.probeConnector({ workspaceId, connector: { name: 'Invalid', sourceType: 'sqlite', kind: 'database', path: invalid } })).rejects.toThrow();
    expect(store.getSnapshot(workspaceId)!.connectors).toHaveLength(1);
  });

  it('rescans new tables without duplicating identities and marks removed sources until restored', async () => {
    const initial = store.getSnapshot(workspaceId)!;
    const customer = initial.assets.find((item) => item.name === 'customers')!;
    customer.fields[0].businessMeaning = { text: 'Customer identifier', isUncertain: false, language: 'en-US', generatedAt: 1 };
    store.saveSnapshot(initial);
    const connection = initial.connectors.find((item) => item.id === connectorId)!;
    const db = new BetterSqlite3(source);
    db.exec('CREATE TABLE shipments (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id)); DROP TABLE empty_records;');
    const rescanned = await service.probeConnector({ workspaceId, connector: connection });
    expect(rescanned.snapshot.connectors).toHaveLength(1);
    expect(rescanned.assets.find((item) => item.name === 'customers')?.id).toBe(customer.id);
    expect(rescanned.assets.find((item) => item.name === 'customers')?.fields[0].businessMeaning?.text).toBe('Customer identifier');
    expect(rescanned.assets.some((item) => item.name === 'shipments')).toBe(true);
    const removed = rescanned.snapshot.assets.find((item) => item.name === 'empty_records')!;
    expect(removed.metadata.sourceMissing).toBe(true);
    db.exec('CREATE TABLE empty_records (id INTEGER PRIMARY KEY, note TEXT, created_at TEXT)');
    db.close();
    const restored = await service.syncAssetSchema({ workspaceId, id: removed.id });
    expect(restored.assets.find((item) => item.id === removed.id)).toMatchObject({ metadata: { sourceMissing: false }, fields: expect.arrayContaining([expect.objectContaining({ name: 'created_at' })]) });
  });

  it('keeps two connections to the same file independent without duplicate asset IDs', async () => {
    const second = await service.probeConnector({ workspaceId, connector: { name: 'Second view', sourceType: 'sqlite', kind: 'database', path: source, writable: false } });
    const ids = second.snapshot.assets.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.assets.find((item) => item.name === 'customers')?.id).not.toBe(asset('customers').id);
    expect(second.snapshot.assets.find((item) => item.id === asset('customers').id)?.metadata.connectorId).toBe(connectorId);
  });

  it('reads current committed WAL data and does not expose internal virtual-table storage', async () => {
    const db = new BetterSqlite3(source);
    db.pragma('journal_mode = WAL');
    db.exec("INSERT INTO empty_records VALUES(1, 'WAL record'); CREATE VIRTUAL TABLE search_notes USING fts5(content);");
    await expect(service.previewAsset({ workspaceId, id: asset('empty_records').id })).resolves.toMatchObject({ rows: [[1, 'WAL record']] });
    const connection = store.getSnapshot(workspaceId)!.connectors[0];
    const result = await service.probeConnector({ workspaceId, connector: connection });
    expect(result.assets.find((item) => item.name === 'search_notes')?.fields.map((field) => field.name)).toEqual(['content']);
    expect(result.assets.some((item) => item.name === 'search_notes_data')).toBe(false);
    db.close();
  });

  it('honors SQLite primary-key nullability and includes virtual generated columns', async () => {
    const db = new BetterSqlite3(source);
    db.exec('CREATE TABLE compound_rowid (a TEXT, b TEXT, PRIMARY KEY(a,b)); CREATE TABLE integer_desc (id INTEGER PRIMARY KEY DESC); CREATE TABLE generated_virtual (quantity INTEGER, doubled INTEGER AS (quantity * 2) VIRTUAL);');
    db.close();
    const result = await service.probeConnector({ workspaceId, connector: store.getSnapshot(workspaceId)!.connectors[0] });
    expect(result.assets.find((item) => item.name === 'compound_rowid')?.fields.map((field) => field.nullable)).toEqual([true, true]);
    expect(result.assets.find((item) => item.name === 'integer_desc')?.fields[0].nullable).toBe(true);
    expect(result.assets.find((item) => item.name === 'generated_virtual')?.fields[1].isGenerated).toBe(true);
  });

  it('requires explicit writable authorization for actions and enforces foreign keys and single statements', async () => {
    const order = await mappedObject('orders', ['id', 'customer_id', 'status']);
    const connection = store.getSnapshot(workspaceId)!.connectors[0];
    await service.probeConnector({ workspaceId, connector: { ...connection, writable: true } });
    const snapshot = await service.upsertAction({ workspaceId, name: 'Set status', code: 'set_status', executor: 'sql', objectIds: [order.id], status: 'active', configuration: { connectorId, statement: 'UPDATE orders SET status = {{status}} WHERE id = {{id}}' } });
    const action = snapshot.actions.find((item) => item.code === 'set_status')!;
    await service.probeConnector({ workspaceId, connector: { ...connection, writable: false } });
    await expect(service.executeAction({ workspaceId, id: action.id, arguments: { id: 1, status: 'paid' } })).rejects.toThrow();
    const db = new BetterSqlite3(source);
    expect(db.prepare('SELECT status FROM orders WHERE id=1').get()).toEqual({ status: 'pending' });
    await service.probeConnector({ workspaceId, connector: { ...connection, writable: true } });
    const updated = await service.executeAction({ workspaceId, id: action.id, arguments: { id: 1, status: 'paid' } });
    expect(updated.execution.output).toMatchObject({ changes: 1 });
    expect(db.prepare('SELECT status FROM orders WHERE id=1').get()).toEqual({ status: 'paid' });
    await service.upsertAction({ ...action, workspaceId, configuration: { connectorId, statement: 'UPDATE orders SET customer_id=999999 WHERE id=1' } });
    await expect(service.executeAction({ workspaceId, id: action.id })).rejects.toThrow(/FOREIGN KEY/);
    await service.upsertAction({ ...action, workspaceId, configuration: { connectorId, statement: "UPDATE orders SET status='bad' WHERE id=1; DELETE FROM orders" } });
    await expect(service.executeAction({ workspaceId, id: action.id })).rejects.toThrow(/more than one statement/);
    expect(db.prepare('SELECT status, customer_id FROM orders WHERE id=1').get()).toEqual({ status: 'paid', customer_id: 1 });
    db.close();
  });
});
