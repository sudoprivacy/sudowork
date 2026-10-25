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
        const { DatabaseSync } = require('node:sqlite');
        const legacy = new DatabaseSync(${JSON.stringify(path.join(directory, 'studio.db'))});
        legacy.exec('CREATE TABLE studio_workspaces (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE studio_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE, conversation_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
        legacy.prepare('INSERT INTO studio_workspaces VALUES (?, ?, ?, ?)').run('legacy', 0, JSON.stringify(createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'legacy' })), 1);
        legacy.prepare('INSERT INTO studio_sessions VALUES (?, ?, ?, ?, ?, ?)').run('legacy-session', 'legacy', 'legacy-chat', 'Existing chat', 1, 1);
        legacy.close();
        const store = new OntologyStudioDatabase(${JSON.stringify(directory)});
        assert.equal(store.getAiSessionByConversationId('legacy-chat').workspace_id, 'legacy');
        assert.equal(store.getProject('legacy').authority, 'rdf');
        const initial = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'a', title: 'A' });
        store.saveSnapshot(initial);
        assert.equal(initial.revision, 0);
        const second = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'b', title: 'B' });
        store.saveSnapshot(second);
        const edited = store.getSnapshot('a');
        edited.objects.push({ id: 'object', code: 'order', name: '订单', description: '', tier: 1, status: 'active', sourceAssetIds: [], attributes: [], reviewDecision: 'pending', updatedAt: 2 });
        edited.logicFunctions.push({ id: 'lookup', code: 'order_lookup', name: 'Order Lookup', description: 'Lookup orders.', displayName: '查询“订单”', displayDescription: '通过本体映射查询订单记录。', runtime: 'typescript', objectIds: ['object'], signature: 'orderLookup', body: '', returnType: 'object[]', parameters: [], configuration: { builtIn: 'lookup', objectId: 'object' }, origin: 'generated', status: 'active', executionCount: 0, updatedAt: 2 });
        edited.actions.push({ id: 'notify', code: 'order_notify_owner', name: 'Notify Order Owner', description: 'Notify the order owner.', displayName: '通知“订单”负责人', displayDescription: '通知订单记录的负责人。', executor: 'notification', objectIds: ['object'], configuration: {}, parameters: [], outputSchema: [], origin: 'generated', status: 'active', executionCount: 0, updatedAt: 2 });
        store.saveSnapshot(edited, initial, { id: 'change-1', payload: 'create object' });
        assert.equal(edited.revision, 1);
        assert.ok(edited.objects[0].iri);
        assert.ok(edited.semanticDocument.statements.some(item => item.object.value === OWL_NS + 'Class'));
        assert.equal(store.getSnapshot('a').logicFunctions[0].displayName, '查询“订单”');
        assert.equal(store.getSnapshot('a').logicFunctions[0].displayDescription, '通过本体映射查询订单记录。');
        assert.equal(store.getSnapshot('a').actions[0].displayName, '通知“订单”负责人');
        assert.equal(store.getSnapshot('a').actions[0].displayDescription, '通知订单记录的负责人。');
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
        store.registerSudographProject({ id: 'canonical', title: 'Canonical model', modelRef: 'model-1' });
        store.registerSudographProject({ id: 'canonical', title: 'Retry', modelRef: 'model-1' });
        assert.equal(store.getProject('canonical').authority, 'sudograph');
        assert.throws(() => store.getSnapshot('canonical'), /Sudograph owns/);
        assert.throws(() => store.saveSnapshot(createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'canonical' })), /Sudograph owns/);
        assert.throws(() => store.resetSnapshot('canonical'), /Sudograph owns/);
        assert.throws(() => store.deleteSnapshot('canonical'), /Sudograph owns/);
        assert.throws(() => store.registerSudographProject({ id: 'a', title: 'Switch authority', modelRef: 'other' }), /authority conflict/);
        assert.throws(() => store.registerSudographProject({ id: 'canonical', title: 'Rebind', modelRef: 'other' }), /authority conflict/);
        for (const index of [1, 2]) store.createAiSession({ id: 'canonical-session-' + index, workspace_id: 'canonical', conversation_id: 'canonical-chat-' + index, title: 'Build', created_at: 1, updated_at: 1 });
        assert.equal(store.listAiSessions('canonical').length, 2);
        store.deleteAiSession('canonical-session-1');
        const agents = store.getSnapshot('a');
        agents.skillBlueprints = [{ id: 'skill', name: '订单技能', description: '订单查询', ontologyVersionId: 'version', status: 'published', version: '1.0.0', entityIds: [], toolManifest: [], registeredSkillId: 'ontology-skill', createdAt: 1, updatedAt: 1 }];
        agents.agentBlueprints = [{ id: 'blueprint', skillBlueprintId: 'skill', ontologyVersionId: 'version', status: 'draft' }];
        store.saveSnapshot(agents);
        const duplicate = store.getSnapshot('a');
        duplicate.agentBlueprints.push({ id: 'duplicate', skillBlueprintId: 'skill', ontologyVersionId: 'version', status: 'draft' });
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
        assert.equal(reopened.listAiSessions('a').length, 0);
        assert.equal(reopened.listAiSessions('canonical').length, 1);
        assert.equal(reopened.getAiSessionByConversationId('canonical-chat-2').workspace_id, 'canonical');
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
