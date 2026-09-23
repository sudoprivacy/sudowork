import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  IOntologyActionDefinition,
  IOntologyActionDefinitionInput,
  IOntologyAgentBlueprint,
  IOntologyAgentBlueprintInput,
  IOntologyAssetField,
  IOntologyAttributeDraft,
  IOntologyAttributeDraftInput,
  IOntologyBusinessDocument,
  IOntologyBrowseConnectorAssetsInput,
  IOntologyBrowseConnectorAssetsResult,
  IOntologyConnectionProfile,
  IOntologyConnectorConfig,
  IOntologyCreateWorkbenchInput,
  IOntologyDeleteWorkbenchInput,
  IOntologyConnectorInput,
  IOntologyConsistencyCheckResult,
  IOntologyDeleteAttributeInput,
  IOntologyDeleteConnectorInput,
  IOntologyDeleteInput,
  IOntologyDocumentExtraction,
  IOntologyEnvironmentAsset,
  IOntologyFieldMapping,
  IOntologyFieldMappingInput,
  IOntologyGenerateDraftInput,
  IOntologyImpactAnalysis,
  IOntologyImportedFile,
  IOntologyImportFilesInput,
  IOntologyLogicFunction,
  IOntologyLogicFunctionInput,
  IOntologyMonitorEvent,
  IOntologyObjectDraft,
  IOntologyObjectDraftInput,
  IOntologyPhaseTransitionInput,
  IOntologyProfileAssetInput,
  IOntologyProbeConnectorInput,
  IOntologyProbeConnectorResult,
  IOntologyPublishApprovalInput,
  IOntologyPublishedVersion,
  IOntologyQualityRule,
  IOntologyQualityRuleInput,
  IOntologyRejectVersionInput,
  IOntologyRelationDraft,
  IOntologyRelationDraftInput,
  IOntologyRelationDataBinding,
  IOntologyRegisterAgentInput,
  IOntologyReviewItem,
  IOntologyReviewTargetInput,
  IOntologyRollbackInput,
  IOntologyServiceEndpoint,
  IOntologySyncAssetSchemaInput,
  IOntologyVersionDiff,
  IOntologyVersionSnapshot,
  IOntologyWorkbenchDraftInput,
  IOntologyWorkbenchListResult,
  IOntologyWorkbenchMutationResult,
  IOntologyWorkbenchSnapshot,
  OntologyAssetKind,
  OntologyCapabilityId,
  OntologyJsonValue,
} from "@sudowork/ontology-common";
import {
  createDefaultOntologyWorkbenchSnapshot,
  ONTOLOGY_SNAPSHOT_SCHEMA_VERSION,
  recalculateOntologyStats,
  summarizeOntologyWorkbenchSnapshot,
  validateQualityRuleExpression,
} from "@sudowork/ontology-common";

export interface IOntologyRepository {
  getSnapshot(
    workspaceId: string,
  ):
    | IOntologyWorkbenchSnapshot
    | null
    | Promise<IOntologyWorkbenchSnapshot | null>;
  listSnapshots():
    | IOntologyWorkbenchSnapshot[]
    | Promise<IOntologyWorkbenchSnapshot[]>;
  saveSnapshot(
    snapshot: IOntologyWorkbenchSnapshot,
    expectedSnapshot?: IOntologyWorkbenchSnapshot,
  ): void | Promise<void>;
  deleteSnapshot(workspaceId: string): void | Promise<void>;
  resetSnapshot(workspaceId: string): void | Promise<void>;
}

export interface IOntologyFileStat {
  path: string;
  name: string;
  sizeBytes: number;
  extension: string;
  fields?: IOntologyAssetField[];
  metadata?: Record<string, string | number | boolean | null>;
}

interface IOntologyTemplateDefinition {
  objects: Array<{
    code: string;
    name: string;
    description?: string;
    namespace?: string;
    tier: 1 | 2 | 3;
    status: "active" | "warning" | "error";
    attributes: Array<{
      code: string;
      name: string;
      dataType: string;
      required: boolean;
      description?: string;
    }>;
  }>;
  relations: Array<{
    code: string;
    name: string;
    from: string;
    to: string;
    cardinality: "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
    description?: string;
  }>;
}

export class OntologyEngine {
  constructor(private readonly repository: IOntologyRepository) {}

  async getWorkbench(
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const stored = await this.repository.getSnapshot(workspaceId);
    if (stored) {
      const normalized = normalizeSnapshot(stored);
      if (!isDeepStrictEqual(stored, normalized))
        await this.repository.saveSnapshot(normalized, stored);
      return normalized;
    }

    const snapshot = createDefaultOntologyWorkbenchSnapshot(Date.now(), {
      workspaceId,
    });
    await this.repository.saveSnapshot(snapshot);
    return snapshot;
  }

  async listWorkbenches(
    activeWorkspaceId = "default",
  ): Promise<IOntologyWorkbenchListResult> {
    const snapshots = await this.listNormalizedSnapshots(activeWorkspaceId);
    return {
      activeWorkspaceId,
      items: snapshots
        .filter((snapshot) => snapshot.workspaceId !== "default")
        .map((snapshot) => summarizeOntologyWorkbenchSnapshot(snapshot)),
    };
  }

  async createWorkbench(
    input: IOntologyCreateWorkbenchInput,
    activeWorkspaceId = "default",
  ): Promise<IOntologyWorkbenchMutationResult> {
    const name = input.name.trim();
    if (!name) throw new Error("Ontology name is required.");
    const requestedCode = input.code?.trim() || name;
    const workspaceId = toWorkspaceId(requestedCode);
    const existing = await this.repository.getSnapshot(workspaceId);
    if (existing)
      throw new Error(`Ontology code "${workspaceId}" already exists.`);

    const snapshot = createDefaultOntologyWorkbenchSnapshot(Date.now(), {
      workspaceId,
      title: name,
      description: input.description,
      businessGoal: input.businessGoal,
    });
    const integrationSource =
      (await this.repository.getSnapshot(activeWorkspaceId)) ??
      (activeWorkspaceId !== "default"
        ? await this.repository.getSnapshot("default")
        : null);
    if (integrationSource)
      seedWorkbenchIntegration(snapshot, normalizeSnapshot(integrationSource));
    await this.repository.saveSnapshot(snapshot);
    const list = await this.listWorkbenches(workspaceId || activeWorkspaceId);
    return {
      snapshot,
      summaries: list.items,
      activeWorkspaceId: list.activeWorkspaceId,
    };
  }

  async deleteWorkbench(
    input: IOntologyDeleteWorkbenchInput,
    activeWorkspaceId = "default",
  ): Promise<IOntologyWorkbenchMutationResult> {
    const workspaceId = input.workspaceId.trim();
    if (!workspaceId) throw new Error("Ontology workspace id is required.");
    await this.repository.deleteSnapshot(workspaceId);
    const remaining = (await this.repository.listSnapshots())
      .map((snapshot) => normalizeSnapshot(snapshot))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const fallbackSnapshot =
      remaining[0] ?? (await this.getWorkbench("default"));
    const nextActiveWorkspaceId =
      activeWorkspaceId === workspaceId ||
      !remaining.some((snapshot) => snapshot.workspaceId === activeWorkspaceId)
        ? fallbackSnapshot.workspaceId
        : activeWorkspaceId;
    const list = await this.listWorkbenches(nextActiveWorkspaceId);
    return {
      snapshot:
        nextActiveWorkspaceId === fallbackSnapshot.workspaceId
          ? fallbackSnapshot
          : await this.getWorkbench(nextActiveWorkspaceId),
      summaries: list.items,
      activeWorkspaceId: list.activeWorkspaceId,
    };
  }

