# Remediation Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hip runnable as a bundled production app — a managed sidecar lifecycle, a DeepSeek API key stored in the OS keychain and injected into the sidecar, and a cleaned-up DeepSeek-only config.

**Architecture:** Three workstreams from the remediation spec — W6 (provider cleanup), W3 (sidecar lifecycle), W2 (secret management). Rust owns the sidecar child handle and injects the key from the keychain on spawn; a settings UI writes the key via Tauri commands; the sidecar refuses to run agents without a key by emitting a typed `NO_API_KEY` error.

**Tech Stack:** Tauri v2 (Rust, `tauri-plugin-shell`, `keyring` crate), React + TypeScript, `@tauri-apps/api`, Vitest.

**Spec:** [docs/superpowers/specs/2026-06-07-hip-remediation-design.md](../specs/2026-06-07-hip-remediation-design.md) (§W6, §W3, §W2)

---

## File Structure (created / modified in this phase)

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/protocol/src/index.ts` | Narrow `SessionConfig.llmProvider` to `'deepseek'` | Modify |
| `src/components/chat/InputBar.tsx` | Drop dead model dropdown → read-only model label | Modify |
| `src-tauri/Cargo.toml` | Add `keyring` dependency | Modify |
| `src-tauri/src/sidecar.rs` | Port-line parsing, managed spawn, drain, terminate detection, `read_api_key`, env injection | Modify |
| `src-tauri/src/lib.rs` | `SidecarState` (port + child), secret commands, `restart_sidecar`, kill-on-exit | Modify |
| `packages/sidecar/src/session/session.ts` | `NO_API_KEY` guard; skip guard when a model is injected | Modify |
| `packages/sidecar/src/session/session-unit.test.ts` | Fast unit tests with an injected fake model | Create |
| `src/ipc/secrets.ts` | Frontend wrapper over secret + restart commands | Create |
| `src/components/account/SettingsPanel.tsx` | API-key entry section | Modify |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | Settings API-key strings | Modify |

---

## Task 1: Narrow `SessionConfig` to DeepSeek-only (W6)

**Files:**
- Modify: `packages/protocol/src/index.ts:3-8`

- [ ] **Step 1: Narrow the union**

In `packages/protocol/src/index.ts`, change the `llmProvider` union to a single literal:

```ts
export interface SessionConfig {
  llmProvider: 'deepseek'
  model: string
  tools: string[]
  systemPrompt?: string
}
```

- [ ] **Step 2: Type-check the whole workspace**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
Expected: PASS. (`DEFAULT_CONFIG` in `src/domain/sessionStore.ts:115` already uses `llmProvider: 'deepseek'`; `buildModel` in the sidecar already targets DeepSeek, so nothing else should break.)

- [ ] **Step 3: Confirm no dead provider references remain**

Run: `grep -rn "anthropic\|ollama\|'openai'" src packages --include="*.ts" --include="*.tsx"`
Expected: no matches (only the now-removed union previously referenced them).

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "refactor(protocol): narrow SessionConfig.llmProvider to deepseek"
```

---

## Task 2: Replace dead model dropdown with read-only label (W6)

**Files:**
- Modify: `src/components/chat/InputBar.tsx`

- [ ] **Step 1: Rewrite InputBar without the non-functional select**

Replace the entire contents of `src/components/chat/InputBar.tsx` with:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp } from 'lucide-react'
import { Textarea } from '@/components/ui/Textarea'
import { sessionService } from '@/domain'

const ACTIVE_MODEL = 'deepseek-chat'

