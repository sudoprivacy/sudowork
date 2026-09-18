import { describe, expect, it } from 'vitest';
import { OntologyEngine } from '@sudowork/ontology-engine';
import { summarizeOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyRepository } from '@sudowork/ontology-engine';
import type { IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';

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

  saveSnapshot(snapshot: IOntologyWorkbenchSnapshot): void {
    this.snapshots.set(snapshot.workspaceId, structuredClone(snapshot));
  }

  deleteSnapshot(workspaceId: string): void {
    this.snapshots.delete(workspaceId);
  }

  resetSnapshot(workspaceId: string): void {
    this.snapshots.delete(workspaceId);
  }
}

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
      configuration: { channel: 'desktop' },
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
    expect(edited.actions.find((item) => item.id === manualActionId)?.configuration).toEqual({ channel: 'desktop' });
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
