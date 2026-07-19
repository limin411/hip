# Spec: Surface-aware agent prompts (Chat / Code / Knowledge)

**Status:** Implemented (PR-1 + PR-2 core)  
**Date:** 2026-07-19  
**Bug:** In Chat surface conversations the agent self-describes as being in **edit mode** (or otherwise behaves like the Code coding agent), even though the user is in Chat.

### Implementation notes (2026-07-19)

- `packages/sidecar/src/session/agent-runtime-profile.ts` — single resolver + capability narratives + skill filter
- Wired into `buildSystemPrompt`, injectors, permission fragment, `buildAllTools`, `session-turn-runner` (`surfaceOf`)
- Chat excludes `hip-coding`, drops git/plugin/worktree tools, Chat identity + anti edit-mode copy
- Production path no longer registers `SkillsListInjector` (skills already in system prompt)
- Knowledge profile reserved; full Knowledge agent is still PR-3

---

## 1. Problem statement

hip has multiple **product surfaces** (Chat, Code, Knowledge). Each should present a distinct agent persona, tool policy, and system-prompt body.

Today the agent’s **self-description** is driven primarily by `permissionMode` (default **`edit`**), not by the user’s surface. Chat sessions are created with `surface: 'chat'` but inherit `permissionMode: 'edit'`, and the model is explicitly told:

```text
Current permission mode: edit.
```

Combined with a shared product capability map that defines `edit = project sandbox (default)`, models correctly infer “I am in edit mode” — which is true for the permission enum and false for the product experience the user is in.

---

## 2. Root cause analysis

### 2.1 Two orthogonal axes, one overloaded word

| Axis | Values | Purpose |
|------|--------|---------|
| **Surface** (`SessionConfig.surface`) | `chat` \| `code` | Product scenario / UI home / cwd kind |
| **Permission mode** (`SessionConfig.permissionMode`) | `chat` \| `edit` \| `full` | Tool capability gate |

Naming collision: **`permissionMode: 'chat'`** means *read-only tools*, not *Chat surface*. **`permissionMode: 'edit'`** means *sandbox write tools*, not *“you are the Code editor agent”*.

UI already separates them:

- Chat composer: **no** `PermissionModePicker` (see `InputBar` / `NewConversation`).
- Code composer: shows picker + plan/project chips.

### 2.2 Config creation leaves Chat on default `edit`

```ts
// configFromDraft — Chat branch
// sets surface: 'chat', does NOT set permissionMode
// DEFAULT_CONFIG = normalizeSessionConfig(...) ⇒ permissionMode: 'edit'
```

So every Chat session stores `permissionMode: 'edit'` unless something else rewrites it.

### 2.3 System prompt assembly mixes axes poorly

In `buildSystemPrompt` (`packages/sidecar/src/session/system-prompt.ts`):

```ts
const isChat = surface === 'chat' || permissionMode === 'chat'
const body = isChat ? BASE_CHAT : BASE
```

- Body can switch to `BASE_CHAT` when `surface === 'chat'` (good).
- **Always-on L0** still uses a project-centric identity + capability map that advertises “edit = default”.
- **cwd block** is driven only by `permissionMode` → Chat+edit gets “Filesystem tools are sandboxed to it” (Code-style), not a Chat sandbox framing.
- **Skills**: `hip-coding` is pinned for both surfaces.
- **Permission reminder** injectors always inject raw mode names.

### 2.4 Explicit “you are in edit mode” injection

Two parallel paths inject the same string:

1. `PermissionModeInjector` (`context-injector.ts`)  
   → `Current permission mode: ${permissionMode}.`
2. Fragment `createPermissionSource` (`fragments/permission.ts`)  
   → same text into system-context baseline.

With Chat’s default `edit`, the model is **literally instructed** that it is in edit mode.

### 2.5 Tools vs prompt (secondary mismatch)

`buildAllTools` keys only off `permissionMode` (not surface):

