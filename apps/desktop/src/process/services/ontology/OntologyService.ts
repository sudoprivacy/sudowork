import fs from 'fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { isOntologyDocumentAsset, ONTOLOGY_DOCUMENT_MAX_GOAL_CHARS } from '@sudowork/ontology-common';
import BetterSqlite3 from 'better-sqlite3';
import { Client as FtpClient } from 'basic-ftp';
import { Kafka, logLevel, type KafkaConfig } from 'kafkajs';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import sql from 'mssql';
import oracledb from 'oracledb';
import { Client as PostgresClient } from 'pg';
import SftpClient from 'ssh2-sftp-client';
import { GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { parse as parseCsv } from 'csv-parse/sync';
import { OntologyEngine, createFileStat } from '@sudowork/ontology-engine';
import type {
  IOntologyActionDefinitionInput,
  IOntologyAgentBlueprint,
  IOntologyAgentBlueprintInput,
  IOntologyAssetField,
  IOntologyAttributeDraftInput,
  IOntologyBrowseConnectorAssetsInput,
  IOntologyCreateWorkbenchInput,
  IOntologyConnectorConfig,
  IOntologyConnectorInput,
  IOntologyDeleteWorkbenchInput,
  IOntologyDeleteAttributeInput,
  IOntologyDeleteConnectorInput,
  IOntologyDeleteInput,
  IOntologyEnvironmentAsset,
  IOntologyFieldMappingInput,
  IOntologyGenerateDraftInput,
  IOntologyImportFilesInput,
  IOntologyLogicFunctionInput,
  IOntologyObjectDraftInput,
  IOntologyPhaseTransitionInput,
  IOntologyProfileAssetInput,
  IOntologyProbeConnectorInput,
  IOntologyPreviewAssetInput,
  IOntologyPreviewAssetResult,
  IOntologyPublishApprovalInput,
  IOntologyQualityRuleInput,
  IOntologyRejectVersionInput,
  IOntologyRegisterAgentInput,
  IOntologyRelationDraftInput,
  IOntologyReviewTargetInput,
  IOntologyRollbackInput,
  IOntologySelectWorkbenchInput,
  IOntologySyncAssetSchemaInput,
  IOntologyVersionSnapshot,
  IOntologyWorkbenchDraftInput,
} from '@sudowork/ontology-common';
import { DEFAULT_PRESET_AGENT_TYPE } from '@sudowork/common/acpTypes';
import { assistantManager } from '@process/AssistantManager';
import { mainError } from '@process/utils/mainLogger';
import { acpDetector } from '@/agent/acp/AcpDetector';
import { OntologyDatabase } from './OntologyDatabase';
import { installOntologyMcpServer, removeOntologyMcpServer } from './OntologyMcpRegistration';
import { parseOntologyTemplateFile } from './ontologyTemplateParser';
import { extractOntologyDocuments, readOntologyDocuments, validateOntologyDocumentFiles } from './ontologyDocumentExtractor';

export class OntologyService {
  private readonly database: OntologyDatabase;
  private readonly engine: OntologyEngine;
  private readonly generatingWorkspaces = new Set<string>();

  constructor(
    database = new OntologyDatabase(),
    engine = new OntologyEngine(database),
    private readonly extractDocuments = extractOntologyDocuments
  ) {
    this.database = database;
    this.engine = engine;
  }

  async listWorkbenches() {
    const activeWorkspaceId = await this.getActiveWorkspaceId();
    return this.engine.listWorkbenches(activeWorkspaceId);
  }

  async getWorkbench(input?: IOntologySelectWorkbenchInput) {
    const workspaceId = input?.workspaceId?.trim() || (await this.getActiveWorkspaceId());
    return this.engine.getWorkbench(workspaceId);
  }

  async createWorkbench(input: IOntologyCreateWorkbenchInput) {
    const activeWorkspaceId = await this.getActiveWorkspaceId();
    const result = await this.engine.createWorkbench(input, activeWorkspaceId);
    this.database.setActiveWorkspaceId(result.activeWorkspaceId);
    return result;
  }

  async selectWorkbench(input: IOntologySelectWorkbenchInput) {
    const snapshot = await this.engine.getWorkbench(input.workspaceId);
    this.database.setActiveWorkspaceId(snapshot.workspaceId);
    return snapshot;
  }

  async deleteWorkbench(input: IOntologyDeleteWorkbenchInput) {
    const activeWorkspaceId = await this.getActiveWorkspaceId();
    const snapshot = await this.engine.getWorkbench(input.workspaceId);
    for (const blueprint of snapshot.agentBlueprints) {
      await this.uninstallRegisteredAgent(blueprint);
    }
    const result = await this.engine.deleteWorkbench(input, activeWorkspaceId);
    this.database.setActiveWorkspaceId(result.activeWorkspaceId);
    return result;
  }

  async updateDraft(input: IOntologyWorkbenchDraftInput) {
    return this.engine.updateDraft(input, await this.getActiveWorkspaceId());
  }

  async transitionPhase(input: IOntologyPhaseTransitionInput) {
    return this.engine.transitionPhase(input, await this.getActiveWorkspaceId());
  }

  async importFiles(input: IOntologyImportFilesInput) {
    const workspaceId = input.workspaceId?.trim() || (await this.getActiveWorkspaceId());
    if (input.workspaceId && !this.database.getSnapshot(workspaceId)) throw new Error('ontology.documentErrors.conflict');
    if (input.purpose === 'document') await validateOntologyDocumentFiles(input.filePaths);
    const fileStats = [];
    for (const filePath of [...new Set(input.filePaths)]) {
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          if (input.purpose) throw new Error('ontology.documentErrors.fileUnavailable');
          continue;
        }
        if (input.purpose && stat.size > 50 * 1024 * 1024) throw new Error('ontology.documentErrors.fileTooLarge');
        const template = input.purpose === 'template' ? await parseOntologyTemplateFile(filePath) : null;
        if (input.purpose === 'template' && !template) throw new Error(`No ontology objects were found in template file: ${path.basename(filePath)}`);
        fileStats.push({
          ...createFileStat(filePath, stat.size),
          fields: input.purpose === 'document' ? [] : await inferFields(filePath),
          ...(template ? { metadata: { ontologyTemplate: JSON.stringify(template) } } : {}),
        });
      } catch (err) {
        if (input.purpose === 'document') {
          if (err instanceof Error && err.message.startsWith('ontology.documentErrors.')) throw err;
          throw new Error('ontology.documentErrors.fileUnavailable');
        }
        if (input.purpose === 'template') throw err;
        mainError('OntologyService', `Failed to stat ontology import file: ${filePath}`, err);
      }
    }
    if (!this.database.getSnapshot(workspaceId)) throw new Error('ontology.documentErrors.conflict');
    return this.engine.importFiles(input, fileStats, workspaceId);
  }

  async probeConnector(input: IOntologyProbeConnectorInput) {
    const workspaceId = await this.getActiveWorkspaceId();
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const existing = input.connector.id ? snapshot.connectors.find((connector) => connector.id === input.connector.id) : undefined;
    const connector = mergeConnectorSecrets(input.connector, existing);
    const mergedInput = { ...input, connector };
    const assets = await scanConnectorAssets(mergedInput);
    return this.engine.probeConnector(mergedInput, assets, workspaceId);
  }

  async browseConnectorAssets(input: IOntologyBrowseConnectorAssetsInput) {
    return this.engine.browseConnectorAssets(input, await this.getActiveWorkspaceId());
  }

  async deleteConnector(input: IOntologyDeleteConnectorInput) {
    return this.engine.deleteConnector(input, await this.getActiveWorkspaceId());
  }

  async deleteAsset(input: IOntologyDeleteInput) {
    return this.engine.deleteAsset(input, await this.getActiveWorkspaceId());
  }

  async profileAsset(input: IOntologyProfileAssetInput) {
    const workspaceId = await this.getActiveWorkspaceId();
    return this.engine.profileAsset(input, workspaceId, await this.scanCurrentAsset(input.id, workspaceId));
  }

  async syncAssetSchema(input: IOntologySyncAssetSchemaInput) {
    const workspaceId = await this.getActiveWorkspaceId();
    return this.engine.syncAssetSchema(input, workspaceId, await this.scanCurrentAsset(input.id, workspaceId));
  }

  async previewAsset(input: IOntologyPreviewAssetInput): Promise<IOntologyPreviewAssetResult> {
    const workspaceId = await this.getActiveWorkspaceId();
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const asset = snapshot.assets.find((item) => item.id === input.id);
    if (!asset) throw new Error('Asset not found.');
    const connectorId = typeof asset.metadata.connectorId === 'string' ? asset.metadata.connectorId : undefined;
    const connector = connectorId ? snapshot.connectors.find((item) => item.id === connectorId) : undefined;
    return previewAsset(asset, connector, Math.max(1, Math.min(input.limit ?? 20, 100)));
  }

  async generateDraft(input: IOntologyGenerateDraftInput = {}) {
    const workspaceId = input.workspaceId?.trim() || (await this.getActiveWorkspaceId());
    if (this.generatingWorkspaces.has(workspaceId)) throw new Error('ontology.documentErrors.busy');
    const expectedSnapshot = this.database.getSnapshot(workspaceId);
    if (!expectedSnapshot) throw new Error('ontology.documentErrors.conflict');
    const assetIds = [...new Set(input.assetIds ?? expectedSnapshot.draft.selectedAssetIds)];
    const documentAssetIds = [...new Set([...(input.documentAssetIds ?? []), ...expectedSnapshot.assets.filter((asset) => assetIds.includes(asset.id) && asset.kind === 'document' && !asset.metadata.ontologyTemplate).map((asset) => asset.id)])];
    if (documentAssetIds.length === 0) return this.engine.generateDraft(input, workspaceId);
    const documentAssets = expectedSnapshot.assets.filter((asset) => documentAssetIds.includes(asset.id));
    if (documentAssets.length !== documentAssetIds.length || documentAssets.some((asset) => !assetIds.includes(asset.id) || !isOntologyDocumentAsset(asset))) {
      throw new Error('ontology.documentErrors.invalidSelection');
    }
    const businessGoal = (input.businessGoal ?? expectedSnapshot.draft.businessGoal).trim();
    if (businessGoal.length > ONTOLOGY_DOCUMENT_MAX_GOAL_CHARS) throw new Error('ontology.documentErrors.textTooLarge');
    this.generatingWorkspaces.add(workspaceId);
    try {
      const documents = await readOntologyDocuments(documentAssets);
      const extraction = await this.extractDocuments(documents, businessGoal);
      if (!isDeepStrictEqual(this.database.getSnapshot(workspaceId), expectedSnapshot)) throw new Error('ontology.documentErrors.conflict');
      return await this.engine.generateDraft({ ...input, assetIds, documentAssetIds, workspaceId, businessGoal }, workspaceId, { extraction, expectedSnapshot });
    } finally {
      this.generatingWorkspaces.delete(workspaceId);
    }
  }

  async upsertObject(input: IOntologyObjectDraftInput) {
    return this.engine.upsertObject(input, await this.getActiveWorkspaceId());
  }

  async deleteObject(input: IOntologyDeleteInput) {
    return this.engine.deleteObject(input, await this.getActiveWorkspaceId());
  }

  async upsertAttribute(input: IOntologyAttributeDraftInput) {
    return this.engine.upsertAttribute(input, await this.getActiveWorkspaceId());
  }

  async deleteAttribute(input: IOntologyDeleteAttributeInput) {
    return this.engine.deleteAttribute(input, await this.getActiveWorkspaceId());
  }

  async upsertRelation(input: IOntologyRelationDraftInput) {
    return this.engine.upsertRelation(input, await this.getActiveWorkspaceId());
  }

  async deleteRelation(input: IOntologyDeleteInput) {
    return this.engine.deleteRelation(input, await this.getActiveWorkspaceId());
  }

  async upsertMapping(input: IOntologyFieldMappingInput) {
    return this.engine.upsertMapping(input, await this.getActiveWorkspaceId());
  }

  async deleteMapping(input: IOntologyDeleteInput) {
    return this.engine.deleteMapping(input, await this.getActiveWorkspaceId());
  }

  async upsertQualityRule(input: IOntologyQualityRuleInput) {
    return this.engine.upsertQualityRule(input, await this.getActiveWorkspaceId());
  }

  async deleteQualityRule(input: IOntologyDeleteInput) {
    return this.engine.deleteQualityRule(input, await this.getActiveWorkspaceId());
  }

  async upsertLogicFunction(input: IOntologyLogicFunctionInput) {
    return this.engine.upsertLogicFunction(input, await this.getActiveWorkspaceId());
  }

  async deleteLogicFunction(input: IOntologyDeleteInput) {
    return this.engine.deleteLogicFunction(input, await this.getActiveWorkspaceId());
  }

  async upsertAction(input: IOntologyActionDefinitionInput) {
    return this.engine.upsertAction(input, await this.getActiveWorkspaceId());
  }

  async deleteAction(input: IOntologyDeleteInput) {
    return this.engine.deleteAction(input, await this.getActiveWorkspaceId());
  }

  async reviewTarget(input: IOntologyReviewTargetInput) {
    return this.engine.reviewTarget(input, await this.getActiveWorkspaceId());
  }

  async approveAll() {
    return this.engine.approveAll(await this.getActiveWorkspaceId());
  }

  async runConsistencyCheck(input?: IOntologySelectWorkbenchInput) {
    return this.engine.runConsistencyCheck(input?.workspaceId ?? (await this.getActiveWorkspaceId()));
  }

  async publishCurrentDraft(input?: IOntologySelectWorkbenchInput) {
    return this.engine.publishCurrentDraft(input?.workspaceId ?? (await this.getActiveWorkspaceId()));
  }

  async approvePublishedVersion(input: IOntologyPublishApprovalInput) {
    return this.engine.approvePublishedVersion(input, input.workspaceId ?? (await this.getActiveWorkspaceId()));
  }

  async rejectPublishedVersion(input: IOntologyRejectVersionInput) {
    return this.engine.rejectPublishedVersion(input, input.workspaceId ?? (await this.getActiveWorkspaceId()));
  }

  async rollbackToVersion(input: IOntologyRollbackInput) {
    return this.engine.rollbackToVersion(input, input.workspaceId ?? (await this.getActiveWorkspaceId()));
  }

  async createAgentBlueprint(input: IOntologyAgentBlueprintInput) {
    return this.engine.createAgentBlueprint(input, input.workspaceId ?? (await this.getActiveWorkspaceId()));
  }

  async registerAgentBlueprint(input: IOntologyRegisterAgentInput) {
    const workspaceId = input.workspaceId ?? (await this.getActiveWorkspaceId());
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const blueprint = input.blueprintId ? snapshot.agentBlueprints.find((item) => item.id === input.blueprintId) : snapshot.agentBlueprints.at(-1);
    if (!blueprint) throw new Error('Agent blueprint not found.');
    const assistantId = input.assistantId?.trim() || `ontology-${blueprint.id.slice(0, 8)}`;
    const assistantName = input.name?.trim() || blueprint.name;
    const meta = {
      id: assistantId,
      nameI18n: {
        'zh-CN': assistantName,
        'en-US': assistantName,
      },
      descriptionI18n: {
        'zh-CN': `基于已发布本体 ${blueprint.ontologyVersionId} 的 Agent。`,
        'en-US': `Agent generated from published ontology ${blueprint.ontologyVersionId}.`,
      },
      avatar: '🧩',
      presetAgentType: DEFAULT_PRESET_AGENT_TYPE,
      enabled: true,
      source_type: 'custom' as const,
      defaultInitPrompt: '请基于已发布本体回答业务问题，并说明使用到的对象、关系、规则和动作。',
    };
    const publishedVersion = snapshot.publishedVersions.find((version) => version.id === blueprint.ontologyVersionId);
    if (!publishedVersion) throw new Error('Published ontology version not found.');
    const ruleContent = createAssistantRuleContent(blueprint, publishedVersion.snapshot);
    const createResult = await assistantManager.createAssistant(meta, ruleContent);
    if (!createResult.success && !createResult.msg?.includes('already exists')) {
      throw new Error(createResult.msg || 'Failed to register ontology Agent.');
    }
    if (!createResult.success) {
      const updateResult = await assistantManager.updateAssistantMeta(assistantId, meta, 'custom');
      if (!updateResult.success) throw new Error(updateResult.msg || 'Failed to update registered ontology Agent.');
    }
    try {
      await installOntologyMcpServer({
        blueprintId: blueprint.id,
        workspaceId,
        versionId: blueprint.ontologyVersionId,
        exportFile: this.database.getMcpExportPath(workspaceId),
      });
    } catch (error) {
      if (createResult.success) await assistantManager.uninstallAssistant(assistantId, 'custom');
      throw error;
    }
    await acpDetector.refreshCustomAgents();
    return this.engine.registerAgentBlueprint(
      {
        ...input,
        assistantId,
        name: assistantName,
      },
      workspaceId
    );
  }

  async deleteAgentBlueprint(input: IOntologyDeleteInput) {
    const workspaceId = input.workspaceId ?? (await this.getActiveWorkspaceId());
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const blueprint = snapshot.agentBlueprints.find((item) => item.id === input.id);
    if (!blueprint) throw new Error('Agent blueprint not found.');
    await this.uninstallRegisteredAgent(blueprint);
    const nextSnapshot = await this.engine.deleteAgentBlueprint(input, workspaceId);
    await acpDetector.refreshCustomAgents();
    return nextSnapshot;
  }

  async resetWorkbench() {
    const workspaceId = await this.getActiveWorkspaceId();
    const currentSnapshot = await this.engine.getWorkbench(workspaceId);
    for (const blueprint of currentSnapshot.agentBlueprints) {
      await this.uninstallRegisteredAgent(blueprint);
    }
    const snapshot = await this.engine.resetWorkbench(workspaceId);
    await acpDetector.refreshCustomAgents();
    this.database.setActiveWorkspaceId(snapshot.workspaceId);
    return snapshot;
  }

  close() {
    this.database.close();
  }

  private async getActiveWorkspaceId(): Promise<string> {
    const storedWorkspaceId = this.database.getActiveWorkspaceId();
    if (storedWorkspaceId && this.database.getSnapshot(storedWorkspaceId)) return storedWorkspaceId;
    const newestSnapshot = this.database.listSnapshots()[0];
    if (newestSnapshot) {
      this.database.setActiveWorkspaceId(newestSnapshot.workspaceId);
      return newestSnapshot.workspaceId;
    }
    const snapshot = await this.engine.getWorkbench('default');
    this.database.setActiveWorkspaceId(snapshot.workspaceId);
    return snapshot.workspaceId;
  }

  private async scanCurrentAsset(assetId: string, workspaceId: string): Promise<IOntologyEnvironmentAsset | undefined> {
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const asset = snapshot.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error('Asset not found.');
    const connectorId = typeof asset.metadata.connectorId === 'string' ? asset.metadata.connectorId : undefined;
    const connector = connectorId ? snapshot.connectors.find((item) => item.id === connectorId) : undefined;
    if (connector) {
      const scannedAssets = await scanConnectorAssets({ connector, maxAssets: 1000 });
      return scannedAssets.find((item) => item.path === asset.path) ?? scannedAssets.find((item) => item.name === asset.name);
    }
    if (asset.path) {
      const filePath = asset.path.split('#', 1)[0];
      const stat = await fs.stat(filePath).catch((): null => null);
      if (stat?.isFile()) {
        return {
          ...asset,
          fields: await inferFields(filePath),
          metadata: { ...asset.metadata, sizeBytes: stat.size },
          updatedAt: Date.now(),
        };
      }
    }
    return undefined;
  }

  private async uninstallRegisteredAgent(blueprint: IOntologyAgentBlueprint): Promise<void> {
    if (!blueprint.registeredAssistantId) return;
    await removeOntologyMcpServer(blueprint.id);
    const result = await assistantManager.uninstallAssistant(blueprint.registeredAssistantId, 'custom');
    if (!result.success && result.msg !== 'Assistant not found') {
      throw new Error(result.msg || 'Failed to uninstall registered ontology Agent.');
    }
  }
}

