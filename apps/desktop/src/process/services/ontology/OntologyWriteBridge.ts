import http from 'node:http';
import { Notification } from 'electron';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type {
  IOntologyConnectSourceInput,
  IOntologyActionDefinitionInput,
  IOntologyAgentBlueprintInput,
  IOntologyAttributeDraftInput,
  IOntologyDeleteAttributeInput,
  IOntologyDeleteInput,
  IOntologyExecuteRuntimeInput,
  IOntologyFieldMappingInput,
  IOntologyLogicFunctionInput,
  IOntologyObjectDraftInput,
  IOntologyQualityRuleInput,
  IOntologyRegisterAgentInput,
  IOntologyRelationDraftInput,
} from '@sudowork/ontology-common';
import { ipcBridge } from '@/common';
import { mainError, mainLog } from '@process/utils/mainLogger';
import { ontologyService } from '@process/services/ontology/OntologyService';
import { redactOntologySecrets } from './ontologySnapshot';
import { SudographCompilerError } from './SudographModelClient';
import { ontologyProjectCommands } from './ontologyProjectCommands';

interface IHandlerContext {
  workspaceId: string;
  input: Record<string, unknown>;
}

type Handler = (ctx: IHandlerContext) => Promise<unknown>;

/**
 * Loopback HTTP bridge that lets the ontology project CLI call
 * back into the main-process `ontologyService` singleton. All routes are
 * simple POST + JSON. Auth via a per-launch bearer token; server binds to
 * 127.0.0.1 only, so it is never reachable from outside the machine.
 *
 * We keep the surface small: every write matches an existing `ontologyService`
 * method 1:1, which means anything the AI does through the script protocol goes through the
 * same code path as the manual workbench UI (including `workbenchChanged`
 * emitter → live UI refresh).
 */
let serverInstance: http.Server | null = null;
let bearerToken: string | null = null;
let boundPort: number | null = null;
type OntologyBridgeScope = { workspaceId: string; role: 'builder' | 'notification' };
const scopedTokens = new Map<string, OntologyBridgeScope>();
const notificationTokens = new Map<string, string>();

export async function ontologyDesktopNotificationBinding(workspaceId: string) {
  const bridge = await ensureOntologyWriteBridge();
  let token = notificationTokens.get(workspaceId);
  if (!token) {
    token = randomBytes(24).toString('hex');
    scopedTokens.set(token, { workspaceId, role: 'notification' });
    notificationTokens.set(workspaceId, token);
  }
  return { url: 'http://127.0.0.1:' + bridge.port + '/notification', headers: { Authorization: 'Bearer ' + token } };
}

