import http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type {
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

interface IHandlerContext {
  workspaceId: string;
  input: Record<string, unknown>;
}

type Handler = (ctx: IHandlerContext) => Promise<unknown>;

/**
 * Loopback HTTP bridge that lets the `ontology-builder-mcp` subprocess call
 * back into the main-process `ontologyService` singleton. All routes are
 * simple POST + JSON. Auth via a per-launch bearer token; server binds to
 * 127.0.0.1 only, so it is never reachable from outside the machine.
 *
 * We keep the surface small: every write matches an existing `ontologyService`
 * method 1:1, which means anything the AI does through MCP goes through the
 * same code path as the manual workbench UI (including `workbenchChanged`
 * emitter → live UI refresh).
 */
let serverInstance: http.Server | null = null;
let bearerToken: string | null = null;
let boundPort: number | null = null;
type OntologyBridgeScope = { workspaceId: string; role: 'builder' } | { workspaceId: string; versionId: string; role: 'runtime' };
const scopedTokens = new Map<string, OntologyBridgeScope>();

const handlers: Record<string, Handler> = {
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

/**
 * Starts the loopback bridge if it isn't already running. Idempotent — the
 * MCP registration calls this before every install; repeat calls just return
 * the existing endpoint. Also returns the token so the caller can push it
 * into the MCP subprocess env.
 */
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
    const match = /^\/tool\/([a-zA-Z0-9_]+)$/.exec(url);
    if (!match) {
      writeJson(res, 404, { ok: false, message: 'Not found' });
      return;
    }
    const toolName = match[1];
    if (scoped?.role === 'runtime' && !['execute_logic_function', 'execute_relation', 'execute_action'].includes(toolName)) {
      writeJson(res, 403, { ok: false, message: 'Published ontology agents can only execute their version-bound capabilities.' });
      return;
    }
    if (scoped?.role === 'builder' && ['execute_action', 'approve_all', 'publish_current_draft', 'register_agent_blueprint'].includes(toolName)) {
      writeJson(res, 403, { ok: false, message: 'This operation requires the workbench review or execution interface.' });
      return;
    }
    const handler = handlers[toolName];
    if (!handler) {
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
    if (scoped?.role === 'runtime') {
      if ((input.workspaceId && input.workspaceId !== scoped.workspaceId) || (input.versionId && input.versionId !== scoped.versionId)) {
        writeJson(res, 403, { ok: false, message: 'Published ontology version scope mismatch.' });
        return;
      }
      input.versionId = scoped.versionId;
    }
    if (scoped?.role === 'builder' && toolName === 'execute_logic_function') {
      const snapshot = await ontologyService.getWorkbench({ workspaceId });
      const fn = snapshot.logicFunctions.find((item) => (input.id ? item.id === input.id : item.code === input.code));
      if (fn && fn.runtime !== 'sql' && fn.configuration.builtIn !== 'lookup') {
        writeJson(res, 403, { ok: false, message: 'Builder validation only executes read-only queries.' });
        return;
      }
    }
    if (scoped) await ontologyService.getWorkbench({ workspaceId });
    const data = await handler({ workspaceId, input: { ...input, workspaceId } });
    const changed = data && typeof data === 'object' && 'snapshot' in data ? data.snapshot : data;
    if (toolName !== 'get_snapshot' && changed && typeof changed === 'object' && 'workspaceId' in changed && 'objects' in changed) ipcBridge.ontology.workbenchChanged.emit(redactOntologySecrets(changed as import('@sudowork/ontology-common').IOntologyWorkbenchSnapshot));
    if (scoped?.role === 'runtime') {
      if (!data || typeof data !== 'object' || !('execution' in data)) throw new Error('Ontology runtime returned no execution result.');
      writeJson(res, 200, { ok: true, data: { workspaceId, versionId: scoped.versionId, execution: data.execution } });
      return;
    }
    writeJson(res, 200, { ok: true, data: summarizeResult(data, input) });
  } catch (err) {
    mainError('OntologyWriteBridge', 'request failed', err);
    writeJson(res, 500, { ok: false, message: err instanceof Error ? err.message : String(err) });
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
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
