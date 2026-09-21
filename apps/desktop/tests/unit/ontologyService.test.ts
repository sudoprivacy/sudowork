import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyDocumentExtraction, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import { OntologyEngine } from '@sudowork/ontology-engine';
import { OntologyService } from '@process/services/ontology/OntologyService';
import type { OntologyDatabase } from '@process/services/ontology/OntologyDatabase';

vi.mock('@process/services/ontology/OntologyDatabase', () => ({
  OntologyDatabase: class {},
}));
vi.mock('@/agent/acp/AcpConnection', () => ({ AcpConnection: class {} }));
vi.mock('@process/services/scode/ScodeInstallService', () => ({ getScodePath: () => null }));

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

class DocumentRepository {
  snapshots = new Map<string, IOntologyWorkbenchSnapshot>();
  activeWorkspaceId = 'documents';

  getSnapshot(workspaceId: string) {
    return structuredClone(this.snapshots.get(workspaceId) ?? null);
  }

  listSnapshots() {
    return [...this.snapshots.values()].map((snapshot) => structuredClone(snapshot));
  }

  saveSnapshot(snapshot: IOntologyWorkbenchSnapshot, expectedSnapshot?: IOntologyWorkbenchSnapshot) {
    if (expectedSnapshot && !isDeepStrictEqual(this.getSnapshot(snapshot.workspaceId), expectedSnapshot)) throw new Error('ontology.documentErrors.conflict');
    this.snapshots.set(snapshot.workspaceId, structuredClone(snapshot));
  }

  deleteSnapshot(workspaceId: string) {
    this.snapshots.delete(workspaceId);
  }
  resetSnapshot(workspaceId: string) {
    this.snapshots.delete(workspaceId);
  }
  getActiveWorkspaceId() {
    return this.activeWorkspaceId;
  }
  setActiveWorkspaceId(workspaceId: string) {
    this.activeWorkspaceId = workspaceId;
  }
}

