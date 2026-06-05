/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import { getSystemDir } from '../initStorage';
import os from 'node:os';
import * as pty from '@lydell/node-pty';

type TerminalSession = {
  pty: pty.IPty;
};

const sessions = new Map<string, TerminalSession>();

const defaultShell = (): string => {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
};

export function initTerminalBridge(): void {
  ipcBridge.terminal.create.provider(async ({ cwd, shell }) => {
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
      sessions.delete(sessionId);
    });

    sessions.set(sessionId, { pty: term });
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
    }
    return { success: true, data: undefined };
  });
}
