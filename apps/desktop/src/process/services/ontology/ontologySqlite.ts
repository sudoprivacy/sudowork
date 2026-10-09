import path from 'node:path';
import { statSync } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import type { IOntologyAssetField, OntologyJsonValue } from '@sudowork/ontology-common';

export function quoteSqliteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Open an existing SQLite file and close it on both success and failure. */
export function withOntologySqlite<T>(filePath: string | undefined, operation: (database: BetterSqlite3.Database) => T, isReadOnly = true): T {
  if (!filePath || !path.isAbsolute(filePath)) throw new Error('ontology.studio.dataErrors.sqlitePath');
  if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) throw new Error('ontology.studio.dataErrors.sqliteFileUnavailable');
  const database = new BetterSqlite3(filePath, { readonly: isReadOnly, fileMustExist: true, timeout: 5000 });
  try {
    database.pragma('foreign_keys = ON');
    return operation(database);
  } finally {
    database.close();
  }
}

/** Preserve 64-bit identifiers while retaining ordinary integers as JSON numbers. */
export function sqliteJsonValue(value: unknown): OntologyJsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Buffer.isBuffer(value)) return value.toString('base64');
  return String(value);
}

export function sqliteRows(statement: BetterSqlite3.Statement, parameters: unknown[] = []): Array<Record<string, OntologyJsonValue>> {
  return (statement.safeIntegers(true).all(...parameters) as Array<Record<string, unknown>>).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqliteJsonValue(value)])));
}

