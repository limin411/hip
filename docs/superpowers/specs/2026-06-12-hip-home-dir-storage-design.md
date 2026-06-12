# Centralize all data & config under `~/.hip/` — Design

- **Date:** 2026-06-12
- **Status:** Approved (brainstorm) → ready for implementation plan
- **Topic:** Move every persistent file hip writes into a single, predictable per-user root (`~/.hip/`), namespaced by purpose, and relocate API-key storage from the macOS Keychain into a file inside that root.

## 1. Problem & goal

Today hip scatters its persistent state across two roots:

- **Tauri app-data dir** (`~/Library/Application Support/com.ljm.app/` on macOS): `hip.db`, `hip-providers.json`, `models.json`.
- **`~/.hip/`**: only `scratch/<sessionId>/` (pure-chat sandboxes).
- **macOS Keychain** (service `com.ljm.app`): provider API keys.

Goal: make `~/.hip/` the single home for **all** data and config, with a tidy namespaced layout, so a user can inspect/back up/delete everything in one place. Keys included (as a file), per explicit decision below.

## 2. Decisions (locked during brainstorm)

| # | Question | Decision |
|---|----------|----------|
| D1 | Cross-platform behavior of the root | **`~/.hip` on Unix (macOS+Linux); native app-data on Windows** (`%APPDATA%\com.ljm.app\…`). |
| D2 | Migrate existing installs' old data? | **Clean-cut. No migration.** App starts fresh in `~/.hip`; old `com.ljm.app/` files are ignored. |
| D3 | Where do API keys live? | **Dedicated `~/.hip/config/auth.json` (file, `0600`)**, replacing the Keychain. SQLite-for-keys was rejected (see §8). |
| D4 | Layout inside the root | **Namespaced subdirs**: `db/`, `config/`, `cache/`, `scratch/`. |
| D5 | Standalone sidecar persistence default | **Unchanged — `:memory:`.** On-disk persistence stays opt-in via `HIP_DB_PATH` (injected only by the Tauri shell). |

## 3. Target layout

macOS / Linux:

```
~/.hip/
├── db/
│   └── hip.db                    # SQLite session/message store        (HIP_DB_PATH)
├── config/
│   ├── hip-providers.json        # non-secret provider config          (HIP_PROVIDERS_PATH)
│   └── auth.json        (0600)   # NEW: provider API keys (plaintext)
├── cache/
│   └── models.json               # models.dev catalog cache (regenerable)
└── scratch/
    └── <sessionId>/              # pure-chat sandbox workspaces        (HIP_SCRATCH_ROOT)
```

Windows: identical tree, rooted at `app_data_dir()` instead of `$HOME/.hip` (D1).

On macOS/Linux this also unifies **dev and prod** under the same `~/.hip` (today they already share by identifier; behavior is preserved).

## 4. Architecture

**Chosen: A1 (Rust owns paths) + B1 (file-backed secrets, contract preserved).**

### A1 — Rust is the single path-decision point
The Tauri shell already decides every persistent path and either reads/writes the file itself or injects the path into the Node sidecar via env vars; the sidecar is a dumb consumer with `:memory:` / DeepSeek-default fallbacks. We keep that. The cross-platform rule (D1) therefore lives in exactly **one** place.

Rejected alternatives:
- **A2** (Rust and Node each compute `~/.hip` independently): two sources of truth for the D1 rule → drift. This is the same bug class as today's two independent readers of the providers path.
- **A3** (sidecar owns paths, Rust queries it): inverts the architecture for no benefit; Rust needs `auth.json`/`hip-providers.json`/`models.json` before the sidecar process exists.

### B1 — File-backed secrets, command contract unchanged
Replace the `keyring` backend with a JSON file. Crucially, the existing Tauri command surface (`set_secret`/`get_secret`/`has_secret`/`delete_secret`, all keyed by the string `key`) is **kept as-is**, so the renderer (`src/ipc/secrets.ts`) and `@hip/protocol`'s `providerKeyEnv` need **zero changes** — only the Rust function bodies change.

Rejected alternatives:
- **B2** (`SecretStore` trait with Keyring + File impls): YAGNI. The hybrid that would justify an abstraction was explicitly not chosen (D3 = pure file).
- **B3** (keyring + file mirror): two sources of truth for secrets.

