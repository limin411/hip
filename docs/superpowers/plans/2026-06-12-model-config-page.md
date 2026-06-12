# 模型配置 (multi-provider model-config page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 模型配置 settings page that configures multiple OpenAI-compatible LLM providers (key, base URL, model) from a live models.dev catalog and lets the user pick one global current model the whole app uses.

**Architecture:** Secrets stay in the OS keychain (one entry per provider); non-secret config (`{providers, activeModel}`) lives in `app_data_dir/hip-providers.json`; the model catalog is fetched Rust-side from models.dev with disk cache + bundled snapshot fallback. The sidecar builds `ChatOpenAI` from a process-global *active model* ({providerID, modelID, baseURL}); changing the model is a live `config:setActiveModel` message (no restart), while adding/removing a key restarts the sidecar to re-inject env. The 深度思考 toggle is retired — reasoning surfaces automatically for reasoning-capable models.

**Tech Stack:** Tauri 2 (Rust, keyring, reqwest), Node sidecar (LangChain `ChatOpenAI`, ws), React 18 + zustand + Radix + i18next, vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-06-12-model-config-page-design.md`

---

## File structure

**Create**
- `packages/sidecar/src/config/providers.ts` — sidecar's process-global active model + per-provider key-env helper; reads `HIP_PROVIDERS_PATH`.
- `packages/sidecar/src/config/providers.test.ts` — unit tests for the above.
- `src-tauri/resources/models-snapshot.json` — bundled catalog fallback.
- `src/ipc/catalog.ts` — `fetchCatalog()` + `isCompatible()` + catalog types.
- `src/ipc/catalog.test.ts` — `isCompatible()` unit tests.
- `src/ipc/providersConfig.ts` — read/write `hip-providers.json` + first-run default.
- `src/ipc/providersConfig.test.ts` — defaulting/migration unit tests.
- `src/store/providersStore.ts` — catalog + config + key-status state and actions.
- `src/components/account/ModelConfig.tsx` — the settings page (list + detail).

**Modify**
- `packages/protocol/src/index.ts` — widen `SessionConfig`; add `ProvidersConfig`/`providerKeyEnv`; add `config:setActiveModel` / `config:activeModel`.
- `packages/sidecar/src/session/session.ts` — provider-aware `buildModel`/title generator/`requireApiKey`; add `Session.applyActiveModel`.
- `packages/sidecar/src/session/session-manager.ts` — handle `config:setActiveModel`; ensure-active-model on send; deseed default config.
- `packages/sidecar/src/server/ws-server.ts` — `ready.hasApiKey` from active provider.
- `packages/sidecar/src/main.ts` — initialise active model from `HIP_PROVIDERS_PATH` at boot.
- `src-tauri/src/sidecar.rs` — multi-key injection + `HIP_PROVIDERS_PATH`; `read_provider_key`/`provider_key_env`.
- `src-tauri/src/lib.rs` — add `models_catalog`, `get_providers_config`, `set_providers_config`.
- `src-tauri/Cargo.toml` — add `reqwest`.
- `src/ipc/secrets.ts` — per-provider key helpers.
- `src/domain/sessionService.ts` — add `setActiveModel`; deseed `createSession`.
- `src/domain/sessionStore.ts` — `DEFAULT_CONFIG` deseed.
- `src/components/account/SettingsPanel.tsx` — register the `model` page.
- `src/components/account/GeneralSettings.tsx` — remove the API-key block.
- `src/components/chat/Composer.tsx` + `src/components/chat/InputBar.tsx` — remove the 深度思考 toggle.
- `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, `src/i18n/en.ts` — `settings.model*` keys.

---

# Phase 0 — Protocol foundation

### Task 0: Widen protocol types + shared helpers

**Files:**
- Modify: `packages/protocol/src/index.ts:3-11` (SessionConfig), `:108-127` (ClientMessage), `:129-153` (ServerMessage)

- [ ] **Step 1: Widen `SessionConfig` and add shared provider types/helper**

Replace the `SessionConfig` interface (`packages/protocol/src/index.ts:3-11`) with:

```ts
export interface SessionConfig {
  llmProvider: string          // provider id (was the 'deepseek' literal)
  model: string
  baseURL?: string             // resolved OpenAI-compatible base URL for the provider
  tools: string[]
  systemPrompt?: string
  cwd?: string                 // absolute project root; undefined → virtual FS (no real file tools)
  thinking?: boolean           // DEPRECATED: retained for back-compat; no longer swaps models
  language?: 'en' | 'zh-CN' | 'zh-TW'
}

/** Global current model the whole app uses. */
export interface ActiveModel {
  providerID: string
  modelID: string
  baseURL: string
}

/** One provider's non-secret config (the key lives only in the keychain). */
export interface ProviderConfigEntry {
  enabled: boolean
  baseURL?: string             // catalog default or user override; required for custom
  custom?: { name: string }    // present iff user-defined (not in the models.dev catalog)
}

/** Durable, non-secret provider config persisted to app_data_dir/hip-providers.json. */
export interface ProvidersConfig {
  providers: Record<string, ProviderConfigEntry>
  activeModel?: { providerID: string; modelID: string }
}

/** Keychain entry name AND env var name for a provider's API key. Single source of the rule. */
export function providerKeyEnv(providerID: string): string {
  return `HIP_MODEL_${providerID.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
}
```

- [ ] **Step 2: Add the two new message variants**

In `ClientMessage` (after the `session:setSystemPrompt` line, `:121`) add:

```ts
  | { type: 'config:setActiveModel'; providerID: string; modelID: string; baseURL: string }
```

In `ServerMessage` (after the `session:systemPrompt` line, `:138`) add:

```ts
  | { type: 'config:activeModel'; providerID: string; modelID: string }
```

- [ ] **Step 3: Type-check the protocol + workspace**

Run: `yarn type-check`
Expected: PASS. (No callers reference the new fields yet; widening `llmProvider` to `string` keeps the existing `'deepseek'` literal assignment valid.)

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): multi-provider SessionConfig + ProvidersConfig + active-model messages"
```

---

# Phase 1 — Sidecar provider-ization

### Task 1: Sidecar active-model module

**Files:**
- Create: `packages/sidecar/src/config/providers.ts`
- Test: `packages/sidecar/src/config/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getActiveModel, setActiveModel, loadActiveModelFromEnv, DEEPSEEK_DEFAULT } from './providers.js'
import { providerKeyEnv } from '@hip/protocol'

describe('sidecar provider config', () => {
  beforeEach(() => setActiveModel(DEEPSEEK_DEFAULT))

  it('providerKeyEnv normalises ids', () => {
    expect(providerKeyEnv('deepseek')).toBe('HIP_MODEL_DEEPSEEK_API_KEY')
    expect(providerKeyEnv('github-copilot')).toBe('HIP_MODEL_GITHUB_COPILOT_API_KEY')
  })

  it('defaults to deepseek when no providers file is set', () => {
    delete process.env.HIP_PROVIDERS_PATH
    loadActiveModelFromEnv()
    expect(getActiveModel()).toEqual(DEEPSEEK_DEFAULT)
  })

  it('reads active model + base URL from the providers file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-prov-'))
    const file = join(dir, 'hip-providers.json')
    writeFileSync(file, JSON.stringify({
      providers: { openai: { enabled: true, baseURL: 'https://api.openai.com/v1' } },
      activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
    }))
    process.env.HIP_PROVIDERS_PATH = file
    loadActiveModelFromEnv()
    expect(getActiveModel()).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
  })

  it('setActiveModel/getActiveModel round-trip', () => {
    setActiveModel({ providerID: 'groq', modelID: 'llama-3.3-70b', baseURL: 'https://api.groq.com/openai/v1' })
    expect(getActiveModel().providerID).toBe('groq')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run packages/sidecar/src/config/providers.test.ts`
