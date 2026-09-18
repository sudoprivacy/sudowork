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
    relations: Array<Record<string, unknown> & { id: string; code: string; name: string; fromObjectId: string; toObjectId: string }>;
    mappings: Array<Record<string, unknown> & { objectId: string; attributeId: string }>;
    qualityRules: Array<Record<string, unknown> & { objectId: string }>;
    logicFunctions: Array<Record<string, unknown> & { id: string; code: string; name: string }>;
    actions: Array<Record<string, unknown> & { id: string; code: string; name: string }>;
  };
}

const exportFile = process.env.ONTOLOGY_EXPORT_FILE;
const requestedVersionId = process.env.ONTOLOGY_VERSION_ID;

const tools: Tool[] = [
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
    description: 'List logic functions available in the published ontology version.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ontology_list_actions',
    description: 'List action definitions available in the published ontology version. This tool describes actions but does not execute them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

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

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

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
      case 'ontology_list_actions':
        return textResult(version.snapshot.actions);
      default:
        throw new Error(`Unknown tool: ${request.params.name}.`);
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    };
  }
});

server.connect(new StdioServerTransport()).catch((error) => {
  console.error('[ontology-mcp] failed to start stdio transport:', error);
  process.exitCode = 1;
});
