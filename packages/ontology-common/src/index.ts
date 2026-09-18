export const ONTOLOGY_SNAPSHOT_SCHEMA_VERSION = 2;

export const ONTOLOGY_WORKFLOW_PHASES = [
  "scan",
  "generate",
  "review",
  "publish",
  "agent",
] as const;

export const ONTOLOGY_CAPABILITY_IDS = [
  "data_integration",
  "asset_catalog",
  "ontology_modeling",
  "ai_builder",
  "doc_builder",
  "review_collaboration",
  "hydration_mapping",
  "publish_governance",
  "logic_modeling",
  "agent_builder",
  "service_registry",
  "monitoring",
] as const;

export type OntologyWorkflowPhase = (typeof ONTOLOGY_WORKFLOW_PHASES)[number];
export type OntologyPhaseStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "blocked";
export type OntologyCapabilityId = (typeof ONTOLOGY_CAPABILITY_IDS)[number];
export type OntologyCapabilityStatus =
  | "planned"
  | "building"
  | "available"
  | "blocked";
export type OntologyAssetKind =
  | "database"
  | "schema"
  | "table"
  | "document"
  | "directory"
  | "api"
  | "mq"
  | "oss";
export type OntologyProfileStatus =
  | "not_profiled"
  | "profiling"
  | "ready"
  | "failed";
export type OntologyTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type OntologyReviewDecision =
  | "pending"
  | "approved"
  | "changes_requested"
  | "rejected";
export type OntologyVersionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "published"
  | "rejected"
  | "rolled_back";
export type OntologyAgentBlueprintStatus = "draft" | "registered" | "published";
export type OntologyArtifactStatus = "draft" | "active" | "disabled";
export type OntologyRiskLevel = "low" | "medium" | "high";
export type OntologyConnectionSourceType =
  | "local_files"
  | "directory"
  | "sqlite"
  | "mysql"
  | "postgresql"
  | "oracle"
  | "sqlserver"
  | "openapi"
  | "rest"
  | "ftp"
  | "sftp"
  | "mq"
  | "kafka"
  | "oss"
  | "s3";
export type OntologyConnectorProbeStatus =
  | "not_tested"
  | "reachable"
  | "failed";
export type OntologyConnectorConfigValue = string | number | boolean | null;
export type OntologyJsonValue =
  | string
  | number
  | boolean
  | null
  | OntologyJsonValue[]
  | { [key: string]: OntologyJsonValue };

export interface IOntologyCapability {
  id: OntologyCapabilityId;
  status: OntologyCapabilityStatus;
  sourceModules: string[];
  targetPackage: string;
  notes?: string;
}

export interface IOntologyPhaseState {
  phase: OntologyWorkflowPhase;
  status: OntologyPhaseStatus;
  summary: string;
  startedAt?: number;
  completedAt?: number;
  blockingReason?: string;
}

export interface IOntologyAssetField {
  name: string;
  dataType: string;
  nullable?: boolean;
  description?: string;
  sampleValues?: string[];
}

export interface IOntologyEnvironmentAsset {
  id: string;
  kind: OntologyAssetKind;
  name: string;
  sourceName?: string;
  path?: string;
  profileStatus: OntologyProfileStatus;
  fields: IOntologyAssetField[];
  metadata: Record<string, string | number | boolean | null>;
  createdAt: number;
  updatedAt: number;
}

