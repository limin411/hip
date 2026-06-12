# 模型配置: multi-provider model-config settings page

Date: 2026-06-12
Status: approved (design), pending implementation

## Problem

hip is hardwired to DeepSeek end to end. The sidecar's `buildModel()` always
constructs `new ReasoningChatOpenAI({ baseURL: 'https://api.deepseek.com/v1',
apiKey: process.env.HIP_MODEL_DEEPSEEK_API_KEY, … })`
([`packages/sidecar/src/session/session.ts:137`](../../../packages/sidecar/src/session/session.ts)),
`SessionConfig.llmProvider` is the literal `'deepseek'`
([`packages/protocol/src/index.ts:4`](../../../packages/protocol/src/index.ts)),
and there is exactly one keychain entry `HIP_MODEL_DEEPSEEK_API_KEY`. The only
place a user can touch a model setting is the single API-key field in 通用设置.

We want a new **模型配置** page inside the settings modal that lets the user
configure multiple LLM providers (key, base URL, model) and pick one **global
current model** the whole app uses, modelled on OpenCode's provider business
logic (a live `models.dev` catalog + per-provider credentials), adapted to hip's
much smaller surface.

## Decisions (from brainstorming)

1. **Scope = multi-provider + global model switch.** The page configures many
   providers; the app uses a single global *current model*. Per-conversation
   model switching is explicitly deferred.
2. **Execution = OpenAI-compatible only, via the existing `ChatOpenAI`.** Every
   provider is reached by swapping `baseURL` / `apiKey` / `model`. Plus arbitrary
   **custom OpenAI-compatible endpoints** (covers local Ollama / self-host / any
   new vendor). Anthropic / Gemini native SDKs are **not** added.
3. **Catalog = models.dev, fetched Rust-side.** A new Tauri command fetches
   `https://models.dev/api.json`, caches it on disk with a TTL, and falls back to
   a bundled snapshot offline. The catalog is discovery/metadata only.
4. **深度思考 toggle is retired.** The chosen model *is* the model. Reasoning is
   surfaced automatically for reasoning-capable models (models.dev `reasoning:
   true`); there is no per-session reasoning toggle.

## Scope

- **In scope (frontend):** a new `ModelConfig` settings page (provider list +
  detail: key / base URL / models picker + "set as current"), an "添加自定义提供商"
  flow, a providers store, catalog + providers-config IPC wrappers, splitting the
  API-key block out of 通用设置, removing the 深度思考 toggle control.
- **In scope (protocol):** widen `SessionConfig.llmProvider` to `string`, add
  optional `baseURL`, add a `config:setActiveModel` client message and a
  `config:activeModel` echo.
- **In scope (sidecar):** provider-aware `buildModel()` / title generator;
  read the providers config + per-provider keys; honour `config:setActiveModel`
  live (no restart); NO_API_KEY guard keys off the active provider.
- **In scope (Tauri/Rust):** `models_catalog`, `get_providers_config`,
  `set_providers_config` commands; multi-key injection at sidecar spawn; bundled
  catalog snapshot.

## Non-goals

- No per-conversation / per-session model picker (the composer / chat header is
  untouched). The active model is global.
- No native Anthropic / Gemini / Bedrock / Vertex execution. Those appear in the
  catalog but render disabled ("非 OpenAI 兼容").
- No OAuth provider auth, no "test connection" probe, no model variants / cost
  accounting beyond display badges, no plugin architecture (OpenCode has all of
  these; out of scope here).
- No migration of existing sessions' stored config — they follow the global
  active model automatically (see Migration).
- No new `.tsx` test harness (repo has none; vitest runs in `node`). Live-LLM
  paths are GUI-accepted, per project preference.

## Design

### Architecture / data flow

```
models.dev/api.json ──(Rust: models_catalog → fetch + disk cache + bundled snapshot)──► renderer
                                                                                          │
ModelConfig page ──► providers config (non-secret) ─── hip-providers.json (app_data_dir)
        │                 { providers: {…}, activeModel: {providerID, modelID} }
        │                 read by:  renderer (via get/set_providers_config)
        │                           Rust spawn (to know which keys to inject)
        │                           sidecar (HIP_PROVIDERS_PATH, for baseURL + initial active)
        ├──► key change ──► keychain  HIP_MODEL_<PROVIDER>_API_KEY  ──► restart_sidecar (re-inject env)
        └──► model change ─► config:setActiveModel {providerID, modelID, baseURL} ──► sidecar (no restart)

sidecar.buildModel(): activeModel → { baseURL, modelID, process.env[HIP_MODEL_<ID>_API_KEY] } → ChatOpenAI
```