| permissionMode | write_file / edit_file | git / plugin_install | run_script |
|----------------|------------------------|----------------------|------------|
| `chat` | no | no | no |
| `edit` (default) | yes | yes (if cwd) | yes (if approval) |
| `full` | yes (un-jailed) | yes | yes |

Chat surface **wants** sandbox writes for artifacts (`BASE_CHAT` steers previewable deliverables to `write_file`). So Chat correctly needs write tools — but must **not** be narrated as “edit mode” / coding agent. Git / heavy coding skills are still inappropriate for pure Chat.

### 2.6 Surface resolution fallback

```ts
// session-turn-runner.ts
surface: host._config.surface === 'chat' ? 'chat' : 'code'
```

Missing / legacy `surface` collapses to **code**, which loads `BASE` (coding assistant). Prefer `surfaceOf(config, sessionId)` (scratch-cwd inference) everywhere.

### 2.7 Knowledge

Knowledge is a first-class UI surface (`activeView === 'knowledge'`) but **has no agent session surface** and no knowledge-grounded system prompt today. Out of scope for the P0 bugfix, but the profile matrix must reserve a slot so we do not paint ourselves into a `chat | code` corner.

---

## 3. Goals / non-goals

### Goals

1. **Chat never claims “edit mode”** (or Code coding-agent identity) when the user is on Chat surface.
2. **Code remains a full coding agent** with permission picker (`read-only` / `project sandbox` / `full FS`) — model-facing labels may rename; tool semantics stay.
3. **One resolution function** maps `(surface, permissionMode, …) → AgentRuntimeProfile` used by prompt, tools, skills, and injectors (single source of truth).
4. **Tests lock the contract**: Chat turn system text must not contain “edit mode” / coding BASE rules; Code+edit must still get coding BASE + write tools.
5. **Forward-compatible** with a future Knowledge agent profile without a second rewrite.

### Non-goals

- Redesigning Knowledge editor UX or shipping Knowledge-agent sessions in the same PR as the Chat fix.
- Renaming the on-wire `PermissionMode` enum values (`'chat' | 'edit' | 'full'`) in a breaking protocol change (optional later; model-facing copy can change without renames).
- Removing Chat artifact writes (`write_file` in Chat sandbox stays).
- Changing plan-mode / multi-agent graph architecture beyond profile filtering.

---

## 4. Design

### 4.1 Conceptual model

```
┌─────────────────────────────────────────────────────────────┐
│  Product Surface (scenario)                                 │
│  chat | code | knowledge (reserved)                         │
│  → persona, body, skills allowlist, git policy, identity    │
├─────────────────────────────────────────────────────────────┤
│  Permission / tool gate (capability)                        │
│  read_only | sandbox_write | full_fs                        │
│  (protocol today: chat | edit | full)                       │
│  → tool set, cwd jail wording, approval policy              │
├─────────────────────────────────────────────────────────────┤
│  Plan / other turn flags                                    │
│  forcePlan, planMode, …                                     │
└─────────────────────────────────────────────────────────────┘
```

**Rule:** Surface owns **who the agent is**. Permission owns **what the agent can touch**. Never let permission mode alone choose the product persona.

### 4.2 `AgentRuntimeProfile` (pure, testable)

New module (suggested path):

`packages/sidecar/src/session/agent-runtime-profile.ts`

```ts
export type ProductSurface = 'chat' | 'code' | 'knowledge'

export interface AgentRuntimeProfile {
  surface: ProductSurface
  /** Protocol permission mode after normalize. */
  permissionMode: PermissionMode
  /** Model-facing capability sentence — never the bare token "edit". */
  capabilityNarrative: string
  /** System prompt body (BASE_CHAT / BASE_CODE / BASE_KNOWLEDGE). */
  promptBody: 'chat' | 'code' | 'knowledge'
  includeGitGuidance: boolean
  includeMcpCatalog: boolean
  skillPolicy: {
    pinIds: string[]
    /** Drop from auto-invoke list even if installed. */
    excludeIds: string[]
  }
  toolPolicy: {
    allowWrites: boolean
    allowGit: boolean
    allowRunScript: boolean
    allowPluginInstall: boolean
    allowParallelWorktrees: boolean
    pathJail: 'sandbox' | 'none' | 'n/a'
  }
}
```

