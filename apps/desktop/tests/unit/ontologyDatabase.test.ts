import fs from 'node:fs';
import path from 'node:path';
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
    ]) {
      expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`);
    }
  });
});