const handlers: Record<string, Handler> = {
  register_source: async ({ input }) => {
    const project = await ontologyService.connectStudioSource(input as unknown as IOntologyConnectSourceInput);
    return { ...project, open_path: `/app/ontology/${encodeURIComponent(project.workspaceId)}/model` };
  },
  preview_asset: async ({ workspaceId, input }) => ontologyService.previewAsset({ workspaceId, id: String(input.id || ''), limit: typeof input.limit === 'number' ? input.limit : 20 }),
  get_snapshot: async ({ workspaceId }) => ontologyService.getWorkbench({ workspaceId }),
  update_draft: async ({ input }) => ontologyService.updateDraft(sanitize(input, ['title', 'description', 'businessGoal', 'selectedAssetIds'])),
  upsert_object: async ({ input }) => ontologyService.upsertObject(sanitize(input, ['id', 'code', 'name', 'description', 'tier', 'status', 'namespace', 'sourceAssetIds']) as unknown as IOntologyObjectDraftInput),
  delete_object: async ({ input }) => ontologyService.deleteObject(sanitize(input, ['id']) as unknown as IOntologyDeleteInput),
  upsert_attribute: async ({ input }) => ontologyService.upsertAttribute(sanitize(input, ['id', 'objectId', 'code', 'name', 'dataType', 'required', 'description', 'example', 'constraints', 'mappedField']) as unknown as IOntologyAttributeDraftInput),
  delete_attribute: async ({ input }) => ontologyService.deleteAttribute(sanitize(input, ['objectId', 'attributeId']) as unknown as IOntologyDeleteAttributeInput),
  upsert_relation: async ({ input }) => ontologyService.upsertRelation(sanitize(input, ['id', 'code', 'name', 'fromObjectId', 'toObjectId', 'cardinality', 'relationType', 'semanticType', 'dataBinding', 'isAcyclic', 'description']) as unknown as IOntologyRelationDraftInput),
  delete_relation: async ({ input }) => ontologyService.deleteRelation(sanitize(input, ['id']) as unknown as IOntologyDeleteInput),
  upsert_mapping: async ({ input }) => ontologyService.upsertMapping(sanitize(input, ['id', 'objectId', 'attributeId', 'assetId', 'fieldName', 'confidence', 'strategy', 'status']) as unknown as IOntologyFieldMappingInput),
  delete_mapping: async ({ input }) => ontologyService.deleteMapping(sanitize(input, ['id']) as unknown as IOntologyDeleteInput),
  upsert_quality_rule: async ({ input }) => ontologyService.upsertQualityRule(sanitize(input, ['id', 'objectId', 'code', 'name', 'expression', 'severity', 'status']) as unknown as IOntologyQualityRuleInput),
  delete_quality_rule: async ({ input }) => ontologyService.deleteQualityRule(sanitize(input, ['id']) as unknown as IOntologyDeleteInput),
  upsert_logic_function: async ({ input }) => ontologyService.upsertLogicFunction(sanitize(input, ['id', 'code', 'name', 'description', 'runtime', 'objectIds', 'signature', 'body', 'returnType', 'parameters', 'configuration', 'status']) as unknown as IOntologyLogicFunctionInput),
  delete_logic_function: async ({ input }) => ontologyService.deleteLogicFunction(sanitize(input, ['id']) as unknown as IOntologyDeleteInput),
  upsert_action: async ({ input }) => ontologyService.upsertAction(sanitize(input, ['id', 'code', 'name', 'executor', 'objectIds', 'description', 'configuration', 'parameters', 'outputSchema', 'status']) as unknown as IOntologyActionDefinitionInput),
  delete_action: async ({ input }) => ontologyService.deleteAction(sanitize(input, ['id']) as unknown as IOntologyDeleteInput),
  execute_logic_function: async ({ workspaceId, input }) =>
    ontologyService.executeLogicFunction({
      ...(sanitize(input, ['id', 'code', 'versionId', 'arguments']) as unknown as IOntologyExecuteRuntimeInput),
      workspaceId,
    }),
  execute_relation: async ({ workspaceId, input }) =>
    ontologyService.executeRelation({
      ...(sanitize(input, ['id', 'code', 'versionId', 'arguments']) as unknown as IOntologyExecuteRuntimeInput),
      workspaceId,
    }),
  execute_action: async ({ workspaceId, input }) =>
    ontologyService.executeAction({
      ...(sanitize(input, ['id', 'code', 'versionId', 'arguments']) as unknown as IOntologyExecuteRuntimeInput),
      workspaceId,
    }),
  generate_draft_from_assets: async ({ input }) => ontologyService.generateDraft(sanitize(input, ['assetIds', 'businessGoal', 'mode'])),
  approve_all: async () => ontologyService.approveAll(),
  run_consistency_check: async ({ workspaceId }) => ontologyService.runConsistencyCheck({ workspaceId }),
  publish_current_draft: async ({ workspaceId }) => ontologyService.publishCurrentDraft({ workspaceId }),
  create_agent_blueprint: async ({ input }) => ontologyService.createAgentBlueprint(sanitize(input, ['name', 'ontologyVersionId', 'workspaceId', 'promptTemplate']) as unknown as IOntologyAgentBlueprintInput),
  register_agent_blueprint: async ({ input }) => ontologyService.registerAgentBlueprint(sanitize(input, ['blueprintId', 'assistantId', 'name', 'workspaceId']) as unknown as IOntologyRegisterAgentInput),
};

