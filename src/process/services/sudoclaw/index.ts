/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw — Persistent Assistant Service
 *
 * Exports the SudoClawManager class and a global registry that tracks
 * all active persistent-mode conversations. The registry is the entry
 * point for `resume()` on app restart.
 */

import { getDatabase } from '@process/database';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { SudoClawManager } from './SudoClawManager';
import type { SudoClawState } from './SudoClawManager';

// Re-export types and class for external consumers
export { SudoClawManager } from './SudoClawManager';
export type { SudoClawState, SessionState } from './SudoClawManager';

// ─────────────────────────────────────────────────────────────────────────────
//  SudoClawRegistry — Global registry of active persistent conversations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global registry that manages all active SudoClawManager instances.
 *
 * Responsibilities:
 * - Track active persistent conversations (one manager per conversation)
 * - Resume all persistent conversations on app restart
 * - Provide lookup by conversationId for message routing
 *
 * Usage:
 *   // Enable persistent mode for a conversation
 *   const manager = await sudoClawRegistry.enable(conversationId);
 *
 *   // On app restart
 *   await sudoClawRegistry.resumeAll();
 *
 *   // Check if a conversation has persistent mode
 *   const manager = sudoClawRegistry.get(conversationId);
 */
class SudoClawRegistry {
  private managers = new Map<string, SudoClawManager>();
  private initialized = false;

  /**
   * Enable persistent mode for a conversation.
   *
   * @param conversationId - The conversation to promote
   * @param options - Optional tick interval and proactive mode settings
   * @returns The created SudoClawManager instance
   * @throws If the conversation or agent task cannot be found
   */
  async enable(
    conversationId: string,
    options?: { tickIntervalMs?: number; isProactive?: boolean },
  ): Promise<SudoClawManager> {
    // Check if already enabled
    const existing = this.managers.get(conversationId);
    if (existing?.isEnabled) {
      mainLog('SudoClawRegistry', `Conversation ${conversationId} is already in persistent mode`);
      return existing;
    }

    // Clean up any stale manager
    if (existing) {
      existing.dispose();
      this.managers.delete(conversationId);
    }

    const manager = await SudoClawManager.enable(conversationId, options);
    this.managers.set(conversationId, manager);
    mainLog('SudoClawRegistry', `Registered persistent conversation: ${conversationId} (total: ${this.managers.size})`);
    return manager;
  }

  /**
   * Disable persistent mode for a conversation.
   *
   * @param conversationId - The conversation to demote
   */
  async disable(conversationId: string): Promise<void> {
    const manager = this.managers.get(conversationId);
    if (!manager) {
      mainLog('SudoClawRegistry', `No persistent manager found for ${conversationId}`);
      return;
    }

    await manager.disable();
    this.managers.delete(conversationId);
    mainLog('SudoClawRegistry', `Unregistered persistent conversation: ${conversationId} (total: ${this.managers.size})`);
  }

  /**
   * Get the SudoClawManager for a conversation, if it exists and is active.
   */
  get(conversationId: string): SudoClawManager | undefined {
    const manager = this.managers.get(conversationId);
    return manager?.isEnabled ? manager : undefined;
  }

  /**
   * Check if a conversation is in persistent mode.
   */
  has(conversationId: string): boolean {
    return this.get(conversationId) !== undefined;
  }

  /**
   * Resume all previously enabled persistent conversations.
   *
   * Called once during app startup. Scans the database for conversations
   * with `extra.sudoClaw.enabled === true` and creates managers for each.
   */
  async resumeAll(): Promise<void> {
    if (this.initialized) {
      mainLog('SudoClawRegistry', 'Already initialized, skipping resumeAll');
      return;
    }

    mainLog('SudoClawRegistry', 'Resuming all persistent conversations...');
    this.initialized = true;

    try {
      const db = getDatabase();
      // Paginate through all conversations — filter for sudoClaw-enabled ones.
      // Uses getUserConversations which returns paginated results.
      let resumed = 0;
      let skipped = 0;
      let page = 0;
      const pageSize = 100;
      let hasMore = true;

      while (hasMore) {
        const result = db.getUserConversations(undefined, page, pageSize);
        const conversations = result.data ?? [];

        for (const conv of conversations) {
          try {
            const extra = conv.extra as Record<string, unknown> | undefined;
            const sudoClawState = extra?.sudoClaw as SudoClawState | undefined;

            if (!sudoClawState?.enabled) {
              continue;
            }

            const manager = await SudoClawManager.resume(conv.id);
            if (manager) {
              this.managers.set(conv.id, manager);
              resumed++;
            } else {
              skipped++;
            }
          } catch (err) {
            mainWarn('SudoClawRegistry', `Failed to resume conversation ${conv.id}: ${err}`);
            skipped++;
          }
        }

        hasMore = result.hasMore;
        page++;
      }

      mainLog('SudoClawRegistry', `Resume complete: ${resumed} resumed, ${skipped} skipped (total active: ${this.managers.size})`);
    } catch (err) {
      mainError('SudoClawRegistry', `Failed to resume persistent conversations: ${err}`);
    }
  }

  /**
   * Get all active manager instances.
   */
  getAll(): SudoClawManager[] {
    return Array.from(this.managers.values()).filter((m) => m.isEnabled);
  }

  /**
   * Get the count of active persistent conversations.
   */
  get size(): number {
    return this.managers.size;
  }

  /**
   * Dispose all managers and clear the registry.
   * Called during app shutdown.
   */
  disposeAll(): void {
    mainLog('SudoClawRegistry', `Disposing all managers (${this.managers.size} active)`);
    for (const manager of this.managers.values()) {
      manager.dispose();
    }
    this.managers.clear();
    this.initialized = false;
  }

  /**
   * Remove a manager for a specific conversation without disabling it.
   * Used when a conversation is deleted.
   */
  remove(conversationId: string): void {
    const manager = this.managers.get(conversationId);
    if (manager) {
      manager.dispose();
      this.managers.delete(conversationId);
    }
  }
}

// Singleton instance
export const sudoClawRegistry = new SudoClawRegistry();
