/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { ensureDirectory, getDataPath } from '@process/utils';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { resolveSecret, cachePut } from '@common/nexus/secret-cache';
import { SecretMigrationCoordinator } from '@common/nexus/secret-migration';
import type { IChannelPluginConfig, IChannelUser, IChannelSession, IChannelPairingRequest, IChannelUserRow, IChannelSessionRow, IChannelPairingCodeRow, PluginType, PluginStatus } from '@/channels/types';
import type { ScodeCustomModelProvider } from '@/common/scodeConfig';
import type { ConversationSource, TProviderWithModel } from '@/common/storage';
import type { ILocalKbBuildJob, ILocalKbCategory, ILocalKbDocument, ILocalKbSpace, LocalKbBuildJobMode, LocalKbBuildJobStatus, LocalKbBuildStatus, LocalKbDocumentSourceType, LocalKbParseStatus, LocalKbRetrievalMode, LocalKbSourceMode } from '@/common/types/localKnowledgeBase';
import { rowToChannelUser, rowToChannelSession, rowToPairingRequest } from '@/channels/types';
import { runMigrations as executeMigrations } from './migrations';
import { isCorruptDatabaseFileError } from './corruptionError';
import { CURRENT_DB_VERSION, getDatabaseVersion, initSchema, setDatabaseVersion } from './schema';
import type { IConversationRow, IMessageRow, IPaginatedResult, IQueryResult, IUser, TChatConversation, TMessage } from './types';
import { readWorkspacePathsForUser } from './workspaceQueries';
import { conversationToRow, messageToRow, rowToConversation, rowToMessage } from './types';

type LocalKbRow = Record<string, unknown>;