export const ontologyService = new OntologyService();

async function scanConnectorAssets(input: IOntologyProbeConnectorInput): Promise<IOntologyEnvironmentAsset[]> {
  const connector = input.connector;
  const maxAssets = Math.max(1, Math.min(input.maxAssets ?? 200, 1000));
  if (connector.sourceType === 'directory') return scanDirectoryConnector(connector, input.recursive ?? true, input.maxAssets ?? 200);
  if (connector.sourceType === 'sqlite') return scanSqliteConnector(connector);
  if (connector.sourceType === 'mysql') return scanMysqlConnector(connector, maxAssets);
  if (connector.sourceType === 'postgresql') return scanPostgresqlConnector(connector, maxAssets);
  if (connector.sourceType === 'oracle') return scanOracleConnector(connector, maxAssets);
  if (connector.sourceType === 'sqlserver') return scanSqlServerConnector(connector, maxAssets);
  if (connector.sourceType === 'openapi') return scanApiConnector(connector);
  if (connector.sourceType === 'rest') return scanRestConnector(connector);
  if (connector.sourceType === 'ftp') return scanFtpConnector(connector, maxAssets);
  if (connector.sourceType === 'sftp') return scanSftpConnector(connector, maxAssets);
  if (connector.sourceType === 'mq' || connector.sourceType === 'kafka') return scanKafkaConnector(connector, maxAssets);
  if (connector.sourceType === 'oss' || connector.sourceType === 's3') return scanS3Connector(connector, maxAssets);
  throw new Error(`Unsupported connector type: ${connector.sourceType}.`);
}

