import { join } from 'node:path'
import { Pool } from 'pg'
import { runMigrations } from '@server/migrate'

/** 集成测试专用库；从 DATABASE_URL 推导，默认本地容器。 */
export const TEST_DB_NAME = 'sudowork_webui_test'

function baseUrl(): URL {
  const raw = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
  return new URL(raw)
}

function adminUrl(): string {
  const url = baseUrl()
  url.pathname = '/postgres'
  return url.toString()
}

export function testDbUrl(): string {
  const url = baseUrl()
  url.pathname = `/${TEST_DB_NAME}`
  return url.toString()
}

export async function createTestDatabase(): Promise<Pool> {
  const admin = new Pool({ connectionString: adminUrl(), max: 1 })
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`)
  await admin.end()

  const pool = new Pool({ connectionString: testDbUrl(), max: 4 })
  await runMigrations(pool, join(process.cwd(), 'migrations'))
  return pool
}

export async function destroyTestDatabase(pool: Pool): Promise<void> {
  await pool.end()
  const admin = new Pool({ connectionString: adminUrl(), max: 1 })
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`)
  await admin.end()
}
