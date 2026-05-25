use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Windows Job Object manager for child process lifecycle control.
///
/// Creates a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, which
/// ensures ALL processes in the job are terminated when the last handle
/// to the Job Object is closed — including when the parent process
/// (Sudowork/Electron) exits abnormally (crash, SIGKILL, etc.).
///
/// By NOT setting JOB_OBJECT_LIMIT_BREAKAWAY_OK, grandchild processes
/// (e.g., scode spawned via cmd.exe) cannot escape the job, solving the
/// orphaned process issue on Windows.
///
/// Windows Job Object 管理器，用于子进程生命周期控制。
///
/// 创建带有 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 的 Job Object，确保当
/// Job Object 的最后一个句柄关闭时（包括父进程异常退出），所有 Job 内
/// 的进程都会被终止。
///
/// 通过不设置 JOB_OBJECT_LIMIT_BREAKAWAY_OK，防止孙进程（如通过 cmd.exe
/// 间接启动的 scode）逃逸，彻底解决 Windows 上的孤儿进程问题。

#[cfg(windows)]
mod win {
    use napi::bindgen_prelude::*;
    use std::sync::OnceLock;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    /// Global Job Object handle — lives for the entire process lifetime.
    /// When the process exits, the OS closes all handles including this one,
    /// which triggers JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
    ///
    /// 全局 Job Object 句柄，贯穿进程生命周期。进程退出时 OS 自动关闭
    /// 所有句柄，触发 KILL_ON_JOB_CLOSE。
    static JOB_HANDLE: OnceLock<isize> = OnceLock::new();

    /// Create a Job Object with KILL_ON_JOB_CLOSE and assign the current
    /// process to it. All child processes will automatically inherit job
    /// membership (Windows 8+ nested job support).
    ///
    /// Returns true on success, false if already initialized.
    /// Throws on Windows API failure.
    ///
    /// 创建 Job Object 并将当前进程加入。所有子进程自动继承 Job 成员资格。
    pub fn init_job_object() -> Result<bool> {
        if JOB_HANDLE.get().is_some() {
            return Ok(false); // Already initialized
        }

        unsafe {
            // Create an unnamed Job Object
            // 创建匿名 Job Object
            let job = CreateJobObjectW(None, None)
                .map_err(|e| Error::from_reason(format!("CreateJobObjectW failed: {e}")))?;

            // Configure: kill all processes when the job handle is closed
            // 配置：当 Job 句柄关闭时杀死所有进程
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // NOTE: JOB_OBJECT_LIMIT_BREAKAWAY_OK is intentionally NOT set.
            // This prevents child processes from using CREATE_BREAKAWAY_FROM_JOB,
            // ensuring grandchild processes (e.g., scode via cmd.exe) cannot escape.
            //
            // 注意：故意不设置 JOB_OBJECT_LIMIT_BREAKAWAY_OK。
            // 这防止子进程使用 CREATE_BREAKAWAY_FROM_JOB 标志逃逸，
            // 确保孙进程（如通过 cmd.exe 启动的 scode）无法逃脱 Job。

            let info_ptr = &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const std::ffi::c_void;
            let info_size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;

            SetInformationJobObject(job, JobObjectExtendedLimitInformation, info_ptr, info_size)
                .map_err(|e| {
                    let _ = CloseHandle(job);
                    Error::from_reason(format!("SetInformationJobObject failed: {e}"))
                })?;

            // Assign the current process (Sudowork/Electron) to the job.
            // On Windows 8+, a process can belong to multiple jobs (nested jobs).
            // All child processes spawned after this call will automatically be
            // members of the job.
            //
            // 将当前进程（Sudowork/Electron）加入 Job。
            // Windows 8+ 支持嵌套 Job，进程可以属于多个 Job。
            // 此调用之后 spawn 的所有子进程都会自动成为 Job 成员。
            AssignProcessToJobObject(job, GetCurrentProcess())
                .map_err(|e| {
                    let _ = CloseHandle(job);
                    Error::from_reason(format!("AssignProcessToJobObject (self) failed: {e}"))
                })?;

            // Store the handle in the global static. We intentionally do NOT
            // close this handle — it must remain open for the lifetime of the
            // process. When the process exits (even abnormally), the OS will
            // close the handle, triggering KILL_ON_JOB_CLOSE.
            //
            // 将句柄存入全局静态变量。故意不关闭此句柄——它必须在进程生命
            // 周期内保持打开。进程退出时（即使异常退出），OS 会关闭句柄，
            // 触发 KILL_ON_JOB_CLOSE。
            let raw_handle = job.0 as isize;
            let _ = JOB_HANDLE.set(raw_handle);

            Ok(true)
        }
    }

