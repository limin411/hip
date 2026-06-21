# src-tauri — Rust Tauri Shell

**Generated:** 2026-06-21 | **Commit:** `e063429` | **Branch:** `main`

## OVERVIEW

Native window manager + Node.js sidecar lifecycle + file-backed config/secret persistence. 8 source files, ~30 Tauri commands, zero unsafe Rust. Spawns the sidecar via `tauri-plugin-shell`, captures its `{port,token}` stdout handshake, injects env vars (API keys, config paths, worktree roots), and exposes state+config to the React frontend over IPC.

## STRUCTURE

```
src-tauri/
├── src/
│   ├── main.rs           # Binary entry: #[windows_subsystem] guard + hip_lib::run()
│   ├── lib.rs            # App root: SidecarState, ~30 commands, config types (HipConfig → TomlHipConfig), JSON→TOML migration, inline-file logger, models catalog
│   ├── sidecar.rs        # Spawn + handshake: spawn_sidecar(), generation-guarded stdout reader, token echo suppression, provider-key env injection (HIP_MODEL_<ID>_API_KEY)
│   ├── auth.rs           # Atomic auth.json I/O: temp-file + rename, 0o600 perms, read-missing-file-as-empty, key prefix = HIP_MODEL_<ID>_API_KEY
│   ├── paths.rs          # ~/.hip layout: config/, db/, cache/, scratch/, skills/, plugins/, worktrees/; config/ locked 0o700 on Unix
│   ├── path_env.rs       # macOS PATH fix: login-shell probe (2.5s timeout) ∪ common dirs ∪ current PATH, merge+dedup, applied before sidecar spawn
│   ├── plugins.rs        # Plugin install/scan/register: zip validation, slugification, manifest registration in hip-plugins.json
│   └── skills.rs         # Skill scan/install: zip-slip-safe extraction, SKILL.md frontmatter parse, global↔project override, slugification
├── build.rs              # tauri_build::build()
├── Cargo.toml            # Edition 2021, reqwest 0.12 (pinned), dependencies
├── tauri.conf.json       # externalBin: ["binaries/sidecar"], CSP (ws://localhost:*), window config
└── resources/            # models-snapshot.json (compile-time embedded catalog fallback)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add Tauri command | `lib.rs` — define `#[tauri::command] fn` + register in `generate_handler![]` | Follow existing pattern; return `Result<T, String>` |
| Spawn/re-spawn sidecar | `sidecar.rs` → `spawn_sidecar()` | Env injection (provider keys, HIP_CONFIG_PATH, HIP_PARENT_WATCH), generation counter, stdout reader task |
| Sidecar env injection | `sidecar.rs` → `configured_provider_ids()` + `read_provider_key()` | Keys from `auth.rs` secret store; env var name via `provider_key_env()` |
| Sidecar port/token handshake | `sidecar.rs` → `parse_info_line()` + stdout reader loop | Parses `{"port":N,"token":"..."}`; never echoes token-containing lines |
| API key / secret store | `auth.rs` → `auth_set()` / `auth_get()` / `auth_delete()` | Atomic write (temp+rename), 0o600 on Unix, missing file → empty map |
| Config migration JSON→TOML | `lib.rs` → `get_hip_config()` + `from_legacy_json()` | One-time auto-migration: reads legacy JSON files → writes `hip.toml`; legacy JSON never deleted |
| Config TOML roundtrip | `lib.rs` → `HipConfig` ↔ `TomlHipConfig` via `From` impls | `HipConfig` (camelCase, JSON API) ↔ `TomlHipConfig` (snake_case with camelCase aliases for backward compat, TOML on disk) |
| macOS PATH fix | `path_env.rs` → `ensure_user_path()` | Called in `run()` BEFORE sidecar spawn; login-shell probe (2.5s timeout), dedup via `merge_paths()` |
| `.hip/` directory layout | `paths.rs` — `hip_base_dir()`, `hip_subdir()`, per-domain helpers | `config/` locked 0o700 on Unix; see `hip_subdir()` |
| Plugin install lifecycle | `lib.rs` `install_plugin` + `plugins.rs` → `scan_plugins()` / `register_plugin()` / `find_plugin_root()` | Zip extract → validate `.plugin/plugin.json` → slugify → register in `hip-plugins.json` |
| Skill install lifecycle | `lib.rs` `install_skill_zip` + `skills.rs` → `scan_skills()` / `find_skill_root()` / `extract_zip()` | Zip-slip safe (`safe_join`), parse SKILL.md frontmatter, global∪project merge with project override |
| Network policy | `lib.rs` → `get_network_policy()` / `set_network_policy()` | `config/network.json`, `NetworkPolicyConfig` struct |
| Models catalog | `lib.rs` → `models_catalog()` | 24h TTL cache in `cache/models.json`, fallback to compile-time `SNAPSHOT` |
| Binary detection (which) | `lib.rs` → `which_binaries()` + `find_on_path()` / `is_executable()` | Probes PATH for ACP agent binaries; Unix: checks execute bit |
| Worktree listing | `lib.rs` → `list_worktrees()` | Lists subdirs of `worktrees/` |
| Graceful quit | `lib.rs` → `run()` event loop (`ExitRequested` + `WindowEvent::CloseRequested`) | Kills managed sidecar child on quit; window close = app exit |
| Inline file logger | `lib.rs` — `log_write()` / `log_rotate()` macros | `~/.hip/logs/tauri*.log`, 5 MB rotation, `HIP_DEBUG=1` enables debug-level |

