import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyAssetField, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import { OntologyEngine } from '@sudowork/ontology-engine';
import { OntologyService } from '@process/services/ontology/OntologyService';
import type { OntologyStudioDatabase } from '@process/services/ontology/OntologyStudioDatabase';

const drivers = vi.hoisted(() => ({ postgresQuery: vi.fn(), mysqlQuery: vi.fn() }));
vi.mock('@process/services/ontology/OntologyStudioDatabase', () => ({ OntologyStudioDatabase: class {} }));
vi.mock('@/agent/acp/AcpConnection', () => ({ AcpConnection: class {} }));
// Use the platform SQLite engine without replacing the application's Electron native addon.
vi.mock('better-sqlite3', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return {
    default: class {
      private db: InstanceType<typeof DatabaseSync>;
      constructor(file: string, options?: { readonly?: boolean }) {
        this.db = new DatabaseSync(file, { readOnly: options?.readonly });
      }
      prepare(sql: string) {
        const statement = this.db.prepare(sql);
        const wrapper = {
          all: (...args: any[]) => statement.all(...args),
          get: (...args: any[]) => statement.get(...args),
          run: (...args: any[]) => statement.run(...args),
          columns: () => statement.columns(),
          safeIntegers: (isEnabled = true) => {
            statement.setReadBigInts(isEnabled);
            return wrapper;
          },
        };
        return wrapper;
      }
      pragma(sql: string) {
        return this.db.prepare(`PRAGMA ${sql}`).all();
      }
      exec(sql: string) {
        this.db.exec(sql);
      }
      close() {
        this.db.close();
      }
      transaction(run: () => void) {
        return () => {
          this.db.exec('BEGIN');
          try {
            run();
            this.db.exec('COMMIT');
          } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
          }
        };
      }
    },
  };
});
vi.mock('pg', () => ({
  Client: class {
    connect = vi.fn();
    end = vi.fn();
    query = drivers.postgresQuery;
  },
}));
vi.mock('mysql2/promise', () => ({ default: { createConnection: async () => ({ query: drivers.mysqlQuery, end: vi.fn() }) } }));

class Repository {
  snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'data', title: 'Order management' });
  getSnapshot(id: string) {
    return id === this.snapshot.workspaceId ? structuredClone(this.snapshot) : null;
  }
  saveSnapshot(snapshot: IOntologyWorkbenchSnapshot, expected?: IOntologyWorkbenchSnapshot) {
    if (expected && !isDeepStrictEqual(this.snapshot, expected)) throw new Error('conflict');
    this.snapshot = structuredClone(snapshot);
  }
  listSnapshots() {
    return [this.getSnapshot('data')!];
  }
  deleteSnapshot() {}
  resetSnapshot() {}
  getActiveWorkspaceId() {
    return 'data';
  }
}

