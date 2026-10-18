import { describe, expect, it, vi } from 'vitest';
import type { MossWorkspaceNode } from '@sudowork/host-bridge/ipcBridge';
import { diffRemoteDeliverables, readRemoteWorkspaceSnapshot } from '@process/services/deliverables/remoteDeliverables';

const file = (relativePath: string, mtime = 1): MossWorkspaceNode => ({ name: relativePath.split('/').pop()!, relativePath, fullPath: `/workspace/${relativePath}`, isFile: true, isDir: false, size: 10, mtime });
const root = (children: MossWorkspaceNode[]): MossWorkspaceNode => ({ name: 'workspace', relativePath: '', fullPath: '/workspace', isFile: false, isDir: true, children });

describe('remote deliverables', () => {
  it('finds root outputs and lazily loaded nested outputs, excluding internal files', async () => {
    const api = { getSessionWorkspaceTree: vi.fn().mockImplementation(async (_id, params) => (params?.path === 'outputs' ? root([file('outputs/report.md')]) : root([file('qa-preview.html'), file('.nexus/internal'), { ...root([]), name: 'outputs', relativePath: 'outputs', children: undefined }]))) };
    const snapshot = await readRemoteWorkspaceSnapshot(api, 'session');
    expect([...snapshot.keys()]).toEqual(['qa-preview.html', 'outputs/report.md']);
    expect(api.getSessionWorkspaceTree).toHaveBeenCalledWith('session', { path: 'outputs' });
  });
  it('records generated and edited outputs while excluding unchanged input attachments', () => {
    const before = new Map([
      ['qa-fixture.txt', file('qa-fixture.txt')],
      ['report.md', file('report.md')],
    ]);
    const after = new Map([...before, ['report.md', file('report.md', 2)], ['qa-preview.html', file('qa-preview.html', 2)]]);
    expect(diffRemoteDeliverables(before, after, 100)).toEqual([expect.objectContaining({ relativePath: 'report.md', kind: 'edit', createdAt: 100 }), expect.objectContaining({ relativePath: 'qa-preview.html', kind: 'create', createdAt: 100 })]);
  });
  it('propagates tree failures instead of treating every file as newly generated', async () => {
    await expect(readRemoteWorkspaceSnapshot({ getSessionWorkspaceTree: vi.fn().mockRejectedValue(new Error('offline')) }, 'session')).rejects.toThrow('offline');
  });
});

it('bounds optional workspace indexing when the server stops responding', async () => {
  vi.useFakeTimers();
  try {
    const snapshot = readRemoteWorkspaceSnapshot({ getSessionWorkspaceTree: () => new Promise(() => {}) }, 'session');
    const result = expect(snapshot).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5000);
    await result;
  } finally {
    vi.useRealTimers();
  }
});