function sanitize(input: Record<string, unknown>, allowedKeys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = input.workspaceId ? { workspaceId: input.workspaceId } : {};
  for (const key of allowedKeys) {
    if (input[key] !== undefined) output[key] = input[key];
  }
  return output;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export async function ensureOntologyWriteBridge(scope?: OntologyBridgeScope): Promise<{ port: number; token: string }> {
  if (scope) {
    const bridge = await ensureOntologyWriteBridge();
    const token = randomBytes(24).toString('hex');
    scopedTokens.set(token, scope);
    return { port: bridge.port, token };
  }
  if (serverInstance && bearerToken && boundPort) {
    return { port: boundPort, token: bearerToken };
  }
  bearerToken = randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        reject(new Error('Failed to allocate loopback port for ontology write bridge.'));
        return;
      }
      boundPort = address.port;
      resolve();
    });
  });
  serverInstance = server;
  server.unref();
  mainLog('OntologyWriteBridge', `listening on 127.0.0.1:${boundPort}`);
  return { port: boundPort!, token: bearerToken };
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, message: 'Method not allowed' });
      return;
    }
    const auth = req.headers['authorization'];
    const scoped = typeof auth === 'string' ? scopedTokens.get(auth.replace(/^Bearer /, '')) : undefined;
    if (!scoped && (!bearerToken || auth !== `Bearer ${bearerToken}`)) {
      writeJson(res, 401, { ok: false, message: 'Unauthorized' });
      return;
    }
    const url = req.url ?? '';
    if (scoped?.role === 'notification') {
      if (url !== '/notification') {
        writeJson(res, 403, { ok: false, message: 'This binding only authorizes desktop notifications.' });
        return;
      }
      const payload = JSON.parse(await readBody(req)) as { title?: string; message?: string };
      if (typeof payload.title !== 'string' || typeof payload.message !== 'string' || payload.title.length > 1000 || payload.message.length > 64_000 || !Notification.isSupported()) throw new Error('Desktop notifications are unavailable or invalid.');
      new Notification({ title: payload.title, body: payload.message }).show();
      writeJson(res, 200, { delivered: true, title: payload.title, message: payload.message });
      return;
    }
    if (url === '/commands') {
      if (!scoped || scoped.role !== 'builder') {
        writeJson(res, 403, { ok: false, message: 'A project-scoped authoring context is required.' });
        return;
      }
      writeJson(res, 200, { ok: true, data: { commands: ontologyProjectCommands(ontologyService.getModelAuthority(scoped.workspaceId)) } });
      return;
    }
    const match = /^\/tool\/([a-zA-Z0-9_]+)$/.exec(url);
    if (!match) {
      writeJson(res, 404, { ok: false, message: 'Not found' });
      return;
    }
    const toolName = match[1];
    if (scoped?.role === 'builder' && ['execute_action', 'approve_all', 'publish_current_draft', 'register_agent_blueprint'].includes(toolName)) {
      writeJson(res, 403, { ok: false, message: 'This operation requires the workbench review or execution interface.' });
      return;
    }
    const handler = handlers[toolName];
    const isSudographTool = ['sudograph_contract', 'sudograph_apply', 'sudograph_context', 'sudograph_context_read'].includes(toolName);
    if (!handler && !isSudographTool) {
      writeJson(res, 404, { ok: false, message: `Unknown tool: ${toolName}` });
      return;
    }
    const bodyText = await readBody(req);
    const body = bodyText ? (JSON.parse(bodyText) as { workspaceId?: string; input?: Record<string, unknown> }) : {};
    if (scoped && body.workspaceId && body.workspaceId !== scoped.workspaceId) {
      writeJson(res, 403, { ok: false, message: 'Ontology scope mismatch.' });
      return;
    }
    const workspaceId = scoped?.workspaceId || (typeof body.workspaceId === 'string' && body.workspaceId ? body.workspaceId : await resolveActiveWorkspaceId());
    const input = (body.input && typeof body.input === 'object' ? body.input : {}) as Record<string, unknown>;
    if (toolName === 'register_source') {
      // Source intake owns its own registry and compiler checks. It must not
      // enter the legacy RDF snapshot guard for a canonical model conversation.
      const data = await handler({ workspaceId, input });
      writeJson(res, 200, { ok: true, data });
      return;
    }
    if (isSudographTool) {
      if (scoped?.role !== 'builder' || ontologyService.getModelAuthority(workspaceId) !== 'sudograph') {
        writeJson(res, 403, { ok: false, message: 'Sudograph tools require a session bound to its registered model.' });
        return;
      }
      let request: Record<string, unknown>;
      if (toolName === 'sudograph_apply' || toolName === 'sudograph_context_read') request = { operation: toolName === 'sudograph_apply' ? 'apply' : 'context_read', request: input };
      else {
        if (Object.keys(input).length) throw new Error('This operation accepts no arguments.');
        request = toolName === 'sudograph_contract' ? { operation: 'contract' } : { operation: 'read', product: 'context' };
      }
      const data = await ontologyService.invokeSudograph<Record<string, unknown>>(workspaceId, request);
      if (toolName === 'sudograph_apply') ipcBridge.ontology.modelChanged.emit({ workspaceId, revision: String(data.revision), contextDigest: String(data.context_digest) });
      writeJson(res, 200, { ok: true, data });
      return;
    }
    if (scoped?.role === 'builder' && toolName === 'execute_logic_function') {
      const snapshot = await ontologyService.getWorkbench({ workspaceId });
      const fn = snapshot.logicFunctions.find((item) => (input.id ? item.id === input.id : item.code === input.code));
      if (fn && fn.runtime !== 'sql' && fn.configuration.builtIn !== 'lookup') {
        writeJson(res, 403, { ok: false, message: 'Builder validation only executes read-only queries.' });
        return;
      }
    }
    if (scoped?.role === 'builder' && toolName === 'upsert_action') {
      const snapshot = await ontologyService.getWorkbench({ workspaceId });
      const existing = snapshot.actions.find((item) => item.id === input.id);
      if ((input.executor || existing?.executor) === 'custom_script') {
        const configuration = { ...existing?.configuration, ...(input.configuration && typeof input.configuration === 'object' ? input.configuration : {}) };
        const allowed = new Set([
          ...snapshot.assets.flatMap((asset) => (asset.path ? [path.resolve(asset.path)] : [])),
          ...(Array.isArray(existing?.configuration.args) ? existing.configuration.args.filter((argument): argument is string => typeof argument === 'string' && path.isAbsolute(argument)).map((argument) => path.resolve(argument)) : []),
        ]);
        const args = Array.isArray(configuration.args) ? configuration.args : [];
        if (args.some((argument) => typeof argument === 'string' && /\.(?:m?js|cjs|py|sh)$/.test(argument) && !argument.includes('{{') && !allowed.has(path.resolve(argument)))) {
          writeJson(res, 403, { ok: false, message: 'Import script files into this project before referencing them from generated actions.' });
          return;
        }
      }
    }
    if (scoped) await ontologyService.getWorkbench({ workspaceId });
    const data = await handler!({ workspaceId, input: { ...input, workspaceId } });
    const changed = data && typeof data === 'object' && 'snapshot' in data ? data.snapshot : data;
    if (toolName !== 'get_snapshot' && changed && typeof changed === 'object' && 'workspaceId' in changed && 'objects' in changed) ipcBridge.ontology.workbenchChanged.emit(redactOntologySecrets(changed as import('@sudowork/ontology-common').IOntologyWorkbenchSnapshot));
    writeJson(res, 200, { ok: true, data: summarizeResult(data, input) });
  } catch (err) {
    mainError('OntologyWriteBridge', 'request failed', err);
    writeJson(res, err instanceof SudographCompilerError ? 409 : 500, { ok: false, message: err instanceof Error ? err.message : String(err), ...(err instanceof SudographCompilerError ? { code: err.code, recovery: err.recovery } : {}) });
  }
}