Two sources of truth, cleanly split: **secrets live only in the keychain**;
**everything non-secret lives in `hip-providers.json`**; **the catalog is
read-only and owned by models.dev** (mirrored to a local cache + bundled
snapshot). The renderer holds in-memory caches of both, hydrated on open.

### Data model

**A. Catalog (read-only, from models.dev).** Shapes mirror the models.dev API so
parsing is a near pass-through:

```ts
// src/ipc/catalog.ts  (and the sidecar's lightweight reader)
interface CatalogProvider {
  id: string
  name: string
  env: string[]
  npm?: string            // e.g. '@ai-sdk/openai', '@ai-sdk/anthropic'
  api?: string            // default base URL
  models: Record<string, CatalogModel>
}
interface CatalogModel {
  id: string
  name: string
  family?: string
  reasoning: boolean
  tool_call: boolean
  attachment: boolean
  cost?: { input: number; output: number }
  limit: { context: number; output: number }
  modalities?: { input: string[]; output: string[] }
}
type Catalog = Record<string /*providerID*/, CatalogProvider>
```

**B. Providers config (read/write, our file `hip-providers.json`).** Keys are
**never** stored here — only in the keychain:

```ts
// src/ipc/providersConfig.ts  +  packages/sidecar/src/config/providers.ts
interface ProvidersConfig {
  providers: Record<string, {
    enabled: boolean
    baseURL?: string                 // override models.dev default; required for custom
    custom?: { name: string }        // present iff a user-defined provider (not in catalog)
  }>
  activeModel?: { providerID: string; modelID: string }
}
```

**C. Protocol change** ([`packages/protocol/src/index.ts`](../../../packages/protocol/src/index.ts)):

```ts
interface SessionConfig {
  llmProvider: string            // was: 'deepseek' literal → now provider id
  model: string
  baseURL?: string               // NEW: resolved base URL for the provider
  tools: string[]
  systemPrompt?: string
  cwd?: string
  thinking?: boolean             // DEPRECATED: kept optional for back-compat; no longer swaps models
  language?: 'en' | 'zh-CN' | 'zh-TW'
}

// ClientMessage  (add)
| { type: 'config:setActiveModel'; providerID: string; modelID: string; baseURL: string }
// ServerMessage  (add)
| { type: 'config:activeModel'; providerID: string; modelID: string }
// ready stays { hasApiKey } — now meaning "the ACTIVE provider has a key"
```

### Catalog: Rust fetch + cache + snapshot + compatibility gate

