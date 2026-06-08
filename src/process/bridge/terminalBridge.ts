/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import { getSystemDir } from '../initStorage';
import { mainLog } from '../utils/mainLogger';
import os from 'node:os';
import { execSync } from 'node:child_process';
import * as pty from '@lydell/node-pty';

type TerminalSession = {
  pty: pty.IPty;
  /** The conversation this PTY belongs to. Optional for legacy callers; used to
   *  drive per-conversation cleanup (closeByConversation) and the sidebar
   *  "running" spinner (activeCountChanged). */
  conversationId?: string;
  createdAt: number;
};

const sessions = new Map<string, TerminalSession>();

/** Hard cap: refuse to create new PTYs once this many are alive globally. Protects
 *  the host from runaway tab creation. Per-conv cap is enforced in the renderer. */
const GLOBAL_PTY_HARD_LIMIT = 50;

/** Grace period before escalating SIGTERM → SIGKILL on closeByConversation. */
const SIGTERM_GRACE_MS = 2000;

/**
 * Walk the full descendant tree of `rootPid` and return all PIDs (including the
 * root). Necessary because `process.kill(-pid, signal)` only signals processes
 * in the PTY's own process group — but zsh's job control puts each `&`
 * background job into its **own** process group, so a `sleep 600 &` will
 * survive signaling the PTY's pgroup.
 *
 * Uses `ps -A -o pid=,ppid=` (POSIX-portable across macOS and Linux). Returns
 * descendants leaf-first so callers can kill children before their parents and
 * avoid a momentary reparent-to-launchd window.
 */
function collectDescendants(rootPid: number): number[] {
  let psOut: string;
  try {
    psOut = execSync('ps -A -o pid=,ppid=', { encoding: 'utf-8' });
  } catch {
    return [rootPid];
  }
  const childrenByParent = new Map<number, number[]>();
  for (const line of psOut.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 2) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    const arr = childrenByParent.get(ppid);
    if (arr) arr.push(pid);
    else childrenByParent.set(ppid, [pid]);
  }
  const order: number[] = [];
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    order.push(pid);
    const children = childrenByParent.get(pid) ?? [];
    queue.push(...children);
  }
  return order.reverse(); // leaves first
}

function killTree(rootPid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
  for (const pid of collectDescendants(rootPid)) {
    try {
      process.kill(pid, signal);
    } catch {
      // process already gone
    }
  }
}

/**
 * Reap all PTYs tied to a conversation. Exported so main-process callers
 * (e.g. conversationBridge on delete) can invoke directly — `bridge.invoke`
 * in main does NOT route back to local providers, only renderer → main works.
 */
export function closeTerminalsByConversation(conversationId: string): { killed: number } {
  const toKill: Array<{ sessionId: string; session: TerminalSession }> = [];
  for (const [sessionId, session] of sessions) {
    if (session.conversationId === conversationId) {
      toKill.push({ sessionId, session });
    }
  }
  mainLog('terminalBridge', `closeTerminalsByConversation conv=${conversationId} matched=${toKill.length}/${sessions.size}`);
  if (toKill.length === 0) return { killed: 0 };

  for (const { session } of toKill) {
    const descendants = collectDescendants(session.pty.pid);
    mainLog('terminalBridge', `SIGTERM rootPid=${session.pty.pid} descendants=${JSON.stringify(descendants)}`);
    killTree(session.pty.pid, 'SIGTERM');
  }

  setTimeout(() => {
    for (const { sessionId, session } of toKill) {
      if (sessions.has(sessionId)) {
        const descendants = collectDescendants(session.pty.pid);
        mainLog('terminalBridge', `SIGKILL rootPid=${session.pty.pid} descendants=${JSON.stringify(descendants)}`);
        killTree(session.pty.pid, 'SIGKILL');
        sessions.delete(sessionId);
      }
    }
    emitActiveCount(conversationId);
  }, SIGTERM_GRACE_MS).unref?.();

  emitActiveCount(conversationId);
  return { killed: toKill.length };
}

const defaultShell = (): string => {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
};

/** Count live PTYs for a conversation and broadcast. Cheap enough to call after
 *  every create/exit/dispose — the Map is in-process and we only emit one event. */
function emitActiveCount(conversationId: string | undefined): void {
  if (!conversationId) return;
  let count = 0;
  for (const session of sessions.values()) {
    if (session.conversationId === conversationId) count++;
  }
  ipcBridge.terminal.activeCountChanged.emit({ conversationId, count });
}

export function initTerminalBridge(): void {
  ipcBridge.terminal.create.provider(async ({ cwd, shell, conversationId } = {}) => {
    if (sessions.size >= GLOBAL_PTY_HARD_LIMIT) {
      return { success: false, msg: `Global PTY limit reached (${GLOBAL_PTY_HARD_LIMIT}). Close some terminals and try again.` };
    }

    const sessionId = `terminal_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const defaultCwd = getSystemDir().workDir || os.homedir();
    const term = pty.spawn(shell || defaultShell(), [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: cwd || defaultCwd,
      env: process.env as Record<string, string>,
    });

    term.onData((data) => {
      ipcBridge.terminal.output.emit({ sessionId, data });
    });
    term.onExit(({ exitCode }) => {
      ipcBridge.terminal.exit.emit({ sessionId, exitCode });
      const session = sessions.get(sessionId);
      sessions.delete(sessionId);
      emitActiveCount(session?.conversationId);
    });

    sessions.set(sessionId, { pty: term, conversationId, createdAt: Date.now() });
    mainLog('terminalBridge', `create sessionId=${sessionId} convId=${conversationId} pid=${term.pid}`);
    emitActiveCount(conversationId);
    return { success: true, data: { sessionId } };
  });

  ipcBridge.terminal.write.provider(async ({ sessionId, data }) => {
    sessions.get(sessionId)?.pty.write(data);
    return { success: true, data: undefined };
  });

  ipcBridge.terminal.resize.provider(async ({ sessionId, cols, rows }) => {
    sessions.get(sessionId)?.pty.resize(cols, rows);
    return { success: true, data: undefined };
  });

  ipcBridge.terminal.dispose.provider(async ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.pty.kill();
      sessions.delete(sessionId);
      emitActiveCount(session.conversationId);
    }
    return { success: true, data: undefined };
  });

  ipcBridge.terminal.closeByConversation.provider(async ({ conversationId }) => {
    const result = closeTerminalsByConversation(conversationId);
    return { success: true, data: result };
  });
}
