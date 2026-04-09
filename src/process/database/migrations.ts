/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type Database from 'better-sqlite3';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

/**
 * Migration script definition
 */
export interface IMigration {
  version: number; // Target version after this migration
  name: string; // Migration name for logging
  up: (db: Database.Database) => void; // Upgrade script
  down: (db: Database.Database) => void; // Downgrade script (for rollback)
}

/**
 * Migration v0 -> v1: Initial schema
 * This is handled by initSchema() in schema.ts
 */
const migration_v1: IMigration = {
  version: 1,
  name: 'Initial schema',
  up: (_db) => {
    // Already handled by initSchema()
    mainLog('Migration v1', 'Initial schema created by initSchema()');
  },
  down: (db) => {
    // Drop all tables (only core tables now)
    db.exec(`
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS conversations;
      DROP TABLE IF EXISTS users;
    `);
    mainLog('Migration v1', 'Rolled back: All tables dropped');
  },
};

/**
 * Migration v1 -> v2: Add indexes for better performance
 * Example of a schema change migration
 */
const migration_v2: IMigration = {
  version: 2,
  name: 'Add performance indexes',
  up: (db) => {
    db.exec(`
      -- Add composite index for conversation messages lookup
      CREATE INDEX IF NOT EXISTS idx_messages_conv_created_desc
        ON messages(conversation_id, created_at DESC);

      -- Add index for message search by type
      CREATE INDEX IF NOT EXISTS idx_messages_type_created
        ON messages(type, created_at DESC);

      -- Add index for user conversations lookup
      CREATE INDEX IF NOT EXISTS idx_conversations_user_type
        ON conversations(user_id, type);
    `);
    mainLog('Migration v2', 'Added performance indexes');
  },
  down: (db) => {
    db.exec(`
      DROP INDEX IF EXISTS idx_messages_conv_created_desc;
      DROP INDEX IF EXISTS idx_messages_type_created;
      DROP INDEX IF EXISTS idx_conversations_user_type;
    `);
    mainLog('Migration v2', 'Rolled back: Removed performance indexes');
  },
};

/**
 * Migration v2 -> v3: Add full-text search support [REMOVED]
 *
 * Note: FTS functionality has been removed as it's not currently needed.
 * Will be re-implemented when search functionality is added to the UI.
 */
const migration_v3: IMigration = {
  version: 3,
  name: 'Add full-text search (skipped)',
  up: (_db) => {
    // FTS removed - will be re-added when search functionality is implemented
    mainLog('Migration v3', 'FTS support skipped (removed, will be added back later)');
  },
  down: (db) => {
    // Clean up FTS table if it exists from older versions
    db.exec(`
      DROP TABLE IF EXISTS messages_fts;
    `);
    mainLog('Migration v3', 'Rolled back: Removed full-text search');
  },
};

/**
 * Migration v3 -> v4: Removed (user_preferences table no longer needed)
 */
const migration_v4: IMigration = {
  version: 4,
  name: 'Removed user_preferences table',
  up: (_db) => {
    // user_preferences table removed from schema
    mainLog('Migration v4', 'Skipped (user_preferences table removed)');
  },
  down: (_db) => {
    mainLog('Migration v4', 'Rolled back: No-op (user_preferences table removed)');
  },
};

/**
 * Migration v4 -> v5: Remove FTS table
 * Cleanup for FTS removal - ensures all databases have consistent schema
 */
const migration_v5: IMigration = {
  version: 5,
  name: 'Remove FTS table',
  up: (db) => {
    // Remove FTS table created by old v3 migration
    db.exec(`
      DROP TABLE IF EXISTS messages_fts;
    `);
    mainLog('Migration v5', 'Removed FTS table (cleanup for FTS removal)');
  },
  down: (_db) => {
    // If rolling back, we don't recreate FTS table (it's deprecated)
    mainLog('Migration v5', 'Rolled back: FTS table remains removed (deprecated feature)');
  },
};

/**
 * Migration v5 -> v6: Add jwt_secret column to users table
 * Store JWT secret per user for better security and management
 */