## CONVENTIONS

- **Rust edition 2021**; `Cargo.toml` declares `edition = "2021"`
- **No unsafe** — zero `unsafe` blocks in the entire crate
- **No `.rustfmt.toml`** — standard rustfmt defaults
- **Inline `#[cfg(test)]`** tests in every source file (lib.rs, sidecar.rs, auth.rs, paths.rs, path_env.rs, skills.rs)
- **Tests don't need an AppHandle** — pure logic extracted into testable functions (e.g. `paths::hip_base_from`, `path_env::merge_paths`, `skills::scan_skills_from_dirs`)
- **reqwest pinned to 0.12** (rustls-tls) — 0.13 requires `aws-lc-rs ^1.14`, unavailable
- **Atomic file writes at 0o600** (`auth.rs`): temp-file write + `set_permissions` + rename; cleans up temp on failure
- **`config/` directory locked 0o700** on Unix (`paths.rs` → `hip_subdir()`)
- **Tauri commands return `Result<T, String>`** — errors are human-readable strings passed to frontend
- **Config TOML uses snake_case**; structs have `#[serde(alias = "camelCase")]` for JSON backward compat
- **Logging**: `tauri_info!` / `tauri_debug!` macros → `~/.hip/logs/tauri.log`; `HIP_DEBUG=1` enables debug level

## ANTI-PATTERNS

- **NEVER echo token-containing sidecar stdout** — the stdout reader in `sidecar.rs` suppresses any line containing the known auth token
- **NEVER remove the Windows console guard** — `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` in `main.rs` must stay
- **NEVER skip `ensure_user_path()`** — the sidecar and spawned agents rely on it on macOS
- **Sidecar generation counter** — dying sidecar's reader task checks generation before clearing state; don't remove this guard
- **`auth.json` is plaintext** — holds API keys at `~/.hip/config/auth.json`. Do NOT sync to cloud drives or dotfile repos
- **Don't sprinkle `#[tauri::command]` in submodules** — all commands live in `lib.rs`; submodules export pure helpers
- **Don't spawn sidecar without `HIP_PARENT_WATCH=1`** — without it, the sidecar survives SIGKILL of the parent and holds the SQLite lock

## NOTES

- **Sidecar binary** resolved via `externalBin: ["binaries/sidecar"]` in `tauri.conf.json`. Dev mode: `scripts/make-sidecar-dev-bin.sh` generates the wrapper; re-run after Node.js version changes
- **`src-tauri/binaries/`** is gitignored — the dev wrapper is a build artifact
- **3-process handshake**: `run()` → `spawn_sidecar()` → stdout reader captures `{"port":N,"token":"..."}` → `SidecarState` updated → frontend polls `get_sidecar_info` → connects WebSocket
- **Sidecar state guard**: `SidecarState.generation` (`AtomicU64`) incremented per spawn. On sidecar exit, reader only clears state if its generation still matches the current one, preventing a stale reader from the old sidecar from clobbering the new sidecar's port/token
- **`HIP_PARENT_WATCH=1`** ties sidecar lifetime to Tauri's stdin pipe — sidecar exits on EOF when Tauri dies by any means (including SIGKILL)
- **No dark mode**, no Tauri-specific styling — all visual styles defined in the React frontend
- **Cargo lib name** is `hip_lib` (underscore suffix for Windows compat per Cargo#8519)
- **Plugin/skill zip extraction** is zip-slip-safe (`safe_join()` rejects `..`, absolute paths, Windows prefixes)
- **Model catalog** fetched from `https://models.dev/api.json` with 24h TTL; compile-time `resources/models-snapshot.json` as fallback; override via `HIP_MODELS_URL` env var