/** Read real table/view schema, including generated columns and foreign-key targets. */
export function inspectOntologySqlite(filePath: string | undefined, tableName?: string): ISqliteTable[] {
  return withOntologySqlite(filePath, (database) => {
    const tables = database.prepare(`SELECT name, type, wr, strict FROM pragma_table_list WHERE schema = 'main' AND type IN ('table', 'view', 'virtual') AND substr(name, 1, 7) != 'sqlite_' ${tableName ? 'AND name = ?' : ''} ORDER BY name`).all(...(tableName ? [tableName] : [])) as Array<{
      name: string;
      type: string;
      wr: number;
      strict: number;
    }>;
    return tables.map((table) => {
      const columns = database.prepare(`PRAGMA table_xinfo(${quoteSqliteIdentifier(table.name)})`).all() as ISqliteColumn[];
      const indexes = database.prepare(`PRAGMA index_list(${quoteSqliteIdentifier(table.name)})`).all() as Array<{ origin: string }>;
      const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${quoteSqliteIdentifier(table.name)})`).all() as Array<{ id: number; seq: number; table: string; from: string; to: string | null }>;
      const primaryColumns = columns.filter((column) => column.pk > 0);
      return {
        name: table.name,
        type: table.type,
        fields: columns
          .filter((column) => column.hidden !== 1)
          .map((column) => {
            const isPrimaryKey = column.pk > 0;
            const isRowidAlias = isPrimaryKey && primaryColumns.length === 1 && column.type.toUpperCase() === 'INTEGER' && !indexes.some((index) => index.origin === 'pk');
            const references = foreignKeys
              .filter((key) => key.from.toLowerCase() === column.name.toLowerCase())
              .map((key) => {
                const targetColumns = key.to ? [] : (database.prepare(`PRAGMA table_xinfo(${quoteSqliteIdentifier(key.table)})`).all() as ISqliteColumn[]);
                return { table: key.table, field: key.to || targetColumns.filter((item) => item.pk > 0).sort((a, b) => a.pk - b.pk)[key.seq]?.name || '', constraintId: key.id, position: key.seq };
              });
            return {
              name: column.name,
              dataType: column.type || 'any',
              nullable: column.notnull !== 1 && !(isPrimaryKey && (isRowidAlias || table.wr === 1 || table.strict === 1)),
              isPrimaryKey,
              primaryKeyPosition: isPrimaryKey ? column.pk : undefined,
              defaultValue: column.dflt_value ?? undefined,
              isGenerated: column.hidden === 2 || column.hidden === 3,
              references: references.length ? references : undefined,
            };
          }),
      };
    });
  });
}

/** Let SQLite parse single statements, so CTEs and quoted semicolons remain valid SQL. */
export function executeOntologySqlite(filePath: string | undefined, sql: string, isWritable = false): unknown {
  const command = sql
    .replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '')
    .match(/^([A-Za-z]+)/)?.[1]
    ?.toUpperCase();
  if (!['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE'].includes(command || '')) throw new Error('ontology.studio.dataErrors.sqliteStatement');
  return withOntologySqlite(
    filePath,
    (database) => {
      const statement = database.prepare(sql);
      if (!statement.readonly && !isWritable) throw new Error('ontology.studio.dataErrors.sqliteReadOnly');
      if (statement.reader) return sqliteRows(statement);
      const result = statement.safeIntegers(true).run();
      return { changes: sqliteJsonValue(result.changes), lastInsertRowid: sqliteJsonValue(result.lastInsertRowid) };
    },
    !isWritable
  );
}

/** Filter mapped records in the database before applying the response limit. */
export function lookupOntologySqlite(filePath: string | undefined, tableName: string, fields: ISqliteMappedField[], query: Record<string, OntologyJsonValue>, limit: number): Array<Record<string, OntologyJsonValue>> {
  const unique = [...new Map(fields.map((field) => [field.attributeCode, field])).values()];
  if (!unique.length || Object.keys(query).some((key) => !unique.some((field) => field.attributeCode === key))) return [];
  const filters = Object.entries(query);
  const values = filters.map(([, value]) => {
    if (typeof value === 'object' && value !== null) throw new Error('ontology.studio.dataErrors.sqliteFilter');
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('ontology.studio.dataErrors.sqliteFilter');
    return typeof value === 'boolean' ? Number(value) : value;
  });
  const where = filters.map(([key]) => `${quoteSqliteIdentifier(unique.find((field) => field.attributeCode === key)!.fieldName)} IS ?`).join(' AND ');
  const sql = `SELECT ${unique.map((field) => `${quoteSqliteIdentifier(field.fieldName)} AS ${quoteSqliteIdentifier(field.attributeCode)}`).join(', ')} FROM ${quoteSqliteIdentifier(tableName)} ${where ? `WHERE ${where}` : ''} LIMIT ?`;
  return withOntologySqlite(filePath, (database) => sqliteRows(database.prepare(sql), [...values, limit]));
}

/** Evaluate ordinary same-database joins over source data, independently of preview pagination. */
export function queryOntologySqliteRelation(input: ISqliteRelationInput) {
  const fromFields = [...new Map(input.from.fields.map((field) => [field.attributeCode, field])).values()];
  const toFields = [...new Map(input.to.fields.map((field) => [field.attributeCode, field])).values()];
  const sourceFields = input.direction === 'forward' ? fromFields : toFields;
  const sourceAlias = input.direction === 'forward' ? 'a' : 'b';
  const column = (alias: string, name: string) => `${alias}.${quoteSqliteIdentifier(name)}`;
  const joins = input.junction
    ? `JOIN ${quoteSqliteIdentifier(input.junction)} j ON ${input.keys.map((key) => `${column('a', key.from)} = ${column('j', key.junctionFrom!)}`).join(' AND ')} JOIN ${quoteSqliteIdentifier(input.to.table)} b ON ${input.keys.map((key) => `${column('b', key.to)} = ${column('j', key.junctionTo!)}`).join(' AND ')}`
    : `JOIN ${quoteSqliteIdentifier(input.to.table)} b ON ${input.keys.map((key) => `${column('a', key.from)} = ${column('b', key.to)}`).join(' AND ')}`;
  const source = `FROM ${quoteSqliteIdentifier(input.from.table)} a ${joins}`;
  const filters = Object.entries(input.query);
  if (filters.some(([name]) => !sourceFields.some((field) => field.attributeCode === name))) throw new Error('ontology.studio.dataErrors.sqliteFilter');
  const parameters = filters.map(([, value]) => {
    if (typeof value === 'object' && value !== null) throw new Error('ontology.studio.dataErrors.sqliteFilter');
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('ontology.studio.dataErrors.sqliteFilter');
    return typeof value === 'boolean' ? Number(value) : value;
  });
  const filterSql = filters.length ? `WHERE ${filters.map(([name]) => `${column(sourceAlias, sourceFields.find((field) => field.attributeCode === name)!.fieldName)} IS ?`).join(' AND ')}` : '';
  const projections = [...fromFields.map((field, index) => `${column('a', field.fieldName)} AS "from_${index}"`), ...toFields.map((field, index) => `${column('b', field.fieldName)} AS "to_${index}"`)];
  return withOntologySqlite(input.filePath, (database) => {
    const total = database.prepare(`SELECT COUNT(*) AS count ${source} ${filterSql}`).get(...parameters) as { count: number };
    const records = sqliteRows(database.prepare(`SELECT ${projections.join(', ')} ${source} ${filterSql} LIMIT ?`), [...parameters, input.limit]);
    const violations = (alias: string, fields: ISqliteMappedField[]) => {
      const result = database.prepare(`SELECT COUNT(*) AS count FROM (SELECT 1 ${source} GROUP BY ${fields.map((field) => column(alias, field.fieldName)).join(', ')} HAVING COUNT(*) > 1)`).get() as { count: number };
      return result.count;
    };
    const cardinalityViolations = (input.cardinality === 'one_to_one' || input.cardinality === 'many_to_one' ? violations('a', fromFields) : 0) + (input.cardinality === 'one_to_one' || input.cardinality === 'one_to_many' ? violations('b', toFields) : 0);
    return {
      rows: records.map((row) => {
        const from = Object.fromEntries(fromFields.map((field, index) => [field.attributeCode, row[`from_${index}`]]));
        const to = Object.fromEntries(toFields.map((field, index) => [field.attributeCode, row[`to_${index}`]]));
        return { source: input.direction === 'forward' ? from : to, target: input.direction === 'forward' ? to : from, depth: 1 };
      }),
      totalMatches: total.count,
      cardinalityViolations,
      cycleViolations: 0,
      isTruncated: total.count > input.limit,
    };
  });
}

interface ISqliteColumn {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  hidden: number;
  dflt_value: string | null;
}
interface ISqliteTable {
  name: string;
  type: string;
  fields: IOntologyAssetField[];
}
export interface ISqliteMappedField {
  fieldName: string;
  attributeCode: string;
}
interface ISqliteRelationInput {
  filePath: string;
  from: { table: string; fields: ISqliteMappedField[] };
  to: { table: string; fields: ISqliteMappedField[] };
  keys: Array<{ from: string; to: string; junctionFrom?: string; junctionTo?: string }>;
  junction?: string;
  query: Record<string, OntologyJsonValue>;
  direction: 'forward' | 'reverse';
  cardinality: string;
  limit: number;
}