const migration_v6: IMigration = {
  version: 6,
  name: 'Add jwt_secret to users table',
  up: (db) => {
    // Check if jwt_secret column already exists
    const tableInfo = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    const hasJwtSecret = tableInfo.some((col) => col.name === 'jwt_secret');

    if (!hasJwtSecret) {
      // Add jwt_secret column to users table
      db.exec(`ALTER TABLE users ADD COLUMN jwt_secret TEXT;`);
      mainLog('Migration v6', 'Added jwt_secret column to users table');
    } else {
      mainLog('Migration v6', 'jwt_secret column already exists, skipping');
    }
  },
  down: (db) => {
    // SQLite doesn't support DROP COLUMN directly, need to recreate table
    db.exec(`
      CREATE TABLE users_backup AS SELECT id, username, email, password_hash, avatar_path, created_at, updated_at, last_login FROM users;
      DROP TABLE users;
      ALTER TABLE users_backup RENAME TO users;
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);
    mainLog('Migration v6', 'Rolled back: Removed jwt_secret column from users table');
  },
};

/**
 * Migration v6 -> v7: Add Personal Assistant tables
 * Supports remote interaction through messaging platforms (Telegram, Slack, Discord)
 */
const migration_v7: IMigration = {
  version: 7,
  name: 'Add Personal Assistant tables',
  up: (db) => {
    // Assistant plugins configuration
    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_plugins (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('telegram')),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        status TEXT CHECK(status IN ('created', 'initializing', 'ready', 'starting', 'running', 'stopping', 'stopped', 'error')),
        last_connected INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_type ON assistant_plugins(type);
      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_enabled ON assistant_plugins(enabled);
    `);

    // Authorized users whitelist
    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_users (
        id TEXT PRIMARY KEY,
        platform_user_id TEXT NOT NULL,
        platform_type TEXT NOT NULL,
        display_name TEXT,
        authorized_at INTEGER NOT NULL,
        last_active INTEGER,
        session_id TEXT,
        UNIQUE(platform_user_id, platform_type)
      );

      CREATE INDEX IF NOT EXISTS idx_assistant_users_platform ON assistant_users(platform_type, platform_user_id);
    `);

    // User sessions
    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        agent_type TEXT NOT NULL CHECK(agent_type IN ('gemini', 'acp', 'codex')),
        conversation_id TEXT,
        workspace TEXT,
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES assistant_users(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_assistant_sessions_user ON assistant_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_assistant_sessions_conversation ON assistant_sessions(conversation_id);
    `);

    // Pending pairing requests
    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_pairing_codes (
        code TEXT PRIMARY KEY,
        platform_user_id TEXT NOT NULL,
        platform_type TEXT NOT NULL,
        display_name TEXT,
        requested_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'expired'))
      );

      CREATE INDEX IF NOT EXISTS idx_assistant_pairing_expires ON assistant_pairing_codes(expires_at);
      CREATE INDEX IF NOT EXISTS idx_assistant_pairing_status ON assistant_pairing_codes(status);
    `);

    mainLog('Migration v7', 'Added Personal Assistant tables');
  },
  down: (db) => {
    db.exec(`
      DROP TABLE IF EXISTS assistant_pairing_codes;
      DROP TABLE IF EXISTS assistant_sessions;
      DROP TABLE IF EXISTS assistant_users;
      DROP TABLE IF EXISTS assistant_plugins;
    `);
    mainLog('Migration v7', 'Rolled back: Removed Personal Assistant tables');
  },
};

/**
 * Migration v7 -> v8: Add source column to conversations table
 * 为 conversations 表添加 source 列，标识会话来源
 */
const migration_v8: IMigration = {
  version: 8,
  name: 'Add source column to conversations',
  up: (db) => {
    // Add source column to conversations table
    db.exec(`
      ALTER TABLE conversations ADD COLUMN source TEXT CHECK(source IN ('aionui', 'telegram'));
    `);

    // Create index for efficient source-based queries
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
    `);

    mainLog('Migration v8', 'Added source column to conversations table');
  },
  down: (db) => {
    // SQLite doesn't support DROP COLUMN directly, need to recreate table
    // For simplicity, just drop the indexes (column will remain)
    db.exec(`
      DROP INDEX IF EXISTS idx_conversations_source;
      DROP INDEX IF EXISTS idx_conversations_source_updated;
    `);
    mainLog('Migration v8', 'Rolled back: Removed source indexes');
  },
};

/**
 * Migration v8 -> v9: Add cron_jobs table for scheduled tasks
 */
