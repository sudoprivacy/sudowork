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
  conversation: null as any,
  deleteResult: true,
  jobs: [] as Array<{ id: string }>,
  kill: vi.fn(),
  clear: vi.fn(),
  closeTerminals: vi.fn(),
  closeBrowser: vi.fn(),
  dispose: vi.fn(),
  stopTelemetry: vi.fn(),
  deleteConversation: vi.fn(async () => h.deleteResult),
  listJobs: vi.fn(async () => h.jobs),
  removeJob: vi.fn(async () => {}),
  onJobRemovedEmit: vi.fn(),
  reapedEmit: vi.fn(),
}));

vi.mock('@process/database', () => ({
  getDatabase: () => ({ getConversation: () => ({ success: !!h.conversation, data: h.conversation }) }),
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    cron: { onJobRemoved: { emit: h.onJobRemovedEmit } },
    conversation: { reaped: { emit: h.reapedEmit } },
  },
}));
vi.mock('@process/WorkerManage', () => ({ default: { kill: h.kill, clear: h.clear } }));
vi.mock('@process/bridge/terminalBridge', () => ({ closeTerminalsByConversation: h.closeTerminals }));
vi.mock('@process/bridge/browserPanelBridge', () => ({ closeBrowserTabsByConversation: h.closeBrowser }));
vi.mock('@process/message', () => ({ disposeConversation: h.dispose }));
vi.mock('@process/telemetry', () => ({ stopConversationTracking: h.stopTelemetry }));
vi.mock('@process/providers', () => ({ getConversationProvider: () => ({ deleteConversation: h.deleteConversation }) }));
vi.mock('@process/initStorage', () => ({ getSystemDir: () => ({ workDir: h.workDir }) }));
vi.mock('@process/task/draftsCleanup', () => ({ TEMP_WORKSPACE_REGEX: /-temp-\d+$/ }));
vi.mock('@process/services/cron/CronService', () => ({ cronService: { listJobsByConversation: h.listJobs, removeJob: h.removeJob } }));

async function importReaper() {
  return import('../../src/process/services/conversationReaper');
}

function makeConversation(extra: Record<string, unknown>, source = 'sudowork') {
  return { id: 'conv-1', name: 'c', type: 'acp', source, extra };
}

