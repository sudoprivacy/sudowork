import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { findScodeSessionFile } from '@process/task/acpUsageReconciliation';
import { ONTOLOGY_TOOL_PREFIX } from './ontologyToolNames';

/** Repair only structured tool names; retain message content, call IDs, and an exact backup. */
export async function repairOntologyToolHistory(input: { workspace?: string; acpSessionId?: string }, blueprintId: string, aliases: Record<string, string>): Promise<number> {
  if (!input.workspace || !input.acpSessionId || !/^[a-zA-Z0-9_-]+$/.test(input.acpSessionId)) return 0;
  const file = await findScodeSessionFile(input.workspace, input.acpSessionId);
  if (!file) return 0;
  const root = await fs.realpath(path.join(input.workspace, '.scode', 'sessions'));
  const target = await fs.realpath(file);
  if (!target.startsWith(root + path.sep)) throw new Error('Ontology session history is outside its workspace.');
  const original = await fs.readFile(target, 'utf8');
  const legacyPrefix = `mcp__ontology-${blueprintId}__`;
  let changes = 0;
  const updated = original
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      const record = JSON.parse(line) as { type?: string; message?: { blocks?: Array<Record<string, unknown>> } };
      if (record.type !== 'message' || !Array.isArray(record.message?.blocks)) return line;
      let isChanged = false;
      for (const block of record.message.blocks) {
        const key = block.type === 'tool_use' ? 'name' : block.type === 'tool_result' ? 'tool_name' : undefined;
        const oldName = key && block[key];
        if (!key || typeof oldName !== 'string') continue;
        const prefix = oldName.startsWith(legacyPrefix) ? legacyPrefix : oldName.startsWith(ONTOLOGY_TOOL_PREFIX) ? ONTOLOGY_TOOL_PREFIX : undefined;
        if (!prefix) continue;
        const alias = aliases[oldName.slice(prefix.length)];
        if (typeof alias !== 'string' || oldName === ONTOLOGY_TOOL_PREFIX + alias) continue;
        block[key] = ONTOLOGY_TOOL_PREFIX + alias;
        changes++;
        isChanged = true;
      }
      return isChanged ? JSON.stringify(record) : line;
    })
    .join('\n');
  if (!changes) return 0;
  const backup = `${target}.ontology-tools-${createHash('sha256').update(original).digest('hex').slice(0, 16)}.bak`;
  await fs.writeFile(backup, original, { flag: 'wx', mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST' || (await fs.readFile(backup, 'utf8')) !== original) throw error;
  });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, updated, { flag: 'wx', mode: 0o600 });
    if ((await fs.readFile(target, 'utf8')) !== original) throw new Error('Ontology session history changed during recovery. Please retry.');
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return changes;
}