const migration_v9: IMigration = {
  version: 9,
  name: 'Add cron_jobs table',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        -- Basic info
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,

        -- Schedule
        schedule_kind TEXT NOT NULL,       -- 'at' | 'every' | 'cron'
        schedule_value TEXT NOT NULL,      -- timestamp | ms | cron expr
        schedule_tz TEXT,                  -- timezone (optional)
        schedule_description TEXT NOT NULL, -- human-readable description

        -- Target
        payload_message TEXT NOT NULL,

        -- Metadata (for management)
        conversation_id TEXT NOT NULL,     -- Which conversation created this
        conversation_title TEXT,           -- For display in UI
        agent_type TEXT NOT NULL,          -- 'gemini' | 'claude' | 'codex' | etc.
        created_by TEXT NOT NULL,          -- 'user' | 'agent'
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),

        -- Runtime state
        next_run_at INTEGER,
        last_run_at INTEGER,
        last_status TEXT,                  -- 'ok' | 'error' | 'skipped'
        last_error TEXT,                   -- Error message if failed
        run_count INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3
      );

      -- Index for querying jobs by conversation (frontend management)
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_conversation ON cron_jobs(conversation_id);

      -- Index for scheduler to find next jobs to run
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;

      -- Index for querying by agent type (if needed)
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_agent_type ON cron_jobs(agent_type);
    `);
    mainLog('Migration v9', 'Added cron_jobs table');
  },
  down: (db) => {
    db.exec(`
      DROP INDEX IF EXISTS idx_cron_jobs_agent_type;
      DROP INDEX IF EXISTS idx_cron_jobs_next_run;
      DROP INDEX IF EXISTS idx_cron_jobs_conversation;
      DROP TABLE IF EXISTS cron_jobs;
    `);
    mainLog('Migration v9', 'Rolled back: Removed cron_jobs table');
  },
};

/**
 * Migration v9 -> v10: Add 'lark' to assistant_plugins type constraint
 * 为 assistant_plugins 表的 type 约束添加 'lark' 类型
 */
const migration_v10: IMigration = {
  version: 10,
  name: 'Add lark to assistant_plugins type constraint',
  up: (db) => {
    // SQLite doesn't support ALTER TABLE to modify CHECK constraints
    // We need to recreate the table with the new constraint
    db.exec(`
      -- Create new table with updated constraint
      CREATE TABLE IF NOT EXISTS assistant_plugins_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('telegram', 'lark', 'dingtalk')),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        status TEXT CHECK(status IN ('created', 'initializing', 'ready', 'starting', 'running', 'stopping', 'stopped', 'error')),
        last_connected INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Copy data from old table (if exists)
      INSERT OR IGNORE INTO assistant_plugins_new SELECT * FROM assistant_plugins;

      -- Drop old table
      DROP TABLE IF EXISTS assistant_plugins;

      -- Rename new table
      ALTER TABLE assistant_plugins_new RENAME TO assistant_plugins;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_type ON assistant_plugins(type);
      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_enabled ON assistant_plugins(enabled);
    `);

    mainLog('Migration v10', 'Added lark to assistant_plugins type constraint');
  },
  down: (db) => {
    // Rollback: recreate table without lark type (data with lark type will be lost)
    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_plugins_old (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('telegram')),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        status TEXT CHECK(status IN ('created', 'initializing', 'ready', 'starting', 'running', 'stopping', 'stopped', 'error')),
        last_connected INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO assistant_plugins_old SELECT * FROM assistant_plugins WHERE type != 'lark';

      DROP TABLE IF EXISTS assistant_plugins;

      ALTER TABLE assistant_plugins_old RENAME TO assistant_plugins;

      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_type ON assistant_plugins(type);
      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_enabled ON assistant_plugins(enabled);
    `);
    mainLog('Migration v10', 'Rolled back: Removed lark from assistant_plugins type constraint');
  },
};

/**
 * Migration v10 -> v11: Add 'openclaw-gateway' to conversations type constraint
 * 为 conversations 表的 type 约束添加 'openclaw-gateway' 类型
 */
