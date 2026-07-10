//! PATH lookup helpers (`which_binaries` command).

/// True if `p` is a file and (on unix) has any execute bit set.
pub(crate) fn is_executable(p: &std::path::Path) -> bool {
    if !p.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(p) {
            Ok(m) => m.permissions().mode() & 0o111 != 0,
            Err(_) => false,
        }
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// For each name, true iff an executable of that name exists in any of `dirs`.
/// `names` are expected to be bare binary names (from the app's ACP preset list),
/// not paths — they are joined onto each PATH dir as-is.
pub(crate) fn find_on_path(
    names: &[String],
    dirs: &[std::path::PathBuf],
) -> std::collections::HashMap<String, bool> {
    names
        .iter()
        .map(|n| (n.clone(), dirs.iter().any(|d| is_executable(&d.join(n)))))
        .collect()
}

/// Probe PATH for each requested executable. Uses this process's inherited PATH —
/// the SAME env the sidecar (and thus spawned ACP agents) inherits — so a `true`
/// here honestly predicts the agent will be spawnable.
#[tauri::command]
pub fn which_binaries(names: Vec<String>) -> Result<std::collections::HashMap<String, bool>, String> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let dirs: Vec<std::path::PathBuf> = std::env::split_paths(&path)
        .filter(|d| !d.as_os_str().is_empty())
        .collect();
    Ok(find_on_path(&names, &dirs))
}