describe('OntologyService document generation', () => {
  let directory: string;
  let repository: DocumentRepository;
  let engine: OntologyEngine;
  let service: OntologyService;
  const extract = vi.fn<(documents: Array<{ assetId: string; name: string; text: string }>, goal: string) => Promise<IOntologyDocumentExtraction>>();

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-document-service-'));
    repository = new DocumentRepository();
    repository.saveSnapshot(createDefaultOntologyWorkbenchSnapshot(100, { workspaceId: 'documents' }));
    repository.saveSnapshot(createDefaultOntologyWorkbenchSnapshot(100, { workspaceId: 'other' }));
    engine = new OntologyEngine(repository);
    extract.mockReset();
    extract.mockImplementation(async (documents) => ({
      objects: documents.map((document) => ({ code: document.text.includes('Invoice') ? 'invoice' : 'shipment', name: document.text.includes('Invoice') ? 'Invoice' : 'Shipment', description: document.text, sourceAssetIds: [document.assetId], attributes: [] })),
      relations: [],
    }));
    service = new OntologyService(repository as unknown as OntologyDatabase, engine, extract);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function importDocument(content = 'Invoice includes an amount.', fileName = 'business.md') {
    const filePath = path.join(directory, fileName);
    await fs.writeFile(filePath, content);
    const result = await service.importFiles({ filePaths: [filePath], purpose: 'document', workspaceId: 'documents' });
    return { id: result.files[0].id, filePath };
  }

  it('reads changed document contents rather than reusing filename fallback fields', async () => {
    const { id, filePath } = await importDocument();
    const input = { workspaceId: 'documents', assetIds: [id], documentAssetIds: [id], businessGoal: 'Model business records', mode: 'merge' as const };
    const first = await service.generateDraft(input);
    expect(first.objects.map((object) => object.code)).toEqual(['invoice']);
    expect(first.objects[0].attributes).toEqual([]);
    expect(extract.mock.calls[0][0][0].text).toContain('Invoice includes an amount.');
    expect(extract.mock.calls[0][1]).toBe('Model business records');
    await fs.writeFile(filePath, 'Shipment has a tracking number.');
    const second = await service.generateDraft(input);
    expect(second.objects.map((object) => object.code)).toEqual(['shipment']);
    expect(second.relations).toEqual([]);
    expect(extract.mock.calls[1][0][0].text).toContain('Shipment has a tracking number.');
  });

  it('sends all selected documents once and keeps their distinct attributes and relation', async () => {
    const invoice = await importDocument('Invoice includes amount.', 'invoice.md');
    const shipment = await importDocument('Shipment has tracking number and fulfills an Invoice.', 'shipment.md');
    extract.mockImplementationOnce(async (documents) => ({
      objects: documents.map((document) => ({
        code: document.assetId === invoice.id ? 'invoice' : 'shipment',
        name: document.assetId === invoice.id ? 'Invoice' : 'Shipment',
        description: document.text,
        sourceAssetIds: [document.assetId],
        attributes: [{ code: document.assetId === invoice.id ? 'amount' : 'tracking_number', name: document.assetId === invoice.id ? 'Amount' : 'Tracking Number', dataType: document.assetId === invoice.id ? 'number' : 'string', required: true, description: '' }],
      })),
      relations: [{ code: 'shipment_invoice', name: 'Fulfills', from: 'shipment', to: 'invoice', cardinality: 'many_to_one', description: 'Document relation' }],
    }));
    const result = await service.generateDraft({ workspaceId: 'documents', assetIds: [invoice.id, shipment.id], documentAssetIds: [invoice.id, shipment.id] });
    expect(extract).toHaveBeenCalledOnce();
    expect(extract.mock.calls[0][0].map((document) => document.text)).toEqual(['Invoice includes amount.', 'Shipment has tracking number and fulfills an Invoice.']);
    expect(result.objects.find((object) => object.code === 'invoice')?.attributes[0].code).toBe('amount');
    expect(result.objects.find((object) => object.code === 'shipment')?.attributes[0].code).toBe('tracking_number');
    expect(result.relations).toEqual([expect.objectContaining({ code: 'shipment_invoice', cardinality: 'many_to_one' })]);
  });

  it('recognizes documents on the existing generic generation entry point', async () => {
    const { id } = await importDocument();
    const result = await service.generateDraft({ workspaceId: 'documents', assetIds: [id], documentAssetIds: [] });
    expect(result.objects[0].code).toBe('invoice');
    expect(extract).toHaveBeenCalledOnce();
  });

  it('keeps the requested workspace even when the active workspace changes during inference', async () => {
    const { id } = await importDocument();
    const otherBefore = repository.getSnapshot('other');
    const run = extract.getMockImplementation()!;
    extract.mockImplementationOnce(async (documents, goal) => {
      repository.setActiveWorkspaceId('other');
      return run(documents, goal);
    });
    await service.generateDraft({ workspaceId: 'documents', assetIds: [id], documentAssetIds: [id] });
    expect(repository.getSnapshot('documents')?.objects[0].code).toBe('invoice');
    expect(repository.getSnapshot('other')).toEqual(otherBefore);
    expect(repository.getActiveWorkspaceId()).toBe('other');
  });

  it('does not change the draft when inference fails and permits retry', async () => {
    const { id } = await importDocument();
    const before = repository.getSnapshot('documents');
    extract.mockRejectedValueOnce(new Error('ontology.documentErrors.modelFailed'));
    const input = { workspaceId: 'documents', assetIds: [id], documentAssetIds: [id] };
    await expect(service.generateDraft(input)).rejects.toThrow('ontology.documentErrors.modelFailed');
    expect(repository.getSnapshot('documents')).toEqual(before);
    await expect(service.generateDraft(input)).resolves.toMatchObject({ objects: [expect.objectContaining({ code: 'invoice' })] });
  });

  it.each(['edit', 'delete'] as const)('rejects concurrent workspace %s instead of overwriting or resurrecting it', async (operation) => {
    const { id } = await importDocument();
    const run = extract.getMockImplementation()!;
    extract.mockImplementationOnce(async (documents, goal) => {
      if (operation === 'delete') repository.deleteSnapshot('documents');
      else {
        const changed = repository.getSnapshot('documents')!;
        changed.draft.description = 'Concurrent edit';
        repository.saveSnapshot(changed);
      }
      return run(documents, goal);
    });
    await expect(service.generateDraft({ workspaceId: 'documents', assetIds: [id], documentAssetIds: [id] })).rejects.toThrow('ontology.documentErrors.conflict');
    if (operation === 'delete') expect(repository.getSnapshot('documents')).toBeNull();
    else expect(repository.getSnapshot('documents')?.draft.description).toBe('Concurrent edit');
  });

  it('blocks concurrent generation in the same workspace', async () => {
    const { id } = await importDocument();
    let release!: () => void;
    let started!: () => void;
    const isStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = extract.getMockImplementation()!;
    extract.mockImplementationOnce(async (documents, goal) => {
      started();
      await pending;
      return run(documents, goal);
    });
    const input = { workspaceId: 'documents', assetIds: [id], documentAssetIds: [id] };
    const first = service.generateDraft(input);
    await isStarted;
    await expect(service.generateDraft(input)).rejects.toThrow('ontology.documentErrors.busy');
    release();
    await first;
    expect(extract).toHaveBeenCalledOnce();
  });

  it('rejects a partially invalid import batch without storing any assets', async () => {
    const filePath = path.join(directory, 'valid.md');
    await fs.writeFile(filePath, 'Invoice');
    const before = repository.getSnapshot('documents');
    await expect(service.importFiles({ workspaceId: 'documents', purpose: 'document', filePaths: [filePath, path.join(directory, 'missing.md')] })).rejects.toThrow('ontology.documentErrors.fileUnavailable');
    expect(repository.getSnapshot('documents')).toEqual(before);
  });

  it('rejects unknown selections without calling the model', async () => {
    await expect(service.generateDraft({ workspaceId: 'documents', assetIds: ['foreign'], documentAssetIds: ['foreign'] })).rejects.toThrow('ontology.documentErrors.invalidSelection');
    expect(extract).not.toHaveBeenCalled();
  });

  it('rejects an empty document without calling the model or changing the draft', async () => {
    const { id } = await importDocument('   ');
    const before = repository.getSnapshot('documents');
    await expect(service.generateDraft({ workspaceId: 'documents', assetIds: [id], documentAssetIds: [id] })).rejects.toThrow('ontology.documentErrors.emptyDocument');
    expect(extract).not.toHaveBeenCalled();
    expect(repository.getSnapshot('documents')).toEqual(before);
  });
});