async function resolveActiveWorkspaceId(): Promise<string> {
  const summary = await ontologyService.listWorkbenches();
  return summary.activeWorkspaceId || summary.items[0]?.workspaceId || 'default';
}

function summarizeResult(data: unknown, input: Record<string, unknown> = {}): unknown {
  // Snapshots are enormous; return only counts + top-level lists so the LLM
  // context doesn't balloon. Anything that isn't a snapshot passes through.
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;
  const isSnapshot = 'stats' in record && 'draft' in record && 'objects' in record;
  const inner = 'snapshot' in record && record.snapshot && typeof record.snapshot === 'object' && 'stats' in (record.snapshot as Record<string, unknown>);
  const target = isSnapshot ? record : inner ? (record.snapshot as Record<string, unknown>) : null;
  if (!target) return data;
  const objects = Array.isArray(target.objects) ? (target.objects as Array<Record<string, unknown>>) : [];
  const relations = Array.isArray(target.relations) ? (target.relations as Array<Record<string, unknown>>) : [];
  const offset = typeof input.offset === 'number' ? Math.max(0, Math.floor(input.offset)) : 0;
  const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(100, Math.floor(input.limit))) : 30;
  return {
    totalObjects: objects.length,
    totalRelations: relations.length,
    offset,
    limit,
    hasMore: offset + limit < Math.max(objects.length, relations.length),
    logicFunctions: target.logicFunctions,
    workspaceId: target.workspaceId,
    revision: target.revision,
    assets: target.assets,
    stats: target.stats,
    draft: target.draft,
    objects: objects.slice(offset, offset + limit).map((obj) => ({
      id: obj.id,
      iri: obj.iri,
      code: obj.code,
      name: obj.name,
      tier: obj.tier,
      reviewDecision: obj.reviewDecision,
      attributes: Array.isArray(obj.attributes) ? (obj.attributes as Array<Record<string, unknown>>).map((attr) => ({ id: attr.id, code: attr.code, name: attr.name, dataType: attr.dataType, required: attr.required, iri: attr.iri, mappedField: attr.mappedField })) : [],
    })),
    relations: relations.slice(offset, offset + limit).map((rel) => ({
      id: rel.id,
      code: rel.code,
      name: rel.name,
      fromObjectId: rel.fromObjectId,
      toObjectId: rel.toObjectId,
      cardinality: rel.cardinality,
      relationType: rel.relationType,
      semanticType: rel.semanticType,
      dataBinding: rel.dataBinding,
    })),
    ...('version' in record ? { publishedVersion: record.version } : {}),
    ...('blueprint' in record ? { blueprint: record.blueprint } : {}),
    ...('execution' in record ? { execution: record.execution } : {}),
  };
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

/** Release the local bridge and all session-scoped credentials. */
export async function closeOntologyWriteBridge(): Promise<void> {
  const server = serverInstance;
  serverInstance = null;
  bearerToken = null;
  boundPort = null;
  scopedTokens.clear();
  notificationTokens.clear();
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
