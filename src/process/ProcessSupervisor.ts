/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OS-level process supervisor.
 *
 * Ensures ALL child processes are killed when the parent exits, regardless of
 * how it exits (normal quit, Ctrl+C / SIGINT, SIGTERM, uncaught exception,
 * process.exit()).
 *
 * The key mechanism is `process.on('exit')` — it fires synchronously as the
 * very last step before the process terminates. Inside it we use *synchronous*
 * system calls (`execFileSync` / `process.kill`) to terminate every tracked
 * child. This is the OS-level safety net that makes manual async cleanup
 * (before-quit, WorkerManage.clear, etc.) optional rather than critical.
 *
 * OS 级进程监管器。
 *
 * 确保父进程退出时所有子进程都被终止，无论退出方式如何（正常退出、Ctrl+C、
 * SIGTERM、未捕获异常、process.exit()）。
 *
 * 核心机制是 `process.on('exit')`——在进程终止前同步触发。在回调中使用同步
 * 系统调用（execFileSync / process.kill）终止所有被追踪的子进程。这是 OS 级
 * 的安全网，使得异步清理（before-quit、WorkerManage.clear 等）变为"锦上添花"
 * 而非"必须成功"。
 */

import type { ChildProcess } from 'child_process';
import { execFileSync } from 'child_process';

interface TrackedProcess {
  child: ChildProcess;
  isDetached: boolean;
}

class ProcessSupervisor {
  private children = new Map<number, TrackedProcess>();
  private initialized = false;

  /**
   * Initialize the supervisor. Must be called once at app startup, as early
   * as possible (before any child processes are spawned).
   *
   * 初始化监管器。必须在应用启动时尽早调用（在任何子进程 spawn 之前）。
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // `process.on('exit')` is the last-resort synchronous cleanup.
    // It fires during:
    //   - Normal exit (event loop drained)
    //   - process.exit() calls
    //   - SIGINT with default handler
    //   - SIGTERM with default handler
    //   - Uncaught exception exit
    // It does NOT fire during SIGKILL (nothing can intercept SIGKILL).
    //
    // `process.on('exit')` 是最后的同步清理手段，在以下情况触发：
    //   - 正常退出（事件循环排空）
    //   - process.exit() 调用
    //   - SIGINT 默认处理
    //   - SIGTERM 默认处理
    //   - 未捕获异常退出
    // SIGKILL 时不触发（没有任何机制可以拦截 SIGKILL）。
    process.on('exit', () => {
      this.killAllSync();
    });
  }

  /**
   * Track a child process. The supervisor will ensure it is killed when the
   * parent process exits.
   *
   * 注册子进程。监管器确保父进程退出时该子进程会被终止。
   */
  track(child: ChildProcess, isDetached: boolean = false): void {
    const pid = child.pid;
    if (!pid) return;

    this.children.set(pid, { child, isDetached });

    // Auto-untrack when the child exits on its own.
    // 子进程自然退出时自动注销。
    const cleanup = () => {
      this.children.delete(pid);
    };
    child.once('exit', cleanup);
    child.once('error', cleanup);
  }

  /**
   * Untrack a child process (call after graceful termination).
   * 取消注册子进程（在主动终止后调用）。
   */
  untrack(pid: number): void {
    this.children.delete(pid);
  }

  /**
   * Synchronously kill every tracked child process.
   * Called inside `process.on('exit')` where only synchronous code may run.
   *
   * 同步杀死所有被追踪的子进程。
   * 在 `process.on('exit')` 内调用，此处只能执行同步代码。
   */
  private killAllSync(): void {
    if (this.children.size === 0) return;

    for (const [pid, { isDetached }] of this.children) {
      try {
        if (process.platform === 'win32') {
          // taskkill /T kills the entire process tree, /F forces termination.
          // taskkill /T 杀死整个进程树，/F 强制终止。
          try {
            execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
              windowsHide: true,
              timeout: 5000,
              stdio: 'ignore',
            });
          } catch {
            // Process may already be dead — ignore.
          }
        } else if (isDetached) {
          // Detached process has its own process group.
          // Kill the entire group with -pid.
          // 分离进程有自己的进程组，使用 -pid 杀死整个组。
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              /* already dead */
            }
          }
        } else {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* already dead */
          }
        }
      } catch {
        // Best-effort — never throw from exit handler.
      }
    }
    this.children.clear();
  }

  /** Number of currently tracked processes (for logging / debugging). */
  get size(): number {
    return this.children.size;
  }
}

/**
 * Singleton instance — import and use everywhere.
 * 单例实例——全局导入使用。
 */
export const processSupervisor = new ProcessSupervisor();