export function InputBar() {
  const { t } = useTranslation()
  const [value, setValue] = useState('')

  function submit() {
    const text = value.trim()
    if (!text) return
    sessionService.sendMessage(text)
    setValue('')
  }

  return (
    <div className="shrink-0 px-5 pb-5">
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-surface p-2 shadow-pop focus-within:ring-2 focus-within:ring-accent/30">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder={t('chat.inputPlaceholder')}
          className="border-0 px-2 py-1 focus-visible:ring-0"
        />
        <div className="flex items-center justify-between px-1 pt-1">
          <span className="text-[12px] text-ink-tertiary">{ACTIVE_MODEL}</span>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            title={t('chat.send')}
          >
            <ArrowUp size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS (no more unused `model`/`MODELS`/`ChevronDown`).

- [ ] **Step 3: Visually verify in the preview**

Start the dev server (`preview_start` / `yarn dev`), navigate to `/#/app`, take a `preview_snapshot` of the input bar.
Expected: the input bar shows a static `deepseek-chat` label on the left and the send button on the right; no dropdown.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/InputBar.tsx
git commit -m "refactor(chat): remove non-functional model dropdown"
```

---

## Task 3: Add a tested port-line parser (W3)

**Files:**
- Modify: `src-tauri/src/sidecar.rs`

- [ ] **Step 1: Write the failing Rust unit test**

Append to `src-tauri/src/sidecar.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::parse_port_line;

    #[test]
    fn parses_port_json() {
        assert_eq!(parse_port_line("{\"port\":54321}"), Some(54321));
        assert_eq!(parse_port_line("  {\"port\":7}  \n"), Some(7));
    }

    #[test]
    fn ignores_non_port_lines() {
        assert_eq!(parse_port_line("starting up"), None);
        assert_eq!(parse_port_line("{\"foo\":1}"), None);
        assert_eq!(parse_port_line(""), None);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test parse_port_line`
Expected: FAIL to compile — `parse_port_line` not found.

- [ ] **Step 3: Implement `parse_port_line`**

Add to `src-tauri/src/sidecar.rs` (the existing `PortMsg` struct stays):

```rust
pub fn parse_port_line(line: &str) -> Option<u16> {
    serde_json::from_str::<PortMsg>(line.trim()).ok().map(|m| m.port)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-tauri && cargo test parse_port_line`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sidecar.rs
git commit -m "test(tauri): add port-line parser with unit tests"
```

---

## Task 4: Managed sidecar spawn — keep child handle, keep draining (W3)

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/sidecar.rs`

- [ ] **Step 1: Define shared sidecar state**

In `src-tauri/src/lib.rs`, replace `pub struct SidecarPort(pub Mutex<Option<u16>>);` with:

```rust
use tauri_plugin_shell::process::CommandChild;

pub struct SidecarState {
    pub port: Mutex<Option<u16>>,
    pub child: Mutex<Option<CommandChild>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self { port: Mutex::new(None), child: Mutex::new(None) }
    }
}
```

- [ ] **Step 2: Rewrite `spawn_sidecar` to store the child and drain stdout/stderr**

Replace the body of `src-tauri/src/sidecar.rs`'s `spawn_sidecar` with:

```rust
use crate::SidecarState;
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

pub async fn spawn_sidecar(app: &AppHandle) -> Result<u16, String> {
    let mut cmd = app.shell().sidecar("sidecar").map_err(|e| e.to_string())?;
    if let Some(key) = read_api_key() {
        cmd = cmd.env("DEEPSEEK_API_KEY", key);
    }
    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;

    *app.state::<SidecarState>().child.lock().unwrap() = Some(child);

    let app_handle = app.clone();
    let (port_tx, port_rx) = tokio::sync::oneshot::channel::<u16>();
    tauri::async_runtime::spawn(async move {
        let mut port_tx = Some(port_tx);
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if port_tx.is_some() {
                        if let Some(port) = parse_port_line(&line) {
                            if let Some(tx) = port_tx.take() {
                                let _ = tx.send(port);
                            }
                            continue;
                        }
                    }
                    print!("[sidecar] {line}");
                }
                CommandEvent::Stderr(bytes) => {
                    eprint!("[sidecar] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[sidecar] terminated: {payload:?}");
                    *app_handle.state::<SidecarState>().port.lock().unwrap() = None;
                    *app_handle.state::<SidecarState>().child.lock().unwrap() = None;
                    break;
                }
                _ => {}
            }
        }
    });

    port_rx
        .await
        .map_err(|_| "sidecar exited before reporting port".to_string())
}