async function scanDirectoryConnector(connector: IOntologyConnectorInput, recursive: boolean, maxAssets: number): Promise<IOntologyEnvironmentAsset[]> {
  if (!connector.path) throw new Error('Directory connector requires path.');
  const assets: IOntologyEnvironmentAsset[] = [];
  await walkDirectory(connector.path, recursive, maxAssets, assets, connector);
  return assets;
}

async function walkDirectory(directoryPath: string, recursive: boolean, maxAssets: number, assets: IOntologyEnvironmentAsset[], connector: IOntologyConnectorInput): Promise<void> {
  if (assets.length >= maxAssets) return;
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (assets.length >= maxAssets) return;
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await walkDirectory(entryPath, recursive, maxAssets, assets, connector);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(entryPath);
    const fields = await inferFields(entryPath);
    assets.push(
      createScannedAsset(connector, {
        kind: inferKindFromPath(entryPath),
        name: entry.name,
        path: entryPath,
        fields,
        metadata: {
          sizeBytes: stat.size,
          extension: path.extname(entryPath),
        },
      })
    );
  }
}

function scanSqliteConnector(connector: IOntologyConnectorInput): IOntologyEnvironmentAsset[] {
  if (!connector.path) throw new Error('SQLite connector requires path.');
  const db = new BetterSqlite3(connector.path, { readonly: true, fileMustExist: true });
  try {
    const tables = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string; type: string }>;
    return tables.map((table) => {
      const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table.name)})`).all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
      return createScannedAsset(connector, {
        kind: 'table',
        name: table.name,
        path: `${connector.path}#${table.name}`,
        fields: columns.map((column) => ({
          name: column.name,
          dataType: column.type || 'string',
          nullable: column.notnull !== 1 && column.pk !== 1,
        })),
        metadata: {
          sqlitePath: connector.path,
          tableType: table.type,
        },
      });
    });
  } finally {
    db.close();
  }
}