const migration_v11: IMigration = {
  version: 11,
  name: 'Add openclaw-gateway to conversations type constraint',
  up: (db) => {
    // SQLite doesn't support ALTER TABLE to modify CHECK constraints.
    // We recreate the table with the new constraint.
    // NOTE: The migration runner disables foreign_keys before the transaction,
    // so DROP TABLE will NOT trigger ON DELETE CASCADE on the messages table.

    // Clean up any invalid source values before copying
    db.exec(`
      UPDATE conversations SET source = NULL WHERE source IS NOT NULL AND source NOT IN ('aionui', 'telegram');
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex', 'openclaw-gateway')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT CHECK(source IS NULL OR source IN ('aionui', 'telegram')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Use explicit columns (ALTER TABLE ADD COLUMN appends at the end,
      -- so column order in the old table may differ from the new table)
      INSERT INTO conversations_new (id, user_id, name, type, extra, model, status, source, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, created_at, updated_at FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_new RENAME TO conversations;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
    `);

    mainLog('Migration v11', 'Added openclaw-gateway to conversations type constraint');
  },
  down: (db) => {
    // Rollback: recreate table without openclaw-gateway type
    // (data with openclaw-gateway type will be lost)
    // NOTE: foreign_keys is disabled by the migration runner before the transaction.
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_rollback (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT CHECK(source IS NULL OR source IN ('aionui', 'telegram')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO conversations_rollback (id, user_id, name, type, extra, model, status, source, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, created_at, updated_at FROM conversations WHERE type != 'openclaw-gateway';

      DROP TABLE conversations;
      ALTER TABLE conversations_rollback RENAME TO conversations;

      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
    `);

    mainLog('Migration v11', 'Rolled back: Removed openclaw-gateway from conversations type constraint');
  },
};

/**
 * Migration v11 -> v12: Add 'lark' to conversations source CHECK constraint
 */
const migration_v12: IMigration = {
  version: 12,
  name: 'Add lark to conversations source constraint',
  up: (db) => {
    // SQLite doesn't support ALTER TABLE to modify CHECK constraints.
    // We recreate the table with the updated constraint that includes 'lark'.
    // NOTE: The migration runner disables foreign_keys before the transaction,
    // so DROP TABLE will NOT trigger ON DELETE CASCADE on the messages table.

    // Clean up any invalid source values before copying
    db.exec(`
      UPDATE conversations SET source = NULL WHERE source IS NOT NULL AND source NOT IN ('aionui', 'telegram', 'lark');
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex', 'openclaw-gateway')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT CHECK(source IS NULL OR source IN ('aionui', 'telegram', 'lark')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Use explicit columns (ALTER TABLE ADD COLUMN appends at the end,
      -- so column order in the old table may differ from the new table)
      INSERT INTO conversations_new (id, user_id, name, type, extra, model, status, source, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, created_at, updated_at FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_new RENAME TO conversations;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
    `);

    mainLog('Migration v12', 'Added lark to conversations source constraint');
  },
  down: (db) => {
    // Rollback: recreate table without 'lark' in source constraint
    // NOTE: foreign_keys is disabled by the migration runner before the transaction.

    // Clean up lark source values before copying to table with stricter constraint
    db.exec(`
      UPDATE conversations SET source = NULL WHERE source = 'lark';
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_rollback (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex', 'openclaw-gateway')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT CHECK(source IS NULL OR source IN ('aionui', 'telegram')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO conversations_rollback (id, user_id, name, type, extra, model, status, source, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, created_at, updated_at FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_rollback RENAME TO conversations;

      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
    `);

    mainLog('Migration v12', 'Rolled back: Removed lark from conversations source constraint');
  },
};

/**
 * Migration v12 -> v13: Add 'nanobot' to conversations type CHECK constraint
 */
const migration_v13: IMigration = {
  version: 13,
  name: 'Add nanobot to conversations type constraint',
  up: (db) => {
    // SQLite doesn't support ALTER TABLE to modify CHECK constraints.
    // We recreate the table with the updated constraint that includes 'nanobot'.
    // NOTE: The migration runner disables foreign_keys before the transaction,
    // so DROP TABLE will NOT trigger ON DELETE CASCADE on the messages table.

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT CHECK(source IS NULL OR source IN ('aionui', 'telegram', 'lark')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO conversations_new (id, user_id, name, type, extra, model, status, source, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, created_at, updated_at FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_new RENAME TO conversations;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
    `);

    mainLog('Migration v13', 'Added nanobot to conversations type constraint');
  },
  down: (db) => {
    // Rollback: recreate table without 'nanobot' in type constraint
    // NOTE: foreign_keys is disabled by the migration runner before the transaction.

    // Remove nanobot conversations before copying to table with stricter constraint
    db.exec(`
      DELETE FROM conversations WHERE type = 'nanobot';
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_rollback (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex', 'openclaw-gateway')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT CHECK(source IS NULL OR source IN ('aionui', 'telegram', 'lark')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO conversations_rollback (id, user_id, name, type, extra, model, status, source, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, created_at, updated_at FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_rollback RENAME TO conversations;

      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
    `);

    mainLog('Migration v13', 'Rolled back: Removed nanobot from conversations type constraint');
  },
};

/**
 * Migration v13 -> v14: Add 'dingtalk' to assistant_plugins type and conversations source CHECK constraints
 */
const migration_v14: IMigration = {
  version: 14,
  name: 'Add dingtalk to assistant_plugins type and conversations source constraints',
  up: (db) => {
    // 1. Recreate assistant_plugins with 'dingtalk' in type constraint
    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_plugins_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('telegram', 'lark', 'dingtalk')),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        status TEXT CHECK(status IN ('created', 'initializing', 'ready', 'starting', 'running', 'stopping', 'stopped', 'error')),
        last_connected INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO assistant_plugins_new SELECT * FROM assistant_plugins;

      DROP TABLE IF EXISTS assistant_plugins;

      ALTER TABLE assistant_plugins_new RENAME TO assistant_plugins;

      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_type ON assistant_plugins(type);
      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_enabled ON assistant_plugins(enabled);
    `);

    // 2. Recreate conversations with 'dingtalk' in source constraint
    // NOTE: The migration runner disables foreign_keys before the transaction,
    // so DROP TABLE will NOT trigger ON DELETE CASCADE on the messages table.
    db.exec(`
      UPDATE conversations SET source = NULL WHERE source IS NOT NULL AND source NOT IN ('aionui', 'telegram', 'lark', 'dingtalk');
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT CHECK(source IS NULL OR source IN ('aionui', 'telegram', 'lark', 'dingtalk')),
        channel_chat_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO conversations_new (id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, NULL, created_at, updated_at FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_new RENAME TO conversations;

      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_chat ON conversations(source, channel_chat_id, updated_at DESC);
    `);

    // 3. Add chat_id to assistant_sessions for per-chat session isolation
    const sessTableInfo = db.prepare('PRAGMA table_info(assistant_sessions)').all() as Array<{ name: string }>;
    if (!sessTableInfo.some((col) => col.name === 'chat_id')) {
      db.exec(`ALTER TABLE assistant_sessions ADD COLUMN chat_id TEXT;`);
    }

    mainLog('Migration v14', 'Added dingtalk support and channel_chat_id for per-chat isolation');
  },
  down: (db) => {
    // Rollback assistant_plugins: remove 'dingtalk'
    db.exec(`
      DELETE FROM assistant_plugins WHERE type = 'dingtalk';
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_plugins_old (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('telegram', 'lark')),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        status TEXT CHECK(status IN ('created', 'initializing', 'ready', 'starting', 'running', 'stopping', 'stopped', 'error')),
        last_connected INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO assistant_plugins_old SELECT * FROM assistant_plugins WHERE type != 'dingtalk';

      DROP TABLE IF EXISTS assistant_plugins;

      ALTER TABLE assistant_plugins_old RENAME TO assistant_plugins;

      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_type ON assistant_plugins(type);
      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_enabled ON assistant_plugins(enabled);
    `);

    // Rollback conversations: remove 'dingtalk' from source
    db.exec(`
      UPDATE conversations SET source = NULL WHERE source = 'dingtalk';
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_rollback (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT CHECK(source IS NULL OR source IN ('aionui', 'telegram', 'lark')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO conversations_rollback (id, user_id, name, type, extra, model, status, source, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, created_at, updated_at FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_rollback RENAME TO conversations;

      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
    `);

    mainLog('Migration v14', 'Rolled back: Removed dingtalk and channel_chat_id');
  },
};

/**
 * All migrations in order
 */
/**
 * Migration v14 -> v15: Remove strict CHECK constraints on type/source
 * to allow extension-contributed channel plugins.
 */
const migration_v15: IMigration = {
  version: 15,
  name: 'Remove strict constraints for extension channels',
  up: (db) => {
    // 1. Recreate assistant_plugins without strict type constraint
    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_plugins_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL, -- Removed CHECK constraint
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        status TEXT CHECK(status IN ('created', 'initializing', 'ready', 'starting', 'running', 'stopping', 'stopped', 'error')),
        last_connected INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO assistant_plugins_new SELECT * FROM assistant_plugins;
      DROP TABLE IF EXISTS assistant_plugins;
      ALTER TABLE assistant_plugins_new RENAME TO assistant_plugins;

      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_type ON assistant_plugins(type);
      CREATE INDEX IF NOT EXISTS idx_assistant_plugins_enabled ON assistant_plugins(enabled);
    `);

    // 2. Recreate conversations without strict source constraint
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT, -- Removed CHECK constraint
        channel_chat_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO conversations_new (id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_new RENAME TO conversations;

      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_chat ON conversations(source, channel_chat_id, updated_at DESC);
    `);

    mainLog('Migration v15', 'Removed strict constraints for extension channels');
  },
  down: (db) => {
    // Cannot safely rollback if there are custom types/sources in the database.
    // For now, we just log a warning and do nothing, or we could delete them.
    mainWarn('Migration v15', 'Rollback skipped to prevent data loss of extension channels.');
  },
};

/**
 * Migration v15 -> v16: Remove gemini/codex/nanobot conversation types
 * Migrate existing conversations to 'acp' type.
 */
const migration_v16: IMigration = {
  version: 16,
  name: 'Remove gemini/codex/nanobot conversation types',
  up: (db) => {
    // 1. Convert existing gemini/codex/nanobot conversations to 'acp' type.
    //    Update the extra JSON to include the original backend info.
    const legacyRows = db.prepare(`SELECT id, type, extra FROM conversations WHERE type IN ('gemini', 'codex', 'nanobot')`).all() as Array<{ id: string; type: string; extra: string }>;

    const updateStmt = db.prepare(`UPDATE conversations SET type = 'acp', extra = ? WHERE id = ?`);

    for (const row of legacyRows) {
      let extra: Record<string, unknown>;
      try {
        extra = JSON.parse(row.extra);
      } catch {
        extra = {};
      }
      // Set backend to the original type so the ACP agent manager knows which CLI to use
      if (!extra.backend) {
        if (row.type === 'gemini') {
          extra.backend = 'gemini';
        } else if (row.type === 'codex') {
          extra.backend = 'codex';
        } else if (row.type === 'nanobot') {
          extra.backend = 'claude'; // Nanobot has no meaningful backend; map to claude
        }
      }
      updateStmt.run(JSON.stringify(extra), row.id);
    }

    if (legacyRows.length > 0) {
      mainLog('Migration v16', `Converted ${legacyRows.length} legacy conversations to 'acp' type`);
    }

    // 2. Recreate conversations table with narrowed CHECK constraint
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('acp', 'openclaw-gateway')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT,
        channel_chat_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO conversations_new (id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_new RENAME TO conversations;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_chat ON conversations(source, channel_chat_id, updated_at DESC);
    `);

    // 3. Update channel_sessions agent_type if table exists
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='assistant_sessions'`).all() as Array<{ name: string }>;

    if (tables.length > 0) {
      db.exec(`
        UPDATE assistant_sessions SET agent_type = 'acp' WHERE agent_type IN ('gemini', 'codex', 'nanobot');
      `);
    }

    mainLog('Migration v16', 'Removed gemini/codex/nanobot conversation types');
  },
  down: (db) => {
    // Rollback: widen the CHECK constraint back to 5 types
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_rollback (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot')),
        extra TEXT NOT NULL,
        model TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'finished')),
        source TEXT,
        channel_chat_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO conversations_rollback (id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at)
      SELECT id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_rollback RENAME TO conversations;

      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_updated ON conversations(source, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_source_chat ON conversations(source, channel_chat_id, updated_at DESC);
    `);

    mainLog('Migration v16', 'Rolled back: Restored gemini/codex/nanobot conversation types');
  },
};

/**
 * Migration v16 -> v17: Add conversation_mode and last_conversation_id to cron_jobs
 * Supports "new conversation per run" (default) vs "reuse existing conversation" mode.
 */
const migration_v17: IMigration = {
  version: 17,
  name: 'Add conversation_mode and last_conversation_id to cron_jobs',
  up: (db) => {
    db.exec(`
      ALTER TABLE cron_jobs ADD COLUMN conversation_mode TEXT DEFAULT 'reuse';
      ALTER TABLE cron_jobs ADD COLUMN last_conversation_id TEXT;
    `);
    mainLog('Migration v17', 'Added conversation_mode and last_conversation_id to cron_jobs');
  },
  down: (db) => {
    // SQLite does not support DROP COLUMN in older versions, recreate the table
    db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs_v16 AS SELECT
        id, name, enabled,
        schedule_kind, schedule_value, schedule_tz, schedule_description,
        payload_message,
        conversation_id, conversation_title, agent_type, created_by,
        created_at, updated_at,
        next_run_at, last_run_at, last_status, last_error,
        run_count, retry_count, max_retries
      FROM cron_jobs;
      DROP TABLE cron_jobs;
      ALTER TABLE cron_jobs_v16 RENAME TO cron_jobs;
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_conversation ON cron_jobs(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_agent_type ON cron_jobs(agent_type);
    `);
    mainLog('Migration v17', 'Rolled back: Removed conversation_mode and last_conversation_id from cron_jobs');
  },
};

/**
 * Migration v17 -> v18: Add workspace column to cron_jobs
 * Stores the working directory chosen by the user when creating the scheduled task.
 */
const migration_v18: IMigration = {
  version: 18,
  name: 'Add workspace to cron_jobs',
  up: (db) => {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN workspace TEXT;`);
    mainLog('Migration v18', 'Added workspace to cron_jobs');
  },
  down: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs_v17 AS SELECT
        id, name, enabled,
        schedule_kind, schedule_value, schedule_tz, schedule_description,
        payload_message,
        conversation_id, conversation_title, agent_type, created_by,
        created_at, updated_at,
        next_run_at, last_run_at, last_status, last_error,
        run_count, retry_count, max_retries,
        conversation_mode, last_conversation_id
      FROM cron_jobs;
      DROP TABLE cron_jobs;
      ALTER TABLE cron_jobs_v17 RENAME TO cron_jobs;
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_conversation ON cron_jobs(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_agent_type ON cron_jobs(agent_type);
    `);
    mainLog('Migration v18', 'Rolled back: Removed workspace from cron_jobs');
  },
};

/**
 * Migration v18 -> v19: Add preset_assistant_id column to cron_jobs
 * Stores the selected preset assistant ID so the correct rules/skills are used at execution time.
 */
const migration_v19: IMigration = {
  version: 19,
  name: 'Add preset_assistant_id to cron_jobs',
  up: (db) => {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN preset_assistant_id TEXT;`);
    mainLog('Migration v19', 'Added preset_assistant_id to cron_jobs');
  },
  down: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs_v18 AS SELECT
        id, name, enabled,
        schedule_kind, schedule_value, schedule_tz, schedule_description,
        payload_message,
        conversation_id, conversation_title, agent_type, created_by,
        created_at, updated_at,
        next_run_at, last_run_at, last_status, last_error,
        run_count, retry_count, max_retries,
        conversation_mode, last_conversation_id, workspace
      FROM cron_jobs;
      DROP TABLE cron_jobs;
      ALTER TABLE cron_jobs_v18 RENAME TO cron_jobs;
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_conversation ON cron_jobs(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_agent_type ON cron_jobs(agent_type);
    `);
    mainLog('Migration v19', 'Rolled back: Removed preset_assistant_id from cron_jobs');
  },
};

/**
 * Migration v19 -> v20: Add SudoClaw tables (sudoclaw_state + sudoclaw_memory_log)
 *
 * sudoclaw_state  — singleton row holding the SudoClawManager runtime state.
 * sudoclaw_memory_log — append-only memory entries indexed by date.
 */
const migration_v20: IMigration = {
  version: 20,
  name: 'Add sudoclaw_state and sudoclaw_memory_log tables',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sudoclaw_state (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        conversation_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        is_proactive INTEGER NOT NULL DEFAULT 0,
        tick_interval_ms INTEGER NOT NULL DEFAULT 60000,
        sleep_until INTEGER,
        last_tick_at INTEGER,
        session_state TEXT NOT NULL DEFAULT 'idle',
        pending_question TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS sudoclaw_memory_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sudoclaw_memory_log_date ON sudoclaw_memory_log(date);
    `);
    mainLog('Migration v20', 'Created sudoclaw_state and sudoclaw_memory_log tables');
  },
  down: (db) => {
    db.exec(`
      DROP INDEX IF EXISTS idx_sudoclaw_memory_log_date;
      DROP TABLE IF EXISTS sudoclaw_memory_log;
      DROP TABLE IF EXISTS sudoclaw_state;
    `);
    mainLog('Migration v20', 'Rolled back: Dropped sudoclaw_state and sudoclaw_memory_log tables');
  },
};

/**
 * All migrations in order
 */
// prettier-ignore
export const ALL_MIGRATIONS: IMigration[] = [
  migration_v1, migration_v2, migration_v3, migration_v4, migration_v5, migration_v6,
  migration_v7, migration_v8, migration_v9, migration_v10, migration_v11, migration_v12,
  migration_v13, migration_v14, migration_v15, migration_v16, migration_v17, migration_v18,
  migration_v19, migration_v20,
];

/**
 * Get migrations needed to upgrade from one version to another
 */
export function getMigrationsToRun(fromVersion: number, toVersion: number): IMigration[] {
  return ALL_MIGRATIONS.filter((m) => m.version > fromVersion && m.version <= toVersion).sort((a, b) => a.version - b.version);
}

/**
 * Get migrations needed to downgrade from one version to another
 */
export function getMigrationsToRollback(fromVersion: number, toVersion: number): IMigration[] {
  return ALL_MIGRATIONS.filter((m) => m.version > toVersion && m.version <= fromVersion).sort((a, b) => b.version - a.version);
}

/**
 * Run migrations in a transaction
 */
export function runMigrations(db: Database.Database, fromVersion: number, toVersion: number): void {
  if (fromVersion === toVersion) {
    mainLog('Migrations', 'Already at target version');
    return;
  }

  if (fromVersion > toVersion) {
    throw new Error(`[Migrations] Downgrade not supported in production. Use rollbackMigration() for testing only.`);
  }

  const migrations = getMigrationsToRun(fromVersion, toVersion);

  if (migrations.length === 0) {
    mainLog('Migrations', `No migrations needed from v${fromVersion} to v${toVersion}`);
    return;
  }

  mainLog('Migrations', `Running ${migrations.length} migrations from v${fromVersion} to v${toVersion}`);

  // Disable foreign keys BEFORE the transaction to allow table recreation
  // (DROP TABLE + CREATE TABLE). PRAGMA foreign_keys cannot be changed inside
  // a transaction — it is silently ignored.
  // See: https://www.sqlite.org/lang_altertable.html#otheralter
  db.pragma('foreign_keys = OFF');

  // Run all migrations in a single transaction
  const runAll = db.transaction(() => {
    for (const migration of migrations) {
      try {
        mainLog('Migrations', `Running migration v${migration.version}: ${migration.name}`);
        migration.up(db);

        mainLog('Migrations', `✓ Migration v${migration.version} completed`);
      } catch (error) {
        mainError('Migrations', `✗ Migration v${migration.version} failed:`, error);
        throw error; // Transaction will rollback
      }
    }

    // Verify foreign key integrity after all migrations
    const fkViolations = db.pragma('foreign_key_check') as unknown[];
    if (fkViolations.length > 0) {
      mainError('Migrations', 'Foreign key violations detected:', fkViolations);
      throw new Error(`[Migrations] Foreign key check failed: ${fkViolations.length} violation(s)`);
    }
  });

  try {
    runAll();
    mainLog('Migrations', `All migrations completed successfully`);
  } catch (error) {
    mainError('Migrations', 'Migration failed, all changes rolled back:', error);
    throw error;
  } finally {
    // Re-enable foreign keys regardless of success or failure
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Rollback migrations (for testing/emergency use)
 * WARNING: This can cause data loss!
 */
export function rollbackMigrations(db: Database.Database, fromVersion: number, toVersion: number): void {
  if (fromVersion <= toVersion) {
    throw new Error('[Migrations] Cannot rollback to a higher or equal version');
  }

  const migrations = getMigrationsToRollback(fromVersion, toVersion);

  if (migrations.length === 0) {
    mainLog('Migrations', `No rollback needed from v${fromVersion} to v${toVersion}`);
    return;
  }

  mainLog('Migrations', `Rolling back ${migrations.length} migrations from v${fromVersion} to v${toVersion}`);
  mainWarn('Migrations', 'WARNING: This may cause data loss!');

  // Disable foreign keys BEFORE the transaction (same reason as runMigrations)
  db.pragma('foreign_keys = OFF');

  // Run all rollbacks in a single transaction
  const rollbackAll = db.transaction(() => {
    for (const migration of migrations) {
      try {
        mainLog('Migrations', `Rolling back migration v${migration.version}: ${migration.name}`);
        migration.down(db);

        mainLog('Migrations', `✓ Rollback v${migration.version} completed`);
      } catch (error) {
        mainError('Migrations', `✗ Rollback v${migration.version} failed:`, error);
        throw error; // Transaction will rollback
      }
    }

    // Verify foreign key integrity after rollback
    const fkViolations = db.pragma('foreign_key_check') as unknown[];
    if (fkViolations.length > 0) {
      mainError('Migrations', 'Foreign key violations detected after rollback:', fkViolations);
      throw new Error(`[Migrations] Foreign key check failed: ${fkViolations.length} violation(s)`);
    }
  });

  try {
    rollbackAll();
    mainLog('Migrations', `All rollbacks completed successfully`);
  } catch (error) {
    mainError('Migrations', 'Rollback failed:', error);
    throw error;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Get migration history
 * Now simplified - just returns the current version
 */
export function getMigrationHistory(db: Database.Database): Array<{ version: number; name: string; timestamp: number }> {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  // Return a simple array with just the current version
  return [
    {
      version: currentVersion,
      name: `Current schema version`,
      timestamp: Date.now(),
    },
  ];
}

/**
 * Check if a specific migration has been applied
 * Now simplified - checks if current version >= target version
 */
export function isMigrationApplied(db: Database.Database, version: number): boolean {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  return currentVersion >= version;
}
