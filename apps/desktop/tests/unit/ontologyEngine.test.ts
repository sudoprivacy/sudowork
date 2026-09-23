import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { OntologyEngine } from '@sudowork/ontology-engine';
import { summarizeOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyRepository } from '@sudowork/ontology-engine';
import type { IOntologyDocumentExtraction, IOntologyGenerateDraftInput, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';

class MemoryOntologyRepository implements IOntologyRepository {
  private readonly snapshots = new Map<string, IOntologyWorkbenchSnapshot>();

  getSnapshot(workspaceId: string): IOntologyWorkbenchSnapshot | null {
    const snapshot = this.snapshots.get(workspaceId);
    return snapshot ? structuredClone(snapshot) : null;
  }

  listSnapshots(): IOntologyWorkbenchSnapshot[] {
    return Array.from(this.snapshots.values())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((snapshot) => structuredClone(snapshot));
  }

  saveSnapshot(snapshot: IOntologyWorkbenchSnapshot, expectedSnapshot?: IOntologyWorkbenchSnapshot): void {
    if (expectedSnapshot && !isDeepStrictEqual(this.snapshots.get(snapshot.workspaceId), expectedSnapshot)) {
      throw new Error('ontology.documentErrors.conflict');
    }
    this.snapshots.set(snapshot.workspaceId, structuredClone(snapshot));
  }

  deleteSnapshot(workspaceId: string): void {
    this.snapshots.delete(workspaceId);
  }

  resetSnapshot(workspaceId: string): void {
    this.snapshots.delete(workspaceId);
  }
}

async function createAttributeWorkbench(engine: OntologyEngine): Promise<IOntologyWorkbenchSnapshot> {
  await engine.importFiles({ filePaths: ['/tmp/customer.csv', '/tmp/order.csv'] }, [
    {
      path: '/tmp/customer.csv',
      name: 'customer.csv',
      sizeBytes: 128,
      extension: '.csv',
      fields: [
        { name: 'customer_id', dataType: 'string', nullable: false },
        { name: 'customer_name', dataType: 'string', nullable: true },
      ],
    },
    {
      path: '/tmp/order.csv',
      name: 'order.csv',
      sizeBytes: 128,
      extension: '.csv',
      fields: [
        { name: 'order_id', dataType: 'string', nullable: false },
        { name: 'customer_id', dataType: 'string', nullable: false },
      ],
    },
  ]);
  return engine.generateDraft();
}

async function createDocumentWorkbench() {
  const repository = new MemoryOntologyRepository();
  const engine = new OntologyEngine(repository);
  const imported = await engine.importFiles({ filePaths: ['/tmp/model.md', '/tmp/context.txt', '/tmp/records.csv'] }, [
    { path: '/tmp/model.md', name: 'model.md', sizeBytes: 128, extension: '.md' },
    { path: '/tmp/context.txt', name: 'context.txt', sizeBytes: 128, extension: '.txt' },
    { path: '/tmp/records.csv', name: 'records.csv', sizeBytes: 128, extension: '.csv', fields: [{ name: 'reference', dataType: 'string' }] },
  ]);
  const documentAssetIds = imported.files.slice(0, 2).map((file) => file.id);
  const tableId = imported.files[2].id;
  const extraction: IOntologyDocumentExtraction = {
    objects: [
      {
        code: 'customer',
        name: 'Customer',
        description: 'A customer described in the document.',
        sourceAssetIds: documentAssetIds,
        attributes: [{ code: 'reference', name: 'Reference', dataType: 'string', required: true, description: 'Customer reference.' }],
      },
      { code: 'order', name: 'Order', description: 'A customer order.', sourceAssetIds: [documentAssetIds[1]], attributes: [] },
    ],
    relations: [{ code: 'customer_orders', name: 'Customer orders', description: 'Orders placed by customers.', from: 'customer', to: 'order', cardinality: 'one_to_many' }],
  };
  const generate = (result = extraction, input: IOntologyGenerateDraftInput = {}) => engine.generateDraft({ assetIds: documentAssetIds, documentAssetIds, mode: 'merge', ...input }, 'default', { extraction: result, expectedSnapshot: repository.getSnapshot('default')! });
  return { repository, engine, imported, documentAssetIds, tableId, extraction, generate };
}

describe('OntologyEngine document extraction', () => {
  it('rejects quality rule expressions with invalid syntax or unknown object attributes', async () => {
    const engine = new OntologyEngine(new MemoryOntologyRepository());
    const snapshot = await engine.upsertObject({ name: 'Transaction', code: 'transaction' });
    const withAmount = await engine.upsertAttribute({
      objectId: snapshot.objects[0].id,
      name: 'Amount',
      code: 'amount',
      dataType: 'number',
    });

    await expect(
      engine.upsertQualityRule({
        objectId: withAmount.objects[0].id,
        name: 'Positive amount',
        expression: 'amount >',
        severity: 'error',
      })
    ).rejects.toThrow(/Expected an attribute or literal value/);
    await expect(
      engine.upsertQualityRule({
        objectId: withAmount.objects[0].id,
        name: 'Known attribute',
        expression: 'missing > 0',
        severity: 'error',
      })
    ).rejects.toThrow(/Unknown ontology attribute "missing"/);
    await expect(
      engine.upsertQualityRule({
        objectId: withAmount.objects[0].id,
        name: 'Positive amount',
        expression: 'amount > 0',
        severity: 'error',
      })
    ).resolves.toMatchObject({ qualityRules: [expect.objectContaining({ expression: 'amount > 0' })] });
  });

  it('rejects active runtime artifacts that have no executable implementation', async () => {
    const engine = new OntologyEngine(new MemoryOntologyRepository());
    const snapshot = await engine.upsertObject({ name: 'Customer', code: 'customer' });

    await expect(
      engine.upsertLogicFunction({
        name: 'Empty Logic',
        runtime: 'typescript',
        objectIds: [snapshot.objects[0].id],
        body: '',
      })
    ).rejects.toThrow(/implementation body is required/);
    await expect(
      engine.upsertAction({
        name: 'Empty Notification',
        executor: 'notification',
        objectIds: [snapshot.objects[0].id],
        configuration: {},
      })
    ).rejects.toThrow(/configuration\.message is required/);
    await expect(
      engine.upsertLogicFunction({
        name: 'Draft Logic',
        runtime: 'typescript',
        objectIds: [snapshot.objects[0].id],
        body: '',
        status: 'draft',
      })
    ).resolves.toMatchObject({ logicFunctions: expect.arrayContaining([expect.objectContaining({ name: 'Draft Logic', status: 'draft' })]) });
  });

  it('validates field-level relation bindings and relation semantics', async () => {
    const engine = new OntologyEngine(new MemoryOntologyRepository());
    let snapshot = await engine.upsertObject({ name: 'Customer', code: 'customer' });
    const customerId = snapshot.objects[0].id;
    snapshot = await engine.upsertAttribute({ objectId: customerId, name: 'ID', code: 'id', dataType: 'string', required: true });
    snapshot = await engine.upsertObject({ name: 'Order', code: 'order' });
    const orderId = snapshot.objects.find((object) => object.code === 'order')!.id;
    snapshot = await engine.upsertAttribute({ objectId: orderId, name: 'Customer ID', code: 'customer_id', dataType: 'string', required: true });
    const customerAttributeId = snapshot.objects.find((object) => object.id === customerId)!.attributes[0].id;
    const orderAttributeId = snapshot.objects.find((object) => object.id === orderId)!.attributes[0].id;

    const withRelation = await engine.upsertRelation({
      name: 'Customer Orders',
      fromObjectId: customerId,
      toObjectId: orderId,
      cardinality: 'one_to_many',
      relationType: 'object_property',
      semanticType: 'association',
      dataBinding: {
        mode: 'direct',
        joinKeys: [{ fromAttributeId: customerAttributeId, toAttributeId: orderAttributeId }],
      },
    });
    expect(withRelation.relations[0].dataBinding).toEqual({
      mode: 'direct',
      joinKeys: [{ fromAttributeId: customerAttributeId, toAttributeId: orderAttributeId }],
      origin: 'manual',
    });

    await expect(
      engine.upsertRelation({
        name: 'Broken Join',
        fromObjectId: customerId,
        toObjectId: orderId,
        cardinality: 'one_to_many',
        dataBinding: { mode: 'direct', joinKeys: [{ fromAttributeId: 'missing', toAttributeId: orderAttributeId }] },
      })
    ).rejects.toThrow(/join keys must reference attributes/);
    await expect(
      engine.upsertRelation({
        name: 'Invalid Functional Relation',
        fromObjectId: customerId,
        toObjectId: orderId,
        cardinality: 'one_to_many',
        relationType: 'functional_property',
      })
    ).rejects.toThrow(/one-to-one or many-to-one/);
    await expect(
      engine.upsertRelation({
        name: 'Invalid Transitive Relation',
        fromObjectId: customerId,
        toObjectId: orderId,
        cardinality: 'many_to_many',
        relationType: 'transitive_property',
      })
    ).rejects.toThrow(/same source and target object/);
    for (const semanticType of ['association', 'composition', 'event', 'inheritance', 'dependency'] as const) {
      await expect(
        engine.upsertRelation({
          code: `semantic_${semanticType}`,
          name: `Semantic ${semanticType}`,
          fromObjectId: customerId,
          toObjectId: orderId,
          cardinality: 'one_to_many',
          relationType: 'object_property',
          semanticType,
          dataBinding: { mode: 'semantic_only', joinKeys: [] },
        })
      ).resolves.toEqual(expect.objectContaining({ relations: expect.arrayContaining([expect.objectContaining({ semanticType })]) }));
    }
    await expect(
      engine.upsertRelation({
        name: 'Functional Customer Order',
        fromObjectId: customerId,
        toObjectId: orderId,
        cardinality: 'many_to_one',
        relationType: 'functional_property',
        dataBinding: { mode: 'semantic_only', joinKeys: [] },
      })
    ).resolves.toEqual(expect.objectContaining({ relations: expect.arrayContaining([expect.objectContaining({ relationType: 'functional_property' })]) }));
    const withoutJoinAttribute = await engine.deleteAttribute({ objectId: orderId, attributeId: orderAttributeId });
    expect(withoutJoinAttribute.relations[0].dataBinding).toBeUndefined();
  });

  it('upgrades legacy relation snapshots and infers unambiguous mapped join keys', async () => {
    const repository = new MemoryOntologyRepository();
    const snapshot = await createAttributeWorkbench(new OntologyEngine(repository));
    const legacy = structuredClone(snapshot) as IOntologyWorkbenchSnapshot & { schemaVersion: number };
    legacy.schemaVersion = 2;
    legacy.relations = legacy.relations.map(({ dataBinding: _dataBinding, ...relation }) => relation);
    repository.saveSnapshot(legacy as IOntologyWorkbenchSnapshot);

    const normalized = await new OntologyEngine(repository).getWorkbench();

    expect(normalized.schemaVersion).toBe(3);
    expect(normalized.relations[0].dataBinding).toMatchObject({
      mode: 'direct',
      origin: 'inferred',
      joinKeys: [
        {
          fromAttributeId: normalized.objects[0].attributes[0].id,
          toAttributeId: normalized.objects[1].attributes[1].id,
        },
      ],
    });
    expect(repository.getSnapshot('default')?.schemaVersion).toBe(3);
  });

  it('uses different extracted models for the same assets without filename-based fields or relations', async () => {
    const { generate, extraction, documentAssetIds } = await createDocumentWorkbench();
    const first = await generate();
    expect(first.objects.map((object) => object.code)).toEqual(['customer', 'order']);
    expect(first.objects[0]).toMatchObject({ tier: 3, status: 'active', reviewDecision: 'pending', sourceAssetIds: expect.arrayContaining(documentAssetIds) });
    expect(first.objects[0].attributes).toEqual([expect.objectContaining(extraction.objects[0].attributes[0])]);
    expect(first.objects[0].attributes[0].mappedField).toBeUndefined();
    expect(first.objects[1].attributes).toEqual([]);
    expect(first.relations).toEqual([expect.objectContaining({ code: 'customer_orders', fromObjectId: first.objects[0].id, toObjectId: first.objects[1].id })]);

    const second = await generate(
      {
        objects: [{ code: 'shipment', name: 'Shipment', description: 'A delivery.', sourceAssetIds: documentAssetIds, attributes: [] }],
        relations: [],
      },
      { businessGoal: '  Track delivery operations.  ' }
    );
    expect(second.objects.map((object) => object.code)).toEqual(['shipment']);
    expect(second.objects[0].attributes).toEqual([]);
    expect(second.relations).toEqual([]);
    expect(second.mappings).toEqual([]);
    expect(second.qualityRules).toEqual([]);
    expect(second.draft.businessGoal).toBe('Track delivery operations.');
    expect(second.businessDocuments[0].content).toContain('Track delivery operations.');
  });

  it('keeps empty relations explicit even with multiple extracted objects', async () => {
    const { generate, extraction } = await createDocumentWorkbench();
    await generate();
    const generated = await generate({ ...extraction, objects: extraction.objects.map((object) => ({ ...object, attributes: [] })), relations: [] });
    expect(generated.objects).toHaveLength(2);
    expect(generated.objects.every((object) => object.attributes.length === 0)).toBe(true);
    expect(generated.relations).toEqual([]);
    expect(generated.mappings).toEqual([]);
  });

  it('preserves IDs, source sets, manual metadata and unchanged reviews across regeneration', async () => {
    const { repository, engine, generate, extraction, tableId } = await createDocumentWorkbench();
    const first = await generate();
    const customer = first.objects[0];
    const attribute = customer.attributes[0];
    await engine.upsertObject({ ...customer, namespace: 'crm', tier: 1, status: 'warning' });
    await engine.upsertAttribute({
      ...attribute,
      objectId: customer.id,
      constraints: { minLength: 2, maxLength: 24 },
      example: 'C-1',
      mappedField: { assetId: tableId, fieldName: 'reference' },
    });
    const withMapping = await engine.getWorkbench();
    await engine.upsertMapping({ ...withMapping.mappings[0], strategy: 'manual', confidence: 0.75, status: 'pending' });
    await engine.approveAll();
    const before = repository.getSnapshot('default')!;
    const normalizedExtraction = structuredClone(extraction);
    normalizedExtraction.objects[0].sourceAssetIds.reverse();
    normalizedExtraction.objects[0].code = 'Customer';
    normalizedExtraction.objects[0].attributes[0].code = ' Reference ';
    const second = await generate(normalizedExtraction);
    expect(second.objects).toEqual(before.objects);
    expect(second.relations).toEqual(before.relations);
    expect(second.mappings).toEqual(before.mappings);
    expect(second.objects[0].attributes[0]).toMatchObject({ id: attribute.id, example: 'C-1', constraints: { minLength: 2, maxLength: 24 }, mappedField: { assetId: tableId, fieldName: 'reference' } });

    const changed = structuredClone(extraction);
    changed.objects[0].attributes[0].required = false;
    changed.objects[0].description = 'Updated customer description.';
    changed.relations[0].cardinality = 'many_to_many';
    const third = await generate(changed);
    expect(third.objects[0]).toMatchObject({ id: customer.id, namespace: 'crm', tier: 1, status: 'warning', reviewDecision: 'pending' });
    expect(third.objects[0].attributes[0].id).toBe(attribute.id);
    expect(third.objects[1].reviewDecision).toBe('approved');
    expect(third.relations[0]).toMatchObject({ id: first.relations[0].id, reviewDecision: 'pending', cardinality: 'many_to_many' });
    expect(third.qualityRules).toEqual([]);
  });

  it('prunes removed attributes and invalid mappings while keeping valid manual mappings', async () => {
    const { repository, engine, generate, extraction, tableId } = await createDocumentWorkbench();
    const first = await generate();
    const customer = first.objects[0];
    const reference = customer.attributes[0];
    await engine.upsertMapping({ objectId: customer.id, attributeId: reference.id, assetId: tableId, fieldName: 'reference', strategy: 'manual' });
    const withExtra = await engine.upsertAttribute({ objectId: customer.id, code: 'obsolete', name: 'Obsolete', dataType: 'string', mappedField: { assetId: tableId, fieldName: 'reference' } });
    const removedAttributeId = withExtra.objects[0].attributes[1].id;
    const stale = repository.getSnapshot('default')!;
    stale.objects[0].attributes[0].mappedField = { assetId: tableId, fieldName: 'missing' };
    repository.saveSnapshot(stale);
    const generated = await generate();
    expect(generated.objects[0].attributes).toHaveLength(1);
    expect(generated.objects[0].attributes[0].mappedField).toBeUndefined();
    expect(generated.mappings).toEqual([expect.objectContaining({ attributeId: reference.id, strategy: 'manual', fieldName: 'reference' })]);
    expect(generated.mappings.some((mapping) => mapping.attributeId === removedAttributeId)).toBe(false);
    const withoutAttributes = await generate({ ...extraction, objects: extraction.objects.map((object) => ({ ...object, attributes: [] })) });
    expect(withoutAttributes.mappings).toEqual([]);
    expect(withoutAttributes.qualityRules).toEqual([]);
  });

  it('removes stale internal and dangling relations while preserving unrelated objects and external relations', async () => {
    const { engine, generate, extraction } = await createDocumentWorkbench();
    const first = await generate();
    const customer = first.objects[0];
    const order = first.objects[1];
    const manual = await engine.upsertObject({ code: 'manual', name: 'Manual' });
    const manualId = manual.objects[2].id;
    await engine.upsertObject({ code: 'other', name: 'Other' });
    const otherId = (await engine.getWorkbench()).objects[3].id;
    await engine.upsertRelation({ code: 'external', name: 'External', fromObjectId: customer.id, toObjectId: manualId, cardinality: 'one_to_one' });
    await engine.upsertRelation({ code: 'dangling', name: 'Dangling', fromObjectId: order.id, toObjectId: manualId, cardinality: 'one_to_one' });
    const before = await engine.upsertRelation({ code: 'unrelated', name: 'Unrelated', fromObjectId: manualId, toObjectId: otherId, cardinality: 'one_to_one' });
    const generated = await generate({ objects: [extraction.objects[0]], relations: [] }, { mode: 'replace' });
    expect(generated.objects.map((object) => object.code)).toEqual(['manual', 'other', 'customer']);
    expect(generated.objects.slice(0, 2)).toEqual(before.objects.slice(2));
    expect(generated.relations).toEqual(before.relations.filter((relation) => ['external', 'unrelated'].includes(relation.code)));
    expect(generated.relations.some((relation) => relation.fromObjectId === order.id || relation.toObjectId === order.id)).toBe(false);
    expect(generated.logicFunctions.every((item) => !item.objectIds.includes(order.id))).toBe(true);
    expect((await engine.runConsistencyCheck()).isValid).toBe(true);
  });

  it.each(['manual', 'ambiguous', 'source-set', 'partial-source'] as const)('rejects %s object conflicts without writes', async (scenario) => {
    const { repository, engine, extraction, documentAssetIds, generate } = await createDocumentWorkbench();
    if (scenario === 'manual') {
      await engine.upsertObject({ code: 'Customer', name: 'Unrelated Customer' });
    } else {
      await generate();
    }
    if (scenario === 'ambiguous') {
      const snapshot = repository.getSnapshot('default')!;
      snapshot.objects.push({ ...snapshot.objects[0], id: 'duplicate-customer' });
      repository.saveSnapshot(snapshot);
    }
    const result = structuredClone(extraction);
    const input: IOntologyGenerateDraftInput = {};
    if (scenario === 'source-set') result.objects[0].sourceAssetIds = [documentAssetIds[0]];
    if (scenario === 'partial-source') {
      input.assetIds = [documentAssetIds[0]];
      input.documentAssetIds = [documentAssetIds[0]];
      result.objects = [{ ...result.objects[0], sourceAssetIds: [documentAssetIds[0]] }];
      result.relations = [];
    }
    const before = repository.getSnapshot('default');
    const save = vi.spyOn(repository, 'saveSnapshot');
    await expect(generate(result, input)).rejects.toThrow('ontology.documentErrors.conflict');
    expect(repository.getSnapshot('default')).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects extracted relation codes colliding with external relations', async () => {
    const { repository, engine, extraction, generate } = await createDocumentWorkbench();
    const first = await generate({ ...extraction, relations: [] });
    const manual = await engine.upsertObject({ code: 'manual', name: 'Manual' });
    await engine.upsertRelation({ code: 'customer_orders', name: 'Manual link', fromObjectId: first.objects[0].id, toObjectId: manual.objects[2].id, cardinality: 'one_to_one' });
    const before = repository.getSnapshot('default');
    await expect(generate()).rejects.toThrow('ontology.documentErrors.conflict');
    expect(repository.getSnapshot('default')).toEqual(before);
  });

  it('matches sources beyond the first source and retains objects from unselected documents', async () => {
    const { repository, extraction, generate, documentAssetIds } = await createDocumentWorkbench();
    const first = await generate({ objects: [{ ...extraction.objects[0], sourceAssetIds: [documentAssetIds[0]] }, extraction.objects[1]], relations: [] });
    const generated = await generate({ objects: [extraction.objects[1]], relations: [] }, { assetIds: [documentAssetIds[1]], documentAssetIds: [documentAssetIds[1]] });
    expect(generated.objects).toEqual(first.objects);
    const multiSource = repository.getSnapshot('default')!;
    multiSource.objects[1].sourceAssetIds = [documentAssetIds[0], documentAssetIds[1]];
    repository.saveSnapshot(multiSource);
    await expect(generate({ objects: [extraction.objects[1]], relations: [] }, { assetIds: [documentAssetIds[1]], documentAssetIds: [documentAssetIds[1]] })).rejects.toThrow('ontology.documentErrors.conflict');
    expect(repository.getSnapshot('default')).toEqual(multiSource);
  });

  it('keeps mixed structured generation separate and routes explicitly selected CSV documents through extraction only', async () => {
    const { engine, generate, extraction, documentAssetIds, tableId } = await createDocumentWorkbench();
    const more = await engine.importFiles({ filePaths: ['/tmp/warehouse.csv'] }, [{ path: '/tmp/warehouse.csv', name: 'warehouse.csv', sizeBytes: 32, extension: '.csv', fields: [{ name: 'stock', dataType: 'number' }] }]);
    const warehouseId = more.files[0].id;
    const first = await generate({ ...extraction, relations: [] }, { assetIds: [...documentAssetIds, tableId, warehouseId] });
    expect(first.objects.map((object) => object.code)).toEqual(['records', 'warehouse', 'customer', 'order']);
    expect(first.objects[0].attributes[0].mappedField).toEqual({ assetId: tableId, fieldName: 'reference' });
    expect(first.relations).toEqual([expect.objectContaining({ code: 'records_to_warehouse', fromObjectId: first.objects[0].id, toObjectId: first.objects[1].id })]);
    const second = await generate({ objects: [{ ...extraction.objects[0], code: 'record_domain', sourceAssetIds: [tableId] }], relations: [] }, { assetIds: [tableId], documentAssetIds: [tableId] });
    expect(second.objects.some((object) => object.code === 'records')).toBe(false);
    expect(second.objects.find((object) => object.code === 'record_domain')?.attributes[0].mappedField).toBeUndefined();
    expect(second.relations).toEqual([]);
  });

  it.each(['missing-context', 'empty-selection', 'unknown-selection', 'unselected-document', 'unknown-source', 'empty-sources', 'empty-result', 'unknown-endpoint', 'workspace-mismatch', 'implicit-document'] as const)('rejects %s without mutation', async (scenario) => {
    const { repository, engine, extraction, documentAssetIds } = await createDocumentWorkbench();
    const result = structuredClone(extraction);
    const input: IOntologyGenerateDraftInput = { assetIds: documentAssetIds, documentAssetIds, mode: 'merge' };
    let expectedError = 'invalidResult';
    if (scenario === 'empty-selection') {
      input.documentAssetIds = [];
      expectedError = 'invalidSelection';
    }
    if (scenario === 'unknown-selection') {
      input.assetIds = ['missing'];
      input.documentAssetIds = ['missing'];
      expectedError = 'invalidSelection';
    }
    if (scenario === 'unselected-document') {
      input.assetIds = [documentAssetIds[0]];
      expectedError = 'invalidSelection';
    }
    if (scenario === 'unknown-source') result.objects[0].sourceAssetIds = ['missing'];
    if (scenario === 'empty-sources') result.objects[0].sourceAssetIds = [];
    if (scenario === 'empty-result') result.objects = [];
    if (scenario === 'unknown-endpoint') result.relations[0].to = 'missing';
    if (scenario === 'workspace-mismatch') {
      input.workspaceId = 'other';
      expectedError = 'invalidSelection';
    }
    if (scenario === 'implicit-document') {
      input.documentAssetIds = [];
      expectedError = 'invalidSelection';
    }
    const before = repository.getSnapshot('default')!;
    const save = vi.spyOn(repository, 'saveSnapshot');
    await expect(engine.generateDraft(input, 'default', scenario === 'missing-context' || scenario === 'implicit-document' ? undefined : { extraction: result, expectedSnapshot: before })).rejects.toThrow(`ontology.documentErrors.${expectedError}`);
    expect(repository.getSnapshot('default')).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });

  it.each(['delete', 'edit'] as const)('rejects workspace %s during extraction without overwriting or recreating it', async (scenario) => {
    const { repository, engine, extraction, documentAssetIds } = await createDocumentWorkbench();
    const expectedSnapshot = repository.getSnapshot('default')!;
    if (scenario === 'delete') repository.deleteSnapshot('default');
    else repository.saveSnapshot({ ...expectedSnapshot, draft: { ...expectedSnapshot.draft, title: 'Concurrent edit' } });
    const before = repository.getSnapshot('default');
    const save = vi.spyOn(repository, 'saveSnapshot');
    await expect(engine.generateDraft({ assetIds: documentAssetIds, documentAssetIds }, 'default', { extraction, expectedSnapshot })).rejects.toThrow('ontology.documentErrors.conflict');
    expect(repository.getSnapshot('default')).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });

  it.each(['delete', 'edit'] as const)('enforces atomic CAS when workspace %s occurs after the initial comparison', async (scenario) => {
    const { repository, engine, extraction, documentAssetIds } = await createDocumentWorkbench();
    const expectedSnapshot = repository.getSnapshot('default')!;
    const concurrent = { ...expectedSnapshot, draft: { ...expectedSnapshot.draft, title: 'Concurrent edit' } };
    const saveSnapshot = repository.saveSnapshot.bind(repository);
    const save = vi.spyOn(repository, 'saveSnapshot').mockImplementationOnce((snapshot, expected) => {
      expect(expected).toBe(expectedSnapshot);
      if (scenario === 'delete') repository.deleteSnapshot('default');
      else saveSnapshot(concurrent);
      saveSnapshot(snapshot, expected);
    });
    await expect(engine.generateDraft({ assetIds: documentAssetIds, documentAssetIds }, 'default', { extraction, expectedSnapshot })).rejects.toThrow('ontology.documentErrors.conflict');
    expect(repository.getSnapshot('default')).toEqual(scenario === 'delete' ? null : concurrent);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each(['attribute', 'relation'] as const)('rejects ambiguous existing %s matches without changing the draft', async (scenario) => {
    const { repository, generate } = await createDocumentWorkbench();
    await generate();
    const before = repository.getSnapshot('default')!;
    if (scenario === 'attribute') before.objects[0].attributes.push({ ...before.objects[0].attributes[0], id: 'duplicate-attribute' });
    else before.relations.push({ ...before.relations[0], id: 'duplicate-relation' });
    repository.saveSnapshot(before);
    await expect(generate()).rejects.toThrow('ontology.documentErrors.conflict');
    expect(repository.getSnapshot('default')).toEqual(before);
  });

  it.each(['object', 'relation'] as const)('rejects mixed generation %s code collisions', async (scenario) => {
    const { repository, engine, generate, extraction, tableId, documentAssetIds } = await createDocumentWorkbench();
    const imported = await engine.importFiles({ filePaths: ['/tmp/warehouse.csv'] }, [{ path: '/tmp/warehouse.csv', name: 'warehouse.csv', sizeBytes: 32, extension: '.csv' }]);
    const result = structuredClone(extraction);
    if (scenario === 'object') result.objects[0].code = 'records';
    else result.relations[0].code = 'records_to_warehouse';
    const before = repository.getSnapshot('default');
    await expect(generate(result, { assetIds: [...documentAssetIds, tableId, imported.files[0].id] })).rejects.toThrow('ontology.documentErrors.conflict');
    expect(repository.getSnapshot('default')).toEqual(before);
  });

  it('does not treat switching workbenches as permission to write to a different workspace', async () => {
    const { repository, engine, extraction, documentAssetIds } = await createDocumentWorkbench();
    const expectedSnapshot = repository.getSnapshot('default')!;
    const other = await engine.createWorkbench({ name: 'Other workbench' });
    const beforeOther = repository.getSnapshot(other.snapshot.workspaceId);
    const generated = await engine.generateDraft({ assetIds: documentAssetIds, documentAssetIds, workspaceId: 'default' }, 'default', { extraction, expectedSnapshot });
    expect(generated.workspaceId).toBe('default');
    expect(repository.getSnapshot(other.snapshot.workspaceId)).toEqual(beforeOther);
    expect(generated.objects).toHaveLength(2);
  });

  it('compares the raw snapshot and forwards it unchanged to a single conditional save', async () => {
    const { repository, engine, extraction, documentAssetIds } = await createDocumentWorkbench();
    await engine.upsertObject({ name: 'Legacy manual object' });
    const legacy = repository.getSnapshot('default')!;
    delete (legacy.objects[0] as Partial<(typeof legacy.objects)[0]>).tier;
    legacy.stats.objectCount = 0;
    repository.saveSnapshot(legacy);
    const expectedSnapshot = repository.getSnapshot('default')!;
    const original = structuredClone(expectedSnapshot);
    const save = vi.spyOn(repository, 'saveSnapshot');
    const generated = await engine.generateDraft({ assetIds: documentAssetIds, documentAssetIds }, 'default', { extraction, expectedSnapshot });
    expect(save).toHaveBeenCalledExactlyOnceWith(generated, expectedSnapshot);
    expect(save.mock.calls[0][1]).toBe(expectedSnapshot);
    expect(expectedSnapshot).toEqual(original);
    expect(generated.objects[0].tier).toBe(3);
    expect(repository.getSnapshot('default')).toEqual(generated);
  });
});

describe('OntologyEngine', () => {
  it('imports a structured ontology template without flattening it into one file object', async () => {
    const engine = new OntologyEngine(new MemoryOntologyRepository());
    const imported = await engine.importFiles({ filePaths: ['/tmp/customer-ontology.json'], purpose: 'template' }, [
      {
        path: '/tmp/customer-ontology.json',
        name: 'customer-ontology.json',
        sizeBytes: 256,
        extension: '.json',
        metadata: {
          ontologyTemplate: JSON.stringify({
            objects: [
              {
                code: 'customer',
                name: 'Customer',
                tier: 1,
                status: 'active',
                attributes: [{ code: 'customer_id', name: 'Customer ID', dataType: 'string', required: true }],
              },
              {
                code: 'order',
                name: 'Order',
                tier: 2,
                status: 'active',
                attributes: [{ code: 'order_id', name: 'Order ID', dataType: 'string', required: true }],
              },
            ],
            relations: [{ code: 'customer_orders', name: 'Customer Orders', from: 'customer', to: 'order', cardinality: 'one_to_many' }],
          }),
        },
      },
    ]);

    const generated = await engine.generateDraft({ assetIds: [imported.files[0].id], mode: 'merge' });
    expect(generated.objects.map((object) => object.code)).toEqual(['customer', 'order']);
    expect(generated.objects[0].attributes[0]).toMatchObject({ code: 'customer_id', required: true });
    expect(generated.relations).toHaveLength(1);
    expect(generated.relations[0]).toMatchObject({ code: 'customer_orders', cardinality: 'one_to_many' });

    const regenerated = await engine.generateDraft({ assetIds: [imported.files[0].id], mode: 'merge' });
    expect(regenerated.objects).toHaveLength(2);
    expect(regenerated.objects.map((object) => object.id)).toEqual(generated.objects.map((object) => object.id));
  });

  it('runs the workbench flow from asset import to Agent blueprint', async () => {
    const engine = new OntologyEngine(new MemoryOntologyRepository());
    await engine.updateDraft({
      title: 'Customer Demo',
      businessGoal: 'Build a customer service demo from CRM assets.',
    });

    const imported = await engine.importFiles({ filePaths: ['/tmp/customer.csv'] }, [
      {
        path: '/tmp/customer.csv',
        name: 'customer.csv',
        sizeBytes: 128,
        extension: '.csv',
        fields: [
          { name: 'customer_id', dataType: 'string', nullable: false },
          { name: 'customer_name', dataType: 'string', nullable: false },
        ],
      },
    ]);
    expect(imported.snapshot.assets).toHaveLength(1);

    const probed = await engine.probeConnector(
      {
        connector: {
          name: 'CRM SQLite',
          sourceType: 'sqlite',
          kind: 'database',
          path: '/tmp/crm.sqlite',
        },
      },
      [
        {
          id: 'asset-orders',
          kind: 'table',
          name: 'orders',
          sourceName: 'CRM SQLite',
          path: '/tmp/crm.sqlite#orders',
          profileStatus: 'ready',
          fields: [
            { name: 'order_id', dataType: 'string', nullable: false },
            { name: 'customer_id', dataType: 'string', nullable: false },
          ],
          metadata: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
    );
    expect(probed.snapshot.connectors).toHaveLength(1);
    expect(probed.snapshot.assets).toHaveLength(2);

    const generated = await engine.generateDraft();
    expect(generated.objects).toHaveLength(2);
    expect(generated.objects[0].attributes.map((item) => item.code)).toEqual(['customer_id', 'customer_name']);
    expect(generated.connections.length).toBeGreaterThan(0);
    expect(generated.mappings.length).toBeGreaterThanOrEqual(4);
    expect(generated.relations[0].dataBinding).toMatchObject({
      mode: 'direct',
      joinKeys: [
        {
          fromAttributeId: generated.objects[0].attributes[0].id,
          toAttributeId: generated.objects[1].attributes[1].id,
        },
      ],
    });
    expect(generated.qualityRules.length).toBeGreaterThan(0);
    expect(generated.logicFunctions).toHaveLength(2);
    expect(generated.actions).toHaveLength(4);
    expect(generated.serviceEndpoints).toHaveLength(3);
    expect(generated.businessDocuments).toHaveLength(1);
    expect(generated.impactAnalyses).toHaveLength(1);
    expect((await engine.runConsistencyCheck()).isValid).toBe(true);

    const additionalImport = await engine.importFiles({ filePaths: ['/tmp/inventory.csv'] }, [
      {
        path: '/tmp/inventory.csv',
        name: 'inventory.csv',
        sizeBytes: 96,
        extension: '.csv',
        fields: [{ name: 'inventory_id', dataType: 'string', nullable: false }],
      },
    ]);
    const mergedDraft = await engine.generateDraft({ assetIds: [additionalImport.files[0].id], mode: 'merge' });
    expect(mergedDraft.objects).toHaveLength(3);
    expect(generated.objects.every((object) => mergedDraft.objects.some((candidate) => candidate.id === object.id))).toBe(true);

    const withManualFunction = await engine.upsertLogicFunction({
      name: 'Calculate Lifetime Value',
      code: 'calculate_lifetime_value',
      description: 'Calculate customer lifetime value.',
      runtime: 'typescript',
      objectIds: [generated.objects[0].id],
      body: 'return 0;',
      returnType: 'number',
    });
    const manualFunctionId = withManualFunction.logicFunctions.find((item) => item.code === 'calculate_lifetime_value')?.id;
    const withManualAction = await engine.upsertAction({
      name: 'Notify Account Owner',
      code: 'notify_account_owner_manual',
      executor: 'notification',
      objectIds: [generated.objects[0].id],
      configuration: { channel: 'desktop', message: 'Account requires attention.' },
    });
    const manualActionId = withManualAction.actions.find((item) => item.code === 'notify_account_owner_manual')?.id;

    const edited = await engine.upsertObject({
      id: generated.objects[0].id,
      name: 'Customer Account',
      code: 'customer_account',
      description: 'Reviewed customer object.',
      sourceAssetIds: generated.objects[0].sourceAssetIds,
    });
    expect(edited.objects[0].code).toBe('customer_account');
    expect(edited.logicFunctions.find((item) => item.id === manualFunctionId)?.body).toBe('return 0;');
    expect(edited.actions.find((item) => item.id === manualActionId)?.configuration).toEqual({ channel: 'desktop', message: 'Account requires attention.' });
    await engine.upsertAttribute({
      objectId: edited.objects[0].id,
      name: 'Segment',
      code: 'segment',
      dataType: 'string',
      required: false,
    });
    const relation = await engine.upsertRelation({
      name: 'Customer owns order',
      fromObjectId: edited.objects[0].id,
      toObjectId: edited.objects[1].id,
      cardinality: 'one_to_many',
    });
    expect(relation.relations.length).toBeGreaterThan(0);

    const approved = await engine.approveAll();
    expect(approved.stats.pendingReviewCount).toBe(0);
    expect(approved.stats.mappingCount).toBeGreaterThanOrEqual(4);
    expect(approved.monitorEvents.length).toBeGreaterThan(0);
    expect((await engine.runConsistencyCheck()).isValid).toBe(true);

    const published = await engine.publishCurrentDraft();
    expect(published.version.version).toBe('v1');
    expect(published.version.status).toBe('submitted');
    expect(published.version.isActive).toBe(false);
    expect(published.version.snapshot.objects.length).toBeGreaterThan(0);
    expect(published.version.diff.addedObjectIds.length).toBeGreaterThan(0);
    expect(published.snapshot.publishedVersions).toHaveLength(1);
    expect(summarizeOntologyWorkbenchSnapshot(published.snapshot).publishedVersionCount).toBe(0);

    const approvedVersion = await engine.approvePublishedVersion({ versionId: published.version.id, reviewerId: 'test-reviewer' });
    expect(approvedVersion.publishedVersions[0]).toMatchObject({ status: 'published', isActive: true, approvedBy: 'test-reviewer' });
    expect(summarizeOntologyWorkbenchSnapshot(approvedVersion).publishedVersionCount).toBe(1);

    const changed = await engine.upsertObject({ name: 'Temporary Object' });
    expect(changed.objects.some((item) => item.name === 'Temporary Object')).toBe(true);
    const rolledBack = await engine.rollbackToVersion({ versionId: published.version.id });
    expect(rolledBack.objects.some((item) => item.name === 'Temporary Object')).toBe(false);

    const agent = await engine.createAgentBlueprint({
      name: 'Customer Service Agent',
      ontologyVersionId: published.version.id,
    });
    expect(agent.blueprint.entityIds.length).toBeGreaterThan(0);
    expect(agent.snapshot.agentBlueprints).toHaveLength(1);
    const registered = await engine.registerAgentBlueprint({
      blueprintId: agent.blueprint.id,
      assistantId: 'ontology-customer-agent',
    });
    expect(registered.blueprint.status).toBe('registered');
    expect(registered.blueprint.registeredAssistantId).toBe('ontology-customer-agent');

    const withoutAgent = await engine.deleteAgentBlueprint({ id: registered.blueprint.id });
    expect(withoutAgent.agentBlueprints).toHaveLength(0);
  });

  it('updates an existing attribute without replacing its ID or changing unrelated attributes and objects', async () => {
    const repository = new MemoryOntologyRepository();
    const engine = new OntologyEngine(repository);
    const generated = await createAttributeWorkbench(engine);
    const [customer, order] = generated.objects;
    const [identifier, attribute] = customer.attributes;

    const updated = await engine.upsertAttribute({
      id: attribute.id,
      objectId: customer.id,
      name: 'Customer Display Name',
      code: 'display_name',
      dataType: 'string',
      required: true,
      mappedField: attribute.mappedField,
    });

    expect(updated.objects).toEqual([
      {
        ...customer,
        attributes: [identifier, { ...attribute, name: 'Customer Display Name', code: 'display_name', required: true }],
        updatedAt: expect.any(Number),
      },
      order,
    ]);
    expect(repository.getSnapshot(generated.workspaceId)).toEqual(updated);
  });

  it('persists explicitly submitted attribute metadata and constraints when updating an existing attribute', async () => {
    const repository = new MemoryOntologyRepository();
    const engine = new OntologyEngine(repository);
    const generated = await createAttributeWorkbench(engine);
    const customer = generated.objects[0];
    const attribute = customer.attributes[1];
    const description = 'Customer display name from the CRM export.';
    const mappedField = { assetId: customer.sourceAssetIds[0], fieldName: 'customer_name' };
    const constraints = { minLength: 1, maxLength: 80, pattern: '^[A-Za-z ]+$' };

    await engine.upsertAttribute({
      id: attribute.id,
      objectId: customer.id,
      name: 'Display Name',
      code: 'display_name',
      dataType: 'string',
      required: true,
      description,
      mappedField,
      constraints,
    });

    const persisted = repository.getSnapshot(generated.workspaceId);
    expect(persisted?.objects[0].attributes[1]).toEqual({
      ...attribute,
      name: 'Display Name',
      code: 'display_name',
      required: true,
      description,
      mappedField,
      constraints,
    });
  });

  it('rejects a duplicate normalized attribute code without changing the persisted snapshot', async () => {
    const repository = new MemoryOntologyRepository();
    const engine = new OntologyEngine(repository);
    const generated = await createAttributeWorkbench(engine);
    const customer = generated.objects[0];
    const attribute = customer.attributes[1];
    const before = repository.getSnapshot(generated.workspaceId);

    await expect(
      engine.upsertAttribute({
        id: attribute.id,
        objectId: customer.id,
        name: 'Renamed Customer',
        code: ' Customer-ID ',
        dataType: 'string',
        required: true,
      })
    ).rejects.toThrow('Attribute code "customer_id" already exists.');

    expect(repository.getSnapshot(generated.workspaceId)).toEqual(before);
    expect(await engine.getWorkbench(generated.workspaceId)).toEqual(generated);
  });

  it('deletes only the target attribute and its mappings while preserving unrelated mappings and objects', async () => {
    const repository = new MemoryOntologyRepository();
    const engine = new OntologyEngine(repository);
    const generated = await createAttributeWorkbench(engine);
    const [customer, order] = generated.objects;
    const [attribute, sibling] = customer.attributes;
    await engine.upsertMapping({
      objectId: customer.id,
      attributeId: attribute.id,
      assetId: order.sourceAssetIds[0],
      fieldName: 'customer_id',
      strategy: 'manual',
      status: 'approved',
    });
    const before = await engine.upsertMapping({
      objectId: order.id,
      attributeId: order.attributes[1].id,
      assetId: customer.sourceAssetIds[0],
      fieldName: 'customer_id',
      strategy: 'manual',
      status: 'approved',
    });
    const remainingMappings = before.mappings.filter((mapping) => mapping.attributeId !== attribute.id);
    expect(before.mappings.filter((mapping) => mapping.attributeId === attribute.id)).toHaveLength(2);
    expect(remainingMappings).toHaveLength(4);

    const deleted = await engine.deleteAttribute({ objectId: customer.id, attributeId: attribute.id });

    expect(deleted.objects).toEqual([{ ...customer, attributes: [sibling], updatedAt: expect.any(Number) }, order]);
    expect(deleted.mappings.some((mapping) => mapping.attributeId === attribute.id)).toBe(false);
    expect(deleted.mappings).toEqual(remainingMappings.map((mapping) => (mapping.strategy === 'manual' ? mapping : { ...mapping, id: expect.any(String), updatedAt: expect.any(Number) })));
    expect(deleted.assets).toEqual(before.assets);
    expect(repository.getSnapshot(generated.workspaceId)).toEqual(deleted);
  });

  it('publishes without object approval and still requires a published version for Agent blueprints', async () => {
    const engine = new OntologyEngine(new MemoryOntologyRepository());
    await engine.updateDraft({ businessGoal: 'A small governed model.' });
    const generated = await engine.generateDraft();
    await engine.upsertAttribute({
      objectId: generated.objects[0].id,
      name: 'Identifier',
      dataType: 'string',
      required: true,
    });
    const submitted = await engine.publishCurrentDraft();

    await expect(
      engine.createAgentBlueprint({
        name: 'Too Early',
        ontologyVersionId: submitted.version.id,
      })
    ).rejects.toThrow(/published ontology version/i);
    const rejected = await engine.rejectPublishedVersion({ versionId: submitted.version.id, reason: 'Missing owner metadata.' });
    expect(rejected.publishedVersions[0]).toMatchObject({ status: 'rejected', isActive: false });
    await expect(engine.approvePublishedVersion({ versionId: submitted.version.id })).rejects.toThrow(/submitted/i);
  });

  it('publishes service versions for multiple ontology workbenches independently', async () => {
    const engine = new OntologyEngine(new MemoryOntologyRepository());
    const customer = await engine.createWorkbench({ name: 'Customer Domain', code: 'customer-domain' });
    await engine.updateDraft({ businessGoal: 'Model customer operations.' }, customer.snapshot.workspaceId);
    await engine.generateDraft(undefined, customer.snapshot.workspaceId);
    const customerVersion = await engine.publishCurrentDraft(customer.snapshot.workspaceId);
    await engine.approvePublishedVersion({ versionId: customerVersion.version.id }, customer.snapshot.workspaceId);

    const order = await engine.createWorkbench({ name: 'Order Domain', code: 'order-domain' }, customer.snapshot.workspaceId);
    await engine.updateDraft({ businessGoal: 'Model order operations.' }, order.snapshot.workspaceId);
    await engine.generateDraft(undefined, order.snapshot.workspaceId);
    const orderVersion = await engine.publishCurrentDraft(order.snapshot.workspaceId);
    await engine.approvePublishedVersion({ versionId: orderVersion.version.id }, order.snapshot.workspaceId);

    const customerSnapshot = await engine.getWorkbench(customer.snapshot.workspaceId);
    const orderSnapshot = await engine.getWorkbench(order.snapshot.workspaceId);
    expect(customerSnapshot.publishedVersions).toEqual([expect.objectContaining({ id: customerVersion.version.id, status: 'published', isActive: true })]);
    expect(orderSnapshot.publishedVersions).toEqual([expect.objectContaining({ id: orderVersion.version.id, status: 'published', isActive: true })]);
  });

  it('manages multiple ontology workbenches independently', async () => {
    const engine = new OntologyEngine(new MemoryOntologyRepository());
    const customer = await engine.createWorkbench({
      name: 'Customer Domain',
      code: 'customer-domain',
      description: 'Customer demo ontology.',
    });
    expect(customer.snapshot.workspaceId).toBe('customer_domain');

    await engine.importFiles(
      { filePaths: ['/tmp/customers.csv'] },
      [
        {
          path: '/tmp/customers.csv',
          name: 'customers.csv',
          sizeBytes: 64,
          extension: '.csv',
          fields: [{ name: 'customer_id', dataType: 'string' }],
        },
      ],
      customer.snapshot.workspaceId
    );
    await engine.generateDraft(undefined, customer.snapshot.workspaceId);

    const order = await engine.createWorkbench(
      {
        name: 'Order Domain',
        code: 'order-domain',
      },
      customer.snapshot.workspaceId
    );
    expect(order.snapshot.assets).toHaveLength(1);
    expect(order.snapshot.assets[0].id).not.toBe((await engine.getWorkbench(customer.snapshot.workspaceId)).assets[0].id);
    await engine.updateDraft({ businessGoal: 'Order fulfillment model.' }, order.snapshot.workspaceId);

    const list = await engine.listWorkbenches(order.snapshot.workspaceId);
    expect(list.items).toHaveLength(2);
    expect(list.items.find((item) => item.workspaceId === customer.snapshot.workspaceId)?.objectCount).toBe(1);
    expect(list.items.find((item) => item.workspaceId === order.snapshot.workspaceId)?.objectCount).toBe(0);
    expect(list.items.find((item) => item.workspaceId === order.snapshot.workspaceId)).toBeDefined();

    const reset = await engine.resetWorkbench(customer.snapshot.workspaceId);
    expect(reset.workspaceId).toBe(customer.snapshot.workspaceId);
    expect(reset.draft.title).toBe('Customer Domain');
    expect(reset.objects).toHaveLength(0);

    const deleted = await engine.deleteWorkbench({ workspaceId: order.snapshot.workspaceId }, order.snapshot.workspaceId);
    expect(deleted.activeWorkspaceId).toBe(customer.snapshot.workspaceId);
    expect(deleted.summaries.map((item) => item.workspaceId)).toEqual([customer.snapshot.workspaceId]);
  });

  it('syncs asset schema and protects referenced connector assets', async () => {
    const engine = new OntologyEngine(new MemoryOntologyRepository());
    const probed = await engine.probeConnector(
      {
        connector: {
          name: 'ERP Directory',
          sourceType: 'directory',
          kind: 'directory',
          path: '/tmp/erp',
        },
      },
      [
        {
          id: 'asset-products',
          kind: 'table',
          name: 'products',
          sourceName: 'ERP Directory',
          path: '/tmp/erp/products.csv',
          profileStatus: 'not_profiled',
          fields: [],
          metadata: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
    );
    const connectorId = probed.connector.id;
    const assetId = probed.assets[0].id;

    const synced = await engine.syncAssetSchema({ id: assetId });
    const syncedAsset = synced.assets.find((asset) => asset.id === assetId);
    expect(syncedAsset?.fields.length).toBeGreaterThan(0);
    expect(syncedAsset?.metadata.schemaSyncedAt).toEqual(expect.any(Number));

    const generated = await engine.generateDraft({ assetIds: [assetId] });
    expect(generated.objects[0].sourceAssetIds).toContain(assetId);
    await expect(engine.deleteAsset({ id: assetId })).rejects.toThrow(/referenced/);
    await expect(engine.deleteConnector({ id: connectorId })).rejects.toThrow(/cascade deletion/);

    const deleted = await engine.deleteConnector({
      id: connectorId,
      cascadeAssets: true,
    });
    expect(deleted.connectors.some((connector) => connector.id === connectorId)).toBe(false);
    expect(deleted.assets.some((asset) => asset.id === assetId)).toBe(false);
    expect(deleted.mappings.some((mapping) => mapping.assetId === assetId)).toBe(false);
    expect(deleted.objects[0].sourceAssetIds).not.toContain(assetId);
  });

  it('keeps a reachable empty connector distinct from a failed probe', async () => {
    const engine = new OntologyEngine(new MemoryOntologyRepository());
    const result = await engine.probeConnector(
      {
        connector: {
          name: 'Empty PostgreSQL',
          sourceType: 'postgresql',
          kind: 'database',
          host: 'localhost',
          database: 'empty',
        },
      },
      []
    );

    expect(result.connector.probeStatus).toBe('reachable');
    expect(result.assets).toEqual([]);
    expect(result.snapshot.phases.find((phase) => phase.phase === 'scan')?.status).toBe('completed');
  });
});
