/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type Database from 'better-sqlite3';

/**
 * SQL for {@link readWorkspacePathsForUser}. Exported so the sweeper's
 * team-workspace protection can be regression-tested by string assertion — the
 * project's better-sqlite3 native binding is compiled for Electron's Node ABI and
 * won't load under vitest's system Node, so the SQL can't be exercised against a
 * real in-memory db in tests. The string assertion guards the exact root cause:
 * getUserConversations used to append `json_extract(extra,'$.isTeamMember') IS NULL`,
 * which hid team-member conversations and made the sweeper delete team workspace dirs.
 */
export const WORKSPACE_PATHS_FOR_USER_SQL = `SELECT DISTINCT json_extract(extra, '$.workspace') AS ws FROM conversations WHERE user_id = ? AND json_extract(extra, '$.workspace') IS NOT NULL AND json_extract(extra, '$.workspace') != ''`;

/**
 * Workspace paths of every conversation owned by `userId`, INCLUDING team-member
 * conversations (no isTeamMember filter). Pure DB helper — deliberately kept in a
 * module with no electron import so the SQL constant is importable in tests.
 *
 * getUserConversations hides team-member conversations; the orphan workspace
 * sweeper reads workspaces via this helper instead. user_id is filtered to match
 * getUserConversations scope (focused fix — does not alter multi-user behavior).
 */
export function readWorkspacePathsForUser(db: Database.Database, userId: string): string[] {
  const rows = db.prepare(WORKSPACE_PATHS_FOR_USER_SQL).all(userId) as Array<{ ws: string }>;
  return rows.map((row) => row.ws);
}