    /// Explicitly assign an external process (by PID) to the Job Object.
    ///
    /// This is a belt-and-suspenders measure — child processes spawned by
    /// the current process should already inherit job membership. Use this
    /// for processes that were created with CREATE_BREAKAWAY_FROM_JOB or
    /// were otherwise not automatically assigned.
    ///
    /// Returns true on success, false if the Job Object is not initialized.
    ///
    /// 显式将外部进程（通过 PID）加入 Job Object。
    /// 这是额外的安全措施——子进程通常会自动继承 Job 成员资格。
    pub fn assign_process_to_job(pid: u32) -> Result<bool> {
        let raw_handle = match JOB_HANDLE.get() {
            Some(h) => *h,
            None => return Ok(false), // Job not initialized
        };

        unsafe {
            let job = HANDLE(raw_handle as *mut std::ffi::c_void);

            // Open the target process with required permissions
            // 以所需权限打开目标进程
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
                .map_err(|e| Error::from_reason(format!("OpenProcess({pid}) failed: {e}")))?;

            let result = AssignProcessToJobObject(job, process);

            // Always close the process handle — we only needed it for assignment
            // 始终关闭进程句柄——只在分配时需要它
            let _ = CloseHandle(process);

            result.map_err(|e| {
                Error::from_reason(format!(
                    "AssignProcessToJobObject({pid}) failed: {e}"
                ))
            })?;

            Ok(true)
        }
    }

    /// Check if the Job Object has been initialized.
    /// 检查 Job Object 是否已初始化。
    pub fn is_job_active() -> bool {
        JOB_HANDLE.get().is_some()
    }
}

// ── N-API exports ──────────────────────────────────────────────────

/// Initialize the Windows Job Object and assign the current process to it.
///
/// Must be called once at application startup, as early as possible.
/// After this call, ALL child processes (and their children) will
/// automatically be killed when the Sudowork process exits.
///
/// Returns true on first initialization, false if already initialized.
/// On non-Windows platforms, always returns false (no-op).
///
/// 初始化 Windows Job Object 并将当前进程加入。
/// 必须在应用启动时尽早调用一次。
/// 调用后，所有子进程（及其子进程）会在 Sudowork 退出时自动被杀死。
/// 非 Windows 平台返回 false（空操作）。
#[napi]
pub fn init_job_object() -> Result<bool> {
    #[cfg(windows)]
    {
        win::init_job_object()
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

/// Explicitly assign a process (by PID) to the Job Object.
///
/// This is usually not needed — child processes automatically inherit
/// job membership. Use for edge cases where a process was created
/// outside the normal spawn flow.
///
/// 显式将进程（通过 PID）加入 Job Object。
/// 通常不需要——子进程会自动继承 Job 成员资格。
#[napi]
pub fn assign_process_to_job(pid: u32) -> Result<bool> {
    #[cfg(windows)]
    {
        win::assign_process_to_job(pid)
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        Ok(false)
    }
}

/// Check if the Job Object is active.
/// 检查 Job Object 是否已激活。
#[napi]
pub fn is_job_active() -> bool {
    #[cfg(windows)]
    {
        win::is_job_active()
    }
    #[cfg(not(windows))]
    {
        false
    }
}
