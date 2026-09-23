import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const writeBridgeSource = path.resolve(__dirname, '../../src/process/services/ontology/OntologyWriteBridge.ts');
const mcpSource = path.resolve(__dirname, '../../resources/ontology-builder-mcp/src/index.ts');
const mcpRegSource = path.resolve(__dirname, '../../src/process/services/ontology/OntologyMcpRegistration.ts');

describe('OntologyWriteBridge → ontologyService coverage', () => {
  it('exposes handlers for every write primitive the workbench UI uses', () => {
    const source = fs.readFileSync(writeBridgeSource, 'utf8');
    for (const route of [
      'get_snapshot',
      'update_draft',
      'upsert_object',
      'upsert_attribute',
      'upsert_relation',
      'upsert_mapping',
      'upsert_quality_rule',
      'upsert_logic_function',
      'upsert_action',
      'execute_logic_function',
      'execute_relation',
      'execute_action',
      'generate_draft_from_assets',
      'approve_all',
      'run_consistency_check',
      'publish_current_draft',
      'create_agent_blueprint',
      'register_agent_blueprint',
    ]) {
      expect(source).toContain(`${route}: async`);
    }
  });

  it('binds to loopback only and uses a bearer token', () => {
    const source = fs.readFileSync(writeBridgeSource, 'utf8');
    expect(source).toContain("server.listen(0, '127.0.0.1'");
    expect(source).toContain('Bearer ${bearerToken}');
    expect(source).toContain('randomBytes(24)');
  });
});

describe('ontology-builder-mcp bundle', () => {
  it('declares every write tool + delegates via HTTP', () => {
    const source = fs.readFileSync(mcpSource, 'utf8');
    for (const toolName of [
      'ontology_get_snapshot',
      'ontology_update_draft',
      'ontology_upsert_object',
      'ontology_upsert_attribute',
      'ontology_upsert_relation',
      'ontology_upsert_mapping',
      'ontology_upsert_quality_rule',
      'ontology_upsert_logic_function',
      'ontology_upsert_action',
      'ontology_execute_logic_function',
      'ontology_execute_relation',
      'ontology_execute_action',
      'ontology_generate_draft_from_assets',
      'ontology_run_consistency_check',
      'ontology_publish_current_draft',
      'ontology_create_agent_blueprint',
      'ontology_register_agent_blueprint',
    ]) {
      expect(source).toContain(`name: '${toolName}'`);
    }
    // Every tool call routes through the bridge — bundle must speak HTTP.
    expect(source).toContain('await fetch(url,');
    expect(source).toContain('Authorization: `Bearer ${token');
    expect(source).toContain("relationType: { type: 'string', enum: ['object_property'] }");
    expect(source).toContain("semanticType: { type: 'string', enum: ['association'] }");
  });
});

describe('ontology builder MCP registration', () => {
  it('installs into Sudocode with env pointing to the write bridge', () => {
    const source = fs.readFileSync(mcpRegSource, 'utf8');
    expect(source).toContain('ensureOntologyBuilderMcpServer');
    expect(source).toContain('ONTOLOGY_WRITE_BASE_URL');
    expect(source).toContain('ONTOLOGY_WRITE_TOKEN');
    expect(source).toContain('ensureOntologyWriteBridge');
    expect(source).toContain('installMcpServers');
  });
});