- **`models_catalog()` Tauri command** ([`src-tauri/src/lib.rs`](../../../src-tauri/src/lib.rs)):
  GET `https://models.dev/api.json` (reqwest), write the body to
  `app_data_dir/models.json`, return it. On any network/parse failure, return the
  on-disk cache; if that's missing too, return the **bundled snapshot**
  (`src-tauri/resources/models-snapshot.json`, shipped as a Tauri resource).
  TTL ~24h: if the cache is fresh, skip the network. (Override URL via
  `HIP_MODELS_URL` for tests, mirroring OpenCode's `OPENCODE_MODELS_URL`.)
- **Compatibility gate (renderer side).** models.dev includes non-OpenAI vendors.
  A provider is *runnable* iff: `npm ∈ {'@ai-sdk/openai', '@ai-sdk/openai-compatible'}`
  **OR** it is on a small hip-side allowlist (`deepseek, openai, openrouter, groq,
  moonshotai, zhipuai, siliconflow, mistral, xai, togetherai, deepinfra,
  fireworks, perplexity, ollama, lmstudio`) **OR** it is a user `custom` provider
  (always runnable; user supplies the base URL). Non-runnable providers render
  disabled with the tooltip "非 OpenAI 兼容，暂不支持". The allowlist + npm check
  live in one `isCompatible(provider)` helper so the rule is in one place.

### Secrets: per-provider keychain keys

The existing `set_secret` / `get_secret` / `has_secret` / `delete_secret`
commands are already keyed by an arbitrary string
([`src-tauri/src/lib.rs:66-94`](../../../src-tauri/src/lib.rs)), so multi-provider
keys need **no new Rust** for storage. `src/ipc/secrets.ts` is generalised from
the hardcoded `DEEPSEEK_KEY`:

```ts
const norm = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]/g, '_')
export const providerKeyName = (id: string) => `HIP_MODEL_${norm(id)}_API_KEY`
export const isProviderKeyConfigured = (id: string) => invoke<boolean>('has_secret', { key: providerKeyName(id) })
export const saveProviderKey = (id: string, value: string) => invoke<void>('set_secret', { key: providerKeyName(id), value })
export const clearProviderKey  = (id: string) => invoke<void>('delete_secret', { key: providerKeyName(id) })
export const restartSidecar = () => invoke<number>('restart_sidecar')   // unchanged
```

The existing `HIP_MODEL_DEEPSEEK_API_KEY` record is exactly what
`providerKeyName('deepseek')` produces — so the current user's key is reused
untouched.

### Persistence: `hip-providers.json`

A single JSON file at `app_data_dir/hip-providers.json`, accessed three ways:

- **Renderer** via two new Tauri commands `get_providers_config() -> String` and
  `set_providers_config(json: String)` (read/write the file, creating the dir).
- **Rust at spawn** reads it to enumerate configured providers (for key
  injection) and passes its path to the sidecar.
- **Sidecar** reads it via `HIP_PROVIDERS_PATH` for per-provider `baseURL` and the
  initial `activeModel`.

The file is the durable source of truth; the renderer keeps an in-memory
zustand mirror (`providersStore`) hydrated on settings open.

### Sidecar integration + switching

- **Spawn (`src-tauri/src/sidecar.rs`).** `spawn_sidecar` is reworked: read
  `hip-providers.json`; for each provider with a keychain entry, inject
  `HIP_MODEL_<NORM(id)>_API_KEY=<key>`; also inject `HIP_PROVIDERS_PATH=<file>`.
  Keep the existing "inject empty to override inherited env" guard for the active
  provider so a cleared key truly disables it. `read_api_key()` generalises to
  `read_provider_key(id)`.
- **`buildModel()` (`packages/sidecar/src/session/session.ts`).** Becomes
  provider-aware:

  ```ts
  function activeKeyFor(providerID: string): string {
    return process.env[`HIP_MODEL_${norm(providerID)}_API_KEY`] || 'sk-missing'
  }
  function buildModel(config: SessionConfig): ChatOpenAI {
    return new ReasoningChatOpenAI({
      model: config.model,                       // explicit model id from active model
      apiKey: activeKeyFor(config.llmProvider),
      configuration: { baseURL: config.baseURL ?? 'https://api.deepseek.com/v1' },
    })
  }
  ```

  `resolveModel()` loses its deepseek defaulting — the model id is always explicit
  now. `ReasoningChatOpenAI` is kept verbatim: it already no-ops when a provider
  emits no `reasoning_content`, so reasoning display "just works" for
  reasoning-capable models and is silently absent otherwise. The title generator
  (`buildDefaultTitleGenerator`, `TITLE_MODEL`) follows the active provider's
  `baseURL` + key + active model id instead of hardcoded DeepSeek.
- **Live switch.** `session-manager` handles `config:setActiveModel` by updating a
  process-level "active model" ({providerID, modelID, baseURL}); the next turn
  (and new sessions) build with it. No restart. The sidecar echoes
  `config:activeModel`. The active model is **global** — every new turn uses it,
  regardless of a session's persisted `config.model`.
- **NO_API_KEY guard / `ready.hasApiKey`.** Both key off the *active* provider's
  env var rather than the DeepSeek one
  ([`packages/sidecar/src/server/ws-server.ts`](../../../packages/sidecar/src/server/ws-server.ts),
  session.ts guard).

### UI: `ModelConfig.tsx`

Registered as the second page in the settings registry
([`src/components/account/SettingsPanel.tsx:7`](../../../src/components/account/SettingsPanel.tsx)):

```ts
const PAGES = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
  { id: 'model',   icon: Cpu,               labelKey: 'settings.model',   Component: ModelConfig },
] as const
```

Page layout (master–detail; see the approved mockup):

- **Current-model card** (top): "当前模型 · DeepSeek · deepseek-reasoner", with a
  "推理" badge when the active model is reasoning-capable.
- **Provider list (left, ~158px):** filter box, then providers from the catalog
  (runnable first, then disabled non-compatible greyed with a ban icon), each row
  = initial-letter tile + name + status (绿点 已配置 / 未配置). Selected row uses the
  accent-active treatment. Footer "+ 添加自定义提供商".
- **Detail pane (right):** for the selected provider — API Key (password input;
  保存/更换 → `saveProviderKey` → `restartSidecar`; 清除 → `clearProviderKey` →
  restart; status line "已配置 · 存于系统钥匙串"); Base URL (default from
  catalog `api`, editable; required for custom); model list from the catalog for
  that provider, each row a radio with 上下文/成本/能力 badges and a "设为当前 / 当前"
  affordance that calls `setActiveModel`.
- **Add custom provider:** a small form (name, base URL, key, one or more model
  ids) → writes a `custom` entry into `ProvidersConfig` + its key to the keychain.

Reuse `Modal` / `Input` / `Button` and existing teal design tokens; all copy via
i18n.

State plumbing:

- **`src/store/providersStore.ts`** (new, zustand): holds `catalog`,
  `config: ProvidersConfig`, and selectors (runnable providers, active model,
  per-provider key-configured flags). Actions: `load()` (catalog +
  get_providers_config + per-provider `isProviderKeyConfigured`),
  `setEnabled` / `setBaseURL` / `addCustom` (persist via `set_providers_config`),
  `setActiveModel` (persist + `sessionService.setActiveModel()`),
  `saveKey` / `clearKey` (keychain + `restartSidecar`).
- **`SessionService.setActiveModel(providerID, modelID, baseURL)`** sends
  `config:setActiveModel`. `DEFAULT_CONFIG`
  ([`src/domain/sessionStore.ts:271`](../../../src/domain/sessionStore.ts)) and
  `createSession` ([`src/domain/sessionService.ts:88`](../../../src/domain/sessionService.ts))
  stop hardcoding `llmProvider:'deepseek'` and instead seed from the active model
  (provider / model / baseURL); the sidecar applies the global active model
  regardless, so this is mainly cosmetic correctness.

### 深度思考 retirement

- Remove the 深度思考 toggle control from the chat UI and stop sending
  `session:setThinking`. `resolveModel` no longer consults `thinking`.
- Reasoning display is driven purely by the model: `ReasoningChatOpenAI`'s
  re-projection + `reasoning:delta` events fire whenever the provider streams
  reasoning content. Reasoning-capable models therefore show thinking by default;
  non-reasoning models simply don't.
- `SessionConfig.thinking` and the `session:setThinking` protocol message are left
  in place (deprecated, unused by the UI) to avoid a wider blast radius; they can
  be removed in a later cleanup.

### Migration

- **Existing key:** `providerKeyName('deepseek') === 'HIP_MODEL_DEEPSEEK_API_KEY'`,
  so the current key is reused. On first run with no `hip-providers.json`: write a
  default config that marks `deepseek` enabled (if its key exists) and sets
  `activeModel = { providerID:'deepseek', modelID:'deepseek-reasoner' }`. Old users
  see no change.
- **Existing sessions:** not migrated; they follow the global active model.
- **通用设置:** the API-key block moves out of `GeneralSettings.tsx` into
  `ModelConfig`; 通用设置 keeps only 界面语言.

### i18n

Add `settings.model` + a `settings.modelConfig.*` sub-tree (provider, key, baseURL,
models, current, setCurrent, addCustom, configured/notConfigured, incompatible,
errors) to all three locales
([`src/i18n/zh-CN.ts`](../../../src/i18n/zh-CN.ts), `zh-TW.ts`, `en.ts`). The
existing `settings.apiKey*` strings move under the model page's namespace.

## Files

**Create**
- `src/components/account/ModelConfig.tsx` — the page (master-detail).
- `src/store/providersStore.ts` — catalog + config + key-status state.
- `src/ipc/catalog.ts` — `fetchCatalog()` (invokes `models_catalog`) + `isCompatible()`.
- `src/ipc/providersConfig.ts` — `get/setProvidersConfig()` wrappers + defaulting.
- `packages/sidecar/src/config/providers.ts` — read `HIP_PROVIDERS_PATH`, resolve
  active model + base URL, normalised key-env lookup.
- `src-tauri/resources/models-snapshot.json` — bundled catalog fallback.

**Modify**
- `src/components/account/SettingsPanel.tsx` — add the `model` page registry entry.
- `src/components/account/GeneralSettings.tsx` — remove the API-key block (→ ModelConfig); keep language.
- `src/ipc/secrets.ts` — generalise to per-provider key helpers.
- `src/domain/sessionService.ts` — add `setActiveModel`; deseed `'deepseek'` in `createSession`.
- `src/domain/sessionStore.ts` — `DEFAULT_CONFIG` no longer hardcodes deepseek/model; (optional) track active model from `config:activeModel`.
- chat UI — remove the 深度思考 toggle + its `setThinking` call.
- `packages/protocol/src/index.ts` — `SessionConfig` (`llmProvider:string`, `+baseURL`); add `config:setActiveModel` / `config:activeModel`.
- `packages/sidecar/src/session/session.ts` — provider-aware `buildModel` + title generator; `resolveModel` simplified; guard keys off active provider.
- `packages/sidecar/src/session/session-manager.ts` — handle `config:setActiveModel`; hold global active model.
- `packages/sidecar/src/server/ws-server.ts` — `ready.hasApiKey` from active provider.
- `src-tauri/src/sidecar.rs` — multi-key injection + `HIP_PROVIDERS_PATH`; `read_provider_key`.
- `src-tauri/src/lib.rs` — add `models_catalog`, `get_providers_config`, `set_providers_config`; register in `invoke_handler`.
- `src-tauri/Cargo.toml` — ensure `reqwest` (and the snapshot resource) available.

## Verification

- **Unit (vitest, node — no live API):** catalog parse + `isCompatible()` gate;
  `ProvidersConfig` read/write + default seeding/migration; sidecar
  `config/providers.ts` active-model + base-URL + key-env resolution;
  `buildModel` selects the right baseURL/key/model for a given active model;
  `providerKeyName` normalisation (e.g. `github-copilot → GITHUB_COPILOT`).
- **Rust:** `models_catalog` cache/snapshot fallback (with `HIP_MODELS_URL`
  pointed at a fixture); `get/set_providers_config` round-trip; multi-key
  injection reads the right keychain entries.
- **GUI acceptance (live LLM, manual):** open 模型配置; DeepSeek shows 已配置 +
  当前; add an OpenAI (or custom OpenAI-compatible) key, set its model as current,
  send one message and confirm it routes to the new provider without an app
  restart; clear a key and confirm the no-key state returns.
- **E2E (wdio+tauri, non-LLM):** open the page, save a dummy key → "已配置";
  switch current model; reopen settings and confirm persistence. Mind the known
  gotcha: keychain re-auth can block `spawn_sidecar` (see
  `e2e-gui-launch-gotchas`).

## Risks / notes

- **Catalog vs execution mismatch.** A models.dev provider can be OpenAI-shaped in
  the catalog yet reject our `ChatOpenAI` request (auth header quirks, path
  differences). The compatibility gate is best-effort; the base-URL override and
  custom-provider path are the escape hatches. Surface request errors clearly
  (the existing error card already handles a failed turn).
- **`models.dev` base URL normalisation.** Some `api` values omit the `/v1`
  `ChatOpenAI` expects. Resolve to a canonical chat-completions base in one helper;
  let the user override per provider.
- **Reasoning beyond DeepSeek.** `ReasoningChatOpenAI` is tuned to DeepSeek's
  `reasoning_content`. Other providers may expose reasoning differently or not at
  all; v1 only guarantees DeepSeek-quality reasoning display, gracefully degrading
  to none elsewhere. Acceptable for this scope.
- **Switch races.** A `config:setActiveModel` arriving mid-turn must not mutate the
  running turn's model — apply it to the *next* turn (same discipline as
  `session:setSystemPrompt`, which no-ops on a running turn).
