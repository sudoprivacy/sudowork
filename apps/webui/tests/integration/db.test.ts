import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Pool } from 'pg'
import { MigrationError, runMigrations } from '@server/migrate'
import { createTestDatabase, destroyTestDatabase } from './helpers'

describe('migration runner', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await createTestDatabase()
  })

  afterAll(async () => {
    await destroyTestDatabase(pool)
  })

  test('empty database applies 001, repeated run is idempotent', async () => {
    // createTestDatabase 已执行第一次
    const again = await runMigrations(pool, join(process.cwd(), 'migrations'))
    expect(again.applied).toEqual([])
    expect(again.skipped).toContain('001_initial.sql')

    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    )
    const tables = rows.map((r) => r.table_name as string)
    expect(tables).toContain('web_principals')
    expect(tables).toContain('web_sessions')
    expect(tables).toContain('user_preferences')
    expect(tables).toContain('conversation_locks')
    expect(tables).toContain('schema_migrations')
  })

  test('checksum change on applied migration refuses to run', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'webui-mig-'))
    try {
      cpSync(join(process.cwd(), 'migrations'), tmp, { recursive: true })
      writeFileSync(
        join(tmp, '001_initial.sql'),
        '-- tampered\n' + '\n-- touched for checksum test\n',
        'utf8',
      )
      await expect(runMigrations(pool, tmp)).rejects.toThrow(MigrationError)
      await expect(runMigrations(pool, tmp)).rejects.toThrow(/checksum mismatch/)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('failed migration rolls back atomically', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'webui-mig-'))
    try {
      cpSync(join(process.cwd(), 'migrations'), tmp, { recursive: true })
      writeFileSync(
        join(tmp, '002_bad.sql'),
        'CREATE TABLE should_not_exist (id int);\nTHIS IS NOT VALID SQL;',
        'utf8',
      )
      await expect(runMigrations(pool, tmp)).rejects.toThrow(MigrationError)
      const { rows } = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'should_not_exist'`,
      )
      expect(rows).toEqual([])
      // 002 未被记录为已应用
      const recorded = await pool.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        ['002_bad.sql'],
      )
      expect(recorded.rows).toEqual([])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