Expected: FAIL ("Cannot find module './providers.js'").

- [ ] **Step 3: Implement `providers.ts`**

```ts
import { readFileSync } from 'node:fs'
import type { ActiveModel, ProvidersConfig } from '@hip/protocol'

export const DEEPSEEK_DEFAULT: ActiveModel = {
  providerID: 'deepseek',
  modelID: 'deepseek-reasoner',
  baseURL: 'https://api.deepseek.com/v1',
}

let active: ActiveModel = DEEPSEEK_DEFAULT

export function getActiveModel(): ActiveModel {
  return active
}

export function setActiveModel(m: ActiveModel): void {
  active = m
}

/** Initialise the process-global active model from HIP_PROVIDERS_PATH (call once at boot). */
export function loadActiveModelFromEnv(): void {
  const file = process.env.HIP_PROVIDERS_PATH?.trim()
  if (!file) { active = DEEPSEEK_DEFAULT; return }
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as ProvidersConfig
    const sel = cfg.activeModel
    if (!sel) { active = DEEPSEEK_DEFAULT; return }
    const baseURL = cfg.providers?.[sel.providerID]?.baseURL ?? DEEPSEEK_DEFAULT.baseURL
    active = { providerID: sel.providerID, modelID: sel.modelID, baseURL }
  } catch {
    active = DEEPSEEK_DEFAULT
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn vitest run packages/sidecar/src/config/providers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/config/providers.ts packages/sidecar/src/config/providers.test.ts
git commit -m "feat(sidecar): process-global active model + providers-file loader"
```

### Task 2: Provider-aware model construction

**Files:**
- Modify: `packages/sidecar/src/session/session.ts:16` (TITLE_MODEL stays), `:51-67` (title generator), `:137-145` (buildModel), `:268-275` (requireApiKey), `:219-225` (add applyActiveModel near setThinking)

- [ ] **Step 1: Make `buildModel` read the active model**

Add the import at the top of `session.ts` (with the other local imports, after line 12):

```ts
import { getActiveModel } from '../config/providers.js'
import { providerKeyEnv } from '@hip/protocol'
```

Replace `buildModel` (`:137-145`) with:

```ts
function activeKey(providerID: string): string {
  return process.env[providerKeyEnv(providerID)] || 'sk-missing'
}

function buildModel(_config: SessionConfig): ChatOpenAI {
  const { providerID, modelID, baseURL } = getActiveModel()
  return new ReasoningChatOpenAI({
    model: modelID,
    apiKey: activeKey(providerID),
    configuration: { baseURL },
  })
}
```

- [ ] **Step 2: Make the title generator follow the active provider**

Replace `buildDefaultTitleGenerator` (`:51-67`) with (it no longer hardcodes DeepSeek; it reads the active model + key per call):

```ts
function buildDefaultTitleGenerator(_config: SessionConfig): TitleGenerator {
  return async ({ firstUserMessage, firstReply }) => {
    const { providerID, modelID, baseURL } = getActiveModel()
    const model = new ChatOpenAI({
      model: modelID,
      apiKey: process.env[providerKeyEnv(providerID)] || 'sk-missing',
      configuration: { baseURL },
      maxTokens: 24,
      temperature: 0.3,
    })
    const res = await model.invoke([
      new SystemMessage(TITLE_SYSTEM_PROMPT),
      new HumanMessage(`${firstUserMessage}\n\n[assistant reply]: ${firstReply.slice(0, 200)}`),
    ])
    return typeof res.content === 'string' ? res.content : ''
  }
}
```

(`TITLE_MODEL` at `:16` is now unused — delete that `const TITLE_MODEL = 'deepseek-chat'` line.)

- [ ] **Step 3: Key the NO_API_KEY guard off the active provider**

Replace `requireApiKey` (`:268-275`) with:

```ts
  /** Emit NO_API_KEY and return false when the env-keyed active provider has no key. */
  private requireApiKey(send: SendFn): boolean {
    if (this.usesEnvModel) {
      const { providerID } = getActiveModel()
      if (!process.env[providerKeyEnv(providerID)]?.trim()) {
        send({ type: 'error', sessionId: this.id, code: 'NO_API_KEY', message: 'API key not configured. Set it in Settings.' })
        return false
      }
    }
    return true
  }
```

- [ ] **Step 4: Add `applyActiveModel` (mirrors `setThinking`)**

After `setThinking` (`:225`) add:

```ts
  /** Rebuild against the current global active model. NO-OP (returns false) while a turn is running;
   *  the next sendMessage rebuilds (see modelDirty). Injected-model sessions (tests) are unaffected. */
  applyActiveModel(): boolean {
    if (!this.usesEnvModel) return true
    if (this.running) { this.modelDirty = true; return false }
    this.buildAgent()
    return true
  }
```

Add the field next to the other private fields (after `:163` `private running = false`):

```ts
  private modelDirty = false
```

And at the very top of `sendMessage` (`:277-279`), after the `if (this.running) return` guard, before `requireApiKey`, add:

```ts
    if (this.modelDirty) { this.buildAgent(); this.modelDirty = false }
```

- [ ] **Step 5: Verify the sidecar still builds + existing tests pass**

Run: `yarn vitest run packages/sidecar`
Expected: PASS (existing sidecar suites unaffected — they inject models, so `buildModel`/active-model code is not exercised).

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/session.ts
git commit -m "feat(sidecar): build model + title gen + key guard from global active model"
```

### Task 3: Handle `config:setActiveModel`; ready uses active provider

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts:1` (import), `:101` (add case), `:159` (deseed default config)
- Modify: `packages/sidecar/src/server/ws-server.ts:50` (ready)
- Modify: `packages/sidecar/src/main.ts:6` (init active model)

- [ ] **Step 1: Add the `config:setActiveModel` handler**

In `session-manager.ts`, extend the top import (`:1`) and add the active-model import:

```ts
import { setActiveModel } from '../config/providers.js'
```

After the `session:setSystemPrompt` case (`:101`, before `case 'fs:ls'`) add:

