import { Pool, type PoolClient } from 'pg'

/**
 * PostgreSQL 连接池（WebUI 自有库，计划 2.1：仅四张业务辅助表）。
 */

let pool: Pool | undefined

export function getPool(connectionString?: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString ?? process.env.DATABASE_URL,
      max: 10,
    })
  }
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = undefined
  }
}

export type { PoolClient }
