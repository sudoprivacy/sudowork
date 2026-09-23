import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

describe('OntologyService quality rule execution', () => {
  let directory: string;
  let repository: DocumentRepository;
  let service: OntologyService;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-quality-rules-'));
    const filePath = path.join(directory, 'transactions.csv');
    await fs.writeFile(filePath, 'amount,status\n10,paid\n-2,paid\n8,cancelled\n');
    const snapshot = createDefaultOntologyWorkbenchSnapshot(100, {
      workspaceId: 'quality',
      title: 'Quality Rules',
    });
    snapshot.assets = [
      {
        id: 'transactions-asset',
        kind: 'table',
        name: 'transactions.csv',
        path: filePath,
        profileStatus: 'ready',
        fields: [
          { name: 'amount', dataType: 'number', nullable: false },
          { name: 'status', dataType: 'string', nullable: false },
        ],
        metadata: {},
        createdAt: 100,
        updatedAt: 100,
      },
    ];
    snapshot.objects = [
      {
        id: 'transaction-object',
        code: 'transaction',
        name: 'Transaction',
        description: '',
        tier: 1,
        status: 'active',
        sourceAssetIds: ['transactions-asset'],
        attributes: [
          { id: 'amount-attribute', code: 'amount', name: 'Amount', dataType: 'number', required: true },
          { id: 'status-attribute', code: 'status', name: 'Status', dataType: 'string', required: true },
        ],
        reviewDecision: 'approved',
        updatedAt: 100,
      },
    ];
    snapshot.mappings = [
      { id: 'amount-mapping', objectId: 'transaction-object', attributeId: 'amount-attribute', assetId: 'transactions-asset', fieldName: 'amount', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'status-mapping', objectId: 'transaction-object', attributeId: 'status-attribute', assetId: 'transactions-asset', fieldName: 'status', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
    ];
    snapshot.qualityRules = [
      {
        id: 'positive-paid-rule',
        objectId: 'transaction-object',
        code: 'positive_paid',
        name: 'Positive paid transaction',
        expression: "amount > 0 AND status != 'cancelled'",
        severity: 'error',
        status: 'active',
        updatedAt: 100,
      },
    ];
    repository = new DocumentRepository();
    repository.saveSnapshot(snapshot);
    service = new OntologyService(repository as unknown as OntologyDatabase, new OntologyEngine(repository));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('evaluates mapped source rows and blocks publishing on error-severity failures', async () => {
    const result = await service.runConsistencyCheck({ workspaceId: 'quality' });

    expect(result.isValid).toBe(false);
    expect(result.qualityRuleResults).toEqual([
      expect.objectContaining({
        ruleId: 'positive-paid-rule',
        status: 'failed',
        evaluatedRows: 3,
        failedRows: 2,
        isTruncated: false,
        assetId: 'transactions-asset',
      }),
    ]);
    await expect(service.publishCurrentDraft({ workspaceId: 'quality' })).rejects.toThrow(/failed for 2 of 3 sampled rows/);
  });

  it('reports warning-severity failures without blocking publishing', async () => {
    const snapshot = repository.getSnapshot('quality')!;
    snapshot.qualityRules[0].severity = 'warning';
    repository.saveSnapshot(snapshot);

    const result = await service.runConsistencyCheck({ workspaceId: 'quality' });
    expect(result.isValid).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'warning', targetId: 'transaction-object' })]));
    await expect(service.publishCurrentDraft({ workspaceId: 'quality' })).resolves.toMatchObject({ version: { version: 'v1' } });
  });

  it('marks rules without a complete single-asset mapping as skipped', async () => {
    const snapshot = repository.getSnapshot('quality')!;
    snapshot.mappings = snapshot.mappings.filter((mapping) => mapping.attributeId !== 'status-attribute');
    repository.saveSnapshot(snapshot);

    const result = await service.runConsistencyCheck({ workspaceId: 'quality' });
    expect(result.isValid).toBe(true);
    expect(result.qualityRuleResults).toEqual([expect.objectContaining({ status: 'skipped', reason: 'unmapped_attributes', evaluatedRows: 0 })]);
  });

  it('executes generated lookup functions against mapped asset rows', async () => {
    const snapshot = repository.getSnapshot('quality')!;
    snapshot.logicFunctions = [
      {
        id: 'transaction-lookup',
        code: 'transaction_lookup',
        name: 'Transaction Lookup',
        description: '',
        runtime: 'typescript',
        objectIds: ['transaction-object'],
        signature: 'transactionLookup(query)',
        body: '',
        returnType: 'object[]',
        parameters: [{ name: 'query', type: 'object', required: true }],
        configuration: { builtIn: 'lookup', objectId: 'transaction-object' },
        origin: 'generated',
        status: 'active',
        executionCount: 0,
        updatedAt: 100,
      },
    ];
    repository.saveSnapshot(snapshot);

    const result = await service.executeLogicFunction({
      workspaceId: 'quality',
      id: 'transaction-lookup',
      arguments: { query: { status: 'paid' } },
    });

    expect(result.execution.output).toEqual([
      { amount: '10', status: 'paid' },
      { amount: '-2', status: 'paid' },
    ]);
    expect(result.snapshot.logicFunctions[0].executionCount).toBe(1);
  });
});

