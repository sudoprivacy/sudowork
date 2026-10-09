import fs from 'node:fs/promises';
import path from 'node:path';

export interface IParsedOntologyTemplate {
  objects: Array<{
    code: string;
    name: string;
    description?: string;
    namespace?: string;
    tier: 1 | 2 | 3;
    status: 'active' | 'warning' | 'error';
    attributes: Array<{
      code: string;
      name: string;
      dataType: string;
      required: boolean;
      description?: string;
    }>;
  }>;
  relations: Array<{
    code: string;
    name: string;
    from: string;
    to: string;
    cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
    description?: string;
  }>;
}

export async function parseOntologyTemplateFile(filePath: string): Promise<IParsedOntologyTemplate | null> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.json') {
    const content = await fs.readFile(filePath, 'utf8');
    return normalizeOntologyTemplate(JSON.parse(content) as unknown);
  }
  if (extension === '.xlsx' || extension === '.xls') return parseOntologySpreadsheet(filePath);
  if (['.owl', '.rdf', '.xml', '.ttl'].includes(extension)) {
    const content = await fs.readFile(filePath, 'utf8');
    return parseRdfOntologyTemplate(content);
  }
  return null;
}

function normalizeOntologyTemplate(value: unknown): IParsedOntologyTemplate | null {
  if (!isRecord(value)) return null;
  const rawObjects = firstArray(value.object_types, value.entities, value.objects, value.classes);
  if (rawObjects.length === 0) return null;
  const objects = rawObjects.flatMap((item) => {
    if (!isRecord(item)) return [];
    const code = stringValue(item.code, item.name, item.id);
    if (!code) return [];
    const name = stringValue(item.display_name, item.displayName, item.name_cn, item.label, item.name, item.code) || code;
    const rawAttributes = firstArray(item.attributes, item.properties, item.fields);
    return [
      {
        code,
        name,
        description: stringValue(item.description),
        namespace: stringValue(item.namespace),
        tier: normalizeTemplateTier(item.tier),
        status: normalizeTemplateStatus(item.status),
        attributes: rawAttributes.flatMap((attribute, attributeIndex) => {
          if (!isRecord(attribute)) return [];
          const attributeCode = stringValue(attribute.code, attribute.name, attribute.id) || `field_${attributeIndex + 1}`;
          return [
            {
              code: attributeCode,
              name: stringValue(attribute.display_name, attribute.displayName, attribute.name_cn, attribute.label, attribute.name, attribute.code) || attributeCode,
              dataType: stringValue(attribute.data_type, attribute.dataType, attribute.type) || 'string',
              required: booleanValue(attribute.required, attribute.is_required, attribute.nullable === false),
              description: stringValue(attribute.description),
            },
          ];
        }),
      },
    ];
  });
  if (objects.length === 0) return null;
  const rawRelations = firstArray(value.relations, value.relationships, value.object_properties);
  const relations = rawRelations.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const from = stringValue(item.from, item.source, item.from_entity, item.source_object);
    const to = stringValue(item.to, item.target, item.to_entity, item.target_object);
    if (!from || !to) return [];
    const code = stringValue(item.code, item.name) || `relation_${index + 1}`;
    return [
      {
        code,
        name: stringValue(item.display_name, item.displayName, item.label, item.name, item.code) || code,
        from,
        to,
        cardinality: normalizeTemplateCardinality(stringValue(item.cardinality, item.rel_type)),
        description: stringValue(item.description),
      },
    ];
  });
  return { objects, relations };
}