  async updateDraft(
    input: IOntologyWorkbenchDraftInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    snapshot.draft = {
      ...snapshot.draft,
      ...(input.title !== undefined
        ? { title: input.title.trim() || snapshot.draft.title }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() }
        : {}),
      ...(input.businessGoal !== undefined
        ? { businessGoal: input.businessGoal.trim() }
        : {}),
      ...(input.selectedAssetIds !== undefined
        ? { selectedAssetIds: dedupe(input.selectedAssetIds) }
        : {}),
    };
    return this.save(snapshot);
  }

  async transitionPhase(
    input: IOntologyPhaseTransitionInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    snapshot.phases = snapshot.phases.map((phase) => {
      if (phase.phase !== input.phase) return phase;
      return {
        ...phase,
        status: input.status,
        summary: input.summary?.trim() || phase.summary,
        blockingReason:
          input.status === "blocked"
            ? input.blockingReason?.trim() || phase.blockingReason || "Blocked"
            : undefined,
        startedAt:
          phase.startedAt ??
          (input.status === "in_progress" || input.status === "completed"
            ? now
            : undefined),
        completedAt: input.status === "completed" ? now : undefined,
      };
    });
    snapshot.activePhase = input.phase;
    return this.save(snapshot);
  }

  async importFiles(
    input: IOntologyImportFilesInput,
    fileStats: IOntologyFileStat[],
    workspaceId = "default",
  ): Promise<{
    snapshot: IOntologyWorkbenchSnapshot;
    files: IOntologyImportedFile[];
  }> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    const imported: IOntologyImportedFile[] = [];
    const existingByPath = new Map(
      snapshot.assets
        .filter((asset) => asset.path)
        .map((asset) => [asset.path, asset]),
    );

    for (const filePath of dedupe(input.filePaths)) {
      const stat = fileStats.find((item) => item.path === filePath);
      if (!stat) continue;
      const existing = existingByPath.get(filePath);
      const asset: IOntologyEnvironmentAsset = {
        id: existing?.id ?? randomUUID(),
        kind: inferAssetKind(stat.extension),
        name: stat.name,
        sourceName: "local-file",
        path: stat.path,
        profileStatus:
          stat.fields && stat.fields.length > 0 ? "ready" : "not_profiled",
        fields: stat.fields ?? [],
        metadata: {
          sizeBytes: stat.sizeBytes,
          extension: stat.extension,
          ...stat.metadata,
        },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (existing) {
        snapshot.assets = snapshot.assets.map((item) =>
          item.id === existing.id ? asset : item,
        );
      } else {
        snapshot.assets.push(asset);
      }
      upsertConnectionProfile(snapshot, asset, now);
      imported.push({
        id: asset.id,
        name: asset.name,
        path: asset.path ?? stat.path,
        sizeBytes: stat.sizeBytes,
        extension: stat.extension,
      });
    }

    snapshot.draft.selectedAssetIds = dedupe([
      ...snapshot.draft.selectedAssetIds,
      ...imported.map((file) => file.id),
    ]);
    await this.markPhase(
      snapshot,
      "scan",
      "completed",
      imported.length > 0
        ? `Imported ${imported.length} local asset(s).`
        : undefined,
    );
    addMonitorEvent(
      snapshot,
      "data_integration",
      imported.length > 0
        ? `Imported ${imported.length} local asset(s).`
        : "No importable local assets were found.",
      now,
    );
    return { snapshot: await this.save(snapshot), files: imported };
  }

  async probeConnector(
    input: IOntologyProbeConnectorInput,
    scannedAssets: IOntologyEnvironmentAsset[],
    workspaceId = "default",
  ): Promise<IOntologyProbeConnectorResult> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    const connector = normalizeConnectorInput(
      input.connector,
      now,
      "reachable",
    );
    const existingConnector = snapshot.connectors.find(
      (item) => item.id === connector.id,
    );
    snapshot.connectors = existingConnector
      ? snapshot.connectors.map((item) =>
          item.id === connector.id
            ? { ...item, ...connector, createdAt: item.createdAt }
            : item,
        )
      : [...snapshot.connectors, connector];

    const existingByStableKey = new Map(
      snapshot.assets.map((asset) => [
        asset.path || `${asset.sourceName}:${asset.name}`,
        asset,
      ]),
    );
    const assets = scannedAssets
      .slice(0, input.maxAssets ?? scannedAssets.length)
      .map((asset) => {
        const key = asset.path || `${asset.sourceName}:${asset.name}`;
        const existing = existingByStableKey.get(key);
        return {
          ...asset,
          id: existing?.id ?? asset.id,
          sourceName: connector.name,
          profileStatus:
            asset.fields.length > 0 ? "ready" : asset.profileStatus,
          createdAt: existing?.createdAt ?? asset.createdAt,
          updatedAt: now,
          metadata: {
            ...asset.metadata,
            connectorId: connector.id,
            sourceType: connector.sourceType,
          },
        };
      });

    const nextAssetIds = new Set(assets.map((asset) => asset.id));
    snapshot.assets = [
      ...snapshot.assets.filter(
        (asset) =>
          !(
            asset.metadata.connectorId === connector.id &&
            nextAssetIds.has(asset.id)
          ),
      ),
      ...assets,
    ];
    snapshot.draft.selectedAssetIds = dedupe([
      ...snapshot.draft.selectedAssetIds,
      ...assets.map((asset) => asset.id),
    ]);
    snapshot.connections = upsertConnectionProfileForConnector(
      snapshot.connections,
      connector,
      assets,
      now,
    );
    await this.markPhase(
      snapshot,
      "scan",
      "completed",
      assets.length > 0
        ? `Connector "${connector.name}" discovered ${assets.length} asset(s).`
        : `Connector "${connector.name}" is reachable but has no discoverable assets.`,
    );
    addMonitorEvent(
      snapshot,
      "data_integration",
      `Connector "${connector.name}" probed with ${assets.length} asset(s).`,
      now,
      assets.length > 0 ? "info" : "warning",
    );
    return { snapshot: await this.save(snapshot), connector, assets };
  }

  async browseConnectorAssets(
    input: IOntologyBrowseConnectorAssetsInput,
    workspaceId = "default",
  ): Promise<IOntologyBrowseConnectorAssetsResult> {
    const snapshot = await this.getWorkbench(workspaceId);
    const connector = snapshot.connectors.find(
      (item) => item.id === input.connectorId,
    );
    if (!connector) throw new Error("Connector not found.");
    return {
      connector,
      assets: snapshot.assets.filter(
        (asset) => asset.metadata.connectorId === connector.id,
      ),
    };
  }

  async deleteConnector(
    input: IOntologyDeleteConnectorInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const connector = snapshot.connectors.find((item) => item.id === input.id);
    if (!connector) throw new Error("Connector not found.");

    const linkedAssetIds = snapshot.assets
      .filter((asset) => asset.metadata.connectorId === connector.id)
      .map((asset) => asset.id);
    if (linkedAssetIds.length > 0 && !input.cascadeAssets) {
      throw new Error(
        `Connector "${connector.name}" still has ${linkedAssetIds.length} asset(s). Enable cascade deletion to remove them together.`,
      );
    }

    const now = Date.now();
    snapshot.connectors = snapshot.connectors.filter(
      (item) => item.id !== connector.id,
    );
    snapshot.connections = snapshot.connections.filter(
      (item) => item.connectorId !== connector.id,
    );
    if (linkedAssetIds.length > 0)
      removeAssetsFromSnapshot(snapshot, linkedAssetIds);
    addMonitorEvent(
      snapshot,
      "data_integration",
      `Deleted connector "${connector.name}"${linkedAssetIds.length > 0 ? ` and ${linkedAssetIds.length} linked asset(s)` : ""}.`,
      now,
      linkedAssetIds.length > 0 ? "warning" : "info",
    );
    await this.markPhase(
      snapshot,
      "scan",
      snapshot.connectors.length > 0 || snapshot.assets.length > 0
        ? "completed"
        : "in_progress",
    );
    return this.save(snapshot);
  }

  async deleteAsset(
    input: IOntologyDeleteInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const asset = snapshot.assets.find((item) => item.id === input.id);
    if (!asset) throw new Error("Asset not found.");
    const isReferenced =
      snapshot.objects.some((object) =>
        object.sourceAssetIds.includes(asset.id),
      ) ||
      snapshot.mappings.some((mapping) => mapping.assetId === asset.id) ||
      snapshot.relations.some(
        (relation) => relation.dataBinding?.junctionAssetId === asset.id,
      );
    if (isReferenced)
      throw new Error(
        `Asset "${asset.name}" is referenced by ontology objects, mappings, or relation bindings.`,
      );

    const now = Date.now();
    removeAssetsFromSnapshot(snapshot, [asset.id]);
    addMonitorEvent(
      snapshot,
      "asset_catalog",
      `Deleted asset "${asset.name}".`,
      now,
      "warning",
    );
    await this.markPhase(
      snapshot,
      "scan",
      snapshot.assets.length > 0 ? "completed" : "in_progress",
    );
    return this.save(snapshot);
  }

  async profileAsset(
    input: IOntologyProfileAssetInput,
    workspaceId = "default",
    refreshedAsset?: IOntologyEnvironmentAsset,
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const asset = snapshot.assets.find((item) => item.id === input.id);
    if (!asset) throw new Error("Asset not found.");
    const now = Date.now();
    const profiledFields = refreshedAsset?.fields.length
      ? refreshedAsset.fields
      : asset.fields.length > 0
        ? asset.fields
        : createFallbackFields(asset);
    snapshot.assets = snapshot.assets.map((item) =>
      item.id === asset.id
        ? {
            ...item,
            profileStatus: "ready",
            fields: profiledFields,
            metadata: {
              ...item.metadata,
              ...(refreshedAsset?.metadata ?? {}),
              profiledAt: now,
              fieldCount: profiledFields.length,
            },
            updatedAt: now,
          }
        : item,
    );
    addMonitorEvent(
      snapshot,
      "asset_catalog",
      `Profiled asset "${asset.name}".`,
      now,
    );
    return this.save(snapshot);
  }

  async syncAssetSchema(
    input: IOntologySyncAssetSchemaInput,
    workspaceId = "default",
    refreshedAsset?: IOntologyEnvironmentAsset,
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const asset = snapshot.assets.find((item) => item.id === input.id);
    if (!asset) throw new Error("Asset not found.");
    const now = Date.now();
    const syncedFields = refreshedAsset?.fields.length
      ? refreshedAsset.fields
      : asset.fields.length > 0
        ? asset.fields
        : createFallbackFields(asset);
    snapshot.assets = snapshot.assets.map((item) =>
      item.id === asset.id
        ? {
            ...item,
            fields: syncedFields,
            profileStatus:
              syncedFields.length > 0 ? "ready" : item.profileStatus,
            metadata: {
              ...item.metadata,
              ...(refreshedAsset?.metadata ?? {}),
              schemaSyncedAt: now,
              schemaFieldCount: syncedFields.length,
            },
            updatedAt: now,
          }
        : item,
    );
    snapshot.objects = syncObjectAttributesFromAsset(
      snapshot.objects,
      asset.id,
      syncedFields,
      now,
    );
    snapshot.mappings = reconcileFieldMappings(snapshot, now);
    snapshot.qualityRules = reconcileQualityRules(snapshot, now);
    snapshot.businessDocuments = createBusinessDocuments(
      snapshot.objects,
      snapshot.draft.title,
      snapshot.draft.businessGoal,
      now,
    );
    snapshot.logicFunctions = reconcileLogicFunctions(
      snapshot.logicFunctions,
      snapshot.objects,
      now,
    );
    snapshot.actions = reconcileActionDefinitions(
      snapshot.actions,
      snapshot.objects,
      now,
    );
    snapshot.serviceEndpoints = createServiceEndpoints(snapshot, now);
    snapshot.impactAnalyses.unshift(
      createImpactAnalysis(
        `Synced schema for asset "${asset.name}".`,
        snapshot.objects,
        snapshot.relations,
        now,
      ),
    );
    addMonitorEvent(
      snapshot,
      "asset_catalog",
      `Synced schema for asset "${asset.name}" with ${syncedFields.length} field(s).`,
      now,
    );
    await this.markPhase(
      snapshot,
      "review",
      snapshot.objects.length > 0 ? "in_progress" : "not_started",
      "Schema changes require review before publishing.",
    );
    return this.save(snapshot);
  }

  async upsertObject(
    input: IOntologyObjectDraftInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    const existing = input.id
      ? snapshot.objects.find((item) => item.id === input.id)
      : undefined;
    const object: IOntologyObjectDraft = {
      id: existing?.id ?? randomUUID(),
      code: toCode(input.code || input.name),
      name: input.name.trim(),
      description: input.description?.trim() || existing?.description || "",
      tier: input.tier ?? existing?.tier ?? 3,
      status: input.status ?? existing?.status ?? "active",
      namespace: input.namespace?.trim() || existing?.namespace,
      sourceAssetIds: dedupe(
        input.sourceAssetIds ?? existing?.sourceAssetIds ?? [],
      ),
      attributes: existing?.attributes ?? [],
      reviewDecision: "pending",
      updatedAt: now,
    };
    assertUniqueCode(snapshot.objects, object.id, object.code, "Object");
    snapshot.objects = existing
      ? snapshot.objects.map((item) => (item.id === object.id ? object : item))
      : [...snapshot.objects, object];
    await this.afterModelEdit(
      snapshot,
      "ontology_modeling",
      existing
        ? `Updated object "${object.name}".`
        : `Created object "${object.name}".`,
      now,
    );
    return this.save(snapshot);
  }

  async deleteObject(
    input: IOntologyDeleteInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const object = snapshot.objects.find((item) => item.id === input.id);
    if (!object) throw new Error("Object not found.");
    const now = Date.now();
    snapshot.objects = snapshot.objects.filter((item) => item.id !== input.id);
    snapshot.relations = snapshot.relations.filter(
      (item) => item.fromObjectId !== input.id && item.toObjectId !== input.id,
    );
    snapshot.mappings = snapshot.mappings.filter(
      (item) => item.objectId !== input.id,
    );
    snapshot.qualityRules = snapshot.qualityRules.filter(
      (item) => item.objectId !== input.id,
    );
    snapshot.logicFunctions = snapshot.logicFunctions
      .filter(
        (item) => item.objectIds.length !== 1 || item.objectIds[0] !== input.id,
      )
      .map((item) => ({
        ...item,
        objectIds: item.objectIds.filter((id) => id !== input.id),
      }));
    snapshot.actions = snapshot.actions
      .filter(
        (item) => item.objectIds.length !== 1 || item.objectIds[0] !== input.id,
      )
      .map((item) => ({
        ...item,
        objectIds: item.objectIds.filter((id) => id !== input.id),
      }));
    await this.afterModelEdit(
      snapshot,
      "ontology_modeling",
      `Deleted object "${object.name}".`,
      now,
    );
    return this.save(snapshot);
  }

  async upsertAttribute(
    input: IOntologyAttributeDraftInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    let isFound = false;
    snapshot.objects = snapshot.objects.map((object) => {
      if (object.id !== input.objectId) return object;
      isFound = true;
      const existing = input.id
        ? object.attributes.find((item) => item.id === input.id)
        : undefined;
      const attribute: IOntologyAttributeDraft = {
        id: existing?.id ?? randomUUID(),
        code: toCode(input.code || input.name),
        name: input.name.trim(),
        dataType: normalizeDataType(input.dataType),
        required: input.required ?? existing?.required ?? false,
        description: input.description?.trim() || undefined,
        example: input.example?.trim() || undefined,
        constraints: input.constraints
          ? structuredClone(input.constraints)
          : existing?.constraints,
        mappedField: input.mappedField,
      };
      const attributes = existing
        ? object.attributes.map((item) =>
            item.id === attribute.id ? attribute : item,
          )
        : [...object.attributes, attribute];
      assertUniqueCode(attributes, attribute.id, attribute.code, "Attribute");
      return {
        ...object,
        attributes,
        reviewDecision: "pending",
        updatedAt: now,
      };
    });
    if (!isFound) throw new Error("Object not found.");
    await this.afterModelEdit(
      snapshot,
      "ontology_modeling",
      `Upserted attribute "${input.name}".`,
      now,
    );
    return this.save(snapshot);
  }

  async deleteAttribute(
    input: IOntologyDeleteAttributeInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    let isFound = false;
    snapshot.objects = snapshot.objects.map((object) => {
      if (object.id !== input.objectId) return object;
      isFound = object.attributes.some(
        (attribute) => attribute.id === input.attributeId,
      );
      return {
        ...object,
        attributes: object.attributes.filter(
          (attribute) => attribute.id !== input.attributeId,
        ),
        reviewDecision: "pending",
        updatedAt: now,
      };
    });
    if (!isFound) throw new Error("Attribute not found.");
    snapshot.mappings = snapshot.mappings.filter(
      (mapping) => mapping.attributeId !== input.attributeId,
    );
    snapshot.relations = snapshot.relations.map((relation) =>
      removeAttributeFromRelationBinding(relation, input.attributeId),
    );
    await this.afterModelEdit(
      snapshot,
      "ontology_modeling",
      "Deleted ontology attribute.",
      now,
    );
    return this.save(snapshot);
  }

  async upsertRelation(
    input: IOntologyRelationDraftInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    const fromObject = snapshot.objects.find(
      (object) => object.id === input.fromObjectId,
    );
    const toObject = snapshot.objects.find(
      (object) => object.id === input.toObjectId,
    );
    if (!fromObject || !toObject) {
      throw new Error("Relation endpoints must reference existing objects.");
    }
    const existing = input.id
      ? snapshot.relations.find((item) => item.id === input.id)
      : undefined;
    const isDataBindingSupplied = input.dataBinding !== undefined;
    const normalizedDataBinding = isDataBindingSupplied
      ? normalizeRelationDataBinding(input.dataBinding)
      : (normalizeRelationDataBinding(existing?.dataBinding) ??
        inferDirectRelationDataBinding(fromObject, toObject));
    if (isDataBindingSupplied && !normalizedDataBinding)
      throw new Error("Relation data binding is invalid.");
    const relation: IOntologyRelationDraft = {
      id: existing?.id ?? randomUUID(),
      code: toCode(input.code || input.name),
      name: input.name.trim(),
      fromObjectId: input.fromObjectId,
      toObjectId: input.toObjectId,
      cardinality: input.cardinality,
      relationType:
        input.relationType ?? existing?.relationType ?? "object_property",
      semanticType:
        input.semanticType ?? existing?.semanticType ?? "association",
      dataBinding: normalizedDataBinding
        ? {
            ...normalizedDataBinding,
            origin: input.dataBinding ? "manual" : normalizedDataBinding.origin,
          }
        : undefined,
      isAcyclic: input.isAcyclic ?? existing?.isAcyclic ?? false,
      description: input.description?.trim() || undefined,
      reviewDecision: "pending",
      updatedAt: now,
    };
    const relationIssue = relationDefinitionIssue(relation, snapshot);
    if (relationIssue) throw new Error(relationIssue);
    assertUniqueCode(
      snapshot.relations,
      relation.id,
      relation.code,
      "Relation",
    );
    snapshot.relations = existing
      ? snapshot.relations.map((item) =>
          item.id === relation.id ? relation : item,
        )
      : [...snapshot.relations, relation];
    await this.afterModelEdit(
      snapshot,
      "ontology_modeling",
      existing
        ? `Updated relation "${relation.name}".`
        : `Created relation "${relation.name}".`,
      now,
    );
    return this.save(snapshot);
  }

  async deleteRelation(
    input: IOntologyDeleteInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const relation = snapshot.relations.find((item) => item.id === input.id);
    if (!relation) throw new Error("Relation not found.");
    const now = Date.now();
    snapshot.relations = snapshot.relations.filter(
      (item) => item.id !== input.id,
    );
    await this.afterModelEdit(
      snapshot,
      "ontology_modeling",
      `Deleted relation "${relation.name}".`,
      now,
    );
    return this.save(snapshot);
  }

  async upsertMapping(
    input: IOntologyFieldMappingInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    validateMappingInput(snapshot, input);
    const existing = input.id
      ? snapshot.mappings.find((item) => item.id === input.id)
      : undefined;
    const mapping: IOntologyFieldMapping = {
      id: existing?.id ?? randomUUID(),
      objectId: input.objectId,
      attributeId: input.attributeId,
      assetId: input.assetId,
      fieldName: input.fieldName,
      confidence: clampConfidence(
        input.confidence ?? existing?.confidence ?? 0.9,
      ),
      strategy: input.strategy ?? existing?.strategy ?? "manual",
      status: input.status ?? existing?.status ?? "pending",
      updatedAt: now,
    };
    snapshot.mappings = existing
      ? snapshot.mappings.map((item) =>
          item.id === mapping.id ? mapping : item,
        )
      : [...snapshot.mappings, mapping];
    await this.afterModelEdit(
      snapshot,
      "hydration_mapping",
      `Updated mapping for field "${mapping.fieldName}".`,
      now,
      false,
    );
    return this.save(snapshot);
  }

  async deleteMapping(
    input: IOntologyDeleteInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const mapping = snapshot.mappings.find((item) => item.id === input.id);
    if (!mapping) throw new Error("Mapping not found.");
    const now = Date.now();
    snapshot.mappings = snapshot.mappings.filter(
      (item) => item.id !== input.id,
    );
    await this.afterModelEdit(
      snapshot,
      "hydration_mapping",
      `Deleted mapping for field "${mapping.fieldName}".`,
      now,
      false,
    );
    return this.save(snapshot);
  }

  async upsertQualityRule(
    input: IOntologyQualityRuleInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const object = snapshot.objects.find((item) => item.id === input.objectId);
    if (!object) throw new Error("Quality rule object not found.");
    const expressionValidation = validateQualityRuleExpression(
      input.expression,
      object.attributes.map((attribute) => attribute.code),
    );
    if (!expressionValidation.isValid) {
      throw new Error(
        expressionValidation.errorMessage ?? "Invalid quality rule expression.",
      );
    }
    const now = Date.now();
    const existing = input.id
      ? snapshot.qualityRules.find((item) => item.id === input.id)
      : undefined;
    const rule: IOntologyQualityRule = {
      id: existing?.id ?? randomUUID(),
      objectId: input.objectId,
      code: toCode(input.code || input.name),
      name: input.name.trim(),
      expression: input.expression.trim(),
      severity: input.severity,
      status: input.status ?? existing?.status ?? "active",
      updatedAt: now,
    };
    assertUniqueCode(snapshot.qualityRules, rule.id, rule.code, "Quality rule");
    snapshot.qualityRules = existing
      ? snapshot.qualityRules.map((item) => (item.id === rule.id ? rule : item))
      : [...snapshot.qualityRules, rule];
    await this.afterModelEdit(
      snapshot,
      "publish_governance",
      `Upserted quality rule "${rule.name}".`,
      now,
      false,
    );
    return this.save(snapshot);
  }

  async deleteQualityRule(
    input: IOntologyDeleteInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const rule = snapshot.qualityRules.find((item) => item.id === input.id);
    if (!rule) throw new Error("Quality rule not found.");
    const now = Date.now();
    snapshot.qualityRules = snapshot.qualityRules.filter(
      (item) => item.id !== input.id,
    );
    await this.afterModelEdit(
      snapshot,
      "publish_governance",
      `Deleted quality rule "${rule.name}".`,
      now,
      false,
    );
    return this.save(snapshot);
  }

  async upsertLogicFunction(
    input: IOntologyLogicFunctionInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    const existing = input.id
      ? snapshot.logicFunctions.find((item) => item.id === input.id)
      : undefined;
    validateObjectReferences(
      snapshot,
      input.objectIds ?? existing?.objectIds ?? [],
      "Logic function",
    );
    const logicFunction: IOntologyLogicFunction = {
      id: existing?.id ?? randomUUID(),
      code: toCode(input.code || input.name),
      name: requireName(input.name, "Logic function"),
      description: input.description?.trim() ?? existing?.description ?? "",
      runtime: input.runtime,
      objectIds: dedupe(input.objectIds ?? existing?.objectIds ?? []),
      signature: input.signature?.trim() ?? existing?.signature ?? "",
      body: input.body ?? existing?.body ?? "",
      returnType: input.returnType?.trim() || existing?.returnType || "unknown",
      parameters: structuredClone(
        input.parameters ?? existing?.parameters ?? [],
      ),
      configuration: structuredClone(
        input.configuration ?? existing?.configuration ?? {},
      ),
      origin: "manual",
      status: input.status ?? existing?.status ?? "active",
      executionCount: existing?.executionCount ?? 0,
      lastExecutedAt: existing?.lastExecutedAt,
      updatedAt: now,
    };
    const configurationIssue = runtimeFunctionConfigurationIssue(
      logicFunction,
      snapshot,
    );
    if (logicFunction.status === "active" && configurationIssue)
      throw new Error(
        `Logic function is not executable: ${configurationIssue}.`,
      );
    assertUniqueCode(
      snapshot.logicFunctions,
      logicFunction.id,
      logicFunction.code,
      "Logic function",
    );
    snapshot.logicFunctions = existing
      ? snapshot.logicFunctions.map((item) =>
          item.id === logicFunction.id ? logicFunction : item,
        )
      : [...snapshot.logicFunctions, logicFunction];
    await this.afterRuntimeEdit(
      snapshot,
      `Upserted logic function "${logicFunction.name}".`,
      now,
    );
    return this.save(snapshot);
  }

  async deleteLogicFunction(
    input: IOntologyDeleteInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const logicFunction = snapshot.logicFunctions.find(
      (item) => item.id === input.id,
    );
    if (!logicFunction) throw new Error("Logic function not found.");
    const now = Date.now();
    snapshot.logicFunctions = snapshot.logicFunctions.filter(
      (item) => item.id !== input.id,
    );
    await this.afterRuntimeEdit(
      snapshot,
      `Deleted logic function "${logicFunction.name}".`,
      now,
    );
    return this.save(snapshot);
  }

  async recordLogicFunctionExecution(
    id: string,
    executedAt: number,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    let isFound = false;
    snapshot.logicFunctions = snapshot.logicFunctions.map((item) => {
      if (item.id !== id) return item;
      isFound = true;
      return {
        ...item,
        executionCount: item.executionCount + 1,
        lastExecutedAt: executedAt,
      };
    });
    if (!isFound) throw new Error("Logic function not found.");
    addMonitorEvent(
      snapshot,
      "logic_modeling",
      `Executed logic function ${id}.`,
      executedAt,
    );
    return this.save(snapshot);
  }

  async upsertAction(
    input: IOntologyActionDefinitionInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    const existing = input.id
      ? snapshot.actions.find((item) => item.id === input.id)
      : undefined;
    validateObjectReferences(
      snapshot,
      input.objectIds ?? existing?.objectIds ?? [],
      "Action",
    );
    const action: IOntologyActionDefinition = {
      id: existing?.id ?? randomUUID(),
      code: toCode(input.code || input.name),
      name: requireName(input.name, "Action"),
      executor: input.executor,
      objectIds: dedupe(input.objectIds ?? existing?.objectIds ?? []),
      description: input.description?.trim() ?? existing?.description ?? "",
      configuration: structuredClone(
        input.configuration ?? existing?.configuration ?? {},
      ),
      parameters: structuredClone(
        input.parameters ?? existing?.parameters ?? [],
      ),
      outputSchema: structuredClone(
        input.outputSchema ?? existing?.outputSchema ?? [],
      ),
      origin: "manual",
      status: input.status ?? existing?.status ?? "active",
      executionCount: existing?.executionCount ?? 0,
      lastExecutedAt: existing?.lastExecutedAt,
      updatedAt: now,
    };
    const configurationIssue = runtimeActionConfigurationIssue(
      action,
      snapshot,
    );
    if (action.status === "active" && configurationIssue)
      throw new Error(`Action is not executable: ${configurationIssue}.`);
    assertUniqueCode(snapshot.actions, action.id, action.code, "Action");
    snapshot.actions = existing
      ? snapshot.actions.map((item) => (item.id === action.id ? action : item))
      : [...snapshot.actions, action];
    await this.afterRuntimeEdit(
      snapshot,
      `Upserted action "${action.name}".`,
      now,
    );
    return this.save(snapshot);
  }

  async deleteAction(
    input: IOntologyDeleteInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const action = snapshot.actions.find((item) => item.id === input.id);
    if (!action) throw new Error("Action not found.");
    const now = Date.now();
    snapshot.actions = snapshot.actions.filter((item) => item.id !== input.id);
    await this.afterRuntimeEdit(
      snapshot,
      `Deleted action "${action.name}".`,
      now,
    );
    return this.save(snapshot);
  }

  async recordActionExecution(
    id: string,
    executedAt: number,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    let isFound = false;
    snapshot.actions = snapshot.actions.map((item) => {
      if (item.id !== id) return item;
      isFound = true;
      return {
        ...item,
        executionCount: item.executionCount + 1,
        lastExecutedAt: executedAt,
      };
    });
    if (!isFound) throw new Error("Action not found.");
    addMonitorEvent(
      snapshot,
      "logic_modeling",
      `Executed action ${id}.`,
      executedAt,
    );
    return this.save(snapshot);
  }

  async generateDraft(
    input: IOntologyGenerateDraftInput = {},
    workspaceId = "default",
    documentGeneration?: {
      extraction: IOntologyDocumentExtraction;
      expectedSnapshot: IOntologyWorkbenchSnapshot;
    },
  ): Promise<IOntologyWorkbenchSnapshot> {
    const documentAssetIds = new Set(input.documentAssetIds ?? []);
    if (documentAssetIds.size > 0 && !documentGeneration) {
      throw new Error("ontology.documentErrors.invalidResult");
    }
    let snapshot: IOntologyWorkbenchSnapshot;
    if (documentGeneration) {
      const stored = await this.repository.getSnapshot(workspaceId);
      if (
        !stored ||
        stored.workspaceId !== workspaceId ||
        !isDeepStrictEqual(stored, documentGeneration.expectedSnapshot)
      ) {
        throw new Error("ontology.documentErrors.conflict");
      }
      // Compare and save the raw snapshot; normalization may add legacy defaults.
      snapshot = normalizeSnapshot(structuredClone(stored));
    } else {
      snapshot = await this.getWorkbench(workspaceId);
    }
    const selectedAssetIds =
      input.assetIds !== undefined
        ? dedupe(input.assetIds)
        : snapshot.draft.selectedAssetIds;
    const selectedAssets = snapshot.assets.filter((asset) =>
      selectedAssetIds.includes(asset.id),
    );
    if (
      documentGeneration &&
      (documentAssetIds.size === 0 ||
        (input.workspaceId !== undefined &&
          input.workspaceId !== workspaceId) ||
        [...documentAssetIds].some(
          (id) => !selectedAssets.some((asset) => asset.id === id),
        ))
    ) {
      throw new Error("ontology.documentErrors.invalidSelection");
    }
    if (
      selectedAssets.some(
        (asset) =>
          asset.kind === "document" &&
          !ontologyTemplateFromMetadata(asset.metadata) &&
          !documentAssetIds.has(asset.id),
      )
    ) {
      throw new Error("ontology.documentErrors.invalidSelection");
    }
    const structuredAssets = selectedAssets.filter(
      (asset) => !documentAssetIds.has(asset.id),
    );
    const now = Date.now();
    if (input.businessGoal !== undefined) {
      snapshot.draft.businessGoal = input.businessGoal.trim();
    }

    const nextObjects =
      structuredAssets.length > 0
        ? structuredAssets.flatMap((asset) =>
            createObjectsFromAsset(asset, now),
          )
        : documentGeneration
          ? []
          : [
              createObjectFromBusinessGoal(
                input.businessGoal ||
                  snapshot.draft.businessGoal ||
                  snapshot.draft.title,
                now,
              ),
            ];
    const existingBySourceAndCode = new Map(
      snapshot.objects.flatMap((object) =>
        object.sourceAssetIds.map(
          (assetId) => [`${assetId}:${object.code}`, object] as const,
        ),
      ),
    );
    const generatedObjects = nextObjects.map((object) => {
      const existing =
        object.sourceAssetIds.length > 0
          ? existingBySourceAndCode.get(
              `${object.sourceAssetIds[0]}:${object.code}`,
            )
          : undefined;
      return existing
        ? {
            ...object,
            id: existing.id,
            reviewDecision: existing.reviewDecision,
          }
        : object;
    });
    const replacedObjectIds = new Set(
      generatedObjects.map((object) => object.id),
    );
    const replacedSourceIds = new Set(
      structuredAssets.map((asset) => asset.id),
    );
    let mergedObjects =
      input.mode === "merge"
        ? [
            ...snapshot.objects.filter(
              (object) =>
                !replacedObjectIds.has(object.id) &&
                !object.sourceAssetIds.some((assetId) =>
                  replacedSourceIds.has(assetId),
                ),
            ),
            ...generatedObjects,
          ]
        : generatedObjects;
    const templateRelations = createRelationsFromTemplateAssets(
      structuredAssets,
      generatedObjects,
      now,
    );
    const generatedRelations =
      templateRelations.length > 0
        ? templateRelations
        : createRelationsFromObjects(generatedObjects, now);
    const generatedRelationCodes = new Set(
      generatedRelations.map((relation) => relation.code),
    );

    if (documentGeneration) {
      mergeDocumentExtraction(
        snapshot,
        documentGeneration.extraction,
        documentAssetIds,
        generatedObjects,
        generatedRelations,
        now,
      );
      mergedObjects = snapshot.objects;
    } else {
      snapshot.objects = mergedObjects;
      snapshot.relations =
        input.mode === "merge"
          ? [
              ...snapshot.relations.filter(
                (relation) => !generatedRelationCodes.has(relation.code),
              ),
              ...generatedRelations,
            ]
          : generatedRelations;
    }
    snapshot.mappings =
      input.mode === "merge" || documentGeneration
        ? reconcileFieldMappings(snapshot, now)
        : createFieldMappings(mergedObjects, now);
    if (documentGeneration) {
      const manualByKey = new Map(
        (documentGeneration.expectedSnapshot.mappings ?? [])
          .filter((mapping) => mapping.strategy === "manual")
          .map((mapping) => [mappingKey(mapping), mapping]),
      );
      snapshot.mappings = snapshot.mappings
        .filter((mapping) => isMappingStillValid(snapshot, mapping))
        .map((mapping) => manualByKey.get(mappingKey(mapping)) ?? mapping);
    }
    snapshot.qualityRules =
      input.mode === "merge" || documentGeneration
        ? reconcileQualityRules(snapshot, now)
        : createQualityRules(mergedObjects, now);
    snapshot.businessDocuments = createBusinessDocuments(
      mergedObjects,
      snapshot.draft.title,
      snapshot.draft.businessGoal,
      now,
    );
    snapshot.logicFunctions = reconcileLogicFunctions(
      snapshot.logicFunctions,
      mergedObjects,
      now,
    );
    snapshot.actions = reconcileActionDefinitions(
      snapshot.actions,
      mergedObjects,
      now,
    );
    snapshot.serviceEndpoints = createServiceEndpoints(snapshot, now);
    snapshot.impactAnalyses.unshift(
      createImpactAnalysis(
        "Generated ontology draft and refreshed derived governance artifacts.",
        mergedObjects,
        snapshot.relations,
        now,
      ),
    );
    addMonitorEvent(
      snapshot,
      "ai_builder",
      `Generated ${snapshot.objects.length} ontology object(s) and ${snapshot.relations.length} relation(s).`,
      now,
    );
    await this.markPhase(
      snapshot,
      "generate",
      "completed",
      `Generated ${snapshot.objects.length} ontology object(s) and ${snapshot.relations.length} relation(s).`,
    );
    await this.markPhase(
      snapshot,
      "review",
      snapshot.objects.length > 0 ? "in_progress" : "not_started",
    );
    return this.save(snapshot, documentGeneration?.expectedSnapshot);
  }

  async reviewTarget(
    input: IOntologyReviewTargetInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    let isFound = false;

    if (input.targetType === "object") {
      snapshot.objects = snapshot.objects.map((object) => {
        if (object.id !== input.targetId) return object;
        isFound = true;
        return { ...object, reviewDecision: input.decision, updatedAt: now };
      });
    } else {
      snapshot.relations = snapshot.relations.map((relation) => {
        if (relation.id !== input.targetId) return relation;
        isFound = true;
        return { ...relation, reviewDecision: input.decision, updatedAt: now };
      });
    }

    if (!isFound) throw new Error("Review target not found.");
    snapshot.reviewItems.push({
      id: randomUUID(),
      targetType: input.targetType,
      targetId: input.targetId,
      decision: input.decision,
      comment: input.comment?.trim() || "",
      reviewerId: "local-user",
      createdAt: now,
    });

    const pendingCount = recalculateOntologyStats(snapshot).pendingReviewCount;
    await this.markPhase(
      snapshot,
      "review",
      pendingCount === 0 ? "completed" : "in_progress",
    );
    addMonitorEvent(
      snapshot,
      "review_collaboration",
      `Review decision ${input.decision} recorded for ${input.targetType}.`,
      now,
    );
    return this.save(snapshot);
  }

  async approveAll(
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    snapshot.objects = snapshot.objects.map((item) => ({
      ...item,
      reviewDecision: "approved",
      updatedAt: now,
    }));
    snapshot.relations = snapshot.relations.map((item) => ({
      ...item,
      reviewDecision: "approved",
      updatedAt: now,
    }));
    snapshot.reviewItems.push(...createReviewItems(snapshot, now));
    await this.markPhase(
      snapshot,
      "review",
      "completed",
      "All ontology objects and relations approved.",
    );
    addMonitorEvent(
      snapshot,
      "review_collaboration",
      "All ontology objects and relations were approved.",
      now,
    );
    return this.save(snapshot);
  }

  async runConsistencyCheck(
    workspaceId = "default",
  ): Promise<IOntologyConsistencyCheckResult> {
    const snapshot = await this.getWorkbench(workspaceId);
    return checkConsistency(snapshot);
  }

  async publishCurrentDraft(workspaceId = "default"): Promise<{
    snapshot: IOntologyWorkbenchSnapshot;
    version: IOntologyPublishedVersion;
  }> {
    const snapshot = await this.getWorkbench(workspaceId);
    const check = checkConsistency(snapshot);
    if (!check.isValid) {
      throw new Error(check.issues.map((issue) => issue.message).join("\n"));
    }
    const now = Date.now();
    const nextVersion = `v${snapshot.publishedVersions.length + 1}`;
    const diff = createVersionDiff(snapshot);
    const version: IOntologyPublishedVersion = {
      id: randomUUID(),
      version: nextVersion,
      status: "submitted",
      isActive: false,
      objectCount: snapshot.objects.length,
      relationCount: snapshot.relations.length,
      submittedAt: now,
      summary:
        snapshot.draft.businessGoal ||
        snapshot.draft.description ||
        snapshot.draft.title,
      diff,
      snapshot: createVersionSnapshot(snapshot),
      createdAt: now,
    };
    snapshot.publishedVersions.push(version);
    snapshot.impactAnalyses.unshift(
      createImpactAnalysis(
        `Published ontology ${nextVersion}.`,
        snapshot.objects,
        snapshot.relations,
        now,
      ),
    );
    snapshot.serviceEndpoints = createServiceEndpoints(snapshot, now);
    await this.markPhase(
      snapshot,
      "publish",
      "in_progress",
      `Submitted ontology ${nextVersion} for approval.`,
    );
    addMonitorEvent(
      snapshot,
      "publish_governance",
      `Submitted ontology ${nextVersion} for approval.`,
      now,
    );
    return { snapshot: await this.save(snapshot), version };
  }

  async approvePublishedVersion(
    input: IOntologyPublishApprovalInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    let isFound = false;
    snapshot.publishedVersions = snapshot.publishedVersions.map((version) => {
      if (version.id !== input.versionId)
        return { ...version, isActive: false };
      if (version.status !== "submitted" && version.status !== "approved")
        throw new Error("Only submitted versions can be approved.");
      isFound = true;
      return {
        ...version,
        status: "published",
        isActive: true,
        approvedAt: now,
        approvedBy: input.reviewerId?.trim() || "local-reviewer",
        publishedAt: version.publishedAt ?? now,
      };
    });
    if (!isFound) throw new Error("Published version not found.");
    await this.markPhase(
      snapshot,
      "publish",
      "completed",
      "Ontology version approved and published.",
    );
    addMonitorEvent(
      snapshot,
      "publish_governance",
      input.comment?.trim() || "Ontology version approved.",
      now,
    );
    return this.save(snapshot);
  }

  async rejectPublishedVersion(
    input: IOntologyRejectVersionInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    const reason = input.reason.trim();
    if (!reason) throw new Error("A rejection reason is required.");
    let isFound = false;
    snapshot.publishedVersions = snapshot.publishedVersions.map((version) => {
      if (version.id !== input.versionId) return version;
      if (version.status !== "submitted")
        throw new Error("Only submitted versions can be rejected.");
      isFound = true;
      return {
        ...version,
        status: "rejected",
        isActive: false,
        approvedBy: input.reviewerId?.trim() || "local-reviewer",
        summary: `${version.summary}\nRejected: ${reason}`,
      };
    });
    if (!isFound) throw new Error("Submitted version not found.");
    await this.markPhase(
      snapshot,
      "publish",
      "blocked",
      `Version rejected: ${reason}`,
    );
    addMonitorEvent(
      snapshot,
      "publish_governance",
      `Rejected ontology version: ${reason}`,
      now,
      "warning",
    );
    return this.save(snapshot);
  }

  async rollbackToVersion(
    input: IOntologyRollbackInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const target = snapshot.publishedVersions.find(
      (version) => version.id === input.versionId,
    );
    if (!target) throw new Error("Published version not found.");
    if (target.status !== "published" && target.status !== "rolled_back")
      throw new Error("Only published versions can be restored.");
    const now = Date.now();
    const restored = target.snapshot;
    snapshot.objects = structuredClone(restored.objects);
    snapshot.relations = structuredClone(restored.relations);
    snapshot.mappings = structuredClone(restored.mappings);
    snapshot.qualityRules = structuredClone(restored.qualityRules);
    snapshot.logicFunctions = structuredClone(restored.logicFunctions);
    snapshot.actions = structuredClone(restored.actions);
    snapshot.serviceEndpoints = structuredClone(restored.serviceEndpoints);
    snapshot.businessDocuments = structuredClone(restored.businessDocuments);
    snapshot.publishedVersions = snapshot.publishedVersions.map((version) => ({
      ...version,
      status: version.id === input.versionId ? "published" : version.status,
      isActive: version.id === input.versionId,
    }));
    snapshot.impactAnalyses.unshift(
      createImpactAnalysis(
        `Rolled back ontology to ${target.version}.`,
        snapshot.objects,
        snapshot.relations,
        now,
      ),
    );
    await this.markPhase(
      snapshot,
      "publish",
      "completed",
      `Rolled back ontology to ${target.version}.`,
    );
    addMonitorEvent(
      snapshot,
      "publish_governance",
      `Rolled back ontology to ${target.version}.`,
      now,
      "warning",
    );
    return this.save(snapshot);
  }

  async createAgentBlueprint(
    input: IOntologyAgentBlueprintInput,
    workspaceId = "default",
  ): Promise<{
    snapshot: IOntologyWorkbenchSnapshot;
    blueprint: IOntologyAgentBlueprint;
  }> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    const version = snapshot.publishedVersions.find(
      (item) =>
        item.id === input.ontologyVersionId && item.status === "published",
    );
    if (!version)
      throw new Error(
        "A published ontology version is required before building an Agent blueprint.",
      );

    const blueprint: IOntologyAgentBlueprint = {
      id: randomUUID(),
      name: input.name.trim() || `${snapshot.draft.title} Agent`,
      status: "draft",
      ontologyVersionId: version.id,
      entityIds: version.snapshot.objects.map((item) => item.id),
      promptTemplate:
        input.promptTemplate?.trim() ||
        `Use ontology ${version.version} to answer domain questions and operate on approved ontology tools.`,
      toolManifest: [
        {
          name: "ontology.lookup",
          description: "Lookup ontology objects, attributes, and relations.",
          category: "ontology",
        },
        ...version.snapshot.relations
          .filter(
            (relation) =>
              relation.dataBinding &&
              relation.dataBinding.mode !== "semantic_only",
          )
          .map((relation) => ({
            name: `relation_${relation.code}`,
            description: `Traverse ${relation.name} through its configured field-level join.`,
            category: "relation" as const,
          })),
        ...version.snapshot.logicFunctions
          .filter((logicFunction) => logicFunction.status === "active")
          .map((logicFunction) => ({
            name: `logic_${logicFunction.code}`,
            description: logicFunction.description || logicFunction.name,
            category: "logic" as const,
          })),
        ...version.snapshot.actions
          .filter((action) => action.status === "active")
          .map((action) => ({
            name: `action_${action.code}`,
            description: action.description || action.name,
            category: "action" as const,
          })),
      ],
      createdAt: now,
      updatedAt: now,
    };
    snapshot.agentBlueprints.push(blueprint);
    snapshot.serviceEndpoints = createServiceEndpoints(snapshot, now);
    await this.markPhase(
      snapshot,
      "agent",
      "completed",
      `Created Agent blueprint ${blueprint.name}.`,
    );
    addMonitorEvent(
      snapshot,
      "agent_builder",
      `Created Agent blueprint ${blueprint.name}.`,
      now,
    );
    return { snapshot: await this.save(snapshot), blueprint };
  }

  async registerAgentBlueprint(
    input: IOntologyRegisterAgentInput,
    workspaceId = "default",
  ): Promise<{
    snapshot: IOntologyWorkbenchSnapshot;
    blueprint: IOntologyAgentBlueprint;
  }> {
    const snapshot = await this.getWorkbench(workspaceId);
    const now = Date.now();
    const blueprint = input.blueprintId
      ? snapshot.agentBlueprints.find((item) => item.id === input.blueprintId)
      : snapshot.agentBlueprints.at(-1);
    if (!blueprint) throw new Error("Agent blueprint not found.");
    const assistantId = input.assistantId?.trim() || `ontology-${blueprint.id}`;
    const nextBlueprint: IOntologyAgentBlueprint = {
      ...blueprint,
      name: input.name?.trim() || blueprint.name,
      status: "registered",
      registeredAssistantId: assistantId,
      registeredAt: now,
      updatedAt: now,
    };
    snapshot.agentBlueprints = snapshot.agentBlueprints.map((item) =>
      item.id === blueprint.id ? nextBlueprint : item,
    );
    snapshot.serviceEndpoints = createServiceEndpoints(snapshot, now);
    await this.markPhase(
      snapshot,
      "agent",
      "completed",
      `Registered Agent blueprint ${nextBlueprint.name}.`,
    );
    addMonitorEvent(
      snapshot,
      "agent_builder",
      `Registered Agent blueprint ${nextBlueprint.name}.`,
      now,
    );
    return { snapshot: await this.save(snapshot), blueprint: nextBlueprint };
  }

  async deleteAgentBlueprint(
    input: IOntologyDeleteInput,
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = await this.getWorkbench(workspaceId);
    const blueprint = snapshot.agentBlueprints.find(
      (item) => item.id === input.id,
    );
    if (!blueprint) throw new Error("Agent blueprint not found.");
    const now = Date.now();
    snapshot.agentBlueprints = snapshot.agentBlueprints.filter(
      (item) => item.id !== blueprint.id,
    );
    snapshot.serviceEndpoints = createServiceEndpoints(snapshot, now);
    addMonitorEvent(
      snapshot,
      "agent_builder",
      `Deleted Agent blueprint ${blueprint.name}.`,
      now,
      "warning",
    );
    await this.markPhase(
      snapshot,
      "agent",
      snapshot.agentBlueprints.length > 0 ? "completed" : "not_started",
    );
    return this.save(snapshot);
  }

  async resetWorkbench(
    workspaceId = "default",
  ): Promise<IOntologyWorkbenchSnapshot> {
    const stored = await this.repository.getSnapshot(workspaceId);
    await this.repository.resetSnapshot(workspaceId);
    const snapshot = createDefaultOntologyWorkbenchSnapshot(Date.now(), {
      workspaceId,
      title: stored?.draft.title,
      description: stored?.draft.description,
      businessGoal: stored?.draft.businessGoal,
    });
    await this.repository.saveSnapshot(snapshot);
    return snapshot;
  }

  private async listNormalizedSnapshots(
    activeWorkspaceId: string,
  ): Promise<IOntologyWorkbenchSnapshot[]> {
    const snapshots = (await this.repository.listSnapshots()).map((snapshot) =>
      normalizeSnapshot(snapshot),
    );
    if (snapshots.length > 0)
      return snapshots.sort((left, right) => right.updatedAt - left.updatedAt);
    const snapshot = await this.getWorkbench(activeWorkspaceId);
    return [snapshot];
  }

  private async markPhase(
    snapshot: IOntologyWorkbenchSnapshot,
    phaseName: IOntologyPhaseTransitionInput["phase"],
    status: IOntologyPhaseTransitionInput["status"],
    summary?: string,
  ): Promise<void> {
    const now = Date.now();
    snapshot.phases = snapshot.phases.map((phase) =>
      phase.phase === phaseName
        ? {
            ...phase,
            status,
            summary: summary ?? phase.summary,
            startedAt: phase.startedAt ?? now,
            completedAt: status === "completed" ? now : phase.completedAt,
            blockingReason:
              status === "blocked" ? phase.blockingReason : undefined,
          }
        : phase,
    );
    snapshot.activePhase = phaseName;
  }

  private async save(
    snapshot: IOntologyWorkbenchSnapshot,
    expectedSnapshot?: IOntologyWorkbenchSnapshot,
  ): Promise<IOntologyWorkbenchSnapshot> {
    snapshot.updatedAt = Date.now();
    snapshot.stats = recalculateOntologyStats(snapshot);
    await this.repository.saveSnapshot(snapshot, expectedSnapshot);
    return snapshot;
  }

  private async afterModelEdit(
    snapshot: IOntologyWorkbenchSnapshot,
    source: OntologyCapabilityId,
    message: string,
    now: number,
    refreshDerivedArtifacts = true,
  ): Promise<void> {
    if (refreshDerivedArtifacts) {
      snapshot.mappings = reconcileFieldMappings(snapshot, now);
      snapshot.qualityRules = reconcileQualityRules(snapshot, now);
      snapshot.businessDocuments = createBusinessDocuments(
        snapshot.objects,
        snapshot.draft.title,
        snapshot.draft.businessGoal,
        now,
      );
      snapshot.logicFunctions = reconcileLogicFunctions(
        snapshot.logicFunctions,
        snapshot.objects,
        now,
      );
      snapshot.actions = reconcileActionDefinitions(
        snapshot.actions,
        snapshot.objects,
        now,
      );
    }
    snapshot.serviceEndpoints = createServiceEndpoints(snapshot, now);
    snapshot.impactAnalyses.unshift(
      createImpactAnalysis(message, snapshot.objects, snapshot.relations, now),
    );
    await this.markPhase(
      snapshot,
      "review",
      snapshot.objects.length > 0 ? "in_progress" : "not_started",
      "Ontology changes require review before publishing.",
    );
    addMonitorEvent(snapshot, source, message, now);
  }

  private async afterRuntimeEdit(
    snapshot: IOntologyWorkbenchSnapshot,
    message: string,
    now: number,
  ): Promise<void> {
    snapshot.serviceEndpoints = createServiceEndpoints(snapshot, now);
    snapshot.impactAnalyses.unshift(
      createImpactAnalysis(message, snapshot.objects, snapshot.relations, now),
    );
    await this.markPhase(
      snapshot,
      "review",
      snapshot.objects.length > 0 ? "in_progress" : "not_started",
      "Runtime changes require review before publishing.",
    );
    addMonitorEvent(snapshot, "logic_modeling", message, now);
  }
}

