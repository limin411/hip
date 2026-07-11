# Cross-Session Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship hip’s opt-in cross-session agent memory (FTS-first) so preferences, conventions, and lessons survive sessions, with an autonomous extract→consolidate pipeline, without requiring vector/rerank model configuration up front.

**Architecture:** SQLite-authoritative memory tables in `~/.hip/db/hip.db`; global flags in `~/.hip/config/memory.json`; injection via `MemoryInjector` last in the existing `ContextInjectorRegistry`; background `MemoryLlmClient.completeJson` (not session `ModelRunner`) for Phase1 extract + Phase2 consolidate; optional Markdown mirror under `~/.hip/memories/`. **V1 uses FTS only.** Embedding + optional rerank model roles land as a **V1.5 prerequisite**, not a V1 gate.

**Tech Stack:** TypeScript, Vitest, better-sqlite3 (existing), `@hip/protocol` WS types, React settings UI, existing providers/auth for LLM keys.

**Spec:** [`docs/superpowers/specs/2026-07-11-cross-session-memory-system-design.md`](../specs/2026-07-11-cross-session-memory-system-design.md) (rev 3)

---

## Model configuration decision (locked)

| Model role | When | UI surface | V1 required? |
|------------|------|------------|--------------|
| Chat / active model | Existing | Settings → Model (`ModelConfig.tsx`) | Yes (already exists) |
| Memory **extract/consolidate** (chat completion) | V1 pipeline | `memory.json` `extractModel` + optional row under Memory settings (not full Model page) | Optional override; default = `activeModel` |
| **Embedding / vector** model | **V1.5 only** | Settings → Model: “角色模型” section | **No for V1** |
| **Rerank** model | **V1.5 optional** | Same section; can stay empty | **No for V1** |

**Do not** block Tasks 1–11 on embedding/rerank UI.  
**Do** land Task 12a (model roles: embed/rerank) **before** Task 12 (sqlite-vec hybrid).

---

## File map (V1)

### Create

```
packages/protocol/src/memory-types.ts
packages/sidecar/src/memory/
  types.ts
  config.ts
  store.ts
  fts.ts
  redact.ts
  threat-scan.ts
  budget.ts
  project-key.ts
  service.ts
  inject.ts
  tools.ts
  llm-client.ts
  citations.ts
  mirror.ts
  handlers.ts
  pipeline/
    phase1-extract.ts
    phase2-consolidate.ts
    queue.ts
    prompts.ts
    evolution.ts
  index.ts
  *.test.ts                    # colocated tests per module
src/components/account/MemoryConfig.tsx
src/components/account/MemoryConfig.test.tsx
src/components/chat/MemoryCitationsChip.tsx  # or extend MessageBubble
```

### Modify (primary)

```
packages/protocol/src/message-model.ts          # Message.memoryCitations
packages/protocol/src/session-config.ts         # useMemories, generateMemories, incognito
packages/protocol/src/messages.ts               # Client/ServerMessage variants
packages/protocol/src/message-guard.ts          # CLIENT_MESSAGE_TYPES
packages/protocol/src/index.ts                  # re-exports
packages/sidecar/src/persistence/schema.ts      # v16 memory tables + FTS; v17 memory_citations
packages/sidecar/src/persistence/store.ts       # deleteSession hooks; load/save citations
packages/sidecar/src/session/context-injector.ts
packages/sidecar/src/session/session-context.ts # assembleFromInjectors field map
packages/sidecar/src/session/session-turn-runner.ts  # Host fields, registry order, hooks
packages/sidecar/src/session/session-manager.ts # WS dispatch for memory:* / setMemoryFlags
packages/sidecar/src/session/session-tooling (or tools index)  # memory tools; subagent skip
src/components/account/SettingsPanel.tsx        # Memory nav entry
src/components/chat/SlashCommandPalette.tsx / useSlashCommandHandler.ts
src/components/history/DeleteSessionDialog.tsx  # optional delete-derived checkbox
docs/superpowers/specs/2026-07-10-persistence-data-model.md
```

---

## Dependency graph

