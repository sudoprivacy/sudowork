/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import nodePath from 'node:path';
import { parseGeneratedFilesMarker, type GeneratedFileEntry } from '@/common/generatedFiles';
import { getDatabase } from '@process/database';
import { mainError } from '@process/utils/mainLogger';

/**
 * Aggregates AI-generated file deliverables across the lifetime of a
 * conversation by scanning the persisted assistant `text` messages for
 * `[[NEXUS_GENERATED_FILES]]` markers.
 *
 * Why scan-on-demand instead of a dedicated table:
 *  - Conversations are typically <200 messages, scan is sub-millisecond.
 *  - No schema migration / migration backfill cost.
 *  - Markers ARE the persistent representation — a separate table would
 *    just denormalize the same data, with all the consistency risks.
 *
 * Dedup rule: when the same absolute path appears in multiple turns
 * (e.g. AI re-generated a file), the newest entry wins. This matches
 * the "deliverables" mental model — what the user has TODAY, not a log
 * of every iteration.
 */
class DeliverablesService {
  /**
   * Return the deduplicated list of AI-generated files surfaced over a
   * conversation, newest first.
   */
  listForConversation(conversationId: string): GeneratedFileEntry[] {
    if (!conversationId) return [];
    const db = getDatabase();
    const pageSize = 200;
    const collected: GeneratedFileEntry[] = [];

    try {
      let page = 0;
      // Defensive cap so a runaway conversation can't loop forever.
      while (page < 50) {
        const result = db.getConversationMessages(conversationId, page, pageSize, 'ASC');
        for (const message of result.data) {
          if (message.type !== 'text' || message.position !== 'left') continue;
          const content = typeof (message.content as { content?: unknown })?.content === 'string' ? ((message.content as { content: string }).content as string) : null;
          if (!content) continue;
          const parsed = parseGeneratedFilesMarker(content);
          if (!parsed.ok || parsed.files.length === 0) continue;
          for (const entry of parsed.files) {
            collected.push(entry);
          }
        }
        if (!result.hasMore) break;
        page += 1;
      }
    } catch (error) {
      mainError('DeliverablesService', `Failed to scan conversation ${conversationId}: ${String(error)}`);
      return [];
    }

    const workspace = resolveConversationWorkspace(db, conversationId);
    const reconciled = collected.map((entry) => reconcileEntryPath(entry, workspace));
    return dedupeAndSort(reconciled);
  }
}

/**
 * Best-effort lookup of the conversation's workspace root from the persisted
 * `extra.workspace` field. Defensive: tolerates a database that doesn't expose
 * `getConversation` (e.g. trimmed mocks in unit tests) by returning undefined.
 */
function resolveConversationWorkspace(db: ReturnType<typeof getDatabase>, conversationId: string): string | undefined {
  const candidate = db as unknown as { getConversation?: (id: string) => { success?: boolean; data?: { extra?: { workspace?: unknown } } } };
  if (typeof candidate.getConversation !== 'function') return undefined;
  try {
    const result = candidate.getConversation(conversationId);
    const workspace = result?.data?.extra?.workspace;
    return typeof workspace === 'string' && workspace.length > 0 ? workspace : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Repair stale absolute paths recorded by older markers. When `entry.path` no
 * longer exists on disk but the entry's `relativePath` resolves to an existing
 * file under the current session workspace, return a copy with the corrected
 * absolute path so the deliverable card stays clickable after a workspace move.
 */
function reconcileEntryPath(entry: GeneratedFileEntry, workspace: string | undefined): GeneratedFileEntry {
  if (!workspace || !entry.relativePath) return entry;
  try {
    if (fs.existsSync(entry.path)) return entry;
  } catch {
    // fall through to attempt repair
  }
  const repaired = nodePath.resolve(workspace, entry.relativePath);
  const relative = nodePath.relative(nodePath.resolve(workspace), repaired);
  if (!relative || relative.startsWith('..') || nodePath.isAbsolute(relative)) return entry;
  try {
    if (!fs.existsSync(repaired)) return entry;
  } catch {
    return entry;
  }
  return { ...entry, path: repaired };
}

/**
 * Latest-wins dedup, then sort by createdAt DESC. The chronological scan above
 * pushes newest entries last, so a Map re-insertion keeps the latest. Dedup
 * prefers `relativePath` (stable across workspace moves) and falls back to the
 * absolute `path` when an entry has no relativePath.
 */
function dedupeAndSort(entries: GeneratedFileEntry[]): GeneratedFileEntry[] {
  const byKey = new Map<string, GeneratedFileEntry>();
  for (const entry of entries) {
    const key = entry.relativePath ?? entry.path;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export const deliverablesService = new DeliverablesService();
