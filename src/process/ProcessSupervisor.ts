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
 * Two complementary mechanisms are used:
 *
 * 1. **Windows Job Object** (primary on Windows):
 *    Creates a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and assigns
 *    the current process to it. All child processes (including grandchildren
 *    like scode spawned via cmd.exe) automatically inherit job membership.
 *    When the parent exits — even abnormally — the OS kernel closes the Job
 *    Object handle, terminating all member processes. This is the most robust
 *    mechanism because it works at the kernel level.
 *
 * 2. **process.on('exit') handler** (fallback / cross-platform):
 *    Fires synchronously as the very last step before the process terminates.
 *    Uses synchronous system calls (execFileSync / process.kill) to terminate
 *    every tracked child. This is the safety net for non-Windows platforms and
 *    provides defense-in-depth on Windows.
 *
 * OS 级进程监管器。
 *
 * 确保父进程退出时所有子进程都被终止，无论退出方式如何（正常退出、Ctrl+C、
 * SIGTERM、未捕获异常、process.exit()）。
 *
 * 使用两个互补机制：
 *
 * 1. **Windows Job Object**（Windows 上的主要机制）：
 *    创建带有 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 的 Job Object，并将当前进程
 *    加入。所有子进程（包括通过 cmd.exe 间接启动的 scode 等孙进程）自动继承
 *    Job 成员资格。父进程退出时——即使异常退出——OS 内核关闭 Job Object 句柄，
 *    终止所有成员进程。这是最可靠的机制，因为它工作在内核级别。
 *
 * 2. **process.on('exit') 处理器**（后备 / 跨平台）：
 *    在进程终止前同步触发。使用同步系统调用（execFileSync / process.kill）终止
 *    所有被追踪的子进程。在非 Windows 平台上是安全网，在 Windows 上提供纵深防御。
 */

import type { ChildProcess } from 'child_process';
import { execFileSync } from 'child_process';
import { initializeJobObject, isJobActive } from './WindowsJobManager';

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
   * On Windows, also initializes a Job Object with KILL_ON_JOB_CLOSE —
   * this is the primary cleanup mechanism that works even when the parent
   * process is killed (SIGKILL / TerminateProcess / crash).
   *
   * 初始化监管器。必须在应用启动时尽早调用（在任何子进程 spawn 之前）。
   *
   * 在 Windows 上，同时初始化带有 KILL_ON_JOB_CLOSE 的 Job Object——
   * 这是主要的清理机制，即使父进程被杀死（SIGKILL / TerminateProcess / 崩溃）
   * 也能工作。
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // ── Windows Job Object (primary mechanism) ──
    // Creates a Job Object and assigns the current process to it.
    // All child processes inherit job membership automatically.
    // When sudowork exits (even crashes), the OS kernel closes the handle
    // and kills ALL member processes — including grandchildren like scode
    // spawned via cmd.exe.
    //
    // Windows Job Object（主要机制）：
    // 创建 Job Object 并将当前进程加入。所有子进程自动继承 Job 成员资格。
    // sudowork 退出时（即使崩溃），OS 内核关闭句柄并杀死所有成员进程——
    // 包括通过 cmd.exe 间接启动的 scode 等孙进程。
    if (process.platform === 'win32') {
      try {
        const result = initializeJobObject();
        if (result) {
          console.log('[ProcessSupervisor] Windows Job Object initialized — kernel-level child process cleanup active');
        }
      } catch (err) {
        console.warn('[ProcessSupervisor] Failed to initialize Windows Job Object, falling back to taskkill:', err);
      }
    }

    // ── process.on('exit') handler (fallback / defense-in-depth) ──
    // This is the last-resort synchronous cleanup.
    // It fires during:
    //   - Normal exit (event loop drained)
    //   - process.exit() calls
    //   - SIGINT with default handler
    //   - SIGTERM with default handler
    //   - Uncaught exception exit
    // It does NOT fire during SIGKILL (nothing can intercept SIGKILL).
    // On Windows, the Job Object covers the SIGKILL/crash case.
    //
    // `process.on('exit')` 是后备的同步清理手段，在以下情况触发：
    //   - 正常退出（事件循环排空）
    //   - process.exit() 调用
    //   - SIGINT 默认处理
    //   - SIGTERM 默认处理
    //   - 未捕获异常退出
    // SIGKILL 时不触发（没有任何机制可以拦截 SIGKILL）。
    // 在 Windows 上，Job Object 覆盖了 SIGKILL/崩溃的场景。
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
   * On Windows with an active Job Object, this is defense-in-depth:
   * the Job Object's KILL_ON_JOB_CLOSE will also kill all member processes
   * when the OS closes our handle. The explicit taskkill here ensures
   * immediate cleanup for the graceful-exit path.
   *
   * 同步杀死所有被追踪的子进程。
   * 在 `process.on('exit')` 内调用，此处只能执行同步代码。
   *
   * 在 Windows 上如果 Job Object 已激活，这是纵深防御：
   * Job Object 的 KILL_ON_JOB_CLOSE 会在 OS 关闭句柄时也杀死所有成员进程。
   * 这里的显式 taskkill 确保优雅退出路径上的立即清理。
   */
  private killAllSync(): void {
    if (this.children.size === 0) return;

    // On Windows, if Job Object is active, the kernel will handle cleanup
    // when our process exits. We still do explicit kills for immediate
    // cleanup during graceful shutdown.
    // Windows 上如果 Job Object 已激活，内核会在进程退出时处理清理。
    // 我们仍然执行显式 kill 以便在优雅关闭期间立即清理。
    const jobActive = process.platform === 'win32' && isJobActive();

    for (const [pid, { isDetached }] of this.children) {
      try {
        if (process.platform === 'win32') {
          // taskkill /T kills the entire process tree, /F forces termination.
          // Even with Job Object active, we still try taskkill for immediate cleanup.
          // taskkill /T 杀死整个进程树，/F 强制终止。
          // 即使 Job Object 已激活，仍然尝试 taskkill 以立即清理。
          try {
            execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
              windowsHide: true,
              timeout: 5000,
              stdio: 'ignore',
            });
          } catch {
            // Process may already be dead (or will be killed by Job Object) — ignore.
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

    if (jobActive) {
      // The Job Object will handle any processes we missed.
      // This message won't be visible in crash scenarios, but helps debugging
      // during graceful shutdown.
      // Job Object 会处理我们遗漏的任何进程。
    }
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
