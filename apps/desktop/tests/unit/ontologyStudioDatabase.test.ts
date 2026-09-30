import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/** Use the platform SQLite engine without loading an Electron-ABI native addon into Vitest. */
describe('ontology studio persistence', () => {
  it('atomically persists semantic documents, checks revisions, deduplicates operations and scopes sessions', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-studio-store-'));
    const output = path.join(directory, 'verify.cjs');
    const storeSource = path.resolve(__dirname, '../../src/process/services/ontology/OntologyStudioDatabase.ts');
    const commonSource = path.resolve(__dirname, '../../../../packages/ontology-common/src/index.ts');
    try {
      await build({
        stdin: {
          resolveDir: path.resolve(__dirname, '../..'),
          contents: `
        const assert = require('node:assert/strict');
        const { OntologyStudioDatabase } = require(${JSON.stringify(storeSource)});
        const { createDefaultOntologyWorkbenchSnapshot, OWL_NS } = require(${JSON.stringify(commonSource)});
        const store = new OntologyStudioDatabase(${JSON.stringify(directory)});
        const initial = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'a', title: 'A' });
        store.saveSnapshot(initial);
        assert.equal(initial.revision, 0);
        const second = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'b', title: 'B' });
        store.saveSnapshot(second);
        const edited = store.getSnapshot('a');
        edited.objects.push({ id: 'object', code: 'order', name: '订单', description: '', tier: 1, status: 'active', sourceAssetIds: [], attributes: [], reviewDecision: 'pending', updatedAt: 2 });
        store.saveSnapshot(edited, initial, { id: 'change-1', payload: 'create object' });
        assert.equal(edited.revision, 1);
        assert.ok(edited.objects[0].iri);
        assert.ok(edited.semanticDocument.statements.some(item => item.object.value === OWL_NS + 'Class'));
        assert.equal(store.getSnapshot('b').objects.length, 0);
        assert.throws(() => store.saveSnapshot({ ...initial, draft: { ...initial.draft, title: 'stale' } }), /conflict/);
        const retry = structuredClone(initial);
        store.saveSnapshot(retry, initial, { id: 'change-1', payload: 'create object' });
        assert.equal(retry.revision, 1);
        assert.equal(retry.objects.length, 1);
        assert.throws(() => store.hasOperation('a', { id: 'change-1', payload: 'different request' }), /operationConflict/);
        const metadata = store.getSnapshot('a');
        metadata.objects[0].updatedAt = 99;
        store.saveSnapshot(metadata);
        assert.equal(metadata.revision, 1);
        store.createAiSession({ id: 'session', workspace_id: 'a', conversation_id: 'chat', title: 'Build', created_at: 1, updated_at: 1 });
        assert.equal(store.listAiSessions('a').length, 1);
        assert.equal(store.listAiSessions('b').length, 0);
        const agents = store.getSnapshot('a');
        agents.agentBlueprints = [{ id: 'blueprint', ontologyVersionId: 'version', status: 'draft' }];
        store.saveSnapshot(agents);
        const duplicate = store.getSnapshot('a');
        duplicate.agentBlueprints.push({ id: 'duplicate', ontologyVersionId: 'version', status: 'draft' });
        assert.throws(() => store.saveSnapshot(duplicate), /duplicate/);
        const changedIdentity = store.getSnapshot('a');
        changedIdentity.agentBlueprints[0].id = 'replacement';
        assert.throws(() => store.saveSnapshot(changedIdentity), /identityConflict/);
        const staleAgents = store.getSnapshot('a');
        const registering = store.getSnapshot('a');
        registering.agentBlueprints[0].status = 'registering';
        registering.agentBlueprints[0].registeredAssistantId = 'agent-id';
        store.saveSnapshot(registering);
        assert.throws(() => store.saveSnapshot(staleAgents), /conflict/);
        store.close();
        const reopened = new OntologyStudioDatabase(${JSON.stringify(directory)});
        assert.equal(reopened.getSnapshot('a').objects[0].name, '订单');
        assert.equal(reopened.getAiSessionByConversationId('chat').workspace_id, 'a');
        const credentials = reopened.getSnapshot('a');
        credentials.connectors.push({ password: 'not-plaintext' });
        assert.throws(() => reopened.saveSnapshot(credentials), /credentialStorage/);
        assert.equal(reopened.getSnapshot('a').connectors.length, 0);
        reopened.resetSnapshot('a');
        assert.equal(reopened.getSnapshot('a').agentBlueprints.length, 0);
        reopened.deleteSnapshot('a');
        assert.equal(reopened.getSnapshot('a'), null);
        assert.throws(() => reopened.saveSnapshot(metadata), /notFound/);
        assert.equal(reopened.listAiSessions().length, 0);
        assert.equal(reopened.getSnapshot('b').draft.title, 'B');
        reopened.close();
        console.log('studio persistence passed');
      `,
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: output,
        plugins: [
          {
            name: 'test-platform',
            setup(context) {
              context.onResolve({ filter: /^@sudowork\/ontology-common$/ }, () => ({ path: commonSource }));
              context.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: 'sqlite', namespace: 'sqlite' }));
              context.onLoad({ filter: /.*/, namespace: 'sqlite' }, () => ({
                contents: `const { DatabaseSync } = require('node:sqlite'); module.exports = class { constructor(file) { this.db = new DatabaseSync(file); } prepare(sql) { return this.db.prepare(sql); } exec(sql) { return this.db.exec(sql); } pragma(sql) { this.db.exec('PRAGMA ' + sql); } close() { this.db.close(); } transaction(fn) { return (...args) => { this.db.exec('BEGIN'); try { const result = fn(...args); this.db.exec('COMMIT'); return result; } catch(error) { this.db.exec('ROLLBACK'); throw error; } }; } };`,
              }));
              context.onResolve({ filter: /^(electron|@process\/utils)$/ }, (args) => ({ path: args.path, namespace: 'platform' }));
              context.onLoad({ filter: /.*/, namespace: 'platform' }, () => ({ contents: `export const getDataPath=()=>${JSON.stringify(directory)}; export const safeStorage={isEncryptionAvailable:()=>false};` }));
            },
          },
        ],
      });
      const { stdout } = await promisify(execFile)(process.execPath, [output], { timeout: 15_000 });
      expect(stdout).toContain('studio persistence passed');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
