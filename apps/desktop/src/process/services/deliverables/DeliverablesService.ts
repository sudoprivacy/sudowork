/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import nodePath from 'node:path';
import { NEXUS_FILES_MARKER } from '@sudowork/common/constants';
import { extractWorkspaceFileLinks } from '@sudowork/common/workspaceFileLinks';
import { parseGeneratedFilesMarker, type GeneratedFileEntry } from '@/common/generatedFiles';
import { getDatabase } from '@process/database';
import { mainError } from '@process/utils/mainLogger';
import { teamStore } from '@process/services/team/TeamStore';
import { readRemoteWorkspaceSnapshot } from './remoteDeliverables';

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
  async listRemoteForConversation(conversationId: string): Promise<GeneratedFileEntry[]> {
    const collected = this.scanConversationMarkers(conversationId);
    const db = getDatabase();
    const conversation = db.getConversation(conversationId).data;
    if (conversation?.type !== 'remote-agent') return collected;
    const extra = conversation.extra;
    if (!extra.mossSessionId || extra.mossSessionPending || !extra.mossServerUrl) return collected;
    const { assertConversationAccount } = await import('../mossExecutionContext');
    assertConversationAccount(conversation);
    const { initMossApi } = await import('@process/remote/MossSessionApi');
    const files = await readRemoteWorkspaceSnapshot(initMossApi(extra.mossServerUrl), extra.mossSessionId).catch((error): null => {
      mainError('DeliverablesService', `Remote workspace unavailable: ${String(error)}`);
      return null;
    });
    if (!files) return dedupeAndSort(collected);
    const inputs = new Set<string>();
    const candidates = new Map<string, number>();
    // Legacy cloud sessions have assistant links but no generated-file marker.
    for (let page = 0; page < 50; page++) {
      const result = db.getConversationMessages(conversationId, page, 200, 'ASC');
      for (const message of result.data) {
        if (message.type !== 'text') continue;
        const content = message.content.content;
        if (message.position === 'right') {
          for (const input of content.split(NEXUS_FILES_MARKER).slice(1).join('\n').split('\n').filter(Boolean)) {
            inputs.add(input.trim().replace(/\\/g, '/').split('/').pop() || '');
          }
          continue;
        }
        for (const relativePath of extractWorkspaceFileLinks(content, extra.workspace)) candidates.set(relativePath, message.createdAt);
      }
      if (!result.hasMore) break;
    }
    const legacy: GeneratedFileEntry[] = [];
    for (const [relativePath, createdAt] of candidates) {
      const file = files.get(relativePath);
      if (!file || inputs.has(relativePath.split('/').pop() || '')) continue;
      legacy.push({ path: file.fullPath, relativePath, kind: 'create', ext: nodePath.extname(relativePath).slice(1).toLowerCase(), size: file.size, createdAt });
    }
    return dedupeAndSort([...legacy, ...collected]);
  }

  listForConversation(conversationId: string): GeneratedFileEntry[] {
    if (!conversationId) return [];
    const db = getDatabase();
    const collected = this.scanConversationMarkers(conversationId);
    const workspace = resolveConversationWorkspace(db, conversationId);
    const reconciled = collected.map((entry) => reconcileEntryPath(entry, workspace));
    return dedupeAndSort(reconciled);
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
    return dedupeAndSort(reconciled);
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
