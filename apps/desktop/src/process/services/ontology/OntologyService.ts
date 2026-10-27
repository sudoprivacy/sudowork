import { pathToFileURL } from 'node:url';
import fs from 'fs/promises';
import { dialog } from 'electron';

import { createHash, randomUUID } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import type {
  IOntologyPackageExportInput,
  IOntologyPackageExportProgress,
  IOntologyPackageExportResult,
  IOntologyPackageImportInput,
  IOntologyPackagePreview,
  IOntologyAgentDefinition,
  IOntologyRuntimeBindings,
  IOntologyRuntimeEnvironment,
  IOntologyStudioSaveInput,
  IOntologyStudioProject,
  IOntologyStudioProjectList,
  IOntologyConnectSourceInput,
  IOntologyStandardImportInput,
  IOntologyStandardExportInput,
  IOntologyActionDefinitionInput,
  IOntologyAgentBlueprint,
  IOntologyAgentBlueprintInput,
  IOntologyAttributeDraftInput,
  IOntologyBrowseConnectorAssetsInput,
  IOntologyCreateWorkbenchInput,
  IOntologyDeleteWorkbenchInput,
  IOntologyDeleteAttributeInput,
  IOntologyDeleteConnectorInput,
  IOntologyDeleteInput,
  IOntologyEnvironmentAsset,
  IOntologyExecuteRuntimeInput,
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
  IOntologyDescribeAssetFieldsInput,
  IOntologyPublishApprovalInput,
  IOntologyQualityRuleInput,
  IOntologyRejectVersionInput,
  IOntologyRegisterAgentInput,
  IOntologyRelationDraft,
  IOntologyRelationDraftInput,
  IOntologyReviewTargetInput,
  IOntologyRollbackInput,
  IOntologyRuntimeExecutionResult,
  IOntologySelectWorkbenchInput,
  IOntologySyncAssetSchemaInput,
  IOntologyVersionSnapshot,
  IOntologyWorkbenchDraftInput,
  IOntologyWorkbenchSnapshot,
} from '@sudowork/ontology-common';
import { exportOntologyArchive, extractOntologyArchive } from '@sudowork/ontology-runtime/archive';
import { contentHash, loadOntologyArtifact, readPackageFile, OntologyPackageError } from '@sudowork/ontology-runtime/artifact';
import { restoreOntologyAuthoring } from '@sudowork/ontology-runtime/authoring';
import { mergeOntologyBindings, ontologyBindingsSchema } from '@sudowork/ontology-runtime/bindings';
import { evaluateOntologyQualityRules, qualityRuleIssue, evaluateRelationDataBindings, scanConnectorAssets, mergeConnectorSecrets, previewAsset, inferFields } from '@sudowork/ontology-runtime/execution';

import { z } from 'zod';
import {
  createDefaultOntologyWorkbenchSnapshot,
  ontologyBlockingIssues,
  ontologyFieldSignature,
  projectSemanticDocument,
  uniqueStatements,
  reconcileSemanticModel,
  createSemanticDocument,
  STUDIO_MAX_FILE_BYTES,
  isOntologyDocumentAsset,
  ONTOLOGY_DOCUMENT_MAX_GOAL_CHARS,
  ONTOLOGY_QUALITY_RULE_SAMPLE_LIMIT,
} from '@sudowork/ontology-common';
import { parseStandardOntology, exportStandardOntology, OntologyEngine, createFileStat } from '@sudowork/ontology-engine';

import { DEFAULT_PRESET_AGENT_TYPE } from '@sudowork/common/acpTypes';
import { assistantManager } from '@process/AssistantManager';

import { mainError } from '@process/utils/mainLogger';
import { acpDetector } from '@/agent/acp/AcpDetector';
import { studioSaveSchema } from './studioValidation';
import { OntologyStudioDatabase as OntologyDatabase } from './OntologyStudioDatabase';
import { getOntologyCliPath, OntologyScriptHost, ontologyCommand, quoteOntologyArgument, runOntologyScript } from './OntologyScriptHost';
import { parseOntologyTemplateFile } from './ontologyTemplateParser';
import { extractOntologyDocuments, readOntologyDocuments, validateOntologyDocumentFiles } from './ontologyDocumentExtractor';
import { describeOntologyFields } from './ontologyFieldMeaning';
import { SudographReviewHost } from './SudographReviewHost';
import { OntologyAgentRegistry } from './OntologyAgentRegistry';

export class OntologyService {
  private readonly database: OntologyDatabase;
  private readonly engine: OntologyEngine;
  private readonly agentRegistry: OntologyAgentRegistry;
  readonly scripts: OntologyScriptHost;
  private readonly packageExports = new Map<string, AbortController>();
  private readonly sourceConnections = new Map<string, { fingerprint: string; promise: Promise<IOntologyStudioProject> }>();
  private readonly generatingWorkspaces = new Set<string>();
  private readonly describingAssets = new Map<string, Promise<IOntologyWorkbenchSnapshot>>();
  private reviewHost: SudographReviewHost | undefined;

  constructor(
    database = new OntologyDatabase(),
    engine = new OntologyEngine(database),
    private readonly extractDocuments = extractOntologyDocuments,
    private readonly describeFields = describeOntologyFields
  ) {
    this.database = database;
    this.engine = engine;
    this.scripts = new OntologyScriptHost(database.getRuntimeDirectory?.());
    this.agentRegistry = new OntologyAgentRegistry(database, engine, {
      isInstalled: async (id) => (await assistantManager.getAssistantMetaWithDir(id))?.category === 'custom',
      install: (blueprint, snapshot) => this.installRegisteredAgent(blueprint, snapshot),
      suspend: async (blueprint) => {
        const installed = blueprint.registeredAssistantId ? await assistantManager.getAssistantMetaWithDir(blueprint.registeredAssistantId) : null;
        if (installed?.category === 'custom' && installed.meta.ontologyBinding?.blueprintId === blueprint.id) {
          const result = await assistantManager.disableAssistant(blueprint.registeredAssistantId!, 'custom');
          if (!result.success) throw new Error(result.msg);
        }
      },
      retire: async (blueprint) => {
        if (blueprint.registeredAssistantId) {
          const installed = await assistantManager.getAssistantMetaWithDir(blueprint.registeredAssistantId);
          if (installed?.category === 'custom') {
            const result = await assistantManager.disableAssistant(blueprint.registeredAssistantId, 'custom');
            if (!result.success) throw new Error(result.msg);
          }
        }
      },
      remove: (blueprint) => this.uninstallRegisteredAgent(blueprint),
      refresh: () => acpDetector.refreshCustomAgents(),
    });
  }

  onAgentRegistrationChanged(onChanged: (snapshot: IOntologyWorkbenchSnapshot) => void): void {
    this.agentRegistry.onChanged = onChanged;
  }

  async buildRuntimeDraft(workspaceId: string) {
    const artifact = await this.scripts.build(await this.engine.getWorkbench(workspaceId));
    return { runtimeDigest: artifact.manifest.runtimeDigest, capabilities: artifact.capabilities };
  }