**Resolver:**

```ts
function resolveAgentRuntimeProfile(input: {
  surface?: 'chat' | 'code' | 'knowledge'
  permissionMode?: PermissionMode
  sessionId: string
  cwd?: string
  /** for legacy surface inference */
  hipRoot?: string
}): AgentRuntimeProfile
```

Resolution order:

1. `surface = surfaceOf(config, sessionId)` (explicit field wins; else scratch cwd → chat; else code). Knowledge only when explicitly set (future).
2. `permissionMode = normalize` (`undefined` → for **code** default `edit`; for **chat** default `edit` *tool-wise* but narrative is Chat-sandbox — see 4.3).
3. Build profile from matrix below.

### 4.3 Profile matrix

| Surface | Default tools | Prompt body | Git guidance | `hip-coding` skill | Model-facing capability line |
|---------|---------------|-------------|--------------|--------------------|------------------------------|
| **Chat** | sandbox write (artifacts) | `BASE_CHAT` | no | **exclude** (do not pin/list) | “You are in **Chat**: private sandbox. You may write previewable artifacts with `write_file`. You are **not** in Code edit mode and must not claim to be editing a user project.” |
| **Code** + permission `chat` | read-only | `BASE` (coding) + read-only cwd | no | pin | “Code surface, **read-only** tools (no write/edit/run_script).” |
| **Code** + permission `edit` | sandbox write | `BASE` + git | yes | pin | “Code surface, **project sandbox** (writes jailed to project root).” **Never** “permission mode: edit” alone. |
| **Code** + permission `full` | un-jailed write | `BASE` + git | yes | pin | “Code surface, **full filesystem** access granted by the user.” |
| **Knowledge** (reserved) | TBD (read notes / optional write notes) | `BASE_KNOWLEDGE` | no | exclude | “Knowledge surface: answer from the open space / selected docs; do not claim to be a coding agent.” |

Chat **keeps** write tools (artifact preview). The bug is narrative + coding identity, not the presence of `write_file`.

### 4.4 Prompt assembly changes

#### Identity (`IDENTITY`)

Split:

- **Shared:** “You are hip… never claim to be Claude/ChatGPT/…”
- **Surface clause:**
  - Chat: “You are the Chat assistant in a private sandbox workspace.”
  - Code: “You are the Code workbench agent working in the user’s project.”
  - Knowledge (later): “You are the Knowledge assistant for the user’s notes spaces.”

#### Capability map (`PRODUCT_CAPABILITY_MAP`)

Either:

- **A (preferred for P0):** inject a **surface-filtered** short map (omit the global “edit = default” line on Chat), or  
- **B:** keep one map but prefix with “Current surface: Chat|Code — ignore modes that do not apply.”

Minimum: Chat must not see an unqualified “edit = default” without “only applies on Code surface when the user picks project sandbox.”

#### cwd / capability injectors

Replace:

```text
Current permission mode: edit.
```

with `profile.capabilityNarrative` only (one place: either fragment **or** injector, not both; prefer one pipeline).

#### `buildSystemPrompt`

- Input: add resolved profile or `(surface, permissionMode)` and call resolver internally.
- `isChat` becomes **`profile.promptBody === 'chat'`** only (do **not** treat `permissionMode === 'chat'` as Chat product body — Code+read-only stays coding body with read-only tools).
- Skills block: apply `skillPolicy.excludeIds` / `pinIds`.
- Git guidance: only if `includeGitGuidance`.

#### Sub-agents

- Children inherit **permissionMode** (tool jail) as today.
- Children should inherit **parent surface** for any residual narrative, or stay “focused sub-agent” without product surface claims. Prefer **not** injecting Code edit copy when parent is Chat.

