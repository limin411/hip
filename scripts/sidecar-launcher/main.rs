//! Production sidecar launcher (macOS / Linux / Windows).
//!
//! Tauri's `externalBin` expects a single executable named `sidecar-<triple>`.
//! The real Node runtime + esbuild-bundled JS live next to the app as
//! `hip-sidecar/` (NSIS / portable) or `Contents/Resources/hip-sidecar/` (macOS .app).
//!
//! This tiny binary spawns that Node with the bundled script, forwarding args and
//! stdio so Tauri can still observe stdout for the ready `{port,token}` line.
//!
//! On Windows, Node is placed under a Job Object with KILL_ON_JOB_CLOSE so that
//! Tauri's `child.kill()` on this launcher PID also tears down the Node tree
//! (plain `Command::status()` would otherwise orphan Node and keep the port/DB).

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::process::exit;
#[cfg(windows)]
use std::ptr;

fn runtime_dir(exe: &Path) -> PathBuf {
    if let Some(p) = env::var_os("HIP_SIDECAR_RUNTIME") {
        return PathBuf::from(p);
    }
    let parent = exe.parent().unwrap_or_else(|| Path::new("."));
    let candidates = [
        // macOS .app: Contents/MacOS/sidecar → Contents/Resources/hip-sidecar
        parent.join("../Resources/hip-sidecar"),
        // Windows NSIS / portable: D:\hip\sidecar.exe → D:\hip\hip-sidecar
        parent.join("hip-sidecar"),
        // Fallback one level up
        parent.join("../hip-sidecar"),
    ];
    for c in &candidates {
        if resolve_node(c).is_some() && c.join("index.js").is_file() {
            return c.clone();
        }
    }
    // Default for error messages (macOS layout).
    parent.join("../Resources/hip-sidecar")
}

/// Prefer platform-native name; accept the alternate so older staged trees still work.
fn resolve_node(runtime: &Path) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let exe = runtime.join("node.exe");
        if exe.is_file() {
            return Some(exe);
        }
        let bare = runtime.join("node");
        if bare.is_file() {
            return Some(bare);
        }
        None
    }
    #[cfg(not(windows))]
    {
        let bare = runtime.join("node");
        if bare.is_file() {
            return Some(bare);
        }
        let exe = runtime.join("node.exe");
        if exe.is_file() {
            return Some(exe);
        }
        None
    }
}

fn path_sep() -> &'static str {
    if cfg!(windows) { ";" } else { ":" }
}

fn main() {
    let exe = match env::current_exe() {
        Ok(p) => p.canonicalize().unwrap_or(p),
        Err(e) => {
            eprintln!("[sidecar-launcher] current_exe failed: {e}");
            std::process::exit(127);
        }
    };

    let runtime = runtime_dir(&exe);
    let script = runtime.join("index.js");

    let node = match resolve_node(&runtime) {
        Some(p) => p,
        None => {
            eprintln!(
                "[sidecar-launcher] node runtime missing under {} (expected node{} + index.js; set HIP_SIDECAR_RUNTIME to override)",
                runtime.display(),
                if cfg!(windows) { ".exe" } else { "" },
            );
            std::process::exit(127);
        }
    };

    if !script.is_file() {
        eprintln!(
            "[sidecar-launcher] index.js missing at {}",
            script.display()
        );
        std::process::exit(127);
    }

    let mut cmd = Command::new(&node);
    cmd.arg(&script);
    cmd.args(env::args().skip(1));
    // Optional native addons next to the script.
    if let Ok(prev) = env::var("PATH") {
        if let Some(dir) = script.parent() {
            cmd.env("PATH", format!("{}{}{}", dir.display(), path_sep(), prev));
        }
    }

    #[cfg(unix)]
    {
        let err = cmd.exec();
        eprintln!("[sidecar-launcher] exec failed: {err}");
        std::process::exit(1);
    }

    #[cfg(windows)]
    {
        run_windows(cmd);
    }
}

#[cfg(windows)]
fn run_windows(mut cmd: Command) {
    type HANDLE = *mut core::ffi::c_void;

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;

    #[repr(C)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct IO_COUNTERS {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        io_info: IO_COUNTERS,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attrs: *mut core::ffi::c_void, name: *const u16) -> HANDLE;
        fn SetInformationJobObject(
            job: HANDLE,
            info_class: i32,
            info: *mut core::ffi::c_void,
            len: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: HANDLE, process: HANDLE) -> i32;
    }

    // Intentionally never CloseHandle(job): handle lives until this process
    // exits (or is TerminateProcess'd by Tauri). Closing the last handle then
    // kills every process still assigned to the job.
    let job = unsafe { CreateJobObjectW(ptr::null_mut(), ptr::null()) };
    if job.is_null() {
        eprintln!("[sidecar-launcher] CreateJobObjectW failed");
        exit(1);
    }

    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let set_ok = unsafe {
        SetInformationJobObject(
            job,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            &mut info as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if set_ok == 0 {
        eprintln!("[sidecar-launcher] SetInformationJobObject failed");
        exit(1);
    }

    let mut child = cmd.spawn().unwrap_or_else(|e| {
        eprintln!("[sidecar-launcher] spawn failed: {e}");
        exit(1);
    });

    let process_handle = child.as_raw_handle() as HANDLE;
    let assign_ok = unsafe { AssignProcessToJobObject(job, process_handle) };
    if assign_ok == 0 {
        eprintln!("[sidecar-launcher] AssignProcessToJobObject failed");
        let _ = child.kill();
        exit(1);
    }

    let status = child.wait().unwrap_or_else(|e| {
        eprintln!("[sidecar-launcher] wait failed: {e}");
        exit(1);
    });
    exit(status.code().unwrap_or(1));
}