function normalizeSnapshot(
  snapshot: IOntologyWorkbenchSnapshot,
): IOntologyWorkbenchSnapshot {
  const objects = (snapshot.objects ?? []).map(normalizeObjectDraft);
  const normalized: IOntologyWorkbenchSnapshot = {
    ...snapshot,
    schemaVersion: ONTOLOGY_SNAPSHOT_SCHEMA_VERSION,
    objects,
    relations: (snapshot.relations ?? []).map((relation) =>
      normalizeRelationDraft(relation, objects),
    ),
    connectors: snapshot.connectors ?? [],
    connections: snapshot.connections ?? [],
    mappings: snapshot.mappings ?? [],
    qualityRules: snapshot.qualityRules ?? [],
    businessDocuments: snapshot.businessDocuments ?? [],
    logicFunctions: (snapshot.logicFunctions ?? []).map(normalizeLogicFunction),
    actions: (snapshot.actions ?? []).map(normalizeActionDefinition),
    serviceEndpoints: snapshot.serviceEndpoints ?? [],
    impactAnalyses: snapshot.impactAnalyses ?? [],
    monitorEvents: snapshot.monitorEvents ?? [],
    publishedVersions: (snapshot.publishedVersions ?? []).map((version) => {
      const versionObjects = (version.snapshot?.objects ?? []).map(
        normalizeObjectDraft,
      );
      return {
        ...version,
        isActive: version.isActive ?? version.status === "published",
        diff: version.diff ?? createEmptyVersionDiff(version.id),
        snapshot: version.snapshot
          ? {
              ...version.snapshot,
              objects: versionObjects,
              relations: (version.snapshot.relations ?? []).map((relation) =>
                normalizeRelationDraft(relation, versionObjects),
              ),
              mappings: version.snapshot.mappings ?? [],
              qualityRules: version.snapshot.qualityRules ?? [],
              logicFunctions: (version.snapshot.logicFunctions ?? []).map(
                normalizeLogicFunction,
              ),
              actions: (version.snapshot.actions ?? []).map(
                normalizeActionDefinition,
              ),
              serviceEndpoints: version.snapshot.serviceEndpoints ?? [],
              businessDocuments: version.snapshot.businessDocuments ?? [],
            }
          : createVersionSnapshot(snapshot),
      };
    }),
  };
  return {
    ...normalized,
    stats: recalculateOntologyStats(normalized),
  };
}