export interface IOntologyConnectorConfig {
  id: string;
  name: string;
  sourceType: OntologyConnectionSourceType;
  kind: OntologyAssetKind;
  host?: string;
  port?: number;
  database?: string;
  path?: string;
  url?: string;
  username?: string;
  password?: string;
  credentialRef?: string;
  credential?: Record<string, OntologyConnectorConfigValue>;
  params?: Record<string, OntologyConnectorConfigValue>;
  headers?: Record<string, string>;
  writable?: boolean;
  poolSize?: number;
  rateLimitQps?: number;
  description?: string;
  metadata: Record<string, OntologyConnectorConfigValue>;
  probeStatus: OntologyConnectorProbeStatus;
  lastProbeAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IOntologyObjectDraft {
  id: string;
  code: string;
  name: string;
  description: string;
  tier: 1 | 2 | 3;
  status: "active" | "warning" | "error";
  namespace?: string;
  sourceAssetIds: string[];
  attributes: IOntologyAttributeDraft[];
  reviewDecision: OntologyReviewDecision;
  updatedAt: number;
}

export interface IOntologyAttributeDraft {
  id: string;
  code: string;
  name: string;
  dataType: string;
  required: boolean;
  description?: string;
  example?: string;
  constraints?: IOntologyAttributeConstraints;
  mappedField?: {
    assetId: string;
    fieldName: string;
  };
}

export interface IOntologyAttributeConstraints {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  enumValues?: string[];
  refTarget?: string;
}

export interface IOntologyRelationDraft {
  id: string;
  code: string;
  name: string;
  fromObjectId: string;
  toObjectId: string;
  cardinality: "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
  relationType:
    | "object_property"
    | "symmetric_property"
    | "transitive_property"
    | "functional_property";
  semanticType:
    | "composition"
    | "event"
    | "inheritance"
    | "dependency"
    | "association";
  isAcyclic: boolean;
  description?: string;
  reviewDecision: OntologyReviewDecision;
  updatedAt: number;
}

export interface IOntologyReviewItem {
  id: string;
  targetType: "object" | "relation" | "version" | "agent";
  targetId: string;
  decision: OntologyReviewDecision;
  comment: string;
  reviewerId: string;
  createdAt: number;
}

export interface IOntologyPublishedVersion {
  id: string;
  version: string;
  status: OntologyVersionStatus;
  isActive: boolean;
  objectCount: number;
  relationCount: number;
  submittedAt?: number;
  publishedAt?: number;
  approvedAt?: number;
  approvedBy?: string;
  summary: string;
  diff: IOntologyVersionDiff;
  snapshot: IOntologyVersionSnapshot;
  createdAt: number;
}

export interface IOntologyVersionSnapshot {
  objects: IOntologyObjectDraft[];
  relations: IOntologyRelationDraft[];
  mappings: IOntologyFieldMapping[];
  qualityRules: IOntologyQualityRule[];
  logicFunctions: IOntologyLogicFunction[];
  actions: IOntologyActionDefinition[];
  serviceEndpoints: IOntologyServiceEndpoint[];
  businessDocuments: IOntologyBusinessDocument[];
}

export interface IOntologyVersionDiff {
  fromVersionId?: string;
  addedObjectIds: string[];
  changedObjectIds: string[];
  removedObjectIds: string[];
  addedRelationIds: string[];
  changedRelationIds: string[];
  removedRelationIds: string[];
  riskLevel: OntologyRiskLevel;
  summary: string;
}

export interface IOntologyAgentBlueprint {
  id: string;
  name: string;
  status: OntologyAgentBlueprintStatus;
  ontologyVersionId: string;
  registeredAssistantId?: string;
  registeredAt?: number;
  entityIds: string[];
  promptTemplate: string;
  toolManifest: Array<{
    name: string;
    description: string;
    category: "ontology" | "logic" | "action" | "mcp";
  }>;
  createdAt: number;
  updatedAt: number;
}

export interface IOntologyConnectionProfile {
  id: string;
  name: string;
  kind: OntologyAssetKind;
  status: OntologyProfileStatus;
  assetIds: string[];
  connectorId?: string;
  lastProbeAt?: number;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: number;
  updatedAt: number;
}

export interface IOntologyFieldMapping {
  id: string;
  objectId: string;
  attributeId: string;
  assetId: string;
  fieldName: string;
  confidence: number;
  strategy: "exact" | "normalized" | "ai_suggested" | "manual";
  status: OntologyReviewDecision;
  updatedAt: number;
}

export interface IOntologyQualityRule {
  id: string;
  objectId: string;
  code: string;
  name: string;
  expression: string;
  severity: "info" | "warning" | "error";
  status: OntologyArtifactStatus;
  updatedAt: number;
}

export interface IOntologyBusinessDocument {
  id: string;
  title: string;
  format: "markdown" | "json" | "pdf";
  objectIds: string[];
  content: string;
  updatedAt: number;
}

export interface IOntologyLogicFunction {
  id: string;
  code: string;
  name: string;
  description: string;
  runtime: "typescript" | "python" | "sql";
  objectIds: string[];
  signature: string;
  body: string;
  returnType: string;
  parameters: IOntologyFunctionParameter[];
  origin: "generated" | "manual";
  status: OntologyArtifactStatus;
  executionCount: number;
  lastExecutedAt?: number;
  updatedAt: number;
}

export interface IOntologyFunctionParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  objectId?: string;
  attributeId?: string;
}

