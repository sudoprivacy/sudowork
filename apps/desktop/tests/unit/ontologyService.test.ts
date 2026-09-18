import { describe, expect, it, vi } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { OntologyEngine } from '@sudowork/ontology-engine';
import { OntologyService } from '@process/services/ontology/OntologyService';
import type { OntologyDatabase } from '@process/services/ontology/OntologyDatabase';

vi.mock('@process/services/ontology/OntologyDatabase', () => ({
  OntologyDatabase: class {},
}));

describe('OntologyService workspace selection', () => {
  it('does not change the active workspace when reading another workbench', async () => {
    const snapshot = createDefaultOntologyWorkbenchSnapshot(Date.now(), {
      workspaceId: 'secondary',
      title: 'Secondary',
    });
    const database = {
      setActiveWorkspaceId: vi.fn(),
    } as unknown as OntologyDatabase;
    const engine = {
      getWorkbench: vi.fn().mockResolvedValue(snapshot),
    } as unknown as OntologyEngine;
    const service = new OntologyService(database, engine);

    await expect(service.getWorkbench({ workspaceId: 'secondary' })).resolves.toBe(snapshot);
    expect(database.setActiveWorkspaceId).not.toHaveBeenCalled();

    await expect(service.selectWorkbench({ workspaceId: 'secondary' })).resolves.toBe(snapshot);
    expect(database.setActiveWorkspaceId).toHaveBeenCalledWith('secondary');
  });
});