async function scanMysqlConnector(connector: IOntologyConnectorInput, maxAssets: number): Promise<IOntologyEnvironmentAsset[]> {
  if (!connector.host || !connector.database) throw new Error('MySQL connector requires host and database.');
  const connection = await mysql.createConnection({
    host: connector.host,
    port: connector.port ?? 3306,
    database: connector.database,
    user: connectorCredentialString(connector, 'username', connector.username),
    password: connectorCredentialString(connector, 'password', connector.password),
    connectTimeout: 8000,
  });
  try {
    const [tables] = await connection.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME
       LIMIT ?`,
      [connector.database, maxAssets]
    );
    const assets: IOntologyEnvironmentAsset[] = [];
    for (const table of tables) {
      const tableName = String(table.tableName);
      const [columns] = await connection.query<RowDataPacket[]>(
        `SELECT COLUMN_NAME AS fieldName, COLUMN_TYPE AS dataType, IS_NULLABLE AS isNullable,
                COLUMN_COMMENT AS description, COLUMN_KEY AS columnKey
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [connector.database, tableName]
      );
      assets.push(
        createScannedAsset(connector, {
          kind: 'table',
          name: tableName,
          path: `mysql://${connector.host}:${connector.port ?? 3306}/${connector.database}/${tableName}`,
          fields: columns.map((column) => ({
            name: String(column.fieldName),
            dataType: String(column.dataType || 'string'),
            nullable: String(column.isNullable).toUpperCase() === 'YES',
            description: String(column.description || '') || undefined,
          })),
          metadata: { database: connector.database ?? '', tableType: String(table.tableType || 'TABLE') },
        })
      );
    }
    return assets;
  } finally {
    await connection.end();
  }
}

async function scanPostgresqlConnector(connector: IOntologyConnectorInput, maxAssets: number): Promise<IOntologyEnvironmentAsset[]> {
  if (!connector.host || !connector.database) throw new Error('PostgreSQL connector requires host and database.');
  const client = new PostgresClient({
    host: connector.host,
    port: connector.port ?? 5432,
    database: connector.database,
    user: connectorCredentialString(connector, 'username', connector.username),
    password: connectorCredentialString(connector, 'password', connector.password),
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  try {
    const schema = typeof connector.params?.schema === 'string' && connector.params.schema.trim() ? connector.params.schema.trim() : 'public';
    const tables = await client.query<{ table_name: string; table_type: string }>(
      `SELECT table_name, table_type
       FROM information_schema.tables
       WHERE table_schema = $1
       ORDER BY table_name
       LIMIT $2`,
      [schema, maxAssets]
    );
    const assets: IOntologyEnvironmentAsset[] = [];
    for (const table of tables.rows) {
      const columns = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table.table_name]
      );
      assets.push(
        createScannedAsset(connector, {
          kind: 'table',
          name: table.table_name,
          path: `postgresql://${connector.host}:${connector.port ?? 5432}/${connector.database}/${schema}/${table.table_name}`,
          fields: columns.rows.map((column) => ({
            name: column.column_name,
            dataType: column.data_type || 'string',
            nullable: column.is_nullable.toUpperCase() === 'YES',
          })),
          metadata: { database: connector.database ?? '', schema, tableType: table.table_type },
        })
      );
    }
    return assets;
  } finally {
    await client.end();
  }
}

