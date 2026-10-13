import { createHash } from 'node:crypto';

export const ONTOLOGY_RUNTIME_MCP_NAME = 'ontology';
export const ONTOLOGY_TOOL_PREFIX = `mcp__${ONTOLOGY_RUNTIME_MCP_NAME}__`;
export const ONTOLOGY_TOOL_NAME_LIMIT = 64 - ONTOLOGY_TOOL_PREFIX.length;

/** Keep the fully qualified tool name within the provider's 64-character limit. */
export function ontologyRuntimeToolName(kind: 'logic' | 'action' | 'relation', artifact: { id: string; code: string }): string {
  const original = `${kind}_${artifact.code}`;
  const normalized = original.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (normalized === original && normalized.length <= ONTOLOGY_TOOL_NAME_LIMIT) return normalized;
  const suffix = createHash('sha256')
    .update(JSON.stringify([kind, artifact.id, artifact.code]))
    .digest('hex')
    .slice(0, 12);
  return `${normalized.slice(0, ONTOLOGY_TOOL_NAME_LIMIT - suffix.length - 1)}_${suffix}`;
}

/** Map historical unqualified tool names to the names exposed by the pinned version. */
export function ontologyRuntimeToolAliases(snapshot: { logicFunctions: Array<{ id: string; code: string }>; actions: Array<{ id: string; code: string }>; relations: Array<{ id: string; code: string }> }): Record<string, string> {
  const aliases: Record<string, string> = Object.fromEntries(['ontology_get_overview', 'ontology_search', 'ontology_get_object', 'ontology_list_logic', 'ontology_list_relations', 'ontology_list_actions'].map((name) => [name, name]));
  for (const [kind, artifacts] of [
    ['logic', snapshot.logicFunctions],
    ['action', snapshot.actions],
    ['relation', snapshot.relations],
  ] as const) {
    for (const artifact of artifacts) {
      const legacyName = `${kind}_${artifact.code}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      // Historical dispatch selected the first matching artifact.
      aliases[legacyName] ??= ontologyRuntimeToolName(kind, artifact);
    }
  }
  return aliases;
}