export interface IOntologyActionDefinition {
  id: string;
  code: string;
  name: string;
  executor: "function" | "api" | "sql" | "notification" | "custom_script";
  objectIds: string[];
  description: string;
  configuration: Record<string, OntologyJsonValue>;
  parameters: IOntologyFunctionParameter[];
  outputSchema: Array<{ name: string; type: string; description?: string }>;
  origin: "generated" | "manual";
  status: OntologyArtifactStatus;
  executionCount: number;
  lastExecutedAt?: number;
  updatedAt: number;
}

export interface IOntologyServiceEndpoint {
  id: string;
  name: string;
  protocol: "mcp" | "osdk" | "api";
  status: OntologyArtifactStatus;
  toolCount: number;
  updatedAt: number;
}

export interface IOntologyImpactAnalysis {
  id: string;
  summary: string;
  affectedObjectIds: string[];
  affectedRelationIds: string[];
  riskLevel: OntologyRiskLevel;
  createdAt: number;
}

export interface IOntologyMonitorEvent {
  id: string;
  level: "info" | "warning" | "error";
  source: OntologyCapabilityId;
  message: string;
  createdAt: number;
}

export interface IOntologyTask {
  id: string;
  type: "scan" | "generate" | "hydrate" | "publish" | "agent_build";
  status: OntologyTaskStatus;
  progress: number;
  currentStep: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IOntologyWorkbenchDraft {
  title: string;
  description: string;
  businessGoal: string;
  selectedAssetIds: string[];
}

export interface IOntologyWorkbenchStats {
  connectorCount: number;
  assetCount: number;
  objectCount: number;
  relationCount: number;
  pendingReviewCount: number;
  publishedVersionCount: number;
  agentBlueprintCount: number;
  mappingCount: number;
  qualityRuleCount: number;
  logicFunctionCount: number;
  actionCount: number;
  serviceEndpointCount: number;
  monitorEventCount: number;
}

export interface IOntologyWorkbenchSnapshot {
  schemaVersion: typeof ONTOLOGY_SNAPSHOT_SCHEMA_VERSION;
  workspaceId: string;
  activePhase: OntologyWorkflowPhase;
  draft: IOntologyWorkbenchDraft;
  phases: IOntologyPhaseState[];
  capabilities: IOntologyCapability[];
  stats: IOntologyWorkbenchStats;
  connectors: IOntologyConnectorConfig[];
  assets: IOntologyEnvironmentAsset[];
  objects: IOntologyObjectDraft[];
  relations: IOntologyRelationDraft[];
  connections: IOntologyConnectionProfile[];
  mappings: IOntologyFieldMapping[];
  qualityRules: IOntologyQualityRule[];
  businessDocuments: IOntologyBusinessDocument[];
  logicFunctions: IOntologyLogicFunction[];
  actions: IOntologyActionDefinition[];
  serviceEndpoints: IOntologyServiceEndpoint[];
  impactAnalyses: IOntologyImpactAnalysis[];
  monitorEvents: IOntologyMonitorEvent[];
  reviewItems: IOntologyReviewItem[];
  publishedVersions: IOntologyPublishedVersion[];
  agentBlueprints: IOntologyAgentBlueprint[];
  tasks: IOntologyTask[];
  updatedAt: number;
}

export interface IOntologyWorkbenchSummary {
  workspaceId: string;
  code: string;
  name: string;
  description: string;
  objectCount: number;
  relationCount: number;
  logicCount: number;
  actionCount: number;
  publishedVersionCount: number;
  agentBlueprintCount: number;
  createdAt: number;
  updatedAt: number;
  status: OntologyArtifactStatus;
}

export interface IOntologyWorkbenchListResult {
  activeWorkspaceId: string;
  items: IOntologyWorkbenchSummary[];
}

export interface IOntologyWorkbenchMutationResult {
  snapshot: IOntologyWorkbenchSnapshot;
  summaries: IOntologyWorkbenchSummary[];
  activeWorkspaceId: string;
}

export interface IOntologyCreateWorkbenchInput {
  name: string;
  code?: string;
  description?: string;
  businessGoal?: string;
}

export interface IOntologySelectWorkbenchInput {
  workspaceId: string;
}

export interface IOntologyDeleteWorkbenchInput {
  workspaceId: string;
}

export interface IOntologyWorkbenchSnapshotOptions {
  workspaceId?: string;
  title?: string;
  description?: string;
  businessGoal?: string;
}

export interface IOntologyWorkbenchDraftInput {
  title?: string;
  description?: string;
  businessGoal?: string;
  selectedAssetIds?: string[];
}

export interface IOntologyPhaseTransitionInput {
  phase: OntologyWorkflowPhase;
  status: OntologyPhaseStatus;
  summary?: string;
  blockingReason?: string;
}

export interface IOntologyImportFilesInput {
  filePaths: string[];
  purpose?: "asset" | "template" | "document";
}

export interface IOntologyConnectorInput {
  id?: string;
  name: string;
  sourceType: OntologyConnectionSourceType;
  kind: OntologyAssetKind;
  host?: string;
  port?: number;
  database?: string;
  path?: string;
  url?: string;
  username?: string;
  password?: string;
  credentialRef?: string;
  credential?: Record<string, OntologyConnectorConfigValue>;
  params?: Record<string, OntologyConnectorConfigValue>;
  headers?: Record<string, string>;
  writable?: boolean;
  poolSize?: number;
  rateLimitQps?: number;
  description?: string;
  metadata?: Record<string, OntologyConnectorConfigValue>;
}

export interface IOntologyProbeConnectorInput {
  connector: IOntologyConnectorInput;
  recursive?: boolean;
  maxAssets?: number;
}

export interface IOntologyProbeConnectorResult {
  snapshot: IOntologyWorkbenchSnapshot;
  connector: IOntologyConnectorConfig;
  assets: IOntologyEnvironmentAsset[];
}

export interface IOntologyDeleteConnectorInput {
  id: string;
  cascadeAssets?: boolean;
}

export interface IOntologyBrowseConnectorAssetsInput {
  connectorId: string;
}

export interface IOntologyBrowseConnectorAssetsResult {
  connector: IOntologyConnectorConfig;
  assets: IOntologyEnvironmentAsset[];
}

export interface IOntologyProfileAssetInput {
  id: string;
}

export interface IOntologySyncAssetSchemaInput {
  id: string;
}

export interface IOntologyPreviewAssetInput {
  id: string;
  limit?: number;
}

export interface IOntologyPreviewAssetResult {
  assetId: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  rowsReturned: number;
  truncated: boolean;
}

export interface IOntologyImportedFile {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  extension: string;
}

export interface IOntologyGenerateDraftInput {
  assetIds?: string[];
  businessGoal?: string;
  mode?: "replace" | "merge";
}

export interface IOntologyReviewTargetInput {
  targetType: "object" | "relation";
  targetId: string;
  decision: OntologyReviewDecision;
  comment?: string;
}

export interface IOntologyObjectDraftInput {
  id?: string;
  code?: string;
  name: string;
  description?: string;
  tier?: IOntologyObjectDraft["tier"];
  status?: IOntologyObjectDraft["status"];
  namespace?: string;
  sourceAssetIds?: string[];
}

export interface IOntologyAttributeDraftInput {
  id?: string;
  objectId: string;
  code?: string;
  name: string;
  dataType: string;
  required?: boolean;
  description?: string;
  example?: string;
  constraints?: IOntologyAttributeConstraints;
  mappedField?: {
    assetId: string;
    fieldName: string;
  };
}

export interface IOntologyRelationDraftInput {
  id?: string;
  code?: string;
  name: string;
  fromObjectId: string;
  toObjectId: string;
  cardinality: IOntologyRelationDraft["cardinality"];
  relationType?: IOntologyRelationDraft["relationType"];
  semanticType?: IOntologyRelationDraft["semanticType"];
  isAcyclic?: boolean;
  description?: string;
}

export interface IOntologyFieldMappingInput {
  id?: string;
  objectId: string;
  attributeId: string;
  assetId: string;
  fieldName: string;
  confidence?: number;
  strategy?: IOntologyFieldMapping["strategy"];
  status?: OntologyReviewDecision;
}

export interface IOntologyQualityRuleInput {
  id?: string;
  objectId: string;
  code?: string;
  name: string;
  expression: string;
  severity: IOntologyQualityRule["severity"];
  status?: OntologyArtifactStatus;
}

export interface IOntologyLogicFunctionInput {
  id?: string;
  code?: string;
  name: string;
  description?: string;
  runtime: IOntologyLogicFunction["runtime"];
  objectIds?: string[];
  signature?: string;
  body?: string;
  returnType?: string;
  parameters?: IOntologyFunctionParameter[];
  status?: OntologyArtifactStatus;
}

export interface IOntologyActionDefinitionInput {
  id?: string;
  code?: string;
  name: string;
  executor: IOntologyActionDefinition["executor"];
  objectIds?: string[];
  description?: string;
  configuration?: Record<string, OntologyJsonValue>;
  parameters?: IOntologyFunctionParameter[];
  outputSchema?: IOntologyActionDefinition["outputSchema"];
  status?: OntologyArtifactStatus;
}

export interface IOntologyDeleteInput {
  id: string;
  workspaceId?: string;
}

export interface IOntologyDeleteAttributeInput {
  objectId: string;
  attributeId: string;
}

export interface IOntologyPublishApprovalInput {
  versionId: string;
  workspaceId?: string;
  reviewerId?: string;
  comment?: string;
}

export interface IOntologyRejectVersionInput {
  versionId: string;
  workspaceId?: string;
  reviewerId?: string;
  reason: string;
}

export interface IOntologyRollbackInput {
  versionId: string;
  workspaceId?: string;
}

export interface IOntologyConsistencyIssue {
  id: string;
  severity: "error" | "warning";
  message: string;
  targetType?: "object" | "relation" | "version" | "agent";
  targetId?: string;
}

export interface IOntologyConsistencyCheckResult {
  isValid: boolean;
  checkedAt: number;
  issues: IOntologyConsistencyIssue[];
}

export interface IOntologyAgentBlueprintInput {
  name: string;
  ontologyVersionId: string;
  workspaceId?: string;
  promptTemplate?: string;
}

export interface IOntologyRegisterAgentInput {
  blueprintId?: string;
  assistantId?: string;
  name?: string;
  workspaceId?: string;
}

export function createDefaultOntologyWorkbenchSnapshot(
  now = Date.now(),
  options: IOntologyWorkbenchSnapshotOptions = {},
): IOntologyWorkbenchSnapshot {
  const phases: IOntologyPhaseState[] = [
    {
      phase: "scan",
      status: "in_progress",
      summary: "Scan data sources, documents, APIs, and message assets.",
      startedAt: now,
    },
    {
      phase: "generate",
      status: "not_started",
      summary: "Generate ontology objects, attributes, and relations.",
    },
    {
      phase: "review",
      status: "not_started",
      summary: "Discuss, edit, and approve ontology changes.",
    },
    {
      phase: "publish",
      status: "not_started",
      summary:
        "Validate mappings, publish immutable versions, and support rollback.",
    },
    {
      phase: "agent",
      status: "not_started",
      summary: "Build Agent blueprints from published ontology versions.",
    },
  ];

  return {
    schemaVersion: ONTOLOGY_SNAPSHOT_SCHEMA_VERSION,
    workspaceId: options.workspaceId?.trim() || "default",
    activePhase: "scan",
    draft: {
      title: options.title?.trim() || "Ontology Workbench",
      description: options.description?.trim() || "",
      businessGoal: options.businessGoal?.trim() || "",
      selectedAssetIds: [],
    },
    phases,
    capabilities: createOntologyCapabilityMatrix(),
    stats: createEmptyOntologyStats(),
    connectors: [],
    assets: [],
    objects: [],
    relations: [],
    reviewItems: [],
    publishedVersions: [],
    agentBlueprints: [],
    connections: [],
    mappings: [],
    qualityRules: [],
    businessDocuments: [],
    logicFunctions: [],
    actions: [],
    serviceEndpoints: [],
    impactAnalyses: [],
    monitorEvents: [],
    tasks: [],
    updatedAt: now,
  };
}

export function summarizeOntologyWorkbenchSnapshot(
  snapshot: IOntologyWorkbenchSnapshot,
): IOntologyWorkbenchSummary {
  const timestamps = [
    snapshot.updatedAt,
    ...snapshot.connectors.map((item) => item.createdAt),
    ...snapshot.assets.map((item) => item.createdAt),
    ...snapshot.objects.map((item) => item.updatedAt),
    ...snapshot.relations.map((item) => item.updatedAt),
    ...snapshot.publishedVersions.map((item) => item.createdAt),
    ...snapshot.agentBlueprints.map((item) => item.createdAt),
  ].filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );

  return {
    workspaceId: snapshot.workspaceId,
    code: snapshot.workspaceId,
    name: snapshot.draft.title || snapshot.workspaceId,
    description: snapshot.draft.description || snapshot.draft.businessGoal,
    objectCount: snapshot.objects.length,
    relationCount: snapshot.relations.length,
    logicCount: snapshot.logicFunctions.length,
    actionCount: snapshot.actions.length,
    publishedVersionCount: snapshot.publishedVersions.filter(
      (item) => item.status === "published",
    ).length,
    agentBlueprintCount: snapshot.agentBlueprints.length,
    createdAt: Math.min(...timestamps),
    updatedAt: snapshot.updatedAt,
    status: "active",
  };
}

export function createEmptyOntologyStats(): IOntologyWorkbenchStats {
  return {
    connectorCount: 0,
    assetCount: 0,
    objectCount: 0,
    relationCount: 0,
    pendingReviewCount: 0,
    publishedVersionCount: 0,
    agentBlueprintCount: 0,
    mappingCount: 0,
    qualityRuleCount: 0,
    logicFunctionCount: 0,
    actionCount: 0,
    serviceEndpointCount: 0,
    monitorEventCount: 0,
  };
}

export function recalculateOntologyStats(
  snapshot: IOntologyWorkbenchSnapshot,
): IOntologyWorkbenchStats {
  return {
    connectorCount: snapshot.connectors.length,
    assetCount: snapshot.assets.length,
    objectCount: snapshot.objects.length,
    relationCount: snapshot.relations.length,
    pendingReviewCount:
      snapshot.objects.filter((item) => item.reviewDecision === "pending")
        .length +
      snapshot.relations.filter((item) => item.reviewDecision === "pending")
        .length,
    publishedVersionCount: snapshot.publishedVersions.filter(
      (item) => item.status === "published",
    ).length,
    agentBlueprintCount: snapshot.agentBlueprints.length,
    mappingCount: snapshot.mappings.length,
    qualityRuleCount: snapshot.qualityRules.length,
    logicFunctionCount: snapshot.logicFunctions.length,
    actionCount: snapshot.actions.length,
    serviceEndpointCount: snapshot.serviceEndpoints.length,
    monitorEventCount: snapshot.monitorEvents.length,
  };
}