async function scanOracleConnector(connector: IOntologyConnectorInput, maxAssets: number): Promise<IOntologyEnvironmentAsset[]> {
  if (!connector.host || !connector.database) throw new Error('Oracle connector requires host and service name.');
  const connection = await oracledb.getConnection({
    user: connectorCredentialString(connector, 'username', connector.username),
    password: connectorCredentialString(connector, 'password', connector.password),
    connectString: `${connector.host}:${connector.port ?? 1521}/${connector.database}`,
  });
  try {
    const tables = await connection.execute<{ TABLE_NAME: string }>(`SELECT table_name FROM user_tables ORDER BY table_name FETCH FIRST ${maxAssets} ROWS ONLY`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const assets: IOntologyEnvironmentAsset[] = [];
    for (const table of tables.rows ?? []) {
      const tableName = table.TABLE_NAME;
      const columns = await connection.execute<{ COLUMN_NAME: string; DATA_TYPE: string; NULLABLE: string }>('SELECT column_name, data_type, nullable FROM user_tab_columns WHERE table_name = :tableName ORDER BY column_id', { tableName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      assets.push(
        createScannedAsset(connector, {
          kind: 'table',
          name: tableName,
          path: `oracle://${connector.host}:${connector.port ?? 1521}/${connector.database}/${tableName}`,
          fields: (columns.rows ?? []).map((column) => ({
            name: column.COLUMN_NAME,
            dataType: column.DATA_TYPE || 'string',
            nullable: column.NULLABLE === 'Y',
          })),
          metadata: { database: connector.database ?? '', tableType: 'TABLE' },
        })
      );
    }
    return assets;
  } finally {
    await connection.close();
  }
}

async function scanSqlServerConnector(connector: IOntologyConnectorInput, maxAssets: number): Promise<IOntologyEnvironmentAsset[]> {
  if (!connector.host || !connector.database) throw new Error('SQL Server connector requires host and database.');
  const pool = new sql.ConnectionPool({
    server: connector.host,
    port: connector.port ?? 1433,
    database: connector.database,
    user: connectorCredentialString(connector, 'username', connector.username),
    password: connectorCredentialString(connector, 'password', connector.password),
    connectionTimeout: 8000,
    requestTimeout: 10000,
    options: {
      encrypt: connector.params?.encrypt === true,
      trustServerCertificate: connector.params?.trust_server_certificate !== false,
    },
  });
  await pool.connect();
  try {
    const tables = await pool
      .request()
      .input('maxAssets', sql.Int, maxAssets)
      .query<{ tableName: string; tableSchema: string; tableType: string }>(
        `SELECT TOP (@maxAssets) TABLE_NAME AS tableName, TABLE_SCHEMA AS tableSchema, TABLE_TYPE AS tableType
       FROM INFORMATION_SCHEMA.TABLES
       ORDER BY TABLE_SCHEMA, TABLE_NAME`
      );
    const assets: IOntologyEnvironmentAsset[] = [];
    for (const table of tables.recordset) {
      const columns = await pool
        .request()
        .input('tableSchema', sql.NVarChar, table.tableSchema)
        .input('tableName', sql.NVarChar, table.tableName)
        .query<{ fieldName: string; dataType: string; isNullable: string }>(
          `SELECT COLUMN_NAME AS fieldName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = @tableSchema AND TABLE_NAME = @tableName
           ORDER BY ORDINAL_POSITION`
        );
      assets.push(
        createScannedAsset(connector, {
          kind: 'table',
          name: table.tableName,
          path: `sqlserver://${connector.host}:${connector.port ?? 1433}/${connector.database}/${table.tableSchema}/${table.tableName}`,
          fields: columns.recordset.map((column) => ({
            name: column.fieldName,
            dataType: column.dataType || 'string',
            nullable: column.isNullable.toUpperCase() === 'YES',
          })),
          metadata: { database: connector.database ?? '', schema: table.tableSchema, tableType: table.tableType },
        })
      );
    }
    return assets;
  } finally {
    await pool.close();
  }
}

async function scanFtpConnector(connector: IOntologyConnectorInput, maxAssets: number): Promise<IOntologyEnvironmentAsset[]> {
  const host = connector.host || stringConnectorParam(connector, 'host');
  if (!host) throw new Error('FTP connector requires host.');
  const rootPath = stringConnectorParam(connector, 'root_path') || '/';
  const client = new FtpClient(8000);
  try {
    await client.access({
      host,
      port: connector.port ?? numberConnectorParam(connector, 'port', 21),
      user: connectorCredentialString(connector, 'username', 'anonymous'),
      password: connectorCredentialString(connector, 'password', ''),
      secure: connector.params?.use_tls === true,
    });
    const entries = await client.list(rootPath);
    return entries.slice(0, maxAssets).map((entry) =>
      createScannedAsset(connector, {
        kind: entry.isDirectory ? 'directory' : inferKindFromPath(entry.name),
        name: entry.name,
        path: `ftp://${host}${path.posix.join(rootPath, entry.name)}`,
        fields: entry.isDirectory ? [] : createFileAssetFields(entry.name),
        metadata: { sizeBytes: entry.size, modifiedAt: entry.modifiedAt?.getTime() ?? null },
      })
    );
  } finally {
    client.close();
  }
}

async function scanSftpConnector(connector: IOntologyConnectorInput, maxAssets: number): Promise<IOntologyEnvironmentAsset[]> {
  const host = connector.host || stringConnectorParam(connector, 'host');
  if (!host) throw new Error('SFTP connector requires host.');
  const rootPath = stringConnectorParam(connector, 'root_path') || '/';
  const client = new SftpClient();
  try {
    await client.connect({
      host,
      port: connector.port ?? numberConnectorParam(connector, 'port', 22),
      username: connectorCredentialString(connector, 'username', ''),
      password: connectorCredentialString(connector, 'password', ''),
      readyTimeout: 8000,
    });
    const entries = await client.list(rootPath);
    return entries.slice(0, maxAssets).map((entry) =>
      createScannedAsset(connector, {
        kind: entry.type === 'd' ? 'directory' : inferKindFromPath(entry.name),
        name: entry.name,
        path: `sftp://${host}${path.posix.join(rootPath, entry.name)}`,
        fields: entry.type === 'd' ? [] : createFileAssetFields(entry.name),
        metadata: { sizeBytes: entry.size, modifiedAt: entry.modifyTime || null },
      })
    );
  } finally {
    try {
      await client.end();
    } catch {
      // The connection may already be closed after a failed handshake.
    }
  }
}

async function scanKafkaConnector(connector: IOntologyConnectorInput, maxAssets: number): Promise<IOntologyEnvironmentAsset[]> {
  const brokers = String(connector.params?.brokers || connector.host || '')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
  if (brokers.length === 0) throw new Error('Kafka connector requires at least one broker.');
  const securityProtocol = String(connector.params?.security_protocol || 'PLAINTEXT').toUpperCase();
  const username = connectorCredentialString(connector, 'username', '');
  const password = connectorCredentialString(connector, 'password', '');
  const kafkaConfig: KafkaConfig = {
    clientId: `sudowork-ontology-${connector.id?.slice(0, 8) || 'probe'}`,
    brokers,
    ssl: securityProtocol.endsWith('_SSL'),
    connectionTimeout: 8000,
    requestTimeout: 10000,
    logLevel: logLevel.NOTHING,
    ...(securityProtocol.startsWith('SASL_') && username && password
      ? {
          sasl: {
            mechanism: 'plain' as const,
            username,
            password,
          },
        }
      : {}),
  };
  const admin = new Kafka(kafkaConfig).admin();
  await admin.connect();
  try {
    const topics = (await admin.listTopics()).filter((topic) => !topic.startsWith('__')).slice(0, maxAssets);
    return topics.map((topic) =>
      createScannedAsset(connector, {
        kind: 'mq',
        name: topic,
        path: `kafka://${brokers.join(',')}/${topic}`,
        fields: [
          { name: 'key', dataType: 'string', nullable: true },
          { name: 'payload', dataType: 'json', nullable: false },
          { name: 'timestamp', dataType: 'datetime', nullable: true },
        ],
        metadata: { brokers: brokers.join(','), securityProtocol },
      })
    );
  } finally {
    await admin.disconnect();
  }
}

async function scanS3Connector(connector: IOntologyConnectorInput, maxAssets: number): Promise<IOntologyEnvironmentAsset[]> {
  const bucket = stringConnectorParam(connector, 'bucket');
  if (!bucket) throw new Error('S3 connector requires bucket.');
  const accessKeyId = connectorCredentialString(connector, 'access_key', '');
  const secretAccessKey = connectorCredentialString(connector, 'secret_key', '');
  const client = new S3Client({
    region: stringConnectorParam(connector, 'region') || 'us-east-1',
    endpoint: stringConnectorParam(connector, 'endpoint') || undefined,
    forcePathStyle: connector.params?.path_style === true,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(8000) });
  const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: maxAssets }), { abortSignal: AbortSignal.timeout(10000) });
  return (result.Contents ?? []).flatMap((item) => {
    if (!item.Key) return [];
    return [
      createScannedAsset(connector, {
        kind: 'oss',
        name: item.Key,
        path: `s3://${bucket}/${item.Key}`,
        fields: createFileAssetFields(item.Key),
        metadata: { bucket, sizeBytes: item.Size ?? 0, modifiedAt: item.LastModified?.getTime() ?? null, etag: item.ETag ?? null },
      }),
    ];
  });
}

