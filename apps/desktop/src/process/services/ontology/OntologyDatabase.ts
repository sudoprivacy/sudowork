import path from 'path';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { safeStorage } from 'electron';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import {
  createDefaultOntologyWorkbenchSnapshot,
  recalculateOntologyStats,
  type IOntologyActionDefinition,
  type IOntologyAgentBlueprint,
  type IOntologyAssetField,
  type IOntologyBusinessDocument,
  type IOntologyConnectionProfile,
  type IOntologyConnectorConfig,
  type IOntologyEnvironmentAsset,
  type IOntologyFieldMapping,
  type IOntologyImpactAnalysis,
  type IOntologyLogicFunction,
  type IOntologyMonitorEvent,
  type IOntologyObjectDraft,
  type IOntologyPublishedVersion,
  type IOntologyQualityRule,
  type IOntologyRelationDraft,
  type IOntologyReviewItem,
  type IOntologyServiceEndpoint,
  type IOntologyTask,
  type IOntologyVersionDiff,
  type IOntologyVersionSnapshot,
  type IOntologyWorkbenchSnapshot,
  type OntologyAssetKind,
  type OntologyCapabilityId,
  type OntologyConnectionSourceType,
  type OntologyWorkflowPhase,
} from '@sudowork/ontology-common';
import type { IOntologyRepository } from '@sudowork/ontology-engine';
import { ensureDirectory, getDataPath } from '@process/utils';
import { mainLog } from '@process/utils/mainLogger';

const ACTIVE_WORKSPACE_KEY = 'ontology.active_workspace_id';
const WORKSPACE_CONFIG_PREFIX = 'ontology.workspace.';

interface IScenarioRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  updated_at: number | string | null;
}

interface ISystemConfigRow {
  value: string | null;
}

interface IConnectionRow {
  id: string;
  name: string;
  category: string;
  type: string;
  host: string | null;
  port: number | null;
  database: string | null;
  params: string | null;
  credential_ref: string | null;
  credential_type: string | null;
  writable: number | null;
  pool_size: number | null;
  rate_limit_qps: number | null;
  description: string | null;
  status: string | null;
  enabled: number | null;
  last_test_at: number | string | null;
  last_test_ok: number | null;
  last_test_message: string | null;
  created_at: number | string | null;
  updated_at: number | string | null;
  created_by: string | null;
}

interface IAssetRow {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  kind: string;
  connection_id: string | null;
  locator: string | null;
  schema_snapshot: string | null;
  schema_synced_at: number | string | null;
  primary_key: string | null;
  profile: string | null;
  document_source_type: string | null;
  parsed_summary: string | null;
  embedding_index_ref: string | null;
  refresh_policy: string | null;
  cache_ttl_seconds: number | null;
  sensitivity_tags: string | null;
  domain: string | null;
  tags: string | null;
  owner: string | null;
  status: string | null;
  created_at: number | string | null;
  updated_at: number | string | null;
}

interface IEntityRow {
  id: string;
  name: string;
  name_cn: string;
  tier: number;
  status: string | null;
  description: string | null;
  config_json: string | null;
  scenario_codes: string | null;
  ontology_id: string | null;
  created_at: number | string | null;
  updated_at: number | string | null;
}

interface IAttributeRow {
  id: string;
  entity_id: string;
  name: string;
  type: string;
  description: string | null;
  required: number | null;
  example: string | null;
  constraints_json: string | null;
  source_table: string | null;
  source_field: string | null;
  data_status: string | null;
}

interface IRelationRow {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  name: string;
  code: string | null;
  rel_type: string;
  semantic_type: string | null;
  cardinality: string;
  acyclic: number | null;
  description: string | null;
  created_at: number | string | null;
}

interface IObjectBindingRow {
  id: string;
  object_type_id: string;
  asset_id: string;
  role: string;
  field_mappings: string | null;
  status: string | null;
  created_at: number | string | null;
  updated_at: number | string | null;
}

interface IQualityRuleRow {
  id: string;
  asset_id: string;
  name: string;
  kind: string;
  column_name: string | null;
  params: string | null;
  severity: string | null;
  enabled: number | null;
  description: string | null;
  updated_at: number | string | null;
}

interface IBusinessDocumentRow {
  id: string;
  name: string;
  file_type: string | null;
  parsed_text: string | null;
  summary: string | null;
  domain_tags: string | null;
  uploaded_at: number | string | null;
}

interface IFunctionRow {
  id: string;
  entity_id: string | null;
  ontology_id: string | null;
  entity_ids: string | null;
  name: string;
  description: string | null;
  return_type: string | null;
  input_schema: string | null;
  logic_type: string | null;
  logic_body: string | null;
  status: string | null;
  tags: string | null;
  execution_count: number | null;
  last_executed: number | string | null;
  updated_at: number | string | null;
}

interface IActionRow {
  id: string;
  entity_id: string | null;
  ontology_id: string | null;
  name: string;
  category: string | null;
  action_type: string | null;
  type_config: string | null;
  description: string | null;
  status: string | null;
  parameters_json: string | null;
  output_schema: string | null;
  updated_at: number | string | null;
}

interface ISkillRow {
  id: string;
  name: string;
  description: string | null;
  skill_type: string | null;
  config_json: string | null;
  status: string | null;
  current_version: number | null;
  created_at: number | string | null;
  updated_at: number | string | null;
}

interface IVersionRow {
  id: string;
  version_number: number;
  name: string;
  ontology_id: string | null;
  description: string | null;
  status: string | null;
  approved_by: string | null;
  created_at: number | string | null;
  published_at: number | string | null;
  submitted_at: number | string | null;
  reject_reason: string | null;
  is_active: number | null;
}

interface IVersionEntityRow {
  id: string;
  version_id: string;
  source_entity_id: string;
  name: string;
  name_cn: string;
  tier: number;
  description: string | null;
  config_json: string | null;
}

interface IVersionAttributeRow {
  id: string;
  version_entity_id: string;
  source_attribute_id: string;
  name: string;
  type: string;
  description: string | null;
  required: number | null;
  example: string | null;
  constraints_json: string | null;
  source_table: string | null;
  source_field: string | null;
}

interface IVersionRelationRow {
  id: string;
  version_id: string;
  source_relation_id: string;
  from_version_entity_id: string;
  to_version_entity_id: string;
  name: string;
  rel_type: string;
  relation_type: string | null;
  semantic_type: string | null;
  cardinality: string;
  acyclic: number | null;
  description: string | null;
}

interface IVersionComponentRow {
  id: string;
  version_id: string;
  source_id: string | null;
  name: string;
  config_json: string | null;
  description: string | null;
}

interface IVersionMetadataRow {
  mappings: string | null;
  quality_rules: string | null;
  business_documents: string | null;
  service_endpoints: string | null;
}

interface IAgentRow {
  id: string;
  name: string;
  description: string | null;
  tags: string | null;
  ontology_version_id: string | null;
  system_prompt: string | null;
  entity_ids: string | null;
  tools_config: string | null;
  status: string | null;
  api_key: string | null;
  created_at: number | string | null;
  updated_at: number | string | null;
}

interface IAuditRow {
  id: string;
  timestamp: number | string | null;
  user_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  target_name: string | null;
  details: string | null;
  status: string | null;
  changes_json: string | null;
}

interface IWorkspaceConfig {
  activePhase?: OntologyWorkflowPhase;
  draft?: IOntologyWorkbenchSnapshot['draft'];
  phases?: IOntologyWorkbenchSnapshot['phases'];
  capabilities?: IOntologyWorkbenchSnapshot['capabilities'];
  tasks?: IOntologyTask[];
}

type JsonRecord = Record<string, unknown>;

export class OntologyDatabase implements IOntologyRepository {
  private readonly db: Database.Database;
  private readonly ontologyDir: string;

  constructor() {
    this.ontologyDir = path.join(getDataPath(), 'ontology');
    ensureDirectory(this.ontologyDir);
    const dbPath = path.join(this.ontologyDir, 'ontology.db');
    mainLog('OntologyDatabase', `Initializing ontology database at: ${dbPath}`);
    this.db = new BetterSqlite3(dbPath);
    this.initialize();
  }

  getSnapshot(workspaceId: string): IOntologyWorkbenchSnapshot | null {
    const scenario = this.findScenario(workspaceId);
    if (!scenario) return null;
    return this.readWorkbench(scenario);
  }

  listSnapshots(): IOntologyWorkbenchSnapshot[] {
    const rows = this.db.prepare('SELECT * FROM scenario_dict ORDER BY updated_at DESC').all() as IScenarioRow[];
    return rows.map((row) => this.readWorkbench(row));
  }

  saveSnapshot(snapshot: IOntologyWorkbenchSnapshot): void {
    const writeWorkbench = this.db.transaction((workbench: IOntologyWorkbenchSnapshot) => {
      const normalized = {
        ...workbench,
        stats: recalculateOntologyStats(workbench),
      };
      this.upsertScenario(normalized);
      this.clearWorkspaceRecords(normalized.workspaceId);
      this.saveWorkspaceConfig(normalized);
      this.insertConnectors(normalized);
      this.insertAssets(normalized);
      this.insertObjects(normalized);
      this.insertRelations(normalized);
      this.insertObjectBindings(normalized);
      this.insertQualityRules(normalized);
      this.insertBusinessDocuments(normalized);
      this.insertLogicFunctions(normalized);
      this.insertActions(normalized);
      this.insertServiceEndpoints(normalized);
      this.insertPublishedVersions(normalized);
      this.insertAgentBlueprints(normalized);
      this.insertAuditRecords(normalized);
    });
    writeWorkbench(snapshot);
    this.writeMcpExport(snapshot);
  }

  deleteSnapshot(workspaceId: string): void {
    const scenario = this.findScenario(workspaceId);
    if (!scenario) return;
    const deleteWorkbench = this.db.transaction(() => {
      this.clearWorkspaceRecords(scenario.id);
      this.db.prepare('DELETE FROM system_config WHERE key = ?').run(`${WORKSPACE_CONFIG_PREFIX}${scenario.id}`);
      this.db.prepare('DELETE FROM scenario_dict WHERE id = ?').run(scenario.id);
    });
    deleteWorkbench();
    rmSync(this.getMcpExportPath(workspaceId), { force: true });
  }

  resetSnapshot(workspaceId: string): void {
    const scenario = this.findScenario(workspaceId);
    if (!scenario) return;
    const resetWorkbench = this.db.transaction(() => {
      this.clearWorkspaceRecords(scenario.id);
      this.db.prepare('DELETE FROM system_config WHERE key = ?').run(`${WORKSPACE_CONFIG_PREFIX}${scenario.id}`);
    });
    resetWorkbench();
  }

  getActiveWorkspaceId(): string | null {
    const row = this.db.prepare('SELECT value FROM system_config WHERE key = ?').get(ACTIVE_WORKSPACE_KEY) as ISystemConfigRow | undefined;
    return row?.value ?? null;
  }

