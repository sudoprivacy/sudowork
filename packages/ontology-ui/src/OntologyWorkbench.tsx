import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isOntologyDocumentAsset,
  ONTOLOGY_DOCUMENT_ERROR_KEYS,
  ONTOLOGY_DOCUMENT_EXTENSIONS,
  ONTOLOGY_DOCUMENT_MAX_FILES,
  ONTOLOGY_DOCUMENT_MAX_FILE_BYTES,
  ONTOLOGY_DOCUMENT_MAX_TOTAL_BYTES,
  ONTOLOGY_DOCUMENT_MAX_TEXT_CHARS,
  ONTOLOGY_DOCUMENT_MAX_GOAL_CHARS,
} from "@sudowork/ontology-common";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ReactECharts from "echarts-for-react";
import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Menu,
  Message,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from "@arco-design/web-react";
import {
  ArrowLeft,
  Bell,
  Bot,
  Cable,
  CheckCircle2,
  ChevronDown,
  CircleX,
  ClipboardList,
  Copy,
  Database,
  FilePlus2,
  FileText,
  FolderOpen,
  GitBranch,
  Layers3,
  Link2,
  ListTree,
  Network,
  PlugZap,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Eye,
  Wrench,
} from "lucide-react";
import type {
  IOntologyActionDefinition,
  IOntologyActionDefinitionInput,
  IOntologyAgentBlueprint,
  IOntologyAgentBlueprintInput,
  IOntologyAttributeDraftInput,
  IOntologyAttributeConstraints,
  IOntologyBrowseConnectorAssetsInput,
  IOntologyBrowseConnectorAssetsResult,
  IOntologyBusinessDocument,
  IOntologyConsistencyCheckResult,
  IOntologyCreateWorkbenchInput,
  IOntologyConnectorInput,
  IOntologyConnectorConfig,
  IOntologyDeleteAttributeInput,
  IOntologyDeleteConnectorInput,
  IOntologyDeleteInput,
  IOntologyDeleteWorkbenchInput,
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
  IOntologyPreviewAssetInput,
  IOntologyPreviewAssetResult,
  IOntologyPublishApprovalInput,
  IOntologyPublishedVersion,
  IOntologyQualityRule,
  IOntologyQualityRuleInput,
  IOntologyRejectVersionInput,
  IOntologyRegisterAgentInput,
  IOntologyRelationDraft,
  IOntologyRelationDraftInput,
  IOntologyReviewTargetInput,
  IOntologyRollbackInput,
  IOntologySelectWorkbenchInput,
  IOntologyServiceEndpoint,
  IOntologySyncAssetSchemaInput,
  IOntologyWorkbenchDraftInput,
  IOntologyWorkbenchListResult,
  IOntologyWorkbenchMutationResult,
  IOntologyWorkbenchSnapshot,
  IOntologyWorkbenchSummary,
  OntologyAssetKind,
  OntologyConnectionSourceType,
  OntologyWorkflowPhase,
} from "@sudowork/ontology-common";

const { TextArea } = Input;
const { Option } = Select;

type OntologyConsoleView =
  | "connections"
  | "assets"
  | "ai_builder"
  | "ontology"
  | "publish"
  | "agent";
type AssetCategoryFilter = "all" | "structured" | "unstructured";
type ConnectorCategoryKey =
  | "database"
  | "object_storage"
  | "file_transfer"
  | "message_queue"
  | "api";
type ConnectorFormValue = string | number | boolean;
type ConnectorFormValues = Record<string, ConnectorFormValue>;
type ObjectBuildMethod = "manual" | "template" | "document" | "asset";
type RuntimeArtifactDetail =
  | { kind: "endpoint"; item: IOntologyServiceEndpoint }
  | { kind: "function"; item: IOntologyLogicFunction }
  | { kind: "action"; item: IOntologyActionDefinition }
  | { kind: "document"; item: IOntologyBusinessDocument };

const CONNECTION_FILTERS: Array<"all" | OntologyAssetKind> = [
  "all",
  "database",
  "oss",
  "directory",
  "mq",
  "api",
];
const ASSET_CATEGORY_FILTERS: AssetCategoryFilter[] = [
  "all",
  "structured",
  "unstructured",
];
const WORKBENCH_CARD_CLASS =
  "rounded-lg border border-[var(--color-border-2)] bg-[var(--color-bg-1)] shadow-sm";
const WORKBENCH_INTERACTIVE_CARD_CLASS = `${WORKBENCH_CARD_CLASS} transition-all duration-200 hover:border-[rgb(var(--primary-5))] hover:shadow-md`;

const CONSOLE_NAV_GROUPS: Array<{
  key: string;
  items: Array<{ key: OntologyConsoleView; icon: typeof Database }>;
}> = [
  {
    key: "data",
    items: [
      { key: "connections", icon: PlugZap },
      { key: "assets", icon: FolderOpen },
    ],
  },
  {
    key: "ontology",
    items: [
      { key: "ai_builder", icon: Sparkles },
      { key: "ontology", icon: ListTree },
      { key: "publish", icon: Rocket },
    ],
  },
  {
    key: "application",
    items: [{ key: "agent", icon: Bot }],
  },
];
const CONNECTOR_CATEGORY_OPTIONS: Array<{
  key: ConnectorCategoryKey;
  sourceType: OntologyConnectionSourceType;
  kind: OntologyAssetKind;
  icon: typeof Database;
  iconClassName: string;
  colorClassName: string;
}> = [
  {
    key: "database",
    sourceType: "mysql",
    kind: "database",
    icon: Database,
    iconClassName: "text-[rgb(var(--primary-6))]",
    colorClassName: "bg-[rgb(var(--primary-1))]",
  },
  {
    key: "object_storage",
    sourceType: "s3",
    kind: "oss",
    icon: Layers3,
    iconClassName: "text-[rgb(var(--purple-6))]",
    colorClassName: "bg-[rgb(var(--purple-1))]",
  },
  {
    key: "file_transfer",
    sourceType: "ftp",
    kind: "directory",
    icon: FolderOpen,
    iconClassName: "text-[rgb(var(--orange-6))]",
    colorClassName: "bg-[rgb(var(--orange-1))]",
  },
  {
    key: "message_queue",
    sourceType: "kafka",
    kind: "mq",
    icon: GitBranch,
    iconClassName: "text-[rgb(var(--green-6))]",
    colorClassName: "bg-[rgb(var(--green-1))]",
  },
  {
    key: "api",
    sourceType: "rest",
    kind: "api",
    icon: Cable,
    iconClassName: "text-[rgb(var(--arcoblue-6))]",
    colorClassName: "bg-[rgb(var(--arcoblue-1))]",
  },
];
const CONNECTOR_TYPE_OPTIONS_BY_CATEGORY = {
  database: ["mysql", "postgresql", "oracle", "sqlserver"],
  object_storage: ["s3"],
  file_transfer: ["ftp", "sftp"],
  message_queue: ["kafka"],
  api: ["rest"],
} satisfies Record<ConnectorCategoryKey, OntologyConnectionSourceType[]>;
const KAFKA_SECURITY_OPTIONS = ["PLAINTEXT", "SASL_PLAINTEXT", "SASL_SSL"];
const API_AUTH_OPTIONS = ["none", "bearer", "basic", "api_key"];