async function scanRestConnector(connector: IOntologyConnectorInput): Promise<IOntologyEnvironmentAsset[]> {
  const baseUrl = stringConnectorParam(connector, 'base_url') || connector.url || '';
  if (!baseUrl) throw new Error('REST connector requires base URL.');
  const probePath = stringConnectorParam(connector, 'probe_path') || '/';
  const url = new URL(probePath, baseUrl).toString();
  const response = await fetch(url, {
    headers: buildRestHeaders(connector),
    signal: AbortSignal.timeout(8000),
  });
  if (response.status >= 500) throw new Error(`REST endpoint returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  const responseText = (await response.text()).slice(0, 100_000);
  const fields = contentType.includes('json') ? inferJsonFields(responseText) : [];
  return [
    createScannedAsset(connector, {
      kind: 'api',
      name: connector.name,
      path: url,
      fields: fields.length > 0 ? fields : [{ name: 'response', dataType: contentType.includes('json') ? 'json' : 'text', nullable: true }],
      metadata: { url, statusCode: response.status, contentType },
    }),
  ];
}

async function scanApiConnector(connector: IOntologyConnectorInput): Promise<IOntologyEnvironmentAsset[]> {
  const content = await readConnectorDocument(connector);
  const baseUrl = String(connector.params?.base_url || connector.url || connector.path || connector.name);
  if (!content) {
    return [
      createScannedAsset(connector, {
        kind: 'api',
        name: connector.name,
        path: baseUrl,
        fields: [
          { name: 'method', dataType: 'string', nullable: false },
          { name: 'url', dataType: 'string', nullable: false },
          { name: 'response', dataType: 'json', nullable: true },
        ],
        metadata: {
          url: baseUrl,
          probePath: connector.params?.probe_path ?? '/',
          authType: connector.params?.auth_type ?? 'none',
        },
      }),
    ];
  }
  const parsed = JSON.parse(content) as { paths?: Record<string, Record<string, unknown>> };
  const paths = parsed.paths ?? {};
  return Object.entries(paths).flatMap(([route, methods]) =>
    Object.entries(methods).map(([method, config]) => {
      const record = typeof config === 'object' && config ? (config as { operationId?: string; parameters?: Array<{ name?: string; schema?: { type?: string }; required?: boolean }> }) : {};
      return createScannedAsset(connector, {
        kind: 'api',
        name: record.operationId || `${method.toUpperCase()} ${route}`,
        path: `${baseUrl}#${method.toUpperCase()} ${route}`,
        fields: (record.parameters ?? []).map((parameter) => ({
          name: parameter.name || 'parameter',
          dataType: parameter.schema?.type || 'string',
          nullable: parameter.required !== true,
        })),
        metadata: {
          method: method.toUpperCase(),
          route,
        },
      });
    })
  );
}

function mergeConnectorSecrets(input: IOntologyConnectorInput, existing: IOntologyConnectorConfig | undefined): IOntologyConnectorInput {
  if (!existing) return input;
  const providedCredential = Object.fromEntries(Object.entries(input.credential ?? {}).filter(([, value]) => value !== '' && value !== null));
  return {
    ...input,
    username: input.username?.trim() || existing.username,
    password: input.password || existing.password,
    credentialRef: existing.credentialRef,
    credential: {
      ...(existing.credential ?? {}),
      ...providedCredential,
    },
  };
}

function connectorCredentialString(connector: IOntologyConnectorInput, key: string, fallback: string | undefined): string {
  const value = connector.credential?.[key];
  return typeof value === 'string' ? value : (fallback ?? '');
}