function normalizeObjectDraft(
  item: IOntologyObjectDraft,
): IOntologyObjectDraft {
  return {
    ...item,
    tier: item.tier ?? 3,
    status: item.status ?? "active",
    attributes: (item.attributes ?? []).map((attribute) => ({ ...attribute })),
  };
}

function seedWorkbenchIntegration(
  target: IOntologyWorkbenchSnapshot,
  source: IOntologyWorkbenchSnapshot,
): void {
  const now = Date.now();
  const connectorIdMap = new Map(
    source.connectors.map((connector) => [connector.id, randomUUID()]),
  );
  const assetIdMap = new Map(
    source.assets.map((asset) => [asset.id, randomUUID()]),
  );
  target.connectors = source.connectors.map((connector) => ({
    ...structuredClone(connector),
    id: connectorIdMap.get(connector.id) ?? randomUUID(),
    name: `${connector.name}::${target.workspaceId}`,
    metadata: {
      ...connector.metadata,
      displayName: connectorDisplayName(connector),
    },
    createdAt: now,
    updatedAt: now,
  }));
  target.assets = source.assets.map((asset) => {
    const connectorId =
      typeof asset.metadata.connectorId === "string"
        ? connectorIdMap.get(asset.metadata.connectorId)
        : undefined;
    return {
      ...structuredClone(asset),
      id: assetIdMap.get(asset.id) ?? randomUUID(),
      metadata: { ...asset.metadata, ...(connectorId ? { connectorId } : {}) },
      createdAt: now,
      updatedAt: now,
    };
  });
  target.connections = source.connections.map((connection) => ({
    ...structuredClone(connection),
    id: randomUUID(),
    connectorId: connection.connectorId
      ? connectorIdMap.get(connection.connectorId)
      : undefined,
    assetIds: connection.assetIds.flatMap((assetId) =>
      assetIdMap.has(assetId) ? [assetIdMap.get(assetId) as string] : [],
    ),
    createdAt: now,
    updatedAt: now,
  }));
  target.stats = recalculateOntologyStats(target);
}