```text
T1 protocol
 → T2 schema+store+FTS
 → T3 config/redact/service
 → (T4 injector ∥ T5 tools ∥ T6 WS)
 → T7 MemoryLlmClient+Phase1
 → T8 Phase2+mirror+decay
 → T9 citations persist
 → (T10a Settings ∥ T10b slash ∥ T10c chip)
 → T11 integration + docs

Later (V1.5):
 T12a Model roles: embedding (+ optional rerank) UI/config
 → T12 sqlite-vec hybrid search
```

Merge order matches design PR Plan (PR1–PR11, then PR12a → PR12).

---

## Task 1: Protocol types + message-guard + SessionConfig flags

**Files:**
- Create: `packages/protocol/src/memory-types.ts`
- Modify: `packages/protocol/src/message-model.ts`
- Modify: `packages/protocol/src/session-config.ts`
- Modify: `packages/protocol/src/messages.ts`
- Modify: `packages/protocol/src/message-guard.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/message-guard.test.ts` (extend)
- Create: `packages/protocol/src/memory-types.test.ts` (optional light)

- [ ] **Step 1: Add `memory-types.ts`**

```ts
// packages/protocol/src/memory-types.ts
export type MemoryScope = 'global' | 'project' | 'session'
export type MemoryKind = 'preference' | 'convention' | 'lesson' | 'workflow' | 'profile'
export type MemoryStatus = 'active' | 'archived' | 'deleted'
export type MemorySource = 'extract' | 'user' | 'import' | 'tool' | 'consolidate'

export interface MemoryItem {
  id: string
  scope: MemoryScope
  projectKey?: string
  projectKeyHash?: string
  sessionId?: string
  kind: MemoryKind
  title: string
  content: string
  confidence: number
  status: MemoryStatus
  source: MemorySource
  sourceSessionId?: string
  tags: string[]
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  useCount: number
  pinned: boolean
}

export interface MemoryCitation {
  memoryId: string
  title?: string
  note?: string
}

/** Writable global memory flags (memory.json). */
export interface MemoryFileConfig {
  version: 1
  useMemories: boolean
  generateMemories: boolean
  defaultScope: 'project' | 'global'
  idleMinutes: number
  maxCoreSummaryChars: number
  maxPrefetchChars: number
  exportMarkdownMirror: boolean
  maxUnusedDays: number
  minUserTurns?: number
  minUserChars?: number
  decayFactor?: number
  forgetConfidence?: number
  extractModel?: string
  extractMaxTokens?: number
  onboardingTipDismissed?: boolean
  simpleExtract?: boolean
}

export const MEMORY_FILE_CONFIG_DEFAULTS: MemoryFileConfig = {
  version: 1,
  useMemories: false,
  generateMemories: false,
  defaultScope: 'project',
  idleMinutes: 15,
  maxCoreSummaryChars: 1500,
  maxPrefetchChars: 2500,
  exportMarkdownMirror: true,
  maxUnusedDays: 90,
  minUserTurns: 2,
  minUserChars: 80,
  decayFactor: 0.92,
  forgetConfidence: 0.15,
  simpleExtract: false,
}
```

- [ ] **Step 2: Extend `Message` and `SessionConfigLike`**

In `message-model.ts`, add optional:

```ts
memoryCitations?: MemoryCitation[]
```

In `session-config.ts` `SessionConfigLike` and ensure `SessionConfig` in `session-core.ts` / `index.ts` stays in sync:

```ts
useMemories?: boolean
generateMemories?: boolean
incognito?: boolean
```

Do **not** force defaults in `normalizeSessionConfig` (undefined means “inherit global”).

- [ ] **Step 3: Add ClientMessage / ServerMessage variants**

In `messages.ts` (names must match design):

**Client:**
- `memory:list` / `memory:get` / `memory:upsert` / `memory:delete`
- `memory:deleteBySourceSession`
- `memory:export` / `memory:import`
- `memory:getConfig` / `memory:setConfig`
- `memory:consolidate`
- `session:setMemoryFlags`
- `session:delete` gains optional `deleteDerivedMemories?: boolean` (if already a variant, extend fields only)