## 5. Detailed change list

### 5.1 Rust — `src-tauri/`

**New path helpers** (new module `src-tauri/src/paths.rs`, or a section in `lib.rs`). No new crate: use `std::env::var_os("HOME")` on Unix and `app.path().app_data_dir()` on Windows.

```rust
/// Base root for all hip storage. Unix: $HOME/.hip ; Windows: app_data_dir().
/// Pure-logic core is split out so it is unit-testable without an AppHandle.
fn hip_base_from(home: Option<PathBuf>, app_data: Option<PathBuf>) -> Option<PathBuf>;
fn hip_base_dir(app: &AppHandle) -> Option<PathBuf>;

/// `<base>/<sub>`, created (recursively) on demand. `config` gets dir mode 0o700 on Unix.
fn hip_subdir(app: &AppHandle, sub: &str) -> Option<PathBuf>;
fn db_dir(app) / config_dir(app) / cache_dir(app) / scratch_dir(app) -> Option<PathBuf>;
```

**Re-route the three existing files through the helpers:**

| Site | Today | After |
|------|-------|-------|
| `lib.rs:101-105` `providers_config_path` | `app_data_dir().join("hip-providers.json")` | `config_dir(app)?.join("hip-providers.json")` |
| `lib.rs:123` `models_catalog` cache | `app_data_dir().join("models.json")` | `cache_dir(app)?.join("models.json")` |
| `sidecar.rs:33-34` `HIP_PROVIDERS_PATH` | `app_data_dir().join("hip-providers.json")` | `config_dir(app)?.join("hip-providers.json")` |
| `sidecar.rs:39-41` `HIP_DB_PATH` | `app_data_dir()` + `db_path_for` | `db_dir(app)?` + `db_path_for` (helper at `sidecar.rs:148` unchanged) |
| `sidecar.rs:132-133` `configured_provider_ids` | `app_data_dir().join("hip-providers.json")` | `config_dir(app)?.join("hip-providers.json")` |

`providers_config_path`, the `HIP_PROVIDERS_PATH` env, and `configured_provider_ids` MUST all resolve through the same `config_dir` helper so the renderer-writer and the key-injection-reader can never diverge.

**New env injected at spawn** (`sidecar.rs`): `HIP_SCRATCH_ROOT = scratch_dir(app)`. This makes the cross-platform root authoritative for scratch too (Windows consistency). On macOS/Linux the injected value equals today's default, so behavior is unchanged there.