function connectorDisplayName(connector: IOntologyConnectorConfig): string {
  return typeof connector.metadata.displayName === "string" &&
    connector.metadata.displayName.trim()
    ? connector.metadata.displayName
    : connector.name.split("::", 1)[0];
}

function normalizeRelationDraft(
  item: IOntologyRelationDraft,
  objects: IOntologyObjectDraft[],
): IOntologyRelationDraft {
  const fromObject = objects.find((object) => object.id === item.fromObjectId);
  const toObject = objects.find((object) => object.id === item.toObjectId);
  const storedDataBinding = normalizeRelationDataBinding(item.dataBinding);
  const inferredDataBinding =
    fromObject && toObject
      ? inferDirectRelationDataBinding(fromObject, toObject)
      : undefined;
  const isLegacyGeneratedBinding =
    Boolean(inferredDataBinding) &&
    (!storedDataBinding ||
      (!storedDataBinding.origin &&
        item.description?.startsWith("Generated relation between ")));
  const dataBinding = isLegacyGeneratedBinding
    ? inferredDataBinding
    : (storedDataBinding ?? inferredDataBinding);
  return {
    ...item,
    cardinality:
      isLegacyGeneratedBinding && inferredDataBinding && fromObject && toObject
        ? inferRelationCardinality(fromObject, toObject, inferredDataBinding)
        : item.cardinality,
    relationType: item.relationType ?? "object_property",
    semanticType: item.semanticType ?? "association",
    ...(dataBinding ? { dataBinding } : {}),
    isAcyclic: item.isAcyclic ?? false,
  };
}

function normalizeRelationDataBinding(
  binding: IOntologyRelationDataBinding | undefined,
): IOntologyRelationDataBinding | undefined {
  if (
    !binding ||
    !["semantic_only", "direct", "junction"].includes(binding.mode)
  )
    return undefined;
  const joinKeys = (binding.joinKeys ?? [])
    .filter(
      (key) =>
        typeof key.fromAttributeId === "string" &&
        typeof key.toAttributeId === "string",
    )
    .map((key) => ({
      fromAttributeId: key.fromAttributeId,
      toAttributeId: key.toAttributeId,
      ...(binding.mode === "junction" && key.junctionFromFieldName
        ? { junctionFromFieldName: key.junctionFromFieldName }
        : {}),
      ...(binding.mode === "junction" && key.junctionToFieldName
        ? { junctionToFieldName: key.junctionToFieldName }
        : {}),
    }));
  return {
    mode: binding.mode,
    joinKeys: binding.mode === "semantic_only" ? [] : joinKeys,
    ...(binding.mode === "junction" && binding.junctionAssetId
      ? { junctionAssetId: binding.junctionAssetId }
      : {}),
    ...(binding.origin === "inferred" || binding.origin === "manual"
      ? { origin: binding.origin }
      : {}),
  };
}

function inferDirectRelationDataBinding(
  fromObject: IOntologyObjectDraft,
  toObject: IOntologyObjectDraft,
): IOntologyRelationDataBinding | undefined {
  const fromIdentity = preferredIdentityAttribute(fromObject);
  const toIdentity = preferredIdentityAttribute(toObject);
  const fromReference = findReferenceAttribute(fromObject, toObject.code);
  const toReference = findReferenceAttribute(toObject, fromObject.code);
  const pair =
    toReference && fromIdentity
      ? { fromAttributeId: fromIdentity.id, toAttributeId: toReference.id }
      : fromReference && toIdentity
        ? { fromAttributeId: fromReference.id, toAttributeId: toIdentity.id }
        : undefined;
  const isMappedPair =
    pair &&
    fromObject.attributes.find(
      (attribute) => attribute.id === pair.fromAttributeId,
    )?.mappedField &&
    toObject.attributes.find((attribute) => attribute.id === pair.toAttributeId)
      ?.mappedField;
  return isMappedPair
    ? { mode: "direct", joinKeys: [pair], origin: "inferred" }
    : undefined;
}

function inferRelationCardinality(
  fromObject: IOntologyObjectDraft,
  toObject: IOntologyObjectDraft,
  binding: IOntologyRelationDataBinding,
): IOntologyRelationDraft["cardinality"] {
  const key = binding.joinKeys[0];
  const fromAttribute = fromObject.attributes.find(
    (attribute) => attribute.id === key?.fromAttributeId,
  );
  const toAttribute = toObject.attributes.find(
    (attribute) => attribute.id === key?.toAttributeId,
  );
  const fromIdentity = preferredIdentityAttribute(fromObject);
  const toIdentity = preferredIdentityAttribute(toObject);
  if (fromAttribute?.id === fromIdentity?.id) return "one_to_many";
  if (toAttribute?.id === toIdentity?.id) return "many_to_one";
  return "many_to_many";
}

function preferredIdentityAttribute(
  object: IOntologyObjectDraft,
): IOntologyAttributeDraft | undefined {
  return (
    object.attributes.find(
      (attribute) => attribute.code.toLowerCase() === "id",
    ) ?? object.attributes.find((attribute) => attribute.required)
  );
}

function findReferenceAttribute(
  object: IOntologyObjectDraft,
  referencedObjectCode: string,
): IOntologyAttributeDraft | undefined {
  const referenced = normalizeReferenceName(referencedObjectCode);
  return object.attributes.find((attribute) => {
    const code = normalizeReferenceName(attribute.code);
    return code === `${referenced}id` || code === referenced;
  });
}

function normalizeReferenceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, "");
}

function relationDefinitionIssue(
  relation: IOntologyRelationDraft,
  snapshot: IOntologyWorkbenchSnapshot,
): string | null {
  if (
    (relation.relationType === "symmetric_property" ||
      relation.relationType === "transitive_property") &&
    relation.fromObjectId !== relation.toObjectId
  ) {
    return `${relation.relationType === "symmetric_property" ? "Symmetric" : "Transitive"} relations must use the same source and target object.`;
  }
  if (
    relation.relationType === "functional_property" &&
    (relation.cardinality === "one_to_many" ||
      relation.cardinality === "many_to_many")
  ) {
    return "Functional relations must use one-to-one or many-to-one cardinality.";
  }
  const binding = relation.dataBinding;
  if (!binding || binding.mode === "semantic_only") return null;
  if (binding.joinKeys.length === 0)
    return "A data-bound relation requires at least one join key.";
  const fromObject = snapshot.objects.find(
    (object) => object.id === relation.fromObjectId,
  );
  const toObject = snapshot.objects.find(
    (object) => object.id === relation.toObjectId,
  );
  if (!fromObject || !toObject) return "Relation endpoints are unavailable.";
  if (binding.mode === "junction") {
    const asset = snapshot.assets.find(
      (item) => item.id === binding.junctionAssetId,
    );
    if (!asset)
      return "A junction relation requires an existing junction asset.";
    for (const key of binding.joinKeys) {
      if (
        !asset.fields.some(
          (field) => field.name === key.junctionFromFieldName,
        ) ||
        !asset.fields.some((field) => field.name === key.junctionToFieldName)
      ) {
        return "Junction relation fields must exist in the selected asset.";
      }
    }
  }
  const usedPairs = new Set<string>();
  for (const key of binding.joinKeys) {
    const fromAttribute = fromObject.attributes.find(
      (attribute) => attribute.id === key.fromAttributeId,
    );
    const toAttribute = toObject.attributes.find(
      (attribute) => attribute.id === key.toAttributeId,
    );
    if (!fromAttribute || !toAttribute)
      return "Relation join keys must reference attributes on their endpoint objects.";
    const pairKey = `${key.fromAttributeId}:${key.toAttributeId}`;
    if (usedPairs.has(pairKey)) return "Relation join keys must be unique.";
    usedPairs.add(pairKey);
    if (binding.mode === "direct") {
      if (
        !areRelationDataTypesCompatible(
          fromAttribute.dataType,
          toAttribute.dataType,
        )
      )
        return `Relation join attributes "${fromAttribute.name}" and "${toAttribute.name}" use incompatible data types.`;
      continue;
    }
    const junctionAsset = snapshot.assets.find(
      (asset) => asset.id === binding.junctionAssetId,
    );
    const junctionFromField = junctionAsset?.fields.find(
      (field) => field.name === key.junctionFromFieldName,
    );
    const junctionToField = junctionAsset?.fields.find(
      (field) => field.name === key.junctionToFieldName,
    );
    if (
      !junctionFromField ||
      !junctionToField ||
      !areRelationDataTypesCompatible(
        fromAttribute.dataType,
        junctionFromField.dataType,
      ) ||
      !areRelationDataTypesCompatible(
        toAttribute.dataType,
        junctionToField.dataType,
      )
    )
      return "Junction relation fields must use data types compatible with their endpoint attributes.";
  }
  return null;
}

function areRelationDataTypesCompatible(left: string, right: string): boolean {
  const family = (value: string): string => {
    const normalized = value.toLowerCase();
    if (/int|number|decimal|float|double|numeric/.test(normalized))
      return "number";
    if (/date|time/.test(normalized)) return "date";
    if (/bool/.test(normalized)) return "boolean";
    return "string";
  };
  return family(left) === family(right);
}

function removeAttributeFromRelationBinding(
  relation: IOntologyRelationDraft,
  attributeId: string,
): IOntologyRelationDraft {
  if (!relation.dataBinding) return relation;
  const joinKeys = relation.dataBinding.joinKeys.filter(
    (key) =>
      key.fromAttributeId !== attributeId && key.toAttributeId !== attributeId,
  );
  return joinKeys.length > 0
    ? { ...relation, dataBinding: { ...relation.dataBinding, joinKeys } }
    : omitRelationDataBinding(relation);
}

function omitRelationDataBinding(
  relation: IOntologyRelationDraft,
): IOntologyRelationDraft {
  const { dataBinding: _dataBinding, ...rest } = relation;
  return rest;
}

function normalizeLogicFunction(
  item: IOntologyLogicFunction,
): IOntologyLogicFunction {
  const origin = item.origin ?? "generated";
  const configuration = item.configuration ?? {};
  return {
    ...item,
    body: item.body ?? "",
    returnType: item.returnType ?? "unknown",
    parameters: item.parameters ?? [],
    configuration:
      origin === "generated" &&
      item.code.endsWith("_lookup") &&
      Object.keys(configuration).length === 0
        ? { builtIn: "lookup", objectId: item.objectIds[0] ?? "" }
        : configuration,
    origin,
    executionCount: item.executionCount ?? 0,
  };
}

function normalizeActionDefinition(
  item: IOntologyActionDefinition,
): IOntologyActionDefinition {
  const origin = item.origin ?? "generated";
  const configuration = item.configuration ?? {};
  const isLegacyGenerated =
    origin === "generated" && Object.keys(configuration).length === 0;
  const normalizedConfiguration = isLegacyGenerated
    ? item.code.endsWith("_update_attribute")
      ? { builtIn: "update_attribute", objectId: item.objectIds[0] ?? "" }
      : item.code.endsWith("_notify_owner")
        ? {
            title: `${item.name}`,
            message: `Record {{recordId}} requires attention.`,
          }
        : configuration
    : configuration;
  const generatedParameters = item.code.endsWith("_update_attribute")
    ? [
        { name: "recordId", type: "unknown", required: true },
        { name: "attributeCode", type: "string", required: true },
        { name: "value", type: "unknown", required: true },
      ]
    : item.code.endsWith("_notify_owner")
      ? [{ name: "recordId", type: "string", required: true }]
      : [];
  return {
    ...item,
    description: item.description ?? "",
    configuration: normalizedConfiguration,
    parameters:
      origin === "generated" && (item.parameters?.length ?? 0) === 0
        ? generatedParameters
        : (item.parameters ?? []),
    outputSchema: item.outputSchema ?? [],
    origin,
    status:
      isLegacyGenerated && item.code.endsWith("_update_attribute")
        ? "draft"
        : (item.status ?? "active"),
    executionCount: item.executionCount ?? 0,
  };
}

function normalizeConnectorInput(
  input: IOntologyConnectorInput,
  now: number,
  probeStatus: IOntologyConnectorConfig["probeStatus"],
  lastError?: string,
): IOntologyConnectorConfig {
  return {
    id: input.id?.trim() || randomUUID(),
    name: input.name.trim(),
    sourceType: input.sourceType,
    kind: input.kind,
    host: input.host?.trim() || undefined,
    port: input.port,
    database: input.database?.trim() || undefined,
    path: input.path?.trim() || undefined,
    url: input.url?.trim() || undefined,
    username: input.username?.trim() || undefined,
    password: input.password,
    credentialRef: input.credentialRef?.trim() || undefined,
    credential: input.credential,
    params: input.params,
    headers: input.headers,
    writable: input.writable,
    poolSize: input.poolSize,
    rateLimitQps: input.rateLimitQps,
    description: input.description?.trim() || undefined,
    metadata: input.metadata ?? {},
    probeStatus,
    lastProbeAt: now,
    lastError,
    createdAt: now,
    updatedAt: now,
  };
}

function inferAssetKind(extension: string): OntologyAssetKind {
  const normalized = extension.toLowerCase();
  if ([".sql", ".db", ".sqlite", ".sqlite3"].includes(normalized))
    return "database";
  if ([".json", ".yaml", ".yml", ".csv", ".xlsx", ".xls"].includes(normalized))
    return "table";
  return "document";
}

function assertUniqueCode<T extends { id: string; code: string }>(
  items: T[],
  currentId: string,
  code: string,
  label: string,
): void {
  const duplicated = items.find(
    (item) => item.id !== currentId && item.code === code,
  );
  if (duplicated) throw new Error(`${label} code "${code}" already exists.`);
}

function requireName(value: string, label: string): string {
  const name = value.trim();
  if (!name) throw new Error(`${label} name is required.`);
  return name;
}

function validateObjectReferences(
  snapshot: IOntologyWorkbenchSnapshot,
  objectIds: string[],
  label: string,
): void {
  const knownIds = new Set(snapshot.objects.map((object) => object.id));
  const missingIds = dedupe(objectIds).filter((id) => !knownIds.has(id));
  if (missingIds.length > 0)
    throw new Error(
      `${label} references missing ontology object(s): ${missingIds.join(", ")}.`,
    );
}