function mapLocalKbCategory(row: LocalKbRow): ILocalKbCategory {
  return {
    id: String(row.id),
    name: String(row.name),
    description: typeof row.description === 'string' ? row.description : null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapLocalKbSpace(row: LocalKbRow): ILocalKbSpace {
  return {
    id: String(row.id),
    categoryId: typeof row.category_id === 'string' ? row.category_id : null,
    name: String(row.name),
    description: typeof row.description === 'string' ? row.description : null,
    sourceMode: (['files', 'directory', 'mixed'].includes(String(row.source_mode)) ? String(row.source_mode) : 'files') as LocalKbSourceMode,
    rootPath: typeof row.root_path === 'string' ? row.root_path : null,
    buildStatus: (['idle', 'queued', 'running', 'ready', 'failed'].includes(String(row.build_status)) ? String(row.build_status) : 'idle') as LocalKbBuildStatus,
    retrievalMode: (row.retrieval_mode === 'hybrid' ? 'hybrid' : 'grep-only') as LocalKbRetrievalMode,
    lastBuiltAt: row.last_built_at == null ? null : Number(row.last_built_at),
    lastBuildError: typeof row.last_build_error === 'string' ? row.last_build_error : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapLocalKbDocument(row: LocalKbRow): ILocalKbDocument {
  return {
    id: String(row.id),
    spaceId: String(row.space_id),
    fileName: String(row.file_name),
    relativePath: typeof row.relative_path === 'string' ? row.relative_path : null,
    absolutePath: String(row.absolute_path),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    contentHash: String(row.content_hash),
    sourceType: (row.source_type === 'directory' ? 'directory' : 'file') as LocalKbDocumentSourceType,
    parseStatus: (['pending', 'parsed', 'failed'].includes(String(row.parse_status)) ? String(row.parse_status) : 'pending') as LocalKbParseStatus,
    parseError: typeof row.parse_error === 'string' ? row.parse_error : null,
    lastIndexedAt: row.last_indexed_at == null ? null : Number(row.last_indexed_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapLocalKbBuildJob(row: LocalKbRow): ILocalKbBuildJob {
  const status = (['queued', 'running', 'success', 'failed', 'cancelled'].includes(String(row.status)) ? String(row.status) : 'queued') as LocalKbBuildJobStatus;
  return {
    id: String(row.id),
    spaceId: String(row.space_id),
    mode: (row.mode === 'incremental' ? 'incremental' : 'full') as LocalKbBuildJobMode,
    status,
    progress: status === 'success' ? 100 : Number(row.progress ?? 0),
    currentStep: status === 'success' && Number(row.progress ?? 0) < 100 ? '构建完成' : typeof row.current_step === 'string' ? row.current_step : null,
    errorMessage: typeof row.error_message === 'string' ? row.error_message : null,
    startedAt: row.started_at == null ? null : Number(row.started_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    createdAt: Number(row.created_at),
  };
}

/**
 * Main database class for Sudowork
 * Uses better-sqlite3 for fast, synchronous SQLite operations
 */
export class SudoworkDatabase {
  private db: Database.Database;
  private readonly defaultUserId = 'system_default_user';
  private readonly systemPasswordPlaceholder = '';

  constructor() {
    const finalPath = path.join(getDataPath(), 'sudowork.db');
    mainLog('Database', `Initializing database at: ${finalPath}`);

    const dir = path.dirname(finalPath);
    ensureDirectory(dir);

    try {
      this.db = new BetterSqlite3(finalPath);
      this.initialize();
    } catch (error) {
      // Only a genuinely corrupt DB *file* may be safely renamed aside and recreated.
      // An engine/environment failure (missing or ABI-mismatched native binding,
      // permission denied, locked db) leaves the file perfectly intact — sidelining
      // it there would turn a recoverable install/runtime problem into apparent data
      // loss. So fail loud and leave the user's data untouched in that case.
      if (!isCorruptDatabaseFileError(error)) {
        mainError('Database', 'Failed to open database — not a file-corruption error, leaving the database file untouched.', error);
        throw error;
      }

      mainError('Database', 'Database file appears corrupted, attempting recovery...', error);
      // 尝试恢复：关闭并重新创建数据库
      // Try to recover by closing and recreating database
      try {
        if (this.db) {
          this.db.close();
        }
      } catch {
        // 忽略关闭错误
        // Ignore close errors
      }

      // 备份损坏的数据库文件
      // Backup corrupted database file.
      // WAL mode keeps recent committed transactions in the -wal sidecar until
      // checkpoint, with -shm as its shared-memory index. These MUST be handled
      // together with the main file: (a) moving them with the backup keeps it a
      // complete, restorable snapshot rather than a stale one, and (b) any -wal/-shm
      // left next to finalPath would be inherited by the fresh database created
      // below — SQLite associates them with the new file and can itself read the
      // mismatched WAL as corrupt. So move sidecars alongside the backup, and never
      // leave one behind.
      const sidecarSuffixes = ['-wal', '-shm'];
      if (fs.existsSync(finalPath)) {
        const backupPath = `${finalPath}.backup.${Date.now()}`;
        try {
          fs.renameSync(finalPath, backupPath);
          mainLog('Database', `Backed up corrupted database to: ${backupPath}`);
          for (const suffix of sidecarSuffixes) {
            const sidecar = `${finalPath}${suffix}`;
            if (!fs.existsSync(sidecar)) continue;
            try {
              fs.renameSync(sidecar, `${backupPath}${suffix}`);
            } catch {
              // If it can't travel with the backup, it must at least not remain
              // next to the fresh db — remove it.
              try {
                fs.unlinkSync(sidecar);
              } catch {
                // ignore
              }
            }
          }
        } catch (e) {
          mainError('Database', 'Failed to backup corrupted database:', e);
          // 备份失败则尝试直接删除
          // If backup fails, try to delete instead — including the WAL sidecars,
          // so the fresh db does not inherit a stale -wal/-shm.
          try {
            fs.unlinkSync(finalPath);
            for (const suffix of sidecarSuffixes) {
              try {
                fs.unlinkSync(`${finalPath}${suffix}`);
              } catch {
                // sidecar may not exist; ignore
              }
            }
            mainLog('Database', `Deleted corrupted database file`);
          } catch (e2) {
            mainError('Database', 'Failed to delete corrupted database:', e2);
            throw new Error('Database is corrupted and cannot be recovered. Please manually delete: ' + finalPath);
          }
        }
      }

      // 使用新数据库文件重试
      // Retry with fresh database file
      this.db = new BetterSqlite3(finalPath);
      this.initialize();
    }
  }

  private initialize(): void {
    try {
      initSchema(this.db);

      // Check and run migrations if needed
      const currentVersion = getDatabaseVersion(this.db);
      if (currentVersion < CURRENT_DB_VERSION) {
        this.runMigrations(currentVersion, CURRENT_DB_VERSION);
        setDatabaseVersion(this.db, CURRENT_DB_VERSION);
      }

      this.ensureSystemUser();
    } catch (error) {
      mainError('Database', 'Initialization failed:', error);
      throw error;
    }
  }

  private runMigrations(from: number, to: number): void {
    executeMigrations(this.db, from, to);
  }

  private ensureSystemUser(): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login, jwt_secret)
         VALUES (?, ?, NULL, ?, NULL, ?, ?, NULL, NULL)`
      )
      .run(this.defaultUserId, this.defaultUserId, this.systemPasswordPlaceholder, now, now);
  }

  getDefaultUserId(): string {
    return this.defaultUserId;
  }

  listLocalKbCategories(): ILocalKbCategory[] {
    const rows = this.db.prepare('SELECT * FROM local_kb_categories ORDER BY sort_order ASC, updated_at DESC').all() as LocalKbRow[];
    return rows.map(mapLocalKbCategory);
  }

  getLocalKbCategory(id: string): ILocalKbCategory | null {
    const row = this.db.prepare('SELECT * FROM local_kb_categories WHERE id = ?').get(id) as LocalKbRow | undefined;
    return row ? mapLocalKbCategory(row) : null;
  }

  createLocalKbCategory(input: { id: string; name: string; description?: string | null; sortOrder?: number }): ILocalKbCategory {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO local_kb_categories (id, name, description, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.id, input.name, input.description ?? null, input.sortOrder ?? 0, now, now);
    return this.getLocalKbCategory(input.id)!;
  }

  updateLocalKbCategory(id: string, updates: { name?: string; description?: string | null; sortOrder?: number }): ILocalKbCategory | null {
    const existing = this.getLocalKbCategory(id);
    if (!existing) return null;
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE local_kb_categories
         SET name = ?, description = ?, sort_order = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(updates.name ?? existing.name, updates.description === undefined ? existing.description : updates.description, updates.sortOrder ?? existing.sortOrder, now, id);
    return this.getLocalKbCategory(id);
  }

  deleteLocalKbCategory(id: string): void {
    this.db.prepare('DELETE FROM local_kb_categories WHERE id = ?').run(id);
  }

  listLocalKbSpaces(categoryId?: string | null): ILocalKbSpace[] {
    const rows = categoryId === undefined ? (this.db.prepare('SELECT * FROM local_kb_spaces ORDER BY updated_at DESC').all() as LocalKbRow[]) : (this.db.prepare('SELECT * FROM local_kb_spaces WHERE category_id IS ? ORDER BY updated_at DESC').all(categoryId) as LocalKbRow[]);
    return rows.map(mapLocalKbSpace);
  }

  getLocalKbSpace(id: string): ILocalKbSpace | null {
    const row = this.db.prepare('SELECT * FROM local_kb_spaces WHERE id = ?').get(id) as LocalKbRow | undefined;
    return row ? mapLocalKbSpace(row) : null;
  }

  createLocalKbSpace(input: { id: string; categoryId?: string | null; name: string; description?: string | null; sourceMode?: LocalKbSourceMode; rootPath?: string | null }): ILocalKbSpace {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO local_kb_spaces (
          id, category_id, name, description, source_mode, root_path,
          build_status, retrieval_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'idle', 'grep-only', ?, ?)`
      )
      .run(input.id, input.categoryId ?? null, input.name, input.description ?? null, input.sourceMode ?? 'files', input.rootPath ?? null, now, now);
    return this.getLocalKbSpace(input.id)!;
  }

  updateLocalKbSpace(
    id: string,
    updates: Partial<{
      categoryId: string | null;
      name: string;
      description: string | null;
      sourceMode: LocalKbSourceMode;
      rootPath: string | null;
      buildStatus: LocalKbBuildStatus;
      retrievalMode: LocalKbRetrievalMode;
      lastBuiltAt: number | null;
      lastBuildError: string | null;
    }>
  ): ILocalKbSpace | null {
    const existing = this.getLocalKbSpace(id);
    if (!existing) return null;
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE local_kb_spaces
         SET category_id = ?, name = ?, description = ?, source_mode = ?, root_path = ?,
             build_status = ?, retrieval_mode = ?, last_built_at = ?, last_build_error = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        updates.categoryId === undefined ? existing.categoryId : updates.categoryId,
        updates.name ?? existing.name,
        updates.description === undefined ? existing.description : updates.description,
        updates.sourceMode ?? existing.sourceMode,
        updates.rootPath === undefined ? existing.rootPath : updates.rootPath,
        updates.buildStatus ?? existing.buildStatus,
        updates.retrievalMode ?? existing.retrievalMode,
        updates.lastBuiltAt === undefined ? existing.lastBuiltAt : updates.lastBuiltAt,
        updates.lastBuildError === undefined ? existing.lastBuildError : updates.lastBuildError,
        now,
        id
      );
    return this.getLocalKbSpace(id);
  }

  deleteLocalKbSpace(id: string): void {
    this.db.prepare('DELETE FROM local_kb_spaces WHERE id = ?').run(id);
  }

  listLocalKbDocuments(spaceId: string): ILocalKbDocument[] {
    const rows = this.db.prepare('SELECT * FROM local_kb_documents WHERE space_id = ? ORDER BY relative_path ASC, file_name ASC').all(spaceId) as LocalKbRow[];
    return rows.map(mapLocalKbDocument);
  }

  getLocalKbDocument(id: string): ILocalKbDocument | null {
    const row = this.db.prepare('SELECT * FROM local_kb_documents WHERE id = ?').get(id) as LocalKbRow | undefined;
    return row ? mapLocalKbDocument(row) : null;
  }

  upsertLocalKbDocument(input: {
    id: string;
    spaceId: string;
    fileName: string;
    relativePath?: string | null;
    absolutePath: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
    sourceType: LocalKbDocumentSourceType;
    parseStatus?: LocalKbParseStatus;
    parseError?: string | null;
  }): ILocalKbDocument {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO local_kb_documents (
          id, space_id, file_name, relative_path, absolute_path, mime_type, size_bytes,
          content_hash, source_type, parse_status, parse_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          file_name = excluded.file_name,
          relative_path = excluded.relative_path,
          absolute_path = excluded.absolute_path,
          mime_type = excluded.mime_type,
          size_bytes = excluded.size_bytes,
          content_hash = excluded.content_hash,
          source_type = excluded.source_type,
          parse_status = excluded.parse_status,
          parse_error = excluded.parse_error,
          updated_at = excluded.updated_at`
      )
      .run(input.id, input.spaceId, input.fileName, input.relativePath ?? null, input.absolutePath, input.mimeType, input.sizeBytes, input.contentHash, input.sourceType, input.parseStatus ?? 'pending', input.parseError ?? null, now, now);
    return this.getLocalKbDocument(input.id)!;
  }

  updateLocalKbDocumentParse(id: string, updates: { parseStatus: LocalKbParseStatus; parseError?: string | null; lastIndexedAt?: number | null }): ILocalKbDocument | null {
    const existing = this.getLocalKbDocument(id);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE local_kb_documents
         SET parse_status = ?, parse_error = ?, last_indexed_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(updates.parseStatus, updates.parseError ?? null, updates.lastIndexedAt === undefined ? existing.lastIndexedAt : updates.lastIndexedAt, Date.now(), id);
    return this.getLocalKbDocument(id);
  }

  markLocalKbDocumentsIndexed(ids: string[], indexedAt = Date.now()): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare('UPDATE local_kb_documents SET last_indexed_at = ?, updated_at = ? WHERE id = ?');
    const mark = this.db.transaction((docIds: string[]) => {
      for (const id of docIds) {
        stmt.run(indexedAt, indexedAt, id);
      }
    });
    mark(ids);
  }

  deleteLocalKbDocumentsForSpace(spaceId: string, sourceType?: LocalKbDocumentSourceType): void {
    if (sourceType) {
      this.db.prepare('DELETE FROM local_kb_documents WHERE space_id = ? AND source_type = ?').run(spaceId, sourceType);
      return;
    }
    this.db.prepare('DELETE FROM local_kb_documents WHERE space_id = ?').run(spaceId);
  }

  deleteLocalKbDocument(id: string): void {
    this.db.prepare('DELETE FROM local_kb_documents WHERE id = ?').run(id);
  }

  createLocalKbBuildJob(input: { id: string; spaceId: string; mode?: LocalKbBuildJobMode }): ILocalKbBuildJob {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO local_kb_build_jobs (id, space_id, mode, status, progress, created_at)
         VALUES (?, ?, ?, 'queued', 0, ?)`
      )
      .run(input.id, input.spaceId, input.mode ?? 'full', now);
    return this.getLocalKbBuildJob(input.id)!;
  }

  getLocalKbBuildJob(id: string): ILocalKbBuildJob | null {
    const row = this.db.prepare('SELECT * FROM local_kb_build_jobs WHERE id = ?').get(id) as LocalKbRow | undefined;
    return row ? mapLocalKbBuildJob(row) : null;
  }

  getLatestLocalKbBuildJob(spaceId: string): ILocalKbBuildJob | null {
    const row = this.db.prepare('SELECT * FROM local_kb_build_jobs WHERE space_id = ? ORDER BY created_at DESC LIMIT 1').get(spaceId) as LocalKbRow | undefined;
    return row ? mapLocalKbBuildJob(row) : null;
  }

  listLocalKbBuildJobs(spaceId: string, limit = 20): ILocalKbBuildJob[] {
    const rows = this.db.prepare('SELECT * FROM local_kb_build_jobs WHERE space_id = ? ORDER BY created_at DESC LIMIT ?').all(spaceId, limit) as LocalKbRow[];
    return rows.map(mapLocalKbBuildJob);
  }

  listQueuedLocalKbBuildJobs(limit = 2): ILocalKbBuildJob[] {
    const rows = this.db.prepare("SELECT * FROM local_kb_build_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?").all(limit) as LocalKbRow[];
    return rows.map(mapLocalKbBuildJob);
  }

  getActiveLocalKbBuildJob(spaceId: string): ILocalKbBuildJob | null {
    const row = this.db.prepare("SELECT * FROM local_kb_build_jobs WHERE space_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1").get(spaceId) as LocalKbRow | undefined;
    return row ? mapLocalKbBuildJob(row) : null;
  }

  markInterruptedLocalKbBuildJobs(): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE local_kb_build_jobs
         SET status = 'failed',
             current_step = '构建已中断',
             error_message = 'Sudowork exited before this build finished.',
             finished_at = ?
         WHERE status = 'running'`
      )
      .run(now);
    this.db
      .prepare(
        `UPDATE local_kb_spaces
         SET build_status = 'failed',
             last_build_error = 'Sudowork exited before the previous build finished.',
             updated_at = ?
         WHERE id IN (
           SELECT DISTINCT space_id FROM local_kb_build_jobs
           WHERE status = 'failed'
             AND finished_at = ?
             AND error_message = 'Sudowork exited before this build finished.'
         )`
      )
      .run(now, now);
  }

  updateLocalKbBuildJob(
    id: string,
    updates: Partial<{
      status: LocalKbBuildJobStatus;
      progress: number;
      currentStep: string | null;
      errorMessage: string | null;
      startedAt: number | null;
      finishedAt: number | null;
    }>
  ): ILocalKbBuildJob | null {
    const existing = this.getLocalKbBuildJob(id);
    if (!existing) return null;
    const isTerminal = ['success', 'failed', 'cancelled'].includes(existing.status);
    if (isTerminal && updates.status === undefined) {
      return existing;
    }
    this.db
      .prepare(
        `UPDATE local_kb_build_jobs
         SET status = ?, progress = ?, current_step = ?, error_message = ?, started_at = ?, finished_at = ?
         WHERE id = ?`
      )
      .run(
        updates.status ?? existing.status,
        updates.progress ?? existing.progress,
        updates.currentStep === undefined ? existing.currentStep : updates.currentStep,
        updates.errorMessage === undefined ? existing.errorMessage : updates.errorMessage,
        updates.startedAt === undefined ? existing.startedAt : updates.startedAt,
        updates.finishedAt === undefined ? existing.finishedAt : updates.finishedAt,
        id
      );
    return this.getLocalKbBuildJob(id);
  }

  getSystemUser(): IUser | null {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(this.defaultUserId) as IUser | undefined;
    return user ?? null;
  }

  setSystemUserCredentials(username: string, passwordHash: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE users
         SET username = ?, password_hash = ?, updated_at = ?, created_at = COALESCE(created_at, ?)
         WHERE id = ?`
      )
      .run(username, passwordHash, now, now, this.defaultUserId);
  }
  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * ==================
   * User operations
   * 用户操作
   * ==================
   */

  /**
   * Create a new user in the database
   * 在数据库中创建新用户
   *
   * @param username - Username (unique identifier)
   * @param email - User email (optional)
   * @param passwordHash - Hashed password (use bcrypt)
   * @returns Query result with created user data
   */
  createUser(username: string, email: string | undefined, passwordHash: string): IQueryResult<IUser> {
    try {
      const userId = `user_${Date.now()}`;
      const now = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login)
        VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)
      `);

      stmt.run(userId, username, email ?? null, passwordHash, now, now);

      return {
        success: true,
        data: {
          id: userId,
          username,
          email,
          password_hash: passwordHash,
          created_at: now,
          updated_at: now,
          last_login: null,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get user by user ID
   * 通过用户 ID 获取用户信息
   *
   * @param userId - User ID to query
   * @returns Query result with user data or error if not found
   */
  getUser(userId: string): IQueryResult<IUser> {
    try {
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as IUser | undefined;

      if (!user) {
        return {
          success: false,
          error: 'User not found',
        };
      }

      return {
        success: true,
        data: user,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get user by username (used for authentication)
   * 通过用户名获取用户信息（用于身份验证）
   *
   * @param username - Username to query
   * @returns Query result with user data or null if not found
   */
  getUserByUsername(username: string): IQueryResult<IUser | null> {
    try {
      const user = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as IUser | undefined;

      return {
        success: true,
        data: user ?? null,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  /**
   * Get all users (excluding system default user)
   * 获取所有用户（排除系统默认用户）
   *
   * @returns Query result with array of all users ordered by creation time
   */
  getAllUsers(): IQueryResult<IUser[]> {
    try {
      const stmt = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC');
      const rows = stmt.all() as IUser[];

      return {
        success: true,
        data: rows,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: [],
      };
    }
  }

  /**
   * Get total count of users (excluding system default user)
   * 获取用户总数（排除系统默认用户）
   *
   * @returns Query result with user count
   */
  getUserCount(): IQueryResult<number> {
    try {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM users');
      const row = stmt.get() as { count: number };

      return {
        success: true,
        data: row.count,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: 0,
      };
    }
  }

  /**
   * Check if any users exist in the database
   * 检查数据库中是否存在用户
   *
   * @returns Query result with boolean indicating if users exist
   */
  hasUsers(): IQueryResult<boolean> {
    try {
      // 只统计已设置密码的账户，排除尚未完成初始化的占位行
      // Count only accounts with a non-empty password to ignore placeholder entries
      const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL AND TRIM(password_hash) != ''`);
      const row = stmt.get() as { count: number };
      return {
        success: true,
        data: row.count > 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update user's last login timestamp
   * 更新用户的最后登录时间戳
   *
   * @param userId - User ID to update
   * @returns Query result with success status
   */
  updateUserLastLogin(userId: string): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').run(now, now, userId);
      return {
        success: true,
        data: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: false,
      };
    }
  }

  /**
   * Update user's password hash
   * 更新用户的密码哈希
   *
   * @param userId - User ID to update
   * @param newPasswordHash - New hashed password (use bcrypt)
   * @returns Query result with success status
   */
  updateUserPassword(userId: string, newPasswordHash: string): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newPasswordHash, now, userId);
      return {
        success: true,
        data: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: false,
      };
    }
  }

  /**
   * Update user's JWT secret
   * 更新用户的 JWT secret
   */
  updateUserJwtSecret(userId: string, jwtSecret: string): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db.prepare('UPDATE users SET jwt_secret = ?, updated_at = ? WHERE id = ?').run(jwtSecret, now, userId);
      return {
        success: true,
        data: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: false,
      };
    }
  }

  /**
   * ==================
   * Conversation operations
   * ==================
   */

  createConversation(conversation: TChatConversation, userId?: string): IQueryResult<TChatConversation> {
    try {
      const row = conversationToRow(conversation, userId || this.defaultUserId);

      const stmt = this.db.prepare(`
        INSERT INTO conversations (id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(row.id, row.user_id, row.name, row.type, row.extra, row.model, row.status, row.source, row.channel_chat_id ?? null, row.created_at, row.updated_at);

      return {
        success: true,
        data: conversation,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generic typed query accessor — returns all matching rows.
   * Caller asserts the row type T. Use for SELECT queries.
   */
  query<T>(sql: string, ...params: unknown[]): IQueryResult<T[]> {
    try {
      const rows = this.db.prepare(sql).all(...(params as never[])) as T[];
      return { success: true, data: rows };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Generic typed query accessor — returns a single row (or null).
   */
  queryOne<T>(sql: string, ...params: unknown[]): IQueryResult<T | null> {
    try {
      const row = this.db.prepare(sql).get(...(params as never[])) as T | undefined;
      return { success: true, data: row ?? null };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Generic typed mutate accessor — runs INSERT/UPDATE/DELETE, returns rows affected.
   */
  mutate(sql: string, ...params: unknown[]): IQueryResult<number> {
    try {
      const result = this.db.prepare(sql).run(...(params as never[]));
      return { success: true, data: result.changes };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Generic typed transaction accessor — runs fn inside a DB transaction.
   */
  runTransaction<T>(fn: () => T): IQueryResult<T> {
    try {
      const tx = this.db.transaction(fn);
      const data = tx();
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  getConversation(conversationId: string): IQueryResult<TChatConversation> {
    try {
      const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as IConversationRow | undefined;

      if (!row) {
        return {
          success: false,
          error: 'Conversation not found',
        };
      }

      return {
        success: true,
        data: rowToConversation(row),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Find the latest channel conversation by source, chat ID, type, and optionally backend.
   * Used for per-chat conversation isolation in channel platforms.
   *
   * For ACP conversations, `backend` distinguishes between claude, iflow, codebuddy, etc.
   * (stored in `extra.backend` JSON field).
   */
  findChannelConversation(source: ConversationSource, channelChatId: string, type: string, backend?: string, userId?: string): IQueryResult<TChatConversation | null> {
    try {
      const finalUserId = userId || this.defaultUserId;

      let row: IConversationRow | undefined;
      if (backend) {
        row = this.db
          .prepare(
            `
            SELECT * FROM conversations
            WHERE user_id = ? AND source = ? AND channel_chat_id = ? AND type = ?
              AND json_extract(extra, '$.backend') = ?
            ORDER BY updated_at DESC
            LIMIT 1
          `
          )
          .get(finalUserId, source, channelChatId, type, backend) as IConversationRow | undefined;
      } else {
        row = this.db
          .prepare(
            `
            SELECT * FROM conversations
            WHERE user_id = ? AND source = ? AND channel_chat_id = ? AND type = ?
            ORDER BY updated_at DESC
            LIMIT 1
          `
          )
          .get(finalUserId, source, channelChatId, type) as IConversationRow | undefined;
      }

      return {
        success: true,
        data: row ? rowToConversation(row) : null,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Batch-update the model field on channel conversations matching source + type.
   * Used when channel settings change to propagate new model to existing conversations.
   */
  updateChannelConversationModel(source: 'telegram' | 'lark' | 'dingtalk' | 'wechat', type: string, model: TProviderWithModel, userId?: string): IQueryResult<number> {
    try {
      const finalUserId = userId || this.defaultUserId;
      const modelJson = JSON.stringify(model);
      const now = Date.now();
      const stmt = this.db.prepare(`
        UPDATE conversations SET model = ?, updated_at = ?
        WHERE user_id = ? AND source = ? AND type = ?
      `);
      const result = stmt.run(modelJson, now, finalUserId, source, type);
      return { success: true, data: result.changes };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getUserConversations(userId?: string, page = 0, pageSize = 50): IPaginatedResult<TChatConversation> {
    try {
      const finalUserId = userId || this.defaultUserId;

      const countResult = this.db.prepare("SELECT COUNT(*) as count FROM conversations WHERE user_id = ? AND json_extract(extra, '$.isTeamMember') IS NULL").get(finalUserId) as {
        count: number;
      };

      const rows = this.db
        .prepare(
          `
            SELECT *
            FROM conversations
            WHERE user_id = ? AND json_extract(extra, '$.isTeamMember') IS NULL
            ORDER BY updated_at DESC LIMIT ?
            OFFSET ?
          `
        )
        .all(finalUserId, pageSize, page * pageSize) as IConversationRow[];

      return {
        data: rows.map(rowToConversation),
        total: countResult.count,
        page,
        pageSize,
        hasMore: (page + 1) * pageSize < countResult.count,
      };
    } catch (error: any) {
      mainError('Database', 'Get conversations error:', error);
      return {
        data: [],
        total: 0,
        page,
        pageSize,
        hasMore: false,
      };
    }
  }

  updateConversation(conversationId: string, updates: Partial<TChatConversation>): IQueryResult<boolean> {
    try {
      const existing = this.getConversation(conversationId);
      if (!existing.success || !existing.data) {
        return {
          success: false,
          error: 'Conversation not found',
        };
      }

      const updated = {
        ...existing.data,
        ...updates,
        modifyTime: Date.now(),
      } as TChatConversation;
      const row = conversationToRow(updated, this.defaultUserId);

      const stmt = this.db.prepare(`
        UPDATE conversations
        SET name       = ?,
            extra      = ?,
            model      = ?,
            status     = ?,
            updated_at = ?
        WHERE id = ?
      `);

      stmt.run(row.name, row.extra, row.model, row.status, row.updated_at, conversationId);

      return {
        success: true,
        data: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Batch update workspace path for all conversations matching the old path
   * 批量更新所有匹配旧路径的对话的 workspace 路径
   *
   * Used when physically renaming a workspace directory.
   * Only updates extra.workspace, does NOT change conversation.name (title).
   */
  updateWorkspacePath(oldPath: string, newPath: string): IQueryResult<number> {
    try {
      // Find all conversations with this workspace path in their extra JSON
      const findStmt = this.db.prepare(`SELECT id, extra FROM conversations WHERE json_extract(extra, '$.workspace') = ?`);
      const rows = findStmt.all(oldPath) as Array<{ id: string; extra: string }>;

      if (rows.length === 0) {
        return { success: true, data: 0 };
      }

      const updateStmt = this.db.prepare(`UPDATE conversations SET extra = json_set(extra, '$.workspace', ?), updated_at = ? WHERE id = ?`);

      const now = Date.now();
      const transaction = this.db.transaction(() => {
        for (const row of rows) {
          updateStmt.run(newPath, now, row.id);
        }
      });
      transaction();

      return { success: true, data: rows.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update workspace display name for all conversations with the given workspace path.
   * Only updates the displayName field in extra JSON, does NOT change the physical workspace path.
   * 更新指定工作空间路径的所有会话的显示名称，不改变物理路径。
   */
  updateWorkspaceDisplayName(workspace: string, displayName: string): IQueryResult<number> {
    try {
      const findStmt = this.db.prepare(`SELECT id FROM conversations WHERE json_extract(extra, '$.workspace') = ?`);
      const rows = findStmt.all(workspace) as Array<{ id: string }>;

      if (rows.length === 0) {
        return { success: true, data: 0 };
      }

      const updateStmt = this.db.prepare(`UPDATE conversations SET extra = json_set(extra, '$.workspaceDisplayName', ?), updated_at = ? WHERE id = ?`);

      const now = Date.now();
      const transaction = this.db.transaction(() => {
        for (const row of rows) {
          updateStmt.run(displayName, now, row.id);
        }
      });
      transaction();

      return { success: true, data: rows.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Workspace paths of every default-user conversation, INCLUDING team-member
   * conversations (no isTeamMember filter). Used by the orphan workspace sweeper
   * to build its live-workspace set.
   */
  getAllConversationWorkspaces(): string[] {
    return readWorkspacePathsForUser(this.db, this.defaultUserId);
  }

  deleteConversation(conversationId: string): IQueryResult<boolean> {
    try {
      const stmt = this.db.prepare('DELETE FROM conversations WHERE id = ?');
      const result = stmt.run(conversationId);

      return {
        success: true,
        data: result.changes > 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * ==================
   * Message operations
   * ==================
   */

  insertMessage(message: TMessage): IQueryResult<TMessage> {
    try {
      const row = messageToRow(message);

      const stmt = this.db.prepare(`
        INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(row.id, row.conversation_id, row.msg_id, row.type, row.content, row.position, row.status, row.created_at);

      return {
        success: true,
        data: message,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  insertMessageIfNotExists(message: TMessage): IQueryResult<TMessage> & { inserted: boolean } {
    try {
      const row = messageToRow(message);
      const existing = this.db.prepare('SELECT id FROM messages WHERE conversation_id = ? AND msg_id = ? AND type = ? LIMIT 1').get(row.conversation_id, row.msg_id, row.type);
      if (existing) return { success: true, data: message, inserted: false };
      this.db
        .prepare(
          `
        INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(row.id, row.conversation_id, row.msg_id, row.type, row.content, row.position, row.status, row.created_at);
      return { success: true, data: message, inserted: true };
    } catch (error: any) {
      return { success: false, error: error.message, inserted: false };
    }
  }

  getConversationMessages(conversationId: string, page = 0, pageSize = 100, order = 'ASC'): IPaginatedResult<TMessage> {
    try {
      const countResult = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?').get(conversationId) as {
        count: number;
      };

      const rows = this.db
        .prepare(
          `
            SELECT *
            FROM messages
            WHERE conversation_id = ?
            ORDER BY created_at ${order}, rowid ${order} LIMIT ?
            OFFSET ?
          `
        )
        .all(conversationId, pageSize, page * pageSize) as IMessageRow[];

      return {
        data: rows.map(rowToMessage),
        total: countResult.count,
        page,
        pageSize,
        hasMore: (page + 1) * pageSize < countResult.count,
      };
    } catch (error: any) {
      mainError('Database', 'Get messages error:', error);
      return {
        data: [],
        total: 0,
        page,
        pageSize,
        hasMore: false,
      };
    }
  }

  /**
   * Update a message in the database
   * @param messageId - Message ID to update
   * @param message - Updated message data
   */
  updateMessage(messageId: string, message: TMessage): IQueryResult<boolean> {
    try {
      const row = messageToRow(message);

      const stmt = this.db.prepare(`
        UPDATE messages
        SET type     = ?,
            content  = ?,
            position = ?,
            status   = ?
        WHERE id = ?
      `);

      const result = stmt.run(row.type, row.content, row.position, row.status, messageId);

      return {
        success: true,
        data: result.changes > 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  deleteMessage(messageId: string): IQueryResult<boolean> {
    try {
      const stmt = this.db.prepare('DELETE FROM messages WHERE id = ?');
      const result = stmt.run(messageId);

      return {
        success: true,
        data: result.changes > 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  deleteConversationMessages(conversationId: string): IQueryResult<number> {
    try {
      const stmt = this.db.prepare('DELETE FROM messages WHERE conversation_id = ?');
      const result = stmt.run(conversationId);

      return {
        success: true,
        data: result.changes,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get message by msg_id and conversation_id
   * Used for finding existing messages to update (e.g., streaming text accumulation)
   */
  getMessageByMsgId(conversationId: string, msgId: string, type: TMessage['type']): IQueryResult<TMessage | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT *
        FROM messages
        WHERE conversation_id = ?
          AND msg_id = ?
          AND type = ?
        ORDER BY created_at DESC LIMIT 1
      `);

      const row = stmt.get(conversationId, msgId, type) as IMessageRow | undefined;

      return {
        success: true,
        data: row ? rowToMessage(row) : null,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * ==================
   * Channel Plugin operations
   * 个人助手插件操作
   * ==================
   */

  /**
   * Get all assistant plugins
   *
   * After migration:
   * - Credentials are read ONLY from Nexus (source of truth)
   * - Original storage (SQLite) only provides metadata (name, enabled, status, config)
   */
  getChannelPlugins(): IQueryResult<IChannelPluginConfig[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM assistant_plugins ORDER BY created_at ASC').all() as Array<{
        id: string;
        type: string;
        name: string;
        enabled: number;
        config: string;
        status: string | null;
        last_connected: number | null;
        created_at: number;
        updated_at: number;
      }>;

      const plugins: IChannelPluginConfig[] = rows.map((row) => {
        const storedConfig = JSON.parse(row.config || '{}');
        const credentialFields = SecretMigrationCoordinator.getChannelCredentialFields(row.type);
        const namespace = `channel:${row.type}:${row.id}`;

        // Build credentials object - read credential fields from Nexus (secret fields)
        const credentials: Record<string, string | undefined> = {};
        for (const field of credentialFields) {
          credentials[field] = resolveSecret(namespace, field, '');
        }

        // Merge ID fields from SQLite config (not stored in Nexus after migration)
        // Before migration, all credentials were stored in SQLite config.credentials
        // After migration, only secret fields go to Nexus, ID fields remain in SQLite config
        if (storedConfig.credentials) {
          for (const [key, value] of Object.entries(storedConfig.credentials)) {
            if (!credentialFields.includes(key) && typeof value === 'string' && value) {
              credentials[key] = value;
            }
          }
        }

        return {
          id: row.id,
          type: row.type as PluginType,
          name: row.name,
          enabled: row.enabled === 1,
          credentials: credentials as any,
          config: storedConfig.config,
          status: (row.status as PluginStatus) || 'stopped',
          lastConnected: row.last_connected ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });

      return { success: true, data: plugins };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Get assistant plugin by ID
   *
   * After migration:
   * - Credentials are read ONLY from Nexus (source of truth)
   * - Original storage (SQLite) only provides metadata (name, enabled, status, config)
   */
  getChannelPlugin(pluginId: string): IQueryResult<IChannelPluginConfig | null> {
    try {
      const row = this.db.prepare('SELECT * FROM assistant_plugins WHERE id = ?').get(pluginId) as
        | {
            id: string;
            type: string;
            name: string;
            enabled: number;
            config: string;
            status: string | null;
            last_connected: number | null;
            created_at: number;
            updated_at: number;
          }
        | undefined;

      if (!row) {
        return { success: true, data: null };
      }

      const storedConfig = JSON.parse(row.config || '{}');
      const credentialFields = SecretMigrationCoordinator.getChannelCredentialFields(row.type);
      const namespace = `channel:${row.type}:${row.id}`;

      // Build credentials object - read credential fields from Nexus (secret fields)
      const credentials: Record<string, string | undefined> = {};
      for (const field of credentialFields) {
        credentials[field] = resolveSecret(namespace, field, '');
      }

      // Merge ID fields from SQLite config (not stored in Nexus after migration)
      // Before migration, all credentials were stored in SQLite config.credentials
      // After migration, only secret fields go to Nexus, ID fields remain in SQLite config
      if (storedConfig.credentials) {
        for (const [key, value] of Object.entries(storedConfig.credentials)) {
          if (!credentialFields.includes(key) && typeof value === 'string' && value) {
            credentials[key] = value;
          }
        }
      }

      const plugin: IChannelPluginConfig = {
        id: row.id,
        type: row.type as PluginType,
        name: row.name,
        enabled: row.enabled === 1,
        credentials: credentials as any,
        config: storedConfig.config,
        status: (row.status as PluginStatus) || 'stopped',
        lastConnected: row.last_connected ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      return { success: true, data: plugin };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create or update assistant plugin
   *
   * After migration:
   * - ALL credentials are stored ONLY in Nexus (Nexus is source of truth)
   * - Original storage (SQLite) is frozen for credentials - no longer maintained
   * - Plugin metadata (name, enabled, status, config) continues to be stored in SQLite
   */
  upsertChannelPlugin(plugin: IChannelPluginConfig): IQueryResult<boolean> {
    try {
      const now = Date.now();

      // Store plugin metadata (non-credential fields) in SQLite
      // Note: config field is kept for backwards compatibility but credentials are NOT stored here
      const stmt = this.db.prepare(`
        INSERT INTO assistant_plugins (id, type, name, enabled, config, status, last_connected, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          enabled = excluded.enabled,
          config = excluded.config,
          status = excluded.status,
          last_connected = excluded.last_connected,
          updated_at = excluded.updated_at
      `);

      // Store non-credential config in SQLite
      // Also store ID fields (not in credentialFields) that should be preserved but not stored in Nexus
      const credentialFields = SecretMigrationCoordinator.getChannelCredentialFields(plugin.type);
      const idFields: Record<string, string> = {};
      if (plugin.credentials) {
        for (const [key, value] of Object.entries(plugin.credentials)) {
          if (!credentialFields.includes(key) && typeof value === 'string' && value) {
            idFields[key] = value;
          }
        }
      }
      const storedConfig = {
        config: plugin.config,
        credentials: idFields, // Store ID fields that are not in Nexus
      };

      stmt.run(plugin.id, plugin.type, plugin.name, plugin.enabled ? 1 : 0, JSON.stringify(storedConfig), plugin.status, plugin.lastConnected ?? null, plugin.createdAt || now, now);

      // Credentials are stored ONLY in Nexus after migration (Nexus is source of truth)
      // Original storage (SQLite) is frozen for credentials - no longer maintained
      if (plugin.credentials) {
        const credentialFields = SecretMigrationCoordinator.getChannelCredentialFields(plugin.type);
        const namespace = `channel:${plugin.type}:${plugin.id}`;

        for (const field of credentialFields) {
          const value = plugin.credentials[field];
          if (typeof value === 'string') {
            cachePut(namespace, field, value);
          }
        }
      }

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update assistant plugin status
   */
  updateChannelPluginStatus(pluginId: string, status: PluginStatus, lastConnected?: number): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db.prepare('UPDATE assistant_plugins SET status = ?, last_connected = COALESCE(?, last_connected), updated_at = ? WHERE id = ?').run(status, lastConnected ?? null, now, pluginId);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update assistant plugin enabled/disabled status only.
   * Does NOT update config or trigger credential save to Nexus.
   */
  updateChannelPluginEnabled(pluginId: string, enabled: boolean, status: PluginStatus): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db.prepare('UPDATE assistant_plugins SET enabled = ?, status = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, status, now, pluginId);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete assistant plugin
   */
  deleteChannelPlugin(pluginId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM assistant_plugins WHERE id = ?').run(pluginId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * ==================
   * Channel User operations
   * 个人助手用户操作
   * ==================
   */

  /**
   * Get all authorized assistant users
   */
  getChannelUsers(): IQueryResult<IChannelUser[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM assistant_users ORDER BY authorized_at DESC').all() as IChannelUserRow[];
      return { success: true, data: rows.map(rowToChannelUser) };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Get assistant user by platform user ID
   */
  getChannelUserByPlatform(platformUserId: string, platformType: PluginType): IQueryResult<IChannelUser | null> {
    try {
      const row = this.db.prepare('SELECT * FROM assistant_users WHERE platform_user_id = ? AND platform_type = ?').get(platformUserId, platformType) as IChannelUserRow | undefined;

      return { success: true, data: row ? rowToChannelUser(row) : null };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create assistant user (authorize)
   */
  createChannelUser(user: IChannelUser): IQueryResult<IChannelUser> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO assistant_users (id, platform_user_id, platform_type, display_name, authorized_at, last_active, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(user.id, user.platformUserId, user.platformType, user.displayName ?? null, user.authorizedAt, user.lastActive ?? null, user.sessionId ?? null);

      return { success: true, data: user };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update assistant user's last active time
   */
  updateChannelUserActivity(userId: string): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db.prepare('UPDATE assistant_users SET last_active = ? WHERE id = ?').run(now, userId);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete assistant user (revoke authorization)
   */
  deleteChannelUser(userId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM assistant_users WHERE id = ?').run(userId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete all channel users for a specific platform
   * Used when disabling a channel to clear all authorized users
   */
  deleteChannelUsersByPlatform(platformType: string): IQueryResult<number> {
    try {
      // First delete sessions for users of this platform (foreign key constraint)
      this.db.prepare('DELETE FROM assistant_sessions WHERE user_id IN (SELECT id FROM assistant_users WHERE platform_type = ?)').run(platformType);
      // Then delete the users
      const result = this.db.prepare('DELETE FROM assistant_users WHERE platform_type = ?').run(platformType);
      return { success: true, data: result.changes };
    } catch (error: any) {
      return { success: false, error: error.message, data: 0 };
    }
  }

  /**
   * ==================
   * Channel Session operations
   * 个人助手会话操作
   * ==================
   */

  /**
   * Get all active assistant sessions
   */
  getChannelSessions(): IQueryResult<IChannelSession[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM assistant_sessions ORDER BY last_activity DESC').all() as IChannelSessionRow[];
      return { success: true, data: rows.map(rowToChannelSession) };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Get assistant session by user ID
   */
  getChannelSessionByUser(userId: string): IQueryResult<IChannelSession | null> {
    try {
      const row = this.db.prepare('SELECT * FROM assistant_sessions WHERE user_id = ?').get(userId) as IChannelSessionRow | undefined;
      return { success: true, data: row ? rowToChannelSession(row) : null };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create or update assistant session
   */
  upsertChannelSession(session: IChannelSession): IQueryResult<boolean> {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(`
        INSERT INTO assistant_sessions (id, user_id, agent_type, conversation_id, workspace, chat_id, created_at, last_activity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          agent_type = excluded.agent_type,
          conversation_id = excluded.conversation_id,
          workspace = excluded.workspace,
          chat_id = excluded.chat_id,
          last_activity = excluded.last_activity
      `);

      stmt.run(session.id, session.userId, session.agentType, session.conversationId ?? null, session.workspace ?? null, session.chatId ?? null, session.createdAt || now, session.lastActivity || now);

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete assistant session
   */
  deleteChannelSession(sessionId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM assistant_sessions WHERE id = ?').run(sessionId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * ==================
   * Channel Pairing Code operations
   * 个人助手配对码操作
   * ==================
   */

  /**
   * Get all pending pairing requests
   */
  getPendingPairingRequests(): IQueryResult<IChannelPairingRequest[]> {
    try {
      const now = Date.now();
      const rows = this.db.prepare("SELECT * FROM assistant_pairing_codes WHERE status = 'pending' AND expires_at > ? ORDER BY requested_at DESC").all(now) as IChannelPairingCodeRow[];
      return { success: true, data: rows.map(rowToPairingRequest) };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Get pairing request by code
   */
  getPairingRequestByCode(code: string): IQueryResult<IChannelPairingRequest | null> {
    try {
      const row = this.db.prepare('SELECT * FROM assistant_pairing_codes WHERE code = ?').get(code) as IChannelPairingCodeRow | undefined;
      return { success: true, data: row ? rowToPairingRequest(row) : null };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create pairing request
   */
  createPairingRequest(request: IChannelPairingRequest): IQueryResult<IChannelPairingRequest> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO assistant_pairing_codes (code, platform_user_id, platform_type, display_name, requested_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(request.code, request.platformUserId, request.platformType, request.displayName ?? null, request.requestedAt, request.expiresAt, request.status);

      return { success: true, data: request };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update pairing request status
   */
  updatePairingRequestStatus(code: string, status: IChannelPairingRequest['status']): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('UPDATE assistant_pairing_codes SET status = ? WHERE code = ?').run(status, code);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete expired pairing requests
   */
  cleanupExpiredPairingRequests(): IQueryResult<number> {
    try {
      const now = Date.now();
      const result = this.db.prepare("DELETE FROM assistant_pairing_codes WHERE expires_at < ? OR status != 'pending'").run(now);
      return { success: true, data: result.changes };
    } catch (error: any) {
      return { success: false, error: error.message, data: 0 };
    }
  }

  /**
   * Vacuum database to reclaim space
   */
  vacuum(): void {
    this.db.exec('VACUUM');
    mainLog('Database', 'Vacuum completed');
  }

  /**
   * Find the ids of all conversations associated with a specific preset assistant.
   * Read-only; used by the reaper path so the actual delete goes through
   * reapConversation (which releases every resource, not just DB rows).
   *
   * @param presetAssistantId - The assistant ID (UUID or name) to match against extra.presetAssistantId
   * @returns Query result with the matched conversation ids
   */
  findConversationIdsByPresetAssistantId(presetAssistantId: string): IQueryResult<{ conversationIds: string[] }> {
    try {
      const findStmt = this.db.prepare(`SELECT id FROM conversations WHERE json_extract(extra, '$.presetAssistantId') = ?`);
      const rows = findStmt.all(presetAssistantId) as Array<{ id: string }>;
      return { success: true, data: { conversationIds: rows.map((r) => r.id) } };
    } catch (error: any) {
      mainError('Database', 'Failed to find conversations by presetAssistantId:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete all conversations associated with a specific preset assistant.
   * Used when deleting a custom assistant to cleanup related conversations.
   *
   * @param presetAssistantId - The assistant ID (UUID or name) to match against extra.presetAssistantId
   * @returns Query result with the count of deleted conversations
   */
  deleteConversationsByPresetAssistantId(presetAssistantId: string): IQueryResult<{ count: number; conversationIds: string[] }> {
    try {
      // Find all conversations with this presetAssistantId
      const findStmt = this.db.prepare(`SELECT id FROM conversations WHERE json_extract(extra, '$.presetAssistantId') = ?`);
      const rows = findStmt.all(presetAssistantId) as Array<{ id: string }>;

      if (rows.length === 0) {
        return { success: true, data: { count: 0, conversationIds: [] } };
      }

      const conversationIds = rows.map((r) => r.id);
      // Delete messages first (foreign key constraint)
      const deleteMessagesStmt = this.db.prepare('DELETE FROM messages WHERE conversation_id = ?');
      // Delete conversations
      const deleteConvStmt = this.db.prepare('DELETE FROM conversations WHERE id = ?');

      const transaction = this.db.transaction(() => {
        for (const id of conversationIds) {
          deleteMessagesStmt.run(id);
          deleteConvStmt.run(id);
        }
      });
      transaction();

      mainLog('Database', `Deleted ${conversationIds.length} conversations for assistant ${presetAssistantId}`);

      return { success: true, data: { count: conversationIds.length, conversationIds } };
    } catch (error: any) {
      mainError('Database', 'Failed to delete conversations by presetAssistantId:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get raw assistant plugin records for secret migration.
   * Returns original credential data from SQLite without going through Nexus.
   * Used by SecretMigrationCoordinator during initial migration.
   */
  getAssistantPluginsForMigration(): Array<{ id: string; type: string; config: string }> {
    return this.db.prepare('SELECT id, type, config FROM assistant_plugins').all() as Array<{
      id: string;
      type: string;
      config: string;
    }>;
  }

  getScodeCustomModelProviders(userId: string): ScodeCustomModelProvider[] {
    const rows = this.db
      .prepare(
        `SELECT provider_id, base_url, api_key, models
         FROM scode_custom_model_providers
         WHERE user_id = ?
         ORDER BY provider_id ASC`
      )
      .all(userId) as Array<{ provider_id: string; base_url: string; api_key: string; models: string }>;

    return rows.map((row) => {
      let models: ScodeCustomModelProvider['models'] = [];
      try {
        const parsed = JSON.parse(row.models);
        models = Array.isArray(parsed) ? parsed : [];
      } catch {
        models = [];
      }

      return {
        providerId: row.provider_id,
        baseUrl: row.base_url,
        apiKey: row.api_key,
        models,
      };
    });
  }

  replaceScodeCustomModelProviders(userId: string, providers: ScodeCustomModelProvider[]): void {
    const now = Date.now();
    const deleteStmt = this.db.prepare('DELETE FROM scode_custom_model_providers WHERE user_id = ?');
    const insertStmt = this.db.prepare(`
      INSERT INTO scode_custom_model_providers (user_id, provider_id, base_url, api_key, models, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      deleteStmt.run(userId);
      for (const provider of providers) {
        insertStmt.run(userId, provider.providerId, provider.baseUrl, provider.apiKey, JSON.stringify(provider.models), now, now);
      }
    });

    transaction();
  }
}

// Export singleton instance
let dbInstance: SudoworkDatabase | null = null;

export function getDatabase(): SudoworkDatabase {
  if (!dbInstance) {
    dbInstance = new SudoworkDatabase();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
