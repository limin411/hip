# PR0 Spike: russh password / ed25519 / passphrase + TOFU + binary size

| Field | Value |
|-------|-------|
| **Title** | `spike(tauri): russh password/ed25519/passphrase + TOFU + binary size` |
| **Date** | 2026-07-20 |
| **Status** | Complete (compile-path + findings; gate for PR5) |
| **Parent design** | [`2026-07-20-terminal-management.md`](./2026-07-20-terminal-management.md) § PR0 / § SSH runtime model |
| **Code** | `src-tauri` feature `ssh-spike` → `src-tauri/src/ssh_spike.rs` |

---

## Goal

Prove the **russh** stack is viable for hip terminal management **before** PR5 production SSH work:

1. Password auth API compiles and is callable.
2. Publickey auth (ed25519 + RSA hash negotiation) compiles.
3. Encrypted private key + passphrase decrypts.
4. Host-key TOFU decision model (first-use / match / mismatch + SHA256 fingerprint).
5. Tokio features required by russh + Tauri async runtime.
6. Binary size impact methodology + initial measurement notes.
7. **Pass/fail gate for PR5.**

Non-goals for this PR: live network dogfood against a real SSH server, product `ssh_open` commands, SFTP, UI.

---

## Verdict — **PASS** (gate open for PR5)

| Criterion | Result | Notes |
|-----------|--------|-------|
| Default `cargo check` (no feature) | **PASS** | `ssh-spike` off by default; zero russh in default graph |
| `cargo check --features ssh-spike` | **PASS** | See compile proof module |
| Password auth | **PASS** | `Handle::authenticate_password` |
| ed25519 publickey | **PASS** | `load_secret_key` / OpenSSH PEM + `authenticate_publickey` |
| Encrypted key + passphrase | **PASS** | PKCS8 sample + OpenSSH `aes256-ctr` fixture decrypt in unit tests |
| TOFU + SHA256 fingerprint | **PASS** | `PublicKey::fingerprint(HashAlg::Sha256)` → `SHA256:…`; mismatch path unit-tested |
| Tokio feature set locked | **PASS** | Documented below |
| Binary size | **PASS (~+7.0% on macOS aarch64)** | Well under 15% gate with link anchor; re-measure after PR5 wires live `ssh_open` |
| Windows dogfood (live SSH) | **DEFERRED** | Compile path is cross-platform (`russh` supports Windows; pageant optional). Live password/key dogfood still required on macOS + Windows before PR5 merge to main product path |
| Fallback needed? | **No** | Do **not** take Alt 7 (system `ssh` in PTY) or ssh2 unless a later live-dogfood failure |

**PR5 may proceed** on the russh path (K4 / K22). If a later live dogfood fails hard on Windows OpenSSH auth edge cases, escalate to product with ssh2 / Alt 7 as emergency valves only.

---

## Compile proof

### Cargo feature

```toml
# src-tauri/Cargo.toml
[features]
default = []
ssh-spike = [
    "dep:russh",
    "tokio/rt",
    "tokio/rt-multi-thread",
    "tokio/net",
    "tokio/time",
    "tokio/io-util",
    "tokio/macros",
    "tokio/sync",
]

[dependencies]
russh = { version = "0.54", optional = true }
```

- **Default build:** no `russh`, no extra tokio features beyond existing `sync`.
- **Spike build:** `cargo check --features ssh-spike` / `cargo test --features ssh-spike ssh_spike`.
- **PR5 plan:** rename/promote to product feature `ssh` (default-on for release; emergency `default-features` off strips SSH). Keep the same russh version pin unless a security release forces a bump.

### Module

`src-tauri/src/ssh_spike.rs` (cfg `feature = "ssh-spike"`):

