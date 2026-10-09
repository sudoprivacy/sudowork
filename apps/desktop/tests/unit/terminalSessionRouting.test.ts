import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getConversation: vi.fn(), spawn: vi.fn(), create: vi.fn() }));
vi.mock('@lydell/node-pty', () => ({ spawn: mocks.spawn }));
vi.mock('node:child_process', () => ({ execSync: () => '' }));
vi.mock('@process/database', () => ({ getDatabase: () => ({ getConversation: mocks.getConversation }) }));
vi.mock('@process/initStorage', () => ({ getSystemDir: () => ({ workDir: os.tmpdir() }) }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    terminal: {
      create: { provider: mocks.create },
      write: { provider: vi.fn() },
      resize: { provider: vi.fn() },
      dispose: { provider: vi.fn() },
      closeByConversation: { provider: vi.fn() },
      output: { emit: vi.fn() },
      exit: { emit: vi.fn() },
      activeCountChanged: { emit: vi.fn() },
    },
  },
}));
import { initTerminalBridge } from '@process/bridge/terminalBridge';
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.getConversation.mockReturnValue({ data: { type: 'acp' } });
  mocks.spawn.mockReturnValue({ pid: 100, onData: vi.fn(), onExit: vi.fn() });
  initTerminalBridge();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const create = (params: { cwd: string; conversationId: string }) => mocks.create.mock.calls.at(-1)![0](params);

describe('terminal session routing', () => {
  it('never starts a local shell for a cloud conversation', async () => {
    mocks.getConversation.mockReturnValue({ data: { type: 'remote-agent' } });
    expect(await create({ cwd: os.tmpdir(), conversationId: 'remote' })).toMatchObject({ success: false });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('starts a local shell in a valid local directory', async () => {
    expect(await create({ cwd: os.tmpdir(), conversationId: 'local' })).toMatchObject({ success: true });
    expect(mocks.spawn).toHaveBeenCalledWith(expect.any(String), [], expect.objectContaining({ cwd: os.tmpdir() }));
  });
  it('reports missing workspaces before spawning a PTY', async () => {
    expect(await create({ cwd: '/nonexistent-sudowork-qa-directory', conversationId: 'local' })).toMatchObject({ success: false });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('returns a creation failure instead of leaving IPC hanging', async () => {
    mocks.spawn.mockImplementation(() => {
      throw new Error('Shell unavailable');
    });
    expect(await create({ cwd: os.tmpdir(), conversationId: 'local' })).toMatchObject({ success: false, msg: 'Shell unavailable' });
  });
});