let repository: Repository;
let service: OntologyService;
let directory: string;
const describeFields = vi.fn();
const meaning = { text: 'Business identifier', isUncertain: true, language: 'zh-CN', generatedAt: 1 };
beforeEach(async () => {
  vi.clearAllMocks();
  repository = new Repository();
  describeFields.mockReset().mockImplementation(async ({ fields }: { fields: IOntologyAssetField[] }) => fields.map((field) => ({ ...field, businessMeaning: { ...meaning, text: `Meaning of ${field.name}` } })));
  service = new OntologyService(repository as unknown as OntologyStudioDatabase, new OntologyEngine(repository), undefined, describeFields);
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-data-'));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

async function sqliteFixture() {
  const filePath = path.join(directory, 'fixture.sqlite');
  const db = new BetterSqlite3(filePath);
  db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL)');
  db.close();
  const result = await service.probeConnector({ workspaceId: 'data', connector: { name: 'Orders database', sourceType: 'sqlite', kind: 'database', path: filePath } });
  return { filePath, id: result.assets[0].id };
}

describe('ontology table preview and schema synchronization', () => {
  it('returns real column headers for an empty SQLite table and caps populated previews at 100 rows', async () => {
    const { filePath, id } = await sqliteFixture();
    await expect(service.previewAsset({ workspaceId: 'data', id, limit: 100 })).resolves.toMatchObject({ columns: ['id', 'amount'], rows: [], rowsReturned: 0, truncated: false });
    const db = new BetterSqlite3(filePath);
    const insert = db.prepare('INSERT INTO orders (amount) VALUES (?)');
    db.transaction(() => {
      for (let index = 0; index < 120; index++) insert.run(index);
    })();
    db.close();
    const preview = await service.previewAsset({ workspaceId: 'data', id, limit: 1000 });
    expect(preview.rows).toHaveLength(100);
    expect(preview.truncated).toBe(true);
  });

  it('reads changed schema, preserves meanings for unchanged fields, and reports a missing table', async () => {
    const { filePath, id } = await sqliteFixture();
    repository.snapshot.assets[0].fields[0].businessMeaning = meaning;
    const db = new BetterSqlite3(filePath);
    db.exec('ALTER TABLE orders ADD COLUMN created_at TEXT');
    const updated = await service.syncAssetSchema({ workspaceId: 'data', id });
    expect(updated.assets[0].fields.map((field) => field.name)).toEqual(['id', 'amount', 'created_at']);
    expect(updated.assets[0].fields[0].businessMeaning).toEqual(meaning);
    expect(updated.assets[0].metadata.schemaSyncedAt).toEqual(expect.any(Number));
    db.exec('DROP TABLE orders');
    db.close();
    await expect(service.syncAssetSchema({ workspaceId: 'data', id })).rejects.toThrow('ontology.studio.dataErrors.schemaUnavailable');
    expect(repository.snapshot.assets[0].fields).toHaveLength(3);
  });

  it('loads PostgreSQL source comments and only scans the selected table during sync', async () => {
    drivers.postgresQuery.mockImplementation(async (query: string) => {
      if (query.includes('information_schema.tables')) return { rows: [{ table_name: 'orders', table_type: 'BASE TABLE' }] };
      if (query.includes('information_schema.columns')) return { rows: [{ column_name: 'id', data_type: 'integer', is_nullable: 'NO', description: 'Order identifier from the source' }] };
      return { rows: [], fields: [{ name: 'id' }] };
    });
    const result = await service.probeConnector({ workspaceId: 'data', connector: { name: 'PG', sourceType: 'postgresql', kind: 'database', host: 'localhost', database: 'orders' } });
    const id = result.assets[0].id;
    expect(result.assets[0].fields[0].description).toBe('Order identifier from the source');
    drivers.postgresQuery.mockClear();
    await service.syncAssetSchema({ workspaceId: 'data', id });
    expect(drivers.postgresQuery.mock.calls[0]).toEqual([expect.stringContaining('table_name = $3'), ['public', 1000, 'orders']]);
    expect(drivers.postgresQuery.mock.calls[1][0]).toContain('col_description');
    await expect(service.previewAsset({ workspaceId: 'data', id, limit: 100 })).resolves.toMatchObject({ columns: ['id'], rows: [] });
  });

  it('uses MySQL result metadata for empty tables and parameterizes the selected table', async () => {
    drivers.mysqlQuery.mockImplementation(async (query: string) => {
      if (query.includes('information_schema.TABLES')) return [[{ tableName: 'orders', tableType: 'BASE TABLE' }], []];
      if (query.includes('information_schema.COLUMNS')) return [[{ fieldName: 'id', dataType: 'bigint', isNullable: 'NO', description: 'Order ID' }], []];
      return [[], [{ name: 'id' }]];
    });
    const result = await service.probeConnector({ workspaceId: 'data', connector: { name: 'MySQL', sourceType: 'mysql', kind: 'database', host: 'localhost', database: 'orders' } });
    const id = result.assets[0].id;
    drivers.mysqlQuery.mockClear();
    await service.syncAssetSchema({ workspaceId: 'data', id });
    expect(drivers.mysqlQuery.mock.calls[0]).toEqual([expect.stringContaining('AND TABLE_NAME = ?'), ['orders', 'orders', 1000]]);
    await expect(service.previewAsset({ workspaceId: 'data', id, limit: 100 })).resolves.toMatchObject({ columns: ['id'], rows: [] });
  });
});

describe('persisted ontology field meanings', () => {
  const input = { workspaceId: 'data', id: 'table', language: 'zh-CN' };
  beforeEach(() => {
    repository.snapshot.assets = [
      {
        id: 'table',
        name: 'orders',
        kind: 'table',
        fields: [
          { name: 'id', dataType: 'integer', description: 'Original source comment' },
          { name: 'status', dataType: 'text' },
        ],
        metadata: {},
        profileStatus: 'ready',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
  });

  it('fills all fields while preserving source descriptions and reuses saved meanings', async () => {
    const result = await service.describeAssetFields(input);
    expect(result.assets[0].fields.every((field) => field.businessMeaning?.text)).toBe(true);
    expect(result.assets[0].fields[0].description).toBe('Original source comment');
    await service.describeAssetFields(input);
    expect(describeFields).toHaveBeenCalledTimes(1);
    await service.describeAssetFields({ ...input, isRefresh: true });
    expect(describeFields).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous analysis requests', async () => {
    await Promise.all([service.describeAssetFields(input), service.describeAssetFields(input)]);
    expect(describeFields).toHaveBeenCalledTimes(1);
  });

  it('retains unrelated changes made while the model is running', async () => {
    describeFields.mockImplementationOnce(async ({ fields }: { fields: IOntologyAssetField[] }) => {
      repository.snapshot.draft.description = 'Concurrent human edit';
      return fields.map((field) => ({ ...field, businessMeaning: meaning }));
    });
    await service.describeAssetFields(input);
    expect(repository.snapshot.draft.description).toBe('Concurrent human edit');
  });

  it('discards stale explanations when the source schema changes during analysis', async () => {
    describeFields.mockImplementationOnce(async ({ fields }: { fields: IOntologyAssetField[] }) => {
      repository.snapshot.assets[0].fields[0].dataType = 'text';
      return fields.map((field) => ({ ...field, businessMeaning: meaning }));
    });
    await expect(service.describeAssetFields(input)).rejects.toThrow('ontology.studio.dataErrors.schemaChanged');
    expect(repository.snapshot.assets[0].fields[0].businessMeaning).toBeUndefined();
    await expect(service.describeAssetFields(input)).resolves.toBeDefined();
  });

  it('invalidates only changed or new fields on schema refresh', async () => {
    await service.describeAssetFields(input);
    const previous = repository.snapshot.assets[0];
    await new OntologyEngine(repository).syncAssetSchema({ id: 'table' }, 'data', {
      ...previous,
      fields: [
        { ...previous.fields[0], businessMeaning: undefined },
        { name: 'status', dataType: 'integer' },
        { name: 'created_at', dataType: 'timestamp' },
      ],
    });
    expect(repository.snapshot.assets[0].fields.map((field) => !!field.businessMeaning)).toEqual([true, false, false]);
    await service.describeAssetFields(input);
    expect(describeFields.mock.lastCall?.[0].fields.map((field: IOntologyAssetField) => field.name)).toEqual(['status', 'created_at']);
  });
});
