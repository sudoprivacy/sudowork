import { describe, expect, it } from 'vitest';
import { ONTOLOGY_TOOL_PREFIX, ontologyRuntimeToolName, ontologyRuntimeToolAliases } from '@process/services/ontology/ontologyToolNames';

describe('ontology tool names', () => {
  it('keeps standard names readable and bounds the full provider name', () => {
    expect(ontologyRuntimeToolName('logic', { id: 'id', code: 'product_lookup' })).toBe('logic_product_lookup');
    for (const kind of ['logic', 'action', 'relation'] as const) {
      for (const code of ['a'.repeat(43), 'a'.repeat(44), 'a'.repeat(200), '库存补货'.repeat(50)]) {
        const name = ontologyRuntimeToolName(kind, { id: 'id', code });
        expect(ONTOLOGY_TOOL_PREFIX + name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
        expect(ontologyRuntimeToolName(kind, { id: 'id', code })).toBe(name);
      }
    }
  });

  it('distinguishes long names with identical prefixes and names that normalize alike', () => {
    const names = ['a'.repeat(150) + 'one', 'a'.repeat(150) + 'two', '库存', '补货'].map((code, id) => ontologyRuntimeToolName('logic', { id: String(id), code }));
    expect(new Set(names).size).toBe(4);
  });

  it('maps historical names to the same aliases used to dispatch published capabilities', () => {
    const artifact = { id: 'lookup', code: 'product'.repeat(30) };
    const aliases = ontologyRuntimeToolAliases({ logicFunctions: [artifact], actions: [], relations: [] });
    expect(aliases.ontology_list_logic).toBe('ontology_list_logic');
    expect(aliases['logic_' + artifact.code]).toBe(ontologyRuntimeToolName('logic', artifact));
  });
});