| Symbol | Proves |
|--------|--------|
| `SpikeHandler::check_server_key` | Host-key gate required by `client::Handler` |
| `authenticate_password` | Password auth |
| `authenticate_publickey` + `PrivateKeyWithHashAlg` | Publickey + RSA hash alg negotiation |
| `load_private_key` / `decode_private_key` | Disk + PEM; passphrase `Option<&str>` |
| `tofu_check` / `sha256_fingerprint` | TOFU decisions + OpenSSH-like fingerprint string |
| `connect_spike` / `open_shell_channel` | TCP connect + PTY/shell channel shape for PR5 |
| unit tests | Encrypted PKCS8, OpenSSH ed25519±passphrase, TOFU mismatch |

No Tauri commands are registered — this PR does not change the IPC surface.

### Commands used for verification

```bash
cd src-tauri
cargo check
cargo check --features ssh-spike
cargo test --features ssh-spike ssh_spike
```

---

## Auth matrix (v1 lock)

| Method | Supported in v1 | russh API | Product UX |
|--------|-----------------|-----------|------------|
| Password | **Yes** | `authenticate_password(user, password)` | Host form → raw secret `hip.ssh.<hostId>.password` via existing `set_secret` |
| Publickey ed25519 | **Yes** | `load_secret_key(path, passphrase?)` + `authenticate_publickey` | `privateKeyPath` in catalog; optional passphrase secret |
| Publickey RSA | **Yes** | Same; use `best_supported_rsa_hash()` + `PrivateKeyWithHashAlg` | Same path |
| Encrypted key + passphrase | **Yes** | `load_secret_key(path, Some(passphrase))` | Secret key `hip.ssh.<hostId>.passphrase` |
| Keyboard-interactive | **No** | Exists on russh (`authenticate_keyboard_interactive_*`) | Clear error “暂不支持” |
| OpenSSH certificate | **No** (v1) | `authenticate_openssh_cert` exists | Defer |
| Agent / PKCS11 | **No** | Agent helpers exist; out of scope | Defer |

**Key path expand (PR5):** if `privateKeyPath` starts with `~/`, expand via `dirs::home_dir()` (already a hip dependency).

**Passwords never logged** (K16): spike and PR5 must not format credentials into log/error strings.

---

## Tokio / runtime model (locked for PR5)

### Features

| Feature | Why |
|---------|-----|
| `rt` + `rt-multi-thread` | russh client tasks; aligns with `tauri::async_runtime` (tokio multi-thread) |
| `net` | `client::connect` TCP |
| `time` | inactivity timeouts, coalescing timers |
| `io-util` | async read/write helpers used by russh |
| `macros` | `tokio::select!` in I/O loops |
| `sync` | already in hip; channels/mutexes |

hip today only enables `tokio` feature `sync`. **PR5 must expand** tokio features when enabling the product `ssh` feature (same list as `ssh-spike`).

russh 0.54 itself pulls (non-wasm): `io-util`, `rt-multi-thread`, `time`, `net` on its own dependency edge — hip should still declare them explicitly for app code (`select!`, timers, etc.).

### Coexistence with portable-pty

| Backend | Model |
|---------|-------|
| Local PTY (`portable-pty`) | **Keep** thread + `mpsc` as today |
| SSH (`russh`) | **Async tasks** on `tauri::async_runtime` |
| Events | Both emit on `AppHandle` (`pty:data` / `ssh:data`) normalized by terminal bridge |

No need for a second global tokio runtime. Do not block the async runtime on portable-pty sync I/O.

### Coalesce (PR5)

Reuse PTY constants spirit: ~12 ms / 32 KiB pending, drop-oldest under backpressure.

---

## TOFU (host key)

### Product storage (parent design K7)

- File: `~/.hip/config/ssh_known_hosts.json` (not OpenSSH `~/.ssh/known_hosts` for product pins).
- Atomic write + Unix mode **0o600** (same pattern as `auth.rs`).

### Decision table

