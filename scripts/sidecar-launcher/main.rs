//! Production sidecar launcher (macOS / Linux / Windows).
//!
//! Tauri's `externalBin` expects a single executable named `sidecar-<triple>`.
//! The real Node runtime + esbuild-bundled JS live next to the app as
//! `hip-sidecar/` (NSIS / portable) or `Contents/Resources/hip-sidecar/` (macOS .app).
//!
//! ## Unix
//! `exec` replaces this process with Node so Tauri's pipes attach directly.
//!
//! ## Windows
//! We cannot reliably `exec`, and **Stdio::inherit() does not forward Tauri's
//! redirected pipes to a grandchild** (CreateProcess handle inheritance). That
//! made Node's `stdout.write(ready)` fail with exit 1 while a manual
//! `node.exe index.js` worked. Fix: pipe Node's stdio and relay bytes
//! (flushing after every read) between Tauri ↔ this launcher ↔ Node.
//!
//! Node is also placed under a Job Object with KILL_ON_JOB_CLOSE so Tauri's
//! `child.kill()` on this PID tears down Node. If Assign fails, we continue
//! without a job rather than killing Node.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[cfg(windows)]
use std::io::{Read, Write};
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::process::{exit, Stdio};
#[cfg(windows)]
use std::ptr;
#[cfg(windows)]
use std::thread;

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
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

/// Append a line to a small boot log next to the launcher (Windows diagnostics).
fn boot_log(exe: &Path, msg: &str) {
    let parent = exe.parent().unwrap_or_else(|| Path::new("."));
    let path = parent.join("sidecar-launcher.log");
    let line = format!(
        "[{}] {}\n",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        msg
    );
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(line.as_bytes())
        });
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
            let msg = format!(
                "node runtime missing under {} (expected node{} + index.js; set HIP_SIDECAR_RUNTIME to override)",
                runtime.display(),
                if cfg!(windows) { ".exe" } else { "" },
            );
            eprintln!("[sidecar-launcher] {msg}");
            boot_log(&exe, &msg);
            std::process::exit(127);
        }
    };

    if !script.is_file() {
        let msg = format!("index.js missing at {}", script.display());
        eprintln!("[sidecar-launcher] {msg}");
        boot_log(&exe, &msg);
        std::process::exit(127);
    }

    boot_log(
        &exe,
        &format!(
            "starting node={} script={}",
            node.display(),
            script.display()
        ),
    );

    let mut cmd = Command::new(&node);
    cmd.arg(&script);
    cmd.args(env::args().skip(1));
    // Run with runtime as cwd so relative native addon loads stay sane.
    cmd.current_dir(&runtime);
    // Optional native addons next to the script.
    if let Ok(prev) = env::var("PATH") {
        cmd.env(
            "PATH",
            format!("{}{}{}", runtime.display(), path_sep(), prev),
        );
    }

    #[cfg(unix)]
    {
        // Replace this process so Tauri's pipes attach directly to Node.
        let err = cmd.exec();
        eprintln!("[sidecar-launcher] exec failed: {err}");
        boot_log(&exe, &format!("exec failed: {err}"));
        std::process::exit(1);
    }

    #[cfg(windows)]
    {
        run_windows(cmd, &exe);
    }
}

/// Copy all bytes from `from` to `to`, flushing after every successful read so
/// the ready JSON line is not stuck in an 8KiB `io::copy` buffer.
#[cfg(windows)]
fn relay_flush(mut from: impl Read, mut to: impl Write) {
    let mut buf = [0u8; 4096];
    loop {
        match from.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if to.write_all(&buf[..n]).is_err() {
                    break;
                }
                let _ = to.flush();
            }
            Err(_) => break,
        }
    }
}

#[cfg(windows)]
fn run_windows(mut cmd: Command, exe: &Path) {
    type HANDLE = *mut core::ffi::c_void;

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
    // Allow child to leave the parent's job so we can put it in our own.
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

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

    // Explicit pipes + relay (do NOT inherit — Tauri's pipes are not reliable
    // as inherited handles for the Node grandchild on Windows).
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Intentionally never CloseHandle(job): handle lives until this process
    // exits (or is TerminateProcess'd by Tauri). Closing the last handle then
    // kills every process still assigned to the job.
    let job = unsafe { CreateJobObjectW(ptr::null_mut(), ptr::null()) };
    if job.is_null() {
        eprintln!("[sidecar-launcher] CreateJobObjectW failed");
        boot_log(exe, "CreateJobObjectW failed");
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
        boot_log(exe, "SetInformationJobObject failed");
        exit(1);
    }

    // Prefer breakaway so Node is not stuck in Tauri's job (Assign would fail).
    cmd.creation_flags(CREATE_BREAKAWAY_FROM_JOB);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            boot_log(exe, &format!("spawn with BREAKAWAY failed: {e}; retry plain"));
            cmd.creation_flags(0);
            cmd.spawn().unwrap_or_else(|e2| {
                let msg = format!("spawn failed: {e2}");
                eprintln!("[sidecar-launcher] {msg}");
                boot_log(exe, &msg);
                exit(1);
            })
        }
    };

    let process_handle = child.as_raw_handle() as HANDLE;
    let assign_ok = unsafe { AssignProcessToJobObject(job, process_handle) };
    if assign_ok == 0 {
        let msg = "AssignProcessToJobObject failed; continuing without kill-on-close job";
        eprintln!("[sidecar-launcher] {msg}");
        boot_log(exe, msg);
    } else {
        boot_log(exe, "Node assigned to kill-on-close job; stdio relay active");
    }

    let child_stdin = child.stdin.take();
    let child_stdout = child.stdout.take();
    let child_stderr = child.stderr.take();

    // stdout: Node → Tauri (must flush so ready JSON is not buffered)
    let out_thr = child_stdout.map(|mut r| {
        thread::spawn(move || {
            let mut w = std::io::stdout();
            relay_flush(&mut r, &mut w);
        })
    });
    // stderr: Node → Tauri / console
    let err_thr = child_stderr.map(|mut r| {
        thread::spawn(move || {
            let mut w = std::io::stderr();
            relay_flush(&mut r, &mut w);
        })
    });
    // stdin: Tauri → Node (HIP_PARENT_WATCH sees EOF when Tauri closes our stdin)
    let in_thr = child_stdin.map(|mut w| {
        thread::spawn(move || {
            let mut r = std::io::stdin();
            relay_flush(&mut r, &mut w);
            // drop w → closes Node stdin
        })
    });

    let status = child.wait().unwrap_or_else(|e| {
        let msg = format!("wait failed: {e}");
        eprintln!("[sidecar-launcher] {msg}");
        boot_log(exe, &msg);
        exit(1);
    });

    if let Some(t) = out_thr {
        let _ = t.join();
    }
    if let Some(t) = err_thr {
        let _ = t.join();
    }
    if let Some(t) = in_thr {
        let _ = t.join();
    }

    boot_log(exe, &format!("Node exited code={:?}", status.code()));
    exit(status.code().unwrap_or(1));
}