async function parseOntologySpreadsheet(filePath: string): Promise<IParsedOntologyTemplate | null> {
  const XLSX = await import('xlsx-republish');
  const workbook = XLSX.read(await fs.readFile(filePath), { type: 'buffer' });
  const rowsBySheet = new Map(workbook.SheetNames.map((sheetName) => [sheetName.toLowerCase(), XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' })]));
  const firstSheetRows: Array<Record<string, unknown>> = rowsBySheet.values().next().value ?? [];
  const objectRows = spreadsheetRows(rowsBySheet, ['objects', 'object', 'entities', 'entity', '对象', '实体']) ?? firstSheetRows;
  const attributeRows = spreadsheetRows(rowsBySheet, ['attributes', 'attribute', 'properties', 'property', '属性']) ?? [];
  const relationRows = spreadsheetRows(rowsBySheet, ['relations', 'relation', 'relationships', '关系']) ?? [];
  const attributesByObject = new Map<string, Array<Record<string, unknown>>>();
  for (const row of attributeRows) {
    const objectCode = spreadsheetValue(row, ['object', 'object_code', 'entity', 'entity_name', '对象', '实体']);
    if (!objectCode) continue;
    attributesByObject.set(objectCode, [...(attributesByObject.get(objectCode) ?? []), row]);
  }
  return normalizeOntologyTemplate({
    objects: objectRows.map((row) => {
      const code = spreadsheetValue(row, ['code', 'name', 'english_name', '英文名', '编码']);
      const inlineAttributes = spreadsheetValue(row, ['attributes', 'properties', '属性']);
      return {
        code,
        name: spreadsheetValue(row, ['display_name', 'name_cn', 'chinese_name', '中文名', '名称']) || code,
        description: spreadsheetValue(row, ['description', '说明', '描述']),
        namespace: spreadsheetValue(row, ['namespace', '命名空间']),
        tier: spreadsheetValue(row, ['tier', '层级']),
        attributes:
          attributesByObject.get(code)?.map((attribute) => ({
            code: spreadsheetValue(attribute, ['code', 'name', 'english_name', '英文名', '编码']),
            name: spreadsheetValue(attribute, ['display_name', 'name_cn', 'chinese_name', '中文名', '名称']),
            type: spreadsheetValue(attribute, ['data_type', 'type', '数据类型', '类型']),
            required: spreadsheetValue(attribute, ['required', 'is_required', '必填']),
            description: spreadsheetValue(attribute, ['description', '说明', '描述']),
          })) ?? parseInlineAttributes(inlineAttributes),
      };
    }),
    relations: relationRows.map((row) => ({
      code: spreadsheetValue(row, ['code', 'name', '英文名', '编码']),
      name: spreadsheetValue(row, ['display_name', 'name_cn', '中文名', '名称']),
      from: spreadsheetValue(row, ['from', 'source', 'from_entity', '源对象', '起点']),
      to: spreadsheetValue(row, ['to', 'target', 'to_entity', '目标对象', '终点']),
      cardinality: spreadsheetValue(row, ['cardinality', '基数']),
      description: spreadsheetValue(row, ['description', '说明', '描述']),
    })),
  });
}

function parseRdfOntologyTemplate(content: string): IParsedOntologyTemplate | null {
  const objectCodes = new Set<string>();
  for (const match of content.matchAll(/<owl:Class\b[^>]*(?:rdf:about|rdf:ID)=["'][^"']*[#/]([^#/'"]+)["'][^>]*>/gi)) objectCodes.add(match[1]);
  for (const match of content.matchAll(/(?:^|\s):([A-Za-z_][\w-]*)\s+(?:a|rdf:type)\s+owl:Class\b/gim)) objectCodes.add(match[1]);
  if (objectCodes.size === 0) return null;

  const objects: IParsedOntologyTemplate['objects'] = Array.from(objectCodes).map((code) => ({
    code,
    name: code.replace(/[_-]+/g, ' '),
    tier: 3,
    status: 'active',
    attributes: [] as IParsedOntologyTemplate['objects'][number]['attributes'],
  }));
  const relations: IParsedOntologyTemplate['relations'] = [];
  for (const match of content.matchAll(/<owl:ObjectProperty\b[^>]*(?:rdf:about|rdf:ID)=["'][^"']*[#/]([^#/'"]+)["'][^>]*>([\s\S]*?)<\/owl:ObjectProperty>/gi)) {
    const from = match[2].match(/<rdfs:domain\b[^>]*rdf:resource=["'][^"']*[#/]([^#/'"]+)["']/i)?.[1];
    const to = match[2].match(/<rdfs:range\b[^>]*rdf:resource=["'][^"']*[#/]([^#/'"]+)["']/i)?.[1];
    if (from && to) relations.push({ code: match[1], name: match[1].replace(/[_-]+/g, ' '), from, to, cardinality: 'one_to_many' });
  }
  return { objects, relations };
}

function spreadsheetRows(rowsBySheet: Map<string, Array<Record<string, unknown>>>, aliases: string[]): Array<Record<string, unknown>> | undefined {
  for (const [sheetName, rows] of rowsBySheet) {
    if (aliases.some((alias) => sheetName.includes(alias))) return rows;
  }
  return undefined;
}

function spreadsheetValue(row: Record<string, unknown>, aliases: string[]): string {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [
      key
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_'),
      value,
    ])
  );
  for (const alias of aliases) {
    const value = normalized.get(alias.toLowerCase().replace(/[\s-]+/g, '_'));
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function parseInlineAttributes(value: string): Array<Record<string, unknown>> {
  if (!value) return [];
  return value
    .split(/[,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [name, type = 'string'] = item.split(':').map((part) => part.trim());
      return { name, display_name: name, type };
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) ?? [];
}

function stringValue(...values: unknown[]): string {
  const value = values.find((candidate) => typeof candidate === 'string' || typeof candidate === 'number');
  return value === undefined ? '' : String(value).trim();
}

function booleanValue(...values: unknown[]): boolean {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['true', 'yes', '1', '是', '必填'].includes(String(value).trim().toLowerCase());
}

function normalizeTemplateTier(value: unknown): 1 | 2 | 3 {
  const tier = Number(value);
  return tier === 1 || tier === 2 ? tier : 3;
}

function normalizeTemplateStatus(value: unknown): 'active' | 'warning' | 'error' {
  return value === 'warning' || value === 'error' ? value : 'active';
}

function normalizeTemplateCardinality(value: string): IParsedOntologyTemplate['relations'][number]['cardinality'] {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  if (['1:1', 'one_to_one'].includes(normalized)) return 'one_to_one';
  if (['n:1', 'many_to_one'].includes(normalized)) return 'many_to_one';
  if (['n:n', 'm:n', 'many_to_many'].includes(normalized)) return 'many_to_many';
  return 'one_to_many';
}
