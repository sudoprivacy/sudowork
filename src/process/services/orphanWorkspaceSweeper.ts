/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Boot orphan workspace sweeper.
 *
 * Auto workspace scratch dirs (`~/.nexus/<backend>-temp-<ts>/`) are removed when
 * their conversation is reaped, but a crash mid-reap (or a pre-reaper build) can
 * leave a `-temp-` dir on disk with no owning conversation. Nothing else ever
 * reconciles these, so they accumulate. This sweeper runs once at boot and
 * removes temp dirs directly under the work dir that no live conversation
 * references.
 *
 * Safety guards: only regex-matching dirs directly under the work dir are ever
 * candidates (user-selected custom workspaces live outside it); a dir younger
 * than {@link FRESH_THRESHOLD_MS} is skipped (createAcpAgent mkdir's the temp dir
 * *before* the DB row exists, so a brand-new dir may legitimately have no row
 * yet); and a path referenced by any live conversation is never deleted.
 */

import fs from 'fs/promises';
import path from 'path';
import { getDatabase } from '@process/database';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { getSystemDir } from '../initStorage';
import { TEMP_WORKSPACE_REGEX } from '../task/draftsCleanup';

/** A dir younger than this is skipped — its DB row may not exist yet. */
const FRESH_THRESHOLD_MS = 60_000;

/** Collect the resolved workspace paths of every conversation that has one. */
function collectLiveWorkspaces(): Set<string> {
  const live = new Set<string>();
  const db = getDatabase();
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const result = db.getUserConversations(undefined, page, pageSize);
    result.data.forEach((conversation) => {
      const workspace = (conversation.extra as { workspace?: string } | undefined)?.workspace;
      if (workspace) {
        live.add(path.resolve(workspace));
      }
    });
    hasMore = result.hasMore;
    page += 1;
  }

  return live;
}

export async function sweepOrphanWorkspaces(): Promise<{ scanned: number; deleted: string[] }> {
  const deleted: string[] = [];
  let scanned = 0;

  const root = path.resolve(getSystemDir().workDir);

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    mainWarn('OrphanWorkspaceSweeper', `Failed to read work dir ${root}:`, error);
    return { scanned, deleted };
  }

  const tempDirs = entries.filter((entry) => entry.isDirectory() && TEMP_WORKSPACE_REGEX.test(entry.name));
  if (tempDirs.length === 0) {
    return { scanned, deleted };
  }

  const live = collectLiveWorkspaces();
  const now = Date.now();

  for (const entry of tempDirs) {
    scanned += 1;
    const dirPath = path.join(root, entry.name);

    // Never delete a path a live conversation still references.
    if (live.has(path.resolve(dirPath))) continue;

    try {
      const stat = await fs.stat(dirPath);
      // Skip fresh dirs — createAcpAgent mkdir's before the DB row is written.
      if (now - stat.mtimeMs < FRESH_THRESHOLD_MS) continue;

      await fs.rm(dirPath, { recursive: true, force: true });
      deleted.push(dirPath);
    } catch (error) {
      mainWarn('OrphanWorkspaceSweeper', `Failed to sweep orphan workspace ${dirPath}:`, error);
    }
  }

  if (deleted.length > 0) {
    mainLog('OrphanWorkspaceSweeper', `Swept ${deleted.length} orphan workspace dir(s) of ${scanned} scanned`);
  }

  return { scanned, deleted };
}