/// DEEPSEEK_API_KEY from env (dev) first, then the OS keychain (production).
pub fn read_api_key() -> Option<String> {
    if let Ok(v) = std::env::var("DEEPSEEK_API_KEY") {
        if !v.is_empty() {
            return Some(v);
        }
    }
    crate::get_secret_value("DEEPSEEK_API_KEY")
}
```

> Note: `crate::get_secret_value` is added in Task 7. Until then this won't compile — Tasks 4-8 land together; do not run a full build until Task 8. You CAN keep committing per task (commits need not compile), but if you prefer green commits, do Tasks 4-8 as one commit.

- [ ] **Step 3: Update `lib.rs` setup + state registration**

In `src-tauri/src/lib.rs`, change `get_sidecar_port` and `setup` to use `SidecarState`:

```rust
#[tauri::command]
fn get_sidecar_port(state: tauri::State<SidecarState>) -> Option<u16> {
    *state.port.lock().unwrap()
}
```

In `run()`, replace `.manage(SidecarPort(Mutex::new(None)))` with `.manage(SidecarState::new())`, and in `setup` store the port into `SidecarState`:

```rust
match sidecar::spawn_sidecar(&handle).await {
    Ok(port) => {
        *handle.state::<SidecarState>().port.lock().unwrap() = Some(port);
        println!("[tauri] sidecar ready on port {port}");
    }
    Err(e) => eprintln!("[tauri] sidecar failed: {e}"),
}
```

- [ ] **Step 4: (Deferred build)** Build verification happens at the end of Task 8 (`cargo build`), once `get_secret_value` exists.

---

## Task 5: Kill the sidecar on app exit (W3)

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Switch to the event-loop `run` form and kill on exit**

In `src-tauri/src/lib.rs`, replace the trailing `.run(tauri::generate_context!()).expect("error while running tauri application");` with a `build` + `run`-closure that kills the child on exit:

```rust
let app = tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_wdio_webdriver::init())
    .manage(SidecarState::new())
    .setup(|app| {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            match sidecar::spawn_sidecar(&handle).await {
                Ok(port) => {
                    *handle.state::<SidecarState>().port.lock().unwrap() = Some(port);
                    println!("[tauri] sidecar ready on port {port}");
                }
                Err(e) => eprintln!("[tauri] sidecar failed: {e}"),
            }
        });
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        get_sidecar_port,
        restart_sidecar,
        set_secret,
        get_secret,
        has_secret,
        delete_secret
    ])
    .build(tauri::generate_context!())
    .expect("error while running tauri application");