**Server:**
- `memory:list:result` / `memory:get:result` / `memory:upsert:result` / `memory:delete:result`
- `memory:deleteBySourceSession:result`
- `memory:export:result` / `memory:import:result`
- `memory:config`
- `memory:pipeline`
- `session:memoryFlags`

No `memory:citations` event.

- [ ] **Step 4: Register every new client type in `CLIENT_MESSAGE_TYPES`**

- [ ] **Step 5: Tests**

```bash
cd packages/protocol && yarn test message-guard.test.ts
```

Expected: existing + loop over `CLIENT_MESSAGE_TYPES` still passes; add cases for `memory:setConfig` and `session:setMemoryFlags` round-trip JSON.

- [ ] **Step 6: Export from `index.ts` and commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): memory types, Message.memoryCitations, WS stubs"
```

---

## Task 2: Schema v16 + MemoryStore + FTS + deleteSession hooks

**Files:**
- Modify: `packages/sidecar/src/persistence/schema.ts`
- Create: `packages/sidecar/src/memory/store.ts`
- Create: `packages/sidecar/src/memory/fts.ts`
- Create: `packages/sidecar/src/memory/store.test.ts`
- Create: `packages/sidecar/src/memory/fts.test.ts`
- Modify: `packages/sidecar/src/persistence/store.ts` (`deleteSession`)
- Modify: `packages/sidecar/src/persistence/schema.test.ts` if present

- [ ] **Step 1: Write failing migration test**

Assert after `migrate(db)`, `user_version >= 16` and `memory_items` exists.

- [ ] **Step 2: Implement v16 DDL**

Copy table/FTS/trigger SQL from design §B.4 into `if (version < 16) { ... PRAGMA user_version = 16 }`.  
FTS creation must be probe-safe (try/catch like `tryEnableFts` for messages).

- [ ] **Step 3: Implement `MemoryStore`**

Methods (minimum):
- `upsertItem(item)`, `getItem(id)`, `listItems(filter)`, `softDelete(id)`, `hardDelete(id)`
- `deleteBySourceSession(sessionId, { soft?: boolean })` — default hard delete
- `search(query, { projectKeyHash, sessionId, limit })` — FTS join + `status='active'`
- stage1 claim/upsert helpers (can be stubbed until Task 7 if needed; prefer full CRUD now)
- `deleteSessionScoped(sessionId)` — `scope='session'`
- on session delete: null out `source_session_id` for retained items

- [ ] **Step 4: Hook `SessionStore.deleteSession`**

Inside existing transaction or immediately after:
1. `DELETE memory_items WHERE scope='session' AND session_id=?`
2. `DELETE memory_stage1 WHERE session_id=?`
3. `UPDATE memory_items SET source_session_id=NULL WHERE source_session_id=?`
4. If caller flag `deleteDerivedMemories`: hard `deleteBySourceSession`

- [ ] **Step 5: Tests**

```bash
yarn test packages/sidecar/src/memory/store.test.ts packages/sidecar/src/memory/fts.test.ts
```

Cover: FTS Chinese substring if trigram available; LIKE fallback when FTS probe fails; search excludes `status!='active'`; deleteSession retains project item.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(persistence): memory tables v16, FTS, MemoryStore, session delete hooks"
```

---

## Task 3: memory.json + redact + threat-scan + MemoryService + budgets

**Files:**
- Create: `packages/sidecar/src/memory/config.ts` + test
- Create: `packages/sidecar/src/memory/redact.ts` + test
- Create: `packages/sidecar/src/memory/threat-scan.ts` + test
- Create: `packages/sidecar/src/memory/budget.ts` + test
- Create: `packages/sidecar/src/memory/project-key.ts` + test
- Create: `packages/sidecar/src/memory/service.ts` + test

- [ ] **Step 1: `loadMemoryConfig` / `saveMemoryConfig`**

Path: `~/.hip/config/memory.json` (mode `0o600`).  
Merge: if missing, use `MEMORY_FILE_CONFIG_DEFAULTS`.  
`setConfig` partial-merge + write.