### 4.5 Tools assembly

`buildAllTools` / turn runner:

1. Resolve profile once per turn.
2. Apply `toolPolicy` **and** permissionMode (permissionMode remains the protocol gate; profile may further restrict for surface).
3. Chat surface **additional clamps** even when permissionMode is `edit`:
   - `allowGit = false`
   - `allowPluginInstall = false`
   - `allowParallelWorktrees = false`
   - (optional) tighten sub-agent roster if needed

This prevents “I’m committing to your repo” on Chat.

### 4.6 Frontend / session creation

| Path | Change |
|------|--------|
| `configFromDraft` Chat | Explicitly set `surface: 'chat'`. Optionally set a comment that permissionMode remains sandbox-write default for tools; **do not** set `permissionMode: 'chat'` (that would strip artifact writes). |
| `createChatSessionForE2e` / chat create | Ensure `surface: 'chat'` always persisted. |
| `surfaceOf` | Use on both UI and sidecar; stop ternary `=== 'chat' ? chat : code`. |
| Permission picker | Stay Code-only. Labels may stay `chat/edit/full` in UI i18n **or** rename to Ask / Edit / Full for clarity (copy-only; separate small UX task). |
| Knowledge | No session create yet; document reserved surface enum if protocol allows, or keep out of protocol until first Knowledge agent PR. |

### 4.7 Protocol

**P0 (no breaking change):** keep `PermissionMode = 'chat' | 'edit' | 'full'` and `surface?: 'chat' | 'code'`.

**P1 (optional):** extend `surface` to `'knowledge'`; consider renaming protocol modes to `ask | edit | full` with migration — only if product wants clearer API.

---

## 5. Implementation plan

### PR-1 — Stop the lie (minimal, ship first)

**Scope:** narrative + Chat clamps; no protocol change.

1. Add `resolveAgentRuntimeProfile` + unit tests for matrix.
2. Wire into:
   - `buildSystemPrompt`
   - `PermissionModeInjector` / permission fragment (single narrative string)
   - `session-turn-runner` surface resolution via `surfaceOf`
3. Chat: exclude `hip-coding` from skills list/pin; drop git guidance; identity Chat clause; capability narrative as in §4.3.
4. Code: replace “Current permission mode: edit” with “project sandbox” wording; keep tools identical.
5. Tests:
   - `system-prompt.test.ts`: Chat surface prompt must match `/Chat|sandbox|artifact/i` and must **not** match `/Current permission mode:\s*edit/i` or coding-only rules (`task_batch` critical fan-out, git_commit).
   - `runturn-mode-cascade.test.ts`: Chat surface session (surface chat, permissionMode edit) gets Chat body + write_file + **no** “edit mode” string.
   - `configFromDraft` / e2e smoke: Chat create still has write tools for artifacts.
6. Dogfood: `scripts/product-prompt-dogfood.mjs` asserts Chat vs Code snapshots.

**Acceptance:** In a fresh Chat conversation, ask “你现在是什么模式 / what mode are you in?” — answer must describe **Chat sandbox**, not Code edit mode.

### PR-2 — Single pipeline cleanup

1. Deduplicate injector vs fragment permission text (one wins).
2. SkillsListInjector: avoid double skills dump if system prompt already includes skills block (or mark skills injector no-op when system already embedded).
3. Surface-filtered product capability map generation (optional content SoT tweak under `packages/product-content/`).

### PR-3 — Knowledge agent profile (optional product)

1. Define when Knowledge sessions exist (e.g. “Ask about this space”).
2. Add `BASE_KNOWLEDGE`, retrieval injectors, tool jail to knowledge root.
3. Extend protocol `surface` if needed.

---

## 6. Test plan