  setActiveWorkspaceId(workspaceId: string): void {
    this.db
      .prepare(
        `INSERT INTO system_config (id, "group", key, value, description, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(`system:${ACTIVE_WORKSPACE_KEY}`, 'ontology', ACTIVE_WORKSPACE_KEY, workspaceId, 'Active ontology workspace', Date.now(), 'sudowork');
  }

  close(): void {
    this.db.close();
  }

  getMcpExportPath(workspaceId: string): string {
    return path.join(this.ontologyDir, `mcp-${encodeURIComponent(workspaceId)}.json`);
  }

  private writeMcpExport(snapshot: IOntologyWorkbenchSnapshot): void {
    const exportPath = this.getMcpExportPath(snapshot.workspaceId);
    const temporaryPath = `${exportPath}.tmp`;
    const payload = {
      schemaVersion: snapshot.schemaVersion,
      workspaceId: snapshot.workspaceId,
      title: snapshot.draft.title,
      description: snapshot.draft.description,
      updatedAt: snapshot.updatedAt,
      versions: snapshot.publishedVersions.map((version) => ({
        id: version.id,
        version: version.version,
        status: version.status,
        isActive: version.isActive,
        summary: version.summary,
        publishedAt: version.publishedAt,
        snapshot: {
          objects: version.snapshot.objects,
          relations: version.snapshot.relations,
          mappings: version.snapshot.mappings,
          qualityRules: version.snapshot.qualityRules,
          logicFunctions: version.snapshot.logicFunctions.map(({ body: _body, ...logicFunction }) => logicFunction),
          actions: version.snapshot.actions.map(({ configuration: _configuration, ...action }) => action),
        },
      })),
    };
    writeFileSync(temporaryPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, exportPath);
  }

  private initialize(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(ONTOLOGY_SQLITE_SCHEMA);
    this.ensureColumn('entity_relations', 'code', "TEXT DEFAULT ''");
    this.ensureColumn('entity_relations', 'semantic_type', "TEXT DEFAULT 'association'");
    this.ensureColumn('ontology_version_relations', 'relation_type', "TEXT DEFAULT 'object_property'");
    this.ensureColumn('ontology_version_relations', 'semantic_type', "TEXT DEFAULT 'association'");
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  private findScenario(workspaceId: string): IScenarioRow | undefined {
    return this.db.prepare('SELECT * FROM scenario_dict WHERE id = ? OR code = ?').get(workspaceId, workspaceId) as IScenarioRow | undefined;
  }

  private readWorkbench(scenario: IScenarioRow): IOntologyWorkbenchSnapshot {
    const workspaceId = scenario.id;
    const config = this.readWorkspaceConfig(workspaceId);
    const now = fromDbTime(scenario.updated_at);
    const snapshot = createDefaultOntologyWorkbenchSnapshot(now, {
      workspaceId,
      title: scenario.name,
      description: scenario.description ?? '',
      businessGoal: config.draft?.businessGoal,
    });
    snapshot.activePhase = config.activePhase ?? snapshot.activePhase;
    snapshot.draft = {
      ...snapshot.draft,
      ...config.draft,
      title: scenario.name,
      description: scenario.description ?? config.draft?.description ?? '',
    };
    snapshot.phases = config.phases ?? snapshot.phases;
    snapshot.capabilities = config.capabilities ?? snapshot.capabilities;
    snapshot.tasks = config.tasks ?? [];
    snapshot.connectors = this.readConnectors(workspaceId);
    snapshot.assets = this.readAssets(workspaceId);
    snapshot.objects = this.readObjects(workspaceId);
    snapshot.relations = this.readRelations(snapshot.objects);
    snapshot.mappings = this.readMappings(snapshot.objects);
    snapshot.connections = this.buildConnectionProfiles(snapshot.connectors, snapshot.assets);
    snapshot.qualityRules = this.readQualityRules(workspaceId, snapshot.objects);
    snapshot.businessDocuments = this.readBusinessDocuments(workspaceId);
    snapshot.logicFunctions = this.readLogicFunctions(workspaceId);
    snapshot.actions = this.readActions(workspaceId);
    snapshot.serviceEndpoints = this.readServiceEndpoints(workspaceId);
    snapshot.publishedVersions = this.readPublishedVersions(workspaceId);
    snapshot.agentBlueprints = this.readAgentBlueprints(snapshot.publishedVersions);
    snapshot.reviewItems = this.readReviewItems(workspaceId);
    snapshot.monitorEvents = this.readMonitorEvents(workspaceId);
    snapshot.impactAnalyses = this.readImpactAnalyses(workspaceId);
    snapshot.updatedAt = now;
    snapshot.stats = recalculateOntologyStats(snapshot);
    return snapshot;
  }

  private readWorkspaceConfig(workspaceId: string): IWorkspaceConfig {
    const row = this.db.prepare('SELECT value FROM system_config WHERE key = ?').get(`${WORKSPACE_CONFIG_PREFIX}${workspaceId}`) as ISystemConfigRow | undefined;
    return parseJson<IWorkspaceConfig>(row?.value, {});
  }

  private saveWorkspaceConfig(snapshot: IOntologyWorkbenchSnapshot): void {
    const config: IWorkspaceConfig = {
      activePhase: snapshot.activePhase,
      draft: snapshot.draft,
      phases: snapshot.phases,
      capabilities: snapshot.capabilities,
      tasks: snapshot.tasks,
    };
    const key = `${WORKSPACE_CONFIG_PREFIX}${snapshot.workspaceId}`;
    this.db
      .prepare(
        `INSERT INTO system_config (id, "group", key, value, description, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(`system:${key}`, 'ontology', key, toJson(config), 'Ontology workspace runtime config', snapshot.updatedAt, 'sudowork');
  }

  private upsertScenario(snapshot: IOntologyWorkbenchSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO scenario_dict (id, code, name, color, description, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id)
         DO UPDATE SET code = excluded.code, name = excluded.name, description = excluded.description, updated_at = excluded.updated_at`
      )
      .run(snapshot.workspaceId, snapshot.workspaceId, snapshot.draft.title, null, snapshot.draft.description, 0, snapshot.updatedAt, snapshot.updatedAt);
  }

  private clearWorkspaceRecords(workspaceId: string): void {
    const objectIds = this.columnValues('SELECT id FROM ontology_entities WHERE ontology_id = ?', workspaceId);
    const assetIds = this.columnValues('SELECT id FROM assets WHERE domain = ?', workspaceId);
    const connectionIds = this.columnValues('SELECT id FROM connections WHERE created_by = ?', workspaceId);
    const versionIds = this.columnValues('SELECT id FROM ontology_versions WHERE ontology_id = ?', workspaceId);
    const versionEntityIds = versionIds.length > 0 ? this.columnValues(`SELECT id FROM ontology_version_entities WHERE version_id IN (${placeholders(versionIds)})`, ...versionIds) : [];
    const skillIds = this.columnValues('SELECT id FROM skills WHERE created_by = ?', workspaceId);

    if (versionEntityIds.length > 0) this.db.prepare(`DELETE FROM ontology_version_attributes WHERE version_entity_id IN (${placeholders(versionEntityIds)})`).run(...versionEntityIds);
    if (versionIds.length > 0) {
      this.db.prepare(`DELETE FROM ontology_version_relations WHERE version_id IN (${placeholders(versionIds)})`).run(...versionIds);
      this.db.prepare(`DELETE FROM ontology_version_functions WHERE version_id IN (${placeholders(versionIds)})`).run(...versionIds);
      this.db.prepare(`DELETE FROM ontology_version_actions WHERE version_id IN (${placeholders(versionIds)})`).run(...versionIds);
      this.db.prepare(`DELETE FROM ontology_version_metadata WHERE version_id IN (${placeholders(versionIds)})`).run(...versionIds);
      this.db.prepare(`DELETE FROM ontology_version_entities WHERE version_id IN (${placeholders(versionIds)})`).run(...versionIds);
      this.db.prepare(`DELETE FROM agents WHERE ontology_version_id IN (${placeholders(versionIds)})`).run(...versionIds);
      this.db.prepare(`DELETE FROM ontology_versions WHERE id IN (${placeholders(versionIds)})`).run(...versionIds);
    }

    if (objectIds.length > 0) {
      this.db.prepare(`DELETE FROM entity_attributes WHERE entity_id IN (${placeholders(objectIds)})`).run(...objectIds);
      this.db.prepare(`DELETE FROM entity_relations WHERE from_entity_id IN (${placeholders(objectIds)}) OR to_entity_id IN (${placeholders(objectIds)})`).run(...objectIds, ...objectIds);
      this.db.prepare(`DELETE FROM object_bindings WHERE object_type_id IN (${placeholders(objectIds)})`).run(...objectIds);
      this.db.prepare(`DELETE FROM ontology_functions WHERE entity_id IN (${placeholders(objectIds)}) OR ontology_id = ?`).run(...objectIds, workspaceId);
      this.db.prepare(`DELETE FROM entity_actions WHERE entity_id IN (${placeholders(objectIds)}) OR ontology_id = ?`).run(...objectIds, workspaceId);
      this.db.prepare(`DELETE FROM ontology_entities WHERE id IN (${placeholders(objectIds)})`).run(...objectIds);
    } else {
      this.db.prepare('DELETE FROM ontology_functions WHERE ontology_id = ?').run(workspaceId);
      this.db.prepare('DELETE FROM entity_actions WHERE ontology_id = ?').run(workspaceId);
    }

    // Quality rules are keyed off created_by (matching readQualityRules); the asset_id column is a
    // best-effort denormalization that can fall back to the object id when no asset is bound yet, so
    // clearing by asset_id would leave orphan rows behind and re-inserting the same rule.id on the
    // next save would trip the PRIMARY KEY. Delete by created_by to stay symmetric with the read.
    this.db.prepare('DELETE FROM quality_rules WHERE created_by = ?').run(workspaceId);

    if (assetIds.length > 0) {
      this.db.prepare(`DELETE FROM health_statuses WHERE asset_id IN (${placeholders(assetIds)})`).run(...assetIds);
      this.db.prepare(`DELETE FROM quality_metrics WHERE asset_id IN (${placeholders(assetIds)})`).run(...assetIds);
      this.db.prepare(`DELETE FROM asset_usage WHERE asset_id IN (${placeholders(assetIds)})`).run(...assetIds);
      this.db.prepare(`DELETE FROM execution_logs WHERE asset_id IN (${placeholders(assetIds)})`).run(...assetIds);
      this.db.prepare(`DELETE FROM object_bindings WHERE asset_id IN (${placeholders(assetIds)})`).run(...assetIds);
      this.db.prepare(`DELETE FROM assets WHERE id IN (${placeholders(assetIds)})`).run(...assetIds);
    }

    if (connectionIds.length > 0) {
      this.db.prepare(`DELETE FROM execution_logs WHERE connection_id IN (${placeholders(connectionIds)})`).run(...connectionIds);
      this.db.prepare(`DELETE FROM connections WHERE id IN (${placeholders(connectionIds)})`).run(...connectionIds);
    }

    if (skillIds.length > 0) {
      this.db.prepare(`DELETE FROM skill_tools WHERE skill_id IN (${placeholders(skillIds)})`).run(...skillIds);
      this.db.prepare(`DELETE FROM skills WHERE id IN (${placeholders(skillIds)})`).run(...skillIds);
    }

    this.db.prepare('DELETE FROM business_documents WHERE uploaded_by = ?').run(workspaceId);
    this.db.prepare('DELETE FROM audit_log WHERE user_id = ?').run(workspaceId);
    this.db.prepare('DELETE FROM prompt_templates WHERE created_by = ?').run(workspaceId);
    this.db.prepare('DELETE FROM ontology_shared_attributes WHERE ontology_id = ?').run(workspaceId);
    this.db.prepare('DELETE FROM ontology_shared_refs WHERE source_ontology_id = ? OR target_ontology_id = ?').run(workspaceId, workspaceId);
  }

  private columnValues(sql: string, ...params: unknown[]): string[] {
    const rows = this.db.prepare(sql).all(...params) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private insertConnectors(snapshot: IOntologyWorkbenchSnapshot): void {
    const statement = this.db.prepare(
      `INSERT INTO connections (
        id, name, category, type, host, port, database, params, credential_ref, credential_type,
        writable, pool_size, rate_limit_qps, description, status, enabled, last_test_at,
        last_test_ok, last_test_message, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const connector of snapshot.connectors) {
      statement.run(
        connector.id,
        connector.name,
        connectionCategory(connector),
        connector.sourceType,
        connector.host ?? '',
        connector.port ?? 0,
        connector.database ?? '',
        toJson({
          ...connector.params,
          sourceType: connector.sourceType,
          kind: connector.kind,
          path: connector.path ?? null,
          url: connector.url ?? null,
          headers: connector.headers ?? null,
          metadata: connector.metadata,
        }),
        serializeCredential(connector.credential, connector.credentialRef),
        connector.credential ? 'safe_storage' : 'ref',
        connector.writable ? 1 : 0,
        connector.poolSize ?? 4,
        connector.rateLimitQps ?? 20,
        connector.description ?? null,
        connector.probeStatus === 'failed' ? 'error' : 'active',
        1,
        connector.lastProbeAt ?? null,
        connector.probeStatus === 'reachable' ? 1 : 0,
        connector.lastError ?? null,
        connector.createdAt,
        connector.updatedAt,
        snapshot.workspaceId
      );
    }
  }

  private readConnectors(workspaceId: string): IOntologyConnectorConfig[] {
    const rows = this.db.prepare('SELECT * FROM connections WHERE created_by = ? ORDER BY created_at ASC').all(workspaceId) as IConnectionRow[];
    return rows.map((row) => {
      const params = parseJson<JsonRecord>(row.params, {});
      const credential = parseCredential(row.credential_ref);
      return {
        id: row.id,
        name: row.name,
        sourceType: (params.sourceType as OntologyConnectionSourceType | undefined) ?? (row.type as OntologyConnectionSourceType),
        kind: (params.kind as OntologyAssetKind | undefined) ?? kindFromConnectionCategory(row.category),
        host: row.host || undefined,
        port: row.port || undefined,
        database: row.database || undefined,
        path: typeof params.path === 'string' ? params.path : undefined,
        url: typeof params.url === 'string' ? params.url : undefined,
        username: typeof credential?.username === 'string' ? credential.username : undefined,
        password: typeof credential?.password === 'string' ? credential.password : undefined,
        credentialRef: row.credential_ref || undefined,
        credential,
        params: stripConnectorParams(params),
        headers: isRecord(params.headers) ? (params.headers as Record<string, string>) : undefined,
        writable: Boolean(row.writable),
        poolSize: row.pool_size ?? undefined,
        rateLimitQps: row.rate_limit_qps ?? undefined,
        description: row.description ?? undefined,
        metadata: isRecord(params.metadata) ? (params.metadata as Record<string, string | number | boolean | null>) : {},
        probeStatus: row.last_test_ok ? 'reachable' : row.status === 'error' ? 'failed' : 'not_tested',
        lastProbeAt: fromOptionalDbTime(row.last_test_at),
        lastError: row.last_test_message ?? undefined,
        createdAt: fromDbTime(row.created_at),
        updatedAt: fromDbTime(row.updated_at),
      };
    });
  }

  private insertAssets(snapshot: IOntologyWorkbenchSnapshot): void {
    const statement = this.db.prepare(
      `INSERT INTO assets (
        id, name, alias, description, kind, connection_id, locator, schema_snapshot, schema_synced_at,
        primary_key, profile, document_source_type, parsed_summary, embedding_index_ref, refresh_policy,
        cache_ttl_seconds, sensitivity_tags, domain, tags, owner, status, legacy_datasource_id,
        legacy_business_document_id, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const asset of snapshot.assets) {
      const connectorId = stringValue(asset.metadata.connectorId);
      const locator = {
        source_type: asset.kind,
        currentKind: asset.kind,
        path: asset.path ?? null,
        sourceName: asset.sourceName ?? null,
        metadata: asset.metadata,
      };
      statement.run(
        asset.id,
        asset.name,
        null,
        null,
        originalAssetKind(asset.kind),
        connectorId ?? null,
        toJson(locator),
        toJson(asset.fields),
        numberValue(asset.metadata.schemaSyncedAt) ?? null,
        toJson([]),
        toJson({
          profileStatus: asset.profileStatus,
          metadata: asset.metadata,
        }),
        documentSourceType(asset.kind),
        null,
        null,
        'on_demand',
        0,
        toJson({}),
        snapshot.workspaceId,
        toJson([]),
        null,
        asset.profileStatus === 'failed' ? 'broken' : 'active',
        null,
        null,
        asset.createdAt,
        asset.updatedAt,
        snapshot.workspaceId
      );
    }
  }

  private readAssets(workspaceId: string): IOntologyEnvironmentAsset[] {
    const rows = this.db.prepare('SELECT * FROM assets WHERE domain = ? ORDER BY created_at ASC').all(workspaceId) as IAssetRow[];
    return rows.map((row) => {
      const locator = parseJson<JsonRecord>(row.locator, {});
      const profile = parseJson<JsonRecord>(row.profile, {});
      const metadata = isRecord(locator.metadata) ? (locator.metadata as Record<string, string | number | boolean | null>) : {};
      return {
        id: row.id,
        kind: (locator.currentKind as OntologyAssetKind | undefined) ?? currentAssetKind(row.kind, row.document_source_type),
        name: row.name,
        sourceName: typeof locator.sourceName === 'string' ? locator.sourceName : undefined,
        path: typeof locator.path === 'string' ? locator.path : undefined,
        profileStatus: profile.profileStatus === 'failed' || profile.profileStatus === 'profiling' || profile.profileStatus === 'ready' ? profile.profileStatus : 'not_profiled',
        fields: parseJson<IOntologyAssetField[]>(row.schema_snapshot, []),
        metadata,
        createdAt: fromDbTime(row.created_at),
        updatedAt: fromDbTime(row.updated_at),
      };
    });
  }

  private insertObjects(snapshot: IOntologyWorkbenchSnapshot): void {
    const objectStatement = this.db.prepare(
      `INSERT INTO ontology_entities (
        id, name, name_cn, tier, status, description, config_json, scenario_codes,
        ontology_id, created_at, updated_at, created_by, publish_config
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const attributeStatement = this.db.prepare(
      `INSERT INTO entity_attributes (
        id, entity_id, name, type, description, required, example, constraints_json,
        source_table, source_field, data_status, shared_attribute_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const object of snapshot.objects) {
      objectStatement.run(
        object.id,
        object.code,
        object.name,
        object.tier,
        object.status,
        object.description,
        toJson({
          code: object.code,
          sourceAssetIds: object.sourceAssetIds,
          reviewDecision: object.reviewDecision,
          updatedAt: object.updatedAt,
          namespace: object.namespace,
        }),
        toJson([snapshot.workspaceId]),
        snapshot.workspaceId,
        object.updatedAt,
        object.updatedAt,
        snapshot.workspaceId,
        toJson({})
      );
      for (const attribute of object.attributes) {
        attributeStatement.run(
          attribute.id,
          object.id,
          attribute.code,
          attribute.dataType,
          attribute.description ?? '',
          attribute.required ? 1 : 0,
          attribute.example ?? null,
          toJson({
            code: attribute.code,
            name: attribute.name,
            mappedField: attribute.mappedField,
            constraints: attribute.constraints,
          }),
          attribute.mappedField?.assetId ?? null,
          attribute.mappedField?.fieldName ?? null,
          attribute.mappedField ? '已映射' : '未确认来源',
          null
        );
      }
    }
  }

  private readObjects(workspaceId: string): IOntologyObjectDraft[] {
    const rows = this.db.prepare('SELECT * FROM ontology_entities WHERE ontology_id = ? ORDER BY created_at ASC').all(workspaceId) as IEntityRow[];
    if (rows.length === 0) return [];
    const attributes = this.db.prepare(`SELECT * FROM entity_attributes WHERE entity_id IN (${placeholders(rows)})`).all(...rows.map((row) => row.id)) as IAttributeRow[];
    const attributesByEntity = groupBy(attributes, (row) => row.entity_id);
    const reviewDecisions = this.readLatestReviewDecisions(workspaceId);
    return rows.map((row) => {
      const config = parseJson<JsonRecord>(row.config_json, {});
      const objectAttributes = (attributesByEntity.get(row.id) ?? []).map((attribute): IOntologyObjectDraft['attributes'][number] => {
        const attributeConfig = parseJson<JsonRecord>(attribute.constraints_json, {});
        const mappedField = isMappedField(attributeConfig.mappedField) ? attributeConfig.mappedField : attribute.source_table && attribute.source_field ? { assetId: attribute.source_table, fieldName: attribute.source_field } : undefined;
        return {
          id: attribute.id,
          code: typeof attributeConfig.code === 'string' ? attributeConfig.code : attribute.name,
          name: typeof attributeConfig.name === 'string' ? attributeConfig.name : attribute.name,
          dataType: attribute.type,
          required: Boolean(attribute.required),
          description: attribute.description ?? undefined,
          example: attribute.example ?? undefined,
          constraints: isRecord(attributeConfig.constraints) ? (attributeConfig.constraints as IOntologyObjectDraft['attributes'][number]['constraints']) : undefined,
          mappedField,
        };
      });
      return {
        id: row.id,
        code: typeof config.code === 'string' ? config.code : row.name,
        name: row.name_cn || row.name,
        description: row.description ?? '',
        tier: row.tier === 1 || row.tier === 2 ? row.tier : 3,
        status: row.status === 'warning' || row.status === 'error' ? row.status : 'active',
        namespace: stringValue(config.namespace),
        sourceAssetIds: Array.isArray(config.sourceAssetIds) ? config.sourceAssetIds.filter(isString) : [],
        attributes: objectAttributes,
        reviewDecision: reviewDecisions.get(row.id) ?? reviewDecision(config.reviewDecision),
        updatedAt: numberValue(config.updatedAt) ?? fromDbTime(row.updated_at),
      };
    });
  }

  private insertRelations(snapshot: IOntologyWorkbenchSnapshot): void {
    const statement = this.db.prepare(
      `INSERT INTO entity_relations (
        id, from_entity_id, to_entity_id, name, code, rel_type, semantic_type, cardinality, acyclic, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const relation of snapshot.relations) {
      statement.run(relation.id, relation.fromObjectId, relation.toObjectId, relation.name, relation.code, relation.relationType, relation.semanticType, relation.cardinality, relation.isAcyclic ? 1 : 0, relation.description ?? null, relation.updatedAt);
    }
  }

  private readRelations(objects: IOntologyObjectDraft[]): IOntologyRelationDraft[] {
    if (objects.length === 0) return [];
    const objectIds = objects.map((object) => object.id);
    const rows = this.db.prepare(`SELECT * FROM entity_relations WHERE from_entity_id IN (${placeholders(objectIds)}) OR to_entity_id IN (${placeholders(objectIds)}) ORDER BY created_at ASC`).all(...objectIds, ...objectIds) as IRelationRow[];
    const workspaceId = this.workspaceIdFromObjects(objects);
    const reviewDecisions = workspaceId ? this.readLatestReviewDecisions(workspaceId) : new Map<string, IOntologyRelationDraft['reviewDecision']>();
    return rows.map((row) => ({
      id: row.id,
      code: row.code || row.rel_type,
      name: row.name,
      fromObjectId: row.from_entity_id,
      toObjectId: row.to_entity_id,
      cardinality: relationCardinality(row.cardinality),
      relationType: relationType(row.rel_type),
      semanticType: relationSemanticType(row.semantic_type),
      isAcyclic: Boolean(row.acyclic),
      description: row.description ?? undefined,
      reviewDecision: reviewDecisions.get(row.id) ?? 'pending',
      updatedAt: fromDbTime(row.created_at),
    }));
  }

  private workspaceIdFromObjects(objects: IOntologyObjectDraft[]): string | null {
    const first = objects[0];
    if (!first) return null;
    const row = this.db.prepare('SELECT ontology_id FROM ontology_entities WHERE id = ?').get(first.id) as { ontology_id: string | null } | undefined;
    return row?.ontology_id ?? null;
  }

  private insertObjectBindings(snapshot: IOntologyWorkbenchSnapshot): void {
    const grouped = new Map<string, IOntologyFieldMapping[]>();
    for (const mapping of snapshot.mappings) {
      const key = `${mapping.objectId}:${mapping.assetId}`;
      grouped.set(key, [...(grouped.get(key) ?? []), mapping]);
    }

    const objectById = new Map(snapshot.objects.map((object) => [object.id, object]));
    for (const object of snapshot.objects) {
      for (const assetId of object.sourceAssetIds) {
        const key = `${object.id}:${assetId}`;
        if (!grouped.has(key)) grouped.set(key, []);
      }
    }

    const statement = this.db.prepare(
      `INSERT INTO object_bindings (
        id, object_type_id, asset_id, role, field_mappings, id_column, filter_expr,
        status, review_reason, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const usageStatement = this.db.prepare(
      `INSERT INTO asset_usage (id, asset_id, used_by_kind, used_by_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const [key, mappings] of grouped) {
      const [objectId, assetId] = key.split(':');
      const object = objectById.get(objectId);
      if (!object) continue;
      const updatedAt = mappings[0]?.updatedAt ?? object.updatedAt;
      const bindingId = `binding:${objectId}:${assetId}`;
      statement.run(
        bindingId,
        objectId,
        assetId,
        'primary',
        toJson(
          mappings.map((mapping) => ({
            id: mapping.id,
            attribute_id: mapping.attributeId,
            source_column: mapping.fieldName,
            confidence: mapping.confidence,
            strategy: mapping.strategy,
            status: mapping.status,
            updated_at: mapping.updatedAt,
          }))
        ),
        null,
        null,
        object.reviewDecision === 'approved' ? 'active' : 'needs_review',
        object.reviewDecision === 'approved' ? null : 'Ontology object requires review',
        updatedAt,
        updatedAt,
        snapshot.workspaceId
      );
      usageStatement.run(`usage:${bindingId}`, assetId, 'object_binding', bindingId, `Bound to ${object.name}`, updatedAt);
    }
  }

  private readMappings(objects: IOntologyObjectDraft[]): IOntologyFieldMapping[] {
    if (objects.length === 0) return [];
    const objectIds = objects.map((object) => object.id);
    const rows = this.db.prepare(`SELECT * FROM object_bindings WHERE object_type_id IN (${placeholders(objectIds)}) ORDER BY created_at ASC`).all(...objectIds) as IObjectBindingRow[];
    return rows.flatMap((row) =>
      parseJson<Array<Record<string, unknown>>>(row.field_mappings, []).map((mapping) => ({
        id: stringValue(mapping.id) ?? `${row.id}:${mapping.attribute_id ?? mapping.source_column}`,
        objectId: row.object_type_id,
        attributeId: stringValue(mapping.attribute_id) ?? '',
        assetId: row.asset_id,
        fieldName: stringValue(mapping.source_column) ?? '',
        confidence: numberValue(mapping.confidence) ?? 0,
        strategy: mapping.strategy === 'exact' || mapping.strategy === 'normalized' || mapping.strategy === 'ai_suggested' || mapping.strategy === 'manual' ? mapping.strategy : 'manual',
        status: reviewDecision(mapping.status),
        updatedAt: numberValue(mapping.updated_at) ?? fromDbTime(row.updated_at),
      }))
    );
  }

  private insertQualityRules(snapshot: IOntologyWorkbenchSnapshot): void {
    const objectById = new Map(snapshot.objects.map((object) => [object.id, object]));
    const statement = this.db.prepare(
      `INSERT INTO quality_rules (
        id, asset_id, name, kind, column_name, params, severity, enabled, description,
        created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const rule of snapshot.qualityRules) {
      const object = objectById.get(rule.objectId);
      const assetId = object?.sourceAssetIds[0] ?? snapshot.assets[0]?.id ?? rule.objectId;
      statement.run(
        rule.id,
        assetId,
        rule.name,
        'schema_stable',
        null,
        toJson({
          objectId: rule.objectId,
          code: rule.code,
          expression: rule.expression,
          status: rule.status,
        }),
        rule.severity === 'error' ? 'failure' : rule.severity === 'warning' ? 'warning' : 'ok',
        rule.status === 'disabled' ? 0 : 1,
        rule.expression,
        rule.updatedAt,
        rule.updatedAt,
        snapshot.workspaceId
      );
    }
  }

  private readQualityRules(workspaceId: string, objects: IOntologyObjectDraft[]): IOntologyQualityRule[] {
    const objectIds = new Set(objects.map((object) => object.id));
    const rows = this.db.prepare('SELECT * FROM quality_rules WHERE created_by = ? ORDER BY created_at ASC').all(workspaceId) as IQualityRuleRow[];
    return rows.flatMap((row) => {
      const params = parseJson<JsonRecord>(row.params, {});
      const objectId = stringValue(params.objectId);
      if (!objectId || !objectIds.has(objectId)) return [];
      return [
        {
          id: row.id,
          objectId,
          code: stringValue(params.code) ?? row.kind,
          name: row.name,
          expression: stringValue(params.expression) ?? row.description ?? '',
          severity: row.severity === 'failure' ? 'error' : row.severity === 'ok' ? 'info' : 'warning',
          status: params.status === 'draft' || params.status === 'disabled' || params.status === 'active' ? params.status : row.enabled ? 'active' : 'disabled',
          updatedAt: fromDbTime(row.updated_at),
        },
      ];
    });
  }

  private insertBusinessDocuments(snapshot: IOntologyWorkbenchSnapshot): void {
    const statement = this.db.prepare(
      `INSERT INTO business_documents (
        id, name, file_type, file_path, parsed_text, summary, domain_tags, size_bytes,
        uploaded_by, uploaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const document of snapshot.businessDocuments) {
      statement.run(
        document.id,
        document.title,
        document.format,
        null,
        document.content,
        document.content.slice(0, 500),
        toJson({
          workspaceId: snapshot.workspaceId,
          objectIds: document.objectIds,
        }),
        Buffer.byteLength(document.content, 'utf8'),
        snapshot.workspaceId,
        document.updatedAt
      );
    }
  }

  private readBusinessDocuments(workspaceId: string): IOntologyBusinessDocument[] {
    const rows = this.db.prepare('SELECT * FROM business_documents WHERE uploaded_by = ? ORDER BY uploaded_at ASC').all(workspaceId) as IBusinessDocumentRow[];
    return rows.map((row) => {
      const tags = parseJson<JsonRecord>(row.domain_tags, {});
      return {
        id: row.id,
        title: row.name,
        format: row.file_type === 'json' || row.file_type === 'pdf' ? row.file_type : 'markdown',
        objectIds: Array.isArray(tags.objectIds) ? tags.objectIds.filter(isString) : [],
        content: row.parsed_text ?? '',
        updatedAt: fromDbTime(row.uploaded_at),
      };
    });
  }

  private insertLogicFunctions(snapshot: IOntologyWorkbenchSnapshot): void {
    const statement = this.db.prepare(
      `INSERT INTO ontology_functions (
        id, entity_id, ontology_id, entity_ids, name, description, return_type, input_schema,
        logic_type, logic_body, status, tags, callable_name, is_derived_property,
        execution_count, last_executed, source_path, func_name, checksum, registered_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const fn of snapshot.logicFunctions) {
      statement.run(
        fn.id,
        fn.objectIds[0] ?? null,
        snapshot.workspaceId,
        toJson(fn.objectIds),
        fn.name,
        fn.description,
        fn.returnType,
        toJson(fn.parameters),
        fn.runtime,
        fn.body,
        fn.status,
        toJson([{ code: fn.code, signature: fn.signature, origin: fn.origin }]),
        fn.code,
        0,
        fn.executionCount,
        fn.lastExecutedAt ?? null,
        null,
        fn.code,
        null,
        'ui',
        fn.updatedAt,
        fn.updatedAt
      );
    }
  }

  private readLogicFunctions(workspaceId: string): IOntologyLogicFunction[] {
    const rows = this.db.prepare('SELECT * FROM ontology_functions WHERE ontology_id = ? ORDER BY created_at ASC').all(workspaceId) as IFunctionRow[];
    return rows.map((row) => {
      const tags = parseJson<Array<Record<string, unknown>>>(row.tags, []);
      const metadata = tags.find((item) => typeof item.code === 'string');
      const tagCode = metadata?.code;
      return {
        id: row.id,
        code: typeof tagCode === 'string' ? tagCode : row.name,
        name: row.name,
        description: row.description ?? '',
        runtime: row.logic_type === 'python' || row.logic_type === 'sql' ? row.logic_type : 'typescript',
        objectIds: parseJson<string[]>(row.entity_ids, []),
        signature: typeof metadata?.signature === 'string' ? metadata.signature : '',
        body: row.logic_body ?? '',
        returnType: row.return_type || 'unknown',
        parameters: parseJson<IOntologyLogicFunction['parameters']>(row.input_schema, []),
        origin: metadata?.origin === 'manual' ? 'manual' : 'generated',
        status: row.status === 'draft' || row.status === 'disabled' ? row.status : 'active',
        executionCount: row.execution_count ?? 0,
        lastExecutedAt: row.last_executed ? fromDbTime(row.last_executed) : undefined,
        updatedAt: fromDbTime(row.updated_at),
      };
    });
  }

  private insertActions(snapshot: IOntologyWorkbenchSnapshot): void {
    const statement = this.db.prepare(
      `INSERT INTO entity_actions (
        id, entity_id, ontology_id, name, category, action_type, type_config, description,
        status, impact_count, parameters_json, output_schema, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const action of snapshot.actions) {
      statement.run(
        action.id,
        action.objectIds[0] ?? null,
        snapshot.workspaceId,
        action.name,
        'domain',
        action.executor,
        toJson({
          code: action.code,
          objectIds: action.objectIds,
          configuration: action.configuration,
          origin: action.origin,
          executionCount: action.executionCount,
          lastExecutedAt: action.lastExecutedAt ?? null,
        }),
        action.description,
        action.status,
        action.objectIds.length,
        toJson(action.parameters),
        toJson(action.outputSchema),
        action.updatedAt,
        action.updatedAt
      );
    }
  }

  private readActions(workspaceId: string): IOntologyActionDefinition[] {
    const rows = this.db.prepare('SELECT * FROM entity_actions WHERE ontology_id = ? ORDER BY created_at ASC').all(workspaceId) as IActionRow[];
    return rows.map((row) => {
      const config = parseJson<JsonRecord>(row.type_config, {});
      return {
        id: row.id,
        code: stringValue(config.code) ?? row.name,
        name: row.name,
        executor: actionExecutor(row.action_type),
        objectIds: Array.isArray(config.objectIds) ? config.objectIds.filter(isString) : row.entity_id ? [row.entity_id] : [],
        description: row.description ?? '',
        configuration: isRecord(config.configuration) ? connectorConfigRecord(config.configuration) : {},
        parameters: parseJson<IOntologyActionDefinition['parameters']>(row.parameters_json, []),
        outputSchema: parseJson<IOntologyActionDefinition['outputSchema']>(row.output_schema, []),
        origin: config.origin === 'manual' ? 'manual' : 'generated',
        status: row.status === 'draft' || row.status === 'disabled' ? row.status : 'active',
        executionCount: numberValue(config.executionCount) ?? 0,
        lastExecutedAt: numberValue(config.lastExecutedAt),
        updatedAt: fromDbTime(row.updated_at),
      };
    });
  }

  private insertServiceEndpoints(snapshot: IOntologyWorkbenchSnapshot): void {
    const statement = this.db.prepare(
      `INSERT INTO skills (
        id, name, description, skill_type, config_json, code_ref, status, current_version,
        input_schema, output_schema, prompt_template, tools, test_cases, asset_refs,
        created_by, reviewed_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const endpoint of snapshot.serviceEndpoints) {
      statement.run(
        endpoint.id,
        endpoint.name,
        '',
        `ontology_${endpoint.protocol}`,
        toJson({
          protocol: endpoint.protocol,
          toolCount: endpoint.toolCount,
        }),
        endpoint.protocol,
        endpoint.status,
        1,
        toJson({}),
        toJson({}),
        '',
        toJson({}),
        toJson({}),
        toJson({}),
        snapshot.workspaceId,
        '',
        endpoint.updatedAt,
        endpoint.updatedAt
      );
    }
  }

  private readServiceEndpoints(workspaceId: string): IOntologyServiceEndpoint[] {
    const rows = this.db.prepare('SELECT * FROM skills WHERE created_by = ? AND skill_type LIKE ? ORDER BY created_at ASC').all(workspaceId, 'ontology_%') as ISkillRow[];
    return rows.map((row) => {
      const config = parseJson<JsonRecord>(row.config_json, {});
      return {
        id: row.id,
        name: row.name,
        protocol: config.protocol === 'osdk' || config.protocol === 'api' ? config.protocol : 'mcp',
        status: row.status === 'draft' || row.status === 'disabled' ? row.status : 'active',
        toolCount: numberValue(config.toolCount) ?? 0,
        updatedAt: fromDbTime(row.updated_at),
      };
    });
  }

  private insertPublishedVersions(snapshot: IOntologyWorkbenchSnapshot): void {
    const versionStatement = this.db.prepare(
      `INSERT INTO ontology_versions (
        id, version_number, name, ontology_id, description, status, created_by, approved_by,
        created_at, submitted_at, published_at, rejected_at, reject_reason, rollback_from, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const entityStatement = this.db.prepare(
      `INSERT INTO ontology_version_entities (
        id, version_id, source_entity_id, name, name_cn, tier, description, config_json,
        publish_config, scenario_codes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const attributeStatement = this.db.prepare(
      `INSERT INTO ontology_version_attributes (
        id, version_entity_id, source_attribute_id, name, type, description, required,
        example, constraints_json, source_table, source_field, data_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const relationStatement = this.db.prepare(
      `INSERT INTO ontology_version_relations (
        id, version_id, source_relation_id, from_version_entity_id, to_version_entity_id,
        name, rel_type, relation_type, semantic_type, cardinality, acyclic, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const functionStatement = this.db.prepare(
      `INSERT INTO ontology_version_functions (
        id, version_id, source_function_id, version_entity_id, name, config_json, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const actionStatement = this.db.prepare(
      `INSERT INTO ontology_version_actions (
        id, version_id, source_action_id, version_entity_id, name, config_json, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const metadataStatement = this.db.prepare(
      `INSERT INTO ontology_version_metadata (
        version_id, mappings, quality_rules, business_documents, service_endpoints
      ) VALUES (?, ?, ?, ?, ?)`
    );

    snapshot.publishedVersions.forEach((version, index) => {
      versionStatement.run(
        version.id,
        parseVersionNumber(version.version) ?? index + 1,
        version.version,
        snapshot.workspaceId,
        version.summary,
        version.status,
        'sudowork',
        version.approvedBy ?? null,
        version.createdAt,
        version.submittedAt ?? null,
        version.publishedAt ?? null,
        null,
        toJson(version.diff),
        null,
        version.isActive ? 1 : 0
      );
      const versionEntityIdByObjectId = new Map<string, string>();
      for (const object of version.snapshot.objects) {
        const versionEntityId = `${version.id}:entity:${object.id}`;
        versionEntityIdByObjectId.set(object.id, versionEntityId);
        entityStatement.run(
          versionEntityId,
          version.id,
          object.id,
          object.code,
          object.name,
          object.tier,
          object.description,
          toJson({
            code: object.code,
            sourceAssetIds: object.sourceAssetIds,
            reviewDecision: object.reviewDecision,
            updatedAt: object.updatedAt,
            status: object.status,
            namespace: object.namespace,
          }),
          toJson({}),
          toJson([snapshot.workspaceId])
        );
        for (const attribute of object.attributes) {
          attributeStatement.run(
            `${version.id}:attribute:${attribute.id}`,
            versionEntityId,
            attribute.id,
            attribute.code,
            attribute.dataType,
            attribute.description ?? '',
            attribute.required ? 1 : 0,
            attribute.example ?? null,
            toJson({
              code: attribute.code,
              name: attribute.name,
              mappedField: attribute.mappedField,
              constraints: attribute.constraints,
            }),
            attribute.mappedField?.assetId ?? null,
            attribute.mappedField?.fieldName ?? null,
            attribute.mappedField ? '已映射' : '未确认来源'
          );
        }
      }
      for (const relation of version.snapshot.relations) {
        relationStatement.run(
          `${version.id}:relation:${relation.id}`,
          version.id,
          relation.id,
          versionEntityIdByObjectId.get(relation.fromObjectId) ?? relation.fromObjectId,
          versionEntityIdByObjectId.get(relation.toObjectId) ?? relation.toObjectId,
          relation.name,
          relation.code,
          relation.relationType,
          relation.semanticType,
          relation.cardinality,
          relation.isAcyclic ? 1 : 0,
          relation.description ?? null
        );
      }
      for (const fn of version.snapshot.logicFunctions) {
        functionStatement.run(`${version.id}:function:${fn.id}`, version.id, fn.id, fn.objectIds[0] ? versionEntityIdByObjectId.get(fn.objectIds[0]) : null, fn.name, toJson(fn), fn.description);
      }
      for (const action of version.snapshot.actions) {
        actionStatement.run(`${version.id}:action:${action.id}`, version.id, action.id, action.objectIds[0] ? versionEntityIdByObjectId.get(action.objectIds[0]) : null, action.name, toJson(action), '');
      }
      metadataStatement.run(version.id, toJson(version.snapshot.mappings), toJson(version.snapshot.qualityRules), toJson(version.snapshot.businessDocuments), toJson(version.snapshot.serviceEndpoints));
    });
  }

  private readPublishedVersions(workspaceId: string): IOntologyPublishedVersion[] {
    const rows = this.db.prepare('SELECT * FROM ontology_versions WHERE ontology_id = ? ORDER BY version_number ASC').all(workspaceId) as IVersionRow[];
    return rows.map((row) => {
      const versionSnapshot = this.readVersionSnapshot(row.id);
      const diff = parseJson<IOntologyVersionDiff>(row.reject_reason, createEmptyVersionDiff(row.id));
      return {
        id: row.id,
        version: row.name,
        status: versionStatus(row.status),
        isActive: Boolean(row.is_active),
        objectCount: versionSnapshot.objects.length,
        relationCount: versionSnapshot.relations.length,
        submittedAt: fromOptionalDbTime(row.submitted_at),
        publishedAt: fromOptionalDbTime(row.published_at),
        approvedAt: row.status === 'published' || row.status === 'approved' ? fromOptionalDbTime(row.published_at) : undefined,
        approvedBy: row.approved_by ?? undefined,
        summary: row.description ?? '',
        diff,
        snapshot: versionSnapshot,
        createdAt: fromDbTime(row.created_at),
      };
    });
  }

  private readVersionSnapshot(versionId: string): IOntologyVersionSnapshot {
    const entityRows = this.db.prepare('SELECT * FROM ontology_version_entities WHERE version_id = ? ORDER BY id ASC').all(versionId) as IVersionEntityRow[];
    const attributeRows = entityRows.length > 0 ? (this.db.prepare(`SELECT * FROM ontology_version_attributes WHERE version_entity_id IN (${placeholders(entityRows)})`).all(...entityRows.map((row) => row.id)) as IVersionAttributeRow[]) : [];
    const attributesByEntity = groupBy(attributeRows, (row) => row.version_entity_id);
    const objectIdByVersionEntityId = new Map(entityRows.map((row) => [row.id, row.source_entity_id]));
    const objects: IOntologyObjectDraft[] = entityRows.map((row) => {
      const config = parseJson<JsonRecord>(row.config_json, {});
      return {
        id: row.source_entity_id,
        code: typeof config.code === 'string' ? config.code : row.name,
        name: row.name_cn || row.name,
        description: row.description ?? '',
        tier: row.tier === 1 || row.tier === 2 ? row.tier : 3,
        status: config.status === 'warning' || config.status === 'error' ? config.status : 'active',
        namespace: stringValue(config.namespace),
        sourceAssetIds: Array.isArray(config.sourceAssetIds) ? config.sourceAssetIds.filter(isString) : [],
        attributes: (attributesByEntity.get(row.id) ?? []).map((attribute) => {
          const attributeConfig = parseJson<JsonRecord>(attribute.constraints_json, {});
          return {
            id: attribute.source_attribute_id,
            code: stringValue(attributeConfig.code) ?? attribute.name,
            name: stringValue(attributeConfig.name) ?? attribute.name,
            dataType: attribute.type,
            required: Boolean(attribute.required),
            description: attribute.description ?? undefined,
            example: attribute.example ?? undefined,
            constraints: isRecord(attributeConfig.constraints) ? (attributeConfig.constraints as IOntologyObjectDraft['attributes'][number]['constraints']) : undefined,
            mappedField: isMappedField(attributeConfig.mappedField) ? attributeConfig.mappedField : attribute.source_table && attribute.source_field ? { assetId: attribute.source_table, fieldName: attribute.source_field } : undefined,
          };
        }),
        reviewDecision: reviewDecision(config.reviewDecision),
        updatedAt: numberValue(config.updatedAt) ?? Date.now(),
      };
    });
    const relationRows = this.db.prepare('SELECT * FROM ontology_version_relations WHERE version_id = ? ORDER BY id ASC').all(versionId) as IVersionRelationRow[];
    const relations: IOntologyRelationDraft[] = relationRows.map((row) => ({
      id: row.source_relation_id,
      code: row.rel_type,
      name: row.name,
      fromObjectId: objectIdByVersionEntityId.get(row.from_version_entity_id) ?? row.from_version_entity_id,
      toObjectId: objectIdByVersionEntityId.get(row.to_version_entity_id) ?? row.to_version_entity_id,
      cardinality: relationCardinality(row.cardinality),
      relationType: relationType(row.relation_type),
      semanticType: relationSemanticType(row.semantic_type),
      isAcyclic: Boolean(row.acyclic),
      description: row.description ?? undefined,
      reviewDecision: 'approved',
      updatedAt: Date.now(),
    }));
    const functionRows = this.db.prepare('SELECT * FROM ontology_version_functions WHERE version_id = ? ORDER BY id ASC').all(versionId) as IVersionComponentRow[];
    const actionRows = this.db.prepare('SELECT * FROM ontology_version_actions WHERE version_id = ? ORDER BY id ASC').all(versionId) as IVersionComponentRow[];
    const metadata = this.db.prepare('SELECT * FROM ontology_version_metadata WHERE version_id = ?').get(versionId) as IVersionMetadataRow | undefined;
    return {
      objects,
      relations,
      mappings: parseJson<IOntologyFieldMapping[]>(metadata?.mappings, []),
      qualityRules: parseJson<IOntologyQualityRule[]>(metadata?.quality_rules, []),
      logicFunctions: functionRows.map((row) => parseJson<IOntologyLogicFunction>(row.config_json, fallbackVersionFunction(row))),
      actions: actionRows.map((row) => parseJson<IOntologyActionDefinition>(row.config_json, fallbackVersionAction(row))),
      serviceEndpoints: parseJson<IOntologyServiceEndpoint[]>(metadata?.service_endpoints, []),
      businessDocuments: parseJson<IOntologyBusinessDocument[]>(metadata?.business_documents, []),
    };
  }

  private insertAgentBlueprints(snapshot: IOntologyWorkbenchSnapshot): void {
    const statement = this.db.prepare(
      `INSERT INTO agents (
        id, name, description, tags, model_id, system_prompt, kb_ids, entity_ids,
        ontology_version_id, ontology_stale, ontology_stale_detail, tools_config,
        nodes_json, edges_json, status, api_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const blueprint of snapshot.agentBlueprints) {
      statement.run(
        blueprint.id,
        blueprint.name,
        '',
        toJson(['ontology', snapshot.workspaceId]),
        null,
        blueprint.promptTemplate,
        toJson([]),
        toJson(blueprint.entityIds),
        blueprint.ontologyVersionId,
        0,
        toJson({}),
        toJson({
          toolManifest: blueprint.toolManifest,
          status: blueprint.status,
          registeredAssistantId: blueprint.registeredAssistantId,
          registeredAt: blueprint.registeredAt,
        }),
        toJson([]),
        toJson([]),
        blueprint.status === 'draft' ? 'draft' : 'published',
        blueprint.registeredAssistantId ?? null,
        blueprint.createdAt,
        blueprint.updatedAt
      );
    }
  }

  private readAgentBlueprints(versions: IOntologyPublishedVersion[]): IOntologyAgentBlueprint[] {
    const versionIds = versions.map((version) => version.id);
    if (versionIds.length === 0) return [];
    const rows = this.db.prepare(`SELECT * FROM agents WHERE ontology_version_id IN (${placeholders(versionIds)}) ORDER BY created_at ASC`).all(...versionIds) as IAgentRow[];
    return rows.map((row) => {
      const config = parseJson<JsonRecord>(row.tools_config, {});
      return {
        id: row.id,
        name: row.name,
        status: agentBlueprintStatus(config.status),
        ontologyVersionId: row.ontology_version_id ?? '',
        registeredAssistantId: stringValue(config.registeredAssistantId) ?? row.api_key ?? undefined,
        registeredAt: numberValue(config.registeredAt),
        entityIds: parseJson<string[]>(row.entity_ids, []),
        promptTemplate: row.system_prompt ?? '',
        toolManifest: Array.isArray(config.toolManifest) ? (config.toolManifest as IOntologyAgentBlueprint['toolManifest']) : [],
        createdAt: fromDbTime(row.created_at),
        updatedAt: fromDbTime(row.updated_at),
      };
    });
  }

  private insertAuditRecords(snapshot: IOntologyWorkbenchSnapshot): void {
    const statement = this.db.prepare(
      `INSERT INTO audit_log (
        id, timestamp, user_id, user_name, action, target_type, target_id,
        target_name, details, status, changes_json, snapshot_before, snapshot_after
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of snapshot.reviewItems) {
      statement.run(
        item.id,
        item.createdAt,
        snapshot.workspaceId,
        item.reviewerId,
        'review',
        item.targetType,
        item.targetId,
        '',
        item.comment,
        item.decision,
        toJson({
          decision: item.decision,
          comment: item.comment,
        }),
        null,
        null
      );
    }
    for (const object of snapshot.objects.filter((item) => item.reviewDecision !== 'pending')) {
      statement.run(`review-state:${object.id}`, object.updatedAt, snapshot.workspaceId, 'system', 'review', 'object', object.id, object.name, '', object.reviewDecision, toJson({ decision: object.reviewDecision, comment: '' }), null, null);
    }
    for (const relation of snapshot.relations.filter((item) => item.reviewDecision !== 'pending')) {
      statement.run(`review-state:${relation.id}`, relation.updatedAt, snapshot.workspaceId, 'system', 'review', 'relation', relation.id, relation.name, '', relation.reviewDecision, toJson({ decision: relation.reviewDecision, comment: '' }), null, null);
    }
    for (const event of snapshot.monitorEvents) {
      statement.run(event.id, event.createdAt, snapshot.workspaceId, 'system', 'monitor', 'monitor_event', event.id, event.source, event.message, event.level, toJson({ source: event.source, level: event.level }), null, null);
    }
    for (const impact of snapshot.impactAnalyses) {
      statement.run(
        impact.id,
        impact.createdAt,
        snapshot.workspaceId,
        'system',
        'impact',
        'impact_analysis',
        impact.id,
        impact.riskLevel,
        impact.summary,
        'success',
        toJson({
          affectedObjectIds: impact.affectedObjectIds,
          affectedRelationIds: impact.affectedRelationIds,
          riskLevel: impact.riskLevel,
        }),
        null,
        null
      );
    }
  }

  private readReviewItems(workspaceId: string): IOntologyReviewItem[] {
    const rows = this.db.prepare("SELECT * FROM audit_log WHERE user_id = ? AND action = 'review' AND id NOT LIKE 'review-state:%' ORDER BY timestamp ASC").all(workspaceId) as IAuditRow[];
    return rows.map((row) => {
      const changes = parseJson<JsonRecord>(row.changes_json, {});
      return {
        id: row.id,
        targetType: reviewTargetType(row.target_type),
        targetId: row.target_id,
        decision: reviewDecision(changes.decision ?? row.status),
        comment: stringValue(changes.comment) ?? row.details ?? '',
        reviewerId: row.user_id ?? 'local-user',
        createdAt: fromDbTime(row.timestamp),
      };
    });
  }

  private readLatestReviewDecisions(workspaceId: string): Map<string, IOntologyReviewItem['decision']> {
    const rows = this.db.prepare("SELECT * FROM audit_log WHERE user_id = ? AND action = 'review' ORDER BY timestamp ASC").all(workspaceId) as IAuditRow[];
    const decisions = new Map<string, IOntologyReviewItem['decision']>();
    for (const row of rows) {
      decisions.set(row.target_id, reviewDecision(row.status));
    }
    return decisions;
  }

  private readMonitorEvents(workspaceId: string): IOntologyMonitorEvent[] {
    const rows = this.db.prepare("SELECT * FROM audit_log WHERE user_id = ? AND target_type = 'monitor_event' ORDER BY timestamp DESC").all(workspaceId) as IAuditRow[];
    return rows.map((row) => ({
      id: row.id,
      level: row.status === 'error' || row.status === 'warning' ? row.status : 'info',
      source: ontologyCapability(row.target_name),
      message: row.details ?? '',
      createdAt: fromDbTime(row.timestamp),
    }));
  }

  private readImpactAnalyses(workspaceId: string): IOntologyImpactAnalysis[] {
    const rows = this.db.prepare("SELECT * FROM audit_log WHERE user_id = ? AND target_type = 'impact_analysis' ORDER BY timestamp DESC").all(workspaceId) as IAuditRow[];
    return rows.map((row) => {
      const changes = parseJson<JsonRecord>(row.changes_json, {});
      return {
        id: row.id,
        summary: row.details ?? '',
        affectedObjectIds: Array.isArray(changes.affectedObjectIds) ? changes.affectedObjectIds.filter(isString) : [],
        affectedRelationIds: Array.isArray(changes.affectedRelationIds) ? changes.affectedRelationIds.filter(isString) : [],
        riskLevel: changes.riskLevel === 'high' || changes.riskLevel === 'medium' ? changes.riskLevel : 'low',
        createdAt: fromDbTime(row.timestamp),
      };
    });
  }

  private buildConnectionProfiles(connectors: IOntologyConnectorConfig[], assets: IOntologyEnvironmentAsset[]): IOntologyConnectionProfile[] {
    const profiles: IOntologyConnectionProfile[] = connectors.map((connector) => {
      const connectorAssets = assets.filter((asset) => asset.metadata.connectorId === connector.id);
      return {
        id: `profile:${connector.id}`,
        name: connector.name,
        kind: connector.kind,
        status: connector.probeStatus === 'reachable' ? 'ready' : connector.probeStatus === 'failed' ? 'failed' : 'not_profiled',
        assetIds: connectorAssets.map((asset) => asset.id),
        connectorId: connector.id,
        lastProbeAt: connector.lastProbeAt,
        metadata: {
          sourceType: connector.sourceType,
          path: connector.path ?? null,
          url: connector.url ?? null,
        },
        createdAt: connector.createdAt,
        updatedAt: connector.updatedAt,
      };
    });
    const localAssets = assets.filter((asset) => !asset.metadata.connectorId);
    const localGroups = groupBy(localAssets, (asset) => asset.sourceName ?? asset.kind);
    for (const [name, group] of localGroups) {
      const first = group[0];
      profiles.push({
        id: `profile:local:${name}`,
        name,
        kind: first.kind,
        status: group.some((asset) => asset.profileStatus === 'ready') ? 'ready' : 'not_profiled',
        assetIds: group.map((asset) => asset.id),
        lastProbeAt: Math.max(...group.map((asset) => asset.updatedAt)),
        metadata: {
          sourceName: name,
        },
        createdAt: Math.min(...group.map((asset) => asset.createdAt)),
        updatedAt: Math.max(...group.map((asset) => asset.updatedAt)),
      });
    }
    return profiles.filter((profile) => profile.assetIds.length > 0 || profile.connectorId);
  }
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function fromDbTime(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function fromOptionalDbTime(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return fromDbTime(value);
}

function placeholders(values: Array<unknown> | number): string {
  const length = typeof values === 'number' ? values : values.length;
  return Array.from({ length }, () => '?').join(', ');
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function connectorConfigRecord(value: Record<string, unknown>): IOntologyActionDefinition['configuration'] {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, IOntologyActionDefinition['configuration'][string]] => isJsonValue(entry[1])));
}

function isJsonValue(value: unknown): value is IOntologyActionDefinition['configuration'][string] {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isMappedField(value: unknown): value is { assetId: string; fieldName: string } {
  return isRecord(value) && typeof value.assetId === 'string' && typeof value.fieldName === 'string';
}

function connectionCategory(connector: IOntologyConnectorConfig): string {
  if (connector.sourceType === 'oss' || connector.sourceType === 's3') return 'object_storage';
  if (connector.sourceType === 'ftp' || connector.sourceType === 'sftp') return 'file_transfer';
  if (connector.sourceType === 'mq' || connector.sourceType === 'kafka') return 'message_queue';
  if (connector.sourceType === 'openapi' || connector.sourceType === 'rest') return 'api';
  return 'database';
}

function kindFromConnectionCategory(category: string): OntologyAssetKind {
  if (category === 'object_storage') return 'oss';
  if (category === 'message_queue') return 'mq';
  if (category === 'api') return 'api';
  if (category === 'file_transfer') return 'directory';
  return 'database';
}

function stripConnectorParams(params: JsonRecord): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(params)) {
    if (['sourceType', 'kind', 'path', 'url', 'headers', 'metadata'].includes(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      result[key] = value as string | number | boolean | null;
    }
  }
  return result;
}

function parseCredential(credentialRef: string | null): Record<string, string | number | boolean | null> | undefined {
  if (!credentialRef) return undefined;
  try {
    if (credentialRef.startsWith('secure://')) {
      const encrypted = Buffer.from(credentialRef.slice('secure://'.length), 'base64');
      return JSON.parse(safeStorage.decryptString(encrypted)) as Record<string, string | number | boolean | null>;
    }
    // Read legacy records once; the next snapshot write migrates them to safeStorage.
    if (credentialRef.startsWith('plain://')) {
      return JSON.parse(Buffer.from(credentialRef.slice('plain://'.length), 'base64').toString('utf8')) as Record<string, string | number | boolean | null>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function serializeCredential(credential: IOntologyConnectorConfig['credential'], credentialRef: string | undefined): string {
  if (!credential || Object.keys(credential).length === 0) return credentialRef?.startsWith('secure://') ? credentialRef : '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable. Connector credentials were not saved.');
  return `secure://${safeStorage.encryptString(toJson(credential)).toString('base64')}`;
}

function originalAssetKind(kind: OntologyAssetKind): string {
  return kind === 'table' || kind === 'schema' || kind === 'database' ? 'table' : 'document';
}

function currentAssetKind(kind: string, sourceType: string | null): OntologyAssetKind {
  if (sourceType === 'api') return 'api';
  if (sourceType === 'mq') return 'mq';
  if (sourceType === 'oss') return 'oss';
  if (sourceType === 'directory') return 'directory';
  return kind === 'table' || kind === 'sql_view' ? 'table' : 'document';
}

function documentSourceType(kind: OntologyAssetKind): string | null {
  if (kind === 'api') return 'api';
  if (kind === 'mq') return 'mq';
  if (kind === 'oss') return 'oss';
  if (kind === 'directory' || kind === 'document') return 'directory';
  return null;
}

function relationCardinality(value: string): IOntologyRelationDraft['cardinality'] {
  if (value === 'one_to_one' || value === 'many_to_one' || value === 'many_to_many') return value;
  return 'one_to_many';
}

function relationType(value: string | null): IOntologyRelationDraft['relationType'] {
  if (value === 'symmetric_property' || value === 'transitive_property' || value === 'functional_property') return value;
  return 'object_property';
}

function relationSemanticType(value: string | null): IOntologyRelationDraft['semanticType'] {
  if (value === 'composition' || value === 'event' || value === 'inheritance' || value === 'dependency') return value;
  return 'association';
}

function reviewDecision(value: unknown): IOntologyReviewItem['decision'] {
  if (value === 'approved' || value === 'changes_requested' || value === 'rejected') return value;
  return 'pending';
}

function reviewTargetType(value: string): IOntologyReviewItem['targetType'] {
  if (value === 'relation' || value === 'version' || value === 'agent') return value;
  return 'object';
}

function ontologyCapability(value: string | null): OntologyCapabilityId {
  const candidates: OntologyCapabilityId[] = ['data_integration', 'asset_catalog', 'ontology_modeling', 'ai_builder', 'doc_builder', 'review_collaboration', 'hydration_mapping', 'publish_governance', 'logic_modeling', 'agent_builder', 'service_registry', 'monitoring'];
  return candidates.find((candidate) => candidate === value) ?? 'monitoring';
}

function actionExecutor(value: string | null): IOntologyActionDefinition['executor'] {
  if (value === 'api' || value === 'sql' || value === 'notification' || value === 'custom_script') return value;
  return 'function';
}

function parseVersionNumber(value: string): number | undefined {
  const parsed = Number(value.replace(/^v/i, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function versionStatus(value: string | null): IOntologyPublishedVersion['status'] {
  if (value === 'draft' || value === 'submitted' || value === 'approved' || value === 'rejected' || value === 'rolled_back') return value;
  return 'published';
}

function agentBlueprintStatus(value: unknown): IOntologyAgentBlueprint['status'] {
  if (value === 'registered' || value === 'published') return value;
  return 'draft';
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
    riskLevel: 'low',
    summary: 'Version diff unavailable.',
  };
}

function fallbackVersionFunction(row: IVersionComponentRow): IOntologyLogicFunction {
  return {
    id: row.source_id ?? row.id,
    code: row.name,
    name: row.name,
    description: row.description ?? '',
    runtime: 'typescript',
    objectIds: [],
    signature: '',
    body: '',
    returnType: 'unknown',
    parameters: [],
    origin: 'generated',
    status: 'active',
    executionCount: 0,
    updatedAt: Date.now(),
  };
}

function fallbackVersionAction(row: IVersionComponentRow): IOntologyActionDefinition {
  return {
    id: row.source_id ?? row.id,
    code: row.name,
    name: row.name,
    executor: 'function',
    objectIds: [],
    description: row.description ?? '',
    configuration: {},
    parameters: [],
    outputSchema: [],
    origin: 'generated',
    status: 'active',
    executionCount: 0,
    updatedAt: Date.now(),
  };
}

const ONTOLOGY_SQLITE_SCHEMA = `
DROP INDEX IF EXISTS idx_ontology_snapshots_updated_at;
DROP TABLE IF EXISTS ontology_snapshots;
DROP TABLE IF EXISTS ontology_state;

CREATE TABLE IF NOT EXISTS scenario_dict (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS system_config (
  id TEXT PRIMARY KEY,
  "group" TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  description TEXT,
  updated_at INTEGER,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS ix_system_config_group ON system_config ("group");

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  hashed_password TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  email TEXT,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER,
  last_login_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT DEFAULT '',
  details TEXT,
  status TEXT DEFAULT 'success',
  changes_json TEXT,
  snapshot_before TEXT,
  snapshot_after TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_log_timestamp ON audit_log (timestamp);

CREATE TABLE IF NOT EXISTS dashboard_configs (
  id TEXT PRIMARY KEY,
  cards_config TEXT,
  refresh_interval INTEGER DEFAULT 30,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'database',
  type TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 0,
  database TEXT DEFAULT '',
  params TEXT,
  credential_ref TEXT DEFAULT '',
  credential_type TEXT DEFAULT 'plain',
  writable INTEGER DEFAULT 0,
  pool_size INTEGER DEFAULT 4,
  rate_limit_qps INTEGER DEFAULT 20,
  description TEXT,
  status TEXT DEFAULT 'active',
  enabled INTEGER DEFAULT 1,
  last_test_at INTEGER,
  last_test_ok INTEGER DEFAULT 0,
  last_test_message TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS ix_connections_category_type ON connections (category, type);
CREATE INDEX IF NOT EXISTS ix_connections_status_enabled ON connections (status, enabled);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT UNIQUE,
  description TEXT,
  kind TEXT NOT NULL,
  connection_id TEXT,
  locator TEXT NOT NULL,
  schema_snapshot TEXT,
  schema_synced_at INTEGER,
  primary_key TEXT,
  profile TEXT,
  document_source_type TEXT,
  parsed_summary TEXT,
  embedding_index_ref TEXT,
  refresh_policy TEXT DEFAULT 'on_demand',
  cache_ttl_seconds INTEGER DEFAULT 0,
  sensitivity_tags TEXT,
  domain TEXT,
  tags TEXT,
  owner TEXT,
  status TEXT DEFAULT 'active',
  legacy_datasource_id TEXT,
  legacy_business_document_id TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS ix_assets_kind_status ON assets (kind, status);
CREATE INDEX IF NOT EXISTS ix_assets_doc_source_type ON assets (document_source_type);
CREATE INDEX IF NOT EXISTS ix_assets_domain ON assets (domain);

CREATE TABLE IF NOT EXISTS asset_usage (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  used_by_kind TEXT NOT NULL,
  used_by_id TEXT NOT NULL,
  note TEXT,
  created_at INTEGER,
  UNIQUE(asset_id, used_by_kind, used_by_id)
);
CREATE INDEX IF NOT EXISTS ix_asset_usage_used_by ON asset_usage (used_by_kind, used_by_id);

CREATE TABLE IF NOT EXISTS execution_logs (
  id TEXT PRIMARY KEY,
  asset_id TEXT,
  connection_id TEXT,
  purpose TEXT NOT NULL,
  sql_hash TEXT NOT NULL,
  sql_preview TEXT DEFAULT '',
  params_redacted TEXT,
  rows_returned INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  cache_hit INTEGER DEFAULT 0,
  blocked INTEGER DEFAULT 0,
  block_reason TEXT,
  user_id TEXT,
  started_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_exec_asset_started ON execution_logs (asset_id, started_at);
CREATE INDEX IF NOT EXISTS ix_exec_purpose_started ON execution_logs (purpose, started_at);
CREATE INDEX IF NOT EXISTS ix_exec_blocked ON execution_logs (blocked);

CREATE TABLE IF NOT EXISTS lineage_edges (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  via_module TEXT,
  via_purpose TEXT,
  weight INTEGER DEFAULT 1,
  first_seen_at INTEGER,
  last_seen_at INTEGER,
  UNIQUE(source_kind, source_id, target_kind, target_id, relation, via_module)
);
CREATE INDEX IF NOT EXISTS ix_lineage_source ON lineage_edges (source_kind, source_id);
CREATE INDEX IF NOT EXISTS ix_lineage_target ON lineage_edges (target_kind, target_id);

CREATE TABLE IF NOT EXISTS ontology_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_cn TEXT NOT NULL,
  tier INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  description TEXT,
  config_json TEXT,
  scenario_codes TEXT,
  ontology_id TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  created_by TEXT,
  publish_config TEXT,
  UNIQUE(ontology_id, name)
);
CREATE INDEX IF NOT EXISTS ix_ontology_entities_ontology_id ON ontology_entities (ontology_id);

CREATE TABLE IF NOT EXISTS entity_attributes (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT DEFAULT '',
  required INTEGER DEFAULT 0,
  example TEXT,
  constraints_json TEXT,
  source_table TEXT,
  source_field TEXT,
  data_status TEXT DEFAULT '未确认来源',
  shared_attribute_id TEXT
);

CREATE TABLE IF NOT EXISTS entity_relations (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT DEFAULT '',
  rel_type TEXT NOT NULL,
  semantic_type TEXT DEFAULT 'association',
  cardinality TEXT NOT NULL,
  acyclic INTEGER DEFAULT 0,
  description TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS object_bindings (
  id TEXT PRIMARY KEY,
  object_type_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  role TEXT NOT NULL,
  field_mappings TEXT,
  id_column TEXT,
  filter_expr TEXT,
  status TEXT DEFAULT 'active',
  review_reason TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  created_by TEXT,
  UNIQUE(object_type_id, asset_id, role)
);
CREATE INDEX IF NOT EXISTS ix_object_bindings_object_type ON object_bindings (object_type_id);
CREATE INDEX IF NOT EXISTS ix_object_bindings_asset ON object_bindings (asset_id);
CREATE INDEX IF NOT EXISTS ix_binding_status ON object_bindings (status);

CREATE TABLE IF NOT EXISTS ontology_shared_attributes (
  id TEXT PRIMARY KEY,
  ontology_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_cn TEXT,
  data_type TEXT NOT NULL,
  description TEXT,
  config_json TEXT,
  created_at INTEGER,
  UNIQUE(ontology_id, name)
);

CREATE TABLE IF NOT EXISTS ontology_shared_refs (
  id TEXT PRIMARY KEY,
  source_ontology_id TEXT NOT NULL,
  target_ontology_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  alias TEXT,
  config_json TEXT,
  created_at INTEGER,
  UNIQUE(source_ontology_id, target_ontology_id, entity_id)
);

CREATE TABLE IF NOT EXISTS ontology_functions (
  id TEXT PRIMARY KEY,
  entity_id TEXT,
  ontology_id TEXT,
  entity_ids TEXT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  return_type TEXT DEFAULT 'string',
  input_schema TEXT,
  logic_type TEXT DEFAULT 'expression',
  logic_body TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  tags TEXT,
  callable_name TEXT DEFAULT '',
  is_derived_property INTEGER DEFAULT 0,
  execution_count INTEGER DEFAULT 0,
  last_executed INTEGER,
  source_path TEXT,
  func_name TEXT,
  checksum TEXT,
  registered_by TEXT DEFAULT 'ui',
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_ontology_functions_ontology_id ON ontology_functions (ontology_id);

CREATE TABLE IF NOT EXISTS entity_actions (
  id TEXT PRIMARY KEY,
  entity_id TEXT,
  ontology_id TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'domain',
  action_type TEXT NOT NULL,
  type_config TEXT,
  description TEXT,
  status TEXT DEFAULT 'active',
  impact_count INTEGER,
  parameters_json TEXT,
  output_schema TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_entity_actions_ontology_id ON entity_actions (ontology_id);

CREATE TABLE IF NOT EXISTS business_documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_type TEXT DEFAULT '',
  file_path TEXT,
  parsed_text TEXT,
  summary TEXT,
  domain_tags TEXT,
  size_bytes INTEGER DEFAULT 0,
  uploaded_by TEXT,
  uploaded_at INTEGER
);

CREATE TABLE IF NOT EXISTS quality_rules (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  column_name TEXT,
  params TEXT,
  severity TEXT DEFAULT 'warning',
  enabled INTEGER DEFAULT 1,
  description TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS ix_quality_rule_asset_kind ON quality_rules (asset_id, kind);

CREATE TABLE IF NOT EXISTS health_statuses (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  status TEXT NOT NULL,
  value_numeric REAL,
  message TEXT,
  ran_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_health_rule_time ON health_statuses (rule_id, ran_at);
CREATE INDEX IF NOT EXISTS ix_health_asset_time ON health_statuses (asset_id, ran_at);

CREATE TABLE IF NOT EXISTS quality_metrics (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  column_name TEXT,
  value_numeric REAL,
  value_text TEXT,
  threshold REAL,
  severity TEXT DEFAULT 'ok',
  measured_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_quality_asset_kind_time ON quality_metrics (asset_id, kind, measured_at);

CREATE TABLE IF NOT EXISTS ontology_versions (
  id TEXT PRIMARY KEY,
  version_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  ontology_id TEXT,
  description TEXT,
  status TEXT DEFAULT 'draft',
  created_by TEXT,
  approved_by TEXT,
  created_at INTEGER,
  submitted_at INTEGER,
  published_at INTEGER,
  rejected_at INTEGER,
  reject_reason TEXT,
  rollback_from INTEGER,
  is_active INTEGER DEFAULT 0,
  UNIQUE(ontology_id, version_number)
);
CREATE INDEX IF NOT EXISTS ix_ontology_versions_ontology_id ON ontology_versions (ontology_id);

CREATE TABLE IF NOT EXISTS ontology_version_entities (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_cn TEXT NOT NULL,
  tier INTEGER NOT NULL,
  description TEXT,
  config_json TEXT,
  publish_config TEXT,
  scenario_codes TEXT
);

CREATE TABLE IF NOT EXISTS ontology_version_attributes (
  id TEXT PRIMARY KEY,
  version_entity_id TEXT NOT NULL,
  source_attribute_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT DEFAULT '',
  required INTEGER DEFAULT 0,
  example TEXT,
  constraints_json TEXT,
  source_table TEXT,
  source_field TEXT,
  data_status TEXT DEFAULT '未确认来源'
);

CREATE TABLE IF NOT EXISTS ontology_version_relations (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  source_relation_id TEXT NOT NULL,
  from_version_entity_id TEXT NOT NULL,
  to_version_entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rel_type TEXT NOT NULL,
  relation_type TEXT DEFAULT 'object_property',
  semantic_type TEXT DEFAULT 'association',
  cardinality TEXT NOT NULL,
  acyclic INTEGER DEFAULT 0,
  description TEXT
);

CREATE TABLE IF NOT EXISTS ontology_version_functions (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  source_function_id TEXT,
  version_entity_id TEXT,
  name TEXT NOT NULL,
  config_json TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS ontology_version_actions (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  source_action_id TEXT,
  version_entity_id TEXT,
  name TEXT NOT NULL,
  config_json TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS ontology_version_metadata (
  version_id TEXT PRIMARY KEY,
  mappings TEXT,
  quality_rules TEXT,
  business_documents TEXT,
  service_endpoints TEXT
);

CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  api_base TEXT,
  api_key TEXT,
  capabilities TEXT,
  config_json TEXT,
  status TEXT DEFAULT 'active',
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  tags TEXT,
  model_id TEXT,
  system_prompt TEXT DEFAULT '',
  kb_ids TEXT,
  entity_ids TEXT,
  ontology_version_id TEXT,
  ontology_stale INTEGER DEFAULT 0,
  ontology_stale_detail TEXT,
  tools_config TEXT,
  nodes_json TEXT,
  edges_json TEXT,
  status TEXT DEFAULT 'draft',
  api_key TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT '通用',
  content TEXT NOT NULL,
  variables TEXT,
  tags TEXT,
  status TEXT DEFAULT 'active',
  created_by TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  skill_type TEXT DEFAULT 'builtin',
  config_json TEXT,
  code_ref TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  current_version INTEGER DEFAULT 0,
  input_schema TEXT,
  output_schema TEXT,
  prompt_template TEXT DEFAULT '',
  tools TEXT,
  test_cases TEXT,
  asset_refs TEXT,
  created_by TEXT DEFAULT '',
  reviewed_by TEXT DEFAULT '',
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS skill_tools (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  parameters TEXT,
  code TEXT DEFAULT '',
  code_type TEXT DEFAULT 'generated',
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_traces (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  conversation_id TEXT,
  input_text TEXT,
  output_text TEXT,
  trace_json TEXT,
  latency_ms INTEGER,
  success INTEGER DEFAULT 1,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS eval_suites (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  input_text TEXT NOT NULL,
  expected_output TEXT DEFAULT '',
  tags TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  score REAL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS eval_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  actual_output TEXT,
  score REAL,
  passed INTEGER DEFAULT 0,
  details TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS ai_code_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  messages TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_test_conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  messages TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS t_service_metric (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'healthy',
  response_ms REAL,
  cpu_percent REAL,
  memory_percent REAL,
  disk_percent REAL,
  collected_at INTEGER
);

CREATE TABLE IF NOT EXISTS t_llm_call_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_module TEXT NOT NULL,
  model_name TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms REAL,
  success INTEGER DEFAULT 1,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS t_alert (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  service_name TEXT NOT NULL,
  message TEXT NOT NULL,
  resolved INTEGER DEFAULT 0,
  created_at INTEGER,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS t_mcp_call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  is_error INTEGER DEFAULT 0,
  error_message TEXT,
  called_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_mcp_call_log_called_at ON t_mcp_call_log (called_at);
CREATE INDEX IF NOT EXISTS ix_mcp_call_log_tool_name ON t_mcp_call_log (tool_name);
`;