- [ ] **Step 2: Flags resolver**

```ts
export function resolveSessionMemoryFlags(
  global: MemoryFileConfig,
  session: { useMemories?: boolean; generateMemories?: boolean; incognito?: boolean },
): { use: boolean; generate: boolean; incognito: boolean } {
  if (session.incognito === true) {
    return { use: false, generate: false, incognito: true }
  }
  return {
    incognito: false,
    use: session.useMemories ?? global.useMemories,
    generate: session.generateMemories ?? global.generateMemories,
  }
}
```

Test matrix: incognito forces both false; session override beats global.

- [ ] **Step 3: `projectKey(cwd)`**

`realpath(git rev-parse --show-toplevel)` else `realpath(cwd)`; return `{ projectKey, projectKeyHash: sha256(path) }`.

- [ ] **Step 4: Redact + threat-scan**

Redact: API keys, `sk-…`, bearer tokens, common PEM headers → `[REDACTED_SECRET]`.  
Threat-scan: block memory content matching injection patterns (explicit list in-file; do not import external Hermes). On block, reject tool/user upsert with error string.

- [ ] **Step 5: Budgets**

Implement `getMemoryCoreBudget` / `getMemoryPrefetchBudget` from design §B.6.

- [ ] **Step 6: `MemoryService`**

Facade over store+config: `loadCoreSnapshot`, `formatPrefetch`, `upsert` (always redact+scan), `search`, `exportJsonl`, `importJsonl`.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(memory): config store, redact, threat-scan, MemoryService"
```

---

## Task 4: Wire MemoryInjector + SessionTurnHost + assembleFromInjectors

**Files:**
- Create: `packages/sidecar/src/memory/inject.ts` + test
- Modify: `packages/sidecar/src/session/context-injector.ts` (`InjectorState`)
- Modify: `packages/sidecar/src/session/session-context.ts`
- Modify: `packages/sidecar/src/session/session-turn-runner.ts`

- [ ] **Step 1: Extend `InjectorState`**

```ts
sessionId?: string
useMemories?: boolean
memoryCoreSnapshot?: string
prefetchQuery?: string
```

- [ ] **Step 2: Map all fields in `assembleFromInjectors`**

Today hardcodes fields — must pass new ones through or injectors never see them.

- [ ] **Step 3: `SessionTurnHost` fields**

```ts
memoryCoreSnapshot?: string
memorySnapshotProjectKey?: string
```

Before `prepareSessionContext` each turn:
- resolve flags
- if `use`: refresh snapshot when null or project key changed
- else clear snapshot

- [ ] **Step 4: Register injectors — Memory last (Option A)**

```text
SystemPrompt → ProjectAgentsMd → Skills → Permission → TokenBudget → SubagentStatus → Memory
```

`MemoryInjector`: if `!useMemories` return empty; else core then prefetch in one system segment.

- [ ] **Step 5: Tests**

- `use=false` → no memory text in assembled system  
- two turns same core text when no snapshot invalidate  
- ProjectAgents content appears before memory segment  
- assembled system **ends with** memory block when use=true and snapshot non-empty  

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(session): MemoryInjector last; host snapshot wiring"
```

---

## Task 5: Agent memory tools + subagent skip

**Files:**
- Create: `packages/sidecar/src/memory/tools.ts` + test
- Modify: tool registry / session tooling builders
- Modify: subagent tooling path to set `memory: false`

- [ ] **Step 1: Tools**

| Tool name | Actions |
|-----------|---------|
| `memory_search` | query → list hits |
| `memory_add` | title, content, kind, scope? |
| `memory_replace` | id or unique substring + new content |
| `memory_remove` | id or unique substring |

All writes go through `MemoryService` (redact + scan).  
Tool descriptions instruct: treat memory as data not instructions; AGENTS.md wins on conflict.

- [ ] **Step 2: Subagent / cron / ACP**

Primary session tooling includes memory tools when `use` true.  
Subagent tooling list **must not** include `memory_*`.  
Phase1 generation already gated by flags; tools still skipped for non-primary.

