/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Windows Job Object Manager
 *
 * Provides kernel-level child process lifecycle management on Windows.
 * When initialized, creates a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
 * and assigns the current process (Sudowork/Electron) to it.
 *
 * This ensures that when Sudowork exits — even abnormally (crash, force kill) —
 * ALL child processes (including grandchildren like scode spawned via cmd.exe)
 * are automatically terminated by the Windows kernel.
 *
 * Key advantages over taskkill-based cleanup:
 *   1. Works even when the parent crashes (kernel-level, not user-space)
 *   2. Catches grandchild processes that may escape process tree tracking
 *   3. Prevents breakaway via JOB_OBJECT_LIMIT_BREAKAWAY_OK not being set
 *
 * On non-Windows platforms, all operations are no-ops.
 *
 * Windows Job Object 管理器
 *
 * 在 Windows 上提供内核级子进程生命周期管理。
 * 初始化时创建带有 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 的 Job Object，
 * 并将当前进程（Sudowork/Electron）加入。
 *
 * 这确保当 Sudowork 退出时——即使异常退出（崩溃、强制终止）——
 * 所有子进程（包括通过 cmd.exe 间接启动的 scode 等孙进程）
 * 都会被 Windows 内核自动终止。
 *
 * 相比 taskkill 清理的优势：
 *   1. 父进程崩溃时仍然有效（内核级，非用户态）
 *   2. 捕获可能逃逸进程树追踪的孙进程
 *   3. 通过不设置 JOB_OBJECT_LIMIT_BREAKAWAY_OK 防止进程逃逸
 *
 * 非 Windows 平台上所有操作都是空操作。
 */

let jobObjectModule: {
  initJobObject: () => boolean;
  assignProcessToJob: (pid: number) => boolean;
  isJobActive: () => boolean;
} | null = null;

let initialized = false;

/**
 * Try to load the native win-job-object addon.
 * Fails silently — the ProcessSupervisor's taskkill approach is the fallback.
 *
 * 尝试加载 win-job-object 原生插件。
 * 静默失败——ProcessSupervisor 的 taskkill 方案作为后备。
 */
function loadNativeModule(): typeof jobObjectModule {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../native/win-job-object');
  } catch (err) {
    console.warn(
      '[WindowsJobManager] Failed to load native module, Job Object cleanup disabled:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Initialize the Windows Job Object.
 *
 * Must be called once at application startup, as early as possible
 * (ideally right after ProcessSupervisor.initialize()).
 *
 * After this call, all child processes spawned by Sudowork will
 * automatically be members of the Job Object. When Sudowork exits
 * (even via crash), the OS will kill all job members.
 *
 * 初始化 Windows Job Object。
 *
 * 必须在应用启动时尽早调用一次（理想情况下在
 * ProcessSupervisor.initialize() 之后）。
 *
 * 调用后，Sudowork 生成的所有子进程都会自动成为 Job Object 的成员。
 * 当 Sudowork 退出（即使崩溃）时，OS 会杀死所有 Job 成员。
 */
export function initializeJobObject(): boolean {
  if (initialized) {
    return isJobActive();
  }
  initialized = true;

  if (process.platform !== 'win32') {
    return false;
  }

  jobObjectModule = loadNativeModule();
  if (!jobObjectModule) {
    return false;
  }

  try {
    const result = jobObjectModule.initJobObject();
    if (result) {
      console.log('[WindowsJobManager] Job Object initialized — all child processes will be auto-terminated on exit');
    } else {
      console.log('[WindowsJobManager] Job Object already initialized');
    }
    return result;
  } catch (err) {
    console.warn(
      '[WindowsJobManager] Failed to initialize Job Object:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Explicitly assign a child process (by PID) to the Job Object.
 *
 * This is a belt-and-suspenders measure — child processes spawned by
 * the current process should already inherit job membership automatically.
 * Use this for processes that may have been created with
 * CREATE_BREAKAWAY_FROM_JOB or were otherwise not automatically assigned.
 *
 * 显式将子进程（通过 PID）加入 Job Object。
 *
 * 这是额外的安全措施——当前进程生成的子进程通常会自动继承
 * Job 成员资格。用于可能使用 CREATE_BREAKAWAY_FROM_JOB 创建的进程。
 */
export function assignProcessToJob(pid: number): boolean {
  if (!jobObjectModule || !isJobActive()) {
    return false;
  }

  try {
    return jobObjectModule.assignProcessToJob(pid);
  } catch (err) {
    console.warn(
      `[WindowsJobManager] Failed to assign PID ${pid} to Job Object:`,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Check if the Job Object is active and protecting child processes.
 * 检查 Job Object 是否已激活并正在保护子进程。
 */
export function isJobActive(): boolean {
  if (!jobObjectModule) {
    return false;
  }
  try {
    return jobObjectModule.isJobActive();
  } catch {
    return false;
  }
}