app.run(|app_handle, event| {
    if let tauri::RunEvent::ExitRequested { .. } = event {
        if let Some(child) = app_handle.state::<SidecarState>().child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
});
```

> The `invoke_handler` lists commands added in Tasks 6-7. Land Tasks 4-8 together before building.

- [ ] **Step 2: (Deferred build)** verified at end of Task 8.

---

## Task 6: `restart_sidecar` command (W3)

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command**

In `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
async fn restart_sidecar(app: tauri::AppHandle) -> Result<u16, String> {
    // Take the old child out of the lock BEFORE awaiting, then kill it.
    let old = app.state::<SidecarState>().child.lock().unwrap().take();
    if let Some(child) = old {
        let _ = child.kill();
    }
    *app.state::<SidecarState>().port.lock().unwrap() = None;

    let port = sidecar::spawn_sidecar(&app).await?;
    *app.state::<SidecarState>().port.lock().unwrap() = Some(port);
    Ok(port)
}
```

- [ ] **Step 2: (Deferred build)** verified at end of Task 8.

---

## Task 7: Keychain-backed secret commands (W2)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the `keyring` dependency**

In `src-tauri/Cargo.toml` under `[dependencies]`, add:

```toml
keyring = "3"
```

- [ ] **Step 2: Add the secret service helper + commands in `lib.rs`**

```rust
const SECRET_SERVICE: &str = "com.ljm.app";

/// Internal reader used by the sidecar spawn path.
pub fn get_secret_value(key: &str) -> Option<String> {
    let entry = keyring::Entry::new(SECRET_SERVICE, key).ok()?;
    match entry.get_password() {
        Ok(v) => Some(v),
        Err(_) => None,
    }
}

#[tauri::command]
fn set_secret(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SECRET_SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_secret(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SECRET_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn has_secret(key: String) -> Result<bool, String> {
    Ok(get_secret(key)?.is_some())
}

#[tauri::command]
fn delete_secret(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SECRET_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
```

- [ ] **Step 3: Build the whole Rust crate (covers Tasks 4-7)**

Run: `cd src-tauri && cargo build`
Expected: PASS. Fix any signature drift against the installed `tauri-plugin-shell` v2 / `keyring` v3 (e.g. `CommandChild::kill`, `Entry::delete_credential`) — these are the two external APIs to confirm against the locked versions.

- [ ] **Step 4: Run the Rust unit tests**

Run: `cd src-tauri && cargo test`
Expected: PASS (the `parse_port_line` tests from Task 3).

- [ ] **Step 5: Commit (Tasks 4-7 together)**

```bash
git add src-tauri/
git commit -m "feat(tauri): managed sidecar lifecycle + keychain secret commands"
```

---

## Task 8: `NO_API_KEY` guard in the sidecar Session (W2)

**Files:**
- Modify: `packages/sidecar/src/session/session.ts`
- Create: `packages/sidecar/src/session/session-unit.test.ts`

- [ ] **Step 1: Write the failing unit test (injected fake model, no key)**

Create `packages/sidecar/src/session/session-unit.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Session } from './session.js'

type Ev = { type: string; [k: string]: unknown }

function collect(session: Session, text: string): Promise<Ev[]> {
  const events: Ev[] = []
  return session.sendMessage(text, (m) => events.push(m as Ev)).then(() => events)
}

describe('Session NO_API_KEY guard', () => {
  let saved: string | undefined
  beforeEach(() => { saved = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY })
  afterEach(() => { if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved })

  it('emits NO_API_KEY and no agent:started when key is absent and no model is injected', async () => {
    const session = new Session('t-nokey', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })
    const events = await collect(session, 'hi')
    expect(events.some((e) => e.type === 'agent:started')).toBe(false)
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as Ev).code).toBe('NO_API_KEY')
  })

  it('runs normally when a model is injected (guard skipped)', async () => {
    const model = new FakeListChatModel({ responses: ['hello world'] })
    const session = new Session('t-fake', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model)
    const events = await collect(session, 'hi')
    expect(events[0]?.type).toBe('agent:started')
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run packages/sidecar/src/session/session-unit.test.ts`
Expected: FAIL — the first test gets `agent:started` (no guard yet), or an auth throw.

- [ ] **Step 3: Add the guard + track injected model in `session.ts`**

In `packages/sidecar/src/session/session.ts`, record whether a model was injected, and guard at the top of `sendMessage`:

```ts
export class Session {
  private readonly agent: ReturnType<typeof createDeepAgent>
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  private readonly usesEnvModel: boolean

  constructor(
    readonly id: string,
    readonly config: SessionConfig,
    model?: BaseLanguageModel,
  ) {
    this.usesEnvModel = !model
    this.agent = createDeepAgent({
      model: model ?? buildModel(config),
      systemPrompt: config.systemPrompt ?? 'You are a helpful coding assistant.',
    })
  }

  async sendMessage(content: string, _send: SendFn): Promise<void> {
    if (this.usesEnvModel && !process.env.DEEPSEEK_API_KEY) {
      _send({
        type: 'error',
        sessionId: this.id,
        code: 'NO_API_KEY',
        message: 'DeepSeek API key not configured. Set it in Settings.',
      })
      return
    }
    // ...existing body unchanged...
  }
}
```

Also make `buildModel` tolerant of a missing key so construction never throws (the guard handles the real check):

```ts
function buildModel(config: SessionConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: config.model || DEFAULT_MODEL,
    apiKey: process.env.DEEPSEEK_API_KEY || 'sk-missing',
    configuration: { baseURL: 'https://api.deepseek.com/v1' },
  })
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `yarn vitest run packages/sidecar/src/session/session-unit.test.ts`
Expected: PASS (2 tests). If the injected-fake-model test fails on the `streamEvents` call shape, that is the W1 streaming-API issue surfacing early — note it for the Phase 2 spike, and for now adjust only enough to make the fake-model path emit `agent:started` + `message:complete` (do NOT redesign streaming here; that is Phase 2). If adjusting is non-trivial, keep only the first (`NO_API_KEY`) test in this task and move the fake-model assertion to Phase 2.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/
git commit -m "feat(sidecar): emit NO_API_KEY when key absent; testable injected model"
```

---

## Task 9: Frontend secrets IPC wrapper (W2)

**Files:**
- Create: `src/ipc/secrets.ts`

- [ ] **Step 1: Create the wrapper**

```ts
// src/ipc/secrets.ts
import { invoke } from '@tauri-apps/api/core'

const DEEPSEEK_KEY = 'DEEPSEEK_API_KEY'

export function isApiKeyConfigured(): Promise<boolean> {
  return invoke<boolean>('has_secret', { key: DEEPSEEK_KEY })
}

export function saveApiKey(value: string): Promise<void> {
  return invoke<void>('set_secret', { key: DEEPSEEK_KEY, value })
}

export function clearApiKey(): Promise<void> {
  return invoke<void>('delete_secret', { key: DEEPSEEK_KEY })
}

export function restartSidecar(): Promise<number> {
  return invoke<number>('restart_sidecar')
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ipc/secrets.ts
git commit -m "feat(ipc): frontend wrapper for keychain secret commands"
```

---

## Task 10: API-key entry in Settings (W2)

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`
- Modify: `src/components/account/SettingsPanel.tsx`

- [ ] **Step 1: Add i18n strings**

In each of `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, add these keys under the existing `settings` object (use the matching language for values; English shown):

```ts
// settings: { ...existing,
apiKey: 'DeepSeek API Key',
apiKeyDesc: 'Stored securely in your system keychain. Used by the agent runtime.',
apiKeyConfigured: 'Configured',
apiKeyNotConfigured: 'Not configured',
apiKeyPlaceholder: 'sk-...',
apiKeySave: 'Save',
apiKeyClear: 'Clear',
// }
```

zh-CN values: `apiKey: 'DeepSeek API Key'`, `apiKeyDesc: '安全存储于系统钥匙串,供智能体运行时使用。'`, `apiKeyConfigured: '已配置'`, `apiKeyNotConfigured: '未配置'`, `apiKeyPlaceholder: 'sk-...'`, `apiKeySave: '保存'`, `apiKeyClear: '清除'`.
zh-TW values: same as zh-CN but Traditional: `apiKeyDesc: '安全儲存於系統鑰匙串,供智慧體執行時使用。'`, `apiKeyConfigured: '已設定'`, `apiKeyNotConfigured: '未設定'`, `apiKeySave: '儲存'`, `apiKeyClear: '清除'`.

- [ ] **Step 2: Add the API-key section to SettingsPanel**

Replace `src/components/account/SettingsPanel.tsx` with (keeps the existing language row, adds the key row above it):

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { isApiKeyConfigured, saveApiKey, clearApiKey, restartSidecar } from '@/ipc/secrets'

const LANGUAGE_KEYS = ['zh-CN', 'zh-TW', 'en'] as const
type LanguageKey = (typeof LANGUAGE_KEYS)[number]

export function SettingsPanel() {
  const { t, i18n } = useTranslation()
  const currentLang: LanguageKey = LANGUAGE_KEYS.includes(i18n.language as LanguageKey)
    ? (i18n.language as LanguageKey)
    : LANGUAGE_KEYS[0]

  const [configured, setConfigured] = useState<boolean | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    isApiKeyConfigured().then(setConfigured).catch(() => setConfigured(false))
  }, [])

  async function onSave() {
    if (!value.trim()) return
    setBusy(true)
    try {
      await saveApiKey(value.trim())
      await restartSidecar()
      setConfigured(true)
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  async function onClear() {
    setBusy(true)
    try {
      await clearApiKey()
      await restartSidecar()
      setConfigured(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col">
      {/* API key */}
      <div className="px-6 py-5">
        <div className="text-[14px] font-medium text-ink">{t('settings.apiKey')}</div>
        <div className="mt-0.5 text-[12px] text-ink-tertiary">{t('settings.apiKeyDesc')}</div>
        <div className="mt-1 text-[12px]">
          {configured
            ? <span className="text-emerald-600">{t('settings.apiKeyConfigured')}</span>
            : <span className="text-ink-tertiary">{t('settings.apiKeyNotConfigured')}</span>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('settings.apiKeyPlaceholder')}
            className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <button
            onClick={onSave}
            disabled={busy || !value.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {t('settings.apiKeySave')}
          </button>
          <button
            onClick={onClear}
            disabled={busy || !configured}
            className="rounded-md border border-border px-3 py-1.5 text-[13px] text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-40"
          >
            {t('settings.apiKeyClear')}
          </button>
        </div>
      </div>

      {/* Language (unchanged) */}
      <div className="flex items-center justify-between px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-ink">{t('settings.language')}</div>
          <div className="mt-0.5 text-[12px] text-ink-tertiary">{t('settings.languageDesc')}</div>
        </div>
        <div className="relative ml-4 shrink-0">
          <select
            value={currentLang}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="cursor-pointer appearance-none rounded-md border border-border bg-surface py-1.5 pl-2.5 pr-8 text-[13px] text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            {LANGUAGE_KEYS.map((lang) => (
              <option key={lang} value={lang}>
                {t(`settings.languages.${lang}`)}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-tertiary"
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `yarn type-check`
Expected: PASS. (If `i18next.d.ts` enforces typed keys, the new `settings.*` keys must exist in the resource types — they will, since they're added to the `en` resource the types derive from.)

- [ ] **Step 4: Commit**

```bash
git add src/components/account/SettingsPanel.tsx src/i18n/
git commit -m "feat(settings): DeepSeek API key entry backed by keychain"
```

---

## Task 11: End-to-end manual verification with the real DeepSeek API

**Files:** none (verification only)

- [ ] **Step 1: Build the dev sidecar binary and run the app fresh**

```bash
yarn sidecar:dev-bin
# Run WITHOUT a key in the environment to simulate production:
env -u DEEPSEEK_API_KEY yarn tauri dev
```

- [ ] **Step 2: Verify the no-key path**

In the running app, open a chat and send a message.
Expected: the chat shows an error state (the sidecar emitted `NO_API_KEY`); no crash.

- [ ] **Step 3: Configure the key in Settings and verify the agent works**

Open Settings → paste a real DeepSeek key → Save. (This calls `set_secret` + `restart_sidecar`.) Send a message again.
Expected: a streamed assistant reply appears (sidecar restarted with the key from the keychain). Confirm in the terminal that `[tauri] sidecar ready on port NNNN` printed twice (initial + restart).

- [ ] **Step 4: Verify no orphan process on quit**

Quit the app, then run: `pgrep -fl sidecar` (or `pgrep -fl node | grep sidecar`).
Expected: no lingering sidecar/node process (kill-on-exit works).

- [ ] **Step 5: Final phase build + test gate**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check && yarn vitest run packages/sidecar/src/session/session-unit.test.ts && (cd src-tauri && cargo build && cargo test)`
Expected: all PASS.

---

## Self-Review (completed during authoring)

- **Spec coverage (Phase 1 scope):** W6 → Tasks 1-2. W3 (handle retention, drain, terminate detect, kill-on-exit, restart) → Tasks 3-6. W2 (keychain commands, env injection, NO_API_KEY, settings UI) → Tasks 4 (injection), 7-10. ✅
- **Cross-task type consistency:** `SidecarState`/`get_secret_value`/`read_api_key` (Rust) and `set_secret`/`get_secret`/`has_secret`/`delete_secret`/`restart_sidecar` command names match between `lib.rs` definitions, the `invoke_handler!` list (Task 5), and the frontend wrapper (Task 9). ✅
- **Known external-API risks flagged inline:** `CommandChild::kill` & `Entry::delete_credential` (Task 7 Step 3); deepagents `streamEvents` shape may surface in Task 8 Step 4 and is explicitly deferred to the Phase 2 spike. ✅
- **Build ordering:** Tasks 4-7 don't individually compile (forward refs); Task 7 Step 3 is the first full `cargo build` gate — called out inline. ✅