```ts
      case 'config:setActiveModel': {
        setActiveModel({ providerID: msg.providerID, modelID: msg.modelID, baseURL: msg.baseURL })
        // Apply to every in-memory session at its next idle turn (no restart).
        for (const s of this.sessions.values()) s.applyActiveModel()
        send({ type: 'config:activeModel', providerID: msg.providerID, modelID: msg.modelID })
        break
      }
```

- [ ] **Step 2: Deseed the lazy-resume default config**

In `ensureSession` (`:159`) replace the inline default with a provider-agnostic one:

```ts
    const config: SessionConfig = row ? JSON.parse(row.config) : { llmProvider: 'deepseek', model: '', tools: [] }
```

(The model used at runtime comes from the global active model regardless; the stored `llmProvider` is only a label.)

- [ ] **Step 3: `ready.hasApiKey` reflects the active provider**

In `ws-server.ts` add the import (top, after `:6`):

```ts
import { getActiveModel } from '../config/providers.js'
import { providerKeyEnv } from '@hip/protocol'
```

Replace the `ready` send (`:50`) with:

```ts
    send({ type: 'ready', hasApiKey: !!process.env[providerKeyEnv(getActiveModel().providerID)]?.trim() })
```

- [ ] **Step 4: Initialise the active model at boot**

In `main.ts` add the import (after `:5`) and call it before constructing the server (after `:11` `const dbPath = ...`):

```ts
import { loadActiveModelFromEnv } from './config/providers.js'
```
```ts
  loadActiveModelFromEnv()
```

- [ ] **Step 5: Type-check + sidecar tests**

