/*
 * @license
 * Copyright 2026 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ontology builder MCP server — write access.
 *
 * All tool calls forward to the main-process loopback bridge (see
 * OntologyWriteBridge.ts). We never talk to SQLite directly from here so
 * every change goes through the same ontologyService methods the workbench
 * UI uses, which means `workbenchChanged` fires and the UI refreshes live.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';

const baseUrl = process.env.ONTOLOGY_WRITE_BASE_URL;
const token = process.env.ONTOLOGY_WRITE_TOKEN;
const envWorkspaceId = process.env.ONTOLOGY_WORKSPACE_ID;

if (!baseUrl || !token) {
  console.error('[ontology-builder-mcp] ONTOLOGY_WRITE_BASE_URL and ONTOLOGY_WRITE_TOKEN are required');
  process.exit(1);
}

const objectIdArg = { type: 'string', description: 'Ontology object id (obtained from ontology_get_snapshot).' };

const tools: Tool[] = [
  {
    name: 'ontology_get_snapshot',
    description: 'Read the current ontology draft state (objects, relations, attributes, mappings, stats). Call this at the start of every session and whenever you need to know current ids/codes.',
    inputSchema: {
      type: 'object',
      properties: { workspace_id: { type: 'string', description: 'Optional; defaults to the active workspace.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_update_draft',
    description: 'Update the workbench metadata (title / description / business goal / selected assets).',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        businessGoal: { type: 'string' },
        selectedAssetIds: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_upsert_object',
    description: 'Create or update an ontology object (entity). Omit id to create; pass id to update.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        id: { type: 'string' },
        code: { type: 'string', description: 'snake_case code, e.g. project.' },
        name: { type: 'string', description: 'Human-readable name.' },
        description: { type: 'string' },
        tier: { type: 'integer', enum: [1, 2, 3], description: '1 = core, 3 = leaf.' },
        namespace: { type: 'string' },
        sourceAssetIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_upsert_attribute',
    description: 'Create or update an attribute on an object.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        id: { type: 'string' },
        objectId: objectIdArg,
        code: { type: 'string' },
        name: { type: 'string' },
        dataType: { type: 'string', description: 'string / number / boolean / date / json / uuid …' },
        required: { type: 'boolean' },
        description: { type: 'string' },
        example: { type: 'string' },
        mappedField: {
          type: 'object',
          properties: {
            assetId: { type: 'string' },
            fieldName: { type: 'string' },
          },
          required: ['assetId', 'fieldName'],
          additionalProperties: false,
        },
      },
      required: ['objectId', 'name', 'dataType'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_upsert_relation',
    description: 'Create or update a relation between two objects.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        id: { type: 'string' },
        code: { type: 'string' },
        name: { type: 'string' },
        fromObjectId: { type: 'string' },
        toObjectId: { type: 'string' },
        cardinality: { type: 'string', enum: ['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'] },
        relationType: { type: 'string', enum: ['object_property'] },
        semanticType: { type: 'string', enum: ['association'] },
        dataBinding: {
          type: 'object',
          description: 'Optional executable join binding. Use semantic_only when the relation has no physical data join.',
          properties: {
            mode: { type: 'string', enum: ['semantic_only', 'direct', 'junction'] },
            junctionAssetId: { type: 'string' },
            joinKeys: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  fromAttributeId: { type: 'string' },
                  toAttributeId: { type: 'string' },
                  junctionFromFieldName: { type: 'string' },
                  junctionToFieldName: { type: 'string' },
                },
                required: ['fromAttributeId', 'toAttributeId'],
                additionalProperties: false,
              },
            },
          },
          required: ['mode', 'joinKeys'],
          additionalProperties: false,
        },
        isAcyclic: { type: 'boolean' },
        description: { type: 'string' },
      },
      required: ['name', 'fromObjectId', 'toObjectId', 'cardinality'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_upsert_mapping',
    description: 'Bind an object attribute to a concrete asset field.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        id: { type: 'string' },
        objectId: objectIdArg,
        attributeId: { type: 'string' },
        assetId: { type: 'string' },
        fieldName: { type: 'string' },
        confidence: { type: 'number' },
        strategy: { type: 'string', enum: ['exact', 'normalized', 'ai_suggested', 'manual'] },
      },
      required: ['objectId', 'attributeId', 'assetId', 'fieldName'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_upsert_quality_rule',
    description: 'Add a data-quality rule for an object.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        id: { type: 'string' },
        objectId: objectIdArg,
        code: { type: 'string' },
        name: { type: 'string' },
        expression: {
          type: 'string',
          description: 'SQL-style predicate using object attribute codes. Supports =, !=, <>, >, >=, <, <=, IS NULL, IS NOT NULL, IN, NOT IN, LIKE, NOT LIKE, AND, OR, NOT, and parentheses. Example: `age > 0 AND email IS NOT NULL`.',
        },
        severity: { type: 'string', enum: ['info', 'warning', 'error'] },
      },
      required: ['objectId', 'name', 'expression', 'severity'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_upsert_logic_function',
    description: 'Add a reusable logic function against the ontology.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        id: { type: 'string' },
        code: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        runtime: { type: 'string', enum: ['typescript', 'python', 'sql'] },
        objectIds: { type: 'array', items: { type: 'string' } },
        signature: { type: 'string' },
        body: { type: 'string' },
        returnType: { type: 'string' },
        parameters: { type: 'array', items: { type: 'object' } },
        configuration: { type: 'object' },
      },
      required: ['name', 'runtime'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_upsert_action',
    description: 'Add an action definition (side effect the agent can trigger).',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        id: { type: 'string' },
        code: { type: 'string' },
        name: { type: 'string' },
        executor: { type: 'string', enum: ['function', 'api', 'sql', 'notification', 'custom_script'] },
        objectIds: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        configuration: { type: 'object' },
        parameters: { type: 'array', items: { type: 'object' } },
        outputSchema: { type: 'array', items: { type: 'object' } },
      },
      required: ['name', 'executor'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_execute_logic_function',
    description: 'Execute an active logic function by id or code with JSON arguments and return its output.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        id: { type: 'string' },
        code: { type: 'string' },
        arguments: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_execute_relation',
    description: 'Traverse an executable field-bound relation with optional source-object filters.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        id: { type: 'string' },
        code: { type: 'string' },
        arguments: {
          type: 'object',
          description: 'Supports query, direction (forward/reverse), limit, and maxDepth.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'ontology_execute_action',
    description: 'Execute an active action by id or code with JSON arguments and return its output. Actions may have side effects.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        id: { type: 'string' },
        code: { type: 'string' },
        arguments: { type: 'object' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'ontology_generate_draft_from_assets',
    description: 'Kick the heuristic template generator against selected assets. Use once as a skeleton, then refine with the upsert tools.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        assetIds: { type: 'array', items: { type: 'string' } },
        businessGoal: { type: 'string' },
        mode: { type: 'string', enum: ['merge', 'replace'], description: 'merge = keep prior draft; replace = wipe.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_run_consistency_check',
    description: 'Validate the current draft. Returns issues[] the model should either fix or report to the user.',
    inputSchema: {
      type: 'object',
      properties: { workspace_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_publish_current_draft',
    description: 'Publish the current draft as an immutable version. Only call after ontology_run_consistency_check returns isValid=true AND the user has confirmed. Every draft object must be approved first — instruct the user to click "全部通过" in the preview panel if it is not yet approved.',
    inputSchema: {
      type: 'object',
      properties: { workspace_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_create_agent_blueprint',
    description: 'Create an agent blueprint from the newest published version.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        name: { type: 'string' },
        ontologyVersionId: { type: 'string' },
        promptTemplate: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_register_agent_blueprint',
    description: 'Register the newest blueprint as a SudoWork assistant so the user can chat with it.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        blueprintId: { type: 'string' },
        name: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
];

const nameToRoute: Record<string, string> = {
  ontology_get_snapshot: 'get_snapshot',
  ontology_update_draft: 'update_draft',
  ontology_upsert_object: 'upsert_object',
  ontology_upsert_attribute: 'upsert_attribute',
  ontology_upsert_relation: 'upsert_relation',
  ontology_upsert_mapping: 'upsert_mapping',
  ontology_upsert_quality_rule: 'upsert_quality_rule',
  ontology_upsert_logic_function: 'upsert_logic_function',
  ontology_upsert_action: 'upsert_action',
  ontology_execute_logic_function: 'execute_logic_function',
  ontology_execute_relation: 'execute_relation',
  ontology_execute_action: 'execute_action',
  ontology_generate_draft_from_assets: 'generate_draft_from_assets',
  ontology_run_consistency_check: 'run_consistency_check',
  ontology_publish_current_draft: 'publish_current_draft',
  ontology_create_agent_blueprint: 'create_agent_blueprint',
  ontology_register_agent_blueprint: 'register_agent_blueprint',
};

function textResult(value: unknown, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [
      {
        type: 'text' as const,
        text: `<ontology-write-result>\n${JSON.stringify(value, null, 2)}\n</ontology-write-result>`,
      },
    ],
  };
}

async function callBridge(route: string, workspaceId: string | undefined, input: Record<string, unknown>): Promise<unknown> {
  const url = `${baseUrl!.replace(/\/+$/, '')}/tool/${route}`;
  const body = JSON.stringify({ workspaceId: workspaceId || envWorkspaceId || undefined, input });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token!}`,
    },
    body,
  });
  const text = await response.text();
  let parsed: { ok?: boolean; data?: unknown; message?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { ok: false, message: text };
  }
  if (!response.ok || parsed?.ok === false) {
    const message = parsed?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return parsed?.data ?? parsed;
}

const server = new Server({ name: 'sudowork-ontology-builder', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const { workspace_id: workspaceId, ...rest } = args;
    const route = nameToRoute[request.params.name];
    if (!route) throw new Error(`Unknown tool: ${request.params.name}`);
    const data = await callBridge(route, typeof workspaceId === 'string' ? workspaceId : undefined, rest);
    return textResult(data);
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
});

server.connect(new StdioServerTransport()).catch((error) => {
  console.error('[ontology-builder-mcp] failed to start stdio transport:', error);
  process.exitCode = 1;
});
