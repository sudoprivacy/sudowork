import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'
import { Pool } from 'pg'

/**
 * Migration runner（计划 3.12）：
 * - schema_migrations 记录 version/checksum/applied_at
 * - 单事务执行每个 migration；失败回滚并非 0 退出
 * - 已应用 migration 的 checksum 变化时拒绝启动
 * - 空库第一次执行 001；重复启动不重复执行
 */

export interface MigrationFile {
  version: string
  sql: string
  checksum: string
}

export class MigrationError extends Error {}

export function listMigrationFiles(migrationsDir: string): MigrationFile[] {
  let names: string[]
  try {
    names = readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort()
  } catch {
    throw new MigrationError(`cannot read migrations directory: ${migrationsDir}`)
  }
  if (names.length === 0) {
    throw new MigrationError(`no migrations found in ${migrationsDir}`)
  }
  return names.map((name) => {
    const sql = readFileSync(join(migrationsDir, name), 'utf8')
    return {
      version: name,
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    }
  })
}

const SCHEMA_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)
`

export async function runMigrations(
  pool: Pool,
  migrationsDir: string,
): Promise<{ applied: string[]; skipped: string[] }> {
  await pool.query(SCHEMA_TABLE_SQL)

  const existing = new Map(
    (await pool.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    )).rows.map((row) => [row.version, row.checksum]),
  )

  const files = listMigrationFiles(migrationsDir)
  const applied: string[] = []
  const skipped: string[] = []

  for (const file of files) {
    const recorded = existing.get(file.version)
    if (recorded !== undefined) {
      if (recorded !== file.checksum) {
        throw new MigrationError(
          `checksum mismatch for applied migration ${file.version}: ` +
            `recorded ${recorded}, file ${file.checksum}; refusing to start`,
        )
      }
      skipped.push(file.version)
      continue
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(file.sql)
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
        file.version,
        file.checksum,
      ])
      await client.query('COMMIT')
      applied.push(file.version)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw new MigrationError(
        `migration ${file.version} failed and was rolled back: ${(err as Error).message}`,
      )
    } finally {
      client.release()
    }
  }

  return { applied, skipped }
}

async function main(): Promise<void> {
  const migrationsDir =
    process.env.MIGRATIONS_DIR ?? join(process.cwd(), 'migrations')
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for migrations')
  }
  const pool = new Pool({ connectionString })
  try {
    const result = await runMigrations(pool, migrationsDir)
    console.log(
      `[migrate] applied: ${result.applied.length ? result.applied.join(', ') : '(none)'}; ` +
        `already applied: ${result.skipped.length ? result.skipped.join(', ') : '(none)'}`,
    )
  } finally {
    await pool.end()
  }
}

// 仅在直接执行时运行（兼容 bun src/server/migrate.ts 与 node dist/server/migrate.js）
const entry = process.argv[1]
if (entry) {
  try {
    const isMain = import.meta.url === pathToFileURL(realpathSync(entry)).href
    if (isMain) {
      main().catch((err: Error) => {
        console.error(`[migrate] FAILED: ${err.message}`)
        process.exit(1)
      })
    }
  } catch {
    // realpath 失败（例如被 bundler 包装）时不自动执行
  }
}

export { main as runMigrateMain }