Run: `yarn type-check && yarn vitest run packages/sidecar`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/server/ws-server.ts packages/sidecar/src/main.ts
git commit -m "feat(sidecar): config:setActiveModel handler + active-provider ready flag"
```

---

# Phase 2 — Tauri / Rust

### Task 4: Bundled catalog snapshot

**Files:**
- Create: `src-tauri/resources/models-snapshot.json`

- [ ] **Step 1: Add a minimal real-shaped snapshot** (offline fallback + a fixture; refresh later by saving the live `models_catalog` output)

```json
{
  "deepseek": {
    "id": "deepseek", "name": "DeepSeek", "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.deepseek.com/v1", "env": ["DEEPSEEK_API_KEY"],
    "models": {
      "deepseek-reasoner": { "id": "deepseek-reasoner", "name": "DeepSeek Reasoner", "reasoning": true, "tool_call": true, "attachment": false, "limit": { "context": 128000, "output": 8192 } },
      "deepseek-chat": { "id": "deepseek-chat", "name": "DeepSeek Chat", "reasoning": false, "tool_call": true, "attachment": false, "limit": { "context": 128000, "output": 8192 } }
    }
  },
  "openai": {
    "id": "openai", "name": "OpenAI", "npm": "@ai-sdk/openai",
    "api": "https://api.openai.com/v1", "env": ["OPENAI_API_KEY"],
    "models": {
      "gpt-4o": { "id": "gpt-4o", "name": "GPT-4o", "reasoning": false, "tool_call": true, "attachment": true, "limit": { "context": 128000, "output": 16384 } }
    }
  },
  "anthropic": {
    "id": "anthropic", "name": "Anthropic", "npm": "@ai-sdk/anthropic",
    "api": "https://api.anthropic.com", "env": ["ANTHROPIC_API_KEY"],
    "models": {
      "claude-sonnet-4-6": { "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6", "reasoning": true, "tool_call": true, "attachment": true, "limit": { "context": 200000, "output": 64000 } }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/resources/models-snapshot.json
git commit -m "feat(tauri): bundled models.dev catalog snapshot fallback"
```

### Task 5: Rust commands — catalog + providers config

**Files:**
- Modify: `src-tauri/Cargo.toml:20-29`
- Modify: `src-tauri/src/lib.rs` (add 3 commands + register)

- [ ] **Step 1: Add the `reqwest` dependency**

In `Cargo.toml`, under `[dependencies]` add:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
```

- [ ] **Step 2: Add the three commands to `lib.rs`**

After the `delete_secret` command (`:94`) add:

```rust
use std::time::{Duration, SystemTime};

const MODELS_URL: &str = "https://models.dev/api.json";
const CATALOG_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const SNAPSHOT: &str = include_str!("../resources/models-snapshot.json");

fn providers_config_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("hip-providers.json"))
}

#[tauri::command]
fn get_providers_config(app: tauri::AppHandle) -> Result<String, String> {
    match providers_config_path(&app) {
        Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_default()),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn set_providers_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = providers_config_path(&app).ok_or("no app data dir")?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}

#[tauri::command]
async fn models_catalog(app: tauri::AppHandle) -> Result<String, String> {
    let cache = app.path().app_data_dir().ok().map(|d| d.join("models.json"));
    // Fresh cache → return it.
    if let Some(ref c) = cache {
        if let Ok(meta) = std::fs::metadata(c) {
            if let Ok(modified) = meta.modified() {
                if SystemTime::now().duration_since(modified).unwrap_or(CATALOG_TTL) < CATALOG_TTL {
                    if let Ok(body) = std::fs::read_to_string(c) {
                        return Ok(body);
                    }
                }
            }
        }
    }
    let url = std::env::var("HIP_MODELS_URL").unwrap_or_else(|_| MODELS_URL.to_string());
    match reqwest::get(&url).await.and_then(|r| r.error_for_status()) {
        Ok(resp) => match resp.text().await {
            Ok(body) => {
                if let Some(ref c) = cache { let _ = std::fs::write(c, &body); }
                Ok(body)
            }
            Err(_) => fallback_catalog(cache.as_deref()),
        },
        Err(_) => fallback_catalog(cache.as_deref()),
    }
}

fn fallback_catalog(cache: Option<&std::path::Path>) -> Result<String, String> {
    if let Some(c) = cache {
        if let Ok(body) = std::fs::read_to_string(c) {
            return Ok(body);
        }
    }
    Ok(SNAPSHOT.to_string())
}
```

- [ ] **Step 3: Register the commands**

In `generate_handler!` (`:117-124`) append the three names:

```rust
        .invoke_handler(tauri::generate_handler![
            get_sidecar_info,
            restart_sidecar,
            set_secret,
            get_secret,
            has_secret,
            delete_secret,
            models_catalog,
            get_providers_config,
            set_providers_config
        ])
```

- [ ] **Step 4: Build Rust to verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: compiles (downloads `reqwest`). Warnings about unused `SNAPSHOT` are gone once referenced.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat(tauri): models_catalog + get/set_providers_config commands"
```

### Task 6: Multi-key injection at sidecar spawn

**Files:**
- Modify: `src-tauri/src/sidecar.rs:20-44` (spawn), `:105-111` (key reader)

- [ ] **Step 1: Add a normalised key-env helper + provider enumeration**

Replace `read_api_key` (`:105-111`) with:

```rust
/// Keychain entry name AND env var name for a provider's API key (mirrors
/// protocol's `providerKeyEnv`). Keep the three impls (TS protocol, TS sidecar,
/// this) in sync.
pub fn provider_key_env(provider_id: &str) -> String {
    let norm: String = provider_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' })
        .collect();
    format!("HIP_MODEL_{norm}_API_KEY")
}

/// Read the keychain key for a provider (keychain entry name == env var name).
pub fn read_provider_key(provider_id: &str) -> Option<String> {
    crate::get_secret_value(&provider_key_env(provider_id))
}

/// Provider ids present in hip-providers.json (always includes "deepseek" so the
/// out-of-box DeepSeek path keeps working before the user opens the new page).
fn configured_provider_ids(app: &AppHandle) -> Vec<String> {
    let mut ids = vec!["deepseek".to_string()];
    if let Ok(dir) = app.path().app_data_dir() {
        let path = dir.join("hip-providers.json");
        if let Ok(body) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(map) = v.get("providers").and_then(|p| p.as_object()) {
                    for k in map.keys() {
                        if !ids.contains(k) { ids.push(k.clone()); }
                    }
                }
            }
        }
    }
    ids
}
```

- [ ] **Step 2: Inject every provider's key + the providers path**

Replace the key-injection block in `spawn_sidecar` (`:21-28`) with:

```rust
    let mut cmd = app.shell().sidecar("sidecar").map_err(|e| e.to_string())?;
    // Inject each configured provider's keychain key as HIP_MODEL_<ID>_API_KEY
    // (empty string when absent → overrides any inherited env so a cleared key
    // truly disables that provider). The sidecar picks the active provider's key.
    for id in configured_provider_ids(app) {
        let env = provider_key_env(&id);
        match read_provider_key(&id) {
            Some(key) => cmd = cmd.env(&env, key),
            None => cmd = cmd.env(&env, ""),
        }
    }
    // Point the sidecar at the non-secret providers config (active model + base URLs).
    if let Ok(dir) = app.path().app_data_dir() {
        cmd = cmd.env("HIP_PROVIDERS_PATH", dir.join("hip-providers.json").to_string_lossy().into_owned());
    }
```

(The existing `HIP_DB_PATH` + `HIP_PARENT_WATCH` blocks below stay unchanged.)

- [ ] **Step 3: Build Rust + run its tests**

Run: `cd src-tauri && cargo build && cargo test`
Expected: PASS (existing `parse_info_line` / `db_path_for` tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/sidecar.rs
git commit -m "feat(tauri): inject all provider keys + HIP_PROVIDERS_PATH at sidecar spawn"
```

---

# Phase 3 — Frontend IPC + store

### Task 7: Per-provider secrets

**Files:**
- Modify: `src/ipc/secrets.ts`

- [ ] **Step 1: Generalise the key helpers**

Replace the whole file with:

```ts
// src/ipc/secrets.ts
import { invoke } from '@tauri-apps/api/core'
import { providerKeyEnv } from '@hip/protocol'

export function isProviderKeyConfigured(providerID: string): Promise<boolean> {
  return invoke<boolean>('has_secret', { key: providerKeyEnv(providerID) })
}

export function saveProviderKey(providerID: string, value: string): Promise<void> {
  return invoke<void>('set_secret', { key: providerKeyEnv(providerID), value })
}

export function clearProviderKey(providerID: string): Promise<void> {
  return invoke<void>('delete_secret', { key: providerKeyEnv(providerID) })
}

export function restartSidecar(): Promise<number> {
  return invoke<number>('restart_sidecar')
}
```

- [ ] **Step 2: Type-check (will fail until GeneralSettings is updated in Task 12)**

Run: `yarn type-check`
Expected: FAIL only in `src/components/account/GeneralSettings.tsx` (imports the removed `isApiKeyConfigured`/`saveApiKey`/`clearApiKey`). That file is rewritten in Task 12; proceed. (No commit yet — commit together with Task 8/9 store wiring or leave staged. To keep commits green, complete Task 12 before re-running type-check at a commit boundary. Stage now:)

```bash
git add src/ipc/secrets.ts
```

### Task 8: Catalog IPC + compatibility gate

**Files:**
- Create: `src/ipc/catalog.ts`
- Test: `src/ipc/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { isCompatible } from './catalog'

describe('isCompatible', () => {
  it('accepts OpenAI + openai-compatible npm packages', () => {
    expect(isCompatible({ id: 'openai', name: 'OpenAI', npm: '@ai-sdk/openai', models: {}, env: [] })).toBe(true)
    expect(isCompatible({ id: 'x', name: 'X', npm: '@ai-sdk/openai-compatible', models: {}, env: [] })).toBe(true)
  })
  it('accepts allowlisted ids regardless of npm', () => {
    expect(isCompatible({ id: 'groq', name: 'Groq', npm: 'whatever', models: {}, env: [] })).toBe(true)
  })
  it('always accepts custom providers', () => {
    expect(isCompatible({ id: 'mine', name: 'Mine', models: {}, env: [], custom: true })).toBe(true)
  })
  it('rejects native-only vendors', () => {
    expect(isCompatible({ id: 'anthropic', name: 'Anthropic', npm: '@ai-sdk/anthropic', models: {}, env: [] })).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run src/ipc/catalog.test.ts`
Expected: FAIL ("Cannot find module './catalog'").

- [ ] **Step 3: Implement `catalog.ts`**

```ts
// src/ipc/catalog.ts
import { invoke } from '@tauri-apps/api/core'

export interface CatalogModel {
  id: string
  name: string
  family?: string
  reasoning?: boolean
  tool_call?: boolean
  attachment?: boolean
  cost?: { input: number; output: number }
  limit?: { context: number; output: number }
}
export interface CatalogProvider {
  id: string
  name: string
  env: string[]
  npm?: string
  api?: string
  models: Record<string, CatalogModel>
  custom?: boolean          // set true by us for user-defined providers (never from models.dev)
}
export type Catalog = Record<string, CatalogProvider>

/** Providers reachable via @ai-sdk/openai semantics even when models.dev tags a different npm. */
const COMPATIBLE_IDS = new Set([
  'deepseek', 'openai', 'openrouter', 'groq', 'moonshotai', 'zhipuai', 'siliconflow',
  'mistral', 'xai', 'togetherai', 'deepinfra', 'fireworks', 'perplexity', 'ollama', 'lmstudio',
])

export function isCompatible(p: CatalogProvider): boolean {
  if (p.custom) return true
  if (p.npm === '@ai-sdk/openai' || p.npm === '@ai-sdk/openai-compatible') return true
  return COMPATIBLE_IDS.has(p.id)
}

export async function fetchCatalog(): Promise<Catalog> {
  const raw = await invoke<string>('models_catalog')
  return JSON.parse(raw) as Catalog
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn vitest run src/ipc/catalog.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ipc/catalog.ts src/ipc/catalog.test.ts
git commit -m "feat(ipc): models.dev catalog fetch + OpenAI-compat gate"
```

### Task 9: Providers-config IPC + first-run default

**Files:**
- Create: `src/ipc/providersConfig.ts`
- Test: `src/ipc/providersConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { withDefaults } from './providersConfig'

describe('withDefaults', () => {
  it('seeds deepseek + active model from an empty config', () => {
    const cfg = withDefaults(null)
    expect(cfg.providers.deepseek.enabled).toBe(true)
    expect(cfg.providers.deepseek.baseURL).toBe('https://api.deepseek.com/v1')
    expect(cfg.activeModel).toEqual({ providerID: 'deepseek', modelID: 'deepseek-reasoner' })
  })
  it('preserves an existing config', () => {
    const existing = { providers: { openai: { enabled: true, baseURL: 'u' } }, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } }
    expect(withDefaults(existing)).toEqual(existing)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run src/ipc/providersConfig.test.ts`
Expected: FAIL ("Cannot find module './providersConfig'").

- [ ] **Step 3: Implement `providersConfig.ts`**

```ts
// src/ipc/providersConfig.ts
import { invoke } from '@tauri-apps/api/core'
import type { ProvidersConfig } from '@hip/protocol'

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1'

/** First-run seed: DeepSeek enabled + active, so existing users see no change. */
export function withDefaults(cfg: ProvidersConfig | null): ProvidersConfig {
  if (cfg && cfg.providers && Object.keys(cfg.providers).length > 0) return cfg
  return {
    providers: { deepseek: { enabled: true, baseURL: DEEPSEEK_BASE } },
    activeModel: { providerID: 'deepseek', modelID: 'deepseek-reasoner' },
  }
}

export async function getProvidersConfig(): Promise<ProvidersConfig> {
  const raw = await invoke<string>('get_providers_config')
  const parsed = raw.trim() ? (JSON.parse(raw) as ProvidersConfig) : null
  return withDefaults(parsed)
}

export async function setProvidersConfig(cfg: ProvidersConfig): Promise<void> {
  await invoke<void>('set_providers_config', { json: JSON.stringify(cfg, null, 2) })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn vitest run src/ipc/providersConfig.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ipc/providersConfig.ts src/ipc/providersConfig.test.ts
git commit -m "feat(ipc): hip-providers.json read/write + first-run default seed"
```

### Task 10: Providers store + `setActiveModel` service method

**Files:**
- Create: `src/store/providersStore.ts`
- Modify: `src/domain/sessionService.ts:130` (add method), `src/domain/sessionStore.ts:271` (deseed), `src/domain/sessionService.ts:88-93` (deseed createSession)

- [ ] **Step 1: Add `setActiveModel` to `SessionService`**

In `sessionService.ts`, after `setSystemPrompt` (`:130`) add:

```ts
  /** Switch the global current model live (no sidecar restart). */
  setActiveModel(providerID: string, modelID: string, baseURL: string): void {
    this.transport.send({ type: 'config:setActiveModel', providerID, modelID, baseURL })
  }
```

- [ ] **Step 2: Deseed default config**

In `sessionStore.ts:271` change `DEFAULT_CONFIG`:

```ts
export const DEFAULT_CONFIG: SessionConfig = { llmProvider: 'deepseek', model: '', tools: [] }
```

(`thinking` removed from the seed — runtime model comes from the active model; the field stays optional in the type for back-compat.)

- [ ] **Step 3: Implement `providersStore.ts`**

```ts
// src/store/providersStore.ts
import { create } from 'zustand'
import type { ProvidersConfig } from '@hip/protocol'
import { fetchCatalog, isCompatible, type Catalog, type CatalogProvider } from '@/ipc/catalog'
import { getProvidersConfig, setProvidersConfig } from '@/ipc/providersConfig'
import { isProviderKeyConfigured, saveProviderKey, clearProviderKey, restartSidecar } from '@/ipc/secrets'
import { sessionService } from '@/domain/sessionService'

interface ProvidersStore {
  catalog: Catalog
  config: ProvidersConfig
  keyConfigured: Record<string, boolean>
  loaded: boolean
  load: () => Promise<void>
  saveKey: (providerID: string, value: string) => Promise<void>
  clearKey: (providerID: string) => Promise<void>
  setBaseURL: (providerID: string, baseURL: string) => Promise<void>
  addCustom: (providerID: string, name: string, baseURL: string, modelIDs: string[]) => Promise<void>
  setActiveModel: (providerID: string, modelID: string) => Promise<void>
}

/** Merge user `custom` providers into the catalog so the list renders them too. */
function mergeCustom(catalog: Catalog, config: ProvidersConfig): Catalog {
  const out: Catalog = { ...catalog }
  for (const [id, entry] of Object.entries(config.providers)) {
    if (entry.custom && !out[id]) {
      out[id] = { id, name: entry.custom.name, env: [], models: {}, custom: true, api: entry.baseURL }
    }
  }
  return out
}

function resolveBaseURL(p: CatalogProvider | undefined, config: ProvidersConfig, id: string): string {
  return config.providers[id]?.baseURL ?? p?.api ?? ''
}

export const useProvidersStore = create<ProvidersStore>((set, get) => ({
  catalog: {},
  config: { providers: {} },
  keyConfigured: {},
  loaded: false,

  load: async () => {
    const [catalogRaw, config] = await Promise.all([fetchCatalog(), getProvidersConfig()])
    const catalog = mergeCustom(catalogRaw, config)
    const ids = Object.keys(catalog).filter((id) => isCompatible(catalog[id]))
    const flags = await Promise.all(ids.map((id) => isProviderKeyConfigured(id).then((c) => [id, c] as const)))
    set({ catalog, config, keyConfigured: Object.fromEntries(flags), loaded: true })
  },

  saveKey: async (providerID, value) => {
    await saveProviderKey(providerID, value)
    // Enable + persist so spawn injects this key, then restart to pick it up.
    const config = get().config
    const next: ProvidersConfig = {
      ...config,
      providers: {
        ...config.providers,
        [providerID]: {
          ...config.providers[providerID],
          enabled: true,
          baseURL: resolveBaseURL(get().catalog[providerID], config, providerID),
        },
      },
    }
    await setProvidersConfig(next)
    await restartSidecar()
    set((s) => ({ config: next, keyConfigured: { ...s.keyConfigured, [providerID]: true } }))
  },

  clearKey: async (providerID) => {
    await clearProviderKey(providerID)
    await restartSidecar()
    set((s) => ({ keyConfigured: { ...s.keyConfigured, [providerID]: false } }))
  },

  setBaseURL: async (providerID, baseURL) => {
    const config = get().config
    const next: ProvidersConfig = {
      ...config,
      providers: { ...config.providers, [providerID]: { ...config.providers[providerID], enabled: config.providers[providerID]?.enabled ?? false, baseURL } },
    }
    await setProvidersConfig(next)
    set({ config: next })
  },

  addCustom: async (providerID, name, baseURL, modelIDs) => {
    const config = get().config
    const next: ProvidersConfig = {
      ...config,
      providers: { ...config.providers, [providerID]: { enabled: true, baseURL, custom: { name } } },
    }
    await setProvidersConfig(next)
    set((s) => ({
      config: next,
      catalog: {
        ...s.catalog,
        [providerID]: { id: providerID, name, env: [], custom: true, api: baseURL, models: Object.fromEntries(modelIDs.map((m) => [m, { id: m, name: m }])) },
      },
    }))
  },

  setActiveModel: async (providerID, modelID) => {
    const config = get().config
    const baseURL = resolveBaseURL(get().catalog[providerID], config, providerID)
    const next: ProvidersConfig = { ...config, activeModel: { providerID, modelID } }
    await setProvidersConfig(next)
    sessionService.setActiveModel(providerID, modelID, baseURL)
    set({ config: next })
  },
}))
```

- [ ] **Step 4: Type-check**

Run: `yarn type-check`
Expected: still FAIL only in `GeneralSettings.tsx` (Task 12 fixes it). Stage:

```bash
git add src/store/providersStore.ts src/domain/sessionService.ts src/domain/sessionStore.ts
```

(Commit at the Task 12 boundary, when type-check is green.)

---

# Phase 4 — Frontend UI

### Task 11: i18n keys (3 locales)

**Files:**
- Modify: `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, `src/i18n/en.ts` (the `settings:` object)

- [ ] **Step 1: Add `settings.model` + `settings.modelConfig.*` to each locale**

In `src/i18n/zh-CN.ts`, inside `settings: { … }`, add `model` and a `modelConfig` block (the `apiKey*` keys can stay; they're now used by the model page):

```ts
      model: '模型配置',
      modelConfig: {
        currentModel: '当前模型',
        searchProviders: '搜索提供商',
        addCustom: '添加自定义提供商',
        notConfigured: '未配置',
        configured: '已配置',
        incompatible: '非 OpenAI 兼容，暂不支持',
        apiKey: 'API Key',
        keyStored: '已配置 · 存于系统钥匙串',
        baseUrl: 'Base URL',
        models: '模型 · 来自 models.dev',
        current: '当前',
        setCurrent: '设为当前',
        reasoning: '推理',
        tools: '工具',
        save: '保存',
        change: '更换',
        clear: '清除',
        error: '操作失败，请重试。',
        customName: '名称',
        customModels: '模型 id（逗号分隔）',
        addProvider: '添加',
      },
```

In `src/i18n/en.ts` add the same shape with English values (`model: 'Model Configuration'`, `currentModel: 'Current model'`, `searchProviders: 'Search providers'`, `addCustom: 'Add custom provider'`, `notConfigured: 'Not configured'`, `configured: 'Configured'`, `incompatible: 'Not OpenAI-compatible — unsupported'`, `apiKey: 'API Key'`, `keyStored: 'Configured · stored in system keychain'`, `baseUrl: 'Base URL'`, `models: 'Models · from models.dev'`, `current: 'Current'`, `setCurrent: 'Set as current'`, `reasoning: 'Reasoning'`, `tools: 'Tools'`, `save: 'Save'`, `change: 'Change'`, `clear: 'Clear'`, `error: 'Action failed. Please try again.'`, `customName: 'Name'`, `customModels: 'Model ids (comma-separated)'`, `addProvider: 'Add'`).

In `src/i18n/zh-TW.ts` add the same shape with Traditional values (`model: '模型配置'`, `currentModel: '當前模型'`, `searchProviders: '搜尋提供商'`, `addCustom: '新增自訂提供商'`, `notConfigured: '未設定'`, `configured: '已設定'`, `incompatible: '非 OpenAI 相容，暫不支援'`, `apiKey: 'API Key'`, `keyStored: '已設定 · 儲存於系統鑰匙串'`, `baseUrl: 'Base URL'`, `models: '模型 · 來自 models.dev'`, `current: '當前'`, `setCurrent: '設為當前'`, `reasoning: '推理'`, `tools: '工具'`, `save: '儲存'`, `change: '更換'`, `clear: '清除'`, `error: '操作失敗，請重試。'`, `customName: '名稱'`, `customModels: '模型 id（逗號分隔）'`, `addProvider: '新增'`).

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: still only the `GeneralSettings.tsx` error. Stage:

```bash
git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
```

### Task 12: Split API key out of 通用设置

**Files:**
- Modify: `src/components/account/GeneralSettings.tsx`

- [ ] **Step 1: Reduce `GeneralSettings.tsx` to language-only**

Replace the whole file with:

```tsx
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

const LANGUAGE_KEYS = ['zh-CN', 'zh-TW', 'en'] as const
type LanguageKey = (typeof LANGUAGE_KEYS)[number]

export function GeneralSettings() {
  const { t, i18n } = useTranslation()
  const currentLang: LanguageKey = LANGUAGE_KEYS.includes(i18n.language as LanguageKey)
    ? (i18n.language as LanguageKey)
    : LANGUAGE_KEYS[0]

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="text-prose font-medium text-ink">{t('settings.language')}</div>
          <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.languageDesc')}</div>
        </div>
        <div className="relative ml-4 shrink-0">
          <select
            value={currentLang}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="cursor-pointer appearance-none rounded-md border border-border bg-surface py-1.5 pl-2.5 pr-8 text-body text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/60"
          >
            {LANGUAGE_KEYS.map((lang) => (
              <option key={lang} value={lang}>
                {t(`settings.languages.${lang}`)}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check (now green)**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit the secrets/store/i18n/general batch**

```bash
git add src/ipc/secrets.ts src/store/providersStore.ts src/domain/sessionService.ts src/domain/sessionStore.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts src/components/account/GeneralSettings.tsx
git commit -m "feat(ui): per-provider secrets, providers store, active-model service, language-only 通用设置"
```

### Task 13: The 模型配置 page

**Files:**
- Create: `src/components/account/ModelConfig.tsx`

- [ ] **Step 1: Implement the page (list + detail)**

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, Search, Plus, Ban, Check } from 'lucide-react'
import { useProvidersStore } from '@/store/providersStore'
import { isCompatible, type CatalogProvider } from '@/ipc/catalog'
import { cn } from '@/lib/utils'

export function ModelConfig() {
  const { t } = useTranslation()
  const { catalog, config, keyConfigured, loaded, load, saveKey, clearKey, setActiveModel } = useProvidersStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => { void load() }, [load])

  const providers = Object.values(catalog)
    .filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => Number(isCompatible(b)) - Number(isCompatible(a)) || a.name.localeCompare(b.name))

  const activeId = selected ?? config.activeModel?.providerID ?? providers.find((p) => isCompatible(p))?.id ?? null
  const active = activeId ? catalog[activeId] : undefined
  const am = config.activeModel
  const activeModelMeta = am ? catalog[am.providerID]?.models[am.modelID] : undefined

  if (!loaded) return <div className="px-6 py-5 text-meta text-ink-tertiary">…</div>

  return (
    <div className="flex flex-col px-5 py-4">
      {/* Current model */}
      <div className="mb-4 flex items-center justify-between rounded-md bg-surface-subtle px-3.5 py-2.5">
        <div>
          <div className="text-meta text-ink-tertiary">{t('settings.modelConfig.currentModel')}</div>
          <div className="text-body font-medium text-ink">
            {am ? `${catalog[am.providerID]?.name ?? am.providerID} · ${am.modelID}` : '—'}
          </div>
        </div>
        {activeModelMeta?.reasoning && (
          <span className="rounded-full bg-accent-active px-2 py-0.5 text-caption text-accent-strong">{t('settings.modelConfig.reasoning')}</span>
        )}
      </div>

      <div className="flex min-h-[270px] gap-3.5">
        {/* Provider list */}
        <div className="w-[158px] shrink-0 overflow-hidden rounded-md border border-border">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
            <Search size={13} className="text-ink-tertiary" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('settings.modelConfig.searchProviders')}
              className="w-full bg-transparent text-meta text-ink placeholder:text-ink-tertiary focus:outline-none"
            />
          </div>
          {providers.map((p) => {
            const compat = isCompatible(p)
            return (
              <button
                key={p.id}
                disabled={!compat}
                onClick={() => setSelected(p.id)}
                className={cn(
                  'flex w-full items-center justify-between px-2.5 py-2 text-left text-body transition-colors',
                  compat ? 'hover:bg-surface-muted' : 'cursor-not-allowed opacity-55',
                  p.id === activeId && 'bg-accent-active',
                )}
              >
                <span className={cn('flex items-center gap-2 truncate', p.id === activeId ? 'font-medium text-accent-strong' : 'text-ink-secondary')}>
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-surface-muted text-caption text-ink-secondary">
                    {p.name.charAt(0)}
                  </span>
                  <span className="truncate">{p.name}</span>
                </span>
                {!compat ? <Ban size={13} className="shrink-0 text-ink-tertiary" />
                  : keyConfigured[p.id] ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                  : <span className="shrink-0 text-caption text-ink-tertiary">{t('settings.modelConfig.notConfigured')}</span>}
              </button>
            )
          })}
          <div className="flex items-center gap-1.5 border-t border-border px-2.5 py-2 text-body text-accent-strong">
            <Plus size={14} /> {t('settings.modelConfig.addCustom')}
          </div>
        </div>

        {/* Detail */}
        <div className="min-w-0 flex-1">
          {active ? <ProviderDetail provider={active}
            configured={!!keyConfigured[active.id]}
            isActive={(modelID) => am?.providerID === active.id && am?.modelID === modelID}
            onSaveKey={(v) => saveKey(active.id, v)}
            onClearKey={() => clearKey(active.id)}
            onSetCurrent={(modelID) => setActiveModel(active.id, modelID)} />
            : <div className="text-meta text-ink-tertiary">…</div>}
        </div>
      </div>
    </div>
  )
}

function ProviderDetail({ provider, configured, isActive, onSaveKey, onClearKey, onSetCurrent }: {
  provider: CatalogProvider
  configured: boolean
  isActive: (modelID: string) => boolean
  onSaveKey: (value: string) => Promise<void>
  onClearKey: () => Promise<void>
  onSetCurrent: (modelID: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn(); setValue('') }
    catch (e) { console.error('[modelConfig]', e); setError(t('settings.modelConfig.error')) }
    finally { setBusy(false) }
  }

  return (
    <>
      <div className="mb-1 text-meta text-ink-tertiary">{t('settings.modelConfig.apiKey')}</div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-..."
          className="h-8 flex-1 rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60"
        />
        <button onClick={() => run(() => onSaveKey(value.trim()))} disabled={busy || !value.trim()}
          className="h-8 rounded-md bg-accent px-3 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-40">
          {configured ? t('settings.modelConfig.change') : t('settings.modelConfig.save')}
        </button>
        <button onClick={() => run(onClearKey)} disabled={busy || !configured}
          className="h-8 rounded-md border border-border px-3 text-body text-ink-secondary hover:bg-surface-muted disabled:opacity-40">
          {t('settings.modelConfig.clear')}
        </button>
      </div>
      {configured && <div className="mt-1 text-meta text-success"><Check size={12} className="-mt-0.5 mr-0.5 inline" />{t('settings.modelConfig.keyStored')}</div>}
      {error && <div className="mt-1 text-meta text-danger">{error}</div>}

      <div className="mt-4 mb-1 text-meta text-ink-tertiary">{t('settings.modelConfig.baseUrl')}</div>
      <div className="flex h-8 items-center rounded-md border border-border bg-surface px-2.5 font-mono text-meta text-ink-secondary">
        {provider.api ?? '—'}
      </div>

      <div className="mt-4 mb-1.5 text-meta text-ink-tertiary">{t('settings.modelConfig.models')}</div>
      <div className="flex flex-col gap-1.5">
        {Object.values(provider.models).map((m) => {
          const current = isActive(m.id)
          return (
            <button key={m.id} onClick={() => void run(() => onSetCurrent(m.id))}
              className={cn('flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left',
                current ? 'border-accent bg-accent-active' : 'border-border hover:bg-surface-muted')}>
              <div className="min-w-0 flex-1">
                <div className={cn('text-body', current && 'font-medium text-accent-strong')}>{m.name}</div>
                <div className="mt-0.5 flex gap-1.5">
                  {m.limit?.context && <span className="rounded bg-surface px-1.5 text-caption text-ink-secondary">{Math.round(m.limit.context / 1000)}K</span>}
                  {m.reasoning && <span className="rounded bg-surface px-1.5 text-caption text-ink-secondary">{t('settings.modelConfig.reasoning')}</span>}
                  {m.tool_call && <span className="rounded bg-surface px-1.5 text-caption text-ink-secondary">{t('settings.modelConfig.tools')}</span>}
                </div>
              </div>
              <span className="shrink-0 text-caption text-accent-strong">
                {current ? t('settings.modelConfig.current') : t('settings.modelConfig.setCurrent')}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}
```

(YAGNI for this task: the "添加自定义提供商" footer is a non-functional affordance here; wiring its form to `providersStore.addCustom` is Task 16. The store method already exists.)

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/ModelConfig.tsx
git commit -m "feat(ui): 模型配置 page — provider list + key/baseURL/model detail"
```

### Task 14: Register the page in settings

**Files:**
- Modify: `src/components/account/SettingsPanel.tsx:1` (import), `:7` (PAGES)

- [ ] **Step 1: Register `ModelConfig`**

Add the imports at the top of `SettingsPanel.tsx` (alongside the existing lucide import and `GeneralSettings` import):

```ts
import { SlidersHorizontal, Cpu } from 'lucide-react'
import { ModelConfig } from './ModelConfig'
```

Replace the `PAGES` array (`:7`) with:

```ts
const PAGES = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
  { id: 'model', icon: Cpu, labelKey: 'settings.model', Component: ModelConfig },
] as const
```

- [ ] **Step 2: Type-check + build the frontend**

Run: `yarn type-check && yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/SettingsPanel.tsx
git commit -m "feat(ui): register 模型配置 settings page"
```

### Task 15: Retire the 深度思考 toggle

**Files:**
- Modify: `src/components/chat/Composer.tsx:13-15,25-27,32,48-61` (remove the toggle chip + props), `src/components/chat/InputBar.tsx:33-35` (drop the props), `src/components/chat/NewConversation.tsx:26` (drop `thinking thinkingDisabled`)

- [ ] **Step 1: Remove the toggle from `Composer.tsx`**

Read `Composer.tsx`. Delete the `ComposerChip` toggle block that renders `data-testid="thinking-toggle"` (the `<ComposerChip … onClick={() => onToggleThinking?.(!thinking)} … >` element and its surrounding wrapper if it becomes empty). Remove the `thinking`, `onToggleThinking`, `thinkingDisabled` props from the component's props type and destructuring, and the now-unused `toggleDisabled` computation. Keep everything else (the textarea, submit, any style-picker chip).

- [ ] **Step 2: Drop the props at the call sites**

In `InputBar.tsx` remove the `thinking={thinking}`, `thinkingDisabled={…}`, `onToggleThinking={…}` lines (`:33-35`) and the `const thinking = …` line (`:12`).
In `NewConversation.tsx:26` remove `thinking thinkingDisabled` from the `<Composer … />`.

- [ ] **Step 3: Type-check + build**

Run: `yarn type-check && yarn build`
Expected: PASS. (`sessionService.setThinking` and the `session:setThinking` protocol message remain defined but are now unused — left intentionally for back-compat; `sessionStore.test.ts`'s `session:thinking` reducer test still passes.)

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/Composer.tsx src/components/chat/InputBar.tsx src/components/chat/NewConversation.tsx
git commit -m "feat(chat): retire 深度思考 toggle — reasoning auto-shows for reasoning models"
```

### Task 16: Add-custom-provider form

**Files:**
- Modify: `src/components/account/ModelConfig.tsx` (wire the footer to a small inline form)

- [ ] **Step 1: Make the footer open an inline form**

In `ModelConfig.tsx`, add `const [adding, setAdding] = useState(false)` and change the footer `<div>…添加自定义提供商</div>` to a `<button onClick={() => setAdding(true)}>`. When `adding`, render `<AddCustomProvider onDone={(id) => { setAdding(false); setSelected(id) }} onCancel={() => setAdding(false)} />` in place of the detail pane. Add the component:

```tsx
function AddCustomProvider({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const addCustom = useProvidersStore((s) => s.addCustom)
  const [name, setName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [key, setKey] = useState('')
  const [models, setModels] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!id || !baseURL.trim()) return
    setBusy(true)
    try {
      const ids = models.split(',').map((m) => m.trim()).filter(Boolean)
      await addCustom(id, name.trim(), baseURL.trim(), ids)
      if (key.trim()) await useProvidersStore.getState().saveKey(id, key.trim())
      onDone(id)
    } finally { setBusy(false) }
  }

  const field = 'h-8 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'
  return (
    <div className="flex flex-col gap-2">
      <input className={field} placeholder={t('settings.modelConfig.customName')} value={name} onChange={(e) => setName(e.target.value)} />
      <input className={field} placeholder={t('settings.modelConfig.baseUrl')} value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
      <input className={field} type="password" placeholder="sk-..." value={key} onChange={(e) => setKey(e.target.value)} />
      <input className={field} placeholder={t('settings.modelConfig.customModels')} value={models} onChange={(e) => setModels(e.target.value)} />
      <div className="flex gap-2">
        <button onClick={() => void submit()} disabled={busy || !name.trim() || !baseURL.trim()}
          className="h-8 rounded-md bg-accent px-3 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-40">
          {t('settings.modelConfig.addProvider')}
        </button>
        <button onClick={onCancel} className="h-8 rounded-md border border-border px-3 text-body text-ink-secondary hover:bg-surface-muted">
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check + build**

Run: `yarn type-check && yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/ModelConfig.tsx
git commit -m "feat(ui): add custom OpenAI-compatible provider form"
```

---

# Phase 5 — Whole-suite verification + acceptance

### Task 17: Full automated suite

- [ ] **Step 1: Run every unit test**

Run: `yarn test`
Expected: PASS — including the new `providers.test.ts`, `catalog.test.ts`, `providersConfig.test.ts`, and all pre-existing suites.

- [ ] **Step 2: Rust tests**

Run: `cd src-tauri && cargo test`
Expected: PASS.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A
git commit -m "test: green model-config unit + rust suites" --allow-empty
```

### Task 18: GUI acceptance (live LLM, manual)

> Live-LLM paths are GUI-accepted per project preference — do NOT add tests that hit a real API. Run the app with `yarn tauri dev`.

- [ ] **Step 1:** Open 设置 → 模型配置. Confirm DeepSeek shows 已配置 + its current model is `deepseek-reasoner` (existing key migrated, no change for the user). Anthropic/Gemini render greyed with the ban icon.
- [ ] **Step 2:** Add an OpenAI (or a custom OpenAI-compatible) key, set one of its models as 当前, send a chat message, and confirm the reply routes to the new provider **without restarting the app**.
- [ ] **Step 3:** Switch back to DeepSeek's `deepseek-reasoner`; confirm reasoning still renders inline (auto, no toggle present in the composer).
- [ ] **Step 4:** Clear a provider's key; confirm the NO_API_KEY state returns when that provider is active.

### Task 19: E2E smoke (non-LLM)

> Mind the known gotcha: keychain re-auth can block `spawn_sidecar` after a rebuild (see memory `e2e-gui-launch-gotchas`). Use a dummy key; no paid calls.

- [ ] **Step 1:** Add/extend a wdio spec: open settings, switch to the 模型配置 tab, type a dummy key into a provider, 保存, and assert the status flips to 已配置. Reopen settings and assert persistence.

Run: `yarn test:e2e`
Expected: the new spec passes green and makes no paid LLM call.

- [ ] **Step 2: Commit**

```bash
git add e2e
git commit -m "test(e2e): 模型配置 save-key + persistence smoke"
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** every spec section maps to a task — catalog/Rust fetch (Task 5) + compat gate (Task 8); per-provider keychain (Task 7) + multi-key injection (Task 6); `hip-providers.json` (Task 9) + spawn/sidecar reads (Tasks 1, 6); provider-aware build + no-restart switch (Tasks 2, 3, 10); UI page + registry + custom (Tasks 13, 14, 16); 通用设置 split (Task 12); 深度思考 retirement (Task 15); migration default (Task 9 `withDefaults` + Task 6 deepseek fallback); i18n (Task 11); verification (Tasks 17-19).
- **Type consistency:** `providerKeyEnv` (protocol) is reused by `secrets.ts` (TS) and `providers.ts` (TS) and mirrored by Rust `provider_key_env`; `ProvidersConfig`/`ActiveModel` come from `@hip/protocol` everywhere; the `config:setActiveModel` payload `{providerID, modelID, baseURL}` matches sender (`sessionService.setActiveModel`) and handler (`session-manager`).
- **No placeholders:** the only deferred-by-design item is the bundled `models-snapshot.json` content (a generated artifact — Task 4 ships a working minimal one and notes refreshing it from the live command).
```
