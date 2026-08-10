/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import nodePath from 'node:path';
import { mergeGeneratedFileEntries, parseGeneratedFilesMarker, type AssetLibraryEntry, type GeneratedFileEntry } from '@/common/generatedFiles';
import type { TChatConversation } from '@/common/storage';
import { getDatabase } from '@process/database';
import { mainError } from '@process/utils/mainLogger';
import { teamStore } from '@process/services/team/TeamStore';

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
    const collected = this.scanConversationMarkers(conversationId);
    const workspace = resolveConversationWorkspace(db, conversationId);
    const reconciled = collected.map((entry) => reconcileEntryPath(entry, workspace));
    return mergeGeneratedFileEntries([], reconciled);
  }

  /**
   * Return deliverables from all visible conversations for the current user.
   * Conversation metadata is attached so the renderer can offer a direct chat jump.
   */
  listForConversations(conversations: TChatConversation[]): AssetLibraryEntry[] {
    const byPath = new Map<string, AssetLibraryEntry>();

    for (const conversation of conversations.filter(isVisibleConversation)) {
      for (const entry of this.listForConversation(conversation.id)) {
        if (!isExistingFile(entry.path)) continue;
        const asset: AssetLibraryEntry = {
          ...entry,
          conversationId: conversation.id,
          conversationName: conversation.name || conversation.id,
        };
        const previous = byPath.get(asset.path);
        if (!previous || previous.createdAt <= asset.createdAt) byPath.set(asset.path, asset);
      }
    }

    return [...byPath.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Aggregate deliverables across every member (leader + teammates) of a team.
   * Each member's markers live in its own conversation; scan them all and dedupe
   * globally. All members share the team workspace, so reconciliation uses
   * `team.workspace` once (null/missing → safe no-op).
   */
  listForTeam(teamId: string): GeneratedFileEntry[] {
    if (!teamId) return [];
    const team = teamStore.getTeam(teamId);
    const workspace = team?.workspace ?? undefined;
    const members = teamStore.listMembersByTeam(teamId);
    const collected: GeneratedFileEntry[] = [];
    for (const member of members) {
      if (!member.conversation_id) continue;
      collected.push(...this.scanConversationMarkers(member.conversation_id));
    }
    const reconciled = collected.map((entry) => reconcileEntryPath(entry, workspace));
    return mergeGeneratedFileEntries([], reconciled);
  }

  /**
   * Scan a single conversation's persisted assistant text messages for
   * `[[NEXUS_GENERATED_FILES]]` markers. Returns raw collected entries (no
   * reconciliation/dedup) so callers can merge across conversations
   * (`listForTeam`) or reconcile per-conversation (`listForConversation`).
   * Returns [] on error so one failing conversation can't break aggregation.
   */
  private scanConversationMarkers(conversationId: string): GeneratedFileEntry[] {
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
            const sourceMessageId = entry.sourceMessageId || message.id || message.msg_id;
            collected.push(sourceMessageId ? { ...entry, sourceMessageId } : entry);
          }
        }
        if (!result.hasMore) break;
        page += 1;
      }
    } catch (error) {
      mainError('DeliverablesService', `Failed to scan conversation ${conversationId}: ${String(error)}`);
      return [];
    }
    return collected;
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

function isVisibleConversation(conversation: TChatConversation): boolean {
  const extra = conversation.extra as { isHealthCheck?: boolean; isTeamMember?: boolean } | undefined;
  return extra?.isHealthCheck !== true && extra?.isTeamMember !== true;
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export const deliverablesService = new DeliverablesService();
