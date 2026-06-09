/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

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

    return dedupeAndSort(collected);
  }
}

/**
 * Latest-wins by absolute path, then sort by createdAt DESC. The chronological
 * scan above pushes newest entries last, so a Map insertion / re-insertion
 * naturally keeps the latest.
 */
function dedupeAndSort(entries: GeneratedFileEntry[]): GeneratedFileEntry[] {
  const byPath = new Map<string, GeneratedFileEntry>();
  for (const entry of entries) {
    byPath.set(entry.path, entry);
  }
  return [...byPath.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export const deliverablesService = new DeliverablesService();