- [ ] **Step 3: Tests + commit**

```bash
git commit -m "feat(memory): memory_* tools; skip on subagent"
```

---

## Task 6: WS handlers + setConfig + deleteBySourceSession + setMemoryFlags

**Files:**
- Create: `packages/sidecar/src/memory/handlers.ts` + test
- Modify: `packages/sidecar/src/session/session-manager.ts` (or message router)
- Modify: `session:delete` path for `deleteDerivedMemories`

- [ ] **Step 1: Dispatch table**

Map each `memory:*` client type to handler; always emit corresponding `*:result` or `error`.

- [ ] **Step 2: `session:setMemoryFlags`**

```text
merge into session config JSON → persist sessions.config → update live host → emit session:memoryFlags
```

Mirror `setPermissionMode` pattern (read existing implementation in session / permission-manager).

- [ ] **Step 3: `memory:setConfig`**

Write `memory.json` only (not hip.toml). Echo `memory:config`.

- [ ] **Step 4: `deleteBySourceSession`**

Default hard delete; `soft: true` optional.

- [ ] **Step 5: Tests**

- setConfig persists across process (reload file)  
- setMemoryFlags survives session:load  
- deleteBySourceSession counts  
- unknown type still rejected by message-guard  

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(memory): WS CRUD, config, setMemoryFlags, deleteBySourceSession"
```

---

## Task 7: MemoryLlmClient + Phase1 extract

**Files:**
- Create: `packages/sidecar/src/memory/llm-client.ts` + test
- Create: `packages/sidecar/src/memory/pipeline/prompts.ts`
- Create: `packages/sidecar/src/memory/pipeline/phase1-extract.ts` + test
- Create: `packages/sidecar/src/memory/pipeline/queue.ts` + test
- Modify: session end / idle / sidecar startup hooks

- [ ] **Step 1: `MemoryLlmClient` interface**

```ts
export interface MemoryLlmClient {
  completeJson(args: {
    system: string
    user: string
    model?: string
    maxTokens?: number
    signal?: AbortSignal
    timeoutMs?: number
  }): Promise<unknown>
}
```

Implementation: OpenAI-compatible chat completions with `response_format` JSON or parse fenced JSON; uses auth.json keys via existing provider helpers.  
**Must not** call `RealModelRunner.run`.

Model resolution: `memory.json.extractModel` → else active model.

- [ ] **Step 2: In-repo prompts**

Full Phase1 system/user templates in `prompts.ts` (English or bilingual; self-contained). No runtime read of Codex repo.

- [ ] **Step 3: `buildPhase1Transcript`**

Rules from design §B.7 (user always; supervisor/null parent assistant only; no tool dumps; char cap).

- [ ] **Step 4: Claim gates**

All of: global+session generate, not incognito, min turns OR min chars, idle, interval, lease free.

- [ ] **Step 5: Write `memory_stage1` after redact**

Statuses: `succeeded` | `succeeded_no_output` | `failed` with retry_after.

- [ ] **Step 6: Tests with mock LLM**

```bash
yarn test packages/sidecar/src/memory/pipeline/phase1-extract.test.ts
```

Acceptance (design PR7):
- mock success → stage1 row  
- empty → `succeeded_no_output`  
- incognito / generate off / min turns → no claim  
- child `parent_agent_id` content not in transcript  
- redact before persist  

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(memory): MemoryLlmClient and Phase1 extract pipeline"
```

---

## Task 8: Phase2 consolidate + mirror + decay

**Files:**
- Create: `packages/sidecar/src/memory/pipeline/phase2-consolidate.ts` + test
- Create: `packages/sidecar/src/memory/mirror.ts` + test
- Create: `packages/sidecar/src/memory/pipeline/evolution.ts` + test

- [ ] **Step 1: Phase2 sole writer of extract→items**

Load up to `phase2_max_stage1_inputs`; LLM consolidate JSON; **deterministic post-pass**:
- never delete `source=user` or `pinned=1` via LLM
- duplicate title+scope → archive older lower confidence
- redact all contents