- **Secrets never in the JSON.** Enforce in code review: `hip-providers.json` holds
  only enabled flags / base URLs / custom names / the active selection — never a
  key.
- **CJK + bash:** none of this touches shell scripts, but if any helper scripts are
  added, brace `${var}` before CJK punctuation (system bash is 3.2; see
  `bash32-cjk-var-bracing`).

## Follow-ups (deferred after the post-implementation review, 2026-06-12)

The feature shipped on branch `feat/model-config` (Ship-with-follow-ups). These known
gaps were deliberately deferred and should be picked up separately:

1. ~~**Per-provider Base URL override for catalog providers is read-only in v1.**~~ **DONE (2026-06-12).**
   The detail pane's Base URL is now an editable input wired to the store's `setBaseURL`
   (`ModelConfig.tsx` → `providersStore`); saving it does NOT clear the API-key draft, and editing
   the *active* provider's URL re-applies it live (`config:setActiveModel`, no restart). Custom
   providers still set their base URL at creation.
2. ~~**Incompatible active model isn't guarded sidecar-side.**~~ **DONE (2026-06-12).**
   The sidecar now blocklists native-only providers (`isOpenAICompatible()` in
   `packages/sidecar/src/config/providers.ts`) and `Session.requireCompatibleModel()`
   emits a clear `INCOMPATIBLE_MODEL` error before a turn runs (ahead of the
   `NO_API_KEY` guard), rather than letting `ChatOpenAI` fail opaquely against an
   incompatible endpoint. Blocklist (not allowlist) so npm-tagged OpenAI-compatible
   providers the renderer admits are never wrongly rejected.
3. ~~**`ready.hasApiKey` goes stale after a live model switch.**~~ **DONE (2026-06-12).**
   `config:setActiveModel` now re-emits the new active provider's key status: the
   `config:activeModel` server message carries `hasApiKey`, and `sessionStore.apply`
   updates the store from it (like `ready`), so the chat header's "no key" banner
   refreshes on a live switch without waiting for a reconnect.