export interface IOntologyWorkbenchApi {
  listWorkbenches: () => Promise<IOntologyWorkbenchListResult>;
  getWorkbench: (
    input?: IOntologySelectWorkbenchInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  createWorkbench: (
    input: IOntologyCreateWorkbenchInput,
  ) => Promise<IOntologyWorkbenchMutationResult>;
  selectWorkbench: (
    input: IOntologySelectWorkbenchInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  deleteWorkbench: (
    input: IOntologyDeleteWorkbenchInput,
  ) => Promise<IOntologyWorkbenchMutationResult>;
  updateDraft: (
    input: IOntologyWorkbenchDraftInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  transitionPhase: (
    input: IOntologyPhaseTransitionInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  pickBuildFiles: (method: "template" | "document") => Promise<string[]>;
  importFiles: (input: IOntologyImportFilesInput) => Promise<{
    snapshot: IOntologyWorkbenchSnapshot;
    files: IOntologyImportedFile[];
  }>;
  probeConnector: (
    input: IOntologyProbeConnectorInput,
  ) => Promise<IOntologyProbeConnectorResult>;
  browseConnectorAssets: (
    input: IOntologyBrowseConnectorAssetsInput,
  ) => Promise<IOntologyBrowseConnectorAssetsResult>;
  deleteConnector: (
    input: IOntologyDeleteConnectorInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  deleteAsset: (
    input: IOntologyDeleteInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  profileAsset: (
    input: IOntologyProfileAssetInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  syncAssetSchema: (
    input: IOntologySyncAssetSchemaInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  previewAsset: (
    input: IOntologyPreviewAssetInput,
  ) => Promise<IOntologyPreviewAssetResult>;
  generateDraft: (
    input?: IOntologyGenerateDraftInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  upsertObject: (
    input: IOntologyObjectDraftInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  deleteObject: (
    input: IOntologyDeleteInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  upsertAttribute: (
    input: IOntologyAttributeDraftInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  deleteAttribute: (
    input: IOntologyDeleteAttributeInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  upsertRelation: (
    input: IOntologyRelationDraftInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  deleteRelation: (
    input: IOntologyDeleteInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  upsertMapping: (
    input: IOntologyFieldMappingInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  deleteMapping: (
    input: IOntologyDeleteInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  upsertQualityRule: (
    input: IOntologyQualityRuleInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  deleteQualityRule: (
    input: IOntologyDeleteInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  upsertLogicFunction: (
    input: IOntologyLogicFunctionInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  deleteLogicFunction: (
    input: IOntologyDeleteInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  upsertAction: (
    input: IOntologyActionDefinitionInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  deleteAction: (
    input: IOntologyDeleteInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  reviewTarget: (
    input: IOntologyReviewTargetInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  approveAll: () => Promise<IOntologyWorkbenchSnapshot>;
  runConsistencyCheck: (
    input?: IOntologySelectWorkbenchInput,
  ) => Promise<IOntologyConsistencyCheckResult>;
  publishCurrentDraft: (input?: IOntologySelectWorkbenchInput) => Promise<{
    snapshot: IOntologyWorkbenchSnapshot;
    version: IOntologyPublishedVersion;
  }>;
  approvePublishedVersion: (
    input: IOntologyPublishApprovalInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  rejectPublishedVersion: (
    input: IOntologyRejectVersionInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  rollbackToVersion: (
    input: IOntologyRollbackInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  createAgentBlueprint: (
    input: IOntologyAgentBlueprintInput,
  ) => Promise<{ snapshot: IOntologyWorkbenchSnapshot }>;
  registerAgentBlueprint: (
    input: IOntologyRegisterAgentInput,
  ) => Promise<{ snapshot: IOntologyWorkbenchSnapshot }>;
  deleteAgentBlueprint: (
    input: IOntologyDeleteInput,
  ) => Promise<IOntologyWorkbenchSnapshot>;
  resetWorkbench: () => Promise<IOntologyWorkbenchSnapshot>;
  onWorkbenchChanged: (
    onChanged: (snapshot: IOntologyWorkbenchSnapshot) => void,
  ) => () => void;
}

export default function OntologyWorkbench({
  api,
  renderAiBuilder,
  onExposeActivateView,
}: IOntologyWorkbenchProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<IOntologyWorkbenchSnapshot | null>(
    null,
  );
  const [workbenches, setWorkbenches] = useState<IOntologyWorkbenchSummary[]>(
    [],
  );
  const [workspaceSnapshots, setWorkspaceSnapshots] = useState<
    IOntologyWorkbenchSnapshot[]
  >([]);
  const [publishWorkspaceId, setPublishWorkspaceId] = useState<string | null>(
    null,
  );
  const [activeView, setActiveView] =
    useState<OntologyConsoleView>("connections");
  const [isOntologyDetailVisible, setIsOntologyDetailVisible] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [connectionFilter, setConnectionFilter] = useState<
    "all" | OntologyAssetKind
  >("all");
  const [assetCategoryFilter, setAssetCategoryFilter] =
    useState<AssetCategoryFilter>("all");
  const [assetViewMode, setAssetViewMode] = useState<"grid" | "list">("grid");
  const [agentNameValue, setAgentNameValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isRegisteringAgent, setIsRegisteringAgent] = useState(false);
  const [isScanningConnector, setIsScanningConnector] = useState(false);
  const [profilingAssetId, setProfilingAssetId] = useState<string | null>(null);
  const [syncingAssetId, setSyncingAssetId] = useState<string | null>(null);
  const [isEditingModel, setIsEditingModel] = useState(false);
  const [consistencyCheck, setConsistencyCheck] =
    useState<IOntologyConsistencyCheckResult | null>(null);
  const [connectorSourceType, setConnectorSourceType] =
    useState<OntologyConnectionSourceType>("mysql");
  const [connectorNameValue, setConnectorNameValue] = useState("");
  const [connectorFormValues, setConnectorFormValues] =
    useState<ConnectorFormValues>(() =>
      createDefaultConnectorFormValues("mysql"),
    );
  const [editingObject, setEditingObject] =
    useState<IOntologyObjectDraft | null>(null);
  const [isObjectModalVisible, setIsObjectModalVisible] = useState(false);
  const [objectNameValue, setObjectNameValue] = useState("");
  const [objectCodeValue, setObjectCodeValue] = useState("");
  const [objectDescriptionValue, setObjectDescriptionValue] = useState("");
  const [editingAttribute, setEditingAttribute] = useState<{
    objectId: string;
    attribute?: IOntologyObjectDraft["attributes"][number];
  } | null>(null);
  const [isAttributeModalVisible, setIsAttributeModalVisible] = useState(false);
  const [attributeNameValue, setAttributeNameValue] = useState("");
  const [attributeCodeValue, setAttributeCodeValue] = useState("");
  const [attributeDataTypeValue, setAttributeDataTypeValue] =
    useState("string");
  const [isAttributeRequired, setIsAttributeRequired] = useState(false);
  const [attributeDescriptionValue, setAttributeDescriptionValue] =
    useState("");
  const [isAttributeDeleteConfirmVisible, setIsAttributeDeleteConfirmVisible] =
    useState(false);
  const [attributeExampleValue, setAttributeExampleValue] = useState("");
  const [attributeConstraintsValue, setAttributeConstraintsValue] =
    useState("{}");
  const [editingRelation, setEditingRelation] =
    useState<IOntologyRelationDraft | null>(null);
  const [isRelationModalVisible, setIsRelationModalVisible] = useState(false);
  const [relationNameValue, setRelationNameValue] = useState("");
  const [relationCodeValue, setRelationCodeValue] = useState("");
  const [relationFromObjectId, setRelationFromObjectId] = useState("");
  const [relationToObjectId, setRelationToObjectId] = useState("");
  const [relationCardinalityValue, setRelationCardinalityValue] =
    useState<IOntologyRelationDraft["cardinality"]>("one_to_many");
  const [relationTypeValue, setRelationTypeValue] =
    useState<IOntologyRelationDraft["relationType"]>("object_property");
  const [relationSemanticTypeValue, setRelationSemanticTypeValue] =
    useState<IOntologyRelationDraft["semanticType"]>("association");
  const [isRelationAcyclic, setIsRelationAcyclic] = useState(false);
  const [relationObjectIds, setRelationObjectIds] = useState<string[] | null>(
    null,
  );
  const [editingMapping, setEditingMapping] =
    useState<IOntologyFieldMapping | null>(null);
  const [isMappingModalVisible, setIsMappingModalVisible] = useState(false);
  const [mappingObjectId, setMappingObjectId] = useState("");
  const [mappingAttributeId, setMappingAttributeId] = useState("");
  const [mappingAssetId, setMappingAssetId] = useState("");
  const [mappingFieldName, setMappingFieldName] = useState("");
  const [editingRule, setEditingRule] = useState<IOntologyQualityRule | null>(
    null,
  );
  const [isRuleModalVisible, setIsRuleModalVisible] = useState(false);
  const [ruleObjectId, setRuleObjectId] = useState("");
  const [ruleNameValue, setRuleNameValue] = useState("");
  const [ruleCodeValue, setRuleCodeValue] = useState("");
  const [ruleExpressionValue, setRuleExpressionValue] = useState("");
  const [ruleSeverityValue, setRuleSeverityValue] =
    useState<IOntologyQualityRule["severity"]>("warning");

  const isBuildOperationPendingRef = useRef(false);

  const currentEditingObject = snapshot?.objects.find(
    (object) => object.id === editingObject?.id,
  );
  const isObjectEditorBlocked =
    isEditingModel ||
    isAttributeModalVisible ||
    isAttributeDeleteConfirmVisible;

  const onCacheSnapshot = useCallback(
    (nextSnapshot: IOntologyWorkbenchSnapshot) => {
      setWorkspaceSnapshots((current) => {
        const isKnown = current.some(
          (item) => item.workspaceId === nextSnapshot.workspaceId,
        );
        return isKnown
          ? current.map((item) =>
              item.workspaceId === nextSnapshot.workspaceId
                ? nextSnapshot
                : item,
            )
          : [...current, nextSnapshot];
      });
    },
    [],
  );

  const onApplySnapshot = useCallback(
    (nextSnapshot: IOntologyWorkbenchSnapshot) => {
      setSnapshot(nextSnapshot);
      onCacheSnapshot(nextSnapshot);
      setAgentNameValue(
        nextSnapshot.draft.title
          ? t("ontology.agent.nameTemplate", {
              title: nextSnapshot.draft.title,
            })
          : t("ontology.agent.defaultName"),
      );
      setConsistencyCheck(null);
    },
    [onCacheSnapshot, t],
  );

  const onApplyWorkspaceMutation = useCallback(
    (nextSnapshot: IOntologyWorkbenchSnapshot) => {
      onCacheSnapshot(nextSnapshot);
      setSnapshot((current) =>
        current?.workspaceId === nextSnapshot.workspaceId
          ? nextSnapshot
          : current,
      );
    },
    [onCacheSnapshot],
  );

  const refreshWorkbenches = useCallback(async () => {
    const list = await api.listWorkbenches();
    setWorkbenches(list.items);
    const snapshots = await Promise.all(
      list.items.map((item) =>
        api.getWorkbench({ workspaceId: item.workspaceId }),
      ),
    );
    setWorkspaceSnapshots(snapshots);
    return list;
  }, [api]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await refreshWorkbenches();
      const nextSnapshot = await api.getWorkbench();
      onApplySnapshot(nextSnapshot);
      if (
        !list.items.some(
          (item) => item.workspaceId === nextSnapshot.workspaceId,
        )
      ) {
        await refreshWorkbenches();
      }
    } catch (err) {
      showError(t, err);
    } finally {
      setIsLoading(false);
    }
  }, [api, onApplySnapshot, refreshWorkbenches, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = api.onWorkbenchChanged((nextSnapshot) => {
      onApplyWorkspaceMutation(nextSnapshot);
      void refreshWorkbenches();
    });
    return off;
  }, [api, onApplyWorkspaceMutation, refreshWorkbenches]);

  const filteredConnectors = useMemo(() => {
    if (!snapshot) return [];
    const query = searchValue.trim().toLowerCase();
    return snapshot.connectors.filter((connector) => {
      const isFilterMatched =
        connectionFilter === "all" || connector.kind === connectionFilter;
      const endpoint = connector.url ?? connector.path ?? "";
      const isSearchMatched =
        !query ||
        [connector.name, connector.sourceType, connector.kind, endpoint].some(
          (value) => value.toLowerCase().includes(query),
        );
      return isFilterMatched && isSearchMatched;
    });
  }, [connectionFilter, searchValue, snapshot]);

  const filteredAssets = useMemo(() => {
    if (!snapshot) return [];
    const query = searchValue.trim().toLowerCase();
    return snapshot.assets.filter((asset) => {
      const isStructured =
        asset.kind === "database" ||
        asset.kind === "schema" ||
        asset.kind === "table";
      const isCategoryMatched =
        assetCategoryFilter === "all" ||
        (assetCategoryFilter === "structured" ? isStructured : !isStructured);
      const locator = asset.path ?? asset.sourceName ?? "";
      const isSearchMatched =
        !query ||
        [asset.name, asset.kind, asset.sourceName ?? "", locator].some(
          (value) => value.toLowerCase().includes(query),
        );
      return isCategoryMatched && isSearchMatched;
    });
  }, [assetCategoryFilter, searchValue, snapshot]);

  const filteredObjects = useMemo(() => {
    if (!snapshot) return [];
    const query = searchValue.trim().toLowerCase();
    if (!query) return snapshot.objects;
    return snapshot.objects.filter((object) =>
      [object.name, object.code, object.description].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [searchValue, snapshot]);

  const onActiveViewChange = (view: OntologyConsoleView) => {
    if (view === "publish") setPublishWorkspaceId(null);
    setActiveView(view);
    if (view !== "ontology") setIsOntologyDetailVisible(false);
    setSearchValue("");
  };

  useEffect(() => {
    if (!onExposeActivateView) return;
    onExposeActivateView((view) => {
      onActiveViewChange(view);
    });
    // We intentionally don't include onActiveViewChange as a dep because it is
    // recreated every render; the imperative handle only needs to fire the
    // current setter, which reads latest state via setActiveView anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExposeActivateView]);

  const onConnectorSourceTypeChange = (
    sourceType: OntologyConnectionSourceType,
  ) => {
    setConnectorSourceType(sourceType);
    setConnectorFormValues(createDefaultConnectorFormValues(sourceType));
  };

  const onConnectorFormValueChange = (
    key: string,
    value: ConnectorFormValue,
  ) => {
    setConnectorFormValues((values) => ({ ...values, [key]: value }));
  };

  const onProbeConnector = async (connectorId?: string) => {
    setIsScanningConnector(true);
    try {
      const existingConnector = connectorId
        ? snapshot?.connectors.find((item) => item.id === connectorId)
        : undefined;
      const displayName =
        connectorNameValue.trim() ||
        t(`ontology.connectorType.${connectorSourceType}`);
      const connectorConfig = buildConnectorConfigFromForm(
        connectorSourceType,
        connectorFormValues,
      );
      const connector: IOntologyConnectorInput = {
        ...(connectorId ? { id: connectorId } : {}),
        name: existingConnector?.name ?? displayName,
        sourceType: connectorSourceType,
        kind: connectorKindFromSourceType(connectorSourceType),
        ...connectorConfig,
        metadata: {
          ...existingConnector?.metadata,
          ...connectorConfig.metadata,
          displayName,
        },
      };
      const result = await api.probeConnector({
        connector,
        recursive: true,
        maxAssets: 300,
      });
      setSnapshot(result.snapshot);
      setConsistencyCheck(null);
      Message.success(
        t("ontology.messages.connectorScanned", {
          count: result.assets.length,
        }),
      );
      return true;
    } catch (err) {
      showError(t, err);
      return false;
    } finally {
      setIsScanningConnector(false);
    }
  };

  const onProbeExistingConnector = async (
    connector: IOntologyConnectorConfig,
  ) => {
    setIsScanningConnector(true);
    try {
      const result = await api.probeConnector({
        connector: {
          id: connector.id,
          name: connector.name,
          sourceType: connector.sourceType,
          kind: connector.kind,
          host: connector.host,
          port: connector.port,
          database: connector.database,
          path: connector.path,
          url: connector.url,
          username: connector.username,
          password: connector.password,
          credential: connector.credential,
          params: connector.params,
          writable: connector.writable,
          poolSize: connector.poolSize,
          rateLimitQps: connector.rateLimitQps,
          description: connector.description,
          metadata: connector.metadata,
        },
        recursive: true,
        maxAssets: 300,
      });
      setSnapshot(result.snapshot);
      setConsistencyCheck(null);
      Message.success(
        t("ontology.messages.connectorScanned", {
          count: result.assets.length,
        }),
      );
    } catch (err) {
      showError(t, err);
    } finally {
      setIsScanningConnector(false);
    }
  };

  const onEditConnector = (connector: IOntologyConnectorConfig) => {
    setConnectorSourceType(connector.sourceType);
    setConnectorNameValue(connectorDisplayName(connector));
    setConnectorFormValues(createConnectorFormValuesFromConfig(connector));
    setActiveView("connections");
  };

  const onBrowseConnectorAssets = (connector: IOntologyConnectorConfig) => {
    return api.browseConnectorAssets({ connectorId: connector.id });
  };

  const onCreateConnector = () => {
    setConnectorNameValue("");
    setConnectorFormValues(
      createDefaultConnectorFormValues(connectorSourceType),
    );
  };

  const onDeleteConnector = async (
    connector: IOntologyConnectorConfig,
    cascadeAssets: boolean,
  ) => {
    try {
      const nextSnapshot = await api.deleteConnector({
        id: connector.id,
        cascadeAssets,
      });
      setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      Message.success(t("ontology.messages.connectorDeleted"));
    } catch (err) {
      showError(t, err);
    }
  };

  const onProfileAsset = async (asset: IOntologyEnvironmentAsset) => {
    setProfilingAssetId(asset.id);
    try {
      const nextSnapshot = await api.profileAsset({ id: asset.id });
      setSnapshot(nextSnapshot);
      Message.success(t("ontology.messages.assetProfiled"));
    } catch (err) {
      showError(t, err);
    } finally {
      setProfilingAssetId(null);
    }
  };

  const onSyncAssetSchema = async (asset: IOntologyEnvironmentAsset) => {
    setSyncingAssetId(asset.id);
    try {
      const nextSnapshot = await api.syncAssetSchema({ id: asset.id });
      setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      Message.success(t("ontology.messages.assetSchemaSynced"));
    } catch (err) {
      showError(t, err);
    } finally {
      setSyncingAssetId(null);
    }
  };

  const onDeleteAsset = (asset: IOntologyEnvironmentAsset) => {
    Modal.confirm({
      title: t("ontology.asset.deleteTitle"),
      content: t("ontology.asset.deleteContent", { name: asset.name }),
      okText: t("ontology.editor.delete"),
      cancelText: t("ontology.reset.cancel"),
      okButtonProps: { status: "danger" },
      onOk: async () => {
        try {
          const nextSnapshot = await api.deleteAsset({ id: asset.id });
          setSnapshot(nextSnapshot);
          setConsistencyCheck(null);
          Message.success(t("ontology.messages.assetDeleted"));
        } catch (err) {
          showError(t, err);
        }
      },
    });
  };

  const onOpenObjectModal = (object?: IOntologyObjectDraft) => {
    setEditingObject(object ?? null);
    setObjectNameValue(object?.name ?? "");
    setObjectCodeValue(object?.code ?? "");
    setObjectDescriptionValue(object?.description ?? "");
    setIsObjectModalVisible(true);
  };

  const onUpsertObject = async (
    input: IOntologyObjectDraftInput,
  ): Promise<boolean> => {
    setIsEditingModel(true);
    try {
      const nextSnapshot = await api.upsertObject(input);
      setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      return true;
    } catch (err) {
      showError(t, err);
      return false;
    } finally {
      setIsEditingModel(false);
    }
  };

  const onSaveObject = async () => {
    if (isObjectEditorBlocked) return;
    const isSaved = await onUpsertObject({
      id: editingObject?.id,
      name: objectNameValue,
      code: objectCodeValue,
      description: objectDescriptionValue,
      tier: editingObject?.tier,
      status: editingObject?.status,
      namespace: editingObject?.namespace,
      sourceAssetIds: editingObject?.sourceAssetIds,
    });
    if (isSaved) setIsObjectModalVisible(false);
  };

  const onDeleteObject = (object: IOntologyObjectDraft) => {
    Modal.confirm({
      title: t("ontology.editor.deleteObjectTitle"),
      content: t("ontology.editor.deleteObjectContent", { name: object.name }),
      okText: t("ontology.editor.delete"),
      cancelText: t("ontology.reset.cancel"),
      onOk: async () => {
        const nextSnapshot = await api.deleteObject({ id: object.id });
        setSnapshot(nextSnapshot);
        setConsistencyCheck(null);
      },
    });
  };

  const onDeleteObjects = async (
    objects: IOntologyObjectDraft[],
  ): Promise<boolean> => {
    if (objects.length === 0) return false;
    setIsEditingModel(true);
    try {
      let nextSnapshot = snapshot;
      for (const object of objects)
        nextSnapshot = await api.deleteObject({ id: object.id });
      if (nextSnapshot) setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      Message.success(
        t("ontology.objectBuilder.batchDeleted", { count: objects.length }),
      );
      return true;
    } catch (err) {
      showError(t, err);
      return false;
    } finally {
      setIsEditingModel(false);
    }
  };

  const onActivateObjects = async (
    objects: IOntologyObjectDraft[],
  ): Promise<boolean> => {
    if (objects.length === 0) return false;
    setIsEditingModel(true);
    try {
      let nextSnapshot = snapshot;
      for (const object of objects) {
        nextSnapshot = await api.upsertObject({
          id: object.id,
          name: object.name,
          code: object.code,
          description: object.description,
          tier: object.tier,
          status: "active",
          namespace: object.namespace,
          sourceAssetIds: object.sourceAssetIds,
        });
        nextSnapshot = await api.reviewTarget({
          targetType: "object",
          targetId: object.id,
          decision: "approved",
        });
      }
      if (nextSnapshot) setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      Message.success(
        t("ontology.objectBuilder.batchActivated", { count: objects.length }),
      );
      return true;
    } catch (err) {
      showError(t, err);
      return false;
    } finally {
      setIsEditingModel(false);
    }
  };

  const onOpenAttributeModal = (
    objectId: string,
    attribute?: IOntologyObjectDraft["attributes"][number],
  ) => {
    if (isEditingModel || isAttributeDeleteConfirmVisible) return;
    setEditingAttribute({ objectId, attribute });
    setAttributeNameValue(attribute?.name ?? "");
    setAttributeDescriptionValue(attribute?.description ?? "");
    setAttributeCodeValue(attribute?.code ?? "");
    setAttributeDataTypeValue(attribute?.dataType ?? "string");
    setIsAttributeRequired(attribute?.required ?? false);
    setAttributeExampleValue(attribute?.example ?? "");
    setAttributeConstraintsValue(
      JSON.stringify(attribute?.constraints ?? {}, null, 2),
    );
    setIsAttributeModalVisible(true);
  };

  const onSaveAttribute = async () => {
    if (
      !editingAttribute ||
      isEditingModel ||
      !attributeNameValue.trim() ||
      !attributeDataTypeValue.trim()
    )
      return;
    setIsEditingModel(true);
    try {
      const currentAttribute = snapshot?.objects
        .find((object) => object.id === editingAttribute.objectId)
        ?.attributes.find(
          (attribute) => attribute.id === editingAttribute.attribute?.id,
        );
      const constraints = parseJsonObject<Record<string, unknown>>(
        attributeConstraintsValue,
        t("ontology.editor.invalidConstraints"),
      ) as IOntologyAttributeConstraints;
      const nextSnapshot = await api.upsertAttribute({
        id: editingAttribute.attribute?.id,
        objectId: editingAttribute.objectId,
        name: attributeNameValue,
        code: attributeCodeValue,
        dataType: attributeDataTypeValue,
        required: isAttributeRequired,
        description: attributeDescriptionValue,
        mappedField: currentAttribute?.mappedField,
        example: attributeExampleValue,
        constraints,
      });
      setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      setIsAttributeModalVisible(false);
    } catch (err) {
      showError(t, err);
    } finally {
      setIsEditingModel(false);
    }
  };

  const onDeleteAttribute = async (input: IOntologyDeleteAttributeInput) => {
    if (
      isEditingModel ||
      isAttributeModalVisible ||
      isAttributeDeleteConfirmVisible
    )
      return;
    const attribute = snapshot?.objects
      .find((object) => object.id === input.objectId)
      ?.attributes.find((item) => item.id === input.attributeId);
    if (!attribute) return;
    setIsAttributeDeleteConfirmVisible(true);
    const confirmation = Modal.confirm({
      title: t("ontology.objectEditor.deleteAttributeTitle"),
      content: t("ontology.objectEditor.deleteAttributeContent", {
        name: attribute.name,
      }),
      okText: t("ontology.editor.delete"),
      cancelText: t("ontology.reset.cancel"),
      okButtonProps: { status: "danger" },
      maskClosable: false,
      afterClose: () => setIsAttributeDeleteConfirmVisible(false),
      onOk: async () => {
        setIsEditingModel(true);
        confirmation.update({
          cancelButtonProps: { disabled: true },
          escToExit: false,
          closable: false,
        });
        try {
          const nextSnapshot = await api.deleteAttribute(input);
          setSnapshot(nextSnapshot);
          setConsistencyCheck(null);
        } catch (err) {
          showError(t, err);
          throw err;
        } finally {
          setIsEditingModel(false);
          confirmation.update({
            cancelButtonProps: { disabled: false },
            escToExit: true,
          });
        }
      },
    });
  };

  const onOpenRelationModal = (
    relation?: IOntologyRelationDraft,
    objectIds?: string[],
  ) => {
    const availableObjects = objectIds
      ? (snapshot?.objects ?? []).filter((object) =>
          objectIds.includes(object.id),
        )
      : (snapshot?.objects ?? []);
    setEditingRelation(relation ?? null);
    setRelationObjectIds(objectIds ?? null);
    setRelationNameValue(relation?.name ?? "");
    setRelationCodeValue(relation?.code ?? "");
    setRelationFromObjectId(
      relation?.fromObjectId ?? availableObjects[0]?.id ?? "",
    );
    setRelationToObjectId(
      relation?.toObjectId ??
        availableObjects[1]?.id ??
        availableObjects[0]?.id ??
        "",
    );
    setRelationCardinalityValue(relation?.cardinality ?? "one_to_many");
    setRelationTypeValue(relation?.relationType ?? "object_property");
    setRelationSemanticTypeValue(relation?.semanticType ?? "association");
    setIsRelationAcyclic(relation?.isAcyclic ?? false);
    setIsRelationModalVisible(true);
  };

  const onSaveRelation = async () => {
    setIsEditingModel(true);
    try {
      const nextSnapshot = await api.upsertRelation({
        id: editingRelation?.id,
        name: relationNameValue,
        code: relationCodeValue,
        fromObjectId: relationFromObjectId,
        toObjectId: relationToObjectId,
        cardinality: relationCardinalityValue,
        relationType: relationTypeValue,
        semanticType: relationSemanticTypeValue,
        isAcyclic: isRelationAcyclic,
        description: editingRelation?.description,
      });
      setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      setIsRelationModalVisible(false);
    } catch (err) {
      showError(t, err);
    } finally {
      setIsEditingModel(false);
    }
  };

  const onDeleteRelation = async (relation: IOntologyRelationDraft) => {
    const nextSnapshot = await api.deleteRelation({ id: relation.id });
    setSnapshot(nextSnapshot);
    setConsistencyCheck(null);
  };

  const onOpenMappingModal = (mapping?: IOntologyFieldMapping) => {
    const defaultObject = snapshot?.objects[0];
    const defaultAttribute = defaultObject?.attributes[0];
    const defaultAsset = snapshot?.assets[0];
    setEditingMapping(mapping ?? null);
    setMappingObjectId(mapping?.objectId ?? defaultObject?.id ?? "");
    setMappingAttributeId(mapping?.attributeId ?? defaultAttribute?.id ?? "");
    setMappingAssetId(mapping?.assetId ?? defaultAsset?.id ?? "");
    setMappingFieldName(
      mapping?.fieldName ?? defaultAsset?.fields[0]?.name ?? "",
    );
    setIsMappingModalVisible(true);
  };

  const onSaveMapping = async () => {
    setIsEditingModel(true);
    try {
      const nextSnapshot = await api.upsertMapping({
        id: editingMapping?.id,
        objectId: mappingObjectId,
        attributeId: mappingAttributeId,
        assetId: mappingAssetId,
        fieldName: mappingFieldName,
        strategy: "manual",
        status: "pending",
      });
      setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      setIsMappingModalVisible(false);
    } catch (err) {
      showError(t, err);
    } finally {
      setIsEditingModel(false);
    }
  };

  const onDeleteMapping = async (mapping: IOntologyFieldMapping) => {
    const nextSnapshot = await api.deleteMapping({ id: mapping.id });
    setSnapshot(nextSnapshot);
    setConsistencyCheck(null);
  };

  const onOpenRuleModal = (rule?: IOntologyQualityRule) => {
    setEditingRule(rule ?? null);
    setRuleObjectId(rule?.objectId ?? snapshot?.objects[0]?.id ?? "");
    setRuleNameValue(rule?.name ?? "");
    setRuleCodeValue(rule?.code ?? "");
    setRuleExpressionValue(rule?.expression ?? "");
    setRuleSeverityValue(rule?.severity ?? "warning");
    setIsRuleModalVisible(true);
  };

  const onSaveRule = async () => {
    setIsEditingModel(true);
    try {
      const nextSnapshot = await api.upsertQualityRule({
        id: editingRule?.id,
        objectId: ruleObjectId,
        name: ruleNameValue,
        code: ruleCodeValue,
        expression: ruleExpressionValue,
        severity: ruleSeverityValue,
        status: "active",
      });
      setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      setIsRuleModalVisible(false);
    } catch (err) {
      showError(t, err);
    } finally {
      setIsEditingModel(false);
    }
  };

  const onDeleteRule = async (rule: IOntologyQualityRule) => {
    const nextSnapshot = await api.deleteQualityRule({ id: rule.id });
    setSnapshot(nextSnapshot);
    setConsistencyCheck(null);
  };

  const onUpsertLogicFunction = async (input: IOntologyLogicFunctionInput) => {
    const nextSnapshot = await api.upsertLogicFunction(input);
    setSnapshot(nextSnapshot);
    setConsistencyCheck(null);
  };

  const onDeleteLogicFunction = async (
    logicFunction: IOntologyLogicFunction,
  ) => {
    const nextSnapshot = await api.deleteLogicFunction({
      id: logicFunction.id,
    });
    setSnapshot(nextSnapshot);
    setConsistencyCheck(null);
  };

  const onUpsertAction = async (input: IOntologyActionDefinitionInput) => {
    const nextSnapshot = await api.upsertAction(input);
    setSnapshot(nextSnapshot);
    setConsistencyCheck(null);
  };

  const onDeleteAction = async (action: IOntologyActionDefinition) => {
    const nextSnapshot = await api.deleteAction({ id: action.id });
    setSnapshot(nextSnapshot);
    setConsistencyCheck(null);
  };

  const onCompletePhase = async (
    phase: OntologyWorkflowPhase,
  ): Promise<boolean> => {
    try {
      const nextSnapshot = await api.transitionPhase({
        phase,
        status: "completed",
        summary: t(`ontology.phaseSummary.${phase}`),
      });
      setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      return true;
    } catch (err) {
      showError(t, err);
      return false;
    }
  };

  const onGenerateDraft = async (
    input?: IOntologyGenerateDraftInput,
  ): Promise<boolean> => {
    const workspaceId = snapshot?.workspaceId;
    if (!workspaceId || isBuildOperationPendingRef.current) return false;
    isBuildOperationPendingRef.current = true;
    setIsGenerating(true);
    try {
      const nextSnapshot = await api.generateDraft({
        ...(input ?? {
          businessGoal: snapshot.draft.businessGoal,
          assetIds: snapshot.draft.selectedAssetIds,
        }),
        workspaceId,
      });
      onApplyWorkspaceMutation(nextSnapshot);
      setConsistencyCheck(null);
      Message.success(t("ontology.messages.generated"));
      return true;
    } catch (err) {
      showDocumentBuildError(t, err);
      return false;
    } finally {
      isBuildOperationPendingRef.current = false;
      setIsGenerating(false);
    }
  };

  const onImportObjectBuildFiles = async (
    method: "template" | "document",
  ): Promise<string[]> => {
    const workspaceId = snapshot?.workspaceId;
    if (!workspaceId || isBuildOperationPendingRef.current) return [];
    isBuildOperationPendingRef.current = true;
    setIsGenerating(true);
    try {
      const filePaths = await api.pickBuildFiles(method);
      if (filePaths.length === 0) return [];
      const imported = await api.importFiles({
        filePaths,
        purpose: method,
        workspaceId,
      });
      if (imported.files.length === 0)
        throw new Error(t("ontology.objectBuilder.noImportableFiles"));
      onApplyWorkspaceMutation(imported.snapshot);
      setConsistencyCheck(null);
      Message.success(
        t("ontology.objectBuilder.filesReady", {
          count: imported.files.length,
        }),
      );
      return imported.files.map((file) => file.id);
    } catch (err) {
      showDocumentBuildError(t, err);
      return [];
    } finally {
      isBuildOperationPendingRef.current = false;
      setIsGenerating(false);
    }
  };

  const onReviewTarget = async (
    input: IOntologyReviewTargetInput,
  ): Promise<boolean> => {
    try {
      const nextSnapshot = await api.reviewTarget(input);
      setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      return true;
    } catch (err) {
      showError(t, err);
      return false;
    }
  };

  const onApproveAll = async (): Promise<boolean> => {
    setIsApproving(true);
    try {
      const nextSnapshot = await api.approveAll();
      setSnapshot(nextSnapshot);
      setConsistencyCheck(null);
      Message.success(t("ontology.messages.approved"));
      return true;
    } catch (err) {
      showError(t, err);
      return false;
    } finally {
      setIsApproving(false);
    }
  };

  const onRunConsistencyCheck = async (workspaceId?: string) => {
    setIsChecking(true);
    try {
      const result = await api.runConsistencyCheck(
        workspaceId ? { workspaceId } : undefined,
      );
      setConsistencyCheck(result);
      if (result.isValid)
        Message.success(t("ontology.messages.consistencyPassed"));
    } catch (err) {
      showError(t, err);
    } finally {
      setIsChecking(false);
    }
  };

  const onPublish = async (workspaceId?: string) => {
    setIsPublishing(true);
    try {
      const result = await api.publishCurrentDraft(
        workspaceId ? { workspaceId } : undefined,
      );
      onApplyWorkspaceMutation(result.snapshot);
      await refreshWorkbenches();
      setConsistencyCheck(null);
      Message.success(
        t("ontology.messages.versionSubmitted", {
          version: result.version.version,
        }),
      );
    } catch (err) {
      showError(t, err);
    } finally {
      setIsPublishing(false);
    }
  };

  const onApproveVersion = async (
    workspaceId: string,
    version: IOntologyPublishedVersion,
  ): Promise<boolean> => {
    try {
      const nextSnapshot = await api.approvePublishedVersion({
        versionId: version.id,
        workspaceId,
        reviewerId: "local-reviewer",
      });
      onApplyWorkspaceMutation(nextSnapshot);
      await refreshWorkbenches();
      Message.success(t("ontology.messages.versionApproved"));
      return true;
    } catch (err) {
      showError(t, err);
      return false;
    }
  };

  const onRejectVersion = async (
    workspaceId: string,
    version: IOntologyPublishedVersion,
    reason: string,
  ): Promise<boolean> => {
    try {
      const nextSnapshot = await api.rejectPublishedVersion({
        versionId: version.id,
        workspaceId,
        reviewerId: "local-reviewer",
        reason,
      });
      onApplyWorkspaceMutation(nextSnapshot);
      await refreshWorkbenches();
      Message.success(t("ontology.messages.versionRejected"));
      return true;
    } catch (err) {
      showError(t, err);
      return false;
    }
  };

  const onRollbackVersion = (
    workspaceId: string,
    version: IOntologyPublishedVersion,
  ) => {
    Modal.confirm({
      title: t("ontology.publish.rollbackTitle"),
      content: t("ontology.publish.rollbackContent", {
        version: version.version,
      }),
      okText: t("ontology.publish.rollback"),
      cancelText: t("ontology.reset.cancel"),
      onOk: async () => {
        const nextSnapshot = await api.rollbackToVersion({
          versionId: version.id,
          workspaceId,
        });
        onApplyWorkspaceMutation(nextSnapshot);
        await refreshWorkbenches();
        setConsistencyCheck(null);
        Message.success(
          t("ontology.messages.rolledBack", { version: version.version }),
        );
      },
    });
  };

  const onCreateAgent = async (
    workspaceId: string,
    ontologyVersionId: string,
  ): Promise<boolean> => {
    setIsCreatingAgent(true);
    try {
      const result = await api.createAgentBlueprint({
        name: agentNameValue,
        ontologyVersionId,
        workspaceId,
        promptTemplate: t("ontology.agent.defaultPrompt"),
      });
      onApplyWorkspaceMutation(result.snapshot);
      await refreshWorkbenches();
      Message.success(t("ontology.messages.agentCreated"));
      return true;
    } catch (err) {
      showError(t, err);
      return false;
    } finally {
      setIsCreatingAgent(false);
    }
  };

  const onRegisterAgent = async (
    workspaceId: string,
    agent?: IOntologyAgentBlueprint,
  ) => {
    setIsRegisteringAgent(true);
    try {
      const result = await api.registerAgentBlueprint({
        blueprintId: agent?.id,
        name: agent?.name ?? agentNameValue,
        workspaceId,
      });
      onApplyWorkspaceMutation(result.snapshot);
      await refreshWorkbenches();
      Message.success(t("ontology.messages.agentRegistered"));
    } catch (err) {
      showError(t, err);
    } finally {
      setIsRegisteringAgent(false);
    }
  };

  const onDeleteAgentBlueprint = async (
    workspaceId: string,
    agent: IOntologyAgentBlueprint,
  ) => {
    Modal.confirm({
      title: t("ontology.agentManage.deleteTitle"),
      content: t("ontology.agentManage.deleteContent", { name: agent.name }),
      okText: t("ontology.editor.delete"),
      cancelText: t("ontology.reset.cancel"),
      okButtonProps: { status: "danger" },
      onOk: async () => {
        try {
          const nextSnapshot = await api.deleteAgentBlueprint({
            id: agent.id,
            workspaceId,
          });
          onApplyWorkspaceMutation(nextSnapshot);
          await refreshWorkbenches();
          Message.success(t("ontology.agentManage.deleted"));
        } catch (err) {
          showError(t, err);
          throw err;
        }
      },
    });
  };

  const onCreateOntology = async (input: IOntologyCreateWorkbenchInput) => {
    const result = await api.createWorkbench(input);
    setWorkbenches(result.summaries);
    onApplySnapshot(result.snapshot);
    setIsOntologyDetailVisible(true);
    Message.success(t("ontology.list.created"));
  };

  const onSelectWorkbench = async (
    workspaceId: string,
  ): Promise<IOntologyWorkbenchSnapshot | null> => {
    try {
      const nextSnapshot = await api.selectWorkbench({ workspaceId });
      onApplySnapshot(nextSnapshot);
      await refreshWorkbenches();
      return nextSnapshot;
    } catch (err) {
      showError(t, err);
      return null;
    }
  };

  const onSelectOntology = async (workspaceId: string) => {
    const nextSnapshot = await onSelectWorkbench(workspaceId);
    if (nextSnapshot) setIsOntologyDetailVisible(true);
  };

  const onDeleteOntology = async (workspaceId: string) => {
    const result = await api.deleteWorkbench({ workspaceId });
    setWorkbenches(result.summaries);
    onApplySnapshot(result.snapshot);
    if (workspaceId === snapshot?.workspaceId)
      setIsOntologyDetailVisible(false);
    Message.success(t("ontology.list.deleted"));
  };

  if (isLoading || !snapshot) {
    return (
      <div className="size-full f-center">
        <Spin size={32} />
      </div>
    );
  }

  const availableWorkspaceSnapshots =
    workspaceSnapshots.length > 0
      ? workspaceSnapshots
      : snapshot.workspaceId === "default"
        ? []
        : [snapshot];

  const hasEmbeddedPageHeader = (
    ["ai_builder", "ontology", "publish", "agent"] as OntologyConsoleView[]
  ).includes(activeView);

  return (
    <div className="size-full overflow-hidden bg-[var(--color-fill-1)]">
      <div className="flex h-full min-h-0">
        <OntologyConsoleSidebar
          activeView={activeView}
          onActiveViewChange={onActiveViewChange}
          isAiBuilderVisible={Boolean(renderAiBuilder)}
        />

        <section className="flex min-w-0 flex-1 flex-col bg-[var(--color-fill-1)]">
          <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            {!hasEmbeddedPageHeader && (
              <ConsolePageHeader
                title={t(`ontology.console.views.${activeView}.title`)}
                description={t(
                  `ontology.console.views.${activeView}.description`,
                )}
              />
            )}

            {activeView === "ai_builder" &&
              renderAiBuilder &&
              renderAiBuilder(snapshot?.workspaceId ?? null)}

            {activeView === "connections" && (
              <ConnectionsPage
                snapshot={snapshot}
                connectors={filteredConnectors}
                searchValue={searchValue}
                connectionFilter={connectionFilter}
                connectorSourceType={connectorSourceType}
                connectorNameValue={connectorNameValue}
                connectorFormValues={connectorFormValues}
                isScanningConnector={isScanningConnector}
                onSearchChange={setSearchValue}
                onConnectionFilterChange={setConnectionFilter}
                onConnectorSourceTypeChange={onConnectorSourceTypeChange}
                onConnectorNameChange={setConnectorNameValue}
                onConnectorFormValueChange={onConnectorFormValueChange}
                onProbeConnector={onProbeConnector}
                onProbeExistingConnector={onProbeExistingConnector}
                onEditConnector={onEditConnector}
                onBrowseConnectorAssets={onBrowseConnectorAssets}
                onCreateConnector={onCreateConnector}
                onDeleteConnector={onDeleteConnector}
              />
            )}

            {activeView === "assets" && (
              <AssetsPage
                snapshot={snapshot}
                assets={filteredAssets}
                searchValue={searchValue}
                assetCategoryFilter={assetCategoryFilter}
                assetViewMode={assetViewMode}
                profilingAssetId={profilingAssetId}
                syncingAssetId={syncingAssetId}
                onSearchChange={setSearchValue}
                onAssetCategoryFilterChange={setAssetCategoryFilter}
                onAssetViewModeChange={setAssetViewMode}
                onProfileAsset={onProfileAsset}
                onSyncAssetSchema={onSyncAssetSchema}
                onDeleteAsset={onDeleteAsset}
                onPreviewAsset={api.previewAsset}
              />
            )}

            {activeView === "ontology" && (
              <OntologyModelPage
                snapshot={snapshot}
                workbenches={workbenches}
                objects={filteredObjects}
                searchValue={searchValue}
                isGenerating={isGenerating}
                isApproving={isApproving}
                isEditingModel={isEditingModel}
                isDetailVisible={isOntologyDetailVisible}
                onCreateOntology={onCreateOntology}
                onSelectOntology={onSelectOntology}
                onDeleteOntology={onDeleteOntology}
                onBackToList={() => setIsOntologyDetailVisible(false)}
                onOpenPublish={() => {
                  setPublishWorkspaceId(snapshot.workspaceId);
                  setActiveView("publish");
                }}
                onSearchChange={setSearchValue}
                onGenerateDraft={onGenerateDraft}
                onImportObjectBuildFiles={onImportObjectBuildFiles}
                consistencyCheck={consistencyCheck}
                isChecking={isChecking}
                onRunConsistencyCheck={onRunConsistencyCheck}
                onOpenObjectModal={onOpenObjectModal}
                onOpenRelationModal={onOpenRelationModal}
                onOpenMappingModal={onOpenMappingModal}
                onOpenRuleModal={onOpenRuleModal}
                onReviewTarget={onReviewTarget}
                onApproveAll={onApproveAll}
                onCompletePhase={onCompletePhase}
                onUpdateObject={onUpsertObject}
                onEditObject={onOpenObjectModal}
                onDeleteObject={onDeleteObject}
                onDeleteObjects={onDeleteObjects}
                onActivateObjects={onActivateObjects}
                onEditAttribute={onOpenAttributeModal}
                onDeleteAttribute={onDeleteAttribute}
                onEditRelation={onOpenRelationModal}
                onDeleteRelation={onDeleteRelation}
                onEditMapping={onOpenMappingModal}
                onDeleteMapping={onDeleteMapping}
                onEditRule={onOpenRuleModal}
                onDeleteRule={onDeleteRule}
                onUpsertLogicFunction={onUpsertLogicFunction}
                onDeleteLogicFunction={onDeleteLogicFunction}
                onUpsertAction={onUpsertAction}
                onDeleteAction={onDeleteAction}
              />
            )}

            {activeView === "publish" && (
              <PublishPage
                snapshot={snapshot}
                snapshots={availableWorkspaceSnapshots}
                initialWorkspaceId={publishWorkspaceId}
                consistencyCheck={consistencyCheck}
                isChecking={isChecking}
                isPublishing={isPublishing}
                onRunConsistencyCheck={onRunConsistencyCheck}
                onPublish={onPublish}
                onApproveVersion={onApproveVersion}
                onRejectVersion={onRejectVersion}
                onRollbackVersion={onRollbackVersion}
                onSelectWorkspace={onSelectWorkbench}
              />
            )}

            {activeView === "agent" && (
              <AgentPage
                snapshots={availableWorkspaceSnapshots}
                agentNameValue={agentNameValue}
                isCreatingAgent={isCreatingAgent}
                isRegisteringAgent={isRegisteringAgent}
                onAgentNameChange={setAgentNameValue}
                onCreateAgent={onCreateAgent}
                onRegisterAgent={onRegisterAgent}
                onDeleteAgent={onDeleteAgentBlueprint}
              />
            )}
          </main>
        </section>
        <Modal
          visible={isObjectModalVisible}
          title={
            editingObject
              ? t("ontology.editor.editObject")
              : t("ontology.editor.addObject")
          }
          okText={t(
            editingObject
              ? "ontology.objectEditor.saveBasicInfo"
              : "ontology.editor.save",
          )}
          cancelText={t(
            editingObject
              ? "ontology.objectEditor.close"
              : "ontology.reset.cancel",
          )}
          style={{ width: 760, maxWidth: "calc(100vw - 32px)" }}
          wrapClassName="ontology-object-editor"
          focusLock={
            !isAttributeModalVisible && !isAttributeDeleteConfirmVisible
          }
          escToExit={!isObjectEditorBlocked}
          maskClosable={!isObjectEditorBlocked}
          closable={!isObjectEditorBlocked}
          cancelButtonProps={{ disabled: isObjectEditorBlocked }}
          confirmLoading={
            isEditingModel &&
            !isAttributeModalVisible &&
            !isAttributeDeleteConfirmVisible
          }
          okButtonProps={{
            disabled:
              isObjectEditorBlocked ||
              objectNameValue.trim().length === 0 ||
              objectCodeValue.trim().length === 0,
          }}
          onOk={() => void onSaveObject()}
          onCancel={() => {
            if (!isObjectEditorBlocked) setIsObjectModalVisible(false);
          }}
        >
          <div className="max-h-[min(65vh,calc(100dvh-12rem))] overflow-y-auto">
            <Form layout="vertical" disabled={isObjectEditorBlocked}>
              <Form.Item label={t("ontology.editor.displayName")} required>
                <Input
                  value={objectNameValue}
                  placeholder={t("ontology.editor.displayName")}
                  onChange={setObjectNameValue}
                />
              </Form.Item>
              <Form.Item label={t("ontology.editor.englishName")} required>
                <Input
                  value={objectCodeValue}
                  placeholder={t("ontology.editor.englishName")}
                  onChange={setObjectCodeValue}
                />
              </Form.Item>
              <Form.Item label={t("ontology.editor.description")}>
                <TextArea
                  value={objectDescriptionValue}
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  placeholder={t("ontology.editor.description")}
                  onChange={setObjectDescriptionValue}
                />
              </Form.Item>
            </Form>
            {currentEditingObject && (
              <section className="border-t border-light pt-4">
                <Typography.Text
                  type="secondary"
                  className="mb-3 block text-xs"
                >
                  {t("ontology.objectEditor.attributeSaveHint")}
                </Typography.Text>
                <ObjectAttributeList
                  object={currentEditingObject}
                  isDisabled={isObjectEditorBlocked}
                  onEditAttribute={onOpenAttributeModal}
                  onDeleteAttribute={onDeleteAttribute}
                />
              </section>
            )}
          </div>
        </Modal>

        <Modal
          visible={isAttributeModalVisible}
          title={
            editingAttribute?.attribute
              ? t("ontology.editor.editAttribute")
              : t("ontology.editor.addAttribute")
          }
          okText={t("ontology.editor.save")}
          cancelText={t("ontology.reset.cancel")}
          confirmLoading={isEditingModel}
          wrapClassName="ontology-attribute-editor"
          style={{ maxWidth: "calc(100vw - 32px)" }}
          escToExit={!isEditingModel}
          maskClosable={!isEditingModel}
          closable={!isEditingModel}
          cancelButtonProps={{ disabled: isEditingModel }}
          okButtonProps={{
            disabled:
              isEditingModel ||
              !attributeNameValue.trim() ||
              !attributeDataTypeValue.trim(),
          }}
          onOk={() => void onSaveAttribute()}
          onCancel={() => {
            if (!isEditingModel) setIsAttributeModalVisible(false);
          }}
        >
          <Form
            layout="vertical"
            disabled={isEditingModel}
            className="max-h-[min(65vh,calc(100dvh-12rem))] overflow-y-auto"
          >
            <Form.Item label={t("ontology.editor.name")} required>
              <Input
                value={attributeNameValue}
                placeholder={t("ontology.editor.name")}
                onChange={setAttributeNameValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.code")}>
              <Input
                value={attributeCodeValue}
                placeholder={t("ontology.editor.code")}
                onChange={setAttributeCodeValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.dataType")} required>
              <Input
                value={attributeDataTypeValue}
                placeholder={t("ontology.editor.dataType")}
                onChange={setAttributeDataTypeValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.description")}>
              <TextArea
                value={attributeDescriptionValue}
                autoSize={{ minRows: 2, maxRows: 4 }}
                placeholder={t("ontology.editor.description")}
                onChange={setAttributeDescriptionValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.example")}>
              <Input
                value={attributeExampleValue}
                placeholder={t("ontology.editor.example")}
                onChange={setAttributeExampleValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.constraints")}>
              <TextArea
                value={attributeConstraintsValue}
                autoSize={{ minRows: 3, maxRows: 7 }}
                placeholder={t("ontology.editor.constraints")}
                onChange={setAttributeConstraintsValue}
              />
            </Form.Item>
            <Form.Item>
              <Checkbox
                checked={isAttributeRequired}
                onChange={setIsAttributeRequired}
              >
                {t("ontology.editor.required")}
              </Checkbox>
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          visible={isRelationModalVisible}
          title={
            editingRelation
              ? t("ontology.editor.editRelation")
              : t("ontology.editor.addRelation")
          }
          okText={t("ontology.editor.save")}
          cancelText={t("ontology.reset.cancel")}
          confirmLoading={isEditingModel}
          onOk={() => void onSaveRelation()}
          onCancel={() => setIsRelationModalVisible(false)}
        >
          <Form layout="vertical">
            <Form.Item label={t("ontology.editor.name")} required>
              <Input
                value={relationNameValue}
                placeholder={t("ontology.editor.name")}
                onChange={setRelationNameValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.code")}>
              <Input
                value={relationCodeValue}
                placeholder={t("ontology.editor.code")}
                onChange={setRelationCodeValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.fromObject")} required>
              <Select
                value={relationFromObjectId}
                onChange={(value) => setRelationFromObjectId(String(value))}
              >
                {snapshot.objects
                  .filter(
                    (object) =>
                      relationObjectIds === null ||
                      relationObjectIds.includes(object.id),
                  )
                  .map((object) => (
                    <Option key={object.id} value={object.id}>
                      {object.name}
                    </Option>
                  ))}
              </Select>
            </Form.Item>
            <Form.Item label={t("ontology.editor.toObject")} required>
              <Select
                value={relationToObjectId}
                onChange={(value) => setRelationToObjectId(String(value))}
              >
                {snapshot.objects
                  .filter(
                    (object) =>
                      relationObjectIds === null ||
                      relationObjectIds.includes(object.id),
                  )
                  .map((object) => (
                    <Option key={object.id} value={object.id}>
                      {object.name}
                    </Option>
                  ))}
              </Select>
            </Form.Item>
            <Form.Item label={t("ontology.editor.cardinalityLabel")}>
              <Select
                value={relationCardinalityValue}
                onChange={(value) =>
                  setRelationCardinalityValue(
                    value as IOntologyRelationDraft["cardinality"],
                  )
                }
              >
                {(
                  [
                    "one_to_one",
                    "one_to_many",
                    "many_to_one",
                    "many_to_many",
                  ] as IOntologyRelationDraft["cardinality"][]
                ).map((cardinality) => (
                  <Option key={cardinality} value={cardinality}>
                    {t(`ontology.cardinality.${cardinality}`)}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label={t("ontology.editor.relationTypeLabel")}>
              <Select
                value={relationTypeValue}
                onChange={(value) =>
                  setRelationTypeValue(
                    value as IOntologyRelationDraft["relationType"],
                  )
                }
              >
                {(
                  [
                    "object_property",
                    "symmetric_property",
                    "transitive_property",
                    "functional_property",
                  ] as const
                ).map((relationType) => (
                  <Option key={relationType} value={relationType}>
                    {t(`ontology.editor.relationType.${relationType}`)}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label={t("ontology.editor.semanticTypeLabel")}>
              <Select
                value={relationSemanticTypeValue}
                onChange={(value) =>
                  setRelationSemanticTypeValue(
                    value as IOntologyRelationDraft["semanticType"],
                  )
                }
              >
                {(
                  [
                    "composition",
                    "event",
                    "inheritance",
                    "dependency",
                    "association",
                  ] as const
                ).map((semanticType) => (
                  <Option key={semanticType} value={semanticType}>
                    {t(`ontology.editor.semanticType.${semanticType}`)}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item>
              <Checkbox
                checked={isRelationAcyclic}
                onChange={setIsRelationAcyclic}
              >
                {t("ontology.editor.acyclic")}
              </Checkbox>
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          visible={isMappingModalVisible}
          title={
            editingMapping
              ? t("ontology.editor.editMapping")
              : t("ontology.editor.addMapping")
          }
          okText={t("ontology.editor.save")}
          cancelText={t("ontology.reset.cancel")}
          confirmLoading={isEditingModel}
          onOk={() => void onSaveMapping()}
          onCancel={() => setIsMappingModalVisible(false)}
        >
          <Form layout="vertical">
            <Form.Item label={t("ontology.editor.mappingObject")} required>
              <Select
                value={mappingObjectId}
                onChange={(value) => {
                  const objectId = String(value);
                  setMappingObjectId(objectId);
                  setMappingAttributeId(
                    snapshot.objects.find((object) => object.id === objectId)
                      ?.attributes[0]?.id ?? "",
                  );
                }}
              >
                {snapshot.objects.map((object) => (
                  <Option key={object.id} value={object.id}>
                    {object.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label={t("ontology.editor.mappingAttribute")} required>
              <Select
                value={mappingAttributeId}
                onChange={(value) => setMappingAttributeId(String(value))}
              >
                {(
                  snapshot.objects.find(
                    (object) => object.id === mappingObjectId,
                  )?.attributes ?? []
                ).map((attribute) => (
                  <Option key={attribute.id} value={attribute.id}>
                    {attribute.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label={t("ontology.editor.mappingAsset")} required>
              <Select
                value={mappingAssetId}
                onChange={(value) => {
                  const assetId = String(value);
                  setMappingAssetId(assetId);
                  setMappingFieldName(
                    snapshot.assets.find((asset) => asset.id === assetId)
                      ?.fields[0]?.name ?? "",
                  );
                }}
              >
                {snapshot.assets.map((asset) => (
                  <Option key={asset.id} value={asset.id}>
                    {asset.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label={t("ontology.editor.mappingField")} required>
              <Select
                value={mappingFieldName}
                onChange={(value) => setMappingFieldName(String(value))}
              >
                {(
                  snapshot.assets.find((asset) => asset.id === mappingAssetId)
                    ?.fields ?? []
                ).map((field) => (
                  <Option key={field.name} value={field.name}>
                    {field.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          visible={isRuleModalVisible}
          title={
            editingRule
              ? t("ontology.editor.editRule")
              : t("ontology.editor.addRule")
          }
          okText={t("ontology.editor.save")}
          cancelText={t("ontology.reset.cancel")}
          confirmLoading={isEditingModel}
          onOk={() => void onSaveRule()}
          onCancel={() => setIsRuleModalVisible(false)}
        >
          <Form layout="vertical">
            <Form.Item label={t("ontology.editor.ruleObject")} required>
              <Select
                value={ruleObjectId}
                onChange={(value) => setRuleObjectId(String(value))}
              >
                {snapshot.objects.map((object) => (
                  <Option key={object.id} value={object.id}>
                    {object.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label={t("ontology.editor.name")} required>
              <Input
                value={ruleNameValue}
                placeholder={t("ontology.editor.name")}
                onChange={setRuleNameValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.code")}>
              <Input
                value={ruleCodeValue}
                placeholder={t("ontology.editor.code")}
                onChange={setRuleCodeValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.expression")} required>
              <TextArea
                value={ruleExpressionValue}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder={t("ontology.editor.expression")}
                onChange={setRuleExpressionValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.severityLabel")}>
              <Select
                value={ruleSeverityValue}
                onChange={(value) =>
                  setRuleSeverityValue(
                    value as IOntologyQualityRule["severity"],
                  )
                }
              >
                {(
                  [
                    "info",
                    "warning",
                    "error",
                  ] as IOntologyQualityRule["severity"][]
                ).map((severity) => (
                  <Option key={severity} value={severity}>
                    {t(`ontology.ruleSeverity.${severity}`)}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </div>
  );
}

function OntologyConsoleSidebar({
  activeView,
  onActiveViewChange,
  isAiBuilderVisible,
}: IOntologyConsoleSidebarProps) {
  const { t } = useTranslation();
  const navGroups = useMemo(
    () =>
      CONSOLE_NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          item.key === "ai_builder" ? isAiBuilderVisible : true,
        ),
      })).filter((group) => group.items.length > 0),
    [isAiBuilderVisible],
  );
  return (
    <aside className="flex w-44 shrink-0 flex-col border-r border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-3 py-5">
      <div className="mb-8 flex items-center gap-3 px-1">
        <div className="f-center size-8 rounded bg-[rgb(var(--primary-6))] text-white">
          <Network size={18} />
        </div>
        <div className="min-w-0">
          <Typography.Text bold className="block truncate">
            {t("ontology.console.brand")}
          </Typography.Text>
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.key}>
            <Typography.Text
              className="mb-2 block px-3 text-xs"
              type="secondary"
            >
              {t(`ontology.console.groups.${group.key}`)}
            </Typography.Text>
            <div className="flex flex-col gap-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.key;
                return (
                  <Button
                    key={item.key}
                    className={`!h-10 !justify-start !px-3 ${isActive ? "!bg-[rgba(var(--primary-6),0.12)] !text-[rgb(var(--primary-6))]" : "!text-[var(--color-text-2)]"}`}
                    type="text"
                    icon={<Icon size={17} />}
                    onClick={() => onActiveViewChange(item.key)}
                  >
                    <span className="truncate">
                      {t(`ontology.console.views.${item.key}.title`)}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function ConsolePageHeader({ title, description }: IConsolePageHeaderProps) {
  return (
    <div className="mb-6">
      <Typography.Title heading={3} className="!mb-2">
        {title}
      </Typography.Title>
      <Typography.Text type="secondary">{description}</Typography.Text>
    </div>
  );
}

function ConnectionsPage({
  snapshot,
  connectors,
  searchValue,
  connectionFilter,
  connectorSourceType,
  connectorNameValue,
  connectorFormValues,
  isScanningConnector,
  onSearchChange,
  onConnectionFilterChange,
  onConnectorSourceTypeChange,
  onConnectorNameChange,
  onConnectorFormValueChange,
  onProbeConnector,
  onProbeExistingConnector,
  onEditConnector,
  onBrowseConnectorAssets,
  onCreateConnector,
  onDeleteConnector,
}: IConnectionsPageProps) {
  const { t } = useTranslation();
  const [isConnectorPickerVisible, setIsConnectorPickerVisible] =
    useState(false);
  const [isConnectorFormVisible, setIsConnectorFormVisible] = useState(false);
  const [isEditingConnector, setIsEditingConnector] = useState(false);
  const [editingConnectorId, setEditingConnectorId] = useState<
    string | undefined
  >();
  const [browsedConnectorAssets, setBrowsedConnectorAssets] =
    useState<IOntologyBrowseConnectorAssetsResult | null>(null);
  const [isBrowsingConnector, setIsBrowsingConnector] = useState(false);
  const [deletingConnector, setDeletingConnector] =
    useState<IOntologyConnectorConfig | null>(null);
  const [isCascadeDeletingConnector, setIsCascadeDeletingConnector] =
    useState(false);
  const [isDeletingConnector, setIsDeletingConnector] = useState(false);
  const onlineCount = snapshot.connectors.filter(
    (connector) => connector.probeStatus === "reachable",
  ).length;
  const offlineCount = Math.max(snapshot.connectors.length - onlineCount, 0);
  const deletingConnectorAssetCount = deletingConnector
    ? snapshot.assets.filter(
        (asset) => asset.metadata.connectorId === deletingConnector.id,
      ).length
    : 0;
  const activeCategory =
    CONNECTOR_CATEGORY_OPTIONS.find((option) =>
      isConnectorSourceTypeInCategory(option.key, connectorSourceType),
    ) ?? CONNECTOR_CATEGORY_OPTIONS[0];
  const connectorTypeOptions = CONNECTOR_TYPE_OPTIONS_BY_CATEGORY[
    activeCategory.key
  ].filter(
    (type) => isEditingConnector || (type !== "oracle" && type !== "sqlserver"),
  );

  const onOpenCreateConnector = () => {
    onCreateConnector();
    setIsEditingConnector(false);
    setEditingConnectorId(undefined);
    setIsConnectorPickerVisible(true);
  };

  const onSelectConnectorCategory = (
    sourceType: OntologyConnectionSourceType,
  ) => {
    onConnectorSourceTypeChange(sourceType);
    setIsConnectorPickerVisible(false);
    setIsConnectorFormVisible(true);
  };

  const onOpenEditConnector = (connector: IOntologyConnectorConfig) => {
    onEditConnector(connector);
    setIsEditingConnector(true);
    setEditingConnectorId(connector.id);
    setIsConnectorFormVisible(true);
  };

  const onSubmitConnectorForm = async () => {
    const isSuccess = await onProbeConnector(editingConnectorId);
    if (isSuccess) {
      setIsConnectorFormVisible(false);
    }
  };

  const onOpenBrowseConnector = async (connector: IOntologyConnectorConfig) => {
    setIsBrowsingConnector(true);
    try {
      const result = await onBrowseConnectorAssets(connector);
      setBrowsedConnectorAssets(result);
    } catch (err) {
      showError(t, err);
    } finally {
      setIsBrowsingConnector(false);
    }
  };

  const onOpenDeleteConnector = (connector: IOntologyConnectorConfig) => {
    setDeletingConnector(connector);
    setIsCascadeDeletingConnector(false);
  };

  const onConfirmDeleteConnector = async () => {
    if (!deletingConnector) return;
    setIsDeletingConnector(true);
    try {
      await onDeleteConnector(deletingConnector, isCascadeDeletingConnector);
      setDeletingConnector(null);
    } finally {
      setIsDeletingConnector(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className={`${WORKBENCH_CARD_CLASS} p-5`}>
        <div className="flex flex-wrap items-center gap-6">
          <ConsoleStatistic
            icon={<Table2 size={22} />}
            title={t("ontology.console.stats.connectionTotal")}
            value={snapshot.connectors.length}
            iconClassName="text-[rgb(var(--primary-6))]"
          />
          <ConsoleStatistic
            icon={<CheckCircle2 size={22} />}
            title={t("ontology.console.stats.online")}
            value={onlineCount}
            valueClassName="text-[rgb(var(--success-6))]"
            iconClassName="text-[rgb(var(--success-6))]"
          />
          <ConsoleStatistic
            icon={<CircleX size={22} />}
            title={t("ontology.console.stats.offline")}
            value={offlineCount}
            valueClassName="text-[var(--color-text-3)]"
            iconClassName="text-[var(--color-text-3)]"
          />
          <span className="flex-1" />
          <Button
            type="primary"
            icon={<FilePlus2 size={16} />}
            onClick={onOpenCreateConnector}
          >
            {t("ontology.console.actions.newConnection")}
          </Button>
        </div>
      </div>

      <ConsoleToolbar
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        right={
          <SegmentedFilter
            value={connectionFilter}
            options={CONNECTION_FILTERS.map((filter) => ({
              value: filter,
              label:
                filter === "all"
                  ? t("ontology.console.filters.all")
                  : t(`ontology.assetKind.${filter}`),
            }))}
            onValueChange={(value) =>
              onConnectionFilterChange(value as "all" | OntologyAssetKind)
            }
          />
        }
      />

      <Table
        className="rounded bg-[var(--color-bg-1)] shadow-sm"
        size="middle"
        rowKey="id"
        data={connectors}
        pagination={{ pageSize: 20 }}
        scroll={{ x: 1260 }}
        columns={[
          {
            title: t("ontology.console.columns.name"),
            width: 220,
            ellipsis: true,
            render: (_: unknown, connector: IOntologyConnectorConfig) =>
              connectorDisplayName(connector),
          },
          {
            title: t("ontology.console.columns.category"),
            dataIndex: "kind",
            width: 130,
            render: (kind: OntologyAssetKind) => (
              <Tag color={assetKindColor(kind)}>
                {t(`ontology.assetKind.${kind}`)}
              </Tag>
            ),
          },
          {
            title: t("ontology.console.columns.type"),
            dataIndex: "sourceType",
            width: 130,
            render: (sourceType: OntologyConnectionSourceType) => (
              <Tag color="arcoblue">
                {t(`ontology.connectorType.${sourceType}`)}
              </Tag>
            ),
          },
          {
            title: t("ontology.console.columns.endpoint"),
            width: 280,
            render: (_: unknown, connector: IOntologyConnectorConfig) => (
              <code className="text-xs">{connectorEndpoint(connector)}</code>
            ),
          },
          {
            title: t("ontology.console.columns.permission"),
            width: 100,
            render: () => (
              <Tag>{t("ontology.console.permission.readonly")}</Tag>
            ),
          },
          {
            title: t("ontology.console.columns.status"),
            width: 130,
            render: (_: unknown, connector: IOntologyConnectorConfig) => (
              <ConnectorStatus connector={connector} />
            ),
          },
          {
            title: t("ontology.console.columns.actions"),
            width: 320,
            render: (_: unknown, connector: IOntologyConnectorConfig) => (
              <Space size={4} wrap>
                <Button
                  type="text"
                  size="small"
                  icon={<Link2 size={14} />}
                  loading={isScanningConnector}
                  onClick={() => void onProbeExistingConnector(connector)}
                >
                  {t("ontology.console.actions.test")}
                </Button>
                <Button
                  type="text"
                  size="small"
                  icon={<Table2 size={14} />}
                  loading={isBrowsingConnector}
                  onClick={() => void onOpenBrowseConnector(connector)}
                >
                  {t("ontology.console.actions.list")}
                </Button>
                <Button
                  type="text"
                  size="small"
                  onClick={() => onOpenEditConnector(connector)}
                >
                  {t("ontology.editor.edit")}
                </Button>
                <Button
                  type="text"
                  size="small"
                  status="danger"
                  icon={<Trash2 size={14} />}
                  onClick={() => onOpenDeleteConnector(connector)}
                >
                  {t("ontology.editor.delete")}
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        visible={browsedConnectorAssets !== null}
        title={t("ontology.connector.browserTitle", {
          name: browsedConnectorAssets
            ? connectorDisplayName(browsedConnectorAssets.connector)
            : "",
        })}
        footer={null}
        style={{ width: 760 }}
        onCancel={() => setBrowsedConnectorAssets(null)}
      >
        <Typography.Paragraph className="!mb-3" type="secondary">
          {t("ontology.connector.browserDescription")}
        </Typography.Paragraph>
        {browsedConnectorAssets?.assets.length ? (
          <div className="max-h-96 overflow-y-auto rounded border border-[var(--color-border-2)]">
            {browsedConnectorAssets.assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-3 border-b border-[var(--color-border-2)] px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <Typography.Text bold className="block truncate">
                    {asset.name}
                  </Typography.Text>
                  <Typography.Text
                    className="block truncate text-xs"
                    type="secondary"
                  >
                    {asset.path ?? asset.sourceName ?? "-"}
                  </Typography.Text>
                </div>
                <Tag color={assetKindColor(asset.kind)}>
                  {t(`ontology.assetKind.${asset.kind}`)}
                </Tag>
                <Typography.Text className="text-xs" type="secondary">
                  {t("ontology.console.fieldCount", {
                    count: asset.fields.length,
                  })}
                </Typography.Text>
              </div>
            ))}
          </div>
        ) : (
          <Empty description={t("ontology.connector.browserEmpty")} />
        )}
      </Modal>

      <Modal
        visible={deletingConnector !== null}
        title={t("ontology.connector.deleteTitle")}
        okText={t("ontology.editor.delete")}
        cancelText={t("ontology.reset.cancel")}
        confirmLoading={isDeletingConnector}
        okButtonProps={{
          status: "danger",
          disabled:
            deletingConnectorAssetCount > 0 && !isCascadeDeletingConnector,
        }}
        onOk={() => void onConfirmDeleteConnector()}
        onCancel={() => setDeletingConnector(null)}
      >
        <div className="flex flex-col gap-3">
          <Typography.Text>
            {t("ontology.connector.deleteContent", {
              name: deletingConnector?.name ?? "",
            })}
          </Typography.Text>
          {deletingConnectorAssetCount > 0 && (
            <div className="rounded bg-[var(--color-fill-2)] p-3">
              <Typography.Text className="block" type="secondary">
                {t("ontology.connector.cascadeDescription", {
                  count: deletingConnectorAssetCount,
                })}
              </Typography.Text>
              <Checkbox
                className="mt-2"
                checked={isCascadeDeletingConnector}
                onChange={setIsCascadeDeletingConnector}
              >
                {t("ontology.connector.cascadeAssets", {
                  count: deletingConnectorAssetCount,
                })}
              </Checkbox>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        visible={isConnectorPickerVisible}
        title={t("ontology.console.connectionPicker.title")}
        footer={null}
        style={{ width: 720 }}
        onCancel={() => setIsConnectorPickerVisible(false)}
      >
        <div className="mb-4 text-sm text-[var(--color-text-2)]">
          {t("ontology.console.connectionPicker.description")}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {CONNECTOR_CATEGORY_OPTIONS.map((category) => {
            const CategoryIcon = category.icon;
            return (
              <div
                key={category.key}
                role="button"
                tabIndex={0}
                className={`${WORKBENCH_INTERACTIVE_CARD_CLASS} cursor-pointer p-4`}
                onClick={() => onSelectConnectorCategory(category.sourceType)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectConnectorCategory(category.sourceType);
                  }
                }}
              >
                <div
                  className={`mb-3 flex h-10 w-10 items-center justify-center rounded ${category.colorClassName}`}
                >
                  <CategoryIcon size={20} className={category.iconClassName} />
                </div>
                <div className="text-base font-600 text-[var(--color-text-1)]">
                  {t(
                    `ontology.console.connectionPicker.categories.${category.key}.title`,
                  )}
                </div>
                <div className="mt-1 text-xs text-[var(--color-text-3)]">
                  {t(
                    `ontology.console.connectionPicker.categories.${category.key}.types`,
                  )}
                </div>
                <div className="mt-3 text-sm text-[var(--color-text-2)]">
                  {t(
                    `ontology.console.connectionPicker.categories.${category.key}.hint`,
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal
        visible={isConnectorFormVisible}
        title={
          isEditingConnector
            ? t("ontology.console.connectionForm.editTitle")
            : t("ontology.console.connectionForm.newTitle")
        }
        okText={t("ontology.connector.scan")}
        cancelText={t("ontology.reset.cancel")}
        confirmLoading={isScanningConnector}
        style={{ width: 680 }}
        onOk={() => void onSubmitConnectorForm()}
        onCancel={() => setIsConnectorFormVisible(false)}
      >
        <Form layout="vertical">
          <Form.Item label={t("ontology.console.connectionForm.name")}>
            <Input
              value={connectorNameValue}
              placeholder={t("ontology.connector.namePlaceholder")}
              onChange={onConnectorNameChange}
            />
          </Form.Item>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item label={t("ontology.console.connectionForm.category")}>
              <Input
                disabled
                value={t(
                  `ontology.console.connectionPicker.categories.${activeCategory.key}.title`,
                )}
              />
            </Form.Item>
            <Form.Item label={t("ontology.console.connectionForm.type")}>
              <Select
                value={connectorSourceType}
                onChange={(value) =>
                  onConnectorSourceTypeChange(
                    value as OntologyConnectionSourceType,
                  )
                }
              >
                {connectorTypeOptions.map((type) => (
                  <Option key={type} value={type}>
                    {t(`ontology.connectorType.${type}`)}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </div>
          <ConnectorTypeFields
            sourceType={connectorSourceType}
            values={connectorFormValues}
            onValueChange={onConnectorFormValueChange}
          />
        </Form>
      </Modal>
    </div>
  );
}

function ConnectorTypeFields({
  sourceType,
  values,
  onValueChange,
}: IConnectorTypeFieldsProps) {
  const { t } = useTranslation();
  const textValue = (key: string) => String(values[key] ?? "");
  const numberValue = (key: string) =>
    typeof values[key] === "number" ? (values[key] as number) : undefined;
  const boolValue = (key: string) => values[key] === true;

  const commonFields = (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Form.Item label={t("ontology.console.connectionForm.poolSize")}>
          <InputNumber
            className="w-full"
            min={1}
            max={32}
            value={numberValue("poolSize")}
            onChange={(value) => onValueChange("poolSize", Number(value || 1))}
          />
        </Form.Item>
        <Form.Item label={t("ontology.console.connectionForm.rateLimitQps")}>
          <InputNumber
            className="w-full"
            min={1}
            max={500}
            value={numberValue("rateLimitQps")}
            onChange={(value) =>
              onValueChange("rateLimitQps", Number(value || 1))
            }
          />
        </Form.Item>
      </div>
      <Form.Item label={t("ontology.console.connectionForm.description")}>
        <TextArea
          value={textValue("description")}
          autoSize={{ minRows: 2, maxRows: 4 }}
          onChange={(value) => onValueChange("description", value)}
        />
      </Form.Item>
    </>
  );

  if (
    sourceType === "mysql" ||
    sourceType === "postgresql" ||
    sourceType === "oracle" ||
    sourceType === "sqlserver"
  ) {
    return (
      <>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
          <Form.Item label={t("ontology.console.connectionForm.host")}>
            <Input
              value={textValue("host")}
              placeholder="127.0.0.1"
              onChange={(value) => onValueChange("host", value)}
            />
          </Form.Item>
          <Form.Item label={t("ontology.console.connectionForm.port")}>
            <InputNumber
              className="w-full"
              value={numberValue("port")}
              onChange={(value) => onValueChange("port", Number(value || 0))}
            />
          </Form.Item>
        </div>
        <Form.Item label={t("ontology.console.connectionForm.database")}>
          <Input
            value={textValue("database")}
            onChange={(value) => onValueChange("database", value)}
          />
        </Form.Item>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Form.Item label={t("ontology.console.connectionForm.username")}>
            <Input
              value={textValue("username")}
              onChange={(value) => onValueChange("username", value)}
            />
          </Form.Item>
          <Form.Item label={t("ontology.console.connectionForm.password")}>
            <Input.Password
              value={textValue("password")}
              onChange={(value) => onValueChange("password", value)}
            />
          </Form.Item>
        </div>
        <Form.Item label={t("ontology.console.connectionForm.writable")}>
          <Switch
            checked={boolValue("writable")}
            onChange={(checked) => onValueChange("writable", checked)}
          />
        </Form.Item>
        {commonFields}
      </>
    );
  }

  if (sourceType === "s3") {
    return (
      <>
        <Form.Item label={t("ontology.console.connectionForm.endpoint")}>
          <Input
            value={textValue("endpoint")}
            placeholder="https://s3.amazonaws.com"
            onChange={(value) => onValueChange("endpoint", value)}
          />
        </Form.Item>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Form.Item label={t("ontology.console.connectionForm.region")}>
            <Input
              value={textValue("region")}
              placeholder="us-east-1"
              onChange={(value) => onValueChange("region", value)}
            />
          </Form.Item>
          <Form.Item label={t("ontology.console.connectionForm.bucket")}>
            <Input
              value={textValue("bucket")}
              onChange={(value) => onValueChange("bucket", value)}
            />
          </Form.Item>
        </div>
        <Form.Item label={t("ontology.console.connectionForm.pathStyle")}>
          <Switch
            checked={boolValue("pathStyle")}
            onChange={(checked) => onValueChange("pathStyle", checked)}
          />
        </Form.Item>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Form.Item label={t("ontology.console.connectionForm.accessKey")}>
            <Input
              value={textValue("accessKey")}
              onChange={(value) => onValueChange("accessKey", value)}
            />
          </Form.Item>
          <Form.Item label={t("ontology.console.connectionForm.secretKey")}>
            <Input.Password
              value={textValue("secretKey")}
              onChange={(value) => onValueChange("secretKey", value)}
            />
          </Form.Item>
        </div>
        {commonFields}
      </>
    );
  }

  if (sourceType === "ftp" || sourceType === "sftp") {
    return (
      <>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
          <Form.Item label={t("ontology.console.connectionForm.host")}>
            <Input
              value={textValue("host")}
              onChange={(value) => onValueChange("host", value)}
            />
          </Form.Item>
          <Form.Item label={t("ontology.console.connectionForm.port")}>
            <InputNumber
              className="w-full"
              value={numberValue("port")}
              placeholder={sourceType === "sftp" ? "22" : "21"}
              onChange={(value) => onValueChange("port", Number(value || 0))}
            />
          </Form.Item>
        </div>
        <Form.Item label={t("ontology.console.connectionForm.rootPath")}>
          <Input
            value={textValue("rootPath")}
            placeholder="/"
            onChange={(value) => onValueChange("rootPath", value)}
          />
        </Form.Item>
        {sourceType === "ftp" && (
          <Form.Item label={t("ontology.console.connectionForm.useTls")}>
            <Switch
              checked={boolValue("useTls")}
              onChange={(checked) => onValueChange("useTls", checked)}
            />
          </Form.Item>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Form.Item label={t("ontology.console.connectionForm.username")}>
            <Input
              value={textValue("username")}
              placeholder="anonymous"
              onChange={(value) => onValueChange("username", value)}
            />
          </Form.Item>
          <Form.Item label={t("ontology.console.connectionForm.password")}>
            <Input.Password
              value={textValue("password")}
              onChange={(value) => onValueChange("password", value)}
            />
          </Form.Item>
        </div>
        {commonFields}
      </>
    );
  }

  if (sourceType === "kafka") {
    const securityProtocol = textValue("securityProtocol") || "PLAINTEXT";
    return (
      <>
        <Form.Item label={t("ontology.console.connectionForm.brokers")}>
          <Input
            value={textValue("brokers")}
            placeholder="host1:9092,host2:9092"
            onChange={(value) => onValueChange("brokers", value)}
          />
        </Form.Item>
        <Form.Item
          label={t("ontology.console.connectionForm.securityProtocol")}
        >
          <Select
            value={securityProtocol}
            onChange={(value) =>
              onValueChange("securityProtocol", String(value))
            }
          >
            {KAFKA_SECURITY_OPTIONS.map((option) => (
              <Option key={option} value={option}>
                {option}
              </Option>
            ))}
          </Select>
        </Form.Item>
        {securityProtocol !== "PLAINTEXT" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item
              label={t("ontology.console.connectionForm.saslUsername")}
            >
              <Input
                value={textValue("username")}
                onChange={(value) => onValueChange("username", value)}
              />
            </Form.Item>
            <Form.Item
              label={t("ontology.console.connectionForm.saslPassword")}
            >
              <Input.Password
                value={textValue("password")}
                onChange={(value) => onValueChange("password", value)}
              />
            </Form.Item>
          </div>
        )}
        {commonFields}
      </>
    );
  }

  if (sourceType === "rest") {
    const authType = textValue("authType") || "none";
    return (
      <>
        <Form.Item label={t("ontology.console.connectionForm.baseUrl")}>
          <Input
            value={textValue("baseUrl")}
            placeholder="https://api.example.com/v1"
            onChange={(value) => onValueChange("baseUrl", value)}
          />
        </Form.Item>
        <Form.Item label={t("ontology.console.connectionForm.probePath")}>
          <Input
            value={textValue("probePath")}
            placeholder="/health"
            onChange={(value) => onValueChange("probePath", value)}
          />
        </Form.Item>
        <Form.Item label={t("ontology.console.connectionForm.authType")}>
          <Select
            value={authType}
            onChange={(value) => onValueChange("authType", String(value))}
          >
            {API_AUTH_OPTIONS.map((option) => (
              <Option key={option} value={option}>
                {t(`ontology.connectorAuthType.${option}`)}
              </Option>
            ))}
          </Select>
        </Form.Item>
        {authType === "bearer" && (
          <Form.Item label={t("ontology.console.connectionForm.bearerToken")}>
            <Input.Password
              value={textValue("token")}
              onChange={(value) => onValueChange("token", value)}
            />
          </Form.Item>
        )}
        {authType === "basic" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item label={t("ontology.console.connectionForm.username")}>
              <Input
                value={textValue("username")}
                onChange={(value) => onValueChange("username", value)}
              />
            </Form.Item>
            <Form.Item label={t("ontology.console.connectionForm.password")}>
              <Input.Password
                value={textValue("password")}
                onChange={(value) => onValueChange("password", value)}
              />
            </Form.Item>
          </div>
        )}
        {authType === "api_key" && (
          <>
            <Form.Item label={t("ontology.console.connectionForm.apiKeyName")}>
              <Input
                value={textValue("apiKeyName")}
                placeholder="X-API-Key"
                onChange={(value) => onValueChange("apiKeyName", value)}
              />
            </Form.Item>
            <Form.Item label={t("ontology.console.connectionForm.apiKeyValue")}>
              <Input.Password
                value={textValue("apiKeyValue")}
                onChange={(value) => onValueChange("apiKeyValue", value)}
              />
            </Form.Item>
          </>
        )}
        {commonFields}
      </>
    );
  }

  return null;
}

function AssetsPage({
  snapshot,
  assets,
  searchValue,
  assetCategoryFilter,
  assetViewMode,
  profilingAssetId,
  syncingAssetId,
  onSearchChange,
  onAssetCategoryFilterChange,
  onAssetViewModeChange,
  onProfileAsset,
  onSyncAssetSchema,
  onDeleteAsset,
  onPreviewAsset,
}: IAssetsPageProps) {
  const { t } = useTranslation();
  const [detailAsset, setDetailAsset] =
    useState<IOntologyEnvironmentAsset | null>(null);
  const currentDetailAsset = useMemo(
    () =>
      detailAsset
        ? (snapshot.assets.find((asset) => asset.id === detailAsset.id) ??
          detailAsset)
        : null,
    [detailAsset, snapshot.assets],
  );
  const structuredCount = snapshot.assets.filter(
    (asset) =>
      asset.kind === "database" ||
      asset.kind === "schema" ||
      asset.kind === "table",
  ).length;
  const unstructuredCount = snapshot.assets.length - structuredCount;
  return (
    <div className="flex flex-col gap-4">
      <div className={`${WORKBENCH_CARD_CLASS} p-5`}>
        <div className="flex flex-wrap items-center gap-6">
          <ConsoleStatistic
            title={t("ontology.console.stats.assetTotal")}
            value={snapshot.assets.length}
          />
          <ConsoleStatistic
            title={t("ontology.console.stats.structured")}
            value={structuredCount}
            valueClassName="text-[rgb(var(--primary-6))]"
          />
          <ConsoleStatistic
            title={t("ontology.console.stats.unstructured")}
            value={unstructuredCount}
            valueClassName="text-[rgb(var(--warning-6))]"
          />
        </div>
      </div>

      <ConsoleToolbar
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        right={
          <Space wrap>
            <SegmentedFilter
              value={assetCategoryFilter}
              options={ASSET_CATEGORY_FILTERS.map((filter) => ({
                value: filter,
                label: t(`ontology.console.filters.${filter}`),
              }))}
              onValueChange={(value) =>
                onAssetCategoryFilterChange(value as AssetCategoryFilter)
              }
            />
            <SegmentedFilter
              value={assetViewMode}
              options={[
                { value: "grid", label: t("ontology.console.viewMode.grid") },
                { value: "list", label: t("ontology.console.viewMode.list") },
              ]}
              onValueChange={(value) =>
                onAssetViewModeChange(value as "grid" | "list")
              }
            />
          </Space>
        }
      />

      {assetViewMode === "grid" ? (
        <AssetGrid
          assets={assets}
          profilingAssetId={profilingAssetId}
          syncingAssetId={syncingAssetId}
          onOpenAsset={setDetailAsset}
          onProfileAsset={onProfileAsset}
          onSyncAssetSchema={onSyncAssetSchema}
          onDeleteAsset={onDeleteAsset}
        />
      ) : (
        <AssetCatalogTable
          assets={assets}
          profilingAssetId={profilingAssetId}
          syncingAssetId={syncingAssetId}
          onOpenAsset={setDetailAsset}
          onProfileAsset={onProfileAsset}
          onSyncAssetSchema={onSyncAssetSchema}
          onDeleteAsset={onDeleteAsset}
        />
      )}

      <AssetDetailModal
        asset={currentDetailAsset}
        profilingAssetId={profilingAssetId}
        syncingAssetId={syncingAssetId}
        onProfileAsset={onProfileAsset}
        onSyncAssetSchema={onSyncAssetSchema}
        onPreviewAsset={onPreviewAsset}
        onClose={() => setDetailAsset(null)}
      />
    </div>
  );
}

function OntologyModelPage(props: IOntologyModelPageProps) {
  if (props.isDetailVisible) return <OntologyDetailPage {...props} />;

  const {
    snapshot,
    workbenches,
    onCreateOntology,
    onSelectOntology,
    onDeleteOntology,
  } = props;
  const { t } = useTranslation();
  const [ontologySearchValue, setOntologySearchValue] = useState("");
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [createNameValue, setCreateNameValue] = useState("");
  const [createCodeValue, setCreateCodeValue] = useState("");
  const [createDescriptionValue, setCreateDescriptionValue] = useState("");

  const ontologyCards = useMemo(
    () => buildOntologyCards(workbenches, t),
    [t, workbenches],
  );
  const filteredOntologyCards = useMemo(() => {
    const keyword = ontologySearchValue.trim().toLowerCase();
    if (!keyword) return ontologyCards;
    return ontologyCards.filter((card) =>
      [card.name, card.code, card.description].some((value) =>
        value.toLowerCase().includes(keyword),
      ),
    );
  }, [ontologyCards, ontologySearchValue]);

  const onOpenCreateModal = () => {
    setCreateNameValue("");
    setCreateCodeValue("");
    setCreateDescriptionValue("");
    setIsCreateModalVisible(true);
  };

  const onConfirmCreate = async () => {
    try {
      await onCreateOntology({
        name: createNameValue.trim(),
        code: createCodeValue.trim(),
        description: createDescriptionValue.trim(),
        businessGoal: createDescriptionValue.trim(),
      });
      setIsCreateModalVisible(false);
    } catch (err) {
      showError(t, err);
      throw err;
    }
  };

  const onConfirmDeleteOntology = (card: IOntologyListCard) => {
    Modal.confirm({
      title: t("ontology.list.deleteTitle"),
      content: t("ontology.list.deleteContent", { name: card.name }),
      okText: t("ontology.editor.delete"),
      cancelText: t("ontology.reset.cancel"),
      okButtonProps: { status: "danger" },
      onOk: async () => {
        try {
          await onDeleteOntology(card.id);
        } catch (err) {
          showError(t, err);
          throw err;
        }
      },
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Typography.Title heading={3} className="!mb-2">
            {t("ontology.list.title")}
          </Typography.Title>
          <Typography.Text className="text-sm" type="secondary">
            {t("ontology.list.description")}
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<FilePlus2 size={16} />}
          onClick={onOpenCreateModal}
        >
          {t("ontology.list.newOntology")}
        </Button>
      </section>

      <div className="max-w-sm">
        <Input.Search
          value={ontologySearchValue}
          allowClear
          onChange={setOntologySearchValue}
        />
      </div>

      {filteredOntologyCards.length === 0 ? (
        <Empty
          className="rounded bg-[var(--color-bg-1)] py-16"
          description={t("ontology.list.empty")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {filteredOntologyCards.map((card) => (
            <div
              key={card.id}
              role="button"
              tabIndex={0}
              className={`${WORKBENCH_INTERACTIVE_CARD_CLASS} flex min-h-64 cursor-pointer flex-col p-5`}
              onClick={() => void onSelectOntology(card.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void onSelectOntology(card.id);
                }
              }}
            >
              <div className="mb-4 flex flex-wrap items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--primary-2))] bg-[rgb(var(--primary-1))] text-[rgb(var(--primary-6))]">
                  <Network size={23} />
                </div>
                <div className="min-w-0 flex-1 basis-40">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-24">
                      <Typography.Text
                        bold
                        className="block truncate text-size-base"
                      >
                        {card.name}
                      </Typography.Text>
                      <Typography.Text
                        className="mt-1 block truncate text-xs"
                        type="secondary"
                      >
                        {card.code}
                      </Typography.Text>
                    </div>
                    <Space className="shrink-0" size={4}>
                      <Tag color="green">{t("ontology.list.built")}</Tag>
                    </Space>
                  </div>
                </div>
              </div>

              <Typography.Paragraph
                className="!mb-4 min-h-10 text-sm leading-6"
                type="secondary"
                ellipsis={{ rows: 2 }}
              >
                {card.description || t("ontology.list.noDescription")}
              </Typography.Paragraph>

              <div className="mb-4 grid grid-cols-4 divide-x divide-[var(--color-border-1)] rounded-lg bg-[var(--color-fill-1)] px-2 py-3">
                <ResourceCardStatistic
                  label={t("ontology.stats.objects")}
                  value={card.objects}
                />
                <ResourceCardStatistic
                  label={t("ontology.stats.relations")}
                  value={card.relations}
                />
                <ResourceCardStatistic
                  label={t("ontology.runtime.functions")}
                  value={card.logic}
                />
                <ResourceCardStatistic
                  label={t("ontology.publishConsole.actions")}
                  value={card.actions}
                />
              </div>

              <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--color-border-2)] pt-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex shrink-0 items-center gap-2 text-sm text-[rgb(var(--success-6))]">
                    <span className="size-2 rounded-full bg-[rgb(var(--success-6))]" />
                    {t("ontology.list.enabled")}
                  </span>
                  <Typography.Text
                    className="truncate text-xs"
                    type="secondary"
                  >
                    {t("ontology.list.updated")}{" "}
                    {formatOntologyShortDate(card.updatedAt)}
                  </Typography.Text>
                </div>
                <Space size={4}>
                  <Button
                    type="text"
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onSelectOntology(card.id);
                    }}
                  >
                    {t("ontology.list.detail")}
                  </Button>
                  <Button
                    type="text"
                    size="mini"
                    status="danger"
                    icon={<Trash2 size={13} />}
                    onClick={(event) => {
                      event.stopPropagation();
                      onConfirmDeleteOntology(card);
                    }}
                  />
                </Space>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        visible={isCreateModalVisible}
        title={t("ontology.list.createTitle")}
        okText={t("ontology.list.confirmBuild")}
        cancelText={t("ontology.reset.cancel")}
        onOk={onConfirmCreate}
        okButtonProps={{ disabled: createNameValue.trim().length === 0 }}
        onCancel={() => setIsCreateModalVisible(false)}
      >
        <div>
          <Typography.Text bold>{t("ontology.list.basicInfo")}</Typography.Text>
          <Form className="mt-4" layout="vertical">
            <Form.Item label={t("ontology.list.nameLabel")} required>
              <Input
                value={createNameValue}
                placeholder={t("ontology.list.namePlaceholder")}
                onChange={setCreateNameValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.list.codeLabel")}>
              <Input
                value={createCodeValue}
                placeholder={t("ontology.list.codePlaceholder")}
                onChange={setCreateCodeValue}
              />
            </Form.Item>
            <Form.Item label={t("ontology.list.descriptionLabel")}>
              <TextArea
                value={createDescriptionValue}
                autoSize={{ minRows: 4, maxRows: 8 }}
                placeholder={t("ontology.list.descriptionPlaceholder")}
                onChange={setCreateDescriptionValue}
              />
            </Form.Item>
            <Typography.Text className="-mt-3 block text-xs" type="secondary">
              {t("ontology.list.characterCount", {
                count: createDescriptionValue.length,
              })}
            </Typography.Text>
          </Form>
        </div>
      </Modal>
    </div>
  );
}

type OntologyDetailTab =
  | "overview"
  | "objects"
  | "relations"
  | "graph"
  | "mapping"
  | "runtime"
  | "history";

function OntologyDetailPage({
  snapshot,
  workbenches,
  objects,
  searchValue,
  isGenerating,
  isApproving,
  isEditingModel,
  onSearchChange,
  onGenerateDraft,
  onImportObjectBuildFiles,
  consistencyCheck,
  isChecking,
  onRunConsistencyCheck,
  onOpenObjectModal,
  onOpenRelationModal,
  onOpenMappingModal,
  onOpenRuleModal,
  onReviewTarget,
  onApproveAll,
  onCompletePhase,
  onUpdateObject,
  onEditObject,
  onDeleteObject,
  onDeleteObjects,
  onActivateObjects,
  onEditAttribute,
  onDeleteAttribute,
  onEditRelation,
  onDeleteRelation,
  onEditMapping,
  onDeleteMapping,
  onEditRule,
  onDeleteRule,
  onUpsertLogicFunction,
  onDeleteLogicFunction,
  onUpsertAction,
  onDeleteAction,
  onBackToList,
  onOpenPublish,
}: IOntologyModelPageProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<OntologyDetailTab>("overview");
  const [isObjectBuildMenuVisible, setIsObjectBuildMenuVisible] =
    useState(false);
  const [isManualBuilderVisible, setIsManualBuilderVisible] = useState(false);
  const [manualObjectId, setManualObjectId] = useState<string | null>(null);
  const [manualBaselineObjectIds, setManualBaselineObjectIds] = useState<
    string[]
  >([]);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [guidedBuildMethod, setGuidedBuildMethod] = useState<Exclude<
    ObjectBuildMethod,
    "manual"
  > | null>(null);
  const tabs: Array<{ key: OntologyDetailTab; label: string; count?: number }> =
    [
      { key: "overview", label: t("ontology.detail.tabs.overview") },
      {
        key: "objects",
        label: t("ontology.detail.tabs.objects"),
        count: snapshot.objects.length,
      },
      {
        key: "relations",
        label: t("ontology.detail.tabs.relations"),
        count: snapshot.relations.length,
      },
      { key: "graph", label: t("ontology.detail.tabs.graph") },
      {
        key: "mapping",
        label: t("ontology.detail.tabs.mapping"),
        count: snapshot.mappings.length,
      },
      {
        key: "runtime",
        label: t("ontology.detail.tabs.runtime"),
        count: snapshot.logicFunctions.length + snapshot.actions.length,
      },
      {
        key: "history",
        label: t("ontology.detail.tabs.history"),
        count: snapshot.reviewItems.length,
      },
    ];

  const onSelectObjectBuildMethod = (method: ObjectBuildMethod) => {
    setIsObjectBuildMenuVisible(false);
    if (method === "manual") {
      setManualBaselineObjectIds(snapshot.objects.map((object) => object.id));
      setManualObjectId(null);
      setIsManualBuilderVisible(true);
      return;
    }
    setGuidedBuildMethod(method);
  };

  useEffect(() => {
    const objectIds = new Set(snapshot.objects.map((object) => object.id));
    setSelectedObjectIds((ids) => ids.filter((id) => objectIds.has(id)));
  }, [snapshot.objects]);

  const onToggleAllObjects = (isChecked: boolean) => {
    setSelectedObjectIds(isChecked ? objects.map((object) => object.id) : []);
  };

  const onToggleObject = (objectId: string, isChecked: boolean) => {
    setSelectedObjectIds((ids) =>
      isChecked
        ? Array.from(new Set([...ids, objectId]))
        : ids.filter((id) => id !== objectId),
    );
  };

  const onBatchDeleteObjects = () => {
    const selectedObjects = snapshot.objects.filter((object) =>
      selectedObjectIds.includes(object.id),
    );
    if (selectedObjects.length === 0) return;
    Modal.confirm({
      title: t("ontology.objectBuilder.batchDeleteTitle"),
      content: t("ontology.objectBuilder.batchDeleteContent", {
        count: selectedObjects.length,
      }),
      okText: t("ontology.editor.delete"),
      cancelText: t("ontology.reset.cancel"),
      okButtonProps: { status: "danger" },
      onOk: async () => {
        if (await onDeleteObjects(selectedObjects)) setSelectedObjectIds([]);
      },
    });
  };

  const onBatchActivateObjects = async () => {
    const selectedObjects = snapshot.objects.filter((object) =>
      selectedObjectIds.includes(object.id),
    );
    if (selectedObjects.length === 0) return;
    if (await onActivateObjects(selectedObjects)) setSelectedObjectIds([]);
  };

  const onBatchExportObjects = () => {
    const selectedIdSet = new Set(selectedObjectIds);
    const selectedObjects = snapshot.objects.filter((object) =>
      selectedIdSet.has(object.id),
    );
    if (selectedObjects.length === 0) return;
    downloadJsonFile(
      `${ontologyCodeFromTitle(snapshot.draft.title, snapshot.workspaceId)}-objects.json`,
      {
        objects: selectedObjects,
        relations: snapshot.relations.filter(
          (relation) =>
            selectedIdSet.has(relation.fromObjectId) &&
            selectedIdSet.has(relation.toObjectId),
        ),
      },
    );
    Message.success(
      t("ontology.objectBuilder.exported", { count: selectedObjects.length }),
    );
  };

  const objectBuildMenu = (
    <div
      role="menu"
      className="grid w-72 grid-cols-2 gap-1 rounded-lg border border-[var(--color-border-2)] bg-[var(--color-bg-1)] p-2 shadow-lg"
    >
      <Button
        type="text"
        className="!h-24 !w-full !p-0"
        onClick={() => onSelectObjectBuildMethod("manual")}
      >
        <ObjectBuildMethodOption
          icon={<Wrench size={22} />}
          title={t("ontology.objectBuilder.manual")}
        />
      </Button>
      <Button
        type="text"
        className="!h-24 !w-full !p-0"
        onClick={() => onSelectObjectBuildMethod("template")}
      >
        <ObjectBuildMethodOption
          icon={<ClipboardList size={22} />}
          title={t("ontology.objectBuilder.template")}
        />
      </Button>
      <Button
        type="text"
        className="!h-24 !w-full !p-0"
        onClick={() => onSelectObjectBuildMethod("document")}
      >
        <ObjectBuildMethodOption
          icon={<FileText size={22} />}
          title={t("ontology.objectBuilder.document")}
        />
      </Button>
      <Button
        type="text"
        className="!h-24 !w-full !p-0"
        onClick={() => onSelectObjectBuildMethod("asset")}
      >
        <ObjectBuildMethodOption
          icon={<Database size={22} />}
          title={t("ontology.objectBuilder.asset")}
        />
      </Button>
    </div>
  );
  const isAllVisibleObjectsSelected =
    objects.length > 0 &&
    objects.every((object) => selectedObjectIds.includes(object.id));
  const objectBatchMenu = (
    <Menu>
      <Menu.Item
        key="activate"
        disabled={selectedObjectIds.length === 0}
        onClick={() => void onBatchActivateObjects()}
      >
        {t("ontology.objectBuilder.batchActivate")}
      </Menu.Item>
      <Menu.Item
        key="export"
        disabled={selectedObjectIds.length === 0}
        onClick={onBatchExportObjects}
      >
        {t("ontology.objectBuilder.batchExport")}
      </Menu.Item>
      <Menu.Item
        key="delete"
        disabled={selectedObjectIds.length === 0}
        onClick={onBatchDeleteObjects}
      >
        <span className="text-[rgb(var(--danger-6))]">
          {t("ontology.objectBuilder.batchDelete")}
        </span>
      </Menu.Item>
    </Menu>
  );

  if (isManualBuilderVisible) {
    return (
      <ManualObjectBuilder
        snapshot={snapshot}
        baselineObjectIds={manualBaselineObjectIds}
        selectedObjectId={manualObjectId}
        isEditingModel={isEditingModel}
        consistencyCheck={consistencyCheck}
        isChecking={isChecking}
        onSelectedObjectChange={setManualObjectId}
        onAddObject={() => onOpenObjectModal()}
        onUpdateObject={onUpdateObject}
        onEditObject={onEditObject}
        onDeleteObject={onDeleteObject}
        onEditAttribute={onEditAttribute}
        onDeleteAttribute={onDeleteAttribute}
        onAddRelation={(objectIds) => onOpenRelationModal(undefined, objectIds)}
        onEditRelation={(relation, objectIds) =>
          onOpenRelationModal(relation, objectIds)
        }
        onDeleteRelation={onDeleteRelation}
        onReviewTarget={onReviewTarget}
        onAddMapping={() => onOpenMappingModal()}
        onEditMapping={onEditMapping}
        onDeleteMapping={onDeleteMapping}
        onBack={() => {
          setIsManualBuilderVisible(false);
          setManualBaselineObjectIds([]);
          setManualObjectId(null);
        }}
        onCompleteModeling={() => onCompletePhase("generate")}
        onCompleteReview={() => onCompletePhase("review")}
        onRunConsistencyCheck={onRunConsistencyCheck}
        onOpenPublish={onOpenPublish}
      />
    );
  }

  if (guidedBuildMethod) {
    return (
      <GuidedObjectBuilder
        key={`${snapshot.workspaceId}:${guidedBuildMethod}`}
        method={guidedBuildMethod}
        snapshot={snapshot}
        isGenerating={isGenerating}
        isApproving={isApproving}
        isChecking={isChecking}
        consistencyCheck={consistencyCheck}
        onImportFiles={onImportObjectBuildFiles}
        onGenerateDraft={onGenerateDraft}
        onReviewTarget={onReviewTarget}
        onEditObject={onEditObject}
        onEditRelation={onEditRelation}
        onAddMapping={() => onOpenMappingModal()}
        onEditMapping={onEditMapping}
        onDeleteMapping={onDeleteMapping}
        onApproveAll={onApproveAll}
        onRunConsistencyCheck={onRunConsistencyCheck}
        onOpenPublish={onOpenPublish}
        onBack={() => setGuidedBuildMethod(null)}
        onFinish={() => {
          setGuidedBuildMethod(null);
          setActiveTab("objects");
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-2)] pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="text"
            icon={<ArrowLeft size={16} />}
            onClick={onBackToList}
          >
            {t("ontology.detail.back")}
          </Button>
          <div className="min-w-0">
            <Typography.Title heading={5} className="!mb-0 truncate">
              {snapshot.draft.title || snapshot.workspaceId}
            </Typography.Title>
            <Typography.Text
              className="block truncate text-xs"
              type="secondary"
            >
              {snapshot.workspaceId}
            </Typography.Text>
          </div>
        </div>
        <Space wrap>
          <Button
            type="primary"
            icon={<Rocket size={15} />}
            onClick={onOpenPublish}
          >
            {t("ontology.detail.publish")}
          </Button>
        </Space>
      </div>

      <div className="flex min-h-[560px] gap-5">
        <nav
          className="w-44 shrink-0 border-r border-[var(--color-border-2)] pr-3"
          aria-label={t("ontology.detail.navigation")}
        >
          <div className="flex flex-col gap-1">
            {tabs.map((tab) => (
              <Button
                key={tab.key}
                type="text"
                className={`!flex !h-9 !justify-between !px-3 ${activeTab === tab.key ? "!bg-[rgb(var(--primary-1))] !text-[rgb(var(--primary-6))]" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="text-xs text-[var(--color-text-3)]">
                    {tab.count}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          {activeTab === "overview" && (
            <div className="flex flex-col gap-4">
              <div>
                <Typography.Title heading={5} className="!mb-1">
                  {t("ontology.overview.title")}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {t("ontology.overview.summary", {
                    name: snapshot.draft.title || snapshot.workspaceId,
                  })}
                </Typography.Text>
              </div>

              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <MiniMetric
                  label={t("ontology.stats.objects")}
                  value={snapshot.stats.objectCount}
                />
                <MiniMetric
                  label={t("ontology.stats.relations")}
                  value={snapshot.stats.relationCount}
                />
                <MiniMetric
                  label={t("ontology.runtime.functions")}
                  value={snapshot.stats.logicFunctionCount}
                />
                <MiniMetric
                  label={t("ontology.publishConsole.actions")}
                  value={snapshot.stats.actionCount}
                />
              </div>

              <section className={`${WORKBENCH_CARD_CLASS} p-5`}>
                <Typography.Text bold className="mb-5 block">
                  {t("ontology.overview.basicInfo")}
                </Typography.Text>
                <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
                  <LabeledValue
                    label={t("ontology.overview.displayName")}
                    value={snapshot.draft.title || "-"}
                  />
                  <LabeledValue
                    label={t("ontology.overview.code")}
                    value={snapshot.workspaceId}
                  />
                  <div>
                    <Typography.Text
                      className="mb-1 block text-xs"
                      type="secondary"
                    >
                      {t("ontology.overview.status")}
                    </Typography.Text>
                    <Tag color="green">{t("ontology.list.enabled")}</Tag>
                  </div>
                  <LabeledValue
                    label={t("ontology.overview.createdAt")}
                    value={formatOntologyShortDate(
                      workbenches.find(
                        (workbench) =>
                          workbench.workspaceId === snapshot.workspaceId,
                      )?.createdAt ?? snapshot.updatedAt,
                    )}
                  />
                  <div className="md:col-span-2">
                    <LabeledValue
                      label={t("ontology.overview.description")}
                      value={
                        snapshot.draft.description ||
                        t("ontology.list.noDescription")
                      }
                    />
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <section className={`${WORKBENCH_CARD_CLASS} p-5`}>
                  <Typography.Text bold className="mb-4 block">
                    {t("ontology.overview.objects", {
                      count: snapshot.objects.length,
                    })}
                  </Typography.Text>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    data={snapshot.objects.slice(0, 5)}
                    noDataElement={
                      <Empty
                        description={t("ontology.generate.emptyObjects")}
                      />
                    }
                    columns={[
                      {
                        title: t("ontology.editor.code"),
                        dataIndex: "code",
                        ellipsis: true,
                      },
                      {
                        title: t("ontology.editor.name"),
                        dataIndex: "name",
                        ellipsis: true,
                      },
                      {
                        title: t("ontology.generate.columns.attributes"),
                        width: 100,
                        render: (_: unknown, object: IOntologyObjectDraft) =>
                          object.attributes.length,
                      },
                    ]}
                  />
                </section>
                <section className={`${WORKBENCH_CARD_CLASS} p-5`}>
                  <Typography.Text bold className="mb-4 block">
                    {t("ontology.overview.logic", {
                      count: snapshot.logicFunctions.length,
                    })}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {t("ontology.overview.logicHint")}
                  </Typography.Text>
                </section>
              </div>
            </div>
          )}

          {activeTab === "objects" && (
            <Panel
              title={t("ontology.objectBuilder.objectsTitle", {
                count: objects.length,
              })}
              description={t("ontology.objectBuilder.objectsDescription")}
              icon={<ListTree size={18} />}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input.Search
                  className="max-w-sm"
                  value={searchValue}
                  allowClear
                  onChange={onSearchChange}
                />
                <span className="flex-1" />
                <Dropdown
                  trigger="click"
                  position="br"
                  droplist={objectBatchMenu}
                >
                  <Button disabled={selectedObjectIds.length === 0}>
                    {t("ontology.objectBuilder.batchActions")}
                    <ChevronDown size={14} />
                  </Button>
                </Dropdown>
                <Dropdown
                  trigger="click"
                  position="br"
                  popupVisible={isObjectBuildMenuVisible}
                  droplist={objectBuildMenu}
                  onVisibleChange={setIsObjectBuildMenuVisible}
                >
                  <Button
                    type="primary"
                    icon={<FilePlus2 size={14} />}
                    loading={isGenerating}
                  >
                    {t("ontology.editor.addObject")}
                    <ChevronDown size={14} />
                  </Button>
                </Dropdown>
              </div>
              <ObjectTable
                objects={objects}
                selectedObjectIds={selectedObjectIds}
                isAllSelected={isAllVisibleObjectsSelected}
                onToggleAll={onToggleAllObjects}
                onToggleObject={onToggleObject}
                onEditObject={onEditObject}
                onDeleteObject={onDeleteObject}
              />
            </Panel>
          )}

          {activeTab === "relations" && (
            <Panel
              title={t("ontology.detail.tabs.relations")}
              description={t("ontology.generate.description")}
              icon={<Link2 size={18} />}
            >
              <div className="mb-3 flex justify-end">
                <Button
                  type="primary"
                  icon={<FilePlus2 size={14} />}
                  disabled={snapshot.objects.length === 0}
                  onClick={() => onOpenRelationModal()}
                >
                  {t("ontology.editor.addRelation")}
                </Button>
              </div>
              <RelationTable
                relations={snapshot.relations}
                objects={snapshot.objects}
                onEditRelation={onEditRelation}
                onDeleteRelation={onDeleteRelation}
              />
            </Panel>
          )}

          {activeTab === "graph" && (
            <Panel
              title={t("ontology.detail.tabs.graph")}
              description={t("ontology.detail.graphDescription")}
              icon={<Network size={18} />}
            >
              <OntologyGraph
                objects={snapshot.objects}
                relations={snapshot.relations}
              />
            </Panel>
          )}

          {activeTab === "mapping" && (
            <div className="flex flex-col gap-4">
              <Panel
                title={t("ontology.mapping.mappings")}
                description={t("ontology.mapping.description")}
                icon={<Cable size={18} />}
              >
                <div className="mb-3 flex justify-end">
                  <Button
                    type="primary"
                    icon={<FilePlus2 size={14} />}
                    disabled={
                      snapshot.objects.length === 0 ||
                      snapshot.assets.length === 0
                    }
                    onClick={() => onOpenMappingModal()}
                  >
                    {t("ontology.editor.addMapping")}
                  </Button>
                </div>
                <MappingTable
                  mappings={snapshot.mappings}
                  objects={snapshot.objects}
                  assets={snapshot.assets}
                  onEditMapping={onEditMapping}
                  onDeleteMapping={onDeleteMapping}
                />
              </Panel>
              <Panel
                title={t("ontology.mapping.qualityRules")}
                description={t("ontology.mapping.description")}
                icon={<ShieldCheck size={18} />}
              >
                <div className="mb-3 flex justify-end">
                  <Button
                    type="primary"
                    icon={<FilePlus2 size={14} />}
                    disabled={snapshot.objects.length === 0}
                    onClick={() => onOpenRuleModal()}
                  >
                    {t("ontology.editor.addRule")}
                  </Button>
                </div>
                {snapshot.qualityRules.length === 0 ? (
                  <Empty description={t("ontology.detail.emptyQualityRules")} />
                ) : (
                  <QualityRuleList
                    rules={snapshot.qualityRules}
                    objects={snapshot.objects}
                    onEditRule={onEditRule}
                    onDeleteRule={onDeleteRule}
                  />
                )}
              </Panel>
            </div>
          )}

          {activeTab === "runtime" && (
            <Panel
              title={t("ontology.runtime.title")}
              description={t("ontology.runtime.description")}
              icon={<Wrench size={18} />}
            >
              <RuntimeArtifacts
                documents={snapshot.businessDocuments}
                functions={snapshot.logicFunctions}
                actions={snapshot.actions}
                endpoints={snapshot.serviceEndpoints}
                objects={snapshot.objects}
                stats={snapshot.stats}
                onUpsertLogicFunction={onUpsertLogicFunction}
                onDeleteLogicFunction={onDeleteLogicFunction}
                onUpsertAction={onUpsertAction}
                onDeleteAction={onDeleteAction}
              />
            </Panel>
          )}

          {activeTab === "history" && (
            <div className="flex flex-col gap-4">
              <Panel
                title={t("ontology.review.title")}
                description={t("ontology.review.description")}
                icon={<ShieldCheck size={18} />}
              >
                <ReviewLog count={snapshot.reviewItems.length} />
              </Panel>
              <Panel
                title={t("ontology.monitor.title")}
                description={t("ontology.monitor.description")}
                icon={<Bell size={18} />}
              >
                <ImpactAndMonitor
                  impactAnalyses={snapshot.impactAnalyses}
                  monitorEvents={snapshot.monitorEvents}
                />
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualObjectBuilder({
  snapshot,
  baselineObjectIds,
  selectedObjectId,
  isEditingModel,
  consistencyCheck,
  isChecking,
  onSelectedObjectChange,
  onAddObject,
  onUpdateObject,
  onEditObject,
  onDeleteObject,
  onEditAttribute,
  onDeleteAttribute,
  onAddRelation,
  onEditRelation,
  onDeleteRelation,
  onReviewTarget,
  onAddMapping,
  onEditMapping,
  onDeleteMapping,
  onBack,
  onCompleteModeling,
  onCompleteReview,
  onRunConsistencyCheck,
  onOpenPublish,
}: IManualObjectBuilderProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [isSubmittingStep, setIsSubmittingStep] = useState(false);
  const [isGraphPreviewVisible, setIsGraphPreviewVisible] = useState(false);
  const baselineObjectIdSet = new Set(baselineObjectIds);
  const objects = snapshot.objects.filter(
    (object) => !baselineObjectIdSet.has(object.id),
  );
  const objectIdSet = new Set(objects.map((object) => object.id));
  const relations = snapshot.relations.filter(
    (relation) =>
      objectIdSet.has(relation.fromObjectId) &&
      objectIdSet.has(relation.toObjectId),
  );
  const mappings = snapshot.mappings.filter((mapping) =>
    objectIdSet.has(mapping.objectId),
  );
  const qualityRules = snapshot.qualityRules.filter((rule) =>
    objectIdSet.has(rule.objectId),
  );
  const builderSnapshot = {
    ...snapshot,
    objects,
    relations,
    mappings,
    qualityRules,
  };
  const selectedObject =
    objects.find((object) => object.id === selectedObjectId) ??
    objects[0] ??
    null;
  const attributeCount = objects.reduce(
    (count, object) => count + object.attributes.length,
    0,
  );
  const isModelValid =
    objects.length > 0 &&
    objects.every(
      (object) =>
        object.name.trim().length > 0 &&
        object.code.trim().length > 0 &&
        object.attributes.length > 0,
    );

  const onSubmitModeling = async () => {
    setIsSubmittingStep(true);
    try {
      if (await onCompleteModeling()) setStep(1);
    } finally {
      setIsSubmittingStep(false);
    }
  };

  const onSubmitReview = async () => {
    setIsSubmittingStep(true);
    try {
      for (const object of objects) {
        const isApproved = await onReviewTarget({
          targetType: "object",
          targetId: object.id,
          decision: "approved",
        });
        if (!isApproved) return;
      }
      for (const relation of relations) {
        const isApproved = await onReviewTarget({
          targetType: "relation",
          targetId: relation.id,
          decision: "approved",
        });
        if (!isApproved) return;
      }
      if (await onCompleteReview()) setStep(2);
    } finally {
      setIsSubmittingStep(false);
    }
  };

  useEffect(() => {
    if (selectedObject?.id !== selectedObjectId)
      onSelectedObjectChange(selectedObject?.id ?? null);
  }, [onSelectedObjectChange, selectedObject?.id, selectedObjectId]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1500px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-2)] pb-4">
        <div className="flex min-w-0 items-center gap-4">
          <Button icon={<ArrowLeft size={16} />} onClick={onBack}>
            {t("ontology.objectBuilder.backToObjects")}
          </Button>
          <div className="min-w-0">
            <Typography.Title heading={5} className="!mb-0 truncate">
              {snapshot.draft.title || snapshot.workspaceId}
            </Typography.Title>
            <Typography.Text className="block text-xs" type="secondary">
              {t("ontology.objectBuilder.manual")}
            </Typography.Text>
          </div>
        </div>
        <Tag color="arcoblue">{t("ontology.objectBuilder.draftVersion")}</Tag>
      </div>

      <div
        className={`${WORKBENCH_CARD_CLASS} grid grid-cols-2 gap-3 p-4 md:grid-cols-4`}
      >
        {(["manual", "review", "mapping", "publish"] as const).map(
          (stepName, index) => (
            <div
              key={stepName}
              className={`flex items-center gap-3 ${index === step ? "text-[rgb(var(--primary-6))]" : index < step ? "text-[rgb(var(--success-6))]" : "text-[var(--color-text-3)]"}`}
            >
              <span
                aria-current={index === step ? "step" : undefined}
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${index === step ? "border-[rgb(var(--primary-6))] bg-[rgb(var(--primary-1))] text-[rgb(var(--primary-6))]" : index < step ? "border-[rgb(var(--success-6))] bg-[rgb(var(--success-6))] text-white" : "border-[var(--color-border-3)] text-[var(--color-text-2)]"}`}
              >
                {index < step ? "✓" : index + 1}
              </span>
              <div className="min-w-0">
                <Typography.Text
                  bold={index === step}
                  className="block truncate"
                >
                  {t(`ontology.objectBuilder.steps.${stepName}`)}
                </Typography.Text>
                <Typography.Text
                  className="block truncate text-xs"
                  type="secondary"
                >
                  {t(`ontology.objectBuilder.stepDescriptions.${stepName}`)}
                </Typography.Text>
              </div>
            </div>
          ),
        )}
      </div>

      {step === 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <Typography.Text bold className="block">
              {t("ontology.objectBuilder.manualWorkspaceTitle")}
            </Typography.Text>
            <Typography.Text className="text-xs" type="secondary">
              {t("ontology.objectBuilder.manualWorkspaceDescription")}
            </Typography.Text>
          </div>
          <Tag>{t("ontology.list.statObjects", { count: objects.length })}</Tag>
          <Tag>
            {t("ontology.list.statRelations", {
              count: relations.length,
            })}
          </Tag>
          <Tag>
            {t("ontology.objectBuilder.attributeCount", {
              count: attributeCount,
            })}
          </Tag>
          <Button
            icon={<Network size={15} />}
            disabled={objects.length === 0}
            onClick={() => setIsGraphPreviewVisible(true)}
          >
            {t("ontology.objectBuilder.previewGraph")}
          </Button>
          <Button
            type="primary"
            loading={isSubmittingStep}
            disabled={!isModelValid}
            onClick={() => void onSubmitModeling()}
          >
            {t("ontology.objectBuilder.submitReview")}
          </Button>
        </div>
      )}

      {step === 0 && (
        <div className="grid min-h-[560px] grid-cols-1 gap-3 xl:grid-cols-[260px_minmax(360px,1fr)_320px]">
          <section
            className={`${WORKBENCH_CARD_CLASS} min-w-0 overflow-hidden`}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border-2)] px-4 py-3">
              <Typography.Text bold>
                {t("ontology.objectBuilder.objectList", {
                  count: objects.length,
                })}
              </Typography.Text>
              <Button
                aria-label={t("ontology.editor.addObject")}
                type="primary"
                size="mini"
                icon={<FilePlus2 size={14} />}
                loading={isEditingModel}
                onClick={onAddObject}
              />
            </div>
            <div className="flex max-h-[560px] flex-col gap-1 overflow-y-auto p-2">
              {objects.length === 0 ? (
                <Empty description={t("ontology.generate.emptyObjects")} />
              ) : (
                objects.map((object) => {
                  const isSelected = selectedObject?.id === object.id;
                  return (
                    <div
                      key={object.id}
                      role="button"
                      tabIndex={0}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 ${isSelected ? "bg-[rgb(var(--primary-1))]" : "hover:bg-[var(--color-fill-1)]"}`}
                      onClick={() => onSelectedObjectChange(object.id)}
                      onKeyDown={(event) =>
                        event.key === "Enter" &&
                        onSelectedObjectChange(object.id)
                      }
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--primary-1))] text-[rgb(var(--primary-6))]">
                        <Network size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Typography.Text
                          bold
                          className="block truncate text-sm"
                        >
                          {object.name}
                        </Typography.Text>
                        <Typography.Text
                          className="block truncate text-xs"
                          type="secondary"
                        >
                          {object.code} ·{" "}
                          {t("ontology.objectBuilder.attributeCount", {
                            count: object.attributes.length,
                          })}
                        </Typography.Text>
                      </div>
                      <Button
                        type="text"
                        size="mini"
                        status="danger"
                        icon={<Trash2 size={13} />}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteObject(object);
                        }}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section
            className={`${WORKBENCH_CARD_CLASS} min-w-0 overflow-hidden`}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border-2)] px-4 py-3">
              <Typography.Text bold>
                {t("ontology.objectBuilder.basicInfo")}
              </Typography.Text>
            </div>
            {selectedObject ? (
              <div className="flex flex-col gap-5 p-4">
                <ManualObjectBasicInfo
                  key={selectedObject.id}
                  object={selectedObject}
                  isSaving={isEditingModel}
                  onSave={onUpdateObject}
                />
                <ObjectAttributeList
                  object={selectedObject}
                  isDisabled={isEditingModel}
                  onEditAttribute={onEditAttribute}
                  onDeleteAttribute={onDeleteAttribute}
                />
              </div>
            ) : (
              <div className="flex min-h-96 flex-col items-center justify-center gap-3 p-8">
                <Empty description={t("ontology.objectBuilder.selectObject")} />
                <Button
                  type="primary"
                  icon={<FilePlus2 size={14} />}
                  onClick={onAddObject}
                >
                  {t("ontology.editor.addObject")}
                </Button>
              </div>
            )}
          </section>

          <section
            className={`${WORKBENCH_CARD_CLASS} min-w-0 overflow-hidden`}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border-2)] px-4 py-3">
              <Typography.Text bold>
                {t("ontology.objectBuilder.relationList", {
                  count: relations.length,
                })}
              </Typography.Text>
              <Button
                aria-label={t("ontology.editor.addRelation")}
                type="primary"
                size="mini"
                icon={<FilePlus2 size={14} />}
                disabled={objects.length < 2}
                onClick={() =>
                  onAddRelation(objects.map((object) => object.id))
                }
              />
            </div>
            <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto p-3">
              {relations.length === 0 ? (
                <Empty description={t("ontology.generate.emptyRelations")} />
              ) : (
                relations.map((relation) => (
                  <div
                    key={relation.id}
                    className="rounded-lg bg-[var(--color-fill-1)] p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <Typography.Text bold className="truncate text-sm">
                        {relation.name}
                      </Typography.Text>
                      <Tag>
                        {t(`ontology.cardinality.${relation.cardinality}`)}
                      </Tag>
                    </div>
                    <Typography.Text
                      className="block truncate text-xs"
                      type="secondary"
                    >
                      {ontologyObjectName(objects, relation.fromObjectId)} →{" "}
                      {ontologyObjectName(objects, relation.toObjectId)}
                    </Typography.Text>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        size="mini"
                        onClick={() =>
                          onEditRelation(
                            relation,
                            objects.map((object) => object.id),
                          )
                        }
                      >
                        {t("ontology.editor.edit")}
                      </Button>
                      <Button
                        size="mini"
                        status="danger"
                        onClick={() => void onDeleteRelation(relation)}
                      >
                        {t("ontology.editor.delete")}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {step === 1 && (
        <section className={`${WORKBENCH_CARD_CLASS} min-h-[520px] p-6`}>
          <BuilderReviewCard
            title={t("ontology.objectBuilder.reviewStepTitle")}
            description={t("ontology.objectBuilder.reviewStepDescription")}
            snapshot={builderSnapshot}
            isReviewEnabled
            onEditObject={onEditObject}
            onEditRelation={(relation) =>
              onEditRelation(
                relation,
                objects.map((object) => object.id),
              )
            }
            onReviewTarget={onReviewTarget}
          >
            <Space>
              <Button onClick={() => setStep(0)}>
                {t("ontology.objectBuilder.previous")}
              </Button>
              <Button
                type="primary"
                loading={isSubmittingStep}
                onClick={() => void onSubmitReview()}
              >
                {t("ontology.review.approveAll")}
              </Button>
            </Space>
          </BuilderReviewCard>
        </section>
      )}

      {step === 2 && (
        <section className={`${WORKBENCH_CARD_CLASS} min-h-[520px] p-6`}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <Typography.Title heading={4} className="!mb-2">
                {t("ontology.objectBuilder.mappingStepTitle")}
              </Typography.Title>
              <Typography.Text type="secondary">
                {t("ontology.objectBuilder.mappingStepDescription")}
              </Typography.Text>
            </div>
            <Button
              type="primary"
              disabled={objects.length === 0 || snapshot.assets.length === 0}
              onClick={onAddMapping}
            >
              {t("ontology.editor.addMapping")}
            </Button>
          </div>
          <MappingTable
            mappings={mappings}
            objects={objects}
            assets={snapshot.assets}
            onEditMapping={onEditMapping}
            onDeleteMapping={onDeleteMapping}
          />
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setStep(1)}>
              {t("ontology.objectBuilder.previous")}
            </Button>
            <Button type="primary" onClick={() => setStep(3)}>
              {t("ontology.objectBuilder.next")}
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className={`${WORKBENCH_CARD_CLASS} min-h-[520px] p-6`}>
          <BuilderCenteredStep
            title={t("ontology.objectBuilder.hydrateStepTitle")}
            description={t("ontology.objectBuilder.hydrateStepDescription")}
          >
            <div className="grid w-full max-w-2xl grid-cols-3 gap-3">
              <MiniMetric
                label={t("ontology.stats.objects")}
                value={objects.length}
              />
              <MiniMetric
                label={t("ontology.mapping.mappings")}
                value={mappings.length}
              />
              <MiniMetric
                label={t("ontology.mapping.qualityRules")}
                value={qualityRules.length}
              />
            </div>
            {consistencyCheck && (
              <ConsistencyCheckResult result={consistencyCheck} />
            )}
            <Space>
              <Button onClick={() => setStep(2)}>
                {t("ontology.objectBuilder.previous")}
              </Button>
              <Button
                loading={isChecking}
                onClick={() => void onRunConsistencyCheck(snapshot.workspaceId)}
              >
                {t("ontology.publishConsole.check")}
              </Button>
              <Button
                type="primary"
                disabled={!consistencyCheck?.isValid}
                onClick={onOpenPublish}
              >
                {t("ontology.detail.publish")}
              </Button>
            </Space>
          </BuilderCenteredStep>
        </section>
      )}

      <Modal
        visible={isGraphPreviewVisible}
        title={t("ontology.objectBuilder.previewGraph")}
        footer={null}
        style={{ width: 980 }}
        onCancel={() => setIsGraphPreviewVisible(false)}
      >
        <OntologyGraph objects={objects} relations={relations} />
      </Modal>
    </div>
  );
}

function ManualObjectBasicInfo({
  object,
  isSaving,
  onSave,
}: IManualObjectBasicInfoProps) {
  const { t } = useTranslation();
  const [nameValue, setNameValue] = useState(object.name);
  const [codeValue, setCodeValue] = useState(object.code);
  const [descriptionValue, setDescriptionValue] = useState(object.description);

  const onSaveBasicInfo = async () => {
    const name = nameValue.trim();
    const code = codeValue.trim();
    const description = descriptionValue.trim();
    if (!name || !code) return;
    if (
      name === object.name &&
      code === object.code &&
      description === object.description
    )
      return;
    await onSave({
      id: object.id,
      name,
      code,
      description,
      tier: object.tier,
      status: object.status,
      namespace: object.namespace,
      sourceAssetIds: object.sourceAssetIds,
    });
  };

  return (
    <Form layout="vertical">
      <div className="grid grid-cols-1 gap-x-3 md:grid-cols-2">
        <Form.Item label={t("ontology.editor.englishName")} required>
          <Input
            value={codeValue}
            disabled={isSaving}
            onChange={setCodeValue}
            onBlur={() => void onSaveBasicInfo()}
          />
        </Form.Item>
        <Form.Item label={t("ontology.editor.displayName")} required>
          <Input
            value={nameValue}
            disabled={isSaving}
            onChange={setNameValue}
            onBlur={() => void onSaveBasicInfo()}
          />
        </Form.Item>
        <Form.Item
          className="md:col-span-2"
          label={t("ontology.editor.description")}
        >
          <TextArea
            value={descriptionValue}
            disabled={isSaving}
            autoSize={{ minRows: 3, maxRows: 6 }}
            onChange={setDescriptionValue}
            onBlur={() => void onSaveBasicInfo()}
          />
        </Form.Item>
      </div>
    </Form>
  );
}

function GuidedObjectBuilder({
  method,
  snapshot,
  isGenerating,
  isApproving,
  isChecking,
  consistencyCheck,
  onImportFiles,
  onGenerateDraft,
  onReviewTarget,
  onEditObject,
  onEditRelation,
  onAddMapping,
  onEditMapping,
  onDeleteMapping,
  onApproveAll,
  onRunConsistencyCheck,
  onOpenPublish,
  onBack,
  onFinish,
}: IGuidedObjectBuilderProps) {
  const [step, setStep] = useState(0);
  const [businessGoal, setBusinessGoal] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [templateAssetIds, setTemplateAssetIds] = useState<string[]>([]);
  const { t } = useTranslation();
  const structuredAssets = snapshot.assets.filter((asset) =>
    ["database", "schema", "table"].includes(asset.kind),
  );
  const documentAssets = snapshot.assets.filter(isOntologyDocumentAsset);
  const steps =
    method === "template"
      ? (["template", "review", "hydrate"] as const)
      : method === "document"
        ? ([
            "documents",
            "extract",
            "mapping",
            "confirm",
            "review",
            "hydrate",
          ] as const)
        : ([
            "business",
            "assets",
            "documents",
            "extract",
            "review",
            "hydrate",
          ] as const);
  const currentStep = steps[step];
  const isBusy = isGenerating || isApproving || isChecking;
  const allDocumentIds = Array.from(new Set(selectedDocumentIds));
  const allAssetIds = Array.from(
    new Set([
      ...(method === "document" ? [] : selectedAssetIds),
      ...allDocumentIds,
    ]),
  );

  const onToggleSelection = (
    ids: string[],
    assetId: string,
    isChecked: boolean,
    onChange: (ids: string[]) => void,
  ) => {
    onChange(
      isChecked
        ? Array.from(new Set([...ids, assetId]))
        : ids.filter((id) => id !== assetId),
    );
  };

  const onImportTemplate = async () => {
    const assetIds = await onImportFiles("template");
    if (assetIds.length === 0) return;
    setTemplateAssetIds(assetIds);
  };

  const onConfirmTemplate = async () => {
    if (templateAssetIds.length === 0) return;
    if (await onGenerateDraft({ assetIds: templateAssetIds, mode: "merge" }))
      setStep(1);
  };

  const onImportDocuments = async () => {
    const assetIds = await onImportFiles("document");
    if (assetIds.length > 0)
      setSelectedDocumentIds((ids) =>
        Array.from(new Set([...ids, ...assetIds])),
      );
  };

  const onExtract = async () => {
    if (allAssetIds.length === 0 || !businessGoal.trim()) return;
    if (
      await onGenerateDraft({
        assetIds: allAssetIds,
        documentAssetIds: allDocumentIds,
        businessGoal: businessGoal.trim(),
        mode: "merge",
      })
    )
      setStep((value) => value + 1);
  };

  const onApproveAndContinue = async () => {
    if (await onApproveAll())
      setStep((value) => Math.min(value + 1, steps.length - 1));
  };

  const onNext = () => {
    if (!isBusy) setStep((value) => Math.min(value + 1, steps.length - 1));
  };
  const onPrevious = () => {
    if (!isBusy) setStep((value) => Math.max(value - 1, 0));
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1500px] flex-col gap-4">
      <div className="flex items-center gap-4 border-b border-[var(--color-border-2)] pb-4">
        <Button
          icon={<ArrowLeft size={16} />}
          disabled={isBusy}
          onClick={onBack}
        >
          {t("ontology.objectBuilder.backToObjects")}
        </Button>
        <div>
          <Typography.Title heading={5} className="!mb-0">
            {t(`ontology.objectBuilder.${method}`)}
          </Typography.Title>
          <Typography.Text type="secondary">
            {snapshot.draft.title || snapshot.workspaceId}
          </Typography.Text>
        </div>
      </div>

      <div
        className={`${WORKBENCH_CARD_CLASS} flex flex-wrap items-center justify-center gap-2 p-4`}
      >
        {steps.map((item, index) => (
          <div key={item} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 ${index === step ? "text-[rgb(var(--primary-6))]" : index < step ? "text-[rgb(var(--success-6))]" : "text-[var(--color-text-3)]"}`}
            >
              <span
                aria-current={index === step ? "step" : undefined}
                className={`flex size-6 items-center justify-center rounded-full border text-xs font-semibold ${index === step ? "border-[rgb(var(--primary-6))] bg-[rgb(var(--primary-1))] text-[rgb(var(--primary-6))]" : index < step ? "border-[rgb(var(--success-6))] bg-[rgb(var(--success-6))] text-white" : "border-[var(--color-border-3)] text-[var(--color-text-2)]"}`}
              >
                {index < step ? "✓" : index + 1}
              </span>
              <Typography.Text className="text-sm">
                {t(`ontology.objectBuilder.flowSteps.${item}`)}
              </Typography.Text>
            </div>
            {index < steps.length - 1 && (
              <span className="mx-1 h-px w-8 bg-[var(--color-border-2)]" />
            )}
          </div>
        ))}
      </div>

      <section
        className={`${WORKBENCH_CARD_CLASS} mx-auto min-h-[520px] w-full max-w-5xl p-6`}
      >
        {currentStep === "template" && (
          <BuilderCenteredStep
            title={t("ontology.objectBuilder.templateStepTitle")}
            description={t("ontology.objectBuilder.templateStepDescription")}
          >
            {templateAssetIds.length === 0 ? (
              <Button
                type="primary"
                size="large"
                icon={<ClipboardList size={16} />}
                loading={isGenerating}
                onClick={() => void onImportTemplate()}
              >
                {t("ontology.objectBuilder.chooseTemplateFile")}
              </Button>
            ) : (
              <div className="w-full max-w-2xl rounded-lg border border-[var(--color-border-2)] p-4 text-left">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Typography.Text bold>
                    {t("ontology.objectBuilder.templateReadyTitle")}
                  </Typography.Text>
                  <Tag color="green">
                    {t("ontology.objectBuilder.templateFileCount", {
                      count: templateAssetIds.length,
                    })}
                  </Tag>
                </div>
                <div className="mb-4 flex flex-col gap-2">
                  {templateAssetIds.map((assetId) => {
                    const asset = snapshot.assets.find(
                      (item) => item.id === assetId,
                    );
                    return (
                      <div
                        key={assetId}
                        className="rounded bg-[var(--color-fill-1)] px-3 py-2"
                      >
                        <Typography.Text>
                          {asset?.name ?? assetId}
                        </Typography.Text>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    disabled={isBusy}
                    onClick={() => void onImportTemplate()}
                  >
                    {t("ontology.objectBuilder.reselectTemplate")}
                  </Button>
                  <Button
                    type="primary"
                    loading={isGenerating}
                    disabled={isBusy}
                    onClick={() => void onConfirmTemplate()}
                  >
                    {t("ontology.objectBuilder.confirmTemplate")}
                  </Button>
                </div>
              </div>
            )}
          </BuilderCenteredStep>
        )}

        {currentStep === "business" && (
          <BuilderCenteredStep
            title={t("ontology.objectBuilder.businessStepTitle")}
            description={t("ontology.objectBuilder.businessStepDescription")}
          >
            <TextArea
              className="w-full max-w-2xl"
              value={businessGoal}
              autoSize={{ minRows: 6, maxRows: 10 }}
              onChange={setBusinessGoal}
            />
            <BuilderStepActions
              onNext={onNext}
              isNextDisabled={businessGoal.trim().length === 0}
            />
          </BuilderCenteredStep>
        )}

        {currentStep === "assets" && (
          <BuilderSelectionStep
            title={t("ontology.objectBuilder.assetStepTitle")}
            description={t("ontology.objectBuilder.assetStepDescription")}
            assets={structuredAssets}
            selectedIds={selectedAssetIds}
            emptyText={t("ontology.objectBuilder.emptyAssets")}
            onToggle={(assetId, isChecked) =>
              onToggleSelection(
                selectedAssetIds,
                assetId,
                isChecked,
                setSelectedAssetIds,
              )
            }
          >
            <BuilderStepActions
              onPrevious={onPrevious}
              onNext={onNext}
              isNextDisabled={selectedAssetIds.length === 0}
            />
          </BuilderSelectionStep>
        )}

        {currentStep === "documents" && (
          <BuilderSelectionStep
            title={t("ontology.objectBuilder.documentStepTitle")}
            description={t("ontology.objectBuilder.documentStepDescription")}
            assets={documentAssets}
            selectedIds={selectedDocumentIds}
            isDisabled={isBusy}
            emptyText={t("ontology.objectBuilder.emptyDocuments")}
            onToggle={(assetId, isChecked) =>
              onToggleSelection(
                selectedDocumentIds,
                assetId,
                isChecked,
                setSelectedDocumentIds,
              )
            }
          >
            {method === "document" && (
              <Form className="mt-4" layout="vertical">
                <Form.Item
                  label={t("ontology.objectBuilder.businessGoal")}
                  required
                >
                  <TextArea
                    value={businessGoal}
                    disabled={isBusy}
                    maxLength={ONTOLOGY_DOCUMENT_MAX_GOAL_CHARS}
                    placeholder={t(
                      "ontology.documentBuilder.documentGoalPlaceholder",
                    )}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    onChange={setBusinessGoal}
                  />
                </Form.Item>
              </Form>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Button
                icon={<FilePlus2 size={14} />}
                loading={isGenerating}
                disabled={isBusy}
                onClick={() => void onImportDocuments()}
              >
                {t("ontology.objectBuilder.chooseDocumentFiles")}
              </Button>
              <Space>
                {step > 0 && (
                  <Button disabled={isBusy} onClick={onPrevious}>
                    {t("ontology.objectBuilder.previous")}
                  </Button>
                )}
                {method === "asset" && (
                  <Button disabled={isBusy} onClick={onNext}>
                    {t("ontology.objectBuilder.skipDocuments")}
                  </Button>
                )}
                <Button
                  type="primary"
                  disabled={
                    isBusy ||
                    allDocumentIds.length === 0 ||
                    (method === "document" && businessGoal.trim().length === 0)
                  }
                  onClick={onNext}
                >
                  {t("ontology.objectBuilder.next")}
                </Button>
              </Space>
            </div>
            <div className="mt-3 flex flex-col gap-1 text-xs text-[var(--color-text-3)]">
              <span>
                {t("ontology.documentBuilder.documentFormatsHint", {
                  formats: ONTOLOGY_DOCUMENT_EXTENSIONS.map((extension) =>
                    extension.toUpperCase(),
                  ).join(" / "),
                })}
              </span>
              <span>
                {t("ontology.documentBuilder.documentLimitsHint", {
                  files: ONTOLOGY_DOCUMENT_MAX_FILES,
                  fileMiB: ONTOLOGY_DOCUMENT_MAX_FILE_BYTES / (1024 * 1024),
                  totalMiB: ONTOLOGY_DOCUMENT_MAX_TOTAL_BYTES / (1024 * 1024),
                })}
              </span>
              <span>{t("ontology.documentBuilder.documentParsingHint")}</span>
              <span>
                {t("ontology.documentBuilder.documentModelHint", {
                  chars: ONTOLOGY_DOCUMENT_MAX_TEXT_CHARS,
                })}
              </span>
            </div>
          </BuilderSelectionStep>
        )}

        {currentStep === "extract" && (
          <BuilderCenteredStep
            title={t("ontology.objectBuilder.extractStepTitle")}
            description={t("ontology.objectBuilder.extractStepDescription", {
              assets: selectedAssetIds.length,
              documents: allDocumentIds.length,
            })}
          >
            <div className="grid w-full max-w-2xl grid-cols-3 gap-3">
              <MiniMetric
                label={t("ontology.stats.assets")}
                value={allAssetIds.length}
              />
              <MiniMetric
                label={t("ontology.stats.objects")}
                value={snapshot.objects.length}
              />
              <MiniMetric
                label={t("ontology.stats.relations")}
                value={snapshot.relations.length}
              />
            </div>
            {allDocumentIds.length > 0 && (
              <Typography.Paragraph type="secondary" className="max-w-2xl">
                {t("ontology.documentBuilder.documentModelHint", {
                  chars: ONTOLOGY_DOCUMENT_MAX_TEXT_CHARS,
                })}
              </Typography.Paragraph>
            )}
            <Space>
              <Button disabled={isBusy} onClick={onPrevious}>
                {t("ontology.objectBuilder.previous")}
              </Button>
              <Button
                type="primary"
                loading={isGenerating}
                disabled={isBusy}
                onClick={() => void onExtract()}
              >
                {t("ontology.objectBuilder.startExtraction")}
              </Button>
            </Space>
          </BuilderCenteredStep>
        )}

        {currentStep === "mapping" && (
          <div>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <Typography.Title heading={4} className="!mb-2">
                  {t("ontology.objectBuilder.mappingStepTitle")}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {t("ontology.objectBuilder.mappingStepDescription")}
                </Typography.Text>
              </div>
              <Button
                type="primary"
                disabled={
                  snapshot.objects.length === 0 || snapshot.assets.length === 0
                }
                onClick={onAddMapping}
              >
                {t("ontology.editor.addMapping")}
              </Button>
            </div>
            <MappingTable
              mappings={snapshot.mappings}
              objects={snapshot.objects}
              assets={snapshot.assets}
              onEditMapping={onEditMapping}
              onDeleteMapping={onDeleteMapping}
            />
            <div className="mt-5 flex justify-end">
              <BuilderStepActions onPrevious={onPrevious} onNext={onNext} />
            </div>
          </div>
        )}

        {currentStep === "confirm" && (
          <BuilderReviewCard
            title={t("ontology.objectBuilder.confirmStepTitle")}
            description={t("ontology.objectBuilder.confirmStepDescription")}
            snapshot={snapshot}
            onEditObject={onEditObject}
            onEditRelation={onEditRelation}
          >
            <BuilderStepActions onPrevious={onPrevious} onNext={onNext} />
          </BuilderReviewCard>
        )}

        {currentStep === "review" && (
          <BuilderReviewCard
            title={t("ontology.objectBuilder.reviewStepTitle")}
            description={t("ontology.objectBuilder.reviewStepDescription")}
            snapshot={snapshot}
            isReviewEnabled
            onEditObject={onEditObject}
            onEditRelation={onEditRelation}
            onReviewTarget={onReviewTarget}
          >
            <Space>
              {step > 0 && (
                <Button onClick={onPrevious}>
                  {t("ontology.objectBuilder.previous")}
                </Button>
              )}
              <Button
                type="primary"
                loading={isApproving}
                onClick={() => void onApproveAndContinue()}
              >
                {t("ontology.review.approveAll")}
              </Button>
            </Space>
          </BuilderReviewCard>
        )}

        {currentStep === "hydrate" && (
          <BuilderCenteredStep
            title={t("ontology.objectBuilder.hydrateStepTitle")}
            description={t("ontology.objectBuilder.hydrateStepDescription")}
          >
            <div className="grid w-full max-w-2xl grid-cols-3 gap-3">
              <MiniMetric
                label={t("ontology.stats.objects")}
                value={snapshot.objects.length}
              />
              <MiniMetric
                label={t("ontology.mapping.mappings")}
                value={snapshot.mappings.length}
              />
              <MiniMetric
                label={t("ontology.mapping.qualityRules")}
                value={snapshot.qualityRules.length}
              />
            </div>
            {consistencyCheck && (
              <ConsistencyCheckResult result={consistencyCheck} />
            )}
            <Space>
              {step > 0 && (
                <Button onClick={onPrevious}>
                  {t("ontology.objectBuilder.previous")}
                </Button>
              )}
              <Button
                loading={isChecking}
                onClick={() => void onRunConsistencyCheck(snapshot.workspaceId)}
              >
                {t("ontology.publishConsole.check")}
              </Button>
              <Button onClick={onFinish}>
                {t("ontology.objectBuilder.finish")}
              </Button>
              <Button
                type="primary"
                disabled={!consistencyCheck?.isValid}
                onClick={onOpenPublish}
              >
                {t("ontology.detail.publish")}
              </Button>
            </Space>
          </BuilderCenteredStep>
        )}
      </section>
    </div>
  );
}

function BuilderCenteredStep({
  title,
  description,
  children,
}: IBuilderCenteredStepProps) {
  return (
    <div className="flex min-h-[460px] flex-col items-center justify-center gap-5 text-center">
      <div>
        <Typography.Title heading={4} className="!mb-2">
          {title}
        </Typography.Title>
        <Typography.Text type="secondary">{description}</Typography.Text>
      </div>
      {children}
    </div>
  );
}

function BuilderSelectionStep({
  title,
  description,
  assets,
  selectedIds,
  isDisabled,
  emptyText,
  onToggle,
  children,
}: IBuilderSelectionStepProps) {
  const { t } = useTranslation();
  return (
    <div>
      <Typography.Title heading={4} className="!mb-2">
        {title}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {description}
      </Typography.Paragraph>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-[var(--color-border-2)]">
        {assets.length === 0 ? (
          <Empty className="py-12" description={emptyText} />
        ) : (
          assets.map((asset) => (
            <label
              key={asset.id}
              className="flex cursor-pointer items-center gap-3 border-b border-[var(--color-border-1)] px-3 py-3 last:border-b-0 hover:bg-[var(--color-fill-1)]"
            >
              <Checkbox
                checked={selectedIds.includes(asset.id)}
                disabled={isDisabled}
                onChange={(isChecked) => onToggle(asset.id, isChecked)}
              />
              <div className="min-w-0 flex-1">
                <Typography.Text bold className="block truncate">
                  {asset.name}
                </Typography.Text>
                <Typography.Text
                  className="block truncate text-xs"
                  type="secondary"
                >
                  {asset.path ?? asset.sourceName ?? "-"}
                </Typography.Text>
              </div>
              <Tag color={assetKindColor(asset.kind)}>
                {t(`ontology.assetKind.${asset.kind}`)}
              </Tag>
              <Typography.Text type="secondary">
                {t("ontology.console.fieldCount", {
                  count: asset.fields.length,
                })}
              </Typography.Text>
            </label>
          ))
        )}
      </div>
      {children}
    </div>
  );
}

function BuilderReviewCard({
  title,
  description,
  snapshot,
  isReviewEnabled = false,
  onEditObject,
  onEditRelation,
  onReviewTarget,
  children,
}: IBuilderReviewCardProps) {
  const { t } = useTranslation();
  const pendingReviewCount = [
    ...snapshot.objects,
    ...snapshot.relations,
  ].filter((item) => item.reviewDecision === "pending").length;
  return (
    <div>
      <Typography.Title heading={4} className="!mb-2">
        {title}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {description}
      </Typography.Paragraph>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniMetric
          label={t("ontology.stats.objects")}
          value={snapshot.objects.length}
        />
        <MiniMetric
          label={t("ontology.stats.relations")}
          value={snapshot.relations.length}
        />
        <MiniMetric
          label={t("ontology.mapping.mappings")}
          value={snapshot.mappings.length}
        />
        <MiniMetric
          label={t("ontology.stats.pendingReview")}
          value={pendingReviewCount}
        />
      </div>
      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border-2)]">
          <div className="sticky top-0 border-b border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-3 py-2">
            <Typography.Text bold>
              {t("ontology.list.statObjects", {
                count: snapshot.objects.length,
              })}
            </Typography.Text>
          </div>
          {snapshot.objects.length === 0 ? (
            <Empty
              className="py-8"
              description={t("ontology.generate.emptyObjects")}
            />
          ) : (
            snapshot.objects.map((object) => (
              <div
                key={object.id}
                className="flex items-center justify-between gap-3 border-b border-[var(--color-border-1)] px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <Typography.Text bold className="block truncate">
                    {object.name}
                  </Typography.Text>
                  <Typography.Text
                    className="block truncate text-xs"
                    type="secondary"
                  >
                    {object.code} ·{" "}
                    {t("ontology.objectBuilder.attributeCount", {
                      count: object.attributes.length,
                    })}
                  </Typography.Text>
                </div>
                <ReviewDecisionTag decision={object.reviewDecision} />
                {onEditObject && (
                  <Button size="mini" onClick={() => onEditObject(object)}>
                    {t("ontology.editor.edit")}
                  </Button>
                )}
                {isReviewEnabled &&
                  onReviewTarget &&
                  object.reviewDecision !== "approved" && (
                    <Button
                      size="mini"
                      onClick={() =>
                        void onReviewTarget({
                          targetType: "object",
                          targetId: object.id,
                          decision: "approved",
                        })
                      }
                    >
                      {t("ontology.review.approve")}
                    </Button>
                  )}
              </div>
            ))
          )}
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border-2)]">
          <div className="sticky top-0 border-b border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-3 py-2">
            <Typography.Text bold>
              {t("ontology.list.statRelations", {
                count: snapshot.relations.length,
              })}
            </Typography.Text>
          </div>
          {snapshot.relations.length === 0 ? (
            <Empty
              className="py-8"
              description={t("ontology.generate.emptyRelations")}
            />
          ) : (
            snapshot.relations.map((relation) => (
              <div
                key={relation.id}
                className="flex items-center justify-between gap-3 border-b border-[var(--color-border-1)] px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <Typography.Text bold className="block truncate">
                    {relation.name}
                  </Typography.Text>
                  <Typography.Text
                    className="block truncate text-xs"
                    type="secondary"
                  >
                    {ontologyObjectName(
                      snapshot.objects,
                      relation.fromObjectId,
                    )}{" "}
                    →{" "}
                    {ontologyObjectName(snapshot.objects, relation.toObjectId)}
                  </Typography.Text>
                </div>
                <ReviewDecisionTag decision={relation.reviewDecision} />
                {onEditRelation && (
                  <Button size="mini" onClick={() => onEditRelation(relation)}>
                    {t("ontology.editor.edit")}
                  </Button>
                )}
                {isReviewEnabled &&
                  onReviewTarget &&
                  relation.reviewDecision !== "approved" && (
                    <Button
                      size="mini"
                      onClick={() =>
                        void onReviewTarget({
                          targetType: "relation",
                          targetId: relation.id,
                          decision: "approved",
                        })
                      }
                    >
                      {t("ontology.review.approve")}
                    </Button>
                  )}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="flex justify-end">{children}</div>
    </div>
  );
}

function BuilderStepActions({
  onPrevious,
  onNext,
  isNextDisabled = false,
}: IBuilderStepActionsProps) {
  const { t } = useTranslation();
  return (
    <Space>
      {onPrevious && (
        <Button onClick={onPrevious}>
          {t("ontology.objectBuilder.previous")}
        </Button>
      )}
      {onNext && (
        <Button type="primary" disabled={isNextDisabled} onClick={onNext}>
          {t("ontology.objectBuilder.next")}
        </Button>
      )}
    </Space>
  );
}

function LabeledValue({ label, value }: ILabeledValueProps) {
  return (
    <div>
      <Typography.Text className="mb-1 block text-xs" type="secondary">
        {label}
      </Typography.Text>
      <div className="min-h-9 rounded-lg bg-[var(--color-fill-1)] px-3 py-2 text-sm text-[var(--color-text-1)]">
        {value}
      </div>
    </div>
  );
}

function PublishPage({
  snapshot,
  snapshots,
  initialWorkspaceId,
  consistencyCheck,
  isChecking,
  isPublishing,
  onRunConsistencyCheck,
  onPublish,
  onApproveVersion,
  onRejectVersion,
  onRollbackVersion,
  onSelectWorkspace,
}: IPublishPageProps) {
  const { t } = useTranslation();
  const [isHistoryVisible, setIsHistoryVisible] = useState(
    initialWorkspaceId !== null,
  );
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [rejectingVersion, setRejectingVersion] =
    useState<IOntologyPublishedVersion | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const sortedVersions = useMemo(
    () =>
      [...snapshot.publishedVersions].sort(
        (left, right) => right.createdAt - left.createdAt,
      ),
    [snapshot.publishedVersions],
  );
  const servingVersion =
    sortedVersions.find(
      (version) => version.status === "published" && version.isActive,
    ) ?? null;
  const selectedVersion =
    sortedVersions.find((version) => version.id === selectedVersionId) ??
    servingVersion ??
    sortedVersions[0] ??
    null;
  const selectedSnapshot = selectedVersion?.snapshot;
  const selectedObjects = selectedSnapshot?.objects ?? snapshot.objects;
  const selectedRelations = selectedSnapshot?.relations ?? snapshot.relations;
  const selectedLogic =
    selectedSnapshot?.logicFunctions ?? snapshot.logicFunctions;
  const selectedActions = selectedSnapshot?.actions ?? snapshot.actions;
  const serviceWorkbenches = useMemo(
    () =>
      snapshots
        .map((workspaceSnapshot) => {
          const versions = [...workspaceSnapshot.publishedVersions].sort(
            (left, right) => right.createdAt - left.createdAt,
          );
          const servingPublishedVersion =
            versions.find(
              (version) => version.status === "published" && version.isActive,
            ) ?? null;
          return {
            snapshot: workspaceSnapshot,
            versions,
            overviewVersion: servingPublishedVersion ?? versions[0] ?? null,
          };
        })
        .sort(
          (left, right) =>
            (right.overviewVersion?.createdAt ?? right.snapshot.updatedAt) -
            (left.overviewVersion?.createdAt ?? left.snapshot.updatedAt),
        ),
    [snapshots],
  );

  const onOpenVersionHistory = async (
    workspaceSnapshot: IOntologyWorkbenchSnapshot,
    versionId: string | null,
  ) => {
    if (
      workspaceSnapshot.workspaceId !== snapshot.workspaceId &&
      !(await onSelectWorkspace(workspaceSnapshot.workspaceId))
    )
      return;
    setSelectedVersionId(versionId);
    setIsHistoryVisible(true);
  };

  if (!isHistoryVisible) {
    return (
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
        <section>
          <Typography.Title heading={3} className="!mb-2">
            {t("ontology.publishConsole.environmentTitle")}
          </Typography.Title>
          <Typography.Text className="text-sm" type="secondary">
            {t("ontology.publishConsole.environmentDescription")}
          </Typography.Text>
        </section>

        {serviceWorkbenches.length === 0 ? (
          <div className="rounded bg-[var(--color-bg-1)] py-16 text-center">
            <Empty description={t("ontology.publishConsole.empty")} />
            <Typography.Text className="block" type="secondary">
              {t("ontology.publishConsole.emptyHint")}
            </Typography.Text>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {serviceWorkbenches.map(
              ({
                snapshot: workspaceSnapshot,
                versions,
                overviewVersion: workspaceOverviewVersion,
              }) => (
                <div
                  key={workspaceSnapshot.workspaceId}
                  role="button"
                  tabIndex={0}
                  className={`${WORKBENCH_INTERACTIVE_CARD_CLASS} flex min-h-64 cursor-pointer flex-col p-5`}
                  onClick={() =>
                    void onOpenVersionHistory(
                      workspaceSnapshot,
                      workspaceOverviewVersion?.id ?? null,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void onOpenVersionHistory(
                        workspaceSnapshot,
                        workspaceOverviewVersion?.id ?? null,
                      );
                    }
                  }}
                >
                  <div className="mb-4 flex flex-wrap items-start gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--primary-2))] bg-[rgb(var(--primary-1))] text-[rgb(var(--primary-6))]">
                      <Rocket size={23} />
                    </div>
                    <div className="min-w-0 flex-1 basis-40">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 basis-24">
                          <Typography.Text
                            bold
                            className="block truncate text-size-base"
                          >
                            {workspaceSnapshot.draft.title ||
                              t("ontology.list.defaultName")}
                          </Typography.Text>
                          <Typography.Text
                            className="mt-1 block truncate text-xs"
                            type="secondary"
                          >
                            {ontologyCodeFromTitle(
                              workspaceSnapshot.draft.title,
                              workspaceSnapshot.workspaceId,
                            )}
                          </Typography.Text>
                        </div>
                        {workspaceOverviewVersion?.status === "published" &&
                          workspaceOverviewVersion.isActive && (
                            <Tag color="blue">
                              {t("ontology.publishConsole.servingVersion", {
                                version: workspaceOverviewVersion.version,
                              })}
                            </Tag>
                          )}
                        {!workspaceOverviewVersion && (
                          <Tag color="gray">
                            {t("ontology.publishConsole.notPublished")}
                          </Tag>
                        )}
                      </div>
                    </div>
                  </div>

                  <Typography.Paragraph
                    className="!mb-4 min-h-10 text-sm leading-6"
                    type="secondary"
                    ellipsis={{ rows: 2 }}
                  >
                    {workspaceSnapshot.draft.description ||
                      workspaceSnapshot.draft.businessGoal ||
                      t("ontology.list.noDescription")}
                  </Typography.Paragraph>

                  <div className="mb-4 grid grid-cols-2 divide-x divide-[var(--color-border-1)] rounded-lg bg-[var(--color-fill-1)] px-2 py-3">
                    <ResourceCardStatistic
                      label={t("ontology.stats.objects")}
                      value={
                        workspaceOverviewVersion?.objectCount ??
                        workspaceSnapshot.objects.length
                      }
                    />
                    <ResourceCardStatistic
                      label={t("ontology.stats.versions")}
                      value={versions.length}
                    />
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-[var(--color-border-2)] pt-4">
                    <Typography.Text
                      className="text-sm"
                      type={
                        workspaceOverviewVersion?.status === "rejected"
                          ? "error"
                          : undefined
                      }
                    >
                      {workspaceOverviewVersion
                        ? t(
                            `ontology.versionStatus.${workspaceOverviewVersion.status}`,
                          )
                        : t("ontology.publishConsole.notPublished")}
                    </Typography.Text>
                    <Typography.Text className="text-xs" type="secondary">
                      {formatOntologyShortDate(
                        workspaceOverviewVersion?.publishedAt ??
                          workspaceOverviewVersion?.submittedAt ??
                          workspaceOverviewVersion?.createdAt,
                      )}
                    </Typography.Text>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <section>
        <Button
          type="text"
          size="small"
          className="!mb-3 !px-0"
          onClick={() => setIsHistoryVisible(false)}
        >
          {t("ontology.publishConsole.back")}
        </Button>
        <Typography.Title heading={3} className="!mb-2">
          {snapshot.draft.title || t("ontology.list.defaultName")}
        </Typography.Title>
        <Typography.Text className="text-sm" type="secondary">
          {t("ontology.publishConsole.historyDescription", {
            count: sortedVersions.length,
          })}
        </Typography.Text>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className={`${WORKBENCH_CARD_CLASS} p-4`}>
          <Button
            type="primary"
            long
            icon={<FilePlus2 size={16} />}
            loading={isPublishing}
            onClick={() => void onPublish(snapshot.workspaceId)}
          >
            {t("ontology.publishConsole.createVersion")}
          </Button>
          <div className="mt-4 flex flex-col gap-2">
            {sortedVersions.map((version) => {
              const isActive = version.id === selectedVersion?.id;
              return (
                <button
                  key={version.id}
                  type="button"
                  className={`w-full rounded border px-3 py-3 text-left transition-colors ${isActive ? "border-[rgb(var(--primary-6))] bg-[rgb(var(--primary-1))]" : "border-[var(--color-border-2)] bg-[var(--color-bg-1)] hover:border-[rgb(var(--primary-6))]"}`}
                  onClick={() => setSelectedVersionId(version.id)}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Typography.Text bold>{version.version}</Typography.Text>
                    <Tag color={versionStatusColor(version.status)}>
                      {t(`ontology.versionStatus.${version.status}`)}
                    </Tag>
                  </div>
                  <Typography.Text className="block text-xs" type="secondary">
                    {t("ontology.publish.versionSummary", {
                      objects: version.objectCount,
                      relations: version.relationCount,
                    })}
                  </Typography.Text>
                  {version.isActive && (
                    <Tag className="mt-2" color="green">
                      {t("ontology.publishConsole.serving")}
                    </Tag>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className={`${WORKBENCH_CARD_CLASS} p-5`}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <Typography.Title heading={5} className="!mb-1">
                  {selectedVersion
                    ? t("ontology.publishConsole.versionTitle", {
                        version: selectedVersion.version,
                        name:
                          snapshot.draft.title ||
                          t("ontology.list.defaultName"),
                      })
                    : t("ontology.publishConsole.noSelectedVersion")}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {selectedVersion?.summary || t("ontology.list.noDescription")}
                </Typography.Text>
              </div>
              {selectedVersion && (
                <Tag color={versionStatusColor(selectedVersion.status)}>
                  {t(`ontology.versionStatus.${selectedVersion.status}`)}
                </Tag>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <ConsoleStatistic
                title={t("ontology.publishConsole.objects")}
                value={selectedObjects.length}
              />
              <ConsoleStatistic
                title={t("ontology.publishConsole.relations")}
                value={selectedRelations.length}
              />
              <ConsoleStatistic
                title={t("ontology.publishConsole.logic")}
                value={selectedLogic.length}
              />
              <ConsoleStatistic
                title={t("ontology.publishConsole.actions")}
                value={selectedActions.length}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-border-2)] pt-4">
              <Button
                icon={<ShieldCheck size={16} />}
                loading={isChecking}
                onClick={() => void onRunConsistencyCheck(snapshot.workspaceId)}
              >
                {t("ontology.publishConsole.check")}
              </Button>
              {selectedVersion?.status === "submitted" && (
                <>
                  <Button
                    type="primary"
                    icon={<CheckCircle2 size={16} />}
                    onClick={() =>
                      void onApproveVersion(
                        snapshot.workspaceId,
                        selectedVersion,
                      )
                    }
                  >
                    {t("ontology.publishConsole.approve")}
                  </Button>
                  <Button
                    status="danger"
                    onClick={() => {
                      setRejectingVersion(selectedVersion);
                      setRejectReason("");
                    }}
                  >
                    {t("ontology.publishConsole.reject")}
                  </Button>
                </>
              )}
              {selectedVersion?.status === "published" &&
                !selectedVersion.isActive && (
                  <Button
                    icon={<RotateCcw size={16} />}
                    onClick={() =>
                      onRollbackVersion(snapshot.workspaceId, selectedVersion)
                    }
                  >
                    {t("ontology.publishConsole.rollback")}
                  </Button>
                )}
            </div>
          </div>

          {consistencyCheck && (
            <ConsistencyCheckResult result={consistencyCheck} />
          )}

          <Modal
            visible={rejectingVersion !== null}
            title={t("ontology.publishConsole.rejectTitle")}
            okText={t("ontology.publishConsole.reject")}
            cancelText={t("ontology.reset.cancel")}
            okButtonProps={{
              status: "danger",
              disabled: rejectReason.trim().length === 0,
            }}
            onOk={async () => {
              if (!rejectingVersion) return;
              if (
                await onRejectVersion(
                  snapshot.workspaceId,
                  rejectingVersion,
                  rejectReason,
                )
              )
                setRejectingVersion(null);
            }}
            onCancel={() => setRejectingVersion(null)}
          >
            <Form layout="vertical">
              <Form.Item
                label={t("ontology.publishConsole.rejectReasonLabel")}
                required
              >
                <TextArea
                  value={rejectReason}
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  placeholder={t(
                    "ontology.publishConsole.rejectReasonPlaceholder",
                  )}
                  onChange={setRejectReason}
                />
              </Form.Item>
            </Form>
          </Modal>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <PublishedArtifactSection
              title={t("ontology.publishConsole.objects")}
              items={selectedObjects.map((object) => ({
                id: object.id,
                name: object.name,
                description: object.description,
                meta: object.code,
              }))}
              emptyText={t("ontology.publishConsole.emptyObjects")}
            />
            <PublishedArtifactSection
              title={t("ontology.publishConsole.relations")}
              items={selectedRelations.map((relation) => ({
                id: relation.id,
                name: relation.name,
                description: relation.description ?? "",
                meta: relation.code,
              }))}
              emptyText={t("ontology.publishConsole.emptyRelations")}
            />
            <PublishedArtifactSection
              title={t("ontology.publishConsole.logic")}
              items={selectedLogic.map((logic) => ({
                id: logic.id,
                name: logic.name,
                description: logic.description,
                meta: logic.runtime,
              }))}
              emptyText={t("ontology.publishConsole.emptyLogic")}
            />
            <PublishedArtifactSection
              title={t("ontology.publishConsole.actions")}
              items={selectedActions.map((action) => ({
                id: action.id,
                name: action.name,
                description: action.executor,
                meta: action.status,
              }))}
              emptyText={t("ontology.publishConsole.emptyActions")}
            />
          </div>
        </div>
      </div>
      {servingVersion && <OntologyServiceDetails snapshot={snapshot} />}
    </div>
  );
}

function OntologyServiceDetails({ snapshot }: IOntologyServiceDetailsProps) {
  const { t } = useTranslation();
  const registeredBlueprints = snapshot.agentBlueprints.filter(
    (blueprint) =>
      blueprint.status === "registered" && blueprint.registeredAssistantId,
  );
  const serviceName = registeredBlueprints.at(-1)
    ? `ontology-${registeredBlueprints.at(-1)?.id}`
    : t("ontology.mcpService.notRegistered");
  const mcpTools = useMemo(() => buildMcpTools(snapshot, t), [snapshot, t]);
  const onCopyText = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text);
      Message.success(t("ontology.mcpService.copied"));
    },
    [t],
  );

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <Typography.Title heading={5} className="!mb-2">
            {t("ontology.mcpService.detailsTitle")}
          </Typography.Title>
          <Typography.Text className="text-sm" type="secondary">
            {t("ontology.mcpService.description")}
          </Typography.Text>
        </div>
        <div className={`${WORKBENCH_CARD_CLASS} p-4`}>
          <div
            className={`mb-2 flex items-center gap-2 ${registeredBlueprints.length > 0 ? "text-[rgb(var(--success-6))]" : "text-[var(--color-text-3)]"}`}
          >
            <span
              className={`size-2 rounded-full ${registeredBlueprints.length > 0 ? "bg-[rgb(var(--success-6))]" : "bg-[var(--color-fill-4)]"}`}
            />
            <Typography.Text className="text-sm">
              {t(
                registeredBlueprints.length > 0
                  ? "ontology.mcpService.running"
                  : "ontology.mcpService.notRegistered",
              )}
            </Typography.Text>
          </div>
          <div className="flex items-center gap-2">
            <code className="rounded bg-[var(--color-fill-2)] px-2 py-1 text-xs">
              {serviceName}
            </code>
            <Button
              size="mini"
              icon={<Copy size={13} />}
              disabled={registeredBlueprints.length === 0}
              onClick={() => void onCopyText(serviceName)}
            >
              {t("ontology.mcpService.copy")}
            </Button>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <McpMetricCard
            title={t("ontology.stats.versions")}
            value={snapshot.stats.publishedVersionCount}
            suffix=""
          />
          <McpMetricCard
            title={t("ontology.stats.objects")}
            value={snapshot.stats.objectCount}
            suffix=""
          />
          <McpMetricCard
            title={t("ontology.runtime.functions")}
            value={snapshot.stats.logicFunctionCount}
            suffix=""
          />
          <McpMetricCard
            title={t("ontology.mcpService.registeredAgents")}
            value={registeredBlueprints.length}
            suffix=""
          />
        </div>

        <Table
          className="rounded bg-[var(--color-bg-1)] shadow-sm"
          rowKey="name"
          pagination={false}
          data={mcpTools}
          noDataElement={<Empty description={t("ontology.mcpService.empty")} />}
          columns={[
            {
              title: t("ontology.mcpService.toolName"),
              dataIndex: "name",
              width: 220,
            },
            {
              title: t("ontology.editor.description"),
              dataIndex: "description",
              ellipsis: true,
            },
            {
              title: t("ontology.mcpService.paramCountLabel"),
              width: 140,
              render: (_: unknown, tool: IMcpToolDefinition) =>
                Object.keys(tool.inputSchema.properties).length,
            },
          ]}
        />
      </div>
    </div>
  );
}

function AgentPage({
  snapshots,
  agentNameValue,
  isCreatingAgent,
  isRegisteringAgent,
  onAgentNameChange,
  onCreateAgent,
  onRegisterAgent,
  onDeleteAgent,
}: IAgentPageProps) {
  const { t } = useTranslation();
  const [agentSearchValue, setAgentSearchValue] = useState("");
  const [agentStatusFilter, setAgentStatusFilter] =
    useState<AgentManageStatusFilter>("all");
  const [detailAgent, setDetailAgent] = useState<{
    workspaceId: string;
    agentId: string;
  } | null>(null);
  const [isCreateAgentModalVisible, setIsCreateAgentModalVisible] =
    useState(false);
  const [selectedOntologyServiceKey, setSelectedOntologyServiceKey] =
    useState("");
  const agentEntries = useMemo(
    () =>
      snapshots.flatMap((workspaceSnapshot) =>
        workspaceSnapshot.agentBlueprints.map((agent) => ({
          agent,
          workspaceSnapshot,
        })),
      ),
    [snapshots],
  );
  const publishedServices = useMemo(
    () =>
      snapshots
        .flatMap((workspaceSnapshot) =>
          workspaceSnapshot.publishedVersions
            .filter((version) => version.status === "published")
            .map((version) => ({
              key: `${workspaceSnapshot.workspaceId}::${version.id}`,
              version,
              workspaceSnapshot,
            })),
        )
        .sort(
          (left, right) =>
            Number(right.version.isActive) - Number(left.version.isActive) ||
            (right.version.publishedAt ?? right.version.createdAt) -
              (left.version.publishedAt ?? left.version.createdAt),
        ),
    [snapshots],
  );
  const selectedOntologyService = publishedServices.find(
    (service) => service.key === selectedOntologyServiceKey,
  );
  const currentDetailEntry = detailAgent
    ? (agentEntries.find(
        ({ agent, workspaceSnapshot }) =>
          agent.id === detailAgent.agentId &&
          workspaceSnapshot.workspaceId === detailAgent.workspaceId,
      ) ?? null)
    : null;
  const currentDetailAgent = currentDetailEntry?.agent ?? null;
  const currentDetailSnapshot = currentDetailEntry?.workspaceSnapshot ?? null;
  const currentDetailVersion = currentDetailAgent
    ? (currentDetailSnapshot?.publishedVersions.find(
        (version) => version.id === currentDetailAgent.ontologyVersionId,
      ) ?? null)
    : null;
  const hasPublishedVersion = publishedServices.length > 0;
  const filteredAgents = useMemo(() => {
    const keyword = agentSearchValue.trim().toLowerCase();
    return agentEntries.filter(({ agent, workspaceSnapshot }) => {
      const status = agentManageStatus(agent);
      const isStatusMatched =
        agentStatusFilter === "all" || agentStatusFilter === status;
      const isKeywordMatched =
        keyword.length === 0 ||
        [
          agent.name,
          agent.promptTemplate,
          workspaceSnapshot.draft.title,
          workspaceSnapshot.workspaceId,
        ].some((value) => value.toLowerCase().includes(keyword));
      return isStatusMatched && isKeywordMatched;
    });
  }, [agentEntries, agentSearchValue, agentStatusFilter]);

  const onOpenCreateAgentModal = () => {
    onAgentNameChange("");
    setSelectedOntologyServiceKey("");
    setIsCreateAgentModalVisible(true);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col px-0 py-0">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <Typography.Title heading={3} className="!mb-2">
            {t("ontology.agentManage.title")}
          </Typography.Title>
          <Typography.Paragraph className="!mb-0 text-sm" type="secondary">
            {t("ontology.agentManage.description")}
          </Typography.Paragraph>
        </div>
        <Button
          type="primary"
          icon={<FilePlus2 size={16} />}
          loading={isCreatingAgent}
          disabled={!hasPublishedVersion}
          onClick={onOpenCreateAgentModal}
        >
          {t("ontology.agentManage.newAgent")}
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-sm"
          value={agentSearchValue}
          allowClear
          onChange={setAgentSearchValue}
        />
        <div className="flex gap-1">
          {(["all", "draft", "published"] as const).map((status) => {
            const isActive = agentStatusFilter === status;
            return (
              <Button
                key={status}
                type={isActive ? "primary" : "secondary"}
                className={isActive ? "" : "!bg-[var(--color-bg-1)]"}
                onClick={() => setAgentStatusFilter(status)}
              >
                {t(`ontology.agentManage.filters.${status}`)}
              </Button>
            );
          })}
        </div>
      </div>

      {filteredAgents.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {filteredAgents.map(({ agent, workspaceSnapshot }) => {
            const status = agentManageStatus(agent);
            const boundVersion = workspaceSnapshot.publishedVersions.find(
              (version) => version.id === agent.ontologyVersionId,
            );
            return (
              <div
                key={`${workspaceSnapshot.workspaceId}:${agent.id}`}
                role="button"
                tabIndex={0}
                className={`${WORKBENCH_INTERACTIVE_CARD_CLASS} flex min-h-40 cursor-pointer flex-col gap-3 p-4`}
                onClick={() =>
                  setDetailAgent({
                    workspaceId: workspaceSnapshot.workspaceId,
                    agentId: agent.id,
                  })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setDetailAgent({
                      workspaceId: workspaceSnapshot.workspaceId,
                      agentId: agent.id,
                    });
                  }
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <Typography.Text bold className="truncate text-sm">
                    {agent.name}
                  </Typography.Text>
                  <Tag color={status === "published" ? "green" : "gray"}>
                    {t(`ontology.agentManage.status.${status}`)}
                  </Tag>
                </div>

                <Typography.Paragraph
                  className="!mb-0 min-h-9 text-xs"
                  type="secondary"
                  ellipsis={{ rows: 2 }}
                >
                  {agent.promptTemplate ||
                    t("ontology.agentManage.noDescription")}
                </Typography.Paragraph>

                <Typography.Text className="text-xs" type="secondary">
                  {t("ontology.agentManage.boundService")}:{" "}
                  {workspaceSnapshot.draft.title ||
                    workspaceSnapshot.workspaceId}{" "}
                  · {boundVersion?.version ?? "-"}
                </Typography.Text>

                {agent.toolManifest.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {agent.toolManifest.slice(0, 3).map((tool) => (
                      <Tag key={`${agent.id}-${tool.name}`}>{tool.name}</Tag>
                    ))}
                    {agent.toolManifest.length > 3 && (
                      <Tag>+{agent.toolManifest.length - 3}</Tag>
                    )}
                  </div>
                )}

                <div className="mt-auto flex justify-end border-t border-[var(--color-border-1)] pt-2">
                  <Button
                    size="mini"
                    status="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteAgent(workspaceSnapshot.workspaceId, agent);
                    }}
                  >
                    {t("ontology.editor.delete")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-80 items-center justify-center text-sm text-[var(--color-text-3)]">
          {agentEntries.length === 0
            ? t("ontology.agentManage.empty")
            : t("ontology.agentManage.noMatches")}
        </div>
      )}

      <Modal
        visible={currentDetailAgent !== null}
        title={currentDetailAgent?.name ?? t("ontology.agentManage.title")}
        footer={null}
        style={{ width: 760 }}
        onCancel={() => setDetailAgent(null)}
      >
        {currentDetailAgent && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniMetric
                label={t("ontology.console.columns.status")}
                value={t(
                  `ontology.agentManage.status.${agentManageStatus(currentDetailAgent)}`,
                )}
              />
              <MiniMetric
                label={t("ontology.console.columns.tools")}
                value={currentDetailAgent.toolManifest.length}
              />
              <MiniMetric
                label={t("ontology.stats.objects")}
                value={currentDetailAgent.entityIds.length}
              />
              <MiniMetric
                label={t("ontology.agentManage.ontologyService")}
                value={`${currentDetailSnapshot?.draft.title || currentDetailSnapshot?.workspaceId || "-"} · ${currentDetailVersion?.version ?? "-"}`}
              />
            </div>
            <div>
              <Typography.Text className="mb-1 block" type="secondary">
                {t("ontology.agent.promptTemplate")}
              </Typography.Text>
              <pre className="max-h-72 overflow-auto rounded bg-[var(--color-fill-2)] p-3 text-xs">
                {currentDetailAgent.promptTemplate}
              </pre>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border-2)] pt-4">
              <Button
                status="danger"
                onClick={() => {
                  onDeleteAgent(
                    currentDetailSnapshot?.workspaceId ?? "",
                    currentDetailAgent,
                  );
                  setDetailAgent(null);
                }}
              >
                {t("ontology.editor.delete")}
              </Button>
              {currentDetailAgent.status === "draft" && (
                <Button
                  type="primary"
                  loading={isRegisteringAgent}
                  onClick={() =>
                    void onRegisterAgent(
                      currentDetailSnapshot?.workspaceId ?? "",
                      currentDetailAgent,
                    )
                  }
                >
                  {t("ontology.agent.registerBlueprint")}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        visible={isCreateAgentModalVisible}
        title={t("ontology.agentManage.newAgent")}
        okText={t("ontology.agentManage.create")}
        cancelText={t("ontology.reset.cancel")}
        confirmLoading={isCreatingAgent}
        okButtonProps={{
          disabled:
            agentNameValue.trim().length === 0 ||
            selectedOntologyService === undefined,
        }}
        onOk={async () => {
          if (
            selectedOntologyService &&
            (await onCreateAgent(
              selectedOntologyService.workspaceSnapshot.workspaceId,
              selectedOntologyService.version.id,
            ))
          )
            setIsCreateAgentModalVisible(false);
        }}
        onCancel={() => setIsCreateAgentModalVisible(false)}
      >
        <Form layout="vertical">
          <Form.Item label={t("ontology.editor.name")} required>
            <Input
              value={agentNameValue}
              placeholder={t("ontology.agent.namePlaceholder")}
              onChange={onAgentNameChange}
            />
          </Form.Item>
          <Form.Item label={t("ontology.agentManage.ontologyService")} required>
            <Select
              value={selectedOntologyServiceKey || undefined}
              placeholder={t("ontology.agentManage.servicePlaceholder")}
              onChange={(value) => setSelectedOntologyServiceKey(String(value))}
            >
              {publishedServices.map(({ key, version, workspaceSnapshot }) => (
                <Option key={key} value={key}>
                  {workspaceSnapshot.draft.title ||
                    workspaceSnapshot.workspaceId}{" "}
                  · {version.version}
                  {version.isActive
                    ? ` · ${t("ontology.agentManage.servingVersion")}`
                    : ""}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Typography.Text type="secondary">
            {t("ontology.agentManage.sudocodeHint")}
          </Typography.Text>
        </Form>
      </Modal>
    </div>
  );
}

function PublishedArtifactSection({
  title,
  items,
  emptyText,
}: IPublishedArtifactSectionProps) {
  return (
    <div className={`${WORKBENCH_CARD_CLASS} p-5`}>
      <Typography.Text bold className="mb-4 block">
        {title}
      </Typography.Text>
      {items.length === 0 ? (
        <Empty description={emptyText} />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {items.slice(0, 6).map((item) => (
            <div
              key={item.id}
              className="rounded border border-[var(--color-border-2)] p-3"
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <Typography.Text bold>{item.name}</Typography.Text>
                <Tag>{item.meta}</Tag>
              </div>
              <Typography.Paragraph
                className="!mb-0 text-sm"
                type="secondary"
                ellipsis={{ rows: 2 }}
              >
                {item.description || "-"}
              </Typography.Paragraph>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function McpMetricCard({ title, value, suffix }: IMcpMetricCardProps) {
  return (
    <div className={`${WORKBENCH_CARD_CLASS} p-4`}>
      <Typography.Text className="block text-sm" type="secondary">
        {title}
      </Typography.Text>
      <div className="mt-2 flex items-end gap-1">
        <Typography.Text className="text-2xl font-semibold">
          {value}
        </Typography.Text>
        <Typography.Text className="pb-1 text-xs" type="secondary">
          {suffix}
        </Typography.Text>
      </div>
    </div>
  );
}

function buildOntologyCards(
  workbenches: IOntologyWorkbenchSummary[],
  t: TranslateFn,
): IOntologyListCard[] {
  return workbenches.map((item) => ({
    id: item.workspaceId,
    name: item.name || t("ontology.list.defaultName"),
    code: item.code || item.workspaceId,
    description: item.description,
    objects: item.objectCount,
    relations: item.relationCount,
    logic: item.logicCount,
    actions: item.actionCount,
    updatedAt: item.updatedAt,
  }));
}

function ontologyCodeFromTitle(title: string | undefined, fallback: string) {
  const normalized = (title ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback.slice(0, 12) || "ontology";
}

function downloadJsonFile(fileName: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function formatOntologyShortDate(value: number | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function ontologyObjectName(
  objects: IOntologyObjectDraft[],
  objectId: string,
): string {
  return objects.find((object) => object.id === objectId)?.name ?? objectId;
}

function versionStatusColor(
  status: IOntologyPublishedVersion["status"],
): string {
  if (status === "published") return "green";
  if (status === "approved") return "blue";
  if (status === "submitted") return "orange";
  if (status === "rejected") return "red";
  if (status === "rolled_back") return "gray";
  return "arcoblue";
}

function agentManageStatus(
  agent: IOntologyAgentBlueprint,
): Exclude<AgentManageStatusFilter, "all"> {
  return agent.status === "draft" ? "draft" : "published";
}

function buildMcpTools(
  _snapshot: IOntologyWorkbenchSnapshot,
  t: TranslateFn,
): IMcpToolDefinition[] {
  return [
    {
      name: "ontology_get_overview",
      description: t("ontology.mcpService.coreTools.overview"),
      inputSchema: { properties: {} },
    },
    {
      name: "ontology_search",
      description: t("ontology.mcpService.coreTools.query"),
      inputSchema: {
        properties: {
          query: {
            type: "string",
            description: t("ontology.mcpService.paramDescriptions.query"),
          },
          limit: {
            type: "number",
            description: t("ontology.mcpService.paramDescriptions.limit"),
          },
        },
        required: ["query"],
      },
    },
    {
      name: "ontology_get_object",
      description: t("ontology.mcpService.coreTools.object"),
      inputSchema: {
        properties: {
          id_or_code: {
            type: "string",
            description: t("ontology.mcpService.paramDescriptions.objectId"),
          },
        },
        required: ["id_or_code"],
      },
    },
    {
      name: "ontology_list_logic",
      description: t("ontology.mcpService.coreTools.logic"),
      inputSchema: { properties: {} },
    },
    {
      name: "ontology_list_actions",
      description: t("ontology.mcpService.coreTools.actions"),
      inputSchema: { properties: {} },
    },
  ];
}

function ConsoleStatistic({
  title,
  value,
  icon,
  valueClassName,
  iconClassName,
}: IConsoleStatisticProps) {
  return (
    <div className="flex min-w-24 items-center gap-3">
      {icon && <div className={iconClassName}>{icon}</div>}
      <div>
        <Typography.Text className="block text-sm" type="secondary">
          {title}
        </Typography.Text>
        <Typography.Text
          className={`text-2xl font-semibold ${valueClassName ?? ""}`}
        >
          {value}
        </Typography.Text>
      </div>
    </div>
  );
}

function ResourceCardStatistic({ label, value }: IResourceCardStatisticProps) {
  return (
    <div className="min-w-0 px-2 text-center">
      <Typography.Text className="ontology-resource-stat-value block text-lg font-semibold !text-[var(--color-text-1)]">
        {value}
      </Typography.Text>
      <Typography.Text className="block truncate text-xs" type="secondary">
        {label}
      </Typography.Text>
    </div>
  );
}

function ObjectBuildMethodOption({
  icon,
  title,
}: IObjectBuildMethodOptionProps) {
  return (
    <span className="flex size-full flex-col items-center justify-center gap-2 rounded-md px-3 py-3 text-center hover:bg-[var(--color-fill-2)]">
      <span className="text-[rgb(var(--primary-6))]">{icon}</span>
      <Typography.Text className="block text-sm font-medium">
        {title}
      </Typography.Text>
    </span>
  );
}

function ConsoleToolbar({
  searchValue,
  right,
  onSearchChange,
}: IConsoleToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded bg-[var(--color-bg-1)] p-3 shadow-sm">
      <Input
        className="max-w-sm"
        value={searchValue}
        prefix={<Search size={16} className="text-[var(--color-text-3)]" />}
        allowClear
        onChange={onSearchChange}
      />
      <span className="flex-1" />
      {right}
    </div>
  );
}

function SegmentedFilter<TValue extends string>({
  value,
  options,
  onValueChange,
}: ISegmentedFilterProps<TValue>) {
  return (
    <div className="flex rounded bg-[var(--color-fill-2)] p-1">
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <Button
            key={option.value}
            size="small"
            type="text"
            className={`!h-8 !px-4 ${isActive ? "!bg-[var(--color-bg-1)] !text-[rgb(var(--primary-6))] shadow-sm" : "!text-[var(--color-text-2)]"}`}
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

function ConnectorStatus({ connector }: IConnectorStatusProps) {
  const { t } = useTranslation();
  const color =
    connector.probeStatus === "reachable"
      ? "rgb(var(--success-6))"
      : connector.probeStatus === "failed"
        ? "rgb(var(--danger-6))"
        : "var(--color-text-3)";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="size-2 rounded-full" style={{ background: color }} />
      <span style={{ color }}>
        {t(`ontology.connectorStatus.${connector.probeStatus}`)}
      </span>
    </span>
  );
}

function AssetGrid({
  assets,
  profilingAssetId,
  syncingAssetId,
  onOpenAsset,
  onProfileAsset,
  onSyncAssetSchema,
  onDeleteAsset,
}: IAssetCatalogProps) {
  const { t } = useTranslation();
  if (assets.length === 0)
    return (
      <Empty
        className="rounded bg-[var(--color-bg-1)] py-12 shadow-sm"
        description={t("ontology.scan.empty")}
      />
    );
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {assets.map((asset) => (
        <div
          key={asset.id}
          role="button"
          tabIndex={0}
          className={`${WORKBENCH_INTERACTIVE_CARD_CLASS} group flex min-h-52 cursor-pointer flex-col p-4`}
          onClick={() => onOpenAsset(asset)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenAsset(asset);
            }
          }}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Typography.Text bold className="block truncate">
                {asset.name}
              </Typography.Text>
              {asset.sourceName && (
                <Typography.Text
                  className="block truncate text-xs"
                  type="secondary"
                >
                  {asset.sourceName}
                </Typography.Text>
              )}
            </div>
            <Tag color={assetKindColor(asset.kind)}>
              {t(`ontology.assetKind.${asset.kind}`)}
            </Tag>
          </div>
          <Typography.Paragraph
            className="!mb-3 min-h-10 text-sm"
            type="secondary"
            ellipsis={{ rows: 2 }}
          >
            {assetSummary(asset)}
          </Typography.Paragraph>
          <div className="mb-3 flex flex-wrap gap-1">
            {asset.fields.slice(0, 4).map((field) => (
              <Tag key={field.name}>{field.name}</Tag>
            ))}
            {asset.fields.length > 4 && <Tag>+{asset.fields.length - 4}</Tag>}
          </div>
          <div className="flex items-center justify-between border-t border-[var(--color-border-2)] pt-3 text-sm">
            <Typography.Text type="secondary">
              {t("ontology.console.columns.profile")}
            </Typography.Text>
            <Tag
              color={
                asset.profileStatus === "ready"
                  ? "green"
                  : asset.profileStatus === "failed"
                    ? "red"
                    : "gray"
              }
            >
              {t(`ontology.profileStatus.${asset.profileStatus}`)}
            </Tag>
          </div>
          <div
            className="mt-auto grid grid-cols-2 gap-2 border-t border-[var(--color-border-2)] pt-3 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              long
              size="mini"
              icon={<Eye size={13} />}
              onClick={() => onOpenAsset(asset)}
            >
              {t("ontology.asset.detail")}
            </Button>
            <Button
              long
              size="mini"
              icon={<Table2 size={13} />}
              loading={syncingAssetId === asset.id}
              disabled={asset.kind === "document"}
              onClick={() => void onSyncAssetSchema(asset)}
            >
              {t("ontology.asset.syncSchema")}
            </Button>
            <Button
              long
              size="mini"
              icon={<RefreshCw size={13} />}
              loading={profilingAssetId === asset.id}
              disabled={asset.kind === "document"}
              onClick={() => void onProfileAsset(asset)}
            >
              {t("ontology.asset.profile")}
            </Button>
            <Button
              long
              size="mini"
              status="danger"
              icon={<Trash2 size={13} />}
              onClick={() => onDeleteAsset(asset)}
            >
              {t("ontology.editor.delete")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AssetCatalogTable({
  assets,
  profilingAssetId,
  syncingAssetId,
  onOpenAsset,
  onProfileAsset,
  onSyncAssetSchema,
  onDeleteAsset,
}: IAssetCatalogProps) {
  const { t } = useTranslation();
  return (
    <Table
      className="rounded bg-[var(--color-bg-1)] shadow-sm"
      size="middle"
      rowKey="id"
      data={assets}
      pagination={{ pageSize: 20 }}
      columns={[
        {
          title: t("ontology.console.columns.name"),
          dataIndex: "name",
          ellipsis: true,
          render: (_: unknown, asset: IOntologyEnvironmentAsset) => (
            <Button type="text" size="small" onClick={() => onOpenAsset(asset)}>
              {asset.name}
            </Button>
          ),
        },
        {
          title: t("ontology.console.columns.type"),
          dataIndex: "kind",
          width: 120,
          render: (kind: OntologyAssetKind) => (
            <Tag color={assetKindColor(kind)}>
              {t(`ontology.assetKind.${kind}`)}
            </Tag>
          ),
        },
        {
          title: t("ontology.console.columns.locator"),
          ellipsis: true,
          render: (_: unknown, asset: IOntologyEnvironmentAsset) => (
            <code className="text-xs">
              {asset.path ?? asset.sourceName ?? "-"}
            </code>
          ),
        },
        {
          title: t("ontology.console.columns.fields"),
          width: 180,
          render: (_: unknown, asset: IOntologyEnvironmentAsset) =>
            asset.fields.length > 0
              ? t("ontology.console.fieldCount", { count: asset.fields.length })
              : "-",
        },
        {
          title: t("ontology.console.columns.profile"),
          dataIndex: "profileStatus",
          width: 130,
          render: (status: IOntologyEnvironmentAsset["profileStatus"]) => (
            <Tag
              color={
                status === "ready"
                  ? "green"
                  : status === "failed"
                    ? "red"
                    : "gray"
              }
            >
              {t(`ontology.profileStatus.${status}`)}
            </Tag>
          ),
        },
        {
          title: t("ontology.console.columns.actions"),
          width: 300,
          render: (_: unknown, asset: IOntologyEnvironmentAsset) => (
            <Space size={4} wrap>
              <Button
                type="text"
                size="small"
                icon={<Eye size={14} />}
                onClick={() => onOpenAsset(asset)}
              >
                {t("ontology.asset.detail")}
              </Button>
              <Button
                type="text"
                size="small"
                icon={<Table2 size={14} />}
                loading={syncingAssetId === asset.id}
                disabled={asset.kind === "document"}
                onClick={() => void onSyncAssetSchema(asset)}
              >
                {t("ontology.asset.syncSchema")}
              </Button>
              <Button
                type="text"
                size="small"
                icon={<RefreshCw size={14} />}
                loading={profilingAssetId === asset.id}
                disabled={asset.kind === "document"}
                onClick={() => void onProfileAsset(asset)}
              >
                {t("ontology.asset.profile")}
              </Button>
              <Button
                type="text"
                size="small"
                status="danger"
                icon={<Trash2 size={14} />}
                onClick={() => onDeleteAsset(asset)}
              >
                {t("ontology.editor.delete")}
              </Button>
            </Space>
          ),
        },
      ]}
    />
  );
}

function AssetDetailModal({
  asset,
  profilingAssetId,
  syncingAssetId,
  onProfileAsset,
  onSyncAssetSchema,
  onPreviewAsset,
  onClose,
}: IAssetDetailModalProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<IOntologyPreviewAssetResult | null>(
    null,
  );
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const isStructuredAsset =
    asset !== null &&
    (asset.kind === "database" ||
      asset.kind === "schema" ||
      asset.kind === "table");
  useEffect(() => setPreview(null), [asset?.id]);

  const onLoadPreview = async () => {
    if (!asset) return;
    setIsPreviewLoading(true);
    try {
      setPreview(await onPreviewAsset({ id: asset.id, limit: 20 }));
    } catch (err) {
      showError(t, err);
    } finally {
      setIsPreviewLoading(false);
    }
  };
  return (
    <Modal
      visible={asset !== null}
      title={asset?.name ?? t("ontology.asset.detail")}
      footer={null}
      style={{ width: 760 }}
      onCancel={onClose}
    >
      {asset && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded bg-[var(--color-fill-2)] p-3">
            <div className="min-w-0">
              <Typography.Text className="block text-xs" type="secondary">
                {t("ontology.asset.schemaSyncedAt")}
              </Typography.Text>
              <Typography.Text className="block truncate">
                {formatMetadataTime(asset.metadata.schemaSyncedAt)}
              </Typography.Text>
            </div>
            <Space wrap>
              <Button
                icon={<Table2 size={14} />}
                loading={syncingAssetId === asset.id}
                disabled={!isStructuredAsset}
                onClick={() => void onSyncAssetSchema(asset)}
              >
                {t("ontology.asset.syncSchema")}
              </Button>
              <Button
                icon={<RefreshCw size={14} />}
                loading={profilingAssetId === asset.id}
                disabled={!isStructuredAsset}
                onClick={() => void onProfileAsset(asset)}
              >
                {t("ontology.asset.profile")}
              </Button>
              <Button
                icon={<Eye size={14} />}
                loading={isPreviewLoading}
                onClick={() => void onLoadPreview()}
              >
                {t("ontology.asset.preview")}
              </Button>
            </Space>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MiniMetric
              label={t("ontology.console.columns.type")}
              value={t(`ontology.assetKind.${asset.kind}`)}
            />
            <MiniMetric
              label={t("ontology.console.columns.profile")}
              value={t(`ontology.profileStatus.${asset.profileStatus}`)}
            />
            <MiniMetric
              label={t("ontology.console.columns.fields")}
              value={asset.fields.length}
            />
            <MiniMetric
              label={t("ontology.console.columns.endpoint")}
              value={asset.sourceName ?? "-"}
            />
          </div>
          <div>
            <Typography.Text className="mb-1 block" type="secondary">
              {t("ontology.console.columns.locator")}
            </Typography.Text>
            <code className="block rounded bg-[var(--color-fill-2)] p-2 text-xs">
              {asset.path ?? asset.sourceName ?? "-"}
            </code>
          </div>
          <div>
            <Typography.Text className="mb-2 block" type="secondary">
              {t("ontology.asset.fields")}
            </Typography.Text>
            <Table
              size="small"
              rowKey="name"
              pagination={false}
              data={asset.fields}
              columns={[
                {
                  title: t("ontology.editor.name"),
                  dataIndex: "name",
                },
                {
                  title: t("ontology.editor.dataType"),
                  dataIndex: "dataType",
                  width: 160,
                },
                {
                  title: t("ontology.editor.required"),
                  width: 120,
                  render: (
                    _: unknown,
                    field: IOntologyEnvironmentAsset["fields"][number],
                  ) =>
                    field.nullable === false
                      ? t("ontology.editor.required")
                      : "-",
                },
              ]}
            />
          </div>
          <div>
            <Typography.Text className="mb-1 block" type="secondary">
              {t("ontology.asset.metadata")}
            </Typography.Text>
            <pre className="max-h-40 overflow-auto rounded bg-[var(--color-fill-2)] p-2 text-xs">
              {JSON.stringify(asset.metadata, null, 2)}
            </pre>
          </div>
          {preview && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <Typography.Text bold>
                  {t("ontology.asset.preview")}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {t("ontology.asset.previewRows", {
                    count: preview.rowsReturned,
                  })}
                </Typography.Text>
              </div>
              <Table
                size="small"
                pagination={false}
                scroll={{ x: Math.max(640, preview.columns.length * 160) }}
                data={buildPreviewTableRows(preview)}
                rowKey="key"
                columns={preview.columns.map((column) => ({
                  title: column,
                  dataIndex: column,
                  width: 160,
                  ellipsis: true,
                }))}
              />
              {preview.truncated && (
                <Typography.Text className="mt-2 block" type="secondary">
                  {t("ontology.asset.previewTruncated")}
                </Typography.Text>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Panel({ title, description, icon, children }: IPanelProps) {
  return (
    <section className={`${WORKBENCH_CARD_CLASS} min-w-0 p-4`}>
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 text-[rgb(var(--primary-6))]">{icon}</div>
        <div className="min-w-0">
          <Typography.Title heading={6} className="!mb-1">
            {title}
          </Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </div>
      </div>
      {children}
    </section>
  );
}

function ObjectAttributeList({
  object,
  isDisabled,
  onEditAttribute,
  onDeleteAttribute,
}: IObjectAttributeListProps) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Typography.Text bold>
          {t("ontology.objectBuilder.attributes", {
            count: object.attributes.length,
          })}
        </Typography.Text>
        <Button
          size="mini"
          disabled={isDisabled}
          onClick={() => onEditAttribute(object.id)}
        >
          {t("ontology.editor.addAttributeShort")}
        </Button>
      </div>
      {object.attributes.length === 0 ? (
        <Empty description={t("ontology.objectBuilder.emptyAttributes")} />
      ) : (
        <div className="flex flex-col gap-2">
          {object.attributes.map((attribute) => (
            <div
              key={attribute.id}
              className="flex flex-wrap items-center gap-3 rounded-lg bg-fill-1 px-3 py-2"
            >
              <div className="min-w-0 flex-1 basis-36">
                <Typography.Text
                  bold
                  className="block !truncate text-sm"
                  title={attribute.name}
                >
                  {attribute.name}
                </Typography.Text>
                <Typography.Text
                  className="block !truncate text-xs"
                  type="secondary"
                  title={attribute.code}
                >
                  {attribute.code}
                </Typography.Text>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Tag
                  color="arcoblue"
                  className="max-w-32"
                  title={attribute.dataType}
                >
                  <span>{attribute.dataType}</span>
                </Tag>
                {attribute.required && (
                  <Tag color="green">{t("ontology.editor.required")}</Tag>
                )}
              </div>
              <div className="flex max-w-full flex-wrap gap-2">
                <Button
                  size="mini"
                  disabled={isDisabled}
                  onClick={() => onEditAttribute(object.id, attribute)}
                >
                  {t("ontology.editor.edit")}
                </Button>
                <Button
                  size="mini"
                  status="danger"
                  disabled={isDisabled}
                  onClick={() =>
                    void onDeleteAttribute({
                      objectId: object.id,
                      attributeId: attribute.id,
                    })
                  }
                >
                  {t("ontology.editor.delete")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectTable({
  objects,
  selectedObjectIds,
  isAllSelected,
  onToggleAll,
  onToggleObject,
  onEditObject,
  onDeleteObject,
}: IObjectTableProps) {
  const { t } = useTranslation();
  if (objects.length === 0)
    return <Empty description={t("ontology.generate.emptyObjects")} />;
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      data={objects}
      columns={[
        {
          title: (
            <Checkbox
              aria-label={t("ontology.objectBuilder.selectAllObjects")}
              checked={isAllSelected}
              indeterminate={!isAllSelected && selectedObjectIds.length > 0}
              onChange={onToggleAll}
            />
          ),
          width: 52,
          render: (_: unknown, object: IOntologyObjectDraft) => (
            <Checkbox
              aria-label={t("ontology.objectBuilder.selectObjectNamed", {
                name: object.name,
              })}
              checked={selectedObjectIds.includes(object.id)}
              onChange={(isChecked) => onToggleObject(object.id, isChecked)}
            />
          ),
        },
        {
          title: t("ontology.objectBuilder.columns.displayName"),
          dataIndex: "name",
          ellipsis: true,
          render: (_: unknown, object: IOntologyObjectDraft) => (
            <Button
              type="text"
              size="small"
              className="!px-0"
              onClick={() => onEditObject(object)}
            >
              {object.name}
            </Button>
          ),
        },
        {
          title: t("ontology.objectBuilder.columns.code"),
          dataIndex: "code",
          ellipsis: true,
        },
        {
          title: t("ontology.generate.columns.attributes"),
          width: 100,
          render: (_: unknown, object: IOntologyObjectDraft) =>
            object.attributes.length,
        },
        {
          title: t("ontology.objectBuilder.columns.status"),
          width: 120,
          render: (_: unknown, object: IOntologyObjectDraft) => (
            <Tag
              color={object.reviewDecision === "approved" ? "green" : "gray"}
            >
              {t(
                `ontology.objectBuilder.objectState.${object.reviewDecision === "approved" ? "active" : "draft"}`,
              )}
            </Tag>
          ),
        },
        {
          title: t("ontology.objectBuilder.columns.actions"),
          width: 160,
          render: (_: unknown, object: IOntologyObjectDraft) => (
            <Space>
              <Button size="mini" onClick={() => onEditObject(object)}>
                {t("ontology.editor.edit")}
              </Button>
              <Button
                size="mini"
                status="danger"
                onClick={() => onDeleteObject(object)}
              >
                {t("ontology.editor.delete")}
              </Button>
            </Space>
          ),
        },
      ]}
    />
  );
}

function RelationTable({
  relations,
  objects,
  onEditRelation,
  onDeleteRelation,
}: IRelationTableProps) {
  const { t } = useTranslation();
  const objectNameById = useMemo(
    () => new Map(objects.map((object) => [object.id, object.name])),
    [objects],
  );
  if (relations.length === 0)
    return <Empty description={t("ontology.generate.emptyRelations")} />;
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      data={relations}
      columns={[
        {
          title: t("ontology.generate.columns.relation"),
          dataIndex: "name",
          ellipsis: true,
        },
        {
          title: t("ontology.generate.columns.endpoints"),
          width: 220,
          render: (_: unknown, relation: IOntologyRelationDraft) =>
            `${objectNameById.get(relation.fromObjectId) ?? "-"} -> ${objectNameById.get(relation.toObjectId) ?? "-"}`,
        },
        {
          title: t("ontology.generate.columns.relationSemantics"),
          width: 190,
          render: (_: unknown, relation: IOntologyRelationDraft) => (
            <Space size={4} wrap>
              <Tag>{t(`ontology.cardinality.${relation.cardinality}`)}</Tag>
              <Tag color="purple">
                {t(`ontology.editor.semanticType.${relation.semanticType}`)}
              </Tag>
            </Space>
          ),
        },
        {
          title: t("ontology.generate.columns.actions"),
          width: 160,
          render: (_: unknown, relation: IOntologyRelationDraft) => (
            <Space>
              <Button size="mini" onClick={() => onEditRelation(relation)}>
                {t("ontology.editor.edit")}
              </Button>
              <Button
                size="mini"
                status="danger"
                onClick={() => void onDeleteRelation(relation)}
              >
                {t("ontology.editor.delete")}
              </Button>
            </Space>
          ),
        },
      ]}
    />
  );
}

function OntologyGraph({ objects, relations }: IOntologyGraphProps) {
  const { t } = useTranslation();
  const option = useMemo(
    () => ({
      animationDuration: 350,
      tooltip: {},
      series: [
        {
          type: "graph",
          layout: "force",
          roam: true,
          draggable: true,
          force: {
            repulsion: 420,
            edgeLength: [120, 220],
            gravity: 0.08,
          },
          label: {
            show: true,
            position: "right",
            color: "#1d2129",
            fontSize: 12,
          },
          edgeLabel: {
            show: true,
            formatter: "{c}",
            color: "#4e5969",
            fontSize: 10,
          },
          lineStyle: {
            color: "#86909c",
            width: 1.5,
            curveness: 0.08,
          },
          emphasis: {
            focus: "adjacency",
            lineStyle: { width: 3 },
          },
          itemStyle: { color: "#165dff" },
          data: objects.map((object) => ({
            id: object.id,
            name: object.name,
            value: object.description || object.code,
            symbolSize: Math.min(64, 34 + object.attributes.length * 3),
          })),
          links: relations.map((relation) => ({
            source: relation.fromObjectId,
            target: relation.toObjectId,
            value: `${relation.name} · ${relation.cardinality}`,
          })),
        },
      ],
    }),
    [objects, relations],
  );

  if (objects.length === 0)
    return <Empty description={t("ontology.generate.emptyObjects")} />;
  return (
    <ReactECharts
      option={option}
      notMerge
      lazyUpdate
      style={{ width: "100%", height: 560 }}
    />
  );
}

function MiniMetric({ label, value }: IMiniMetricProps) {
  return (
    <div className="rounded border border-[var(--color-border-2)] px-3 py-2">
      <Typography.Text className="block text-xs" type="secondary">
        {label}
      </Typography.Text>
      <Typography.Text bold>{value}</Typography.Text>
    </div>
  );
}

function MappingTable({
  mappings,
  objects,
  assets,
  onEditMapping,
  onDeleteMapping,
}: IMappingTableProps) {
  const { t } = useTranslation();
  const objectById = useMemo(
    () => new Map(objects.map((object) => [object.id, object])),
    [objects],
  );
  const assetNameById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset.name])),
    [assets],
  );
  if (mappings.length === 0)
    return <Empty description={t("ontology.mapping.emptyMappings")} />;
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      data={mappings}
      columns={[
        {
          title: t("ontology.mapping.columns.object"),
          render: (_: unknown, mapping: IOntologyFieldMapping) =>
            objectById.get(mapping.objectId)?.name ?? "-",
        },
        {
          title: t("ontology.mapping.columns.field"),
          render: (_: unknown, mapping: IOntologyFieldMapping) =>
            `${assetNameById.get(mapping.assetId) ?? "-"} / ${mapping.fieldName}`,
        },
        {
          title: t("ontology.mapping.columns.confidence"),
          width: 120,
          render: (_: unknown, mapping: IOntologyFieldMapping) =>
            `${Math.round(mapping.confidence * 100)}%`,
        },
        {
          title: t("ontology.mapping.columns.strategy"),
          dataIndex: "strategy",
          width: 120,
          render: (strategy: IOntologyFieldMapping["strategy"]) => (
            <Tag>{t(`ontology.mappingStrategy.${strategy}`)}</Tag>
          ),
        },
        {
          title: t("ontology.generate.columns.actions"),
          width: 150,
          render: (_: unknown, mapping: IOntologyFieldMapping) => (
            <Space>
              <Button size="mini" onClick={() => onEditMapping(mapping)}>
                {t("ontology.editor.edit")}
              </Button>
              <Button
                size="mini"
                status="danger"
                onClick={() => void onDeleteMapping(mapping)}
              >
                {t("ontology.editor.delete")}
              </Button>
            </Space>
          ),
        },
      ]}
    />
  );
}

function QualityRuleList({
  rules,
  objects,
  onEditRule,
  onDeleteRule,
}: IQualityRuleListProps) {
  const { t } = useTranslation();
  const objectNameById = useMemo(
    () => new Map(objects.map((object) => [object.id, object.name])),
    [objects],
  );
  if (rules.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {rules.slice(0, 4).map((rule) => (
        <div
          key={rule.id}
          className="rounded border border-[var(--color-border-2)] p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Typography.Text bold>{rule.name}</Typography.Text>
            <Space>
              <Tag
                color={
                  rule.severity === "error"
                    ? "red"
                    : rule.severity === "warning"
                      ? "orange"
                      : "arcoblue"
                }
              >
                {t(`ontology.ruleSeverity.${rule.severity}`)}
              </Tag>
              <Button size="mini" onClick={() => onEditRule(rule)}>
                {t("ontology.editor.edit")}
              </Button>
              <Button
                size="mini"
                status="danger"
                onClick={() => void onDeleteRule(rule)}
              >
                {t("ontology.editor.delete")}
              </Button>
            </Space>
          </div>
          <Typography.Text className="mt-1 block" type="secondary">
            {objectNameById.get(rule.objectId) ?? "-"} · {rule.expression}
          </Typography.Text>
        </div>
      ))}
    </div>
  );
}

function RuntimeArtifacts({
  documents,
  functions,
  actions,
  endpoints,
  objects,
  stats,
  onUpsertLogicFunction,
  onDeleteLogicFunction,
  onUpsertAction,
  onDeleteAction,
}: IRuntimeArtifactsProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<RuntimeArtifactDetail | null>(null);
  const [editingLogicFunction, setEditingLogicFunction] =
    useState<IOntologyLogicFunction | null>(null);
  const [isLogicFunctionModalVisible, setIsLogicFunctionModalVisible] =
    useState(false);
  const [logicFunctionName, setLogicFunctionName] = useState("");
  const [logicFunctionCode, setLogicFunctionCode] = useState("");
  const [logicFunctionDescription, setLogicFunctionDescription] = useState("");
  const [logicFunctionRuntime, setLogicFunctionRuntime] =
    useState<IOntologyLogicFunction["runtime"]>("typescript");
  const [logicFunctionObjectIds, setLogicFunctionObjectIds] = useState<
    string[]
  >([]);
  const [logicFunctionSignature, setLogicFunctionSignature] = useState("");
  const [logicFunctionBody, setLogicFunctionBody] = useState("");
  const [logicFunctionReturnType, setLogicFunctionReturnType] =
    useState("unknown");
  const [logicFunctionParameters, setLogicFunctionParameters] = useState("[]");
  const [editingAction, setEditingAction] =
    useState<IOntologyActionDefinition | null>(null);
  const [isActionModalVisible, setIsActionModalVisible] = useState(false);
  const [actionName, setActionName] = useState("");
  const [actionCode, setActionCode] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [actionExecutor, setActionExecutor] =
    useState<IOntologyActionDefinition["executor"]>("function");
  const [actionObjectIds, setActionObjectIds] = useState<string[]>([]);
  const [actionConfiguration, setActionConfiguration] = useState("{}");
  const [isSavingRuntimeArtifact, setIsSavingRuntimeArtifact] = useState(false);

  const onOpenLogicFunctionEditor = (
    logicFunction?: IOntologyLogicFunction,
  ) => {
    setEditingLogicFunction(logicFunction ?? null);
    setLogicFunctionName(logicFunction?.name ?? "");
    setLogicFunctionCode(logicFunction?.code ?? "");
    setLogicFunctionDescription(logicFunction?.description ?? "");
    setLogicFunctionRuntime(logicFunction?.runtime ?? "typescript");
    setLogicFunctionObjectIds(logicFunction?.objectIds ?? []);
    setLogicFunctionSignature(logicFunction?.signature ?? "");
    setLogicFunctionBody(logicFunction?.body ?? "");
    setLogicFunctionReturnType(logicFunction?.returnType ?? "unknown");
    setLogicFunctionParameters(
      JSON.stringify(logicFunction?.parameters ?? [], null, 2),
    );
    setIsLogicFunctionModalVisible(true);
  };

  const onSaveLogicFunction = async () => {
    setIsSavingRuntimeArtifact(true);
    try {
      const parameters = parseJsonArray<IOntologyLogicFunction["parameters"]>(
        logicFunctionParameters,
        t("ontology.runtime.invalidParameters"),
      );
      await onUpsertLogicFunction({
        id: editingLogicFunction?.id,
        name: logicFunctionName,
        code: logicFunctionCode,
        description: logicFunctionDescription,
        runtime: logicFunctionRuntime,
        objectIds: logicFunctionObjectIds,
        signature: logicFunctionSignature,
        body: logicFunctionBody,
        returnType: logicFunctionReturnType,
        parameters,
        status: editingLogicFunction?.status ?? "active",
      });
      setIsLogicFunctionModalVisible(false);
    } catch (err) {
      showError(t, err);
    } finally {
      setIsSavingRuntimeArtifact(false);
    }
  };

  const onOpenActionEditor = (action?: IOntologyActionDefinition) => {
    setEditingAction(action ?? null);
    setActionName(action?.name ?? "");
    setActionCode(action?.code ?? "");
    setActionDescription(action?.description ?? "");
    setActionExecutor(action?.executor ?? "function");
    setActionObjectIds(action?.objectIds ?? []);
    setActionConfiguration(
      JSON.stringify(action?.configuration ?? {}, null, 2),
    );
    setIsActionModalVisible(true);
  };

  const onSaveAction = async () => {
    setIsSavingRuntimeArtifact(true);
    try {
      const configuration = parseJsonObject<
        IOntologyActionDefinition["configuration"]
      >(actionConfiguration, t("ontology.runtime.invalidConfiguration"));
      await onUpsertAction({
        id: editingAction?.id,
        name: actionName,
        code: actionCode,
        description: actionDescription,
        executor: actionExecutor,
        objectIds: actionObjectIds,
        configuration,
        parameters: editingAction?.parameters ?? [],
        outputSchema: editingAction?.outputSchema ?? [],
        status: editingAction?.status ?? "active",
      });
      setIsActionModalVisible(false);
    } catch (err) {
      showError(t, err);
    } finally {
      setIsSavingRuntimeArtifact(false);
    }
  };

  const onConfirmDeleteLogicFunction = (
    logicFunction: IOntologyLogicFunction,
  ) => {
    Modal.confirm({
      title: t("ontology.runtime.deleteFunctionTitle"),
      content: t("ontology.runtime.deleteFunctionContent", {
        name: logicFunction.name,
      }),
      okText: t("ontology.editor.delete"),
      cancelText: t("ontology.reset.cancel"),
      okButtonProps: { status: "danger" },
      onOk: () => onDeleteLogicFunction(logicFunction),
    });
  };

  const onConfirmDeleteAction = (action: IOntologyActionDefinition) => {
    Modal.confirm({
      title: t("ontology.runtime.deleteActionTitle"),
      content: t("ontology.runtime.deleteActionContent", { name: action.name }),
      okText: t("ontology.editor.delete"),
      cancelText: t("ontology.reset.cancel"),
      okButtonProps: { status: "danger" },
      onOk: () => onDeleteAction(action),
    });
  };
  const onCopyEndpoint = async (endpoint: IOntologyServiceEndpoint) => {
    try {
      await navigator.clipboard.writeText(buildRuntimeEndpointConfig(endpoint));
      Message.success(t("ontology.runtime.copied"));
    } catch {
      Message.error(t("ontology.errors.operationFailed"));
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <MiniMetric
          label={t("ontology.runtime.functions")}
          value={stats.logicFunctionCount}
        />
        <MiniMetric
          label={t("ontology.runtime.actions")}
          value={stats.actionCount}
        />
        <MiniMetric
          label={t("ontology.runtime.endpoints")}
          value={stats.serviceEndpointCount}
        />
        <MiniMetric
          label={t("ontology.runtime.documents")}
          value={documents.length}
        />
      </div>
      <div className="flex flex-col gap-2">
        {endpoints.length === 0 ? (
          <Empty description={t("ontology.runtime.empty")} />
        ) : (
          endpoints.map((endpoint) => (
            <div
              key={endpoint.id}
              className="rounded border border-[var(--color-border-2)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Cable
                    size={16}
                    className="shrink-0 text-[rgb(var(--primary-6))]"
                  />
                  <Typography.Text bold className="truncate">
                    {endpoint.name}
                  </Typography.Text>
                </div>
                <Tag color={endpoint.status === "active" ? "green" : "gray"}>
                  {t(`ontology.artifactStatus.${endpoint.status}`)}
                </Tag>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <Typography.Text type="secondary">
                  {endpoint.protocol.toUpperCase()} ·{" "}
                  {t("ontology.runtime.toolCount", {
                    count: endpoint.toolCount,
                  })}
                </Typography.Text>
                <Space size={4}>
                  <Button
                    size="mini"
                    icon={<Copy size={13} />}
                    onClick={() => void onCopyEndpoint(endpoint)}
                  >
                    {t("ontology.runtime.copy")}
                  </Button>
                  <Button
                    size="mini"
                    onClick={() =>
                      setDetail({ kind: "endpoint", item: endpoint })
                    }
                  >
                    {t("ontology.asset.detail")}
                  </Button>
                </Space>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="rounded border border-[var(--color-border-2)] p-3">
        <div className="flex items-center justify-between gap-2">
          <Typography.Text bold>
            {t("ontology.runtime.functions")}
          </Typography.Text>
          <Button
            size="mini"
            type="primary"
            icon={<FilePlus2 size={13} />}
            onClick={() => onOpenLogicFunctionEditor()}
          >
            {t("ontology.editor.add")}
          </Button>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {functions.length === 0 ? (
            <Typography.Text type="secondary">
              {t("ontology.runtime.emptyFunctions")}
            </Typography.Text>
          ) : (
            functions.map((logicFunction) => (
              <div
                key={logicFunction.id}
                className="flex items-center justify-between gap-3 rounded bg-[var(--color-fill-2)] px-3 py-2"
              >
                <div className="min-w-0">
                  <Typography.Text className="block truncate">
                    {logicFunction.name}
                  </Typography.Text>
                  <Typography.Text
                    className="block truncate text-xs"
                    type="secondary"
                  >
                    {logicFunction.code} · {logicFunction.runtime}
                  </Typography.Text>
                </div>
                <Space size={4}>
                  <Button
                    size="mini"
                    onClick={() =>
                      setDetail({ kind: "function", item: logicFunction })
                    }
                  >
                    {t("ontology.asset.detail")}
                  </Button>
                  <Button
                    size="mini"
                    onClick={() => onOpenLogicFunctionEditor(logicFunction)}
                  >
                    {t("ontology.editor.edit")}
                  </Button>
                  <Button
                    size="mini"
                    status="danger"
                    onClick={() => onConfirmDeleteLogicFunction(logicFunction)}
                  >
                    {t("ontology.editor.delete")}
                  </Button>
                </Space>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="rounded border border-[var(--color-border-2)] p-3">
        <div className="flex items-center justify-between gap-2">
          <Typography.Text bold>
            {t("ontology.runtime.actions")}
          </Typography.Text>
          <Button
            size="mini"
            type="primary"
            icon={<FilePlus2 size={13} />}
            onClick={() => onOpenActionEditor()}
          >
            {t("ontology.editor.add")}
          </Button>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {actions.length === 0 ? (
            <Typography.Text type="secondary">
              {t("ontology.runtime.emptyActions")}
            </Typography.Text>
          ) : (
            actions.map((action) => (
              <div
                key={action.id}
                className="flex items-center justify-between gap-3 rounded bg-[var(--color-fill-2)] px-3 py-2"
              >
                <div className="min-w-0">
                  <Typography.Text className="block truncate">
                    {action.name}
                  </Typography.Text>
                  <Typography.Text
                    className="block truncate text-xs"
                    type="secondary"
                  >
                    {action.code} · {action.executor}
                  </Typography.Text>
                </div>
                <Space size={4}>
                  <Button
                    size="mini"
                    onClick={() => setDetail({ kind: "action", item: action })}
                  >
                    {t("ontology.asset.detail")}
                  </Button>
                  <Button
                    size="mini"
                    onClick={() => onOpenActionEditor(action)}
                  >
                    {t("ontology.editor.edit")}
                  </Button>
                  <Button
                    size="mini"
                    status="danger"
                    onClick={() => onConfirmDeleteAction(action)}
                  >
                    {t("ontology.editor.delete")}
                  </Button>
                </Space>
              </div>
            ))
          )}
        </div>
      </div>
      <RuntimeArtifactSection
        title={t("ontology.runtime.documents")}
        emptyText={t("ontology.runtime.emptyDocuments")}
        items={documents}
        getTitle={(item) => item.title}
        getSubtitle={(item) => item.format.toUpperCase()}
        onOpen={(item) => setDetail({ kind: "document", item })}
      />
      <Typography.Text type="secondary">
        {t("ontology.runtime.summary", {
          functions: functions.length,
          actions: actions.length,
        })}
      </Typography.Text>
      <RuntimeArtifactDetailModal
        detail={detail}
        onClose={() => setDetail(null)}
      />
      <Modal
        visible={isLogicFunctionModalVisible}
        title={
          editingLogicFunction
            ? t("ontology.runtime.editFunction")
            : t("ontology.runtime.addFunction")
        }
        okText={t("ontology.editor.save")}
        cancelText={t("ontology.reset.cancel")}
        confirmLoading={isSavingRuntimeArtifact}
        style={{ width: 760 }}
        onOk={() => void onSaveLogicFunction()}
        onCancel={() => setIsLogicFunctionModalVisible(false)}
      >
        <Form layout="vertical">
          <div className="grid grid-cols-1 gap-x-3 md:grid-cols-2">
            <Form.Item label={t("ontology.editor.name")} required>
              <Input
                value={logicFunctionName}
                onChange={setLogicFunctionName}
              />
            </Form.Item>
            <Form.Item label={t("ontology.editor.code")}>
              <Input
                value={logicFunctionCode}
                onChange={setLogicFunctionCode}
              />
            </Form.Item>
            <Form.Item label={t("ontology.runtime.runtime")}>
              <Select
                value={logicFunctionRuntime}
                onChange={(value) =>
                  setLogicFunctionRuntime(
                    value as IOntologyLogicFunction["runtime"],
                  )
                }
              >
                {(["typescript", "python", "sql"] as const).map((runtime) => (
                  <Option key={runtime} value={runtime}>
                    {runtime}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label={t("ontology.runtime.returnType")}>
              <Input
                value={logicFunctionReturnType}
                onChange={setLogicFunctionReturnType}
              />
            </Form.Item>
          </div>
          <Form.Item label={t("ontology.runtime.boundObjects")}>
            <Select
              mode="multiple"
              value={logicFunctionObjectIds}
              allowClear
              onChange={(value) => setLogicFunctionObjectIds(value.map(String))}
            >
              {objects.map((object) => (
                <Option key={object.id} value={object.id}>
                  {object.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label={t("ontology.editor.description")}>
            <TextArea
              value={logicFunctionDescription}
              autoSize={{ minRows: 2, maxRows: 4 }}
              onChange={setLogicFunctionDescription}
            />
          </Form.Item>
          <Form.Item label={t("ontology.runtime.signature")}>
            <Input
              value={logicFunctionSignature}
              onChange={setLogicFunctionSignature}
            />
          </Form.Item>
          <Form.Item label={t("ontology.runtime.parametersJson")}>
            <TextArea
              value={logicFunctionParameters}
              autoSize={{ minRows: 3, maxRows: 8 }}
              onChange={setLogicFunctionParameters}
            />
          </Form.Item>
          <Form.Item label={t("ontology.runtime.body")}>
            <TextArea
              value={logicFunctionBody}
              autoSize={{ minRows: 7, maxRows: 16 }}
              onChange={setLogicFunctionBody}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        visible={isActionModalVisible}
        title={
          editingAction
            ? t("ontology.runtime.editAction")
            : t("ontology.runtime.addAction")
        }
        okText={t("ontology.editor.save")}
        cancelText={t("ontology.reset.cancel")}
        confirmLoading={isSavingRuntimeArtifact}
        style={{ width: 720 }}
        onOk={() => void onSaveAction()}
        onCancel={() => setIsActionModalVisible(false)}
      >
        <Form layout="vertical">
          <div className="grid grid-cols-1 gap-x-3 md:grid-cols-2">
            <Form.Item label={t("ontology.editor.name")} required>
              <Input value={actionName} onChange={setActionName} />
            </Form.Item>
            <Form.Item label={t("ontology.editor.code")}>
              <Input value={actionCode} onChange={setActionCode} />
            </Form.Item>
          </div>
          <Form.Item label={t("ontology.runtime.executor")}>
            <Select
              value={actionExecutor}
              onChange={(value) =>
                setActionExecutor(
                  value as IOntologyActionDefinition["executor"],
                )
              }
            >
              {(
                [
                  "function",
                  "api",
                  "sql",
                  "notification",
                  "custom_script",
                ] as const
              ).map((executor) => (
                <Option key={executor} value={executor}>
                  {t(`ontology.runtime.executors.${executor}`)}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label={t("ontology.runtime.boundObjects")}>
            <Select
              mode="multiple"
              value={actionObjectIds}
              allowClear
              onChange={(value) => setActionObjectIds(value.map(String))}
            >
              {objects.map((object) => (
                <Option key={object.id} value={object.id}>
                  {object.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label={t("ontology.editor.description")}>
            <TextArea
              value={actionDescription}
              autoSize={{ minRows: 2, maxRows: 4 }}
              onChange={setActionDescription}
            />
          </Form.Item>
          <Form.Item label={t("ontology.runtime.configurationJson")}>
            <TextArea
              value={actionConfiguration}
              autoSize={{ minRows: 7, maxRows: 16 }}
              onChange={setActionConfiguration}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function RuntimeArtifactSection<TItem extends { id: string }>({
  title,
  emptyText,
  items,
  getTitle,
  getSubtitle,
  onOpen,
}: IRuntimeArtifactSectionProps<TItem>) {
  const { t } = useTranslation();
  return (
    <div className="rounded border border-[var(--color-border-2)] p-3">
      <Typography.Text bold>{title}</Typography.Text>
      <div className="mt-2 flex flex-col gap-2">
        {items.length === 0 ? (
          <Typography.Text type="secondary">{emptyText}</Typography.Text>
        ) : (
          items.slice(0, 6).map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded bg-[var(--color-fill-2)] px-3 py-2"
            >
              <div className="min-w-0">
                <Typography.Text className="block truncate">
                  {getTitle(item)}
                </Typography.Text>
                {getSubtitle && (
                  <Typography.Text
                    className="block truncate text-xs"
                    type="secondary"
                  >
                    {getSubtitle(item)}
                  </Typography.Text>
                )}
              </div>
              <Button size="mini" onClick={() => onOpen(item)}>
                {t("ontology.asset.detail")}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RuntimeArtifactDetailModal({
  detail,
  onClose,
}: IRuntimeArtifactDetailModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={detail !== null}
      title={
        detail
          ? t("ontology.runtime.detailTitle", {
              name: runtimeArtifactName(detail),
            })
          : ""
      }
      footer={null}
      style={{ width: 760 }}
      onCancel={onClose}
    >
      {detail && (
        <pre className="max-h-[560px] overflow-auto rounded bg-[var(--color-fill-2)] p-3 text-xs">
          {JSON.stringify(runtimeArtifactPayload(detail), null, 2)}
        </pre>
      )}
    </Modal>
  );
}

function ImpactAndMonitor({
  impactAnalyses,
  monitorEvents,
}: IImpactAndMonitorProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      {impactAnalyses.slice(0, 3).map((impact) => (
        <div
          key={impact.id}
          className="rounded border border-[var(--color-border-2)] p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <Typography.Text bold>{impact.summary}</Typography.Text>
            <Tag
              color={
                impact.riskLevel === "high"
                  ? "red"
                  : impact.riskLevel === "medium"
                    ? "orange"
                    : "green"
              }
            >
              {t(`ontology.riskLevel.${impact.riskLevel}`)}
            </Tag>
          </div>
          <Typography.Text className="mt-1 block" type="secondary">
            {t("ontology.monitor.affected", {
              objects: impact.affectedObjectIds.length,
              relations: impact.affectedRelationIds.length,
            })}
          </Typography.Text>
        </div>
      ))}
      {monitorEvents.length === 0 ? (
        <Empty description={t("ontology.monitor.empty")} />
      ) : (
        monitorEvents.slice(0, 4).map((event) => (
          <div key={event.id} className="flex items-start gap-2 text-sm">
            <Tag
              color={
                event.level === "error"
                  ? "red"
                  : event.level === "warning"
                    ? "orange"
                    : "arcoblue"
              }
            >
              {t(`ontology.monitorLevel.${event.level}`)}
            </Tag>
            <Typography.Text type="secondary">{event.message}</Typography.Text>
          </div>
        ))
      )}
    </div>
  );
}

function ReviewDecisionTag({ decision }: IReviewDecisionTagProps) {
  const { t } = useTranslation();
  const color =
    decision === "approved"
      ? "green"
      : decision === "pending"
        ? "gray"
        : decision === "rejected"
          ? "red"
          : "orange";
  return <Tag color={color}>{t(`ontology.reviewDecision.${decision}`)}</Tag>;
}

function ReviewLog({ count }: IReviewLogProps) {
  const { t } = useTranslation();
  return (
    <Typography.Text type="secondary">
      {t("ontology.review.logCount", { count })}
    </Typography.Text>
  );
}

function ConsistencyCheckResult({ result }: IConsistencyCheckResultProps) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 rounded border border-[var(--color-border-2)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Typography.Text bold>
          {t("ontology.publish.checkResult")}
        </Typography.Text>
        <Tag color={result.isValid ? "green" : "red"}>
          {t(
            result.isValid
              ? "ontology.publish.valid"
              : "ontology.publish.invalid",
          )}
        </Tag>
      </div>
      {result.issues.length === 0 ? (
        <Typography.Text type="secondary">
          {t("ontology.publish.noIssues")}
        </Typography.Text>
      ) : (
        <div className="flex flex-col gap-1">
          {result.issues.map((issue) => (
            <Typography.Text
              key={issue.id}
              type={issue.severity === "error" ? "error" : "secondary"}
            >
              {issue.message}
            </Typography.Text>
          ))}
        </div>
      )}
    </div>
  );
}

function connectorEndpoint(connector: IOntologyConnectorConfig): string {
  if (connector.url) return connector.url;
  if (connector.path) return connector.path;
  if (connector.kind === "database" && connector.host) {
    return `${connector.host}:${connector.port ?? ""}/${connector.database || "-"}`;
  }
  if (connector.sourceType === "s3") {
    return `${connector.params?.endpoint || "aws"}/${connector.params?.bucket || "-"}`;
  }
  if (connector.sourceType === "ftp" || connector.sourceType === "sftp") {
    return `${connector.sourceType}://${connector.params?.host || ""}:${connector.params?.port || ""}${connector.params?.root_path || ""}`;
  }
  if (connector.sourceType === "kafka") {
    return String(connector.params?.brokers || "-");
  }
  if (connector.sourceType === "rest") {
    return String(connector.params?.base_url || "-");
  }
  const host = connector.metadata.host;
  const port = connector.metadata.port;
  const database = connector.metadata.database;
  if (typeof host === "string")
    return `${host}:${port ?? ""}/${database || "-"}`;
  return "-";
}

function connectorDisplayName(connector: IOntologyConnectorConfig): string {
  return typeof connector.metadata.displayName === "string" &&
    connector.metadata.displayName.trim()
    ? connector.metadata.displayName
    : connector.name.split("::", 1)[0];
}

function assetSummary(asset: IOntologyEnvironmentAsset): string {
  if (asset.path) return asset.path;
  const fields = asset.fields
    .map((field) => field.name)
    .slice(0, 4)
    .join(" / ");
  return fields || "-";
}

function formatMetadataTime(
  value: string | number | boolean | null | undefined,
): string {
  if (typeof value !== "number" && typeof value !== "string") return "-";
  const timestamp =
    typeof value === "number" ? value : Number.parseInt(value, 10);
  if (Number.isNaN(timestamp)) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function buildPreviewTableRows(
  preview: IOntologyPreviewAssetResult,
): Array<Record<string, string | number | boolean | null>> {
  return preview.rows.map((row, rowIndex) =>
    Object.fromEntries([
      ["key", rowIndex],
      ...preview.columns.map((column, columnIndex) => [
        column,
        row[columnIndex],
      ]),
    ]),
  );
}

function buildRuntimeEndpointConfig(
  endpoint: IOntologyServiceEndpoint,
): string {
  return JSON.stringify(
    {
      name: endpoint.name,
      protocol: endpoint.protocol,
      endpoint: `ontology://${endpoint.protocol}/${endpoint.id}`,
      tools: endpoint.toolCount,
      status: endpoint.status,
    },
    null,
    2,
  );
}

function runtimeArtifactName(detail: RuntimeArtifactDetail): string {
  if (detail.kind === "document") return detail.item.title;
  return detail.item.name;
}

function runtimeArtifactPayload(detail: RuntimeArtifactDetail): unknown {
  if (detail.kind === "endpoint") {
    return {
      ...detail.item,
      clientConfig: JSON.parse(buildRuntimeEndpointConfig(detail.item)),
    };
  }
  return detail.item;
}

function assetKindColor(kind: OntologyAssetKind): string {
  if (kind === "database" || kind === "schema" || kind === "table")
    return "arcoblue";
  if (kind === "document" || kind === "directory") return "orange";
  if (kind === "api") return "purple";
  if (kind === "mq") return "green";
  if (kind === "oss") return "cyan";
  return "gray";
}

function connectorKindFromSourceType(
  sourceType: OntologyConnectionSourceType,
): IOntologyConnectorInput["kind"] {
  if (
    sourceType === "sqlite" ||
    sourceType === "mysql" ||
    sourceType === "postgresql" ||
    sourceType === "oracle" ||
    sourceType === "sqlserver"
  )
    return "database";
  if (sourceType === "openapi" || sourceType === "rest") return "api";
  if (sourceType === "mq" || sourceType === "kafka") return "mq";
  if (sourceType === "oss" || sourceType === "s3") return "oss";
  if (
    sourceType === "directory" ||
    sourceType === "ftp" ||
    sourceType === "sftp"
  )
    return "directory";
  return "document";
}

function isConnectorSourceTypeInCategory(
  category: ConnectorCategoryKey,
  sourceType: OntologyConnectionSourceType,
): boolean {
  return (
    CONNECTOR_TYPE_OPTIONS_BY_CATEGORY[
      category
    ] as OntologyConnectionSourceType[]
  ).includes(sourceType);
}

function createDefaultConnectorFormValues(
  sourceType: OntologyConnectionSourceType,
): ConnectorFormValues {
  const common = { poolSize: 4, rateLimitQps: 20, description: "" };
  if (sourceType === "mysql") {
    return {
      ...common,
      host: "",
      port: 3306,
      database: "",
      username: "",
      password: "",
      writable: false,
    };
  }
  if (sourceType === "postgresql") {
    return {
      ...common,
      host: "",
      port: 5432,
      database: "",
      username: "",
      password: "",
      writable: false,
    };
  }
  if (sourceType === "oracle" || sourceType === "sqlserver") {
    return {
      ...common,
      host: "",
      port: sourceType === "oracle" ? 1521 : 1433,
      database: "",
      username: "",
      password: "",
      writable: false,
    };
  }
  if (sourceType === "s3") {
    return {
      ...common,
      endpoint: "",
      region: "",
      bucket: "",
      pathStyle: false,
      accessKey: "",
      secretKey: "",
    };
  }
  if (sourceType === "ftp") {
    return {
      ...common,
      host: "",
      port: 21,
      rootPath: "/",
      useTls: false,
      username: "",
      password: "",
    };
  }
  if (sourceType === "sftp") {
    return {
      ...common,
      host: "",
      port: 22,
      rootPath: "/",
      username: "",
      password: "",
    };
  }
  if (sourceType === "kafka") {
    return {
      ...common,
      brokers: "",
      securityProtocol: "PLAINTEXT",
      username: "",
      password: "",
    };
  }
  if (sourceType === "rest") {
    return {
      ...common,
      baseUrl: "",
      probePath: "/",
      authType: "none",
      token: "",
      username: "",
      password: "",
      apiKeyName: "X-API-Key",
      apiKeyValue: "",
    };
  }
  return common;
}

function createConnectorFormValuesFromConfig(
  connector: IOntologyConnectorConfig,
): ConnectorFormValues {
  const defaults = createDefaultConnectorFormValues(connector.sourceType);
  const params = connector.params ?? {};
  const credential = connector.credential ?? {};
  if (
    connector.sourceType === "mysql" ||
    connector.sourceType === "postgresql" ||
    connector.sourceType === "oracle" ||
    connector.sourceType === "sqlserver"
  ) {
    return {
      ...defaults,
      host: connector.host ?? "",
      port: connector.port ?? defaults.port,
      database: connector.database ?? "",
      username: connector.username ?? "",
      password: connector.password ?? "",
      writable: connector.writable ?? false,
      poolSize: connector.poolSize ?? defaults.poolSize,
      rateLimitQps: connector.rateLimitQps ?? defaults.rateLimitQps,
      description: connector.description ?? "",
    };
  }
  if (connector.sourceType === "s3") {
    return {
      ...defaults,
      endpoint: String(params.endpoint ?? ""),
      region: String(params.region ?? ""),
      bucket: String(params.bucket ?? ""),
      pathStyle: params.path_style === true,
      accessKey: String(credential.access_key ?? ""),
      secretKey: String(credential.secret_key ?? ""),
      poolSize: connector.poolSize ?? defaults.poolSize,
      rateLimitQps: connector.rateLimitQps ?? defaults.rateLimitQps,
      description: connector.description ?? "",
    };
  }
  if (connector.sourceType === "ftp" || connector.sourceType === "sftp") {
    return {
      ...defaults,
      host: String(params.host ?? ""),
      port:
        typeof params.port === "number"
          ? params.port
          : connector.sourceType === "sftp"
            ? 22
            : 21,
      rootPath: String(params.root_path ?? "/"),
      useTls: params.use_tls === true,
      username: String(credential.username ?? ""),
      password: String(credential.password ?? ""),
      poolSize: connector.poolSize ?? defaults.poolSize,
      rateLimitQps: connector.rateLimitQps ?? defaults.rateLimitQps,
      description: connector.description ?? "",
    };
  }
  if (connector.sourceType === "kafka") {
    return {
      ...defaults,
      brokers: String(params.brokers ?? ""),
      securityProtocol: String(params.security_protocol ?? "PLAINTEXT"),
      username: String(credential.username ?? ""),
      password: String(credential.password ?? ""),
      poolSize: connector.poolSize ?? defaults.poolSize,
      rateLimitQps: connector.rateLimitQps ?? defaults.rateLimitQps,
      description: connector.description ?? "",
    };
  }
  if (connector.sourceType === "rest") {
    return {
      ...defaults,
      baseUrl: String(params.base_url ?? ""),
      probePath: String(params.probe_path ?? "/"),
      authType: String(params.auth_type ?? "none"),
      token: String(credential.token ?? ""),
      username: String(credential.username ?? ""),
      password: String(credential.password ?? ""),
      apiKeyName: String(credential.key ?? "X-API-Key"),
      apiKeyValue: String(credential.value ?? ""),
      poolSize: connector.poolSize ?? defaults.poolSize,
      rateLimitQps: connector.rateLimitQps ?? defaults.rateLimitQps,
      description: connector.description ?? "",
    };
  }
  return defaults;
}

function buildConnectorConfigFromForm(
  sourceType: OntologyConnectionSourceType,
  values: ConnectorFormValues,
): Pick<
  IOntologyConnectorInput,
  | "host"
  | "port"
  | "database"
  | "username"
  | "password"
  | "params"
  | "credential"
  | "metadata"
  | "url"
  | "writable"
  | "poolSize"
  | "rateLimitQps"
  | "description"
> {
  const common = {
    poolSize: numberFormValue(values.poolSize, 4),
    rateLimitQps: numberFormValue(values.rateLimitQps, 20),
    description: stringFormValue(values.description),
  };
  if (
    sourceType === "mysql" ||
    sourceType === "postgresql" ||
    sourceType === "oracle" ||
    sourceType === "sqlserver"
  ) {
    const username = stringFormValue(values.username);
    const password = stringFormValue(values.password);
    return {
      ...common,
      host: stringFormValue(values.host),
      port: numberFormValue(values.port, defaultDatabasePort(sourceType)),
      database: stringFormValue(values.database),
      username,
      password,
      credential: compactConfigValues({ username, password }),
      writable: values.writable === true,
      metadata: {
        host: stringFormValue(values.host),
        port: numberFormValue(values.port, defaultDatabasePort(sourceType)),
        database: stringFormValue(values.database),
      },
    };
  }
  if (sourceType === "s3") {
    const params = compactConfigValues({
      endpoint: stringFormValue(values.endpoint),
      region: stringFormValue(values.region),
      bucket: stringFormValue(values.bucket),
      path_style: values.pathStyle === true,
    });
    const credential = compactConfigValues({
      access_key: stringFormValue(values.accessKey),
      secret_key: stringFormValue(values.secretKey),
    });
    return {
      ...common,
      params,
      credential,
      metadata: { ...params },
    };
  }
  if (sourceType === "ftp" || sourceType === "sftp") {
    const params = compactConfigValues({
      host: stringFormValue(values.host),
      port: numberFormValue(values.port, sourceType === "sftp" ? 22 : 21),
      root_path: stringFormValue(values.rootPath) || "/",
      use_tls: sourceType === "ftp" ? values.useTls === true : null,
    });
    const credential = compactConfigValues({
      username: stringFormValue(values.username),
      password: stringFormValue(values.password),
    });
    return {
      ...common,
      params,
      credential,
      metadata: { ...params },
    };
  }
  if (sourceType === "kafka") {
    const params = compactConfigValues({
      brokers: stringFormValue(values.brokers),
      security_protocol:
        stringFormValue(values.securityProtocol) || "PLAINTEXT",
    });
    const credential = compactConfigValues({
      username: stringFormValue(values.username),
      password: stringFormValue(values.password),
    });
    return {
      ...common,
      params,
      credential,
      metadata: { ...params },
    };
  }
  if (sourceType === "rest") {
    const authType = stringFormValue(values.authType) || "none";
    const params = compactConfigValues({
      base_url: stringFormValue(values.baseUrl),
      probe_path: stringFormValue(values.probePath) || "/",
      auth_type: authType,
    });
    const credential = compactConfigValues({
      token: authType === "bearer" ? stringFormValue(values.token) : null,
      username: authType === "basic" ? stringFormValue(values.username) : null,
      password: authType === "basic" ? stringFormValue(values.password) : null,
      key: authType === "api_key" ? stringFormValue(values.apiKeyName) : null,
      value:
        authType === "api_key" ? stringFormValue(values.apiKeyValue) : null,
      in: authType === "api_key" ? "header" : null,
    });
    return {
      ...common,
      url: stringFormValue(values.baseUrl),
      params,
      credential,
      metadata: { ...params },
    };
  }
  return { ...common, metadata: {} };
}

function compactConfigValues(
  values: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== "" && value !== null,
    ),
  );
}

function stringFormValue(value: ConnectorFormValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberFormValue(
  value: ConnectorFormValue | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function defaultDatabasePort(sourceType: OntologyConnectionSourceType): number {
  if (sourceType === "postgresql") return 5432;
  if (sourceType === "oracle") return 1521;
  if (sourceType === "sqlserver") return 1433;
  return 3306;
}

function parseJsonArray<T extends unknown[]>(
  value: string,
  errorMessage: string,
): T {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as T;
  } catch {
    // The shared validation message below keeps parse and shape errors consistent.
  }
  throw new Error(errorMessage);
}

function parseJsonObject<T extends Record<string, unknown>>(
  value: string,
  errorMessage: string,
): T {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      return parsed as T;
  } catch {
    // The shared validation message below keeps parse and shape errors consistent.
  }
  throw new Error(errorMessage);
}

function showDocumentBuildError(
  t: (key: string, options?: Record<string, unknown>) => string,
  err: unknown,
): void {
  const key = ONTOLOGY_DOCUMENT_ERROR_KEYS.find(
    (item) =>
      err instanceof Error && err.message === `ontology.documentErrors.${item}`,
  );
  if (key) {
    Message.error(t(`ontology.documentErrors.${key}`));
    return;
  }
  showError(t, err);
}

function showError(
  t: (key: string, options?: Record<string, unknown>) => string,
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  Message.error(t("ontology.errors.withMessage", { message }));
}

interface IOntologyWorkbenchProps {
  api: IOntologyWorkbenchApi;
  /**
   * Optional render slot for the "AI 构建" sidebar entry. When provided, the
   * sidebar shows an extra nav item in the "本体" section (before "本体列表"),
   * and selecting it renders whatever this callback returns in the main
   * content area. The workbench itself stays agnostic of AI internals.
   */
  renderAiBuilder?: (workspaceId: string | null) => ReactNode;
  /**
   * Optional callback that receives an imperative view-switcher, so hosts
   * (e.g. the ontology page shell) can activate the AI 构建 tab from a
   * floating bubble without re-plumbing view state.
   */
  onExposeActivateView?: (
    activate: (
      view:
        | "connections"
        | "assets"
        | "ai_builder"
        | "ontology"
        | "publish"
        | "agent",
    ) => void,
  ) => void;
}

interface IOntologyConsoleSidebarProps {
  activeView: OntologyConsoleView;
  onActiveViewChange: (view: OntologyConsoleView) => void;
  isAiBuilderVisible: boolean;
}

interface IConsolePageHeaderProps {
  title: string;
  description: string;
}

interface IConnectionsPageProps {
  snapshot: IOntologyWorkbenchSnapshot;
  connectors: IOntologyConnectorConfig[];
  searchValue: string;
  connectionFilter: "all" | OntologyAssetKind;
  connectorSourceType: OntologyConnectionSourceType;
  connectorNameValue: string;
  connectorFormValues: ConnectorFormValues;
  isScanningConnector: boolean;
  onSearchChange: (value: string) => void;
  onConnectionFilterChange: (value: "all" | OntologyAssetKind) => void;
  onConnectorSourceTypeChange: (value: OntologyConnectionSourceType) => void;
  onConnectorNameChange: (value: string) => void;
  onConnectorFormValueChange: (key: string, value: ConnectorFormValue) => void;
  onProbeConnector: (connectorId?: string) => Promise<boolean>;
  onProbeExistingConnector: (
    connector: IOntologyConnectorConfig,
  ) => Promise<void>;
  onEditConnector: (connector: IOntologyConnectorConfig) => void;
  onBrowseConnectorAssets: (
    connector: IOntologyConnectorConfig,
  ) => Promise<IOntologyBrowseConnectorAssetsResult>;
  onCreateConnector: () => void;
  onDeleteConnector: (
    connector: IOntologyConnectorConfig,
    cascadeAssets: boolean,
  ) => Promise<void>;
}

interface IConnectorTypeFieldsProps {
  sourceType: OntologyConnectionSourceType;
  values: ConnectorFormValues;
  onValueChange: (key: string, value: ConnectorFormValue) => void;
}

interface IAssetsPageProps {
  snapshot: IOntologyWorkbenchSnapshot;
  assets: IOntologyEnvironmentAsset[];
  searchValue: string;
  assetCategoryFilter: AssetCategoryFilter;
  assetViewMode: "grid" | "list";
  profilingAssetId: string | null;
  syncingAssetId: string | null;
  onSearchChange: (value: string) => void;
  onAssetCategoryFilterChange: (value: AssetCategoryFilter) => void;
  onAssetViewModeChange: (value: "grid" | "list") => void;
  onProfileAsset: (asset: IOntologyEnvironmentAsset) => Promise<void>;
  onSyncAssetSchema: (asset: IOntologyEnvironmentAsset) => Promise<void>;
  onDeleteAsset: (asset: IOntologyEnvironmentAsset) => void;
  onPreviewAsset: (
    input: IOntologyPreviewAssetInput,
  ) => Promise<IOntologyPreviewAssetResult>;
}

interface IOntologyModelPageProps {
  snapshot: IOntologyWorkbenchSnapshot;
  workbenches: IOntologyWorkbenchSummary[];
  objects: IOntologyObjectDraft[];
  searchValue: string;
  isGenerating: boolean;
  isApproving: boolean;
  isEditingModel: boolean;
  isDetailVisible: boolean;
  onCreateOntology: (input: IOntologyCreateWorkbenchInput) => Promise<void>;
  onSelectOntology: (workspaceId: string) => Promise<void>;
  onDeleteOntology: (workspaceId: string) => Promise<void>;
  onBackToList: () => void;
  onOpenPublish: () => void;
  onSearchChange: (value: string) => void;
  onGenerateDraft: (input?: IOntologyGenerateDraftInput) => Promise<boolean>;
  onImportObjectBuildFiles: (
    method: "template" | "document",
  ) => Promise<string[]>;
  consistencyCheck: IOntologyConsistencyCheckResult | null;
  isChecking: boolean;
  onRunConsistencyCheck: (workspaceId?: string) => Promise<void>;
  onOpenObjectModal: (object?: IOntologyObjectDraft) => void;
  onOpenRelationModal: (
    relation?: IOntologyRelationDraft,
    objectIds?: string[],
  ) => void;
  onOpenMappingModal: (mapping?: IOntologyFieldMapping) => void;
  onOpenRuleModal: (rule?: IOntologyQualityRule) => void;
  onReviewTarget: (input: IOntologyReviewTargetInput) => Promise<boolean>;
  onApproveAll: () => Promise<boolean>;
  onCompletePhase: (phase: OntologyWorkflowPhase) => Promise<boolean>;
  onUpdateObject: (input: IOntologyObjectDraftInput) => Promise<boolean>;
  onEditObject: (object: IOntologyObjectDraft) => void;
  onDeleteObject: (object: IOntologyObjectDraft) => void;
  onDeleteObjects: (objects: IOntologyObjectDraft[]) => Promise<boolean>;
  onActivateObjects: (objects: IOntologyObjectDraft[]) => Promise<boolean>;
  onEditAttribute: (
    objectId: string,
    attribute?: IOntologyObjectDraft["attributes"][number],
  ) => void;
  onDeleteAttribute: (input: IOntologyDeleteAttributeInput) => Promise<void>;
  onEditRelation: (relation: IOntologyRelationDraft) => void;
  onDeleteRelation: (relation: IOntologyRelationDraft) => Promise<void>;
  onEditMapping: (mapping: IOntologyFieldMapping) => void;
  onDeleteMapping: (mapping: IOntologyFieldMapping) => Promise<void>;
  onEditRule: (rule: IOntologyQualityRule) => void;
  onDeleteRule: (rule: IOntologyQualityRule) => Promise<void>;
  onUpsertLogicFunction: (input: IOntologyLogicFunctionInput) => Promise<void>;
  onDeleteLogicFunction: (
    logicFunction: IOntologyLogicFunction,
  ) => Promise<void>;
  onUpsertAction: (input: IOntologyActionDefinitionInput) => Promise<void>;
  onDeleteAction: (action: IOntologyActionDefinition) => Promise<void>;
}

interface IManualObjectBuilderProps {
  snapshot: IOntologyWorkbenchSnapshot;
  baselineObjectIds: string[];
  selectedObjectId: string | null;
  isEditingModel: boolean;
  consistencyCheck: IOntologyConsistencyCheckResult | null;
  isChecking: boolean;
  onSelectedObjectChange: (objectId: string | null) => void;
  onAddObject: () => void;
  onUpdateObject: (input: IOntologyObjectDraftInput) => Promise<boolean>;
  onEditObject: (object: IOntologyObjectDraft) => void;
  onDeleteObject: (object: IOntologyObjectDraft) => void;
  onEditAttribute: (
    objectId: string,
    attribute?: IOntologyObjectDraft["attributes"][number],
  ) => void;
  onDeleteAttribute: (input: IOntologyDeleteAttributeInput) => Promise<void>;
  onAddRelation: (objectIds: string[]) => void;
  onEditRelation: (
    relation: IOntologyRelationDraft,
    objectIds: string[],
  ) => void;
  onDeleteRelation: (relation: IOntologyRelationDraft) => Promise<void>;
  onReviewTarget: (input: IOntologyReviewTargetInput) => Promise<boolean>;
  onAddMapping: () => void;
  onEditMapping: (mapping: IOntologyFieldMapping) => void;
  onDeleteMapping: (mapping: IOntologyFieldMapping) => Promise<void>;
  onBack: () => void;
  onCompleteModeling: () => Promise<boolean>;
  onCompleteReview: () => Promise<boolean>;
  onRunConsistencyCheck: (workspaceId?: string) => Promise<void>;
  onOpenPublish: () => void;
}

interface IManualObjectBasicInfoProps {
  object: IOntologyObjectDraft;
  isSaving: boolean;
  onSave: (input: IOntologyObjectDraftInput) => Promise<boolean>;
}

interface IGuidedObjectBuilderProps {
  method: Exclude<ObjectBuildMethod, "manual">;
  snapshot: IOntologyWorkbenchSnapshot;
  isGenerating: boolean;
  isApproving: boolean;
  isChecking: boolean;
  consistencyCheck: IOntologyConsistencyCheckResult | null;
  onImportFiles: (method: "template" | "document") => Promise<string[]>;
  onGenerateDraft: (input?: IOntologyGenerateDraftInput) => Promise<boolean>;
  onReviewTarget: (input: IOntologyReviewTargetInput) => Promise<boolean>;
  onEditObject: (object: IOntologyObjectDraft) => void;
  onEditRelation: (relation: IOntologyRelationDraft) => void;
  onAddMapping: () => void;
  onEditMapping: (mapping: IOntologyFieldMapping) => void;
  onDeleteMapping: (mapping: IOntologyFieldMapping) => Promise<void>;
  onApproveAll: () => Promise<boolean>;
  onRunConsistencyCheck: (workspaceId?: string) => Promise<void>;
  onOpenPublish: () => void;
  onBack: () => void;
  onFinish: () => void;
}

interface IBuilderCenteredStepProps {
  title: string;
  description: string;
  children: ReactNode;
}

interface IBuilderSelectionStepProps {
  title: string;
  description: string;
  assets: IOntologyEnvironmentAsset[];
  selectedIds: string[];
  isDisabled?: boolean;
  emptyText: string;
  onToggle: (assetId: string, isChecked: boolean) => void;
  children: ReactNode;
}

interface IBuilderReviewCardProps {
  title: string;
  description: string;
  snapshot: IOntologyWorkbenchSnapshot;
  isReviewEnabled?: boolean;
  onEditObject?: (object: IOntologyObjectDraft) => void;
  onEditRelation?: (relation: IOntologyRelationDraft) => void;
  onReviewTarget?: (input: IOntologyReviewTargetInput) => Promise<boolean>;
  children: ReactNode;
}

interface IBuilderStepActionsProps {
  onPrevious?: () => void;
  onNext?: () => void;
  isNextDisabled?: boolean;
}

interface ILabeledValueProps {
  label: string;
  value: string;
}

interface IPublishPageProps {
  snapshot: IOntologyWorkbenchSnapshot;
  snapshots: IOntologyWorkbenchSnapshot[];
  initialWorkspaceId: string | null;
  consistencyCheck: IOntologyConsistencyCheckResult | null;
  isChecking: boolean;
  isPublishing: boolean;
  onRunConsistencyCheck: (workspaceId: string) => Promise<void>;
  onPublish: (workspaceId: string) => Promise<void>;
  onApproveVersion: (
    workspaceId: string,
    version: IOntologyPublishedVersion,
  ) => Promise<boolean>;
  onRejectVersion: (
    workspaceId: string,
    version: IOntologyPublishedVersion,
    reason: string,
  ) => Promise<boolean>;
  onRollbackVersion: (
    workspaceId: string,
    version: IOntologyPublishedVersion,
  ) => void;
  onSelectWorkspace: (
    workspaceId: string,
  ) => Promise<IOntologyWorkbenchSnapshot | null>;
}

interface IOntologyServiceDetailsProps {
  snapshot: IOntologyWorkbenchSnapshot;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;
type AgentManageStatusFilter = "all" | "draft" | "published";

interface IOntologyListCard {
  id: string;
  name: string;
  code: string;
  description: string;
  objects: number;
  relations: number;
  logic: number;
  actions: number;
  updatedAt: number;
}

interface IPublishedArtifactSectionProps {
  title: string;
  items: IPublishedArtifactItem[];
  emptyText: string;
}

interface IPublishedArtifactItem {
  id: string;
  name: string;
  description: string;
  meta: string;
}

interface IMcpMetricCardProps {
  title: string;
  value: number;
  suffix: string;
}

interface IMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    properties: Record<string, IMcpToolProperty>;
    required?: string[];
  };
}

interface IMcpToolProperty {
  type: string;
  description: string;
}

interface IAgentPageProps {
  snapshots: IOntologyWorkbenchSnapshot[];
  agentNameValue: string;
  isCreatingAgent: boolean;
  isRegisteringAgent: boolean;
  onAgentNameChange: (value: string) => void;
  onCreateAgent: (
    workspaceId: string,
    ontologyVersionId: string,
  ) => Promise<boolean>;
  onRegisterAgent: (
    workspaceId: string,
    agent?: IOntologyAgentBlueprint,
  ) => Promise<void>;
  onDeleteAgent: (workspaceId: string, agent: IOntologyAgentBlueprint) => void;
}

interface IConsoleStatisticProps {
  title: string;
  value: number;
  icon?: ReactNode;
  valueClassName?: string;
  iconClassName?: string;
}

interface IResourceCardStatisticProps {
  label: string;
  value: number;
}

interface IObjectBuildMethodOptionProps {
  icon: ReactNode;
  title: string;
}

interface IConsoleToolbarProps {
  searchValue: string;
  right?: ReactNode;
  onSearchChange: (value: string) => void;
}

interface ISegmentedFilterProps<TValue extends string> {
  value: TValue;
  options: Array<{ value: TValue; label: string }>;
  onValueChange: (value: TValue) => void;
}

interface IConnectorStatusProps {
  connector: IOntologyConnectorConfig;
}

interface IAssetCatalogProps {
  assets: IOntologyEnvironmentAsset[];
  profilingAssetId: string | null;
  syncingAssetId: string | null;
  onOpenAsset: (asset: IOntologyEnvironmentAsset) => void;
  onProfileAsset: (asset: IOntologyEnvironmentAsset) => Promise<void>;
  onSyncAssetSchema: (asset: IOntologyEnvironmentAsset) => Promise<void>;
  onDeleteAsset: (asset: IOntologyEnvironmentAsset) => void;
}

interface IAssetDetailModalProps {
  asset: IOntologyEnvironmentAsset | null;
  profilingAssetId: string | null;
  syncingAssetId: string | null;
  onProfileAsset: (asset: IOntologyEnvironmentAsset) => Promise<void>;
  onSyncAssetSchema: (asset: IOntologyEnvironmentAsset) => Promise<void>;
  onPreviewAsset: (
    input: IOntologyPreviewAssetInput,
  ) => Promise<IOntologyPreviewAssetResult>;
  onClose: () => void;
}

interface IPanelProps {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}

interface IObjectAttributeListProps {
  object: IOntologyObjectDraft;
  isDisabled: boolean;
  onEditAttribute: (
    objectId: string,
    attribute?: IOntologyObjectDraft["attributes"][number],
  ) => void;
  onDeleteAttribute: (input: IOntologyDeleteAttributeInput) => Promise<void>;
}

interface IObjectTableProps {
  objects: IOntologyObjectDraft[];
  selectedObjectIds: string[];
  isAllSelected: boolean;
  onToggleAll: (isChecked: boolean) => void;
  onToggleObject: (objectId: string, isChecked: boolean) => void;
  onEditObject: (object: IOntologyObjectDraft) => void;
  onDeleteObject: (object: IOntologyObjectDraft) => void;
}

interface IRelationTableProps {
  relations: IOntologyRelationDraft[];
  objects: IOntologyObjectDraft[];
  onEditRelation: (relation: IOntologyRelationDraft) => void;
  onDeleteRelation: (relation: IOntologyRelationDraft) => Promise<void>;
}

interface IOntologyGraphProps {
  objects: IOntologyObjectDraft[];
  relations: IOntologyRelationDraft[];
}

interface IMiniMetricProps {
  label: string;
  value: ReactNode;
}

interface IMappingTableProps {
  mappings: IOntologyFieldMapping[];
  objects: IOntologyObjectDraft[];
  assets: IOntologyEnvironmentAsset[];
  onEditMapping: (mapping: IOntologyFieldMapping) => void;
  onDeleteMapping: (mapping: IOntologyFieldMapping) => Promise<void>;
}

interface IQualityRuleListProps {
  rules: IOntologyQualityRule[];
  objects: IOntologyObjectDraft[];
  onEditRule: (rule: IOntologyQualityRule) => void;
  onDeleteRule: (rule: IOntologyQualityRule) => Promise<void>;
}

interface IRuntimeArtifactsProps {
  documents: IOntologyBusinessDocument[];
  functions: IOntologyLogicFunction[];
  actions: IOntologyActionDefinition[];
  endpoints: IOntologyServiceEndpoint[];
  objects: IOntologyObjectDraft[];
  stats: IOntologyWorkbenchSnapshot["stats"];
  onUpsertLogicFunction: (input: IOntologyLogicFunctionInput) => Promise<void>;
  onDeleteLogicFunction: (
    logicFunction: IOntologyLogicFunction,
  ) => Promise<void>;
  onUpsertAction: (input: IOntologyActionDefinitionInput) => Promise<void>;
  onDeleteAction: (action: IOntologyActionDefinition) => Promise<void>;
}

interface IRuntimeArtifactSectionProps<TItem extends { id: string }> {
  title: string;
  emptyText: string;
  items: TItem[];
  getTitle: (item: TItem) => string;
  getSubtitle?: (item: TItem) => string;
  onOpen: (item: TItem) => void;
}

interface IRuntimeArtifactDetailModalProps {
  detail: RuntimeArtifactDetail | null;
  onClose: () => void;
}

interface IImpactAndMonitorProps {
  impactAnalyses: IOntologyImpactAnalysis[];
  monitorEvents: IOntologyMonitorEvent[];
}

interface IReviewDecisionTagProps {
  decision: IOntologyObjectDraft["reviewDecision"];
}

interface IReviewLogProps {
  count: number;
}

interface IConsistencyCheckResultProps {
  result: IOntologyConsistencyCheckResult;
}