| Layer | Cases |
|-------|--------|
| Unit | Profile matrix for all surface × permissionMode combos |
| Unit | `buildSystemPrompt({ surface: 'chat', permissionMode: 'edit' })` ≠ edit narrative |
| Unit | `buildSystemPrompt({ surface: 'code', permissionMode: 'edit' })` includes coding BASE + project sandbox narrative |
| Unit | `buildSystemPrompt({ surface: 'code', permissionMode: 'chat' })` coding body + read-only cwd + **no** Chat-only artifact guidance as primary identity |
| Integration | runTurn Chat surface: tools include write_file; system text excludes “permission mode: edit” |
| Integration | runTurn Code+chat permission: no write_file; still coding identity |
| Frontend | Chat New Conversation still hides PermissionModePicker |
| Regression | Code permission picker still switches tools + prompt cwd block |
| Dogfood | product-prompt-dogfood chat vs code snapshot |

---

## 7. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Treating Chat permissionMode as read-only strips artifact writes | Never set Chat default to protocol `'chat'`; only clamp narrative + non-artifact tools |
| Models still say “edit” from capability map | Surface-filter or reword map; dogfood assertion |
| Legacy sessions without `surface` become code | `surfaceOf` scratch-cwd inference; migration note in release |
| Double system context (injectors + fragments) | PR-2 single path; PR-1 at least makes both say the same narrative |
| Sub-agents on Chat still code-speak | Cascade surface or neutral child prompt |

---

## 8. Open questions

1. **Should Chat default permissionMode stay `edit` in stored config?**  
   **Recommendation:** Yes for wire compatibility and artifact writes; change only model-facing narrative + surface clamps. Optionally store an explicit sentinel later if we add a fourth mode — avoid for P0.

2. **Rename UI labels Ask / Edit / Full?**  
   Improves Code UX; independent of the Chat bug. Can ship with PR-1 i18n-only.

3. **Does Chat need git tools if user attaches a project folder?**  
   Today Chat is picker-less and should not carry project cwd; keep no-git on Chat. If product later allows project in Chat, re-evaluate under a new surface mode rather than overloading Chat.

4. **Knowledge in this bugfix?**  
   No — reserve the profile slot only.

---

## 9. Success criteria

1. Chat turn system prompt contains Chat identity + Chat capability narrative.  
2. Chat turn system prompt does **not** contain `Current permission mode: edit` or unqualified “you are in edit mode”.  
3. Chat does not list/pin `hip-coding` or include `GIT_GUIDANCE`.  
4. Code + project sandbox still has coding BASE, write tools, and clear sandbox narrative.  
5. Code + read-only still drops write tools and states read-only.  
6. Manual: Chat Q&A no longer self-identifies as edit/coding mode.

---

## 10. Appendix — current code map

| Concern | Location |
|---------|----------|
| Prompt bodies | `packages/sidecar/src/session/system-prompt.ts` (`BASE`, `BASE_CHAT`, `cwdBlock`, `IDENTITY`) |
| Product L0 map | `packages/product-content/capability-map.md` → `product/content.ts` |
| Injectors | `packages/sidecar/src/session/context-injector.ts` |
| Permission fragment | `packages/sidecar/src/session/fragments/permission.ts` |
| Turn wiring | `packages/sidecar/src/session/session-turn-runner.ts` (~`permissionMode` / `surface`) |
| Tools | `packages/sidecar/src/session/tools/index.ts` |
| Surface resolve | `packages/sidecar/src/session/surface.ts`, `src/lib/sessions.ts` |
| Draft → config | `src/domain/sessionService.ts` `configFromDraft` |
| Defaults | `packages/protocol/src/session-config.ts` `SESSION_CONFIG_DEFAULTS.permissionMode = 'edit'` |
| UI pickers | `src/components/chat/PermissionModePicker.tsx`, `InputBar.tsx`, `NewConversation.tsx` |

---

## 11. Suggested PR title / commit

```
fix(agent): surface-aware prompts so Chat never claims edit mode
```

Implement PR-1 first unless product asks to combine with Knowledge.