function validateMappingInput(
  snapshot: IOntologyWorkbenchSnapshot,
  input: IOntologyFieldMappingInput,
): void {
  const object = snapshot.objects.find((item) => item.id === input.objectId);
  if (!object) throw new Error("Mapping object not found.");
  if (
    !object.attributes.some((attribute) => attribute.id === input.attributeId)
  )
    throw new Error("Mapping attribute not found.");
  const asset = snapshot.assets.find((item) => item.id === input.assetId);
  if (!asset) throw new Error("Mapping asset not found.");
  if (!asset.fields.some((field) => field.name === input.fieldName))
    throw new Error("Mapping field not found on selected asset.");
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function mergeDocumentExtraction(
  snapshot: IOntologyWorkbenchSnapshot,
  extraction: IOntologyDocumentExtraction,
  documentAssetIds: Set<string>,
  structuredObjects: IOntologyObjectDraft[],
  structuredRelations: IOntologyRelationDraft[],
  now: number,
): void {
  if (!extraction?.objects?.length || !Array.isArray(extraction.relations)) {
    throw new Error("ontology.documentErrors.invalidResult");
  }
  const relatedObjects = snapshot.objects.filter((object) =>
    object.sourceAssetIds.some((id) => documentAssetIds.has(id)),
  );
  if (
    relatedObjects.some((object) =>
      object.sourceAssetIds.some((id) => !documentAssetIds.has(id)),
    )
  ) {
    throw new Error("ontology.documentErrors.conflict");
  }
  const relatedIds = new Set(relatedObjects.map((object) => object.id));
  const documentObjects = extraction.objects.map(
    (definition): IOntologyObjectDraft => {
      if (
        !definition.sourceAssetIds.length ||
        definition.sourceAssetIds.some((id) => !documentAssetIds.has(id))
      ) {
        throw new Error("ontology.documentErrors.invalidResult");
      }
      const code = toCode(definition.code);
      const sourceAssetIds = dedupe(definition.sourceAssetIds).sort();
      const candidates = snapshot.objects.filter(
        (object) => toCode(object.code) === code,
      );
      if (
        candidates.length > 1 ||
        candidates.some(
          (object) =>
            !relatedIds.has(object.id) ||
            !isDeepStrictEqual(
              dedupe(object.sourceAssetIds).sort(),
              sourceAssetIds,
            ),
        )
      ) {
        throw new Error("ontology.documentErrors.conflict");
      }
      const previous = candidates[0];
      const attributes = definition.attributes.map(
        (attribute): IOntologyAttributeDraft => {
          const attributeCode = toCode(attribute.code);
          const matches =
            previous?.attributes.filter(
              (item) => toCode(item.code) === attributeCode,
            ) ?? [];
          if (matches.length > 1)
            throw new Error("ontology.documentErrors.conflict");
          const nextAttribute: IOntologyAttributeDraft = {
            ...matches[0],
            id: matches[0]?.id ?? randomUUID(),
            code: attributeCode,
            name: attribute.name,
            dataType: attribute.dataType,
            required: attribute.required,
            description: attribute.description,
          };
          const mappedField = nextAttribute.mappedField;
          return mappedField &&
            !snapshot.assets.some(
              (asset) =>
                asset.id === mappedField.assetId &&
                asset.fields.some(
                  (field) => field.name === mappedField.fieldName,
                ),
            )
            ? omitMappedField(nextAttribute)
            : nextAttribute;
        },
      );
      if (
        new Set(attributes.map((attribute) => attribute.code)).size !==
        attributes.length
      ) {
        throw new Error("ontology.documentErrors.invalidResult");
      }
      const object: IOntologyObjectDraft = {
        ...previous,
        id: previous?.id ?? randomUUID(),
        code,
        name: definition.name,
        description: definition.description,
        tier: previous?.tier ?? 3,
        status: previous?.status ?? "active",
        sourceAssetIds: previous?.sourceAssetIds ?? sourceAssetIds,
        attributes,
        reviewDecision: "pending",
        updatedAt: now,
      };
      if (
        previous &&
        isDeepStrictEqual(
          documentObjectContent(previous),
          documentObjectContent(object),
        )
      ) {
        object.reviewDecision = previous.reviewDecision;
        object.updatedAt = previous.updatedAt;
      }
      return object;
    },
  );
  if (
    new Set(documentObjects.map((object) => object.code)).size !==
    documentObjects.length
  ) {
    throw new Error("ontology.documentErrors.invalidResult");
  }
  const structuredSourceIds = new Set(
    structuredObjects.flatMap((object) => object.sourceAssetIds),
  );
  const replacedStructuredIds = new Set(
    snapshot.objects
      .filter((object) =>
        object.sourceAssetIds.some((id) => structuredSourceIds.has(id)),
      )
      .map((object) => object.id),
  );
  if (
    snapshot.objects.some(
      (object) =>
        replacedStructuredIds.has(object.id) &&
        object.sourceAssetIds.some((id) => !structuredSourceIds.has(id)),
    )
  ) {
    throw new Error("ontology.documentErrors.conflict");
  }
  // Document regeneration replaces only selected sources, even in replace mode.
  const objects = [
    ...snapshot.objects.filter(
      (object) =>
        !relatedIds.has(object.id) && !replacedStructuredIds.has(object.id),
    ),
    ...structuredObjects,
    ...documentObjects,
  ];
  if (
    new Set(objects.map((object) => toCode(object.code))).size !==
    objects.length
  ) {
    throw new Error("ontology.documentErrors.conflict");
  }
  const objectByCode = new Map(
    documentObjects.map((object) => [object.code, object]),
  );
  const documentRelations = extraction.relations.map(
    (definition): IOntologyRelationDraft => {
      const from = objectByCode.get(toCode(definition.from));
      const to = objectByCode.get(toCode(definition.to));
      if (!from || !to)
        throw new Error("ontology.documentErrors.invalidResult");
      const code = toCode(definition.code);
      const candidates = snapshot.relations.filter(
        (relation) => toCode(relation.code) === code,
      );
      if (
        candidates.length > 1 ||
        candidates.some(
          (relation) =>
            !relatedIds.has(relation.fromObjectId) ||
            !relatedIds.has(relation.toObjectId),
        )
      ) {
        throw new Error("ontology.documentErrors.conflict");
      }
      const previous = candidates[0];
      const relation: IOntologyRelationDraft = {
        ...previous,
        id: previous?.id ?? randomUUID(),
        code,
        name: definition.name,
        description: definition.description,
        fromObjectId: from.id,
        toObjectId: to.id,
        cardinality: definition.cardinality,
        relationType: previous?.relationType ?? "object_property",
        semanticType: previous?.semanticType ?? "association",
        isAcyclic: previous?.isAcyclic ?? false,
        reviewDecision: "pending",
        updatedAt: now,
      };
      if (
        previous &&
        isDeepStrictEqual(
          {
            ...previous,
            code: toCode(previous.code),
            description: previous.description ?? "",
          },
          {
            ...relation,
            reviewDecision: previous.reviewDecision,
            updatedAt: previous.updatedAt,
          },
        )
      ) {
        relation.reviewDecision = previous.reviewDecision;
        relation.updatedAt = previous.updatedAt;
      }
      return relation;
    },
  );
  for (const relation of structuredRelations) {
    if (
      snapshot.relations.some(
        (previous) =>
          toCode(previous.code) === toCode(relation.code) &&
          (!replacedStructuredIds.has(previous.fromObjectId) ||
            !replacedStructuredIds.has(previous.toObjectId)),
      )
    ) {
      throw new Error("ontology.documentErrors.conflict");
    }
  }
  const objectIds = new Set(objects.map((object) => object.id));
  const relations = [
    ...snapshot.relations.filter(
      (relation) =>
        objectIds.has(relation.fromObjectId) &&
        objectIds.has(relation.toObjectId) &&
        !(
          relatedIds.has(relation.fromObjectId) &&
          relatedIds.has(relation.toObjectId)
        ) &&
        !(
          replacedStructuredIds.has(relation.fromObjectId) &&
          replacedStructuredIds.has(relation.toObjectId)
        ),
    ),
    ...structuredRelations,
    ...documentRelations,
  ];
  if (
    new Set(relations.map((relation) => toCode(relation.code))).size !==
    relations.length
  ) {
    throw new Error("ontology.documentErrors.conflict");
  }
  const oldGeneratedRuleIds = new Set(
    createQualityRules(relatedObjects, now).map(
      (rule) => `${rule.objectId}:${rule.code}`,
    ),
  );
  snapshot.qualityRules = snapshot.qualityRules.filter(
    (rule) => !oldGeneratedRuleIds.has(`${rule.objectId}:${rule.code}`),
  );
  snapshot.objects = objects;
  snapshot.relations = relations;
}

function documentObjectContent(object: IOntologyObjectDraft) {
  const {
    reviewDecision: _reviewDecision,
    updatedAt: _updatedAt,
    ...content
  } = object;
  return {
    ...content,
    code: toCode(object.code),
    sourceAssetIds: dedupe(object.sourceAssetIds).sort(),
    attributes: object.attributes
      .map((attribute) => ({
        ...attribute,
        code: toCode(attribute.code),
        description: attribute.description ?? "",
      }))
      .sort((left, right) => left.code.localeCompare(right.code)),
  };
}

function createObjectsFromAsset(
  asset: IOntologyEnvironmentAsset,
  now: number,
): IOntologyObjectDraft[] {
  const template = ontologyTemplateFromMetadata(asset.metadata);
  if (!template || template.objects.length === 0)
    return [createObjectFromAsset(asset, now)];

  return template.objects.map((definition) => ({
    id: randomUUID(),
    code: toCode(definition.code || definition.name),
    name: definition.name || toTitle(definition.code),
    description: definition.description ?? "",
    tier: definition.tier,
    status: definition.status,
    namespace: definition.namespace,
    sourceAssetIds: [asset.id],
    attributes: definition.attributes.map((attribute) => ({
      id: randomUUID(),
      code: toCode(attribute.code || attribute.name),
      name: attribute.name || toTitle(attribute.code),
      dataType: normalizeDataType(attribute.dataType),
      required: attribute.required,
      description: attribute.description,
    })),
    reviewDecision: "pending",
    updatedAt: now,
  }));
}

function createObjectFromAsset(
  asset: IOntologyEnvironmentAsset,
  now: number,
): IOntologyObjectDraft {
  const baseName = stripExtension(asset.name);
  const attributes = (
    asset.fields.length > 0 ? asset.fields : createFallbackFields(asset)
  ).map((field) => createAttributeFromField(asset.id, field));
  return {
    id: randomUUID(),
    code: toCode(baseName),
    name: toTitle(baseName),
    description: `Generated from ${asset.kind} asset ${asset.name}.`,
    tier: 3,
    status: "active",
    sourceAssetIds: [asset.id],
    attributes,
    reviewDecision: "pending",
    updatedAt: now,
  };
}

function createRelationsFromTemplateAssets(
  assets: IOntologyEnvironmentAsset[],
  objects: IOntologyObjectDraft[],
  now: number,
): IOntologyRelationDraft[] {
  const objectByCode = new Map(objects.map((object) => [object.code, object]));
  return assets.flatMap((asset) => {
    const template = ontologyTemplateFromMetadata(asset.metadata);
    if (!template) return [];
    return template.relations.flatMap((definition) => {
      const from = objectByCode.get(toCode(definition.from));
      const to = objectByCode.get(toCode(definition.to));
      if (!from || !to) return [];
      const dataBinding = inferDirectRelationDataBinding(from, to);
      return [
        {
          id: randomUUID(),
          code: toCode(definition.code || `${from.code}_to_${to.code}`),
          name: definition.name || `${from.name} to ${to.name}`,
          fromObjectId: from.id,
          toObjectId: to.id,
          cardinality: definition.cardinality,
          relationType: "object_property" as const,
          semanticType: "association" as const,
          ...(dataBinding ? { dataBinding } : {}),
          isAcyclic: false,
          description: definition.description,
          reviewDecision: "pending" as const,
          updatedAt: now,
        },
      ];
    });
  });
}

function ontologyTemplateFromMetadata(
  metadata: Record<string, unknown>,
): IOntologyTemplateDefinition | null {
  const rawCandidate = metadata.ontologyTemplate;
  let candidate: unknown = rawCandidate;
  if (typeof rawCandidate === "string") {
    try {
      candidate = JSON.parse(rawCandidate) as unknown;
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return null;
  const template = candidate as Partial<IOntologyTemplateDefinition>;
  if (!Array.isArray(template.objects) || !Array.isArray(template.relations))
    return null;
  return template as IOntologyTemplateDefinition;
}

function syncObjectAttributesFromAsset(
  objects: IOntologyObjectDraft[],
  assetId: string,
  fields: IOntologyAssetField[],
  now: number,
): IOntologyObjectDraft[] {
  return objects.map((object) => {
    if (!object.sourceAssetIds.includes(assetId)) return object;
    const existingMappedFieldNames = new Set(
      object.attributes.flatMap((attribute) =>
        attribute.mappedField?.assetId === assetId
          ? [attribute.mappedField.fieldName]
          : [],
      ),
    );
    const missingAttributes = fields
      .filter((field) => !existingMappedFieldNames.has(field.name))
      .map((field) => createAttributeFromField(assetId, field));
    if (missingAttributes.length === 0) return object;
    return {
      ...object,
      attributes: [...object.attributes, ...missingAttributes],
      reviewDecision: "pending",
      updatedAt: now,
    };
  });
}

function createObjectFromBusinessGoal(
  goal: string,
  now: number,
): IOntologyObjectDraft {
  const baseName =
    goal
      .trim()
      .split(/[\s,，.。;；]/)
      .filter(Boolean)
      .slice(0, 3)
      .join(" ") || "Business Object";
  return {
    id: randomUUID(),
    code: toCode(baseName),
    name: toTitle(baseName),
    description: goal.trim() || "Generated from the business goal.",
    tier: 3,
    status: "active",
    sourceAssetIds: [],
    attributes: [
      createAttribute("id", "ID", "string", true),
      createAttribute("name", "Name", "string", true),
      createAttribute("description", "Description", "text", false),
    ],
    reviewDecision: "pending",
    updatedAt: now,
  };
}

function createRelationsFromObjects(
  objects: IOntologyObjectDraft[],
  now: number,
): IOntologyRelationDraft[] {
  const relations: IOntologyRelationDraft[] = [];
  for (let i = 0; i < objects.length - 1; i += 1) {
    const from = objects[i];
    const to = objects[i + 1];
    const dataBinding = inferDirectRelationDataBinding(from, to);
    relations.push({
      id: randomUUID(),
      code: `${from.code}_to_${to.code}`,
      name: `${from.name} to ${to.name}`,
      fromObjectId: from.id,
      toObjectId: to.id,
      cardinality: dataBinding
        ? inferRelationCardinality(from, to, dataBinding)
        : "one_to_many",
      relationType: "object_property",
      semanticType: "association",
      ...(dataBinding ? { dataBinding } : {}),
      isAcyclic: false,
      description: dataBinding
        ? `Generated field-bound relation between ${from.name} and ${to.name}.`
        : `Generated relation between ${from.name} and ${to.name}.`,
      reviewDecision: "pending",
      updatedAt: now,
    });
  }
  return relations;
}

function createFieldMappings(
  objects: IOntologyObjectDraft[],
  now: number,
): IOntologyFieldMapping[] {
  return objects.flatMap((object) =>
    object.attributes.flatMap((attribute) => {
      if (!attribute.mappedField) return [];
      return [
        {
          id: randomUUID(),
          objectId: object.id,
          attributeId: attribute.id,
          assetId: attribute.mappedField.assetId,
          fieldName: attribute.mappedField.fieldName,
          confidence:
            attribute.code === toCode(attribute.mappedField.fieldName)
              ? 0.98
              : 0.86,
          strategy:
            attribute.code === toCode(attribute.mappedField.fieldName)
              ? ("exact" as const)
              : ("normalized" as const),
          status: "approved" as const,
          updatedAt: now,
        },
      ];
    }),
  );
}

function reconcileFieldMappings(
  snapshot: IOntologyWorkbenchSnapshot,
  now: number,
): IOntologyFieldMapping[] {
  const generated = createFieldMappings(snapshot.objects, now);
  const generatedKeys = new Set(
    generated.map((mapping) => mappingKey(mapping)),
  );
  const manual = snapshot.mappings.filter(
    (mapping) =>
      mapping.strategy === "manual" &&
      isMappingStillValid(snapshot, mapping) &&
      !generatedKeys.has(mappingKey(mapping)),
  );
  return [...generated, ...manual];
}

function reconcileQualityRules(
  snapshot: IOntologyWorkbenchSnapshot,
  now: number,
): IOntologyQualityRule[] {
  const generated = createQualityRules(snapshot.objects, now);
  const generatedKeys = new Set(
    generated.map((rule) => `${rule.objectId}:${rule.code}`),
  );
  const manual = snapshot.qualityRules.filter(
    (rule) =>
      snapshot.objects.some((object) => object.id === rule.objectId) &&
      !generatedKeys.has(`${rule.objectId}:${rule.code}`),
  );
  return [...generated, ...manual];
}

function mappingKey(
  mapping: Pick<
    IOntologyFieldMapping,
    "objectId" | "attributeId" | "assetId" | "fieldName"
  >,
): string {
  return `${mapping.objectId}:${mapping.attributeId}:${mapping.assetId}:${mapping.fieldName}`;
}

function isMappingStillValid(
  snapshot: IOntologyWorkbenchSnapshot,
  mapping: IOntologyFieldMapping,
): boolean {
  const object = snapshot.objects.find((item) => item.id === mapping.objectId);
  const asset = snapshot.assets.find((item) => item.id === mapping.assetId);
  return Boolean(
    object?.attributes.some(
      (attribute) => attribute.id === mapping.attributeId,
    ) && asset?.fields.some((field) => field.name === mapping.fieldName),
  );
}

function createQualityRules(
  objects: IOntologyObjectDraft[],
  now: number,
): IOntologyQualityRule[] {
  return objects.flatMap((object) => {
    const requiredAttributes = object.attributes.filter(
      (attribute) => attribute.required,
    );
    const idAttribute =
      object.attributes.find((attribute) => attribute.code === "id") ??
      requiredAttributes[0];
    const rules: IOntologyQualityRule[] = [];
    if (idAttribute) {
      rules.push({
        id: randomUUID(),
        objectId: object.id,
        code: `${object.code}_identity_required`,
        name: `${object.name} identity required`,
        expression: `${idAttribute.code} IS NOT NULL`,
        severity: "error",
        status: "active",
        updatedAt: now,
      });
    }
    if (requiredAttributes.length > 0) {
      rules.push({
        id: randomUUID(),
        objectId: object.id,
        code: `${object.code}_required_fields_complete`,
        name: `${object.name} required fields complete`,
        expression: requiredAttributes
          .map((attribute) => `${attribute.code} IS NOT NULL`)
          .join(" AND "),
        severity: "warning",
        status: "active",
        updatedAt: now,
      });
    }
    return rules;
  });
}

function createBusinessDocuments(
  objects: IOntologyObjectDraft[],
  title: string,
  businessGoal: string,
  now: number,
): IOntologyBusinessDocument[] {
  const objectLines =
    objects
      .map((object) => `- ${object.name}: ${object.description}`)
      .join("\n") || "- No ontology objects generated.";
  return [
    {
      id: randomUUID(),
      title: `${title || "Ontology"} Specification`,
      format: "markdown",
      objectIds: objects.map((object) => object.id),
      content: [
        `# ${title || "Ontology Specification"}`,
        "",
        businessGoal || "Generated ontology specification.",
        "",
        "## Objects",
        objectLines,
      ].join("\n"),
      updatedAt: now,
    },
  ];
}

function createLogicFunctions(
  objects: IOntologyObjectDraft[],
  now: number,
): IOntologyLogicFunction[] {
  return objects.map((object) => ({
    id: randomUUID(),
    code: `${object.code}_lookup`,
    name: `${object.name} Lookup`,
    description: `Lookup approved ${object.name} records through ontology mappings.`,
    runtime: "typescript",
    objectIds: [object.id],
    signature: `async function ${object.code}Lookup(query: Record<string, unknown>): Promise<${toTitle(object.code).replace(/\s+/g, "")}[]>`,
    body: "",
    returnType: "object[]",
    parameters: [
      { name: "query", type: "object", required: true, objectId: object.id },
    ],
    configuration: { builtIn: "lookup", objectId: object.id },
    origin: "generated",
    status: "active",
    executionCount: 0,
    updatedAt: now,
  }));
}

function reconcileLogicFunctions(
  existing: IOntologyLogicFunction[],
  objects: IOntologyObjectDraft[],
  now: number,
): IOntologyLogicFunction[] {
  const objectIds = new Set(objects.map((object) => object.id));
  const retained = existing
    .map(normalizeLogicFunction)
    .filter((item) => item.origin === "manual")
    .map((item) => ({
      ...item,
      objectIds: item.objectIds.filter((id) => objectIds.has(id)),
    }));
  const existingGeneratedByCode = new Map(
    existing
      .filter((item) => normalizeLogicFunction(item).origin === "generated")
      .map((item) => [item.code, normalizeLogicFunction(item)]),
  );
  const generated = createLogicFunctions(objects, now).map((item) => {
    const previous = existingGeneratedByCode.get(item.code);
    return previous
      ? {
          ...item,
          id: previous.id,
          executionCount: previous.executionCount,
          lastExecutedAt: previous.lastExecutedAt,
        }
      : item;
  });
  return [...retained, ...generated];
}

function createActionDefinitions(
  objects: IOntologyObjectDraft[],
  now: number,
): IOntologyActionDefinition[] {
  return objects.flatMap((object): IOntologyActionDefinition[] => [
    {
      id: randomUUID(),
      code: `${object.code}_update_attribute`,
      name: `Update ${object.name} Attribute`,
      executor: "function" as const,
      objectIds: [object.id],
      description: `Update an approved attribute on ${object.name}.`,
      configuration: {
        builtIn: "update_attribute",
        objectId: object.id,
      },
      parameters: [
        {
          name: "recordId",
          type: "unknown",
          required: true,
          description: "Identity value of the record to update.",
          objectId: object.id,
        },
        {
          name: "attributeCode",
          type: "string",
          required: true,
          description: "Ontology attribute code to update.",
          objectId: object.id,
        },
        {
          name: "value",
          type: "unknown",
          required: true,
          description: "New attribute value.",
          objectId: object.id,
        },
      ],
      outputSchema: [
        {
          name: "changes",
          type: "number",
          description: "Number of updated rows.",
        },
      ],
      origin: "generated" as const,
      status: "draft" as const,
      executionCount: 0,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      code: `${object.code}_notify_owner`,
      name: `Notify ${object.name} Owner`,
      executor: "notification" as const,
      objectIds: [object.id],
      description: `Notify the owner of ${object.name}.`,
      configuration: {
        title: `${object.name} notification`,
        message: `${object.name} {{recordId}} requires attention.`,
      },
      parameters: [
        {
          name: "recordId",
          type: "string",
          required: true,
          description: "Identity value shown in the notification.",
          objectId: object.id,
        },
      ],
      outputSchema: [
        {
          name: "delivered",
          type: "boolean",
          description: "Whether the desktop notification was delivered.",
        },
      ],
      origin: "generated" as const,
      status: "active" as const,
      executionCount: 0,
      updatedAt: now,
    },
  ]);
}

function reconcileActionDefinitions(
  existing: IOntologyActionDefinition[],
  objects: IOntologyObjectDraft[],
  now: number,
): IOntologyActionDefinition[] {
  const objectIds = new Set(objects.map((object) => object.id));
  const retained = existing
    .map(normalizeActionDefinition)
    .filter((item) => item.origin === "manual")
    .map((item) => ({
      ...item,
      objectIds: item.objectIds.filter((id) => objectIds.has(id)),
    }));
  const existingGeneratedByCode = new Map(
    existing
      .filter((item) => normalizeActionDefinition(item).origin === "generated")
      .map((item) => [item.code, normalizeActionDefinition(item)]),
  );
  const generated = createActionDefinitions(objects, now).map((item) => {
    const previous = existingGeneratedByCode.get(item.code);
    return previous
      ? {
          ...item,
          id: previous.id,
          executionCount: previous.executionCount,
          lastExecutedAt: previous.lastExecutedAt,
        }
      : item;
  });
  return [...retained, ...generated];
}

function createServiceEndpoints(
  snapshot: IOntologyWorkbenchSnapshot,
  now: number,
): IOntologyServiceEndpoint[] {
  const runtimeToolCount =
    snapshot.logicFunctions.filter((item) => item.status === "active").length +
    snapshot.actions.filter((item) => item.status === "active").length +
    snapshot.relations.filter(
      (item) => item.dataBinding && item.dataBinding.mode !== "semantic_only",
    ).length;
  return [
    {
      id:
        snapshot.serviceEndpoints.find(
          (endpoint) => endpoint.protocol === "mcp",
        )?.id ?? randomUUID(),
      name: "Ontology MCP Tools",
      protocol: "mcp",
      status: snapshot.objects.length > 0 ? "active" : "draft",
      toolCount: 6 + runtimeToolCount,
      updatedAt: now,
    },
    {
      id:
        snapshot.serviceEndpoints.find(
          (endpoint) => endpoint.protocol === "osdk",
        )?.id ?? randomUUID(),
      name: "Ontology OSDK Manifest",
      protocol: "osdk",
      status: snapshot.publishedVersions.length > 0 ? "active" : "draft",
      toolCount: snapshot.objects.length + snapshot.relations.length,
      updatedAt: now,
    },
    {
      id:
        snapshot.serviceEndpoints.find(
          (endpoint) => endpoint.protocol === "api",
        )?.id ?? randomUUID(),
      name: "Ontology Runtime API",
      protocol: "api",
      status: runtimeToolCount > 0 ? "active" : "draft",
      toolCount: runtimeToolCount,
      updatedAt: now,
    },
  ];
}

function createVersionSnapshot(
  snapshot: IOntologyWorkbenchSnapshot,
): IOntologyVersionSnapshot {
  return {
    objects: structuredClone(snapshot.objects),
    relations: structuredClone(snapshot.relations),
    mappings: structuredClone(snapshot.mappings),
    qualityRules: structuredClone(snapshot.qualityRules),
    logicFunctions: structuredClone(snapshot.logicFunctions),
    actions: structuredClone(snapshot.actions),
    serviceEndpoints: structuredClone(snapshot.serviceEndpoints),
    businessDocuments: structuredClone(snapshot.businessDocuments),
  };
}

function createVersionDiff(
  snapshot: IOntologyWorkbenchSnapshot,
): IOntologyVersionDiff {
  const previous = [...snapshot.publishedVersions]
    .reverse()
    .find((version) => version.status === "published" && version.snapshot);
  if (!previous) {
    return {
      fromVersionId: undefined,
      addedObjectIds: snapshot.objects.map((object) => object.id),
      changedObjectIds: [],
      removedObjectIds: [],
      addedRelationIds: snapshot.relations.map((relation) => relation.id),
      changedRelationIds: [],
      removedRelationIds: [],
      riskLevel:
        snapshot.objects.length + snapshot.relations.length > 8
          ? "medium"
          : "low",
      summary: "Initial ontology publication.",
    };
  }

  const previousObjectById = new Map(
    previous.snapshot.objects.map((object) => [object.id, object]),
  );
  const currentObjectById = new Map(
    snapshot.objects.map((object) => [object.id, object]),
  );
  const previousRelationById = new Map(
    previous.snapshot.relations.map((relation) => [relation.id, relation]),
  );
  const currentRelationById = new Map(
    snapshot.relations.map((relation) => [relation.id, relation]),
  );
  const addedObjectIds = snapshot.objects
    .filter((object) => !previousObjectById.has(object.id))
    .map((object) => object.id);
  const removedObjectIds = previous.snapshot.objects
    .filter((object) => !currentObjectById.has(object.id))
    .map((object) => object.id);
  const changedObjectIds = snapshot.objects
    .filter((object) => {
      const before = previousObjectById.get(object.id);
      return before && JSON.stringify(before) !== JSON.stringify(object);
    })
    .map((object) => object.id);
  const addedRelationIds = snapshot.relations
    .filter((relation) => !previousRelationById.has(relation.id))
    .map((relation) => relation.id);
  const removedRelationIds = previous.snapshot.relations
    .filter((relation) => !currentRelationById.has(relation.id))
    .map((relation) => relation.id);
  const changedRelationIds = snapshot.relations
    .filter((relation) => {
      const before = previousRelationById.get(relation.id);
      return before && JSON.stringify(before) !== JSON.stringify(relation);
    })
    .map((relation) => relation.id);
  const changeCount =
    addedObjectIds.length +
    removedObjectIds.length +
    changedObjectIds.length +
    addedRelationIds.length +
    removedRelationIds.length +
    changedRelationIds.length;
  return {
    fromVersionId: previous.id,
    addedObjectIds,
    changedObjectIds,
    removedObjectIds,
    addedRelationIds,
    changedRelationIds,
    removedRelationIds,
    riskLevel:
      changeCount > 12 || removedObjectIds.length > 0
        ? "high"
        : changeCount > 4
          ? "medium"
          : "low",
    summary: `${changeCount} ontology change(s) since ${previous.version}.`,
  };
}

function createEmptyVersionDiff(versionId?: string): IOntologyVersionDiff {
  return {
    fromVersionId: versionId,
    addedObjectIds: [],
    changedObjectIds: [],
    removedObjectIds: [],
    addedRelationIds: [],
    changedRelationIds: [],
    removedRelationIds: [],
    riskLevel: "low",
    summary: "Version diff unavailable for legacy version.",
  };
}

function createImpactAnalysis(
  summary: string,
  objects: IOntologyObjectDraft[],
  relations: IOntologyRelationDraft[],
  now: number,
): IOntologyImpactAnalysis {
  const affectedCount = objects.length + relations.length;
  return {
    id: randomUUID(),
    summary,
    affectedObjectIds: objects.map((object) => object.id),
    affectedRelationIds: relations.map((relation) => relation.id),
    riskLevel:
      affectedCount > 12 ? "high" : affectedCount > 4 ? "medium" : "low",
    createdAt: now,
  };
}

function removeAssetsFromSnapshot(
  snapshot: IOntologyWorkbenchSnapshot,
  assetIds: string[],
): void {
  const removedIds = new Set(assetIds);
  snapshot.assets = snapshot.assets.filter(
    (asset) => !removedIds.has(asset.id),
  );
  snapshot.draft.selectedAssetIds = snapshot.draft.selectedAssetIds.filter(
    (assetId) => !removedIds.has(assetId),
  );
  snapshot.mappings = snapshot.mappings.filter(
    (mapping) => !removedIds.has(mapping.assetId),
  );
  snapshot.relations = snapshot.relations.map((relation) =>
    relation.dataBinding?.junctionAssetId &&
    removedIds.has(relation.dataBinding.junctionAssetId)
      ? omitRelationDataBinding(relation)
      : relation,
  );
  snapshot.objects = snapshot.objects.map((object) => ({
    ...object,
    sourceAssetIds: object.sourceAssetIds.filter(
      (assetId) => !removedIds.has(assetId),
    ),
    attributes: object.attributes.map((attribute) =>
      attribute.mappedField && removedIds.has(attribute.mappedField.assetId)
        ? omitMappedField(attribute)
        : attribute,
    ),
  }));
  snapshot.connections = snapshot.connections
    .map((connection) => ({
      ...connection,
      assetIds: connection.assetIds.filter(
        (assetId) => !removedIds.has(assetId),
      ),
    }))
    .filter((connection) => connection.assetIds.length > 0);
}

function omitMappedField(
  attribute: IOntologyAttributeDraft,
): IOntologyAttributeDraft {
  const { mappedField: _mappedField, ...rest } = attribute;
  return rest;
}

function upsertConnectionProfile(
  snapshot: IOntologyWorkbenchSnapshot,
  asset: IOntologyEnvironmentAsset,
  now: number,
): void {
  const name = asset.sourceName || asset.kind;
  const existing = snapshot.connections.find(
    (connection) => connection.name === name && connection.kind === asset.kind,
  );
  if (existing) {
    snapshot.connections = snapshot.connections.map((connection) =>
      connection.id === existing.id
        ? {
            ...connection,
            status: asset.profileStatus,
            assetIds: dedupe([...connection.assetIds, asset.id]),
            lastProbeAt: now,
            updatedAt: now,
          }
        : connection,
    );
    return;
  }
  const connection: IOntologyConnectionProfile = {
    id: randomUUID(),
    name,
    kind: asset.kind,
    status: asset.profileStatus,
    assetIds: [asset.id],
    lastProbeAt: now,
    metadata: {
      sourceName: asset.sourceName ?? null,
    },
    createdAt: now,
    updatedAt: now,
  };
  snapshot.connections.push(connection);
}

function upsertConnectionProfileForConnector(
  connections: IOntologyConnectionProfile[],
  connector: IOntologyConnectorConfig,
  assets: IOntologyEnvironmentAsset[],
  now: number,
): IOntologyConnectionProfile[] {
  const existing = connections.find(
    (connection) => connection.connectorId === connector.id,
  );
  const profile: IOntologyConnectionProfile = {
    id: existing?.id ?? randomUUID(),
    name: connector.name,
    kind: connector.kind,
    status: connector.probeStatus === "reachable" ? "ready" : "failed",
    assetIds: assets.map((asset) => asset.id),
    connectorId: connector.id,
    lastProbeAt: now,
    metadata: {
      sourceType: connector.sourceType,
      path: connector.path ?? null,
      url: connector.url ?? null,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return existing
    ? connections.map((connection) =>
        connection.id === existing.id ? profile : connection,
      )
    : [...connections, profile];
}

function addMonitorEvent(
  snapshot: IOntologyWorkbenchSnapshot,
  source: OntologyCapabilityId,
  message: string,
  now: number,
  level: IOntologyMonitorEvent["level"] = "info",
): void {
  const event: IOntologyMonitorEvent = {
    id: randomUUID(),
    level,
    source,
    message,
    createdAt: now,
  };
  snapshot.monitorEvents = [event, ...snapshot.monitorEvents].slice(0, 50);
}

function createAttributeFromField(
  assetId: string,
  field: IOntologyAssetField,
): IOntologyAttributeDraft {
  return {
    id: randomUUID(),
    code: toCode(field.name),
    name: toTitle(field.name),
    dataType: normalizeDataType(field.dataType),
    required: field.nullable === false,
    description: field.description,
    mappedField: {
      assetId,
      fieldName: field.name,
    },
  };
}

function createAttribute(
  code: string,
  name: string,
  dataType: string,
  required: boolean,
): IOntologyAttributeDraft {
  return {
    id: randomUUID(),
    code,
    name,
    dataType,
    required,
  };
}

function createFallbackFields(
  asset: IOntologyEnvironmentAsset,
): IOntologyAssetField[] {
  return [
    {
      name: "id",
      dataType: "string",
      nullable: false,
      description: `Identifier inferred from ${asset.name}.`,
    },
    {
      name: "name",
      dataType: "string",
      nullable: false,
      description: `Name inferred from ${asset.name}.`,
    },
    {
      name: "description",
      dataType: "text",
      nullable: true,
      description: `Description inferred from ${asset.name}.`,
    },
  ];
}

function checkConsistency(
  snapshot: IOntologyWorkbenchSnapshot,
): IOntologyConsistencyCheckResult {
  const issues: IOntologyConsistencyCheckResult["issues"] = [];
  const objectIds = new Set(snapshot.objects.map((object) => object.id));
  const objectCodeCounts = countBy(
    snapshot.objects.map((object) => object.code),
  );
  const relationCodeCounts = countBy(
    snapshot.relations.map((relation) => relation.code),
  );

  if (snapshot.objects.length === 0) {
    issues.push({
      id: randomUUID(),
      severity: "error",
      message: "At least one ontology object is required before publishing.",
      targetType: "version",
    });
  }
  for (const object of snapshot.objects) {
    if ((objectCodeCounts.get(object.code) ?? 0) > 1) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Object code "${object.code}" is duplicated.`,
        targetType: "object",
        targetId: object.id,
      });
    }
    if (object.attributes.length === 0) {
      issues.push({
        id: randomUUID(),
        severity: "warning",
        message: `Object "${object.name}" has no attributes.`,
        targetType: "object",
        targetId: object.id,
      });
    }
  }
  for (const relation of snapshot.relations) {
    if ((relationCodeCounts.get(relation.code) ?? 0) > 1) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Relation code "${relation.code}" is duplicated.`,
        targetType: "relation",
        targetId: relation.id,
      });
    }
    const hasEndpoints =
      snapshot.objects.some((object) => object.id === relation.fromObjectId) &&
      snapshot.objects.some((object) => object.id === relation.toObjectId);
    if (!hasEndpoints) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Relation "${relation.name}" has invalid endpoints.`,
        targetType: "relation",
        targetId: relation.id,
      });
      continue;
    }
    const definitionIssue = relationDefinitionIssue(relation, snapshot);
    if (definitionIssue) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Relation "${relation.name}" is invalid: ${definitionIssue}`,
        targetType: "relation",
        targetId: relation.id,
      });
      continue;
    }
    if (
      !relation.dataBinding ||
      relation.dataBinding.mode === "semantic_only"
    ) {
      issues.push({
        id: randomUUID(),
        severity: "warning",
        message: `Relation "${relation.name}" is semantic-only and cannot query related records.`,
        targetType: "relation",
        targetId: relation.id,
      });
      continue;
    }
    const hasUnmappedJoinAttribute = relation.dataBinding.joinKeys.some(
      (key) =>
        runtimeAttributeAssetIds(
          snapshot,
          relation.fromObjectId,
          key.fromAttributeId,
        ).length === 0 ||
        runtimeAttributeAssetIds(
          snapshot,
          relation.toObjectId,
          key.toAttributeId,
        ).length === 0,
    );
    if (hasUnmappedJoinAttribute) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Relation "${relation.name}" has join attributes without field mappings.`,
        targetType: "relation",
        targetId: relation.id,
      });
    }
  }
  for (const mapping of snapshot.mappings) {
    const object = snapshot.objects.find(
      (item) => item.id === mapping.objectId,
    );
    const attribute = object?.attributes.find(
      (item) => item.id === mapping.attributeId,
    );
    const asset = snapshot.assets.find((item) => item.id === mapping.assetId);
    if (!object || !attribute || !asset) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message:
          "A field mapping points to a missing object, attribute, or asset.",
        targetType: "object",
        targetId: mapping.objectId,
      });
      continue;
    }
    if (!asset.fields.some((field) => field.name === mapping.fieldName)) {
      issues.push({
        id: randomUUID(),
        severity: "warning",
        message: `Mapping field "${mapping.fieldName}" is not present in asset "${asset.name}".`,
        targetType: "object",
        targetId: mapping.objectId,
      });
    }
  }
  for (const rule of snapshot.qualityRules) {
    const object = snapshot.objects.find((item) => item.id === rule.objectId);
    if (!object) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Quality rule "${rule.name}" is bound to a missing object.`,
        targetType: "object",
        targetId: rule.objectId,
      });
      continue;
    }
    const expressionValidation = validateQualityRuleExpression(
      rule.expression,
      object.attributes.map((attribute) => attribute.code),
    );
    if (!expressionValidation.isValid) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Quality rule "${rule.name}" has an invalid expression: ${expressionValidation.errorMessage}`,
        targetType: "object",
        targetId: rule.objectId,
      });
    }
  }
  for (const logicFunction of snapshot.logicFunctions) {
    const missingObjectIds = logicFunction.objectIds.filter(
      (id) => !objectIds.has(id),
    );
    if (missingObjectIds.length > 0) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Logic function "${logicFunction.name}" references missing ontology objects.`,
        targetType: "object",
        targetId: missingObjectIds[0],
      });
    }
    const configurationIssue = runtimeFunctionConfigurationIssue(
      logicFunction,
      snapshot,
    );
    if (logicFunction.status === "active" && configurationIssue) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Logic function "${logicFunction.name}" is not executable: ${configurationIssue}`,
        targetType: "logic",
        targetId: logicFunction.id,
      });
    }
  }
  for (const action of snapshot.actions) {
    const missingObjectIds = action.objectIds.filter(
      (id) => !objectIds.has(id),
    );
    if (missingObjectIds.length > 0) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Action "${action.name}" references missing ontology objects.`,
        targetType: "object",
        targetId: missingObjectIds[0],
      });
    }
    const configurationIssue = runtimeActionConfigurationIssue(
      action,
      snapshot,
    );
    if (action.status === "active" && configurationIssue) {
      issues.push({
        id: randomUUID(),
        severity: "error",
        message: `Action "${action.name}" is not executable: ${configurationIssue}`,
        targetType: "action",
        targetId: action.id,
      });
    }
  }
  if (
    snapshot.objects.length > 0 &&
    snapshot.serviceEndpoints.every((endpoint) => endpoint.toolCount === 0)
  ) {
    issues.push({
      id: randomUUID(),
      severity: "warning",
      message: "No service endpoint exposes ontology tools yet.",
      targetType: "agent",
    });
  }
  return {
    isValid: !issues.some((issue) => issue.severity === "error"),
    checkedAt: Date.now(),
    issues,
  };
}

