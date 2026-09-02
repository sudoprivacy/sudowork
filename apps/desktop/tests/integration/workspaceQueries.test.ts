/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { WORKSPACE_PATHS_FOR_USER_SQL } from '../../src/process/database/workspaceQueries';

describe('WORKSPACE_PATHS_FOR_USER_SQL', () => {
  // Root cause of the original bug: getUserConversations appended
  // `json_extract(extra, '$.isTeamMember') IS NULL`, hiding team-member
  // conversations from the orphan workspace sweeper so it deleted team workspace
  // dirs. This guard prevents that filter from creeping back.
  // (The SQL can't be run against a real sqlite here — the project's better-sqlite3
  // binding targets Electron's Node ABI, not vitest's system Node.)
  it('does not filter out team-member conversations', () => {
    expect(WORKSPACE_PATHS_FOR_USER_SQL).not.toMatch(/isTeamMember/i);
  });

  it('scopes to a single user (focused — does not alter multi-user behavior)', () => {
    expect(WORKSPACE_PATHS_FOR_USER_SQL).toMatch(/user_id\s*=\s*\?/);
  });
});