export function createOntologyCapabilityMatrix(): IOntologyCapability[] {
  return [
    {
      id: "data_integration",
      status: "available",
      sourceModules: ["connections.py", "assets.py"],
      targetPackage: "@sudowork/ontology-engine/connectors",
    },
    {
      id: "asset_catalog",
      status: "available",
      sourceModules: ["asset_catalog.py", "AssetsPage.vue"],
      targetPackage: "@sudowork/ontology-engine/assets",
    },
    {
      id: "ontology_modeling",
      status: "available",
      sourceModules: ["entities.py", "relations.py"],
      targetPackage: "@sudowork/ontology-engine/modeling",
    },
    {
      id: "ai_builder",
      status: "available",
      sourceModules: ["ai_builder_v2.py", "AiBuilderView.vue"],
      targetPackage: "@sudowork/ontology-engine/builders",
    },
    {
      id: "doc_builder",
      status: "available",
      sourceModules: ["doc_builder.py", "DocBuilderView.vue"],
      targetPackage: "@sudowork/ontology-engine/builders",
    },
    {
      id: "review_collaboration",
      status: "available",
      sourceModules: ["Step2Review.vue", "audit.py"],
      targetPackage: "@sudowork/ontology-engine/review",
    },
    {
      id: "hydration_mapping",
      status: "available",
      sourceModules: ["hydration_service.py", "ontology_mapping.py"],
      targetPackage: "@sudowork/ontology-engine/mapping",
    },
    {
      id: "publish_governance",
      status: "available",
      sourceModules: ["ontology_publish.py"],
      targetPackage: "@sudowork/ontology-engine/publish",
    },
    {
      id: "logic_modeling",
      status: "available",
      sourceModules: ["functions.py", "actions.py", "ai_code.py"],
      targetPackage: "@sudowork/ontology-engine/logic",
    },
    {
      id: "agent_builder",
      status: "available",
      sourceModules: ["agents.py", "agent_service.py"],
      targetPackage: "@sudowork/ontology-engine/agent",
    },
    {
      id: "service_registry",
      status: "available",
      sourceModules: ["mcp.py", "registry.py", "osdk.py"],
      targetPackage: "@sudowork/ontology-engine/service",
    },
    {
      id: "monitoring",
      status: "available",
      sourceModules: ["monitor.py", "traces.py", "evals.py"],
      targetPackage: "@sudowork/ontology-engine/monitoring",
    },
  ];
}
