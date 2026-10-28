/** Exercise the shared execution adapter in plain Node with the real compiler. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SudographModelClient, type ISudographContext } from '@sudowork/ontology-runtime/SudographModelClient';
import { SudographSourceProvider } from '@sudowork/ontology-runtime/SudographSourceProvider';
import { SudographModelClient as DesktopModelClient } from '../../src/process/services/ontology/SudographModelClient';
import { SudographSourceProvider as DesktopSourceProvider } from '../../src/process/services/ontology/SudographSourceProvider';

const python = process.env.SUDOGRAPH_PYTHON;
const compilerRoot = process.env.SUDOGRAPH_COMPILER_ROOT;
if (!python || !compilerRoot) throw new Error('Set SUDOGRAPH_PYTHON and SUDOGRAPH_COMPILER_ROOT to the checked compiler runtime.');
assert.equal(SudographModelClient, DesktopModelClient, 'Desktop must use the shared implementation.');
assert.equal(SudographSourceProvider, DesktopSourceProvider, 'Desktop must use the shared source provider.');
assert.equal(process.versions.electron, undefined, 'This acceptance must run in ordinary Node.');
const output = process.env.SUDOWORK_REVIEW_LIVE_EVIDENCE || os.tmpdir();
mkdirSync(output, { recursive: true });
const root = mkdtempSync(path.join(output, 'model-runtime-'));
const database = path.join(root, 'source.sqlite');
const created = spawnSync(
  python,
  ['-c', 'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.executescript("CREATE TABLE Tickets(id INTEGER PRIMARY KEY, amount REAL); INSERT INTO Tickets VALUES(1,7),(2,NULL); CREATE VIEW TicketAmounts AS SELECT id,amount FROM Tickets;"); db.close()', database],
  { windowsHide: true }
);
assert.equal(created.status, 0, 'Fixture source creation failed.');
const sourceHash = () => createHash('sha256').update(readFileSync(database)).digest('hex');
const before = sourceHash();
const client = new SudographModelClient({ python, compilerRoot, modelDirectory: root });
const intake = { source: `sqlite:///${database.split(path.sep).join('/')}`, namespace: 'support', operationId: randomUUID(), language: 'en' as const };
const registration = await client.registerSource('model', 'fixture-registrar', intake);
assert.equal(registration.registration.scan.objects, 2);
assert.equal(registration.registration.scan.fields, 4);
assert.deepEqual(registration.registration.records, { delivery: 'live', export_complete: false, rows_embedded: 0 });
assert.deepEqual((await client.registerSource('model', 'fixture-registrar', intake)).registration, registration.registration);
const originalContext = await client.invoke<ISudographContext>('model', 'alice', { operation: 'read', product: 'context' });
const document = {
  format: 'sudograph-business-overlay/v5',
  namespace: 'support',
  baseline: registration.contract.baseline,
  definitions: {
    refund_policy: {
      concept: 'refund policy',
      category: 'meaning',
      role: 'business',
      purpose: { stakeholder: 'Support manager', decision: 'Choose a refund policy' },
      label: 'Unresolved refund policy',
      statement: 'The refund policy needs business discussion.',
      origin: 'inferred',
      contributor: 'model',
      version: 1,
      targets: [],
    },
  },
};
const change = { base_revision: originalContext.revision, operation_id: randomUUID(), model: JSON.stringify(document) };
const edited = await client.invoke<{ revision: string }>('model', 'alice', { operation: 'apply', request: change });
assert.deepEqual(await client.invoke('model', 'alice', { operation: 'apply', request: change }), edited);
const context = await client.invoke<ISudographContext & { inventory: { record_rows_preloaded: number } }>('model', 'alice', { operation: 'read', product: 'context' });
assert.equal(context.revision, edited.revision);
assert.notEqual(context.context_digest, originalContext.context_digest);
assert.equal(context.inventory.record_rows_preloaded, 0);
assert(context.text.includes('Unresolved refund policy'));
const html = await client.invoke<string>('model', 'alice', { operation: 'read', product: 'html' });
assert(html.includes(context.revision));
assert(html.includes('Unresolved refund policy'));
const compiled = await client.invoke<{ source_schema: { sources: Array<{ objects: Array<{ id: string; name: string }> }> } }>('model', 'alice', { operation: 'read', product: 'model' });
const tickets = compiled.source_schema.sources[0].objects.find((object) => object.name === 'Tickets');
assert(tickets);
const read = { revision: context.revision, context_digest: context.context_digest, id: tickets.id, records: true, limit: 1 };
const first = await client.invoke<{ data_kind: string; rows: unknown[][]; total: number }>('model', 'alice', { operation: 'context_read', request: read });
assert.equal(first.data_kind, 'live_source_page');
assert.equal(first.total, 2);
assert.deepEqual(first.rows, [[1, 7]]);
await assert.rejects(client.invoke('model', 'alice', { operation: 'context_read', request: { ...read, context_digest: originalContext.context_digest } }));
await assert.rejects(client.invoke('../another', 'alice', { operation: 'contract' }));
const overview = await client.invoke<{ revision: string; context_digest: string }>('model', 'bob', { operation: 'overview' });
assert.equal(overview.revision, context.revision);
assert.equal(overview.context_digest, context.context_digest);
assert.equal(sourceHash(), before, 'Source registration, model edits and reads must not modify the raw database.');
const updated = spawnSync(python, ['-c', 'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute("UPDATE Tickets SET amount=9 WHERE id=1"); db.commit(); db.close()', database], { windowsHide: true });
assert.equal(updated.status, 0, 'Controlled external source update failed.');
const live = await client.invoke<{ rows: unknown[][] }>('model', 'alice', { operation: 'context_read', request: read });
assert.deepEqual(live.rows, [[1, 9]], 'An on-demand read must observe the source rather than embedded rows.');
const after = await client.invoke<{ revision: string }>('model', 'alice', { operation: 'overview' });
assert.equal(after.revision, context.revision, 'A record read must not manufacture another model revision.');
const receipt = {
  status: 'passed',
  execution: 'ordinary Node with real Python compiler',
  desktop_and_shared_constructor_identical: true,
  desktop_and_shared_source_provider_identical: true,
  source_registration_retry: true,
  same_graph_context_revision: true,
  idempotent_business_edit: true,
  stale_context_refused: true,
  path_escape_refused: true,
  model_operations_preserve_raw_database: true,
  external_source_update_seen_on_demand: true,
  rows_preloaded: 0,
  cloud_tenant_permissions_verified: false,
  revision: context.revision,
};
const evidence = path.join(root, 'receipt.json');
writeFileSync(evidence, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ ...receipt, evidence }));