describe('OntologyService relation traversal', () => {
  let directory: string;
  let repository: DocumentRepository;
  let service: OntologyService;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-relations-'));
    const customerPath = path.join(directory, 'customers.csv');
    const orderPath = path.join(directory, 'orders.csv');
    const membershipPath = path.join(directory, 'memberships.csv');
    const groupPath = path.join(directory, 'groups.csv');
    const nodePath = path.join(directory, 'nodes.csv');
    await Promise.all([
      fs.writeFile(customerPath, 'id,name,tenant_id\n1,Alice,t1\n2,Bob,t2\n'),
      fs.writeFile(orderPath, 'id,customer_id,tenant_id\n100,1,t1\n101,1,t2\n102,2,t2\n'),
      fs.writeFile(membershipPath, 'customer_id,group_id\n1,10\n1,20\n2,20\n'),
      fs.writeFile(groupPath, 'id,name\n10,Admin\n20,Member\n'),
      fs.writeFile(nodePath, 'id,parent_id,name\n1,,Root\n2,1,Child\n3,2,Grandchild\n'),
    ]);
    const snapshot = createDefaultOntologyWorkbenchSnapshot(100, {
      workspaceId: 'relations',
      title: 'Relations',
    });
    const asset = (id: string, name: string, filePath: string, fields: string[]) => ({
      id,
      kind: 'table' as const,
      name,
      path: filePath,
      profileStatus: 'ready' as const,
      fields: fields.map((field) => ({ name: field, dataType: 'string', nullable: false })),
      metadata: {},
      createdAt: 100,
      updatedAt: 100,
    });
    snapshot.assets = [
      asset('customer-asset', 'customers.csv', customerPath, ['id', 'name', 'tenant_id']),
      asset('order-asset', 'orders.csv', orderPath, ['id', 'customer_id', 'tenant_id']),
      asset('membership-asset', 'memberships.csv', membershipPath, ['customer_id', 'group_id']),
      asset('group-asset', 'groups.csv', groupPath, ['id', 'name']),
      asset('node-asset', 'nodes.csv', nodePath, ['id', 'parent_id', 'name']),
    ];
    snapshot.objects = [
      {
        id: 'customer-object',
        code: 'customer',
        name: 'Customer',
        description: '',
        tier: 1,
        status: 'active',
        sourceAssetIds: ['customer-asset'],
        attributes: [
          { id: 'customer-id', code: 'id', name: 'ID', dataType: 'string', required: true },
          { id: 'customer-name', code: 'name', name: 'Name', dataType: 'string', required: false },
          { id: 'customer-tenant-id', code: 'tenant_id', name: 'Tenant ID', dataType: 'string', required: true },
        ],
        reviewDecision: 'approved',
        updatedAt: 100,
      },
      {
        id: 'order-object',
        code: 'order',
        name: 'Order',
        description: '',
        tier: 1,
        status: 'active',
        sourceAssetIds: ['order-asset'],
        attributes: [
          { id: 'order-id', code: 'id', name: 'ID', dataType: 'string', required: true },
          { id: 'order-customer-id', code: 'customer_id', name: 'Customer ID', dataType: 'string', required: true },
          { id: 'order-tenant-id', code: 'tenant_id', name: 'Tenant ID', dataType: 'string', required: true },
        ],
        reviewDecision: 'approved',
        updatedAt: 100,
      },
      {
        id: 'group-object',
        code: 'group',
        name: 'Group',
        description: '',
        tier: 1,
        status: 'active',
        sourceAssetIds: ['group-asset'],
        attributes: [
          { id: 'group-id', code: 'id', name: 'ID', dataType: 'string', required: true },
          { id: 'group-name', code: 'name', name: 'Name', dataType: 'string', required: false },
        ],
        reviewDecision: 'approved',
        updatedAt: 100,
      },
      {
        id: 'node-object',
        code: 'node',
        name: 'Node',
        description: '',
        tier: 1,
        status: 'active',
        sourceAssetIds: ['node-asset'],
        attributes: [
          { id: 'node-id', code: 'id', name: 'ID', dataType: 'string', required: true },
          { id: 'node-parent-id', code: 'parent_id', name: 'Parent ID', dataType: 'string', required: false },
          { id: 'node-name', code: 'name', name: 'Name', dataType: 'string', required: false },
        ],
        reviewDecision: 'approved',
        updatedAt: 100,
      },
    ];
    snapshot.mappings = [
      { id: 'customer-id-map', objectId: 'customer-object', attributeId: 'customer-id', assetId: 'customer-asset', fieldName: 'id', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'customer-name-map', objectId: 'customer-object', attributeId: 'customer-name', assetId: 'customer-asset', fieldName: 'name', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'customer-tenant-map', objectId: 'customer-object', attributeId: 'customer-tenant-id', assetId: 'customer-asset', fieldName: 'tenant_id', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'order-id-map', objectId: 'order-object', attributeId: 'order-id', assetId: 'order-asset', fieldName: 'id', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'order-customer-map', objectId: 'order-object', attributeId: 'order-customer-id', assetId: 'order-asset', fieldName: 'customer_id', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'order-tenant-map', objectId: 'order-object', attributeId: 'order-tenant-id', assetId: 'order-asset', fieldName: 'tenant_id', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'group-id-map', objectId: 'group-object', attributeId: 'group-id', assetId: 'group-asset', fieldName: 'id', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'group-name-map', objectId: 'group-object', attributeId: 'group-name', assetId: 'group-asset', fieldName: 'name', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'node-id-map', objectId: 'node-object', attributeId: 'node-id', assetId: 'node-asset', fieldName: 'id', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'node-parent-id-map', objectId: 'node-object', attributeId: 'node-parent-id', assetId: 'node-asset', fieldName: 'parent_id', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
      { id: 'node-name-map', objectId: 'node-object', attributeId: 'node-name', assetId: 'node-asset', fieldName: 'name', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: 100 },
    ];
    snapshot.relations = [
      {
        id: 'customer-orders',
        code: 'customer_orders',
        name: 'Customer Orders',
        fromObjectId: 'customer-object',
        toObjectId: 'order-object',
        cardinality: 'one_to_many',
        relationType: 'object_property',
        semanticType: 'association',
        dataBinding: { mode: 'direct', joinKeys: [{ fromAttributeId: 'customer-id', toAttributeId: 'order-customer-id' }] },
        isAcyclic: false,
        reviewDecision: 'approved',
        updatedAt: 100,
      },
      {
        id: 'customer-groups',
        code: 'customer_groups',
        name: 'Customer Groups',
        fromObjectId: 'customer-object',
        toObjectId: 'group-object',
        cardinality: 'many_to_many',
        relationType: 'object_property',
        semanticType: 'association',
        dataBinding: {
          mode: 'junction',
          junctionAssetId: 'membership-asset',
          joinKeys: [
            {
              fromAttributeId: 'customer-id',
              toAttributeId: 'group-id',
              junctionFromFieldName: 'customer_id',
              junctionToFieldName: 'group_id',
            },
          ],
        },
        isAcyclic: false,
        reviewDecision: 'approved',
        updatedAt: 100,
      },
      {
        id: 'customer-orders-composite',
        code: 'customer_orders_composite',
        name: 'Customer Orders Composite',
        fromObjectId: 'customer-object',
        toObjectId: 'order-object',
        cardinality: 'one_to_many',
        relationType: 'object_property',
        semanticType: 'association',
        dataBinding: {
          mode: 'direct',
          joinKeys: [
            { fromAttributeId: 'customer-id', toAttributeId: 'order-customer-id' },
            { fromAttributeId: 'customer-tenant-id', toAttributeId: 'order-tenant-id' },
          ],
        },
        isAcyclic: false,
        reviewDecision: 'approved',
        updatedAt: 100,
      },
      {
        id: 'node-ancestors',
        code: 'node_ancestors',
        name: 'Node Ancestors',
        fromObjectId: 'node-object',
        toObjectId: 'node-object',
        cardinality: 'many_to_one',
        relationType: 'transitive_property',
        semanticType: 'dependency',
        dataBinding: { mode: 'direct', joinKeys: [{ fromAttributeId: 'node-parent-id', toAttributeId: 'node-id' }] },
        isAcyclic: true,
        reviewDecision: 'approved',
        updatedAt: 100,
      },
      {
        id: 'node-peers',
        code: 'node_peers',
        name: 'Node Peers',
        fromObjectId: 'node-object',
        toObjectId: 'node-object',
        cardinality: 'many_to_many',
        relationType: 'symmetric_property',
        semanticType: 'association',
        dataBinding: { mode: 'direct', joinKeys: [{ fromAttributeId: 'node-parent-id', toAttributeId: 'node-id' }] },
        isAcyclic: false,
        reviewDecision: 'approved',
        updatedAt: 100,
      },
    ];
    repository = new DocumentRepository();
    repository.activeWorkspaceId = 'relations';
    repository.saveSnapshot(snapshot);
    service = new OntologyService(repository as unknown as OntologyDatabase, new OntologyEngine(repository));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('traverses direct field joins in both directions and reports cardinality violations', async () => {
    const forward = await service.executeRelation({
      workspaceId: 'relations',
      id: 'customer-orders',
      arguments: { query: { id: '1' }, direction: 'forward' },
    });
    expect(forward.execution).toMatchObject({ kind: 'relation', code: 'customer_orders' });
    expect(forward.execution.output).toMatchObject({ totalMatches: 2, cardinalityViolations: 0 });
    expect((forward.execution.output as { rows: Array<{ target: { id: string } }> }).rows.map((row) => row.target.id)).toEqual(['100', '101']);

    const reverse = await service.executeRelation({
      workspaceId: 'relations',
      code: 'customer_orders',
      arguments: { query: { id: '102' }, direction: 'reverse' },
    });
    expect((reverse.execution.output as { rows: Array<{ target: { name: string } }> }).rows).toEqual([expect.objectContaining({ target: expect.objectContaining({ name: 'Bob' }) })]);

    const snapshot = repository.getSnapshot('relations')!;
    snapshot.relations[0].cardinality = 'one_to_one';
    repository.saveSnapshot(snapshot);
    const consistency = await service.runConsistencyCheck({ workspaceId: 'relations' });
    expect(consistency.isValid).toBe(false);
    expect(consistency.issues).toEqual(expect.arrayContaining([expect.objectContaining({ targetType: 'relation', targetId: 'customer-orders', message: expect.stringContaining('one_to_one') })]));
  });

  it('traverses many-to-many relations through a junction asset', async () => {
    const result = await service.executeRelation({
      workspaceId: 'relations',
      id: 'customer-groups',
      arguments: { query: { id: '1' }, limit: 10 },
    });
    expect(result.execution.output).toMatchObject({ totalMatches: 2, cardinalityViolations: 0, isTruncated: false });
    expect((result.execution.output as { rows: Array<{ target: { name: string } }> }).rows.map((row) => row.target.name)).toEqual(['Admin', 'Member']);
  });

  it('requires every configured key when traversing a composite relation', async () => {
    const result = await service.executeRelation({
      workspaceId: 'relations',
      id: 'customer-orders-composite',
      arguments: { query: { id: '1' } },
    });
    expect((result.execution.output as { rows: Array<{ target: { id: string } }> }).rows.map((row) => row.target.id)).toEqual(['100']);
  });

  it('applies transitive and symmetric relation semantics during traversal', async () => {
    const transitive = await service.executeRelation({
      workspaceId: 'relations',
      id: 'node-ancestors',
      arguments: { query: { id: '3' }, maxDepth: 4 },
    });
    expect((transitive.execution.output as { rows: Array<{ target: { id: string }; depth: number }> }).rows).toEqual([expect.objectContaining({ target: expect.objectContaining({ id: '2' }), depth: 1 }), expect.objectContaining({ target: expect.objectContaining({ id: '1' }), depth: 2 })]);

    const symmetric = await service.executeRelation({
      workspaceId: 'relations',
      id: 'node-peers',
      arguments: { query: { id: '1' } },
    });
    expect((symmetric.execution.output as { rows: Array<{ target: { id: string } }> }).rows).toEqual([expect.objectContaining({ target: expect.objectContaining({ id: '2' }) })]);
  });

  it('blocks publishing when an acyclic relation contains a sampled cycle', async () => {
    const snapshot = repository.getSnapshot('relations')!;
    const nodeAsset = snapshot.assets.find((asset) => asset.id === 'node-asset')!;
    await fs.writeFile(nodeAsset.path!, 'id,parent_id,name\n1,2,First\n2,1,Second\n');

    const consistency = await service.runConsistencyCheck({ workspaceId: 'relations' });

    expect(consistency.isValid).toBe(false);
    expect(consistency.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: 'relation',
          targetId: 'node-ancestors',
          message: expect.stringContaining('cycle'),
        }),
      ])
    );
  });
});

