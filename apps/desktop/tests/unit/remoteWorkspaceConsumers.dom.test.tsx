import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig, type Cache } from 'swr';
import type { IResponseMessage } from '@sudowork/common/chatTypes';
import type { IDirOrFile } from '@sudowork/host-bridge/ipcBridge';
import { mossFrameToResponses } from '@sudowork/common/mossResponse';
import { ConversationProvider } from '@renderer/context/ConversationContext';
import { useWorkspaceFiles } from '@renderer/hooks/useWorkspaceFiles';
import { useWorkspaceTree } from '@renderer/pages/conversation/workspace/hooks/useWorkspaceTree';
import { useWorkspaceEvents } from '@renderer/pages/conversation/workspace/hooks/useWorkspaceEvents';

const bridge = vi.hoisted(() => ({
  read: vi.fn(),
  localRead: vi.fn(),
  stream: new Set<(message: IResponseMessage) => void>(),
  changed: new Set<(event: { conversationId: string; action: string }) => void>(),
}));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  conversation: {
    getRemoteWorkspace: { invoke: bridge.read },
    responseStream: {
      on: (listener: (message: IResponseMessage) => void) => {
        bridge.stream.add(listener);
        return () => bridge.stream.delete(listener);
      },
    },
    responseSearchWorkSpace: { provider: () => () => undefined },
  },
  acpConversation: { responseStream: { on: () => () => undefined } },
  fs: { getFilesByDir: { invoke: bridge.localRead } },
  fileWatch: { dirChanged: { on: () => () => undefined } },
  database: {
    conversationChanged: {
      on: (listener: (event: { conversationId: string; action: string }) => void) => {
        bridge.changed.add(listener);
        return () => bridge.changed.delete(listener);
      },
    },
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function image(name: string) {
  return { success: true, data: { files: [{ name: 'workspace', relativePath: '', fullPath: '/workspace', isDir: true, isFile: false, children: [{ name, relativePath: name, fullPath: '/workspace/' + name, isDir: false, isFile: true }] }] as IDirOrFile[] } };
}

const noop = () => undefined;
function WorkspaceViews({ id, onRender }: IWorkspaceViewsProps) {
  const tree = useWorkspaceTree({ workspace: id, conversation_id: id, eventPrefix: 'remote-agent', dataSource: 'moss-session' });
  useWorkspaceEvents({ conversation_id: id, workspace: id, eventPrefix: 'remote-agent', dataSource: 'moss-session', readonly: true, ...tree, closeContextMenu: noop, setContextMenu: noop, closeRenameModal: noop, closeDeleteModal: noop });
  const mentions = useWorkspaceFiles();
  onRender?.(tree, mentions);
  return (
    <>
      <output data-testid='tree'>{tree.files[0]?.children?.map((node) => node.name).join(',')}</output>
      <output data-testid='mentions'>{mentions.map((node) => node.name).join(',')}</output>
    </>
  );
}

function page(id: string, cache: Cache, onRender?: IWorkspaceViewsProps['onRender']) {
  return (
    <SWRConfig value={{ provider: () => cache }}>
      <ConversationProvider value={{ conversationId: id, type: 'remote-agent' }}>
        <WorkspaceViews id={id} onRender={onRender} />
      </ConversationProvider>
    </SWRConfig>
  );
}

function emit(frame: Record<string, unknown>, conversationId = 'a') {
  const messages = mossFrameToResponses(frame, { conversationId, sessionId: conversationId, nextMsgId: () => 'message' });
  for (const message of messages) for (const listener of bridge.stream) listener(message);
}

describe('remote workspace views', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    bridge.read.mockReset();
    bridge.localRead.mockReset();
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    expect(bridge.stream.size).toBe(0);
    bridge.changed.clear();
  });

  it('shares one root read and ignores text deltas and metadata updates', async () => {
    const read = deferred<ReturnType<typeof image>>();
    bridge.read.mockReturnValue(read.promise);
    render(page('a', new Map()));
    await act(async () => {
      await Promise.resolve();
    });
    expect(bridge.read).toHaveBeenCalledTimes(1);
    expect(bridge.stream.size).toBe(1);
    await act(async () => {
      read.resolve(image('first.txt'));
    });
    expect(screen.getByTestId('tree').textContent).toContain('first.txt');
    expect(screen.getByTestId('mentions').textContent).toBe('first.txt');
    await act(async () => {
      emit({ type: 'tool_use', name: 'write_file', id: 'pending', input: { path: 'later.txt', content: 'pending' } });
      await vi.advanceTimersByTimeAsync(400);
    });
    for (let index = 0; index < 50; index++) {
      await act(async () => {
        emit({ type: 'assistant', delta: true, message: { content: [{ type: 'text', text: 'token' }] } });
        for (const listener of bridge.changed) listener({ conversationId: 'a', action: 'updated' });
        await vi.advanceTimersByTimeAsync(400);
      });
    }
    expect(bridge.read).toHaveBeenCalledTimes(1);
    expect(bridge.localRead).not.toHaveBeenCalled();
  });

  it('publishes intermediate files and coalesces tool completions into one pending refresh', async () => {
    const first = deferred<ReturnType<typeof image>>();
    const second = deferred<ReturnType<typeof image>>();
    const last = deferred<ReturnType<typeof image>>();
    bridge.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(last.promise);
    render(page('a', new Map()));
    await act(async () => {
      first.resolve(image('before.txt'));
    });
    await act(async () => {
      emit({ type: 'tool_result', tool_use_id: 'write', content: 'written', is_error: false });
    });
    expect(bridge.read).toHaveBeenCalledTimes(2);
    await act(async () => {
      for (let index = 0; index < 20; index++) emit({ type: 'tool_result', tool_use_id: 'tool-' + index, content: 'done', is_error: false });
      emit({ type: 'result', subtype: 'success' });
    });
    expect(bridge.read).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve(image('intermediate.txt'));
    });
    expect(bridge.read).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('tree').textContent).toContain('intermediate.txt');
    expect(screen.getByTestId('mentions').textContent).toBe('intermediate.txt');
    await act(async () => {
      last.resolve(image('final.txt'));
    });
    expect(screen.getByTestId('tree').textContent).toContain('final.txt');
    expect(screen.getByTestId('mentions').textContent).toBe('final.txt');
  });

  it('refreshes generated artifacts before the final turn completion', async () => {
    bridge.read.mockResolvedValueOnce(image('before.txt')).mockResolvedValueOnce(image('deliverable.txt'));
    render(page('a', new Map()));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      emit({ type: 'artifacts', v: 1, workspace: '/workspace', records: [{ sessionId: 'a', intent: 'final', origin: 'generated', relativePath: 'deliverable.txt', updatedAt: Date.now() }] });
    });
    expect(bridge.read).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('tree').textContent).toContain('deliverable.txt');
    expect(screen.getByTestId('mentions').textContent).toBe('deliverable.txt');
  });

  it('keeps the first render of a new session free of the prior private image', async () => {
    const fresh = deferred<ReturnType<typeof image>>();
    bridge.read.mockResolvedValueOnce(image('private.txt')).mockReturnValueOnce(fresh.promise);
    const cache = new Map();
    const view = render(page('a', cache));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('tree').textContent).toContain('private.txt');
    const renders: string[] = [];
    view.rerender(
      page('b', cache, (tree, mentions) => {
        renders.push(JSON.stringify([tree.files, mentions]));
      })
    );
    expect(renders.length).toBeGreaterThan(0);
    expect(renders.every((value) => !value.includes('private.txt'))).toBe(true);
    await act(async () => {
      fresh.resolve(image('current.txt'));
    });
    expect(screen.getByTestId('tree').textContent).toContain('current.txt');
    expect(screen.getByTestId('mentions').textContent).toBe('current.txt');
  });

  it('preserves the active search while refreshing the shared root image', async () => {
    bridge.read.mockResolvedValueOnce(image('before.txt')).mockResolvedValueOnce(image('match.txt')).mockResolvedValueOnce(image('new-root.txt')).mockResolvedValueOnce(image('new-root.txt'));
    let tree!: ReturnType<typeof useWorkspaceTree>;
    render(
      page('a', new Map(), (current) => {
        tree = current;
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await tree.loadWorkspace('a', 'match');
    });
    expect(screen.getByTestId('tree').textContent).toContain('match.txt');
    await act(async () => {
      emit({ type: 'tool_result', tool_use_id: 'write', content: 'written', is_error: false });
    });
    expect(bridge.read).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('tree').textContent).toContain('match.txt');
    expect(screen.getByTestId('tree').textContent).not.toContain('new-root.txt');
    expect(screen.getByTestId('mentions').textContent).toBe('new-root.txt');
    await act(async () => {
      await tree.loadWorkspace('a', '');
    });
    expect(screen.getByTestId('tree').textContent).toContain('new-root.txt');
    expect(bridge.read).toHaveBeenCalledTimes(4);
  });

  it('keeps a late prior-session read out of both current views', async () => {
    const old = deferred<ReturnType<typeof image>>();
    const current = deferred<ReturnType<typeof image>>();
    bridge.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const cache = new Map();
    const view = render(page('a', cache));
    await act(async () => {
      await Promise.resolve();
    });
    view.rerender(page('b', cache));
    await act(async () => {
      current.resolve(image('current.txt'));
    });
    await act(async () => {
      old.resolve(image('private-old.txt'));
    });
    expect(bridge.read).toHaveBeenCalledTimes(2);
    expect(bridge.read.mock.calls[1][0].conversation_id).toBe('b');
    expect(screen.getByTestId('tree').textContent).toContain('current.txt');
    expect(screen.getByTestId('tree').textContent).not.toContain('private-old.txt');
    expect(screen.getByTestId('mentions').textContent).toBe('current.txt');
  });
});

interface IWorkspaceViewsProps {
  id: string;
  onRender?: (tree: ReturnType<typeof useWorkspaceTree>, mentions: ReturnType<typeof useWorkspaceFiles>) => void;
}