  async planRuntimePackage(input: { workspaceId: string; versionId: string }) {
    const snapshot = await this.engine.getWorkbench(input.workspaceId);
    const artifact = await this.scripts.published(snapshot, input.versionId);
    return { versionId: input.versionId, version: artifact.manifest.version, resources: artifact.manifest.resources, capabilities: artifact.capabilities };
  }

  private async stageRuntimePackage(filePath: string) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new OntologyPackageError('PACKAGE_INVALID', 'Unsupported package size.');
    const bytes = await fs.readFile(filePath);
    if (bytes.length > 512 * 1024 * 1024) throw new OntologyPackageError('PACKAGE_INVALID', 'Unsupported package size.');
    await fs.mkdir(this.scripts.directory, { recursive: true, mode: 0o700 });
    const staging = await fs.mkdtemp(path.join(this.scripts.directory, '.import-'));
    const archive = path.join(staging, 'input.sudoonto');
    try {
      await fs.writeFile(archive, bytes, { mode: 0o600 });
      const directory = path.join(staging, 'package');
      await extractOntologyArchive(archive, directory);
      const manifest = (await loadOntologyArtifact(directory, {}, true)).manifest;
      if (manifest.versionId === 'draft' || manifest.version === 'draft') throw new OntologyPackageError('PACKAGE_INVALID', 'Export a published version before importing it as a Sudowork ontology package.');
      return { staging, directory, fingerprint: contentHash(bytes) };
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async previewRuntimePackage(input: { filePath: string }): Promise<IOntologyPackagePreview> {
    const staged = await this.stageRuntimePackage(z.string().min(1).parse(input.filePath));
    try {
      const loaded = await loadOntologyArtifact(staged.directory, {}, true);
      return { fingerprint: staged.fingerprint, manifest: loaded.manifest, capabilities: loaded.capabilities, agent: loaded.snapshot.agentDefinition!, missingBindings: loaded.missingBindings, objectCount: loaded.snapshot.objects.length, relationCount: loaded.snapshot.relations.length };
    } finally {
      await fs.rm(staged.staging, { recursive: true, force: true });
    }
  }

  async importRuntimePackage(raw: IOntologyPackageImportInput): Promise<IOntologyWorkbenchSnapshot> {
    const input = z
      .object({ filePath: z.string().min(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().trim().min(1).max(200).optional(), isFork: z.boolean().optional() })
      .strict()
      .parse(raw);
    const staged = await this.stageRuntimePackage(input.filePath);
    const workspaceId = 'ontology_' + randomUUID().replace(/-/g, '');
    const relative = path.join('imports', workspaceId);
    const directory = path.join(this.scripts.directory, relative);
    let isSaved = false;
    try {
      if (staged.fingerprint !== input.fingerprint) throw new Error('ontology.studio.errors.fileChanged');
      await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
      await fs.rename(staged.directory, directory);
      const { snapshot } = await restoreOntologyAuthoring(directory, { ...input, workspaceId });
      studioSaveSchema.parse({ workspaceId, expectedRevision: 0, operationId: randomUUID(), objects: snapshot.objects, relations: snapshot.relations });
      for (const version of snapshot.publishedVersions) version.runtimeLocation = relative;
      this.database.saveSnapshot(snapshot);
      isSaved = true;
      this.database.setActiveWorkspaceId(workspaceId);
      return snapshot;
    } finally {
      await fs.rm(staged.staging, { recursive: true, force: true });
      if (!isSaved) await fs.rm(directory, { recursive: true, force: true });
    }
  }

  async getRuntimeEnvironment(input: { workspaceId: string }): Promise<IOntologyRuntimeEnvironment> {
    const artifact = await this.scripts.build(await this.engine.getWorkbench(input.workspaceId));
    const loaded = await loadOntologyArtifact(artifact.directory, artifact.bindings);
    return { resources: artifact.manifest.resources, missingBindings: loaded.missingBindings, template: JSON.parse((await readPackageFile(artifact.directory, 'environment/bindings.example.json')).toString('utf8')) as IOntologyRuntimeBindings };
  }

  async configureRuntimeEnvironment(input: { workspaceId: string; bindings: IOntologyRuntimeBindings }): Promise<IOntologyRuntimeEnvironment> {
    const bindings = ontologyBindingsSchema.parse(input.bindings) as IOntologyRuntimeBindings;
    const snapshot = await this.engine.getWorkbench(input.workspaceId);
    const before = structuredClone(snapshot);
    const artifact = await this.scripts.build(snapshot);
    const resources = artifact.manifest.resources;
    if (
      Object.keys(bindings.connections || {}).some((id) => !snapshot.connectors.some((item) => item.id === id)) ||
      Object.keys(bindings.files || {}).some((id) => !resources.some((item) => item.provider === 'file' && item.assetIds.includes(id))) ||
      Object.keys(bindings.actions || {}).some((id) => !resources.some((item) => item.id === 'action:' + id)) ||
      Object.keys(bindings.secrets || {}).some((id) => !resources.some((item) => item.provider === 'secret' && item.id === id)) ||
      bindings.allowedActions?.some((id) => !artifact.capabilities.some((item) => item.kind === 'action' && item.artifactId === id))
    )
      throw new Error('Unknown ontology resource binding.');
    for (const connector of snapshot.connectors) {
      const binding = bindings.connections?.[connector.id];
      if (binding?.sourceType && binding.sourceType !== connector.sourceType) throw new Error('Connection provider cannot be changed through runtime bindings.');
    }
    snapshot.runtimeBindings = mergeOntologyBindings(snapshot.runtimeBindings || {}, bindings);
    const merged = mergeOntologyBindings({ connections: Object.fromEntries(snapshot.connectors.map((item) => [item.id, item])), files: Object.fromEntries(snapshot.assets.filter((item) => item.path).map((item) => [item.id, item.path!])) }, bindings);
    await this.scripts.assertWritableBindings(merged);
    snapshot.connectors = snapshot.connectors.map((item) => ({ ...item, ...merged.connections?.[item.id] }));
    snapshot.assets = snapshot.assets.map((item) => (merged.files?.[item.id] ? { ...item, path: merged.files[item.id] } : item));
    this.database.saveSnapshot(snapshot, before);
    return this.getRuntimeEnvironment(input);
  }

  async verifyRuntimeEnvironment(input: { workspaceId: string }) {
    const artifact = await this.scripts.build(await this.engine.getWorkbench(input.workspaceId));
    const bindingsPath = await this.scripts.writeBindings(artifact.bindings);
    try {
      return (await runOntologyScript(path.join(artifact.directory, artifact.manifest.entrypoints.cli), ['verify', '--package', artifact.directory, '--bindings', bindingsPath], { protocolVersion: 1 })).data;
    } finally {
      await fs.rm(bindingsPath, { force: true });
    }
  }

  async updateAgentDefinition(input: { workspaceId: string; expectedRevision: number; definition: IOntologyAgentDefinition }) {
    const definition = z
      .object({ name: z.string().trim().min(1).max(200), description: z.string().max(20_000), instructions: z.string().trim().min(1).max(100_000) })
      .strict()
      .parse(input.definition);
    const snapshot = await this.engine.getWorkbench(input.workspaceId);
    if ((snapshot.revision || 0) !== input.expectedRevision) throw new Error('ontology.studio.errors.conflict');
    const before = structuredClone(snapshot);
    snapshot.agentDefinition = definition as IOntologyAgentDefinition;
    this.database.saveSnapshot(snapshot, before);
    return this.compileResult(Promise.resolve(snapshot));
  }

  cancelRuntimePackageExport(requestId: string): void {
    this.packageExports.get(requestId)?.abort();
  }

  async exportRuntimePackage(input: IOntologyPackageExportInput, onProgress?: (event: IOntologyPackageExportProgress) => void): Promise<IOntologyPackageExportResult> {
    const requestId = z.string().min(1).max(128).parse(input.requestId);
    if (this.packageExports.has(requestId)) throw new Error('An export with this identity is already running.');
    const controller = new AbortController();
    this.packageExports.set(requestId, controller);
    try {
      const snapshot = await this.engine.getWorkbench(input.workspaceId);
      const artifact = await this.scripts.published(snapshot, input.versionId);
      const destination = await dialog.showSaveDialog({ defaultPath: artifact.manifest.name.replace(/[\\/:*?"<>|]/g, '_') + '.sudoonto', filters: [{ name: 'Sudowork Ontology', extensions: ['sudoonto'] }] });
      if (destination.canceled || !destination.filePath || controller.signal.aborted) return { isCancelled: true };
      const result = await exportOntologyArchive(artifact, {
        targetPath: destination.filePath,
        embeddedResourceIds: input.embeddedResourceIds || [],
        signal: controller.signal,
        onProgress: (phase, completed, total) => onProgress?.({ requestId, phase, completed, total }),
        onVerify: async (directory) => {
          const response = await runOntologyScript(getOntologyCliPath(), ['verify', '--package', directory], { protocolVersion: 1 }, 30_000, controller.signal);
          return response.data;
        },
      });
      return { isCancelled: false, ...result };
    } catch (error) {
      if (controller.signal.aborted) return { isCancelled: true };
      throw error;
    } finally {
      this.packageExports.delete(requestId);
    }
  }

  private async compileResult<T extends IOntologyWorkbenchSnapshot | { snapshot: IOntologyWorkbenchSnapshot }>(operation: Promise<T>): Promise<T> {
    const result = await operation;
    await this.scripts.build('snapshot' in result ? result.snapshot : result);
    return result;
  }

  getModelAuthority(workspaceId: string) {
    const project = this.database.getProject(workspaceId);
    if (!project) throw new Error('ontology.studio.errors.notFound');
    return project.authority;
  }

  async listStudioProjects(): Promise<IOntologyStudioProjectList> {
    const items = this.database
      .listProjects()
      .filter((project) => project.authority === 'rdf')
      .map((project): IOntologyStudioProject => {
        const snapshot = project.authority === 'rdf' ? this.database.getSnapshot(project.id) : null;
        return { workspaceId: project.id, name: snapshot?.draft.title || project.title, authority: project.authority, ...(snapshot ? { description: snapshot.draft.description, objectCount: snapshot.objects.length } : {}) };
      });
    return { items, sourceRegistration: { available: true, providers: ['sqlite', 'mysql', 'postgresql'], execution: 'desktop' } };
  }

  async getStudioProject(input: { workspaceId: string }): Promise<IOntologyStudioProject> {
    const workspaceId = z.string().trim().min(1).max(200).parse(input.workspaceId);
    const project = this.database.getProject(workspaceId);
    if (!project) throw new Error('ontology.studio.errors.notFound');
    if (project.authority === 'rdf') return { workspaceId, name: project.title, authority: 'rdf' };
    // The private overview never transports frozen record bytes just to get counts.
    const overview = await this.invokeSudograph<{
      revision: string;
      source_registration: null | { connection: { observed_at: string }; scan: { status: string; structure_complete: boolean; objects: number; tables: number; database_views: number; fields: number }; records: { delivery: 'live' | 'snapshot'; rows_embedded: number } };
    }>(workspaceId, { operation: 'overview' });
    if (!overview.revision || !('source_registration' in overview)) throw new Error('Invalid registered Sudograph source overview.');
    const receipt = overview.source_registration;
    if (!receipt) return { workspaceId, name: project.title, authority: 'sudograph' };
    return {
      workspaceId,
      name: project.title,
      authority: 'sudograph',
      objectCount: receipt.scan.objects,
      source: {
        revision: overview.revision,
        observedAt: receipt.connection.observed_at,
        structureComplete: receipt.scan.status === 'complete' && receipt.scan.structure_complete,
        objects: receipt.scan.objects,
        tables: receipt.scan.tables,
        databaseViews: receipt.scan.database_views,
        fields: receipt.scan.fields,
        delivery: receipt.records.delivery,
        rowsEmbedded: receipt.records.rows_embedded,
      },
    };
  }

  /** Native form intake. Model paths, namespaces and authority are host-derived. */
  async connectStudioSource(raw: IOntologyConnectSourceInput): Promise<IOntologyStudioProject> {
    const input = z
      .object({
        operationId: z.string().uuid(),
        language: z.enum(['en', 'zh']),
        connector: z
          .object({
            name: z.string().trim().min(1).max(200),
            sourceType: z.enum(['sqlite', 'mysql', 'postgresql']),
            path: z.string().trim().optional(),
            host: z.string().trim().optional(),
            port: z.number().int().min(1).max(65535).optional(),
            database: z.string().trim().optional(),
            username: z.string().optional(),
            password: z.string().optional(),
            params: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
            kind: z.literal('database'),
            writable: z.literal(false),
            metadata: z.object({}).strict(),
          })
          .strict(),
      })
      .strict()
      .parse(raw) as IOntologyConnectSourceInput;
    const identity = `source_${createHash('sha256').update(input.operationId).digest('hex').slice(0, 32)}`;
    const fingerprint = contentHash(JSON.stringify(input.connector));
    const pending = this.sourceConnections.get(identity);
    if (pending) {
      if (pending.fingerprint !== fingerprint) throw new Error('ontology.studio.errors.operationConflict');
      return pending.promise;
    }
    const operation = (async () => {
      if (this.database.getProject(identity)) {
        if (this.database.getSnapshot(identity)?.sourceRequestHash !== fingerprint) throw new Error('ontology.studio.errors.operationConflict');
        return this.getStudioProject({ workspaceId: identity });
      }
      if (input.connector.sourceType === 'sqlite' && (!input.connector.path || !path.isAbsolute(input.connector.path))) throw new Error('Select a SQLite file on this desktop.');
      const assets = await scanConnectorAssets({ connector: input.connector });
      const snapshot = createDefaultOntologyWorkbenchSnapshot(Date.now(), { workspaceId: identity, title: input.connector.name });
      snapshot.sourceRequestHash = fingerprint;
      this.database.saveSnapshot(snapshot);
      try {
        const result = await this.engine.probeConnector({ workspaceId: identity, connector: input.connector }, assets, identity);
        await this.generateDraft({ workspaceId: identity, assetIds: result.assets.map((item) => item.id) });
        return this.getStudioProject({ workspaceId: identity });
      } catch (error) {
        this.database.deleteSnapshot(identity);
        throw error;
      }
    })().finally(() => this.sourceConnections.delete(identity));
    this.sourceConnections.set(identity, { fingerprint, promise: operation });
    return operation;
  }

  async resumeStudioSource(input: { operationId: string }): Promise<IOntologyStudioProject | null> {
    const operationId = z.string().uuid().parse(input.operationId);
    const workspaceId = `source_${createHash('sha256').update(operationId).digest('hex').slice(0, 32)}`;
    if (!this.database.getProject(workspaceId)) return null;
    return this.getStudioProject({ workspaceId });
  }

  /** Trusted connection intake. Registration is never inferred from an RDF snapshot or prompt. */
  async registerSudographSourceProject(input: { workspaceId: string; title: string; modelRef: string; source: string; namespace: string; operationId: string; language: 'en' | 'zh' }) {
    if (!input.workspaceId.trim() || !input.title.trim()) throw new Error('Invalid Sudograph project registration.');
    const existing = this.database.getProject(input.workspaceId);
    if (existing && (existing.authority !== 'sudograph' || existing.modelRef !== input.modelRef)) throw new Error('Ontology model authority conflict.');
    const { getSudographModelClient } = await import('./SudographModelClient');
    const result = await getSudographModelClient().registerSource(input.modelRef, `desktop:${hostname()}:${userInfo().username}`, { source: input.source, namespace: input.namespace, operationId: input.operationId, language: input.language });
    this.database.registerSudographProject({ id: input.workspaceId, title: input.title, modelRef: input.modelRef });
    return { project: this.database.getProject(input.workspaceId), ...result };
  }

  /** Bound host entry: the persisted registration, not the caller, selects a model. */
  async invokeSudograph<T>(workspaceId: string, request: Record<string, unknown>): Promise<T> {
    const project = this.database.getProject(workspaceId);
    if (project?.authority !== 'sudograph') throw new Error('This project is not owned by Sudograph.');
    const { getSudographModelClient } = await import('./SudographModelClient');
    return getSudographModelClient().invoke<T>(project.modelRef, `desktop:${hostname()}:${userInfo().username}`, request);
  }

  /** Trusted browser host only. This handoff includes a secret and is not an IPC result. */
  async createStudioReviewSession(binding: { workspaceId: string; conversationId: string }) {
    this.reviewHost ??= new SudographReviewHost({
      authorize: ({ workspaceId, conversationId }) => {
        const project = this.database.getProject(workspaceId);
        const session = this.database.getAiSessionByConversationId(conversationId);
        if (project?.authority !== 'sudograph' || session?.workspace_id !== workspaceId) throw new Error('Review conversation does not own this registered model.');
      },
      read: async (workspaceId, request) => {
        const project = this.database.getProject(workspaceId);
        if (project?.authority !== 'sudograph') throw new Error('Registered review is unavailable.');
        const { getSudographModelClient } = await import('./SudographModelClient');
        return getSudographModelClient().review(project.modelRef, `desktop:${hostname()}:${userInfo().username}`, workspaceId, request);
      },
    });
    return this.reviewHost.createSession(binding);
  }

  async closeReviewSessions(): Promise<void> {
    await this.reviewHost?.close();
    this.reviewHost = undefined;
  }

  async saveStudioModel(raw: IOntologyStudioSaveInput) {
    const parsed = studioSaveSchema.safeParse(raw);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'ontology.studio.errors.invalidModel');
    const input = parsed.data as IOntologyStudioSaveInput;
    const snapshot = this.database.getSnapshot(input.workspaceId);
    if (!snapshot) throw new Error('ontology.studio.errors.notFound');
    const operation = { id: input.operationId, payload: JSON.stringify(input) };
    if (this.database.hasOperation(input.workspaceId, operation)) return snapshot;
    if ((snapshot.revision || 0) !== input.expectedRevision) throw new Error('ontology.studio.errors.conflict');
    const before = structuredClone(snapshot);
    snapshot.objects = input.objects;
    snapshot.relations = input.relations;
    const objectIds = new Set(input.objects.map((item) => item.id));
    const attributeIds = new Set(input.objects.flatMap((item) => item.attributes.map((attr) => attr.id)));
    if ([...snapshot.logicFunctions, ...snapshot.actions].some((item) => item.objectIds.some((id) => !objectIds.has(id)))) throw new Error('ontology.studio.errors.referencedCapability');
    snapshot.mappings = snapshot.mappings.filter((item) => objectIds.has(item.objectId) && attributeIds.has(item.attributeId));
    snapshot.qualityRules = snapshot.qualityRules.filter((item) => objectIds.has(item.objectId));
    this.database.saveSnapshot(snapshot, before, operation);
    return this.compileResult(Promise.resolve(snapshot));
  }

  async previewStandardFile(input: { filePath: string }) {
    const stat = await fs.stat(input.filePath);
    if (!stat.isFile() || stat.size > STUDIO_MAX_FILE_BYTES) throw new Error('ontology.studio.errors.fileTooLarge');
    const content = await fs.readFile(input.filePath, 'utf8');
    return parseStandardOntology(content, pathToFileURL(path.resolve(input.filePath)).href, path.basename(input.filePath));
  }

  async importStandardFile(input: IOntologyStandardImportInput) {
    const preview = await this.previewStandardFile(input);
    if (preview.fingerprint !== input.fingerprint) throw new Error('ontology.studio.errors.fileChanged');
    const snapshot = this.database.getSnapshot(input.workspaceId);
    if (!snapshot) throw new Error('ontology.studio.errors.notFound');
    const operation = { id: input.operationId, payload: JSON.stringify(input) };
    if (this.database.hasOperation(input.workspaceId, operation)) return snapshot;
    if ((snapshot.revision || 0) !== input.expectedRevision) throw new Error('ontology.studio.errors.conflict');
    const before = structuredClone(snapshot);
    const current = snapshot.semanticDocument || createSemanticDocument(snapshot.workspaceId);
    const isEmpty = snapshot.objects.length === 0 && current.statements.length <= 1;
    snapshot.semanticDocument = isEmpty
      ? preview.document
      : {
          ...current,
          prefixes: { ...current.prefixes, ...preview.document.prefixes },
          statements: uniqueStatements([...current.statements, ...preview.document.statements]),
          imports: [...new Set([...current.imports, ...preview.document.imports])],
          owlAxioms: [...(current.owlAxioms || []), ...(preview.document.owlAxioms || [])].filter((item, index, all) => all.findIndex((other) => other.xml === item.xml) === index),
        };
    const model = projectSemanticDocument(snapshot.semanticDocument, snapshot);
    snapshot.objects = model.objects;
    snapshot.relations = model.relations;
    this.database.saveSnapshot(snapshot, before, operation);
    return this.compileResult(Promise.resolve(snapshot));
  }

  async exportStandardFile(input: IOntologyStandardExportInput) {
    const snapshot = this.database.getSnapshot(input.workspaceId);
    if (!snapshot) throw new Error('ontology.studio.errors.notFound');
    const version = input.versionId ? snapshot.publishedVersions.find((item) => item.id === input.versionId) : undefined;
    if (input.versionId && !version) throw new Error('ontology.studio.errors.notFound');
    let document = version?.snapshot.semanticDocument || snapshot.semanticDocument || createSemanticDocument(snapshot.workspaceId);
    if (input.model) {
      if (input.versionId || (snapshot.revision || 0) !== input.expectedRevision) throw new Error('ontology.studio.errors.conflict');
      const model = studioSaveSchema.parse({ ...input.model, workspaceId: input.workspaceId, expectedRevision: input.expectedRevision, operationId: 'export-preview' }) as IOntologyStudioSaveInput;
      document = reconcileSemanticModel(document, snapshot, model, snapshot.workspaceId);
    }
    return { content: exportStandardOntology(document, input.format), format: input.format };
  }

  async listWorkbenches() {
    const activeWorkspaceId = this.database.getActiveWorkspaceId() || '';
    return this.engine.listWorkbenches(activeWorkspaceId);
  }

  async getWorkbench(input?: IOntologySelectWorkbenchInput) {
    if (input?.workspaceId && !this.database.getSnapshot(input.workspaceId)) throw new Error('ontology.studio.errors.notFound');
    const workspaceId = input?.workspaceId?.trim() || (await this.getActiveWorkspaceId());
    return this.agentRegistry.refresh(await this.engine.getWorkbench(workspaceId));
  }

  async createWorkbench(input: IOntologyCreateWorkbenchInput) {
    const result = await this.engine.createWorkbench(input, '');
    this.database.setActiveWorkspaceId(result.activeWorkspaceId);
    return result;
  }

  async selectWorkbench(input: IOntologySelectWorkbenchInput) {
    const snapshot = await this.agentRegistry.refresh(await this.engine.getWorkbench(input.workspaceId));
    this.database.setActiveWorkspaceId(snapshot.workspaceId);
    return snapshot;
  }

  async deleteWorkbench(input: IOntologyDeleteWorkbenchInput) {
    return this.agentRegistry.withLock(input.workspaceId, async () => {
      const activeWorkspaceId = this.database.getActiveWorkspaceId() || '';
      const { reapConversation } = await import('@process/services/conversationReaper');
      for (const session of this.database.listAiSessions(input.workspaceId)) await reapConversation(session.conversation_id, { reason: 'user-delete' });
      const snapshot = this.database.getSnapshot(input.workspaceId);
      for (const blueprint of (snapshot?.agentBlueprints || []).flatMap((item) => [item, ...(item.retiredRegistrations || [])])) {
        await this.uninstallRegisteredAgent(blueprint);
      }
      const result = await this.engine.deleteWorkbench(input, activeWorkspaceId);
      this.database.setActiveWorkspaceId(result.activeWorkspaceId);
      return result;
    });
  }

  async updateDraft(input: IOntologyWorkbenchDraftInput) {
    return this.compileResult(this.engine.updateDraft(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async transitionPhase(input: IOntologyPhaseTransitionInput) {
    return this.engine.transitionPhase(input, input.workspaceId || (await this.getActiveWorkspaceId()));
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
    const workspaceId = input.workspaceId || (await this.getActiveWorkspaceId());
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const existing = input.connector.id ? snapshot.connectors.find((connector) => connector.id === input.connector.id) : undefined;
    const connector = mergeConnectorSecrets(input.connector, existing);
    const mergedInput = { ...input, connector };
    const assets = await scanConnectorAssets(mergedInput);
    return this.engine.probeConnector(mergedInput, assets, workspaceId);
  }

  async browseConnectorAssets(input: IOntologyBrowseConnectorAssetsInput) {
    return this.engine.browseConnectorAssets(input, input.workspaceId || (await this.getActiveWorkspaceId()));
  }

  async deleteConnector(input: IOntologyDeleteConnectorInput) {
    return this.engine.deleteConnector(input, input.workspaceId || (await this.getActiveWorkspaceId()));
  }

  async deleteAsset(input: IOntologyDeleteInput) {
    return this.engine.deleteAsset(input, input.workspaceId || (await this.getActiveWorkspaceId()));
  }

  async profileAsset(input: IOntologyProfileAssetInput) {
    const workspaceId = input.workspaceId || (await this.getActiveWorkspaceId());
    return this.engine.profileAsset(input, workspaceId, await this.scanCurrentAsset(input.id, workspaceId));
  }

  async syncAssetSchema(input: IOntologySyncAssetSchemaInput) {
    const workspaceId = input.workspaceId || (await this.getActiveWorkspaceId());
    return this.engine.syncAssetSchema(input, workspaceId, await this.scanCurrentAsset(input.id, workspaceId));
  }

  async previewAsset(input: IOntologyPreviewAssetInput): Promise<IOntologyPreviewAssetResult> {
    const workspaceId = input.workspaceId || (await this.getActiveWorkspaceId());
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const asset = snapshot.assets.find((item) => item.id === input.id);
    if (!asset) throw new Error('Asset not found.');
    const connectorId = typeof asset.metadata.connectorId === 'string' ? asset.metadata.connectorId : undefined;
    const connector = connectorId ? snapshot.connectors.find((item) => item.id === connectorId) : undefined;
    return previewAsset(asset, connector, Math.max(1, Math.min(input.limit ?? 20, 100)));
  }

  describeAssetFields(raw: IOntologyDescribeAssetFieldsInput): Promise<IOntologyWorkbenchSnapshot> {
    const input = z.object({ workspaceId: z.string().trim().min(1).max(200), id: z.string().trim().min(1).max(200), language: z.string().trim().min(2).max(40), isRefresh: z.boolean().optional() }).parse(raw) as IOntologyDescribeAssetFieldsInput;
    const key = JSON.stringify([input.workspaceId, input.id, input.language]);
    const pending = this.describingAssets.get(key);
    if (pending) return pending;
    const operation = this.describeCurrentAssetFields(input).finally(() => this.describingAssets.delete(key));
    this.describingAssets.set(key, operation);
    return operation;
  }

  private async describeCurrentAssetFields(input: IOntologyDescribeAssetFieldsInput): Promise<IOntologyWorkbenchSnapshot> {
    const snapshot = this.database.getSnapshot(input.workspaceId);
    const asset = snapshot?.assets.find((item) => item.id === input.id);
    if (!snapshot || !asset) throw new Error('ontology.studio.dataErrors.schemaUnavailable');
    const fields = asset.fields.filter((field) => input.isRefresh || !field.businessMeaning?.text || field.businessMeaning.language !== input.language);
    if (!fields.length) return snapshot;
    const described = await this.describeFields({ tableName: asset.name, ontologyTitle: snapshot.draft.title, businessGoal: snapshot.draft.businessGoal, language: input.language, fields });
    // Merge into the latest snapshot so a model response cannot overwrite edits made while it ran.
    const latest = this.database.getSnapshot(input.workspaceId);
    const current = latest?.assets.find((item) => item.id === asset.id);
    if (!latest || !current) throw new Error('ontology.studio.dataErrors.schemaUnavailable');
    if (current.name !== asset.name || JSON.stringify(current.fields.map(ontologyFieldSignature)) !== JSON.stringify(asset.fields.map(ontologyFieldSignature)) || latest.draft.title !== snapshot.draft.title || latest.draft.businessGoal !== snapshot.draft.businessGoal) {
      throw new Error('ontology.studio.dataErrors.schemaChanged');
    }
    const before = structuredClone(latest);
    const meanings = new Map(described.map((field) => [field.name, field.businessMeaning]));
    current.fields = current.fields.map((field) => (meanings.has(field.name) ? { ...field, businessMeaning: meanings.get(field.name) } : field));
    current.updatedAt = Date.now();
    this.database.saveSnapshot(latest, before);
    return latest;
  }

  async generateDraft(input: IOntologyGenerateDraftInput = {}) {
    const workspaceId = input.workspaceId?.trim() || (await this.getActiveWorkspaceId());
    if (this.generatingWorkspaces.has(workspaceId)) throw new Error('ontology.documentErrors.busy');
    const expectedSnapshot = this.database.getSnapshot(workspaceId);
    if (!expectedSnapshot) throw new Error('ontology.documentErrors.conflict');
    const assetIds = [...new Set(input.assetIds ?? expectedSnapshot.draft.selectedAssetIds)];
    const documentAssetIds = [...new Set([...(input.documentAssetIds ?? []), ...expectedSnapshot.assets.filter((asset) => assetIds.includes(asset.id) && asset.kind === 'document' && !asset.metadata.ontologyTemplate).map((asset) => asset.id)])];
    if (documentAssetIds.length === 0) return this.compileResult(this.engine.generateDraft(input, workspaceId));
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
      return await this.compileResult(this.engine.generateDraft({ ...input, assetIds, documentAssetIds, workspaceId, businessGoal }, workspaceId, { extraction, expectedSnapshot }));
    } finally {
      this.generatingWorkspaces.delete(workspaceId);
    }
  }

  async upsertObject(input: IOntologyObjectDraftInput) {
    return this.compileResult(this.engine.upsertObject(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async deleteObject(input: IOntologyDeleteInput) {
    return this.compileResult(this.engine.deleteObject(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async upsertAttribute(input: IOntologyAttributeDraftInput) {
    return this.compileResult(this.engine.upsertAttribute(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async deleteAttribute(input: IOntologyDeleteAttributeInput) {
    return this.compileResult(this.engine.deleteAttribute(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async upsertRelation(input: IOntologyRelationDraftInput) {
    return this.compileResult(this.engine.upsertRelation(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async deleteRelation(input: IOntologyDeleteInput) {
    return this.compileResult(this.engine.deleteRelation(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async executeRelation(input: IOntologyExecuteRuntimeInput): Promise<IOntologyRuntimeExecutionResult> {
    const workspaceId = input.workspaceId || (await this.getActiveWorkspaceId());
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const execution = await this.scripts.run(snapshot, 'relation', input);

    return { snapshot: await this.engine.getWorkbench(workspaceId), execution };
  }

  async upsertMapping(input: IOntologyFieldMappingInput) {
    return this.compileResult(this.engine.upsertMapping(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async deleteMapping(input: IOntologyDeleteInput) {
    return this.compileResult(this.engine.deleteMapping(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async upsertQualityRule(input: IOntologyQualityRuleInput) {
    return this.compileResult(this.engine.upsertQualityRule(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async deleteQualityRule(input: IOntologyDeleteInput) {
    return this.compileResult(this.engine.deleteQualityRule(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async upsertLogicFunction(input: IOntologyLogicFunctionInput) {
    return this.compileResult(this.engine.upsertLogicFunction(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async deleteLogicFunction(input: IOntologyDeleteInput) {
    return this.compileResult(this.engine.deleteLogicFunction(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async upsertAction(input: IOntologyActionDefinitionInput) {
    return this.compileResult(this.engine.upsertAction(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async deleteAction(input: IOntologyDeleteInput) {
    return this.compileResult(this.engine.deleteAction(input, input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async executeLogicFunction(input: IOntologyExecuteRuntimeInput): Promise<IOntologyRuntimeExecutionResult> {
    const workspaceId = input.workspaceId || (await this.getActiveWorkspaceId());
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const execution = await this.scripts.run(snapshot, 'logic', input);
    if (snapshot.logicFunctions.some((item) => item.id === execution.artifactId)) await this.engine.recordLogicFunctionExecution(execution.artifactId, execution.executedAt, workspaceId);
    return { snapshot: await this.engine.getWorkbench(workspaceId), execution };
  }

  async executeAction(input: IOntologyExecuteRuntimeInput): Promise<IOntologyRuntimeExecutionResult> {
    const workspaceId = input.workspaceId || (await this.getActiveWorkspaceId());
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const execution = await this.scripts.run(snapshot, 'action', input);
    if (snapshot.actions.some((item) => item.id === execution.artifactId)) await this.engine.recordActionExecution(execution.artifactId, execution.executedAt, workspaceId);
    for (const id of execution.executedFunctionIds || []) if (snapshot.logicFunctions.some((item) => item.id === id)) await this.engine.recordLogicFunctionExecution(id, execution.executedAt, workspaceId);
    return { snapshot: await this.engine.getWorkbench(workspaceId), execution };
  }

  async reviewTarget(input: IOntologyReviewTargetInput) {
    return this.engine.reviewTarget(input, input.workspaceId || (await this.getActiveWorkspaceId()));
  }

  async approveAll() {
    return this.engine.approveAll(await this.getActiveWorkspaceId());
  }

  async runConsistencyCheck(input?: IOntologySelectWorkbenchInput) {
    const workspaceId = input?.workspaceId ?? (await this.getActiveWorkspaceId());
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const structuralResult = await this.engine.runConsistencyCheck(workspaceId);
    const qualityRuleResults = await evaluateOntologyQualityRules(snapshot, async (asset) => {
      const connectorId = typeof asset.metadata.connectorId === 'string' ? asset.metadata.connectorId : undefined;
      const connector = connectorId ? snapshot.connectors.find((item) => item.id === connectorId) : undefined;
      return previewAsset(asset, connector, ONTOLOGY_QUALITY_RULE_SAMPLE_LIMIT);
    });
    const qualityRuleIssues = qualityRuleResults.flatMap((result) => qualityRuleIssue(result));
    const relationIssues = await evaluateRelationDataBindings(snapshot);
    const issues = [...structuralResult.issues, ...relationIssues, ...qualityRuleIssues];
    return {
      isValid: ontologyBlockingIssues({ issues }).length === 0,
      revision: snapshot.revision,
      checkedAt: Date.now(),
      issues,
      qualityRuleResults,
    };
  }

  async publishCurrentDraft(input?: IOntologySelectWorkbenchInput) {
    const workspaceId = input?.workspaceId ?? (await this.getActiveWorkspaceId());
    const expectedRevision = this.database.getSnapshot(workspaceId)?.revision;
    const check = await this.runConsistencyCheck({ workspaceId });
    if (ontologyBlockingIssues(check).length) throw new Error('ontology.studio.errors.publishBlocked');
    const submitted = await this.engine.publishCurrentDraft(workspaceId, expectedRevision);
    const parent =
      submitted.snapshot.publishedVersions.find((version) => version.isActive && version.status === 'published' && version.runtimeDigest && version.ontologyId) ||
      submitted.snapshot.publishedVersions.findLast((version) => version.status === 'published' && version.runtimeDigest && version.ontologyId);
    if (parent) submitted.version.snapshot.packageIdentity = { ontologyId: submitted.snapshot.packageIdentity?.ontologyId || parent.ontologyId!, source: { ontologyId: parent.ontologyId!, versionId: parent.id, version: parent.version, runtimeDigest: parent.runtimeDigest! } };
    const artifact = await this.scripts.build(submitted.snapshot, submitted.version.id);
    const before = this.database.getSnapshot(workspaceId);
    if (!before || !before.publishedVersions.some((version) => version.id === submitted.version.id && version.status === 'submitted')) throw new Error('ontology.studio.errors.conflict');
    const snapshot = structuredClone(before);
    snapshot.packageIdentity = { ...snapshot.packageIdentity, ontologyId: artifact.manifest.ontologyId };
    snapshot.publishedVersions = snapshot.publishedVersions.map((version) => (version.id === submitted.version.id ? { ...version, snapshot: submitted.version.snapshot, ontologyId: artifact.manifest.ontologyId, runtimeDigest: artifact.manifest.runtimeDigest } : version));
    this.database.saveSnapshot(snapshot, before);
    return { snapshot, version: snapshot.publishedVersions.find((version) => version.id === submitted.version.id)! };
  }

  async approvePublishedVersion(input: IOntologyPublishApprovalInput) {
    const workspaceId = input.workspaceId || (await this.getActiveWorkspaceId());
    const snapshot = await this.engine.getWorkbench(workspaceId);
    const artifact = await this.scripts.published(snapshot, input.versionId, false);
    return this.engine.approvePublishedVersion(input, workspaceId, artifact.manifest.runtimeDigest);
  }

  async rejectPublishedVersion(input: IOntologyRejectVersionInput) {
    return this.engine.rejectPublishedVersion(input, input.workspaceId ?? (input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async rollbackToVersion(input: IOntologyRollbackInput) {
    return this.engine.rollbackToVersion(input, input.workspaceId ?? (input.workspaceId || (await this.getActiveWorkspaceId())));
  }

  async createAgentBlueprint(input: IOntologyAgentBlueprintInput) {
    return this.agentRegistry.create(input, input.workspaceId || (await this.getActiveWorkspaceId()));
  }

  async registerAgentBlueprint(input: IOntologyRegisterAgentInput) {
    return this.agentRegistry.register(input, input.workspaceId || (await this.getActiveWorkspaceId()));
  }

  async deleteRegisteredAssistant(assistantId: string, category?: string): Promise<boolean> {
    if (category && category !== 'custom') return false;
    const installed = await assistantManager.getAssistantMetaWithDir(assistantId);
    if (installed && !installed.meta.ontologyBinding && !this.database.listSnapshots().some((snapshot) => snapshot.agentBlueprints.some((item) => item.registeredAssistantId === assistantId && item.registeredAt !== undefined))) return false;
    return this.agentRegistry.deleteByAssistant(assistantId);
  }

  /** Resolve locally registered business agents without treating them as remote catalog entries. */
  async getRegisteredAgentRuntime(assistantId: string) {
    const stored = this.database.listSnapshots().find((item) => item.agentBlueprints.some((agent) => agent.registeredAssistantId === assistantId));
    if (!stored) return undefined;
    const snapshot = await this.engine.getWorkbench(stored.workspaceId);
    const blueprint = snapshot.agentBlueprints.find((item) => item.registeredAssistantId === assistantId);
    const version = snapshot.publishedVersions.find((item) => item.id === blueprint?.ontologyVersionId && item.status === 'published');
    if (!blueprint || blueprint.status !== 'registered' || !version) throw new Error('ontology.studio.agentErrors.notFound');
    const installed = await this.getOwnedRegisteredAgent(blueprint, snapshot);
    if (!installed || !installed.meta.enabled) throw new Error('ontology.studio.agentErrors.notFound');
    const directory = await fs.realpath(installed.dir);
    const rulePath = await fs.realpath(path.resolve(directory, installed.meta.ruleFile || 'AGENT.md'));
    if (!rulePath.startsWith(directory + path.sep)) throw new Error('ontology.studio.agentErrors.identityConflict');
    const rules = await fs.readFile(rulePath, 'utf8');
    if (!rules.trim()) throw new Error('ontology.studio.agentErrors.notFound');
    const artifact = await this.scripts.published(snapshot, version.id);
    const bindingsPath = await this.scripts.writeBindings(artifact.bindings, blueprint.id);
    const command = ontologyCommand([path.join(artifact.directory, artifact.manifest.entrypoints.cli)]);
    const argumentsHint = ' --package ' + quoteOntologyArgument(artifact.directory) + ' --bindings ' + quoteOntologyArgument(bindingsPath);
    return {
      meta: installed.meta,
      directory,
      presetContext: rules + '\n\nUse the shell tool to execute the published ontology scripts. Start with: ' + command + ' list' + argumentsHint + '. Inspect inputs with describe, and invoke the selected capability with protocolVersion=1 and arguments as JSON on stdin. Never invent data.',
      command,
      argumentsHint,
      runtimeDigest: artifact.manifest.runtimeDigest,
    };
  }

  private async getOwnedRegisteredAgent(blueprint: IOntologyAgentBlueprint, snapshot: IOntologyWorkbenchSnapshot) {
    const installed = await assistantManager.getAssistantMetaWithDir(blueprint.registeredAssistantId!);
    if (!installed) return null;
    const ownership = { workspaceId: snapshot.workspaceId, versionId: blueprint.ontologyVersionId, blueprintId: blueprint.id };
    if (installed.category !== 'custom' || !isDeepStrictEqual(installed.meta.ontologyBinding, ownership)) throw new Error('ontology.studio.agentErrors.identityConflict');
    return installed;
  }

  private async installRegisteredAgent(blueprint: IOntologyAgentBlueprint, snapshot: IOntologyWorkbenchSnapshot): Promise<void> {
    const assistantId = blueprint.registeredAssistantId!;
    const version = snapshot.publishedVersions.find((item) => item.id === blueprint.ontologyVersionId && item.status === 'published');
    if (!version) throw new Error('ontology.studio.agentErrors.versionUnavailable');
    const ownership = { workspaceId: snapshot.workspaceId, versionId: version.id, blueprintId: blueprint.id };
    const installed = await this.getOwnedRegisteredAgent(blueprint, snapshot);
    const meta = {
      id: assistantId,
      nameI18n: { 'zh-CN': blueprint.name, 'en-US': blueprint.name },
      descriptionI18n: { 'zh-CN': `${snapshot.draft.title} · ${version.version}`, 'en-US': `${snapshot.draft.title} · ${version.version}` },
      avatar: '🧩',
      presetAgentType: DEFAULT_PRESET_AGENT_TYPE,
      enabled: false,
      source_type: 'custom' as const,
      ontologyBinding: ownership,
    };
    if (!installed) {
      const result = await assistantManager.createAssistant(meta, createAssistantRuleContent(blueprint, version.snapshot));
      if (!result.success) {
        if (!result.msg?.includes('already exists')) await assistantManager.uninstallAssistant(assistantId, 'custom');
        throw new Error(result.msg || 'ontology.studio.agentErrors.registrationFailed');
      }
    }
    await this.scripts.published(snapshot, version.id);
    const enabled = await assistantManager.enableAssistant(assistantId, 'custom');
    if (!enabled.success) throw new Error(enabled.msg || 'ontology.studio.agentErrors.registrationFailed');
  }

  async deleteAgentBlueprint(input: IOntologyDeleteInput) {
    return this.agentRegistry.delete(input.workspaceId || (await this.getActiveWorkspaceId()), input.id);
  }

  async resetWorkbench() {
    const workspaceId = await this.getActiveWorkspaceId();
    return this.agentRegistry.withLock(workspaceId, async () => {
      const currentSnapshot = await this.engine.getWorkbench(workspaceId);
      for (const blueprint of currentSnapshot.agentBlueprints.flatMap((item) => [item, ...(item.retiredRegistrations || [])])) {
        await this.uninstallRegisteredAgent(blueprint);
      }
      const snapshot = await this.engine.resetWorkbench(workspaceId);
      await acpDetector.refreshCustomAgents();
      this.database.setActiveWorkspaceId(snapshot.workspaceId);
      return snapshot;
    });
  }

  close() {
    void this.closeReviewSessions().catch((error) => mainError('OntologyService', 'Review host close failed', error));
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
      const scannedAssets = await scanConnectorAssets({ connector, maxAssets: 1000 }, asset.name);
      const scanned = scannedAssets.find((item) => item.path === asset.path) ?? scannedAssets.find((item) => item.name === asset.name);
      if (!scanned) throw new Error('ontology.studio.dataErrors.schemaUnavailable');
      return scanned;
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
    throw new Error('ontology.studio.dataErrors.schemaUnavailable');
  }

  private async uninstallRegisteredAgent(blueprint: Pick<IOntologyAgentBlueprint, 'id' | 'registeredAssistantId' | 'registeredAt'>): Promise<void> {
    if (!blueprint.registeredAssistantId) {
      return;
    }
    const installed = await assistantManager.getAssistantMetaWithDir(blueprint.registeredAssistantId);
    if (installed && (installed.category !== 'custom' || (installed.meta.ontologyBinding ? installed.meta.ontologyBinding.blueprintId !== blueprint.id : blueprint.registeredAt === undefined))) return;

    const result = await assistantManager.uninstallAssistant(blueprint.registeredAssistantId, 'custom');
    if (!result.success && result.msg !== 'Assistant not found') {
      throw new Error(result.msg || 'Failed to uninstall registered ontology Agent.');
    }
  }
}

export const ontologyService = new OntologyService();

function describeRuntimeRelationBinding(snapshot: IOntologyVersionSnapshot, relation: IOntologyRelationDraft): string {
  const binding = relation.dataBinding;
  if (!binding || binding.mode === 'semantic_only') return 'semantic-only';
  const fromObject = snapshot.objects.find((object) => object.id === relation.fromObjectId);
  const toObject = snapshot.objects.find((object) => object.id === relation.toObjectId);
  const junction = binding.junctionAssetId || 'junction';
  return binding.joinKeys
    .map((key) => {
      const fromCode = fromObject?.attributes.find((attribute) => attribute.id === key.fromAttributeId)?.code ?? key.fromAttributeId;
      const toCode = toObject?.attributes.find((attribute) => attribute.id === key.toAttributeId)?.code ?? key.toAttributeId;
      return binding.mode === 'direct' ? `${fromCode} = ${toCode}` : `${fromCode} = ${junction}.${key.junctionFromFieldName}; ${junction}.${key.junctionToFieldName} = ${toCode}`;
    })
    .join(' AND ');
}

function createAssistantRuleContent(blueprint: IOntologyAgentBlueprint, snapshot: IOntologyVersionSnapshot): string {
  const objectLines = snapshot.objects.map((object) => `- ${object.name} (${object.code}): ${object.description}\n  Attributes: ${object.attributes.map((attribute) => `${attribute.name}:${attribute.dataType}${attribute.required ? ' required' : ''}`).join(', ') || 'none'}`).join('\n');
  const objectNameById = new Map(snapshot.objects.map((object) => [object.id, object.name]));
  const relationLines = snapshot.relations
    .map(
      (relation) =>
        `- ${relation.name}: ${objectNameById.get(relation.fromObjectId) ?? relation.fromObjectId} -> ${objectNameById.get(relation.toObjectId) ?? relation.toObjectId} (${relation.cardinality}, ${relation.relationType}, ${relation.semanticType}); ${describeRuntimeRelationBinding(snapshot, relation)}`
    )
    .join('\n');
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
    'Use the published ontology scripts as the source of ontology semantics and executable capabilities.',
    `Ontology version ID: ${blueprint.ontologyVersionId}`,
    'Do not silently switch to another ontology version.',
    '',
    '## Business objects',
    '',
    objectLines || '- No objects.',
    '',
    '## Relations',
    '',
    relationLines || '- No relations.',
    '',
    '## Data mappings',
    '',
    mappingLines || '- No mappings.',
    '',
    '## Quality and business rules',
    '',
    ruleLines || '- No rules.',
    '',
    '## Logic functions',
    '',
    functionLines || '- No logic functions.',
    '',
    '## Actions',
    '',
    actionLines || '- No actions.',
    '',
    '## Available tools',
    '',
    toolLines || '- No tools.',
    '',
    'Do not answer domain questions from assumptions when the ontology tools can query or calculate the result.',
    'Ask for confirmation before invoking an action tool with side effects.',
    'Invoke the published script capabilities for grounded answers. Execute action capabilities only when the user explicitly requests the corresponding side effect.',
    'When answering, cite the ontology object, relation, mapping, rule, function, or action that supports the answer.',
  ].join('\n');
}

export { evaluateOntologyQualityRules } from '@sudowork/ontology-runtime/execution';