describe('OntologyService runtime execution', () => {
  let repository: DocumentRepository;
  let service: OntologyService;

  beforeEach(() => {
    const snapshot = createDefaultOntologyWorkbenchSnapshot(100, {
      workspaceId: 'runtime',
      title: 'Runtime',
    });
    snapshot.objects = [
      {
        id: 'customer-object',
        code: 'customer',
        name: 'Customer',
        description: '',
        tier: 1,
        status: 'active',
        sourceAssetIds: [],
        attributes: [],
        reviewDecision: 'approved',
        updatedAt: 100,
      },
    ];
    snapshot.logicFunctions = [
      {
        id: 'double-value',
        code: 'double_value',
        name: 'Double Value',
        description: '',
        runtime: 'typescript',
        objectIds: ['customer-object'],
        signature: 'doubleValue(value)',
        body: 'return input.value * 2;',
        returnType: 'number',
        parameters: [{ name: 'value', type: 'number', required: true }],
        configuration: {},
        origin: 'manual',
        status: 'active',
        executionCount: 0,
        updatedAt: 100,
      },
    ];
    snapshot.actions = [
      {
        id: 'double-action',
        code: 'double_action',
        name: 'Double Action',
        executor: 'function',
        objectIds: ['customer-object'],
        description: '',
        configuration: { functionCode: 'double_value' },
        parameters: [{ name: 'value', type: 'number', required: true }],
        outputSchema: [{ name: 'result', type: 'number' }],
        origin: 'manual',
        status: 'active',
        executionCount: 0,
        updatedAt: 100,
      },
    ];
    repository = new DocumentRepository();
    repository.saveSnapshot(snapshot);
    service = new OntologyService(repository as unknown as OntologyDatabase, new OntologyEngine(repository));
  });

  it('executes TypeScript logic and records successful runs', async () => {
    const result = await service.executeLogicFunction({ workspaceId: 'runtime', id: 'double-value', arguments: { value: 4 } });

    expect(result.execution).toMatchObject({ kind: 'logic', artifactId: 'double-value', code: 'double_value', output: 8 });
    expect(result.snapshot.logicFunctions[0]).toMatchObject({ executionCount: 1, lastExecutedAt: expect.any(Number) });
  });

  it('executes function actions through their linked logic function and records both runs', async () => {
    const result = await service.executeAction({ workspaceId: 'runtime', code: 'double_action', arguments: { value: 6 } });

    expect(result.execution).toMatchObject({ kind: 'action', artifactId: 'double-action', output: 12 });
    expect(result.snapshot.actions[0]).toMatchObject({ executionCount: 1, lastExecutedAt: expect.any(Number) });
    expect(result.snapshot.logicFunctions[0]).toMatchObject({ executionCount: 1, lastExecutedAt: expect.any(Number) });
  });

  it('validates required arguments before executing runtime artifacts', async () => {
    await expect(service.executeLogicFunction({ workspaceId: 'runtime', id: 'double-value' })).rejects.toThrow('Required argument "value" is missing.');
    expect(repository.getSnapshot('runtime')?.logicFunctions[0].executionCount).toBe(0);
  });

  it('executes API actions with templated request data', async () => {
    let receivedBody = '';
    const server = http.createServer((request, response) => {
      request.on('data', (chunk: Buffer) => {
        receivedBody += chunk.toString();
      });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ accepted: true, path: request.url }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const snapshot = repository.getSnapshot('runtime')!;
      snapshot.actions = [
        {
          id: 'api-action',
          code: 'send_customer',
          name: 'Send Customer',
          executor: 'api',
          objectIds: ['customer-object'],
          description: '',
          configuration: {
            url: `http://127.0.0.1:${port}/customers/{{customerId}}`,
            method: 'POST',
            body: { amount: '{{amount}}' },
          },
          parameters: [
            { name: 'customerId', type: 'string', required: true },
            { name: 'amount', type: 'number', required: true },
          ],
          outputSchema: [],
          origin: 'manual',
          status: 'active',
          executionCount: 0,
          updatedAt: 100,
        },
      ];
      repository.saveSnapshot(snapshot);

      const result = await service.executeAction({
        workspaceId: 'runtime',
        id: 'api-action',
        arguments: { customerId: 'customer-1', amount: 42 },
      });

      expect(result.execution.output).toMatchObject({ status: 200, body: { accepted: true, path: '/customers/customer-1' } });
      expect(JSON.parse(receivedBody)).toEqual({ amount: 42 });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('executes custom scripts without a shell and passes arguments through stdin', async () => {
    const snapshot = repository.getSnapshot('runtime')!;
    snapshot.actions = [
      {
        id: 'script-action',
        code: 'echo_value',
        name: 'Echo Value',
        executor: 'custom_script',
        objectIds: [],
        description: '',
        configuration: {
          command: process.execPath,
          args: ['-e', "let value='';process.stdin.on('data',chunk=>value+=chunk);process.stdin.on('end',()=>console.log(JSON.stringify({echo:JSON.parse(value).text})));"],
        },
        parameters: [{ name: 'text', type: 'string', required: true }],
        outputSchema: [],
        origin: 'manual',
        status: 'active',
        executionCount: 0,
        updatedAt: 100,
      },
    ];
    repository.saveSnapshot(snapshot);

    const result = await service.executeAction({ workspaceId: 'runtime', id: 'script-action', arguments: { text: 'hello' } });

    expect(result.execution.output).toEqual({ echo: 'hello' });
    expect(result.snapshot.actions[0].executionCount).toBe(1);
  });

  it('renders and delivers desktop notification actions', async () => {
    const snapshot = repository.getSnapshot('runtime')!;
    snapshot.actions = [
      {
        id: 'notification-action',
        code: 'notify_customer',
        name: 'Notify Customer',
        executor: 'notification',
        objectIds: ['customer-object'],
        description: '',
        configuration: { title: 'Customer alert', message: 'Customer {{customerId}} requires attention.' },
        parameters: [{ name: 'customerId', type: 'string', required: true }],
        outputSchema: [{ name: 'delivered', type: 'boolean' }],
        origin: 'manual',
        status: 'active',
        executionCount: 0,
        updatedAt: 100,
      },
    ];
    repository.saveSnapshot(snapshot);

    const result = await service.executeAction({
      workspaceId: 'runtime',
      id: 'notification-action',
      arguments: { customerId: 'customer-1' },
    });

    expect(result.execution.output).toEqual({
      delivered: true,
      title: 'Customer alert',
      message: 'Customer customer-1 requires attention.',
    });
  });
});
