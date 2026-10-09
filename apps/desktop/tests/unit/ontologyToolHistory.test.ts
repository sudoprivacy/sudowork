import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repairOntologyToolHistory } from '@process/services/ontology/ontologyToolHistory';
import { ONTOLOGY_TOOL_PREFIX } from '@process/services/ontology/ontologyToolNames';

let workspace: string;
let file: string;
const blueprint = 'cabd46a93f34fbd80278da616e504bf5';
const oldName = `mcp__ontology-${blueprint}__ontology_list_logic`;
const aliases = { ontology_list_logic: 'ontology_list_logic' };

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-tool-history-'));
  file = path.join(workspace, '.scode', 'sessions', 'partition', 'session-test', 'transcript.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
});
afterEach(async () => fs.rm(workspace, { recursive: true, force: true }));

describe('ontology tool history recovery', () => {
  it('repairs failed tool calls and results while preserving messages, IDs and an exact backup', async () => {
    const records = [
      { type: 'header', session_id: 'session-test' },
      { type: 'message', message: { role: 'user', blocks: [{ type: 'text', text: oldName }] } },
      { type: 'message', message: { role: 'assistant', blocks: [{ type: 'tool_use', id: 'call-1', name: oldName, input: {} }] } },
      { type: 'message', message: { role: 'tool', blocks: [{ type: 'tool_result', tool_use_id: 'call-1', tool_name: oldName, output: { objects: 18 } }] } },
      { type: 'message', message: { role: 'assistant', blocks: [{ type: 'tool_use', id: 'other', name: 'mcp__ontology-unrelated__ontology_list_logic', input: {} }] } },
    ];
    const original = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    await fs.writeFile(file, original);
    expect(await repairOntologyToolHistory({ workspace, acpSessionId: 'session-test' }, blueprint, aliases)).toBe(2);
    const expected = structuredClone(records);
    Object.assign(expected[2].message!.blocks[0], { name: ONTOLOGY_TOOL_PREFIX + 'ontology_list_logic' });
    Object.assign(expected[3].message!.blocks[0], { tool_name: ONTOLOGY_TOOL_PREFIX + 'ontology_list_logic' });
    expect(await fs.readFile(file, 'utf8')).toBe(expected.map((record) => JSON.stringify(record)).join('\n') + '\n');
    const backups = (await fs.readdir(path.dirname(file))).filter((name) => name.endsWith('.bak'));
    expect(backups).toHaveLength(1);
    expect(await fs.readFile(path.join(path.dirname(file), backups[0]), 'utf8')).toBe(original);
    expect(await repairOntologyToolHistory({ workspace, acpSessionId: 'session-test' }, blueprint, aliases)).toBe(0);
    expect((await fs.readdir(path.dirname(file))).filter((name) => name.endsWith('.bak'))).toHaveLength(1);
  });

  it('leaves absent histories and unrecognized tool names untouched', async () => {
    expect(await repairOntologyToolHistory({}, blueprint, aliases)).toBe(0);
    expect(await repairOntologyToolHistory({ workspace, acpSessionId: '../outside' }, blueprint, aliases)).toBe(0);
    const original = JSON.stringify({ type: 'message', message: { blocks: [{ type: 'tool_use', name: `mcp__ontology-${blueprint}__unknown` }] } });
    await fs.writeFile(file, original);
    expect(await repairOntologyToolHistory({ workspace, acpSessionId: 'session-test' }, blueprint, aliases)).toBe(0);
    expect(await fs.readFile(file, 'utf8')).toBe(original);
  });

  it('does not rewrite malformed history or follow a transcript symlink outside its session root', async () => {
    await fs.writeFile(file, 'malformed JSON');
    await expect(repairOntologyToolHistory({ workspace, acpSessionId: 'session-test' }, blueprint, aliases)).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe('malformed JSON');
    const outside = path.join(workspace, 'outside.jsonl');
    await fs.writeFile(outside, '{}');
    await fs.unlink(file);
    await fs.symlink(outside, file);
    await expect(repairOntologyToolHistory({ workspace, acpSessionId: 'session-test' }, blueprint, aliases)).rejects.toThrow('outside its workspace');
    expect(await fs.readFile(outside, 'utf8')).toBe('{}');
  });
});
