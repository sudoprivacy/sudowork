export interface IOntologyProjectCommand {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

const sourceTools: IOntologyProjectCommand[] = [
  {
    name: 'sudograph_source_register',
    description:
      'Connect an explicitly supplied SQLite, PostgreSQL or MySQL source and run the host-selected read-only source registration using the same pipeline as the connection form. Returns its existing or new project, model authority and open_path. Use the returned scan receipt to assess coverage. Credentials stay in host secret storage and are excluded from models and results. Does not replace the current project or modify the database.',
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', format: 'uuid' },
        language: { type: 'string', enum: ['zh', 'en'] },
        connector: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            kind: { type: 'string', enum: ['database'] },
            sourceType: { type: 'string', enum: ['sqlite', 'postgresql', 'mysql'] },
            writable: { type: 'boolean', enum: [false] },
            metadata: { type: 'object', additionalProperties: false },
            path: { type: 'string' },
            host: { type: 'string' },
            port: { type: 'integer', minimum: 1, maximum: 65535 },
            database: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string' },
            params: { type: 'object', properties: { schema: { type: 'string' } }, additionalProperties: false },
          },
          required: ['name', 'kind', 'sourceType', 'writable', 'metadata'],
          additionalProperties: false,
        },
      },
      required: ['operationId', 'language', 'connector'],
      additionalProperties: false,
    },
  },
];

const sudographTools: IOntologyProjectCommand[] = [
  { name: 'sudograph_model_contract', description: 'Read the bound canonical YAML, current revision and checked write contract.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'sudograph_model_apply',
    description: 'Compile and atomically commit a model edit, graph and context. Compatible concurrent edits merge; conflicts and compiler errors include recovery details. Does not modify source data.',
    inputSchema: { type: 'object', properties: { base_revision: { type: 'string' }, operation_id: { type: 'string' }, model: { type: 'string' } }, required: ['base_revision', 'operation_id', 'model'], additionalProperties: false },
  },
  { name: 'sudograph_context', description: 'Read the deterministic agent context and exact version-bound read pointers for this model.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'sudograph_context_read',
    description: 'Read an exact source, field, definition, evidence item, catalogue or subgraph at a context revision.',
    inputSchema: {
      type: 'object',
      properties: { revision: { type: 'string' }, context_digest: { type: 'string' }, id: { type: 'string' }, records: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, selection: { type: 'object' } },
      required: ['revision', 'context_digest', 'id'],
      additionalProperties: false,
    },
  },
];

const sudographRoutes: Record<string, string> = { sudograph_model_contract: 'sudograph_contract', sudograph_model_apply: 'sudograph_apply', sudograph_context: 'sudograph_context', sudograph_context_read: 'sudograph_context_read' };

const objectIdArg = { type: 'string', description: 'Ontology object id (obtained from ontology_get_snapshot).' };

const tools: IOntologyProjectCommand[] = [
  {
    name: 'ontology_preview_asset',
    description: 'Read a bounded sample of a data asset in the bound ontology. Use its observed fields as evidence before creating mappings or query functions.',
    inputSchema: { type: 'object', properties: { workspace_id: { type: 'string' }, id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'ontology_get_snapshot',
    description: 'Read the current ontology draft state (objects, relations, attributes, mappings, stats). Call this at the start of every session and whenever you need to know current ids/codes.',
    inputSchema: {
      type: 'object',
      properties: { workspace_id: { type: 'string', description: 'Must match the ontology bound to this session.' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
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

export function ontologyProjectCommands(authority: 'rdf' | 'sudograph'): IOntologyProjectCommand[] {
  const catalog = authority === 'sudograph' ? sudographTools : tools.filter((item) => !['ontology_execute_action', 'ontology_approve_all', 'ontology_publish_current_draft', 'ontology_register_agent_blueprint'].includes(item.name));
  return [...sourceTools.map((item) => ({ ...item, name: 'register_source' })), ...catalog.map((item) => ({ ...item, name: authority === 'sudograph' ? sudographRoutes[item.name] : item.name.replace(/^ontology_/, '') }))];
}
