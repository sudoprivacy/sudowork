import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const ontologyDatabaseSource = path.resolve(__dirname, '../../src/process/services/ontology/OntologyDatabase.ts');

describe('OntologyDatabase schema', () => {
  it('uses original ontology relational tables instead of snapshot tables', () => {
    const source = fs.readFileSync(ontologyDatabaseSource, 'utf8');

    expect(source).toContain('DROP TABLE IF EXISTS ontology_snapshots');
    expect(source).toContain('DROP TABLE IF EXISTS ontology_state');
    expect(source).not.toContain('snapshot_json');
    expect(source).not.toContain('connector.credential ? `plain://');
    expect(source).toContain('safeStorage.encryptString');
    expect(source).toContain('writeMcpExport');

    // Clearing quality_rules must be keyed on created_by (matching readQualityRules), otherwise
    // rules whose asset_id fell back to the object id survive the wipe and re-inserting the same
    // rule.id on the next saveSnapshot trips 'UNIQUE constraint failed: quality_rules.id'.
    // See scan-connector flow regression, 2026-09-18.
    expect(source).toContain('DELETE FROM quality_rules WHERE created_by = ?');
    expect(source).not.toMatch(/DELETE FROM quality_rules WHERE asset_id IN/);

    for (const tableName of [
      'scenario_dict',
      'connections',
      'assets',
      'asset_usage',
      'object_bindings',
      'ontology_entities',
      'entity_attributes',
      'entity_relations',
      'ontology_functions',
      'entity_actions',
      'business_documents',
      'quality_rules',
      'health_statuses',
      'ontology_versions',
      'ontology_version_entities',
      'ontology_version_attributes',
      'ontology_version_relations',
      'ontology_version_functions',
      'ontology_version_actions',
      'ontology_version_metadata',
      'agents',
      'skills',
      'skill_tools',
      'audit_log',
      'system_config',
      't_mcp_call_log',
      't_ontology_ai_session',
    ]) {
      expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`);
    }
  });

  it('conditionally saves an unchanged snapshot and rejects edits or deletion in an isolated SQLite database', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-database-cas-'));
    const outputFile = path.join(directory, 'verify.cjs');
    const commonSource = path.resolve(__dirname, '../../../../packages/ontology-common/src/index.ts');
    try {
      await build({
        stdin: {
          contents: `
            const assert = require('node:assert/strict');
            const { OntologyDatabase } = require(${JSON.stringify(ontologyDatabaseSource)});
            const { createDefaultOntologyWorkbenchSnapshot } = require(${JSON.stringify(commonSource)});
            const db = new OntologyDatabase();
            const initial = createDefaultOntologyWorkbenchSnapshot(100, {workspaceId:'cas', title:'Initial'});
            db.saveSnapshot(initial);
            const expected = db.getSnapshot('cas');
            const changed = structuredClone(expected);
            changed.draft.title = 'Generated';
            db.saveSnapshot(changed, expected);
            assert.equal(db.getSnapshot('cas').draft.title, 'Generated');
            assert.throws(() => db.saveSnapshot(initial, expected), /ontology.documentErrors.conflict/);
            assert.equal(db.getSnapshot('cas').draft.title, 'Generated');
            const beforeDeletion = db.getSnapshot('cas');
            db.deleteSnapshot('cas');
            assert.throws(() => db.saveSnapshot(initial, beforeDeletion), /ontology.documentErrors.conflict/);
            assert.equal(db.getSnapshot('cas'), null);
            assert.equal(db.ontologyDir, ${JSON.stringify(path.join(directory, 'ontology'))});
            const { OntologyEngine } = require(${JSON.stringify(path.resolve(__dirname, '../../../../packages/ontology-engine/src/index.ts'))});
            async function verifyPublishedSnapshot() {
              const engine = new OntologyEngine(db);
              await engine.getWorkbench('versioned');
              const imported = await engine.importFiles({filePaths:['/tmp/invoice.csv','/tmp/line.csv']},[{path:'/tmp/invoice.csv',name:'invoice.csv',sizeBytes:10,extension:'.csv',fields:[{name:'id',dataType:'string'}]},{path:'/tmp/line.csv',name:'line.csv',sizeBytes:10,extension:'.csv',fields:[{name:'invoice_id',dataType:'string'}]}], 'versioned');
              const invoiceAssetId = imported.files.find(file=>file.name==='invoice.csv').id;
              const lineAssetId = imported.files.find(file=>file.name==='line.csv').id;
              const first = await engine.upsertObject({code:'invoice',name:'Invoice',sourceAssetIds:[invoiceAssetId]}, 'versioned');
              const second = await engine.upsertObject({code:'line',name:'Line',sourceAssetIds:[lineAssetId]}, 'versioned');
              const invoiceId = first.objects[0].id;
              const lineId = second.objects.find(object=>object.code==='line').id;
              const withInvoiceId = await engine.upsertAttribute({objectId:invoiceId,code:'id',name:'ID',dataType:'string',mappedField:{assetId:invoiceAssetId,fieldName:'id'}}, 'versioned');
              const invoiceAttributeId = withInvoiceId.objects.find(object=>object.id===invoiceId).attributes[0].id;
              const withInvoiceReference = await engine.upsertAttribute({objectId:lineId,code:'invoice_id',name:'Invoice ID',dataType:'string',mappedField:{assetId:lineAssetId,fieldName:'invoice_id'}}, 'versioned');
              const lineAttributeId = withInvoiceReference.objects.find(object=>object.id===lineId).attributes[0].id;
              await engine.upsertRelation({code:'invoice_lines',name:'Invoice lines',fromObjectId:invoiceId,toObjectId:lineId,cardinality:'one_to_many',dataBinding:{mode:'direct',joinKeys:[{fromAttributeId:invoiceAttributeId,toAttributeId:lineAttributeId}]}}, 'versioned');
              assert.deepEqual(db.getSnapshot('versioned').relations[0].dataBinding,{mode:'direct',joinKeys:[{fromAttributeId:invoiceAttributeId,toAttributeId:lineAttributeId}],origin:'manual'});
              await engine.publishCurrentDraft('versioned');
              const published = db.getSnapshot('versioned');
              assert.deepEqual(published.publishedVersions[0].snapshot.relations[0].dataBinding,{mode:'direct',joinKeys:[{fromAttributeId:invoiceAttributeId,toAttributeId:lineAttributeId}],origin:'manual'});
              await new Promise(resolve=>setTimeout(resolve,5));
              assert.deepEqual(db.getSnapshot('versioned'),published);
              db.saveSnapshot(published,published);
              db.close();
              console.log('isolated SQLite conditional save passed');
            }
            verifyPublishedSnapshot().catch(error=>{db.close();console.error(error);process.exitCode=1;});
          `,
          resolveDir: path.resolve(__dirname, '../..'),
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: outputFile,
        plugins: [
          {
            name: 'isolated-ontology-database',
            setup(context) {
              context.onResolve({ filter: /^@sudowork\/ontology-common$/ }, () => ({ path: commonSource }));
              // The full unit-test CI job does not rebuild native modules. Keep this
              // subprocess isolated from better-sqlite3's Node/Electron ABI by using
              // Node 22's built-in SQLite implementation behind the same small API.
              context.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: 'better-sqlite3', namespace: 'node-sqlite' }));
              context.onLoad({ filter: /.*/, namespace: 'node-sqlite' }, () => ({
                contents: `
                  const { DatabaseSync } = require('node:sqlite');
                  class BetterSqlite3 {
                    constructor(filename) { this.database = new DatabaseSync(filename); }
                    close() { this.database.close(); }
                    exec(sql) { return this.database.exec(sql); }
                    prepare(sql) { return this.database.prepare(sql); }
                    pragma(source) { return this.database.exec(\`PRAGMA \${source}\`); }
                    transaction(callback) {
                      return (...args) => {
                        this.database.exec('BEGIN');
                        try {
                          const result = callback(...args);
                          this.database.exec('COMMIT');
                          return result;
                        } catch (error) {
                          this.database.exec('ROLLBACK');
                          throw error;
                        }
                      };
                    }
                  }
                  module.exports = BetterSqlite3;
                `,
              }));
              context.onResolve({ filter: /^(electron|@process\/utils|@process\/utils\/mainLogger)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
              context.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                contents: `export const getDataPath=()=>${JSON.stringify(directory)}; export const ensureDirectory=(dir)=>require('node:fs').mkdirSync(dir,{recursive:true}); export const mainLog=()=>{}; export const safeStorage={isEncryptionAvailable:()=>false};`,
              }));
            },
          },
        ],
      });
      const run = promisify(execFile);
      const { stdout } = await run(process.execPath, [outputFile], { timeout: 15_000 });
      expect(stdout).toContain('isolated SQLite conditional save passed');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
