import { describe, expect, it } from 'vitest';
import { ontology } from '@sudowork/host-bridge/ipcBridge';

describe('ontology bridge contract', () => {
  it('exposes workbench providers and the change event from source', () => {
    expect(ontology.listWorkbenches).toBeDefined();
    expect(ontology.getWorkbench).toBeDefined();
    expect(ontology.workbenchChanged).toBeDefined();
  });
});
