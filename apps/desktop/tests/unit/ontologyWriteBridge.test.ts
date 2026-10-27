import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const writeBridgeSource = path.resolve(__dirname, '../../src/process/services/ontology/OntologyWriteBridge.ts');

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

describe('ontology project command catalog', () => {
  it('keeps mutating business operations out of the authoring command catalog', async () => {
    const { ontologyProjectCommands } = await import('@process/services/ontology/ontologyProjectCommands');
    const commands = ontologyProjectCommands('rdf').map((item) => item.name);
    expect(commands).toContain('upsert_object');
    expect(commands).toContain('execute_logic_function');
    expect(commands).not.toContain('execute_action');
    expect(commands).not.toContain('publish_current_draft');
    expect(commands).not.toContain('register_agent_blueprint');
  });
});