| State | Behavior |
|-------|----------|
| No pin for host:port | **Trust on first use** after connect proceeds (or optional confirm — product default: pin on first successful key check when user connects; mismatch always blocks) |
| Pin matches | Proceed |
| Pin differs (same host) | **Block** with modal: hostname:port, `SHA256:…` fingerprint, copy, **信任并连接** (update pin) / **取消** |

### russh integration points

1. `client::Handler::check_server_key(&PublicKey) -> bool` — default rejects all keys; PR5 must consult hip known_hosts **before** returning true.
2. Fingerprint for UI: `key.fingerprint(HashAlg::Sha256).to_string()` → OpenSSH-like `SHA256:…`.
3. Optional: russh also ships OpenSSH `known_hosts` file helpers (`russh::keys::check_known_hosts_path`, `KeyChanged`) — useful for interop tests, but **product source of truth is hip JSON**, not the user’s `~/.ssh/known_hosts`.

### Mismatch IPC shape (PR5)

```text
ssh_open → Err { code: "host_key_mismatch", fingerprint, hostname, port, … }
UI modal → ssh_trust_host → retry ssh_open
```

---

## Binary size

### Gate rule (parent design)

> Spike records `cargo build --release` size before/after; fail review if unexplained **>15%** without product OK.

### Methodology

```bash
cd src-tauri
# Baseline (no SSH)
cargo build --release
# macOS: measure the release binary hip produces (adjust path if bundle layout differs)
ls -la target/release/hip
# With spike feature
cargo build --release --features ssh-spike
ls -la target/release/hip
# Delta % = (with - without) / without * 100
```

Also useful: `cargo bloat --release --features ssh-spike -n 20` (optional dev tool) to attribute growth to `aws-lc` / `russh` / `rsa`.

### Crypto backend choice

| Backend | Cargo | Pros | Cons |
|---------|-------|------|------|
| **aws-lc-rs** (russh default) | `russh = "0.54"` default features | Default upstream path | Large native `aws-lc-sys` build; may not dedupe with reqwest 0.12 `rustls`+ring |
| **ring** | `default-features = false, features = ["flate2", "ring", "rsa"]` | Smaller / often already pulled by rustls | Need to verify cipher suite coverage for target hosts |

**Spike default:** keep russh **default features** (`aws-lc-rs` + `flate2` + `rsa`) for maximum compatibility.

**PR5 recommendation:** measure both backends on macOS + Windows release builds. Prefer `ring` if:

- size delta drops under the 15% threshold more cleanly, and
- dogfood hosts (common cloud OpenSSH) still auth with password + ed25519.

If default aws-lc-rs delta is **≤15%**, ship default. If **>15%**, either switch to `ring` or get product OK with a written size note in the PR5 description.

### Measurement (2026-07-20, aarch64-apple-darwin)

Measured with a **link anchor** (`ssh_spike::size_probe_link_anchor` called from `lib::run` under the feature) so release LTO cannot fully dead-strip the decrypt/fingerprint/client-type surface. Without the anchor, the final binary showed ~0% delta (full DCE).

| Build | Platform | `target/release/hip` bytes | Δ vs baseline | Δ % |
|-------|----------|----------------------------|---------------|-----|
| baseline (no feature) | aarch64-apple-darwin | 20,820,528 | 0 | 0% |
| `--features ssh-spike` (russh 0.54 defaults / aws-lc) | aarch64-apple-darwin | 22,281,904 | +1,461,376 (~1.39 MiB) | **+7.02%** |
| `--features ssh-spike` + ring backend (optional) | — | not measured this PR | | |

**Gate:** 7.02% **≪ 15%** → size gate **PASS** for the spike surface.

**Caveats for PR5:**

