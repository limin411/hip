# `~/.hip/` Storage Centralization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every persistent file hip writes into a single namespaced `~/.hip/{db,config,cache,scratch}` root, and relocate provider API keys from the macOS Keychain into a `0600` `~/.hip/config/auth.json`.

**Architecture:** The Rust/Tauri shell stays the single path-decision point: it computes the storage root (Unix `$HOME/.hip`; Windows native app-data) via new helpers, reads/writes the JSON/db-pointer files itself, and injects paths into the Node sidecar via env vars (`HIP_DB_PATH`, `HIP_PROVIDERS_PATH`, new `HIP_SCRATCH_ROOT`). Secrets move to a file-backed store that preserves the existing `set/get/has/delete_secret` command contract, so the renderer and `@hip/protocol` need no changes.

**Tech Stack:** Rust (Tauri 2, serde_json, std::fs), TypeScript (Node sidecar, vitest), no new crates.

**Spec:** [docs/superpowers/specs/2026-06-12-hip-home-dir-storage-design.md](../specs/2026-06-12-hip-home-dir-storage-design.md)

---

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src-tauri/src/paths.rs` | Resolve the storage root + namespaced subdirs (`db/config/cache/scratch`). Pure core `hip_base_from` is unit-testable. | Create |
| `src-tauri/src/auth.rs` | File-backed secret store: read/write `auth.json` (atomic, `0600`), `auth_get/set/delete`. | Create |
| `src-tauri/src/lib.rs` | Register modules; rewrite the four `*_secret` commands + `get_secret_value` onto `auth.rs`; route `providers_config_path` + `models.json` cache through `paths.rs`. | Modify |
| `src-tauri/src/sidecar.rs` | Route `HIP_DB_PATH`/`HIP_PROVIDERS_PATH`/`configured_provider_ids` through `paths.rs`; inject `HIP_SCRATCH_ROOT`; thread `app` into `read_provider_key`. | Modify |
| `src-tauri/Cargo.toml` | Drop the `keyring` dependency. | Modify |
| `packages/sidecar/src/session/scratch.ts` | `defaultScratchRoot()` honors `HIP_SCRATCH_ROOT`. | Modify |
| `packages/sidecar/src/session/scratch.test.ts` | Cover the env override + fallback. | Modify |
| `packages/protocol/src/index.ts` | Update comments that name the keychain / app-data location. | Modify |
| `README.md` | Update the secret-storage note + add a no-sync warning. | Modify |

**Test commands used throughout:**
- Rust (single test): `cargo test --manifest-path src-tauri/Cargo.toml <test_name>`
- Rust (all + build): `cargo test --manifest-path src-tauri/Cargo.toml`
- Node (single file): `npx vitest run packages/sidecar/src/session/scratch.test.ts`

---

## Task 1: Rust path helpers (`paths.rs`)

**Files:**
- Create: `src-tauri/src/paths.rs`
- Modify: `src-tauri/src/lib.rs:1` (add `mod paths;`)

- [ ] **Step 1: Create `paths.rs` with the pure core + its failing test**

Create `src-tauri/src/paths.rs`:

```rust
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Pure core: pick the storage root. Unix → `$HOME/.hip`; Windows → app-data dir.
/// Split out from `hip_base_dir` so it is unit-testable without a Tauri AppHandle.
pub fn hip_base_from(home: Option<PathBuf>, app_data: Option<PathBuf>) -> Option<PathBuf> {
    if cfg!(windows) {
        app_data
    } else {
        home.map(|h| h.join(".hip"))
    }
}

/// The storage root for the running app.
pub fn hip_base_dir(app: &AppHandle) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let app_data = app.path().app_data_dir().ok();
    hip_base_from(home, app_data)
}

