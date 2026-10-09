import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';

interface IOntologyExport {
  workspaceId: string;
  title: string;
  description: string;
  updatedAt: number;
  versions: IOntologyExportVersion[];
}

interface IOntologyExportVersion {
  id: string;
  version: string;
  status: string;
  isActive: boolean;
  summary: string;
  snapshot: {
    objects: Array<Record<string, unknown> & { id: string; code: string; name: string; description: string }>;
    relations: IRuntimeRelation[];
    mappings: Array<Record<string, unknown> & { objectId: string; attributeId: string }>;
    qualityRules: Array<Record<string, unknown> & { objectId: string }>;
    logicFunctions: IRuntimeArtifact[];
    actions: IRuntimeArtifact[];
  };
}

interface IRuntimeParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

interface IRuntimeArtifact extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  description?: string;
  status?: string;
  executor?: string;
  parameters?: IRuntimeParameter[];
}

interface IRuntimeRelation extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  fromObjectId: string;
  toObjectId: string;
  dataBinding?: { mode?: string };
}

const exportFile = process.env.ONTOLOGY_EXPORT_FILE;
const requestedVersionId = process.env.ONTOLOGY_VERSION_ID;
const runtimeBaseUrl = process.env.ONTOLOGY_RUNTIME_BASE_URL;
const runtimeToken = process.env.ONTOLOGY_RUNTIME_TOKEN;
const workspaceId = process.env.ONTOLOGY_WORKSPACE_ID;