**Secrets module rewrite** (`lib.rs:51-95`):
- Delete `SECRET_SERVICE` and all `keyring::Entry` usage. Remove `keyring` from `src-tauri/Cargo.toml:29` (also drops the Linux libsecret/D-Bus runtime requirement).
- Back the four commands + the internal `get_secret_value(key)` reader with `~/.hip/config/auth.json`:
  - File format — a flat object keyed by the env-var name (so the `key` contract is unchanged):
    ```json
    { "HIP_MODEL_DEEPSEEK_API_KEY": "sk-…", "HIP_MODEL_OPENAI_API_KEY": "sk-…" }
    ```
  - `set_secret(key,value)`: load map → insert → write. `delete_secret`: load → remove → write. `get_secret`/`has_secret`/`get_secret_value`: load → lookup. Missing file ⇒ empty map (not an error).
  - **Permission hardening (mandatory, Unix):** enforce `0o600` on the file on **every write**, not only on create (Codex bug openai/codex#14704: create-time-only perms leave a pre-existing wide file wide). Create `config/` as `0o700`. Prefer **atomic write** (temp file with `0o600` in the same dir → `rename`) to avoid a readable window. On Windows, rely on the user-profile ACL of app-data (skip `chmod` under `cfg(windows)`).

`spawn_sidecar`'s injection loop (`sidecar.rs:25-31`) is unchanged in shape — it still calls `read_provider_key` → `get_secret_value(env)`, injecting the value or `""` for configured-but-absent providers. Only the backing store changes.

### 5.2 Node — `packages/sidecar/`

One small, optional-but-recommended change (the Windows-consistency piece from D1):
- `defaultScratchRoot()` (`scratch.ts:6-8`): read `process.env.HIP_SCRATCH_ROOT` first; fall back to the current `os.homedir()/.hip/scratch` when unset (standalone/dev). `SessionManager` already plumbs `scratchRoot` (`session-manager.ts:26`), so no further wiring.
- **No other Node change.** `main.ts:12` (`HIP_DB_PATH || ':memory:'`), `persistence/open.ts`, and `config/providers.ts` already consume whatever path Rust hands them.

### 5.3 Not changing
- Sidecar `:memory:` fallback (`main.ts:12`) — D5.
- `com.ljm.app` identifier (`tauri.conf.json:5`) — still used for the Windows app-data root.
- Bundled `models-snapshot.json` (`include_str!`, `lib.rs:99`).
- `providerKeyEnv` rule and the renderer secrets IPC (`src/ipc/secrets.ts`).
- No migration of old `com.ljm.app/` data (D2).

## 6. Testing strategy

- **Rust unit tests** (pure logic, no `AppHandle`):
  - `hip_base_from`: Unix branch returns `$HOME/.hip`; Windows branch returns the app-data path; `None` home ⇒ `None`.
  - `auth.json` round-trip: set→get→has→delete against a temp dir; after a write assert file mode is `0o600` (Unix-gated test).
  - Keep the existing `db_path_is_hip_db_under_data_dir` test (still valid; `db_path_for` unchanged).
- **Node:** add one `scratch.test.ts` case asserting `HIP_SCRATCH_ROOT` override wins and the default is used when unset. Existing persistence tests are path-agnostic (`:memory:`) and unaffected.
- **Manual GUI acceptance** (per project preference; no paid LLM call needed): launch the app, save a provider key, and verify: `~/.hip/config/auth.json` exists with mode `0600` and contains the key; a started session persists to `~/.hip/db/hip.db`; provider config lands in `~/.hip/config/hip-providers.json`; catalog cache in `~/.hip/cache/models.json`.

## 7. Docs to update
- `@hip/protocol` comments mentioning the keychain / app-data location: `packages/protocol/src/index.ts:20`, `:28`, `:34`.
- README secret-storage section (keys are now a plaintext `0600` file, not the Keychain).
- `docs/superpowers/.../model-config-page*` and the session-persistence plan references to `~/Library/Application Support/com.ljm.app/`.
- **New user-facing warning:** `~/.hip/config/auth.json` holds plaintext API keys — do **not** sync `~/.hip/config/` to cloud drives or dotfile repos.

## 8. Security note (acknowledged trade-off)

Moving keys from the macOS Keychain to a plaintext file is a deliberate step **down** in at-rest protection, accepted to satisfy the "everything in `~/.hip`" goal. It matches the de-facto norm for this tool category (Codex and OpenCode both store keys in plaintext `auth.json`; neither ever puts secrets in its SQLite db). SQLite-for-keys was rejected because a `.db` gives zero confidentiality over a flat file (readable via `strings`/`sqlite3`) while being *worse* operationally: `hip.db` is the artifact users zip up for bug reports, runs in WAL mode (extra `-wal`/`-shm` copies of secret bytes), and is harder to perms-lock than a single dedicated file. The mitigations in §5.1 (`0600` enforced on every write, `0700` dir, atomic write, no-sync documentation) are therefore **hard requirements**, not nice-to-haves.

## 9. Out of scope / non-goals
- Migrating existing users' data (D2).
- Encrypting `auth.json` at rest (AES-GCM/SQLCipher) — possible future hardening, not now.
- A keychain fallback / hybrid backend (D3 chose pure file).
- Honoring `$XDG_*` overrides — optional future polish; default `~/.hip` is idiomatic.

## 10. Risk register
- **Silent `:memory:` trap:** if `hip_base_dir` returns `None` (e.g. `HOME` unset), Rust won't inject `HIP_DB_PATH` and the sidecar silently runs in-memory. Mitigation: keep eager `create_dir_all` and log a clear warning when the root can't be resolved.
- **Two providers-path readers drifting:** mitigated by routing all three through the single `config_dir` helper (§5.1).
- **Perms regression on pre-existing `auth.json`:** mitigated by enforcing mode on every write, not only create.
