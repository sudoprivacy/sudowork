import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { runMigrations } from '@server/migrate'

/** Each isolated test module owns a database; concurrent files cannot drop it. */
export const TEST_DB_NAME = `sudowork_webui_test_${randomUUID().replaceAll('-', '')}`

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
  try {
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`)
  } finally {
    await admin.end()
  }

  const pool = new Pool({ connectionString: testDbUrl(), max: 4 })
  try {
    await runMigrations(pool, join(process.cwd(), 'migrations'))
  } catch (error) {
    await destroyTestDatabase(pool)
    throw error
  }
  return pool
}

export async function destroyTestDatabase(pool: Pool): Promise<void> {
  await pool.end()
  const admin = new Pool({ connectionString: adminUrl(), max: 1 })
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`)
  } finally {
    await admin.end()
  }
}
