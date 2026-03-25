/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const STORE_DIR = path.join(os.homedir(), '.sudowork', 'wechat-context-tokens');

/**
 * WeChatContextTokenStore - Manages per-(accountId, userId) context tokens.
 *
 * WeChat requires a context token for all replies. Each incoming message
 * includes a fresh context token that must be stored and used when replying.
 *
 * Storage: in-memory Map with write-through to file at
 * ~/.sudowork/wechat-context-tokens/{accountId}.json
 */
export class WeChatContextTokenStore {
  /** In-memory store: key = `${accountId}:${userId}` → context token */
  private tokens: Map<string, string> = new Map();

  /**
   * Build the composite key
   */
  private buildKey(accountId: string, userId: string): string {
    return `${accountId}:${userId}`;
  }

  /**
   * Get the context token for a user
   */
  get(accountId: string, userId: string): string | undefined {
    return this.tokens.get(this.buildKey(accountId, userId));
  }

  /**
   * Set (and persist) a context token for a user
   */
  set(accountId: string, userId: string, token: string): void {
    this.tokens.set(this.buildKey(accountId, userId), token);
    this.persistToFile(accountId);
  }

  /**
   * Restore all tokens for an accountId from disk
   */
  restore(accountId: string): void {
    const filePath = this.getFilePath(accountId);
    try {
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content) as Record<string, string>;
      for (const [userId, token] of Object.entries(data)) {
        if (typeof token === 'string') {
          this.tokens.set(this.buildKey(accountId, userId), token);
        }
      }
      console.log(`[WeChatContextTokenStore] Restored ${Object.keys(data).length} tokens for account ${accountId}`);
    } catch (error) {
      console.warn(`[WeChatContextTokenStore] Failed to restore tokens for ${accountId}:`, error);
    }
  }

  /**
   * Clear all tokens (e.g. on plugin stop)
   */
  clear(): void {
    this.tokens.clear();
  }

  /**
   * Persist all tokens for an accountId to file (write-through)
   */
  private persistToFile(accountId: string): void {
    const filePath = this.getFilePath(accountId);
    const prefix = `${accountId}:`;
    const data: Record<string, string> = {};

    for (const [key, value] of this.tokens) {
      if (key.startsWith(prefix)) {
        const userId = key.slice(prefix.length);
        data[userId] = value;
      }
    }

    try {
      fs.mkdirSync(STORE_DIR, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.warn(`[WeChatContextTokenStore] Failed to persist tokens:`, error);
    }
  }

  private getFilePath(accountId: string): string {
    // Sanitize accountId for filename safety
    const safeId = accountId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(STORE_DIR, `${safeId}.json`);
  }
}