function runtimeFunctionConfigurationIssue(
  logicFunction: IOntologyLogicFunction,
  snapshot: IOntologyWorkbenchSnapshot,
): string | null {
  const parameterIssue = runtimeParameterIssue(logicFunction.parameters);
  if (parameterIssue) return parameterIssue;
  if (logicFunction.configuration.builtIn === "lookup") return null;
  if (!logicFunction.body.trim()) return "implementation body is required";
  if (
    logicFunction.runtime === "sql" &&
    !/^\s*SELECT\b/i.test(logicFunction.body)
  ) {
    return "SQL logic functions must use a SELECT statement";
  }
  if (
    logicFunction.runtime === "sql" &&
    !runtimeConnectorForArtifact(
      snapshot,
      logicFunction.objectIds,
      logicFunction.configuration.connectorId,
    )
  ) {
    return "a database connector could not be resolved";
  }
  return null;
}

function runtimeActionConfigurationIssue(
  action: IOntologyActionDefinition,
  snapshot: IOntologyWorkbenchSnapshot,
): string | null {
  const parameterIssue = runtimeParameterIssue(action.parameters);
  if (parameterIssue) return parameterIssue;
  const config = action.configuration;
  if (action.executor === "function") {
    if (config.builtIn === "update_attribute") {
      const object = snapshot.objects.find(
        (item) => item.id === action.objectIds[0],
      );
      if (!object) return "an object binding is required";
      const identityAttribute =
        object.attributes.find((attribute) => attribute.code === "id") ??
        object.attributes.find((attribute) => attribute.required);
      if (!identityAttribute)
        return "an id or required identity attribute is required";
      const identityAssetIds = new Set(
        runtimeAttributeAssetIds(snapshot, object.id, identityAttribute.id),
      );
      const hasWritableAsset = object.attributes.some(
        (attribute) =>
          attribute.id !== identityAttribute.id &&
          runtimeAttributeAssetIds(snapshot, object.id, attribute.id).some(
            (assetId) => {
              if (!identityAssetIds.has(assetId)) return false;
              const asset = snapshot.assets.find((item) => item.id === assetId);
              const connectorId =
                typeof asset?.metadata.connectorId === "string"
                  ? asset.metadata.connectorId
                  : undefined;
              return snapshot.connectors.some(
                (connector) =>
                  connector.id === connectorId && connector.writable === true,
              );
            },
          ),
      );
      if (!hasWritableAsset)
        return "identity and target attributes must share a writable database asset";
      return null;
    }
    const functionCode =
      typeof config.functionCode === "string" ? config.functionCode.trim() : "";
    if (!functionCode) return "configuration.functionCode is required";
    if (
      !snapshot.logicFunctions.some(
        (item) => item.code === functionCode && item.status === "active",
      )
    )
      return `active logic function "${functionCode}" does not exist`;
    return null;
  }
  if (action.executor === "api") {
    if (typeof config.url !== "string" || !config.url.trim())
      return "configuration.url is required";
    if (!config.url.includes("{{")) {
      try {
        const url = new URL(config.url);
        if (url.protocol !== "http:" && url.protocol !== "https:")
          return "configuration.url must use HTTP or HTTPS";
      } catch {
        return "configuration.url is invalid";
      }
    }
    return null;
  }
  if (action.executor === "sql") {
    if (typeof config.statement !== "string" || !config.statement.trim())
      return "configuration.statement is required";
    const connector = runtimeConnectorForArtifact(
      snapshot,
      action.objectIds,
      config.connectorId,
    );
    if (!connector) return "a database connector could not be resolved";
    const command = /^\s*([A-Za-z]+)/
      .exec(config.statement)?.[1]
      ?.toUpperCase();
    if (!["SELECT", "INSERT", "UPDATE", "DELETE"].includes(command ?? ""))
      return "only SELECT, INSERT, UPDATE, and DELETE are supported";
    if (command !== "SELECT" && connector.writable !== true)
      return "SQL writes require a connector marked writable";
    return null;
  }
  if (action.executor === "notification") {
    if (typeof config.message !== "string" || !config.message.trim())
      return "configuration.message is required";
    return null;
  }
  if (typeof config.command !== "string" || !path.isAbsolute(config.command))
    return "configuration.command must be an absolute path";
  return null;
}