/// `<root>/<sub>`, created on demand. The `config` subdir is locked to `0o700` on Unix.
pub fn hip_subdir(app: &AppHandle, sub: &str) -> Option<PathBuf> {
    let dir = hip_base_dir(app)?.join(sub);
    std::fs::create_dir_all(&dir).ok()?;
    #[cfg(unix)]
    if sub == "config" {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    Some(dir)
}

pub fn db_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "db") }
pub fn config_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "config") }
pub fn cache_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "cache") }
pub fn scratch_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "scratch") }

#[cfg(test)]
mod tests {
    use super::hip_base_from;
    use std::path::PathBuf;

    #[test]
    #[cfg(not(windows))]
    fn unix_uses_home_dot_hip() {
        let base = hip_base_from(Some(PathBuf::from("/Users/x")), Some(PathBuf::from("/ignored")));
        assert_eq!(base, Some(PathBuf::from("/Users/x/.hip")));
    }

    #[test]
    #[cfg(not(windows))]
    fn unix_none_home_is_none() {
        assert_eq!(hip_base_from(None, Some(PathBuf::from("/x"))), None);
    }

    #[test]
    #[cfg(windows)]
    fn windows_uses_app_data() {
        let base = hip_base_from(
            Some(PathBuf::from(r"C:\Users\x")),
            Some(PathBuf::from(r"C:\AppData\com.ljm.app")),
        );
        assert_eq!(base, Some(PathBuf::from(r"C:\AppData\com.ljm.app")));
    }
}
```

Add the module declaration at the top of `src-tauri/src/lib.rs` (it currently begins with `mod sidecar;` on line 1):

```rust
mod sidecar;
mod paths;
```

- [ ] **Step 2: Run the test to verify it passes (compiles + logic)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml unix_uses_home_dot_hip`
Expected: PASS (`unix_uses_home_dot_hip`, `unix_none_home_is_none` run on macOS/Linux; the windows test is `#[cfg(windows)]` and is skipped).

If you get a "function is never used" warning for `db_dir`/`cache_dir`/`scratch_dir`, that's expected until Task 5 wires them — do not delete them.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/paths.rs src-tauri/src/lib.rs
git commit -m "feat(paths): add ~/.hip namespaced storage-root helpers"
```

---

## Task 2: Rust file-backed secret store (`auth.rs`)

**Files:**
- Create: `src-tauri/src/auth.rs`
- Modify: `src-tauri/src/lib.rs:2` (add `mod auth;`)

- [ ] **Step 1: Write `auth.rs` with the store + failing tests**

Create `src-tauri/src/auth.rs`:

```rust
use serde_json::{Map, Value};
use std::io;
use std::path::Path;

/// Read the auth map. A missing or corrupt file yields an empty map (never an error),
/// so a hand-deleted/garbled `auth.json` degrades to "no keys" rather than breaking the app.
fn read_auth_map(path: &Path) -> Map<String, Value> {
    match std::fs::read_to_string(path) {
        Ok(body) => serde_json::from_str::<Map<String, Value>>(&body).unwrap_or_default(),
        Err(_) => Map::new(),
    }
}