- [ ] **Step 2: Update `memory_summaries` under core budget**

- [ ] **Step 3: Atomic mirror**

`~/.hip/memories/{global|projects/<hash>}/MEMORY.md` via write temp + rename. Only if `exportMarkdownMirror`.

- [ ] **Step 4: Decay job**

`confidence *= decayFactor` for extract/consolidate unpinned; archive if `< forgetConfidence`.

- [ ] **Step 5: Tests without live LLM** (fixture post-pass + decay numbers)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(memory): Phase2 consolidate, mirror, decay/archive"
```

---

## Task 9: Citations parse + strip + persist + reload (schema v17)

**Files:**
- Create: `packages/sidecar/src/memory/citations.ts` + test
- Modify: `packages/sidecar/src/persistence/schema.ts` (v17 `messages.memory_citations`)
- Modify: message save/load in `persistence/store.ts` / message projector
- Modify: turn finalize in turn-runner

- [ ] **Step 1: Parse**

Prefer trailing fence:

````markdown
```hip-memory-citations
[{"memoryId":"…","title":"…"}]
```
````

Secondary: `[mem:id]` if id in injected set. Invalid → ignore.

- [ ] **Step 2: Strip fence from content before persist/emit**

Inline `[mem:id]` keep.

- [ ] **Step 3: Column + load path**

```sql
ALTER TABLE messages ADD COLUMN memory_citations TEXT;
-- user_version = 17
```

`session:load` → `Message.memoryCitations`. Reload must **not** re-increment `use_count`.

- [ ] **Step 4: On successful parse, bump use_count for cited ids (once per turn)**

- [ ] **Step 5: Tests + commit**

```bash
git commit -m "feat(memory): citation strip/persist/reload on messages"
```

---

## Task 10a: Settings → Memory panel

**Files:**
- Create: `src/components/account/MemoryConfig.tsx` + test
- Modify: `src/components/account/SettingsPanel.tsx`
- Modify: i18n `en.ts` / `zh-CN.ts` / `zh-TW.ts`
- Wire WS via `sessionService` / transport

- [ ] **Step 1: Nav entry “记忆 / Memory”**

- [ ] **Step 2: Empty state when both flags false**

CTA: enable use+generate; secondary: enable use only.

- [ ] **Step 3: List/filter/edit/delete/pin + export/import JSONL**

- [ ] **Step 4: Optional “记忆抽取模型” override**

Dropdown of **chat** models from existing catalog (same as ModelConfig list).  
Writes `memory.json.extractModel` only — **not** embedding/rerank.  
Helper text: “后台巩固使用的对话模型；留空则使用当前活动模型。”

- [ ] **Step 5: Tests (RTL) empty-state CTA + toggle calls setConfig**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ui): Memory settings panel with enable CTA"
```

---

## Task 10b: Slash commands

**Files:**
- Modify: slash palette builtins + `useSlashCommandHandler.ts`

| Command | Behavior |
|---------|----------|
| `/memory` | Open Memory settings (project filter if possible) |
| `/memory-on` / `/memory-off` | `session:setMemoryFlags` |
| `/memory-incognito` | incognito true |
| `/memory-status` | toast/status of flags |

No `/memory remember <argv>` in V1.

- [ ] **Step 1–3: implement, test, commit**

```bash
git commit -m "feat(ui): memory slash commands"
```

---

## Task 10c: Citations chip on messages

**Files:**
- Modify: `MessageBubble.tsx` (or small chip component)

Show when `message.memoryCitations?.length > 0` for **live and historical** messages.  
Content must not show raw fence.

- [ ] **Step 1–3: implement, test, commit**

```bash
git commit -m "feat(ui): memory citations chip on assistant messages"
```

---

## Task 11: Integration tests + persistence doc

**Files:**
- Create: `packages/sidecar/src/memory/e2e.integration.test.ts` (or similar)
- Modify: `docs/superpowers/specs/2026-07-10-persistence-data-model.md`
- Modify: `DeleteSessionDialog` for derived-memory checkbox if not done in 10a