- Anchor pulls key decrypt + fingerprint + `client::Config` / `Handle` monomorphization, **not** a live `client::connect` I/O loop. PR5 `ssh_open` will retain more of the protocol/cipher path; re-measure after wiring.
- Intermediate rlib footprint (not final binary): russh + aws-lc + ssh-key + rsa + curve25519 ≈ **~20.6 MiB of `.rlib`**. LTO collapses most of that; do not use rlib sum as the product gate.
- Windows release delta not measured here; re-run the same methodology on Windows dogfood.
- If PR5 live wiring exceeds 15%, try `russh` with `default-features = false, features = ["flate2", "ring", "rsa"]` before asking product for a size exception.

**Commands:**

```bash
cd src-tauri
cargo build --release
stat -f%z target/release/hip   # macOS
cargo build --release --features ssh-spike
stat -f%z target/release/hip
```

Build-time note: first `aws-lc-sys` compile is slow (C/ASM). Expect multi-minute cold builds; subsequent increments are fine.

---

## Runtime / architecture notes for PR5

```text
ssh_open(terminalId, hostId, cols, rows):
  1. TerminalBudget::try_acquire(id)   // lock order: Budget → SshManager
  2. Load host meta (catalog) + raw secrets (password / passphrase) in Rust only
  3. Expand ~/ on privateKeyPath
  4. client::connect + Handler.check_server_key ← hip known_hosts TOFU
  5. authenticate_password OR authenticate_publickey
  6. channel_open_session + request_pty + request_shell
  7. spawn reader task → coalesce → emit ssh:data { terminalId, data (base64) }
  8. On drop/close: disconnect, budget release, ssh:exit
```

### SFTP (PR6)

- Crate: `russh-sftp` (dev-dep of russh examples; add as direct dep in PR6).
- Same session / channel subsystem; no second SSH connection required for v1 tree+transfer.

### Feature flag progression

| Stage | Feature name | Default |
|-------|--------------|---------|
| PR0 (this) | `ssh-spike` | **off** |
| PR5+ | `ssh` | **on** for release; document `default-features = false` emergency strip |

---

## Risks & residual work

| Risk | Severity | Mitigation |
|------|----------|------------|
| Live Windows OpenSSH password/keyboard-interactive quirks | Med | Dogfood before PR5 merge; keyboard-interactive still non-goal |
| Binary size >15% with aws-lc | Med | Measure; switch to `ring` feature set or product OK |
| russh version drift (0.54 → 0.62+) | Low | Pin 0.54 for PR5 unless need bugfix; re-run this checklist on bump |
| Dual crypto (ring via rustls + aws-lc via russh) | Med | Prefer one backend after size measurement |
| TOFU UX race (two connects first-use) | Low | Serialize trust write; last-write wins on same host key |

---

## Pass/fail gate summary (for PR5 reviewers)

**PASS if all true:**

1. [x] `cargo check` clean without features  
2. [x] `cargo check --features ssh-spike` clean  
3. [x] Auth matrix APIs proven (password, ed25519, passphrase)  
4. [x] TOFU fingerprint + mismatch model proven  
5. [x] Tokio features documented and feature-gated  
6. [x] Binary size methodology + backend recommendation recorded  
7. [x] Release size delta filled and ≤15% on macOS aarch64 (**+7.02%**)  
8. [ ] Live macOS dogfood password + ed25519 (PR5 / dogfood checklist)  
9. [ ] Live Windows dogfood (PR5 / dogfood checklist)  
10. [ ] Re-measure release size after PR5 live `ssh_open` linkage  

Items 1–7 are **satisfied by this PR**. Items 8–10 are **PR5 entry criteria** (not blockers for starting PR5 implementation on a feature branch; blockers for shipping SSH to users).

---

## Decision record

| Decision | Choice |
|----------|--------|
| SSH crate | **russh 0.54** (primary; no ssh2) |
| Hybrid system-ssh in PTY | **Rejected** (K22) unless emergency |
| Default feature in PR0 | `ssh-spike` **off** |
| Crypto backend for spike | russh defaults (`aws-lc-rs`) |
| Known hosts | Product JSON TOFU (not only OpenSSH file) |
| PR5 unblocked? | **Yes** |