/// Write the auth map atomically (temp file + rename) with `0o600` on Unix.
/// Perms are set on the temp file BEFORE the rename, so the final file is never
/// briefly world-readable, and a pre-existing wide `auth.json` is replaced (not widened).
fn write_auth_map(path: &Path, map: &Map<String, Value>) -> io::Result<()> {
    let body = serde_json::to_string_pretty(map)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, body.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Get one secret by key (key == the `HIP_MODEL_<ID>_API_KEY` env-var name).
pub fn auth_get(path: &Path, key: &str) -> Option<String> {
    read_auth_map(path)
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Insert/replace one secret and persist.
pub fn auth_set(path: &Path, key: &str, value: &str) -> io::Result<()> {
    let mut map = read_auth_map(path);
    map.insert(key.to_string(), Value::String(value.to_string()));
    write_auth_map(path, &map)
}

/// Remove one secret and persist (no-op if absent).
pub fn auth_delete(path: &Path, key: &str) -> io::Result<()> {
    let mut map = read_auth_map(path);
    map.remove(key);
    write_auth_map(path, &map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hip-auth-test-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("auth.json")
    }

    #[test]
    fn set_get_delete_roundtrip() {
        let p = tmp_path("roundtrip");
        let _ = std::fs::remove_file(&p);
        assert_eq!(auth_get(&p, "HIP_MODEL_DEEPSEEK_API_KEY"), None);

        auth_set(&p, "HIP_MODEL_DEEPSEEK_API_KEY", "sk-abc").unwrap();
        auth_set(&p, "HIP_MODEL_OPENAI_API_KEY", "sk-xyz").unwrap();
        assert_eq!(auth_get(&p, "HIP_MODEL_DEEPSEEK_API_KEY"), Some("sk-abc".to_string()));
        assert_eq!(auth_get(&p, "HIP_MODEL_OPENAI_API_KEY"), Some("sk-xyz".to_string()));

        auth_delete(&p, "HIP_MODEL_DEEPSEEK_API_KEY").unwrap();
        assert_eq!(auth_get(&p, "HIP_MODEL_DEEPSEEK_API_KEY"), None);
        // Deleting one key must not disturb the others.
        assert_eq!(auth_get(&p, "HIP_MODEL_OPENAI_API_KEY"), Some("sk-xyz".to_string()));
    }

    #[test]
    fn missing_file_reads_as_empty() {
        let p = std::env::temp_dir().join("hip-auth-does-not-exist-xyz.json");
        let _ = std::fs::remove_file(&p);
        assert_eq!(auth_get(&p, "anything"), None);
    }

    #[test]
    #[cfg(unix)]
    fn file_is_0600_after_write() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("perms");
        let _ = std::fs::remove_file(&p);
        auth_set(&p, "K", "v").unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    #[cfg(unix)]
    fn preexisting_wide_file_is_tightened() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("wide");
        std::fs::write(&p, "{}").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();
        auth_set(&p, "K", "v").unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
```

Add the module declaration in `src-tauri/src/lib.rs` (just below `mod paths;` from Task 1):

```rust
mod sidecar;
mod paths;
mod auth;
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml auth::`
Expected: PASS — `set_get_delete_roundtrip`, `missing_file_reads_as_empty`, `file_is_0600_after_write`, `preexisting_wide_file_is_tightened`.

(The `auth::` functions are not called from non-test code yet, so expect dead-code warnings until Task 3.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/auth.rs src-tauri/src/lib.rs
git commit -m "feat(auth): file-backed secret store (atomic, 0600 auth.json)"
```

---

## Task 3: Wire the secret commands onto the file store

**Files:**
- Modify: `src-tauri/src/lib.rs:51-95` (replace `SECRET_SERVICE` + the keyring command bodies)
- Modify: `src-tauri/src/sidecar.rs:124-126` (`read_provider_key` gains `app`) and `:27` (call site)

- [ ] **Step 1: Replace the keyring-backed secrets block in `lib.rs`**

In `src-tauri/src/lib.rs`, replace the whole block from `const SECRET_SERVICE` through the end of `delete_secret` (lines 51–95) with:

```rust
/// Path to the file-backed secret store (`~/.hip/config/auth.json`).
fn auth_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(paths::config_dir(app).ok_or("no config dir")?.join("auth.json"))
}

/// Internal reader used by the sidecar spawn path.
pub fn get_secret_value(app: &tauri::AppHandle, key: &str) -> Option<String> {
    auth::auth_get(&auth_path(app).ok()?, key)
}

#[tauri::command]
fn set_secret(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    auth::auth_set(&auth_path(&app)?, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_secret(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    Ok(auth::auth_get(&auth_path(&app)?, &key))
}

#[tauri::command]
fn has_secret(app: tauri::AppHandle, key: String) -> Result<bool, String> {
    Ok(get_secret(app, key)?.is_some())
}

#[tauri::command]
fn delete_secret(app: tauri::AppHandle, key: String) -> Result<(), String> {
    auth::auth_delete(&auth_path(&app)?, &key).map_err(|e| e.to_string())
}
```

Note: adding `app: tauri::AppHandle` as the first command parameter is transparent to the renderer — Tauri injects it; `invoke('get_secret', { key })` in `src/ipc/secrets.ts` is unchanged.

- [ ] **Step 2: Thread `app` through `read_provider_key` in `sidecar.rs`**

In `src-tauri/src/sidecar.rs`, change `read_provider_key` (lines 123–126):

```rust
/// Read a provider's API key from the file store (key name == env var name).
pub fn read_provider_key(app: &AppHandle, provider_id: &str) -> Option<String> {
    crate::get_secret_value(app, &provider_key_env(provider_id))
}
```

And update its call site inside `spawn_sidecar` (line 27) from `read_provider_key(&id)` to:

```rust
        match read_provider_key(app, &id) {
```

- [ ] **Step 3: Build to verify the crate compiles with no keyring references left in code**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds successfully. (The `keyring` *dependency* is still in `Cargo.toml` but is now unused in code — removed in Task 4.)

- [ ] **Step 4: Run the full Rust test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — all `paths::`, `auth::`, and existing `sidecar::` tests green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/sidecar.rs
git commit -m "feat(secrets): back set/get/has/delete_secret with auth.json"
```

---

## Task 4: Remove the `keyring` dependency

**Files:**
- Modify: `src-tauri/Cargo.toml:29`

- [ ] **Step 1: Delete the keyring dependency line**

In `src-tauri/Cargo.toml`, remove this line (line 29):

```toml
keyring = { version = "3", features = ["apple-native", "windows-native", "sync-secret-service", "crypto-rust"] }
```

- [ ] **Step 2: Rebuild to confirm nothing references keyring**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds successfully (no `unresolved import keyring` errors). `Cargo.lock` updates to drop keyring + its transitive deps.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(deps): drop keyring; secrets now live in auth.json"
```

---

## Task 5: Route db / providers / models / scratch through the helpers

**Files:**
- Modify: `src-tauri/src/lib.rs:101-105` (`providers_config_path`), `:123` (models cache)
- Modify: `src-tauri/src/sidecar.rs:33-42` (env injection), `:130-145` (`configured_provider_ids`)

- [ ] **Step 1: Point `providers_config_path` and the models cache at the helpers**

In `src-tauri/src/lib.rs`, replace `providers_config_path` (lines 101–105) with:

```rust
fn providers_config_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    Some(paths::config_dir(app)?.join("hip-providers.json"))
}
```

And in `models_catalog`, change the cache binding (line 123) from the `app_data_dir()` form to:

```rust
    let cache = paths::cache_dir(&app).map(|d| d.join("models.json"));
```

- [ ] **Step 2: Route the sidecar env injection through the helpers + add `HIP_SCRATCH_ROOT`**

In `src-tauri/src/sidecar.rs`, replace the two env-injection blocks (lines 32–42) with:

```rust
    // Point the sidecar at the non-secret providers config (active model + base URLs).
    if let Some(dir) = crate::paths::config_dir(app) {
        cmd = cmd.env(
            "HIP_PROVIDERS_PATH",
            dir.join("hip-providers.json").to_string_lossy().into_owned(),
        );
    }
    // Tell the sidecar where to persist sessions. paths::db_dir creates the dir; if it's
    // unavailable the sidecar falls back to an in-memory DB rather than failing to start.
    if let Some(dir) = crate::paths::db_dir(app) {
        cmd = cmd.env("HIP_DB_PATH", db_path_for(&dir).to_string_lossy().into_owned());
    }
    // Make the cross-platform root authoritative for scratch too (Windows consistency).
    // On macOS/Linux this equals scratch.ts's existing default, so behavior is unchanged.
    if let Some(dir) = crate::paths::scratch_dir(app) {
        cmd = cmd.env("HIP_SCRATCH_ROOT", dir.to_string_lossy().into_owned());
    }
```

- [ ] **Step 3: Route `configured_provider_ids` through the same `config_dir` helper**

In `src-tauri/src/sidecar.rs`, change `configured_provider_ids` (lines 130–145) so its path comes from the helper (this is the key-injection reader that MUST agree with `providers_config_path`):

```rust
fn configured_provider_ids(app: &AppHandle) -> Vec<String> {
    let mut ids = vec!["deepseek".to_string()];
    if let Some(dir) = crate::paths::config_dir(app) {
        let path = dir.join("hip-providers.json");
        if let Ok(body) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(map) = v.get("providers").and_then(|p| p.as_object()) {
                    for k in map.keys() {
                        if !ids.contains(k) {
                            ids.push(k.clone());
                        }
                    }
                }
            }
        }
    }
    ids
}
```

- [ ] **Step 4: Build + run the full Rust suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, and no remaining `app.path().app_data_dir()` calls for db/providers/models (verify with `grep -n app_data_dir src-tauri/src/*.rs` → only the call inside `paths::hip_base_dir` should remain).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/sidecar.rs
git commit -m "feat(paths): move hip.db/providers/models cache + scratch under ~/.hip"
```

---

## Task 6: Node — honor `HIP_SCRATCH_ROOT`

**Files:**
- Modify: `packages/sidecar/src/session/scratch.ts:6-8`
- Modify: `packages/sidecar/src/session/scratch.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/sidecar/src/session/scratch.test.ts`, add `defaultScratchRoot` to the imports:

```ts
import { scratchDirFor, ensureScratchDir, removeScratchDir, defaultScratchRoot } from './scratch.js'
```

And append this `describe` block at the end of the file:

```ts
describe('defaultScratchRoot', () => {
  const saved = process.env.HIP_SCRATCH_ROOT
  afterEach(() => {
    if (saved === undefined) delete process.env.HIP_SCRATCH_ROOT
    else process.env.HIP_SCRATCH_ROOT = saved
  })

  it('honors HIP_SCRATCH_ROOT when set', () => {
    process.env.HIP_SCRATCH_ROOT = '/custom/scratch/root'
    expect(defaultScratchRoot()).toBe('/custom/scratch/root')
  })

  it('falls back to ~/.hip/scratch when unset', () => {
    delete process.env.HIP_SCRATCH_ROOT
    expect(defaultScratchRoot()).toBe(path.join(os.homedir(), '.hip', 'scratch'))
  })
})
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npx vitest run packages/sidecar/src/session/scratch.test.ts`
Expected: FAIL — `honors HIP_SCRATCH_ROOT when set` fails (current `defaultScratchRoot` ignores the env var and returns `~/.hip/scratch`).

- [ ] **Step 3: Implement the env override**

In `packages/sidecar/src/session/scratch.ts`, replace `defaultScratchRoot` (lines 5–8) with:

```ts
/** Default per-user root for pure-chat sandbox workspaces.
 *  Honors HIP_SCRATCH_ROOT (injected by the Tauri shell so the cross-platform
 *  root is authoritative); falls back to ~/.hip/scratch for standalone runs. */
export function defaultScratchRoot(): string {
  const fromEnv = process.env.HIP_SCRATCH_ROOT?.trim()
  if (fromEnv) return fromEnv
  return path.join(os.homedir(), '.hip', 'scratch')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/sidecar/src/session/scratch.test.ts`
Expected: PASS — all `scratch` and `defaultScratchRoot` tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/scratch.ts packages/sidecar/src/session/scratch.test.ts
git commit -m "feat(scratch): honor HIP_SCRATCH_ROOT from the Tauri shell"
```

---

## Task 7: Update docs & comments

**Files:**
- Modify: `packages/protocol/src/index.ts:20,28,34`
- Modify: `README.md:38-41`

- [ ] **Step 1: Fix the protocol comments that name the keychain / app-data location**

In `packages/protocol/src/index.ts`:

Line 20 — change:
```ts
/** One provider's non-secret config (the key lives only in the keychain). */
```
to:
```ts
/** One provider's non-secret config (the key lives only in ~/.hip/config/auth.json). */
```

Line 28 — change:
```ts
/** Durable, non-secret provider config persisted to app_data_dir/hip-providers.json. */
```
to:
```ts
/** Durable, non-secret provider config persisted to ~/.hip/config/hip-providers.json. */
```

Line 34 — change:
```ts
/** Keychain entry name AND env var name for a provider's API key. Single source of the rule. */
```
to:
```ts
/** auth.json key name AND env var name for a provider's API key. Single source of the rule. */
```

- [ ] **Step 2: Update the README secret-storage note + add the no-sync warning**

In `README.md`, replace the blockquote (lines 38–41) with:

```markdown
> The DeepSeek API key is entered in the app's **Settings** panel and stored in
> `~/.hip/config/auth.json` (file mode `0600`) — the desktop app reads it from
> there only. **`~/.hip/config/` holds plaintext API keys; do not sync it to
> cloud drives or dotfile repos.** A `.env` file (see `.env.example`) is read
> solely by the test suite and the standalone sidecar
> (`scripts/dev.sh start sidecar`), never by the desktop app.
```

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/index.ts README.md
git commit -m "docs: secrets now live in ~/.hip/config/auth.json, not the keychain"
```

---

## Final verification

- [ ] **Step 1: Full Rust + Node suites green**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Run: `npx vitest run packages/sidecar/src/session/scratch.test.ts`
Run: `yarn type-check`
Expected: all PASS.

- [ ] **Step 2: Confirm no stray old-location references remain**

Run: `grep -rn "app_data_dir" src-tauri/src/`
Expected: a single hit inside `paths::hip_base_dir` (the Windows branch). No others.

Run: `grep -rn "keyring\|SECRET_SERVICE" src-tauri/`
Expected: no hits (dependency and const both gone).

- [ ] **Step 3: Manual GUI acceptance (no paid LLM call needed)**

Launch the app (`yarn tauri dev`), open Settings, save a provider API key, then verify on disk:

```bash
ls -l ~/.hip/db/hip.db ~/.hip/config/hip-providers.json ~/.hip/config/auth.json ~/.hip/cache/models.json
stat -f '%A %N' ~/.hip/config/auth.json   # expect: 600 …/auth.json
```

Expected: `auth.json` exists at mode `600` and contains the `HIP_MODEL_<ID>_API_KEY` you saved; a started session writes `~/.hip/db/hip.db`; provider config and models cache land in their new dirs. Confirm the saved key still drives the provider (the key is injected into the sidecar on restart) without needing a paid completion — presence + restart wiring is enough.

---

## Self-review (completed)

- **Spec coverage:** D1 cross-platform → Task 1 (`hip_base_from`). D2 clean-cut → no migration task (intentional). D3 keys→auth.json → Tasks 2–4. D4 namespaced layout → Task 1 + Task 5. D5 `:memory:` unchanged → no task touches `main.ts:12` (intentional). Perms hardening (§5.1) → Task 2 tests. Scratch/`HIP_SCRATCH_ROOT` → Task 5 + Task 6. Docs (§7) → Task 7. All spec sections map to a task.
- **Placeholder scan:** none — every code/command step is concrete.
- **Type consistency:** `paths::config_dir`/`db_dir`/`cache_dir`/`scratch_dir` defined in Task 1 and used in Tasks 3 & 5; `auth_get/set/delete` defined in Task 2 and used in Task 3; `read_provider_key(app, id)` signature updated in Task 3 and its sole call site updated in the same step; `get_secret_value(app, key)` defined in Task 3 and consumed by `read_provider_key`. Consistent throughout.