- [ ] **Step 1: Integration scenarios**

1. Manual upsert → new session inject contains title  
2. Incognito session never Phase1  
3. deleteSession keeps project memory; checkbox hard-deletes derived  
4. AGENTS.md text still present when memory on  

- [ ] **Step 2: Update persistence data model doc** with memory_* tables and delete semantics

- [ ] **Step 3: Commit**

```bash
git commit -m "test(memory): integration coverage; document memory tables"
```

---

## Task 12a (V1.5 prerequisite): Model roles — embedding (+ optional rerank)

> **Not part of V1 ship.** Start only after Tasks 1–11 stable.

**Files:**
- Extend config: `~/.hip/config/memory.json` or providers config with:
  - `embeddingModel?: { providerID, modelID, baseURL? }`
  - `rerankModel?: { providerID, modelID, baseURL? }` (optional)
- Modify: `src/components/account/ModelConfig.tsx` (or section under Memory + link from Model)
- Protocol/types for role models
- Catalog filter: prefer models tagged embedding if catalog exposes modality; else free-form OpenAI-compatible embedding endpoint settings

- [ ] **Step 1: Design small UX**

Section title: “专用模型 / Role models”  
- 对话模型 — existing hero  
- 向量模型 (Embedding) — required for hybrid  
- 重排模型 (Rerank) — optional, “未配置则跳过重排”  

Grey helper: used by **Memory semantic search (V1.5)**.

- [ ] **Step 2: Persist + validate**

Save without enabling hybrid until Task 12.  
Test: save/load round-trip; missing embedding → Task 12 falls back FTS.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(settings): embedding and optional rerank model roles for memory V1.5"
```

---

## Task 12 (V1.5): sqlite-vec hybrid + skill candidates + project remount

**Depends on:** Task 12a (embedding model configured or graceful FTS fallback)

- [ ] Embed on upsert / batch reindex  
- [ ] Hybrid score: FTS + cosine; optional rerank if configured  
- [ ] Skill promotion candidates for `kind=workflow`  
- [ ] Project remount UI for moved repos  
- [ ] Commit when done  

```bash
git commit -m "feat(memory): sqlite-vec hybrid search and V1.5 evolution"
```

---

## Verification commands (V1)

```bash
# Unit / integration (avoid paid real-LLM by ensuring mock paths)
yarn test packages/protocol
yarn test packages/sidecar/src/memory

# Typecheck
yarn tsc

# Manual smoke (dev)
yarn tauri dev
# Settings → Memory → enable use+generate
# Chat preference twice across sessions; confirm inject / chip / list UI
```

---

## Risks & mitigations (execution)

| Risk | Mitigation |
|------|------------|
| Scope creep into vectors early | Refuse embed/rerank until Task 12a; V1 FTS only |
| Background token cost | Dual opt-in; rate-limit remaining check optional; clear UI copy |
| Wrong extract model API | `MemoryLlmClient` isolated + mock-first tests |
| Injector wiring regressions | Task 4 acceptance: system ends with memory; AGENTS before memory |
| Privacy surprise | Default opt-in off; delete-derived checkbox; no auto AGENTS write |

---

## Spec coverage checklist

| Spec area | Task(s) |
|-----------|---------|
| Protocol / citations type | T1, T9 |
| SQLite + FTS + delete semantics | T2, T6, T11 |
| memory.json + flags | T3, T6, T10a |
| Injector / frozen core | T4 |
| Tools + subagent skip | T5 |
| Phase1/2 evolution policy | T7, T8 |
| UI settings / slash / chip | T10a–c |
| Extract model override (chat) | T10a (optional field) |
| Embedding/rerank | **T12a only** |
| Hybrid / skill promote | T12 |

---

## Self-review notes

- No V1 task depends on vector or rerank configuration.  
- Extract model is chat completion only and optional.  
- PR/Task numbering matches design PR Plan with **T12a** inserted before hybrid.  
- Placeholders avoided: concrete types, paths, acceptance criteria, commit messages.

---

*End of plan.*
