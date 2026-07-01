/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const h = vi.hoisted(() => ({
  workDir: '',
  pages: [] as Array<{ data: Array<{ extra?: { workspace?: string } }>; hasMore: boolean }>,
}));

vi.mock('@process/database', () => ({
  getDatabase: () => ({
    getUserConversations: (_userId: unknown, page: number) => h.pages[page] ?? { data: [], hasMore: false },
  }),
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn() }));
vi.mock('@process/initStorage', () => ({ getSystemDir: () => ({ workDir: h.workDir }) }));
vi.mock('@process/task/draftsCleanup', () => ({ TEMP_WORKSPACE_REGEX: /-temp-\d+$/ }));

async function importSweeper() {
  return import('../../src/process/services/orphanWorkspaceSweeper');
}

/** Create a dir and back-date its mtime so the freshness guard treats it as old. */
function makeAgedDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const old = new Date(Date.now() - 5 * 60 * 1000);
  fs.utimesSync(dir, old, old);
}

describe('orphanWorkspaceSweeper', () => {
  beforeEach(() => {
    h.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));
    h.pages = [{ data: [], hasMore: false }];
  });

  afterEach(() => {
    try {
      fs.rmSync(h.workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('deletes an unreferenced aged temp dir', async () => {
    const orphan = path.join(h.workDir, 'scode-temp-1700000000000');
    makeAgedDir(orphan);

    const { sweepOrphanWorkspaces } = await importSweeper();
    const res = await sweepOrphanWorkspaces();

    expect(res.deleted).toContain(orphan);
    expect(fs.existsSync(orphan)).toBe(false);
  });

  it('keeps a temp dir that is still referenced by a live conversation', async () => {
    const referenced = path.join(h.workDir, 'scode-temp-1700000000001');
    makeAgedDir(referenced);
    h.pages = [{ data: [{ extra: { workspace: referenced } }], hasMore: false }];

    const { sweepOrphanWorkspaces } = await importSweeper();
    const res = await sweepOrphanWorkspaces();

    expect(res.deleted).not.toContain(referenced);
    expect(fs.existsSync(referenced)).toBe(true);
  });

  it('skips a fresh temp dir (mtime younger than the threshold)', async () => {
    const fresh = path.join(h.workDir, 'scode-temp-1700000000002');
    fs.mkdirSync(fresh, { recursive: true }); // current mtime → treated as fresh

    const { sweepOrphanWorkspaces } = await importSweeper();
    const res = await sweepOrphanWorkspaces();

    expect(res.deleted).not.toContain(fresh);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('never touches non-temp (custom) dirs', async () => {
    const custom = path.join(h.workDir, 'my-project');
    makeAgedDir(custom);

    const { sweepOrphanWorkspaces } = await importSweeper();
    const res = await sweepOrphanWorkspaces();

    expect(res.deleted).not.toContain(custom);
    expect(fs.existsSync(custom)).toBe(true);
    expect(res.scanned).toBe(0);
  });
});