function stringConnectorParam(connector: IOntologyConnectorInput, key: string): string {
  const value = connector.params?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numberConnectorParam(connector: IOntologyConnectorInput, key: string, fallback: number): number {
  const value = connector.params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createFileAssetFields(fileName: string): IOntologyAssetField[] {
  const extension = path.extname(fileName).toLowerCase();
  if (['.json', '.jsonl'].includes(extension)) return [{ name: 'document', dataType: 'json', nullable: false }];
  if (['.csv', '.xlsx', '.xls'].includes(extension)) return [{ name: 'row', dataType: 'record', nullable: false }];
  return [{ name: 'content', dataType: 'binary', nullable: false }];
}

function buildRestHeaders(connector: IOntologyConnectorInput): Record<string, string> {
  const headers = { ...(connector.headers ?? {}) };
  const authType = stringConnectorParam(connector, 'auth_type').toLowerCase();
  if (authType === 'bearer') {
    const token = connectorCredentialString(connector, 'token', '');
    if (token) headers.Authorization = `Bearer ${token}`;
  } else if (authType === 'basic') {
    const username = connectorCredentialString(connector, 'username', '');
    const password = connectorCredentialString(connector, 'password', '');
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  } else if (authType === 'api_key') {
    const key = connectorCredentialString(connector, 'key', 'X-API-Key');
    const value = connectorCredentialString(connector, 'value', '');
    if (value) headers[key] = value;
  }
  return headers;
}

async function readConnectorDocument(connector: IOntologyConnectorInput): Promise<string> {
  if (connector.path) return fs.readFile(connector.path, 'utf8').catch(() => '');
  const url = connector.url || (typeof connector.params?.base_url === 'string' ? connector.params.base_url : '');
  if (!url) return '';
  const response = await fetch(url, {
    headers: buildRestHeaders(connector),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Failed to fetch API spec: ${response.status}`);
  return response.text();
}

async function previewAsset(asset: IOntologyEnvironmentAsset, connector: IOntologyConnectorConfig | undefined, limit: number): Promise<IOntologyPreviewAssetResult> {
  if (!connector) return previewLocalAsset(asset, limit);
  switch (connector.sourceType) {
    case 'sqlite':
      return previewSqliteAsset(asset, connector, limit);
    case 'mysql':
      return previewMysqlAsset(asset, connector, limit);
    case 'postgresql':
      return previewPostgresqlAsset(asset, connector, limit);
    case 'oracle':
      return previewOracleAsset(asset, connector, limit);
    case 'sqlserver':
      return previewSqlServerAsset(asset, connector, limit);
    case 'rest':
    case 'openapi':
      return previewRestAsset(asset, connector, limit);
    case 's3':
    case 'oss':
      return previewS3Asset(asset, connector, limit);
    default:
      return previewMetadata(asset);
  }
}

function previewSqliteAsset(asset: IOntologyEnvironmentAsset, connector: IOntologyConnectorConfig, limit: number): IOntologyPreviewAssetResult {
  const sqlitePath = typeof asset.metadata.sqlitePath === 'string' ? asset.metadata.sqlitePath : connector.path;
  if (!sqlitePath) throw new Error('SQLite asset path is unavailable.');
  const db = new BetterSqlite3(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`SELECT * FROM ${quoteSqlIdentifier(asset.name)} LIMIT ${limit + 1}`).all() as Array<Record<string, unknown>>;
    return previewFromRecords(asset.id, rows, limit);
  } finally {
    db.close();
  }
}

async function previewMysqlAsset(asset: IOntologyEnvironmentAsset, connector: IOntologyConnectorConfig, limit: number): Promise<IOntologyPreviewAssetResult> {
  const connection = await mysql.createConnection({
    host: connector.host,
    port: connector.port ?? 3306,
    database: connector.database,
    user: connectorCredentialString(connector, 'username', connector.username),
    password: connectorCredentialString(connector, 'password', connector.password),
    connectTimeout: 8000,
  });
  try {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT * FROM ${quoteMysqlIdentifier(asset.name)} LIMIT ${limit + 1}`);
    return previewFromRecords(asset.id, rows, limit);
  } finally {
    await connection.end();
  }
}

async function previewPostgresqlAsset(asset: IOntologyEnvironmentAsset, connector: IOntologyConnectorConfig, limit: number): Promise<IOntologyPreviewAssetResult> {
  const client = new PostgresClient({
    host: connector.host,
    port: connector.port ?? 5432,
    database: connector.database,
    user: connectorCredentialString(connector, 'username', connector.username),
    password: connectorCredentialString(connector, 'password', connector.password),
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  try {
    const schema = typeof asset.metadata.schema === 'string' ? asset.metadata.schema : 'public';
    const result = await client.query<Record<string, unknown>>(`SELECT * FROM ${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(asset.name)} LIMIT ${limit + 1}`);
    return previewFromRecords(asset.id, result.rows, limit);
  } finally {
    await client.end();
  }
}

async function previewOracleAsset(asset: IOntologyEnvironmentAsset, connector: IOntologyConnectorConfig, limit: number): Promise<IOntologyPreviewAssetResult> {
  const connection = await oracledb.getConnection({
    user: connectorCredentialString(connector, 'username', connector.username),
    password: connectorCredentialString(connector, 'password', connector.password),
    connectString: `${connector.host}:${connector.port ?? 1521}/${connector.database}`,
  });
  try {
    const result = await connection.execute<Record<string, unknown>>(`SELECT * FROM ${quoteSqlIdentifier(asset.name)} FETCH FIRST ${limit + 1} ROWS ONLY`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return previewFromRecords(asset.id, result.rows ?? [], limit);
  } finally {
    await connection.close();
  }
}

async function previewSqlServerAsset(asset: IOntologyEnvironmentAsset, connector: IOntologyConnectorConfig, limit: number): Promise<IOntologyPreviewAssetResult> {
  const pool = new sql.ConnectionPool({
    server: connector.host ?? '',
    port: connector.port ?? 1433,
    database: connector.database,
    user: connectorCredentialString(connector, 'username', connector.username),
    password: connectorCredentialString(connector, 'password', connector.password),
    connectionTimeout: 8000,
    requestTimeout: 10000,
    options: { encrypt: connector.params?.encrypt === true, trustServerCertificate: connector.params?.trust_server_certificate !== false },
  });
  await pool.connect();
  try {
    const schema = typeof asset.metadata.schema === 'string' ? asset.metadata.schema : 'dbo';
    const result = await pool.request().query<Record<string, unknown>>(`SELECT TOP (${limit + 1}) * FROM ${quoteSqlServerIdentifier(schema)}.${quoteSqlServerIdentifier(asset.name)}`);
    return previewFromRecords(asset.id, result.recordset, limit);
  } finally {
    await pool.close();
  }
}

async function previewRestAsset(asset: IOntologyEnvironmentAsset, connector: IOntologyConnectorConfig, limit: number): Promise<IOntologyPreviewAssetResult> {
  const response = await fetch(asset.path || connector.url || '', { headers: buildRestHeaders(connector), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`REST preview returned HTTP ${response.status}.`);
  return previewStructuredText(asset.id, asset.path || 'response.json', (await response.text()).slice(0, 1_048_576), limit);
}

async function previewS3Asset(asset: IOntologyEnvironmentAsset, connector: IOntologyConnectorConfig, limit: number): Promise<IOntologyPreviewAssetResult> {
  const bucket = stringConnectorParam(connector, 'bucket');
  const key = asset.path?.startsWith(`s3://${bucket}/`) ? asset.path.slice(`s3://${bucket}/`.length) : asset.name;
  if (!bucket || !key) return previewMetadata(asset);
  const accessKeyId = connectorCredentialString(connector, 'access_key', '');
  const secretAccessKey = connectorCredentialString(connector, 'secret_key', '');
  const client = new S3Client({
    region: stringConnectorParam(connector, 'region') || 'us-east-1',
    endpoint: stringConnectorParam(connector, 'endpoint') || undefined,
    forcePathStyle: connector.params?.path_style === true,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-1048575' }), { abortSignal: AbortSignal.timeout(10000) });
  const text = result.Body ? await result.Body.transformToString() : '';
  return previewStructuredText(asset.id, key, text, limit);
}

async function previewLocalAsset(asset: IOntologyEnvironmentAsset, limit: number): Promise<IOntologyPreviewAssetResult> {
  if (!asset.path) return previewMetadata(asset);
  const filePath = asset.path.split('#', 1)[0];
  const text = await readFilePrefix(filePath, 1_048_576);
  return previewStructuredText(asset.id, filePath, text, limit);
}

async function readFilePrefix(filePath: string, maxBytes: number): Promise<string> {
  const file = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

function previewStructuredText(assetId: string, fileName: string, text: string, limit: number): IOntologyPreviewAssetResult {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.csv') {
    const records = parseCsv(text, { relax_column_count: true, skip_empty_lines: true, to: limit + 2 }) as unknown[][];
    const [header = [], ...dataRows] = records;
    const columns = header.map((value, index) => String(value || `column_${index + 1}`));
    const truncated = dataRows.length > limit;
    const rows = dataRows.slice(0, limit).map((row) => columns.map((_, index) => previewValue(row[index])));
    return { assetId, columns, rows, rowsReturned: rows.length, truncated };
  }
  if (extension === '.json' || extension === '.jsonl' || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      const parsed =
        extension === '.jsonl'
          ? text
              .split(/\r?\n/)
              .filter(Boolean)
              .map((line) => JSON.parse(line) as unknown)
          : (JSON.parse(text) as unknown);
      const records = Array.isArray(parsed) ? parsed : [parsed];
      const objectRecords = records.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item));
      if (objectRecords.length > 0) return previewFromRecords(assetId, objectRecords, limit);
    } catch {
      // Fall through to text preview for incomplete prefix data.
    }
  }
  const rows = text
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => [line]);
  return { assetId, columns: ['content'], rows, rowsReturned: rows.length, truncated: text.split(/\r?\n/).filter(Boolean).length > limit };
}

function previewFromRecords(assetId: string, records: Array<Record<string, unknown>>, limit: number): IOntologyPreviewAssetResult {
  const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  const truncated = records.length > limit;
  const rows = records.slice(0, limit).map((record) => columns.map((column) => previewValue(record[column])));
  return { assetId, columns, rows, rowsReturned: rows.length, truncated };
}

function previewMetadata(asset: IOntologyEnvironmentAsset): IOntologyPreviewAssetResult {
  const columns = ['property', 'value'];
  const rows = Object.entries(asset.metadata).map(([key, value]) => [key, previewValue(value)]);
  return { assetId: asset.id, columns, rows, rowsReturned: rows.length, truncated: false };
}

function previewValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (typeof value === 'bigint') return value.toString();
  return JSON.stringify(value);
}

function quoteMysqlIdentifier(value: string): string {
  return `\`${value.replace(/`/g, '``')}\``;
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteSqlServerIdentifier(value: string): string {
  return `[${value.replace(/]/g, ']]')}]`;
}

function createScannedAsset(
  connector: IOntologyConnectorInput,
  input: {
    kind: IOntologyEnvironmentAsset['kind'];
    name: string;
    path?: string;
    fields: IOntologyAssetField[];
    metadata: IOntologyEnvironmentAsset['metadata'];
  }
): IOntologyEnvironmentAsset {
  const now = Date.now();
  return {
    id: randomUUID(),
    kind: input.kind,
    name: input.name,
    sourceName: connector.name,
    path: input.path,
    profileStatus: input.fields.length > 0 ? 'ready' : 'not_profiled',
    fields: input.fields,
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
  };
}

function inferKindFromPath(filePath: string): IOntologyEnvironmentAsset['kind'] {
  const extension = path.extname(filePath).toLowerCase();
  if (['.db', '.sqlite', '.sqlite3', '.sql'].includes(extension)) return 'database';
  if (['.csv', '.json', '.xlsx', '.xls'].includes(extension)) return 'table';
  return 'document';
}

function createAssistantRuleContent(blueprint: IOntologyAgentBlueprint, snapshot: IOntologyVersionSnapshot): string {
  const objectLines = snapshot.objects.map((object) => `- ${object.name} (${object.code}): ${object.description}\n  Attributes: ${object.attributes.map((attribute) => `${attribute.name}:${attribute.dataType}${attribute.required ? ' required' : ''}`).join(', ') || 'none'}`).join('\n');
  const objectNameById = new Map(snapshot.objects.map((object) => [object.id, object.name]));
  const relationLines = snapshot.relations.map((relation) => `- ${relation.name}: ${objectNameById.get(relation.fromObjectId) ?? relation.fromObjectId} -> ${objectNameById.get(relation.toObjectId) ?? relation.toObjectId} (${relation.cardinality})`).join('\n');
  const mappingLines = snapshot.mappings.map((mapping) => `- ${mapping.objectId}/${mapping.attributeId} <- ${mapping.assetId}.${mapping.fieldName} (${mapping.strategy})`).join('\n');
  const ruleLines = snapshot.qualityRules.map((rule) => `- ${rule.name} [${rule.severity}]: ${rule.expression}`).join('\n');
  const functionLines = snapshot.logicFunctions.map((logicFunction) => `- ${logicFunction.code} (${logicFunction.runtime}): ${logicFunction.description}`).join('\n');
  const actionLines = snapshot.actions.map((action) => `- ${action.code} (${action.executor}): ${action.description}`).join('\n');
  const toolLines = blueprint.toolManifest.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
  return [
    '# Ontology Agent',
    '',
    blueprint.promptTemplate,
    '',
    '## Published Ontology',
    '',
    `Version ID: ${blueprint.ontologyVersionId}`,
    '',
    '## Objects',
    '',
    objectLines || '- No objects.',
    '',
    '## Relations',
    '',
    relationLines || '- No relations.',
    '',
    '## Data Mappings',
    '',
    mappingLines || '- No mappings.',
    '',
    '## Quality and Business Rules',
    '',
    ruleLines || '- No rules.',
    '',
    '## Logic Functions',
    '',
    functionLines || '- No logic functions.',
    '',
    '## Actions',
    '',
    actionLines || '- No actions.',
    '',
    '## Tools',
    '',
    toolLines || '- No tools.',
    '',
    'When answering, cite the ontology object, relation, mapping, rule, function, or action that supports the answer.',
  ].join('\n');
}

async function inferFields(filePath: string): Promise<IOntologyAssetField[]> {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (!['csv', 'json', 'sql'].includes(extension)) return [];
  const content = await fs.readFile(filePath, 'utf8').catch(() => '');
  if (!content.trim()) return [];
  if (extension === 'csv') return inferCsvFields(content);
  if (extension === 'json') return inferJsonFields(content);
  return inferSqlFields(content);
}

function inferCsvFields(content: string): IOntologyAssetField[] {
  const [header = []] = parseCsv(content, { relax_column_count: true, skip_empty_lines: true, to: 1 }) as unknown[][];
  return header
    .map((name) => String(name).trim())
    .filter(Boolean)
    .map((name) => ({ name, dataType: 'string', nullable: true }));
}

function inferJsonFields(content: string): IOntologyAssetField[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    const sample = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return [];
    return Object.entries(sample).map(([name, value]) => ({
      name,
      dataType: inferValueType(value),
      nullable: value === null,
    }));
  } catch {
    return [];
  }
}

function inferSqlFields(content: string): IOntologyAssetField[] {
  const match = content.match(/create\s+table\s+[^({]+\(([\s\S]*?)\);?/i);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line && !/^(primary|foreign|unique|constraint|key)\b/i.test(line))
    .map((line) => {
      const [rawName, rawType = 'string'] = line.split(/\s+/, 2);
      return {
        name: rawName.replace(/[`"[\]]/g, ''),
        dataType: rawType,
        nullable: !/not\s+null/i.test(line),
      };
    })
    .filter((field) => field.name);
}

function inferValueType(value: unknown): string {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Date) return 'datetime';
  if (value && typeof value === 'object') return 'json';
  return 'string';
}