describe('conversationReaper', () => {
  beforeEach(() => {
    h.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaper-'));
    h.conversation = null;
    h.deleteResult = true;
    h.jobs = [];
    Object.values(h).forEach((v) => {
      if (typeof v === 'function' && 'mockClear' in v) (v as any).mockClear();
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(h.workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('reaps a temp (customWorkspace=false) conversation: dir removed, row gone, kill + disposers called', async () => {
    const ws = path.join(h.workDir, 'scode-temp-1700000000000');
    fs.mkdirSync(ws, { recursive: true });
    h.conversation = makeConversation({ workspace: ws, customWorkspace: false });

    const { reapConversation } = await importReaper();
    const res = await reapConversation('conv-1', { reason: 'user-delete' });

    expect(res.dbDeleted).toBe(true);
    expect(res.workspaceDeleted).toBe(true);
    expect(fs.existsSync(ws)).toBe(false);
    expect(h.kill).toHaveBeenCalledWith('conv-1');
    expect(h.clear).not.toHaveBeenCalled();
    expect(h.closeTerminals).toHaveBeenCalledWith('conv-1');
    expect(h.closeBrowser).toHaveBeenCalledWith('conv-1');
    expect(h.dispose).toHaveBeenCalledWith('conv-1');
    expect(h.stopTelemetry).toHaveBeenCalledWith('conv-1');
    expect(h.deleteConversation).toHaveBeenCalledWith('conv-1');
    expect(h.reapedEmit).toHaveBeenCalledWith({ id: 'conv-1' });
  });

  it('keeps a custom workspace folder when no delete flag is given', async () => {
    const ws = path.join(h.workDir, 'my-project');
    fs.mkdirSync(ws, { recursive: true });
    h.conversation = makeConversation({ workspace: ws, customWorkspace: true });

    const { reapConversation } = await importReaper();
    const res = await reapConversation('conv-1', { reason: 'user-delete' });

    expect(res.workspaceDeleted).toBe(false);
    expect(fs.existsSync(ws)).toBe(true);
    expect(res.dbDeleted).toBe(true);
  });

  it('deletes a custom workspace folder when deleteWorkspace=true (explicit)', async () => {
    const ws = path.join(h.workDir, 'my-project');
    fs.mkdirSync(ws, { recursive: true });
    h.conversation = makeConversation({ workspace: ws, customWorkspace: true });

    const { reapConversation } = await importReaper();
    const res = await reapConversation('conv-1', { reason: 'user-delete', deleteWorkspace: true });

    expect(res.workspaceDeleted).toBe(true);
    expect(fs.existsSync(ws)).toBe(false);
  });

  it('guard: does not auto-delete a customWorkspace=false path with a non-temp basename', async () => {
    const ws = path.join(h.workDir, 'not-a-temp-dir');
    fs.mkdirSync(ws, { recursive: true });
    h.conversation = makeConversation({ workspace: ws, customWorkspace: false });

    const { reapConversation } = await importReaper();
    const res = await reapConversation('conv-1', { reason: 'user-delete' });

    expect(res.workspaceDeleted).toBe(false);
    expect(fs.existsSync(ws)).toBe(true);
  });

  it('guard: does not auto-delete a temp-named dir that lives outside workDir', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    const ws = path.join(outside, 'scode-temp-1700000000000');
    fs.mkdirSync(ws, { recursive: true });
    h.conversation = makeConversation({ workspace: ws, customWorkspace: false });

    const { reapConversation } = await importReaper();
    const res = await reapConversation('conv-1', { reason: 'user-delete' });

    expect(res.workspaceDeleted).toBe(false);
    expect(fs.existsSync(ws)).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('one step throwing does not abort the rest; errors[] is populated and dbDeleted stays true', async () => {
    const ws = path.join(h.workDir, 'scode-temp-1700000000000');
    fs.mkdirSync(ws, { recursive: true });
    h.conversation = makeConversation({ workspace: ws, customWorkspace: false });
    h.closeTerminals.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const { reapConversation } = await importReaper();
    const res = await reapConversation('conv-1', { reason: 'user-delete' });

    expect(res.errors.some((e) => e.step === 'close-terminals')).toBe(true);
    expect(res.dbDeleted).toBe(true);
    expect(h.deleteConversation).toHaveBeenCalled();
    expect(res.workspaceDeleted).toBe(true);
    expect(fs.existsSync(ws)).toBe(false);
  });

  it('cleans up cron jobs for a non-cron conversation', async () => {
    h.jobs = [{ id: 'job-1' }, { id: 'job-2' }];
    h.conversation = makeConversation({ customWorkspace: true });

    const { reapConversation } = await importReaper();
    await reapConversation('conv-1', { reason: 'user-delete' });

    expect(h.removeJob).toHaveBeenCalledWith('job-1');
    expect(h.removeJob).toHaveBeenCalledWith('job-2');
    expect(h.onJobRemovedEmit).toHaveBeenCalledWith({ jobId: 'job-1' });
    expect(h.onJobRemovedEmit).toHaveBeenCalledWith({ jobId: 'job-2' });
  });

  it('skips the DB delete when skipDbDelete is set', async () => {
    h.conversation = makeConversation({ customWorkspace: true });

    const { reapConversation } = await importReaper();
    const res = await reapConversation('conv-1', { reason: 'orphan-sweep', skipDbDelete: true });

    expect(h.deleteConversation).not.toHaveBeenCalled();
    expect(res.dbDeleted).toBe(false);
  });

  it('routes remote-agent delete through the provider and uses kill (not clear)', async () => {
    h.conversation = { id: 'conv-1', name: 'c', type: 'remote-agent', source: 'sudowork', extra: { customWorkspace: true } };

    const { reapConversation } = await importReaper();
    await reapConversation('conv-1', { reason: 'user-delete' });

    expect(h.deleteConversation).toHaveBeenCalledWith('conv-1');
    expect(h.kill).toHaveBeenCalledWith('conv-1');
    expect(h.clear).not.toHaveBeenCalled();
  });

  it('returns early when the conversation cannot be resolved', async () => {
    h.conversation = null;

    const { reapConversation } = await importReaper();
    const res = await reapConversation('missing', { reason: 'user-delete' });

    expect(res.dbDeleted).toBe(false);
    expect(h.deleteConversation).not.toHaveBeenCalled();
    expect(h.kill).not.toHaveBeenCalled();
  });
});
