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
    CREATE TABLE IF NOT EXISTS bid_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      budget TEXT NOT NULL,
      project_type TEXT NOT NULL,
      target TEXT NOT NULL,
      duration TEXT NOT NULL,
      procurement_method TEXT NOT NULL,
      remark TEXT NOT NULL,
      status TEXT NOT NULL,
      selected_template TEXT NOT NULL,
      current_draft_id TEXT,
      current_version TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bid_projects_updated_at ON bid_projects(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bid_projects_status ON bid_projects(status);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_project_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      parse_status TEXT NOT NULL,
      parse_error TEXT,
      extracted_text TEXT,
      summary TEXT,
      origin TEXT NOT NULL DEFAULT 'upload',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES bid_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bid_project_sources_project_id ON bid_project_sources(project_id);
    CREATE INDEX IF NOT EXISTS idx_bid_project_sources_parse_status ON bid_project_sources(parse_status);
    CREATE INDEX IF NOT EXISTS idx_bid_project_sources_origin ON bid_project_sources(origin);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_project_facts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      candidate_value TEXT NOT NULL,
      confidence REAL NOT NULL,
      source_file_id TEXT,
      source_snippet TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES bid_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (source_file_id) REFERENCES bid_project_sources(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bid_project_facts_project_id ON bid_project_facts(project_id);
    CREATE INDEX IF NOT EXISTS idx_bid_project_facts_status ON bid_project_facts(status);
    CREATE INDEX IF NOT EXISTS idx_bid_project_facts_field_name ON bid_project_facts(field_name);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_project_drafts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version TEXT NOT NULL,
      markdown TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES bid_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bid_project_drafts_project_id ON bid_project_drafts(project_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_project_sections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      section_key TEXT NOT NULL,
      section_title TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      content_markdown TEXT NOT NULL,
      status TEXT NOT NULL,
      is_locked INTEGER NOT NULL DEFAULT 0,
      citations_json TEXT NOT NULL DEFAULT '[]',
      asset_hits_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES bid_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (draft_id) REFERENCES bid_project_drafts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bid_project_sections_project_id ON bid_project_sections(project_id);
    CREATE INDEX IF NOT EXISTS idx_bid_project_sections_draft_id ON bid_project_sections(draft_id);
    CREATE INDEX IF NOT EXISTS idx_bid_project_sections_section_key ON bid_project_sections(section_key);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_project_review_issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      section_key TEXT,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      basis TEXT NOT NULL,
      fix_suggestion TEXT NOT NULL,
      status TEXT NOT NULL,
      citations_json TEXT NOT NULL DEFAULT '[]',
      asset_hits_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES bid_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (draft_id) REFERENCES bid_project_drafts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bid_project_review_issues_project_id ON bid_project_review_issues(project_id);
    CREATE INDEX IF NOT EXISTS idx_bid_project_review_issues_draft_id ON bid_project_review_issues(draft_id);
    CREATE INDEX IF NOT EXISTS idx_bid_project_review_issues_status ON bid_project_review_issues(status);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_project_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      version TEXT NOT NULL,
      source TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES bid_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (draft_id) REFERENCES bid_project_drafts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bid_project_versions_project_id ON bid_project_versions(project_id);
    CREATE INDEX IF NOT EXISTS idx_bid_project_versions_draft_id ON bid_project_versions(draft_id);
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
export const CURRENT_DB_VERSION = 25;