const baseTools: Tool[] = [
  {
    name: 'ontology_get_overview',
    description: 'Return the published ontology version, object/relation counts, and available logic and actions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ontology_search',
    description: 'Search published ontology objects, relations, logic functions, actions, and quality rules.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive name, code, or description query.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_get_object',
    description: 'Return one ontology object with attributes, relations, mappings, and quality rules.',
    inputSchema: {
      type: 'object',
      properties: { id_or_code: { type: 'string', description: 'Object id or object code.' } },
      required: ['id_or_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_list_logic',
    description: 'List logic functions available in the published ontology version. Active functions are also exposed as logic_* tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ontology_list_relations',
    description: 'List published ontology relations, including cardinality, semantics, and executable field bindings.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ontology_list_actions',
    description: 'List action definitions available in the published ontology version. Active actions are also exposed as action_* tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function runtimeTools(version: IOntologyExportVersion): Tool[] {
  return [
    ...version.snapshot.logicFunctions.filter((item) => item.status !== 'disabled' && item.status !== 'draft').map((item) => runtimeTool('logic', item)),
    ...version.snapshot.actions.filter((item) => item.status !== 'disabled' && item.status !== 'draft').map((item) => runtimeTool('action', item)),
    ...version.snapshot.relations.filter((item) => item.dataBinding?.mode === 'direct' || item.dataBinding?.mode === 'junction').map(relationRuntimeTool),
  ];
}

function relationRuntimeTool(relation: IRuntimeRelation): Tool {
  return {
    name: `relation_${relation.code}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    description: `Traverse ${relation.name} through its configured field-level join.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'object', description: 'Optional filters for the starting object.' },
        direction: { type: 'string', enum: ['forward', 'reverse'], default: 'forward' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        maxDepth: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  };
}

function runtimeTool(kind: 'logic' | 'action', artifact: IRuntimeArtifact): Tool {
  const parameters = artifact.parameters ?? [];
  return {
    name: `${kind}_${artifact.code}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    description: artifact.description || artifact.name,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        parameters.map((parameter) => [
          parameter.name,
          {
            ...jsonSchemaForType(parameter.type),
            ...(parameter.description ? { description: parameter.description } : {}),
          },
        ])
      ),
      required: parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name),
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: kind === 'logic',
      destructiveHint: kind === 'action' && artifact.executor !== 'notification',
    },
  };
}

function jsonSchemaForType(type: string): Record<string, unknown> {
  const normalized = type.trim().toLowerCase();
  if (normalized === 'unknown' || normalized === 'any') return {};
  if (normalized.endsWith('[]') || normalized === 'array') return { type: 'array' };
  if (normalized === 'object' || normalized.includes('record')) return { type: 'object' };
  if (normalized === 'number' || normalized === 'integer' || normalized === 'boolean') return { type: normalized };
  return { type: 'string' };
}

function loadOntology(): { root: IOntologyExport; version: IOntologyExportVersion } {
  if (!exportFile) throw new Error('ONTOLOGY_EXPORT_FILE is not configured.');
  const root = JSON.parse(readFileSync(exportFile, 'utf8')) as IOntologyExport;
  const version = requestedVersionId ? root.versions.find((item) => item.id === requestedVersionId) : root.versions.find((item) => item.isActive);
  if (!version || version.status !== 'published') throw new Error('The requested published ontology version is unavailable.');
  return { root, version };
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `<ontology-data>\n${JSON.stringify(value, null, 2)}\n</ontology-data>`,
      },
    ],
  };
}

function searchableItems(version: IOntologyExportVersion): Array<Record<string, unknown>> {
  return [
    ...version.snapshot.objects.map((item) => ({ kind: 'object', ...item })),
    ...version.snapshot.relations.map((item) => ({ kind: 'relation', ...item })),
    ...version.snapshot.logicFunctions.map((item) => ({ kind: 'logic', ...item })),
    ...version.snapshot.actions.map((item) => ({ kind: 'action', ...item })),
    ...version.snapshot.qualityRules.map((item) => ({ kind: 'quality_rule', ...item })),
  ];
}

const server = new Server({ name: 'sudowork-ontology', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { version } = loadOntology();
  return { tools: [...baseTools, ...runtimeTools(version)] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { root, version } = loadOntology();
    const input = request.params.arguments ?? {};
    switch (request.params.name) {
      case 'ontology_get_overview':
        return textResult({
          workspaceId: root.workspaceId,
          title: root.title,
          description: root.description,
          version: version.version,
          summary: version.summary,
          counts: {
            objects: version.snapshot.objects.length,
            relations: version.snapshot.relations.length,
            logicFunctions: version.snapshot.logicFunctions.length,
            actions: version.snapshot.actions.length,
            qualityRules: version.snapshot.qualityRules.length,
          },
        });
      case 'ontology_search': {
        const query = String(input.query ?? '')
          .trim()
          .toLowerCase();
        if (!query) throw new Error('query is required.');
        const limit = Math.max(1, Math.min(Number(input.limit) || 20, 100));
        return textResult(
          searchableItems(version)
            .filter((item) => JSON.stringify(item).toLowerCase().includes(query))
            .slice(0, limit)
        );
      }
      case 'ontology_get_object': {
        const idOrCode = String(input.id_or_code ?? '').trim();
        const object = version.snapshot.objects.find((item) => item.id === idOrCode || item.code === idOrCode);
        if (!object) throw new Error(`Ontology object not found: ${idOrCode}.`);
        return textResult({
          object,
          relations: version.snapshot.relations.filter((item) => item.fromObjectId === object.id || item.toObjectId === object.id),
          mappings: version.snapshot.mappings.filter((item) => item.objectId === object.id),
          qualityRules: version.snapshot.qualityRules.filter((item) => item.objectId === object.id),
        });
      }
      case 'ontology_list_logic':
        return textResult(version.snapshot.logicFunctions);
      case 'ontology_list_relations':
        return textResult(version.snapshot.relations);
      case 'ontology_list_actions':
        return textResult(version.snapshot.actions);
      default: {
        const logicFunction = version.snapshot.logicFunctions.find((item) => `logic_${item.code}`.replace(/[^a-zA-Z0-9_-]/g, '_') === request.params.name);
        if (logicFunction) return textResult(await callRuntime('execute_logic_function', logicFunction.id, input));
        const action = version.snapshot.actions.find((item) => `action_${item.code}`.replace(/[^a-zA-Z0-9_-]/g, '_') === request.params.name);
        if (action) return textResult(await callRuntime('execute_action', action.id, input));
        const relation = version.snapshot.relations.find((item) => `relation_${item.code}`.replace(/[^a-zA-Z0-9_-]/g, '_') === request.params.name);
        if (relation) return textResult(await callRuntime('execute_relation', relation.id, input));
        throw new Error(`Unknown tool: ${request.params.name}.`);
      }
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    };
  }
});

async function callRuntime(route: 'execute_logic_function' | 'execute_relation' | 'execute_action', id: string, args: Record<string, unknown>): Promise<unknown> {
  if (!runtimeBaseUrl || !runtimeToken || !workspaceId) throw new Error('Ontology runtime bridge is unavailable. Re-register this Agent.');
  const response = await fetch(`${runtimeBaseUrl}/tool/${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${runtimeToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, input: { id, versionId: requestedVersionId, arguments: args } }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json()) as { ok?: boolean; data?: unknown; message?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.message || `Ontology runtime returned HTTP ${response.status}.`);
  return payload.data;
}

server.connect(new StdioServerTransport()).catch((error) => {
  console.error('[ontology-mcp] failed to start stdio transport:', error);
  process.exitCode = 1;
});
