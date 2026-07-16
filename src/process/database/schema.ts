/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type Database from 'better-sqlite3';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/**
 * Initialize database schema with all tables and indexes
 */
export function initSchema(db: Database.Database): void {
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  // Enable Write-Ahead Logging for better performance
  try {
    db.pragma('journal_mode = WAL');
  } catch (error) {
    mainWarn('Database', 'Failed to enable WAL mode, using default journal mode:', error);
    // Continue with default journal mode if WAL fails
  }

  // Users table (账户系统)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      avatar_path TEXT,
      jwt_secret TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  // Conversations table (会话表 - 存储TChatConversation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('acp', 'remote-agent')),
      extra TEXT NOT NULL,
      model TEXT,
      status TEXT CHECK(status IN ('pending', 'running', 'finished')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
    CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
  `);

  // Messages table (消息表 - 存储TMessage)
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      msg_id TEXT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      position TEXT CHECK(position IN ('left', 'right', 'center', 'pop')),
      status TEXT CHECK(status IN ('finish', 'pending', 'error', 'work')),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
    CREATE INDEX IF NOT EXISTS idx_messages_msg_id ON messages(msg_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS scode_custom_model_providers (
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      models TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, provider_id)
    );

    CREATE INDEX IF NOT EXISTS idx_scode_custom_model_providers_user_id
      ON scode_custom_model_providers(user_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS local_kb_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_kb_spaces (
      id TEXT PRIMARY KEY,
      category_id TEXT REFERENCES local_kb_categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT,
      source_mode TEXT NOT NULL DEFAULT 'files',
      root_path TEXT,
      build_status TEXT NOT NULL DEFAULT 'idle',
      retrieval_mode TEXT NOT NULL DEFAULT 'grep-only',
      last_built_at INTEGER,
      last_build_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_local_kb_spaces_category_id
      ON local_kb_spaces(category_id);
    CREATE INDEX IF NOT EXISTS idx_local_kb_spaces_updated_at
      ON local_kb_spaces(updated_at DESC);

    CREATE TABLE IF NOT EXISTS local_kb_documents (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES local_kb_spaces(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      relative_path TEXT,
      absolute_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      source_type TEXT NOT NULL,
      parse_status TEXT NOT NULL DEFAULT 'pending',
      parse_error TEXT,
      last_indexed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_local_kb_documents_space_id
      ON local_kb_documents(space_id);
    CREATE INDEX IF NOT EXISTS idx_local_kb_documents_hash
      ON local_kb_documents(space_id, content_hash);

    CREATE TABLE IF NOT EXISTS local_kb_build_jobs (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES local_kb_spaces(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'full',
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      current_step TEXT,
      error_message TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_local_kb_build_jobs_space_id
      ON local_kb_build_jobs(space_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_local_kb_build_jobs_status
      ON local_kb_build_jobs(status, created_at);

    CREATE TABLE IF NOT EXISTS local_kb_query_logs (
      id TEXT PRIMARY KEY,
      space_id TEXT,
      query TEXT NOT NULL,
      mode TEXT NOT NULL,
      hit_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  mainLog('Database', 'Schema initialized successfully');
}

/**
 * Get database version for migration tracking
 * Uses SQLite's built-in user_version pragma
 */
export function getDatabaseVersion(db: Database.Database): number {
  try {
    const result = db.pragma('user_version', { simple: true }) as number;
    return result;
  } catch {
    return 0;
  }
}

/**
 * Set database version
 * Uses SQLite's built-in user_version pragma
 */
export function setDatabaseVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

/**
 * Current database schema version
 * Update this when adding new migrations in migrations.ts
 */
export const CURRENT_DB_VERSION = 29;
