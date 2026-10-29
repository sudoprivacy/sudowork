import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client, types as postgresTypes } from 'pg';
import mysql, { type Connection as MysqlConnection, type RowDataPacket } from 'mysql2/promise';
import type { ISudographSourceConnector } from './sourceConfig.js';

interface IColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  hidden: number;
}
interface IForeignKey {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}
interface IObject {
  name: string;
  kind: 'table' | 'view';
  definition: string;
  columns: IColumn[];
  foreign_keys: IForeignKey[];
}
interface ISession {
  pg?: Client;
  mysql?: MysqlConnection;
  begun: boolean;
}
const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"';

/** Private compiler transport. Uses Sudowork's existing PG/MySQL drivers. */
export class SudographSourceProvider {
  private server?: Server;
  private readonly token = randomBytes(32).toString('hex');
  private readonly sessions = new Map<string, ISession>();
  private isClosed = false;
  constructor(
    private readonly source: string,
    private readonly connector: ISudographSourceConnector
  ) {
    if (!/^registered:\/\/[a-zA-Z0-9_-]{1,128}$/.test(source) || !['postgresql', 'mysql'].includes(connector.sourceType)) throw new Error('Invalid registered source provider.');
  }
  async start() {
    this.server = createServer((req, res) => {
      void (async () => {
        if (this.isClosed || req.url !== '/source' || req.method !== 'POST' || req.headers.origin || req.headers.authorization !== `Bearer ${this.token}`) {
          res.writeHead(403).end();
          return;
        }
        try {
          let size = 0;
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 65536) throw new Error('READ_LIMIT');
            chunks.push(Buffer.from(chunk));
          }
          const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const result = await this.call(input);
          const body = JSON.stringify({ ok: true, result });
          if (Buffer.byteLength(body) > 32 * 1024 * 1024) throw new Error('READ_LIMIT');
          res
            .writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            })
            .end(body);
        } catch (error) {
          // Provider messages can contain passwords, hosts or SQL literals.
          const raw = error as { code?: string; message?: string };
          const code = raw.code && /^[A-Z0-9_]{1,64}$/.test(raw.code) ? raw.code : ['READ_LIMIT', 'SOURCE_SCHEMA_CHANGED', 'SCOPE_MISMATCH'].includes(raw.message || '') ? raw.message : 'SOURCE_READ_FAILED';
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, code }));
        }
      })();
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Registered source transport could not listen.');
    return JSON.stringify({
      source: this.source,
      provider: this.connector.sourceType,
      schema: this.schema(),
      endpoint: `http://127.0.0.1:${address.port}/source`,
      token: this.token,
    });
  }
  private schema() {
    return this.connector.sourceType === 'postgresql' ? String(this.connector.params?.schema || 'public') : this.connector.database!;
  }
  private async call(input: Record<string, unknown>): Promise<unknown> {
    if (input.operation === 'open') {
      if (this.sessions.size >= 8) throw new Error('READ_LIMIT');
      const config = this.connector;
      const session: ISession = { begun: false };
      if (config.sourceType === 'postgresql') {
        session.pg = new Client({
          host: config.host,
          port: config.port ?? 5432,
          database: config.database,
          user: config.username,
          password: config.password,
          connectionTimeoutMillis: 8000,
          statement_timeout: 15000,
          types: {
            getTypeParser: (oid, format) => ([16, 17, 20, 21, 23, 26, 700, 701, 1700].includes(oid) ? postgresTypes.getTypeParser(oid, format) : (value: string) => value),
          },
        });
        await session.pg.connect();
      } else
        session.mysql = await mysql.createConnection({
          host: config.host,
          port: config.port ?? 3306,
          database: config.database,
          user: config.username,
          password: config.password,
          connectTimeout: 8000,
          supportBigNumbers: true,
          bigNumberStrings: true,
          dateStrings: true,
          jsonStrings: true,
          multipleStatements: false,
        });
      if (this.isClosed) {
        await session.pg?.end();
        await session.mysql?.end();
        throw new Error('SOURCE_CLOSED');
      }
      const id = randomUUID();
      this.sessions.set(id, session);
      return { session: id };
    }
    const id = String(input.session);
    const session = this.sessions.get(id);
    if (!session) throw new Error('SOURCE_SESSION_UNKNOWN');
    if (input.operation === 'close') {
      this.sessions.delete(id);
      await this.release(session);
      return {};
    }
    if (input.operation === 'begin') {
      if (session.begun) throw new Error('SOURCE_TRANSACTION_ALREADY_OPEN');
      if (session.pg) {
        await session.pg.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await session.pg.query(`SELECT set_config('search_path', $1, true)`, [ident(this.schema())]);
      } else {
        await session.mysql!.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await session.mysql!.query('SET SESSION MAX_EXECUTION_TIME = 15000');
        await session.mysql!.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      }
      session.begun = true;
      return {
        id: randomUUID(),
        provider: this.connector.sourceType,
        consistency: 'one read-only repeatable-read transaction; schema rechecked before publication',
        scope: `all SELECT-visible tables and database views in registered schema ${this.schema()}`,
        started_at: new Date().toISOString(),
      };
    }
    // Discovery and every SELECT require an actual provider read transaction.
    if (!session.begun) await this.call({ operation: 'begin', session: id });
    if (input.operation === 'inventory') return this.inventory(session);
    if (input.operation === 'describe') {
      const obj = (await this.inventory(session)).find((item) => item.name === input.name);
      if (!obj) throw new Error('SOURCE_SCHEMA_CHANGED');
      return obj;
    }
    if (input.operation === 'query' && typeof input.sql === 'string' && /^SELECT\b|^WITH\b/i.test(input.sql) && input.sql.length <= 60000) return this.query(session, input.sql);
    throw new Error('READ_CONTRACT');
  }
  private async query(session: ISession, sql: string, params: unknown[] = []) {
    if (session.pg) {
      const response = await session.pg.query({
        text: sql,
        values: params,
        rowMode: 'array',
      });
      return {
        columns: response.fields.map((f) => f.name),
        rows: response.rows.map((row) => row.map((value: unknown, index: number) => this.wire(value, response.fields[index].dataTypeID))),
      };
    }
    const [rows, fields] = await session.mysql!.query<RowDataPacket[]>({ sql, rowsAsArray: true }, params);
    return {
      columns: fields.map((f) => f.name),
      rows: rows.map((row) => (row as unknown as unknown[]).map((value, index) => this.wire(value, Number(fields[index].type), true))),
    };
  }
  private wire(value: unknown, type: number, isMysql = false): unknown {
    if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
    if (typeof value === 'bigint') return { $integer: value.toString() };
    if (typeof value === 'string' && (isMysql ? type === 8 : type === 20)) return { $integer: value };
    if (typeof value === 'string' && (isMysql ? [0, 246].includes(type) : type === 1700)) return { $decimal: value };
    if (value instanceof Date) return value.toISOString();
    if (value !== null && typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'number' && !Number.isFinite(value)) return { $float: String(value) };
    return value;
  }
  private async records(session: ISession, sql: string, params: unknown[] = []) {
    const result = await this.query(session, sql, params);
    return result.rows.map((row) =>
      Object.fromEntries(
        result.columns.map((column, index) => {
          const value = row[index];
          return [column, value && typeof value === 'object' && '$integer' in value ? Number(value.$integer) : value];
        })
      )
    ) as Array<Record<string, string | number | null>>;
  }
  private async inventory(session: ISession): Promise<IObject[]> {
    const schema = this.schema();
    const pg = !!session.pg;
    const objects = pg
      ? await this.records(session, `SELECT c.relname AS name, c.relkind AS kind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege(c.oid,'SELECT') ORDER BY c.relname`, [schema])
      : await this.records(session, 'SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME', [schema]);
    const result: IObject[] = [];
    for (const item of objects) {
      if (item.kind === 'f' || (!pg && item.kind === 'BASE TABLE' && item.engine !== 'InnoDB')) throw new Error('SOURCE_CONSISTENCY_UNSUPPORTED');
      const name = String(item.name),
        kind = ['v', 'm', 'VIEW'].includes(String(item.kind)) ? 'view' : 'table';
      const columns = pg
        ? await this.records(
            session,
            `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS default_value,coalesce(array_position(i.indkey::smallint[],a.attnum)+1,0) AS pk FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum LEFT JOIN pg_catalog.pg_index i ON i.indrelid=c.oid AND i.indisprimary WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
            [schema, name]
          )
        : await this.records(
            session,
            `SELECT c.COLUMN_NAME AS name,c.COLUMN_TYPE AS type,c.IS_NULLABLE AS nullable,c.COLUMN_DEFAULT AS default_value,coalesce(k.ORDINAL_POSITION,0) AS pk FROM information_schema.COLUMNS c LEFT JOIN information_schema.KEY_COLUMN_USAGE k ON k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.CONSTRAINT_NAME='PRIMARY' WHERE c.TABLE_SCHEMA=? AND c.TABLE_NAME=? ORDER BY c.ORDINAL_POSITION`,
            [schema, name]
          );
      const foreign = pg
        ? await this.records(
            session,
            `SELECT con.conname AS constraint_name,u.ordinality AS ordinal,t.relname AS target,n2.nspname AS target_schema,a.attname AS source_column,b.attname AS target_column,con.confupdtype AS update_rule,con.confdeltype AS delete_rule FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_class t ON t.oid=con.confrelid JOIN pg_catalog.pg_namespace n2 ON n2.oid=t.relnamespace CROSS JOIN LATERAL unnest(con.conkey,con.confkey) WITH ORDINALITY u(source_key,target_key,ordinality) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.source_key JOIN pg_catalog.pg_attribute b ON b.attrelid=t.oid AND b.attnum=u.target_key WHERE con.contype='f' AND n.nspname=$1 AND c.relname=$2 ORDER BY con.conname,u.ordinality`,
            [schema, name]
          )
        : await this.records(
            session,
            `SELECT k.CONSTRAINT_NAME AS constraint_name,k.ORDINAL_POSITION AS ordinal,k.REFERENCED_TABLE_NAME AS target,k.REFERENCED_TABLE_SCHEMA AS target_schema,k.COLUMN_NAME AS source_column,k.REFERENCED_COLUMN_NAME AS target_column,r.UPDATE_RULE AS update_rule,r.DELETE_RULE AS delete_rule FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=? AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,
            [schema, name]
          );
      const constraintNames = [...new Set(foreign.map((f) => String(f.constraint_name)))];
      const actions: Record<string, string> = {
        a: 'NO ACTION',
        r: 'RESTRICT',
        c: 'CASCADE',
        n: 'SET NULL',
        d: 'SET DEFAULT',
      };
      if (foreign.some((f) => f.target_schema !== schema)) throw new Error('SOURCE_SCOPE_CROSS_SCHEMA_REFERENCE');
      const mapped: IObject = {
        name,
        kind,
        definition: '',
        columns: columns.map((col, cid) => ({
          cid,
          name: String(col.name),
          type: String(col.type),
          notnull: pg ? Number(!!col.required) : Number(col.nullable === 'NO'),
          dflt_value: col.default_value === null ? null : String(col.default_value),
          pk: Number(col.pk),
          hidden: 0,
        })),
        foreign_keys: foreign.map((f) => ({
          id: constraintNames.indexOf(String(f.constraint_name)),
          seq: Number(f.ordinal) - 1,
          table: String(f.target),
          from: String(f.source_column),
          to: String(f.target_column),
          on_update: actions[String(f.update_rule)] || String(f.update_rule),
          on_delete: actions[String(f.delete_rule)] || String(f.delete_rule),
          match: 'NONE',
        })),
      };
      if (kind === 'view') {
        const definitions = pg
          ? await this.records(session, 'SELECT pg_get_viewdef(c.oid,true) AS definition FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2', [schema, name])
          : await this.records(session, 'SELECT VIEW_DEFINITION AS definition FROM information_schema.VIEWS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [schema, name]);
        if (!definitions[0]?.definition) throw new Error('SOURCE_VIEW_DEFINITION_UNAVAILABLE');
        mapped.definition = String(definitions[0].definition);
      } else
        mapped.definition =
          '/* Reconstructed from source catalogue; not original CREATE SQL. */\n' +
          JSON.stringify({
            columns: mapped.columns,
            foreign_keys: mapped.foreign_keys,
          });
      result.push(mapped);
    }
    return result;
  }
  private async release(session: ISession) {
    if (session.pg) {
      try {
        await session.pg.query('ROLLBACK');
      } finally {
        await session.pg.end();
      }
    }
    if (session.mysql) {
      try {
        await session.mysql.query('ROLLBACK');
      } finally {
        await session.mysql.end();
      }
    }
  }
  async close() {
    this.isClosed = true;
    await Promise.allSettled([...this.sessions.values()].map((s) => this.release(s)));
    this.sessions.clear();
    this.server?.closeIdleConnections();
    await new Promise<void>((resolve) => (this.server?.listening ? this.server.close(() => resolve()) : resolve()));
  }
}