function runtimeAttributeAssetIds(
  snapshot: IOntologyWorkbenchSnapshot,
  objectId: string,
  attributeId: string,
): string[] {
  const object = snapshot.objects.find((item) => item.id === objectId);
  const mappedField = object?.attributes.find(
    (attribute) => attribute.id === attributeId,
  )?.mappedField;
  return [
    ...(mappedField ? [mappedField.assetId] : []),
    ...snapshot.mappings
      .filter(
        (mapping) =>
          mapping.objectId === objectId &&
          mapping.attributeId === attributeId &&
          mapping.status !== "rejected",
      )
      .map((mapping) => mapping.assetId),
  ];
}

function runtimeConnectorForArtifact(
  snapshot: IOntologyWorkbenchSnapshot,
  objectIds: string[],
  configuredConnectorId: OntologyJsonValue | undefined,
): IOntologyConnectorConfig | undefined {
  if (typeof configuredConnectorId === "string")
    return snapshot.connectors.find(
      (connector) => connector.id === configuredConnectorId,
    );
  const assetId = snapshot.mappings.find(
    (mapping) =>
      objectIds.includes(mapping.objectId) && mapping.status !== "rejected",
  )?.assetId;
  const asset = snapshot.assets.find((item) => item.id === assetId);
  const connectorId =
    typeof asset?.metadata.connectorId === "string"
      ? asset.metadata.connectorId
      : undefined;
  return snapshot.connectors.find((connector) => connector.id === connectorId);
}

function runtimeParameterIssue(
  parameters: IOntologyLogicFunction["parameters"],
): string | null {
  const names = parameters.map((parameter) => parameter.name.trim());
  if (names.some((name) => !name)) return "parameter names are required";
  if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
    return "parameter names must use letters, digits, and underscores";
  if (new Set(names).size !== names.length)
    return "parameter names must be unique";
  return null;
}

function stripExtension(name: string): string {
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

function toCode(value: string): string {
  return (
    value
      .trim()
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "object"
  );
}

function toWorkspaceId(value: string): string {
  const code = toCode(value);
  return code === "object" ? "ontology" : code;
}

function toTitle(value: string): string {
  const words = value
    .trim()
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "Object";
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeDataType(value: string): string {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("int") ||
    normalized.includes("number") ||
    normalized.includes("decimal") ||
    normalized.includes("float") ||
    normalized.includes("double")
  )
    return "number";
  if (normalized.includes("date") || normalized.includes("time"))
    return "datetime";
  if (normalized.includes("bool")) return "boolean";
  if (normalized.includes("text") || normalized.includes("json"))
    return normalized;
  return "string";
}

function createReviewItems(
  snapshot: IOntologyWorkbenchSnapshot,
  now: number,
): IOntologyReviewItem[] {
  return [
    ...snapshot.objects.map((item) => ({
      id: randomUUID(),
      targetType: "object" as const,
      targetId: item.id,
      decision: "approved" as const,
      comment: "Approved from ontology workbench.",
      reviewerId: "local-user",
      createdAt: now,
    })),
    ...snapshot.relations.map((item) => ({
      id: randomUUID(),
      targetType: "relation" as const,
      targetId: item.id,
      decision: "approved" as const,
      comment: "Approved from ontology workbench.",
      reviewerId: "local-user",
      createdAt: now,
    })),
  ];
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function createFileStat(
  filePath: string,
  sizeBytes: number,
): IOntologyFileStat {
  return {
    path: filePath,
    name: path.basename(filePath),
    sizeBytes,
    extension: path.extname(filePath),
  };
}
