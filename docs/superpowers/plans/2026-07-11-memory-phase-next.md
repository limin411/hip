# Memory Phase Next (A+B+C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden V1 memory (integration tests + review UX), ship P1 trash/undo + role-model config + cost gates, then enable optional hybrid retrieval via sqlite-vec and OpenAI-compatible embeddings.

**Architecture:** Extend existing `packages/sidecar/src/memory/*` and Settings UI. Protocol grows `MemoryModelRef` + trash/hybrid WS. Soft-delete becomes trash (restore + retention); session derived-delete stays hard. Vectors live in `hip.db` via `sqlite-vec` extension; hybrid scoring wraps `searchInScopes` / `formatPrefetch` with FTS fallback when vec/embed unavailable.

**Tech Stack:** TypeScript, Vitest, `node:sqlite` (`DatabaseSync`), `sqlite-vec` (npm), OpenAI-compatible embeddings HTTP, React Settings, existing `@hip/protocol` WS.

**Spec:** [`docs/superpowers/specs/2026-07-11-memory-phase-next-spec.md`](../specs/2026-07-11-memory-phase-next-spec.md) rev 2

**Out of scope:** Wave D (skill candidates, project remount).

---

## Dependency graph

```text
T1 integration tests
T2 pin/edit/list UI ─────────────────────────────┐
T3 protocol + role model config types            │
     ├─► T4 trash restore + retention            │
     ├─► T5 cost gates + citations allowedIds    │
     └─► T6 sqlite-vec + embed pipeline          │
              └─► T7 hybrid search + optional rerank
                       └─► T8 polish integration + docs
```

Suggested merge order matches table in spec §7.

---

## File map

### Create

```
packages/sidecar/src/memory/integration.matrix.test.ts
packages/sidecar/src/memory/embedding-client.ts
packages/sidecar/src/memory/embedding-client.test.ts
packages/sidecar/src/memory/vec.ts                 # tryEnableSqliteVec + vector CRUD helpers
packages/sidecar/src/memory/vec.test.ts
packages/sidecar/src/memory/hybrid-search.ts
packages/sidecar/src/memory/hybrid-search.test.ts
packages/sidecar/src/memory/trash.ts               # purgeExpiredTrash job (or fold into evolution.ts)
packages/sidecar/src/memory/trash.test.ts
src/components/account/MemoryRoleModels.tsx       # optional extract; or section in ModelConfig
src/components/account/MemoryTrashPanel.tsx       # or tabs inside MemoryConfig
```

### Modify (primary)

```
packages/protocol/src/memory-types.ts
packages/protocol/src/messages.ts
packages/protocol/src/message-guard.ts
packages/sidecar/src/persistence/schema.ts         # v18 embeddings (+ any trash metadata if needed)
packages/sidecar/src/persistence/open.ts
packages/sidecar/src/memory/store.ts
packages/sidecar/src/memory/service.ts
packages/sidecar/src/memory/config.ts
packages/sidecar/src/memory/handlers.ts
packages/sidecar/src/memory/pipeline/queue.ts      # maxExtractsPerDay
packages/sidecar/src/memory/pipeline/evolution.ts # call purge trash
packages/sidecar/src/session/session-persist.ts   # allowedIds for citations
packages/sidecar/src/session/session-turn-runner.ts
packages/sidecar/package.json                     # sqlite-vec
src/components/account/MemoryConfig.tsx
src/components/account/ModelConfig.tsx
src/components/chat/MessageBubble.tsx
src/domain/sessionService.ts
src/i18n/{en,zh-CN,zh-TW}.ts
docs/superpowers/specs/2026-07-10-persistence-data-model.md
```

---

## Task 1: V1 integration matrix

**Files:**
- Create: `packages/sidecar/src/memory/integration.matrix.test.ts`
- Modify (only if bugs found): pipeline/inject/handlers under test

- [ ] **Step 1: Scaffold test file with shared fixtures**

```ts
// packages/sidecar/src/memory/integration.matrix.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { MemoryStore } from './store.js'
import { MemoryService } from './service.js'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
// ... Phase1/Phase2, inject helpers

function openMemDb() {
  const opened = openDatabase(':memory:')
  return {
    db: opened.db,
    store: new MemoryStore(opened.db, opened.memoriesFtsEnabled),
    fts: opened.memoriesFtsEnabled,
  }
}
```

- [ ] **Step 2: Implement A1.1–A1.6 as separate `it` blocks**

| Test id | Setup | Assert |
|---------|--------|--------|
| A1.1 | upsert project item pinned; `loadCoreSnapshot(hash)` | includes title |
| A1.2 | flags incognito; `maybeEnqueueMemoryExtract` / `runPhase1Extract` | skipped; inject empty |
| A1.3 | Phase2 mock LLM writes item with `sourceSessionId`; `deleteBySourceSession` hard | `getItem` undefined |
| A1.4 | registry with ProjectAgentsMd + MemoryInjector | joined system: agents text before memory header |
| A1.5 | generate false, long transcript | no stage1 row |
| A1.6 | mock timers; two `scheduleMemoryExtractAfterTurn` within idle window | single enqueue after idle |

Use `vi.useFakeTimers()` for A1.6. Mock `MemoryLlmClient.completeJson` for Phase1/2.

- [ ] **Step 3: Run tests**

```bash
yarn test packages/sidecar/src/memory/integration.matrix.test.ts
```

Expected: PASS (fix product bugs if red).

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/memory/integration.matrix.test.ts
git commit -m "test(memory): V1 integration matrix A1.1–A1.6"
```

---

## Task 2: Settings pin / edit / list filters

**Files:**
- Modify: `src/components/account/MemoryConfig.tsx`
- Modify: `src/components/account/MemoryConfig.test.tsx`
- Modify: `src/domain/sessionService.ts` (if list needs `status` / upsert pin)
- Modify: `packages/sidecar/src/memory/handlers.ts` — allow `memory:list` optional `status` override (default `active`)
- Modify: `packages/protocol/src/messages.ts` if list payload lacks `status`
- Modify: i18n keys

- [ ] **Step 1: Protocol — optional status on list**

```ts
// ClientMessage memory:list already may have fields; ensure:
| { type: 'memory:list'; scope?: MemoryScope; projectKeyHash?: string; sessionId?: string;
    query?: string; limit?: number; status?: MemoryStatus }
```

Handler: `status: msg.status ?? 'active'`.

- [ ] **Step 2: UI — each row actions**

For each item in active list:
- Pin toggle → `sessionService.upsertMemory({ id, title, content, kind, scope, pinned: !pinned, ... })`
- Edit → small modal: title + content → upsert
- Delete → confirm → soft delete (default `hard: false`)

Add filter chips: Active (default) | show will expand in Task 4 for Trash tab.

- [ ] **Step 3: Tests**

```tsx
// MemoryConfig.test.tsx
it('calls upsert when pin toggled', async () => { ... })
it('calls deleteMemory without hard by default', async () => { ... })
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(memory): settings pin, edit, and active list filters"
```

---

## Task 3: Protocol + role models (extract / embed / rerank)

**Files:**
- Modify: `packages/protocol/src/memory-types.ts`
- Modify: `packages/protocol/src/messages.ts`, `message-guard.ts` if new WS
- Modify: `packages/sidecar/src/memory/config.ts` merge/defaults
- Modify: `packages/sidecar/src/memory/llm-client.ts` — resolve extract from `MemoryModelRef | string`
- Create/Modify: `src/components/account/ModelConfig.tsx` Role models section
- Modify: `src/components/account/MemoryConfig.tsx` — extract dropdown
- Modify: `src/store/providersStore.ts` / catalog helpers as needed
- Tests: `memory-types.test.ts`, `config.test.ts`, RTL for role models

- [ ] **Step 1: Extend types**

```ts
// packages/protocol/src/memory-types.ts
export interface MemoryModelRef {
  providerID: string
  modelID: string
  baseURL?: string
}

export interface MemoryFileConfig {
  // ...existing...
  /** @deprecated prefer MemoryModelRef; still accepted on load */
  extractModel?: string | MemoryModelRef
  embeddingModel?: MemoryModelRef
  rerankModel?: MemoryModelRef
  hybridSearchEnabled?: boolean
  maxExtractsPerDay?: number
  trashRetentionDays?: number
}

export const MEMORY_FILE_CONFIG_DEFAULTS: MemoryFileConfig = {
  // ...existing...
  hybridSearchEnabled: false,
  maxExtractsPerDay: 20,
  trashRetentionDays: 30,
}

export function normalizeExtractModel(
  v: string | MemoryModelRef | undefined,
): MemoryModelRef | undefined {
  if (!v) return undefined
  if (typeof v === 'string') {
    // "provider/model" or bare model id
    const i = v.indexOf('/')
    if (i > 0) return { providerID: v.slice(0, i), modelID: v.slice(i + 1) }
    return { providerID: 'openai', modelID: v } // last resort for bare ids
  }
  return v
}
```

Update `mergeMemoryConfig` to default new keys.

- [ ] **Step 2: llm-client resolution**

```ts
export function resolveMemoryExtractModel(override?: string | MemoryModelRef): {
  providerID: string
  modelID: string
  baseURL: string
} {
  const ref = normalizeExtractModel(override) ?? normalizeExtractModel(loadMemoryConfig().extractModel)
  const active = getActiveModel()
  if (!ref) {
    return {
      providerID: active.providerID,
      modelID: cheapModelFor(active.providerID, active.modelID),
      baseURL: active.baseURL || resolveProviderBaseURL(active.providerID),
    }
  }
  return {
    providerID: ref.providerID,
    modelID: ref.modelID,
    baseURL: ref.baseURL || resolveProviderBaseURL(ref.providerID),
  }
}
```

- [ ] **Step 3: ModelConfig UI — Role models**

Section under current model hero:

1. Memory extract (chat models from catalog)  
2. Embedding model + button **「使用推荐」**:
   - if `activeModel.providerID` is `openai` or openai-compatible known → set `{ providerID, modelID: 'text-embedding-3-small' }`
   - else show toast: pick manually  
3. Rerank (optional) — can leave empty  
4. Helper text: hybrid/privacy  

Persist via `sessionService.setMemoryConfig`.

- [ ] **Step 4: MemoryConfig extract dropdown**

Replace free-text with same catalog picker; clear = remove extractModel.

- [ ] **Step 5: Tests + commit**

```bash
yarn test packages/protocol/src/memory-types.test.ts packages/sidecar/src/memory/config.test.ts
git commit -m "feat(settings): role models for extract, embedding, and rerank"
```

---

## Task 4: Trash restore + retention job

**Files:**
- Modify: `packages/protocol/src/messages.ts` — restore / emptyTrash
- Modify: `message-guard.ts`
- Modify: `packages/sidecar/src/memory/store.ts` — restore, list deleted, purge older than
- Modify: `packages/sidecar/src/memory/service.ts`
- Modify: `packages/sidecar/src/memory/handlers.ts`
- Modify: `packages/sidecar/src/memory/pipeline/evolution.ts` or `trash.ts`
- Modify: `MemoryConfig.tsx` — Trash tab
- Modify: `sessionService.ts`
- Tests

- [ ] **Step 1: Protocol**

```ts
| { type: 'memory:restore'; id: string }
| { type: 'memory:emptyTrash' }
// Server:
| { type: 'memory:restore:result'; item?: MemoryItem; error?: string }
| { type: 'memory:emptyTrash:result'; deleted: number; error?: string }
```

Add to `CLIENT_MESSAGE_TYPES`.

- [ ] **Step 2: Store / service**

```ts
// MemoryStore
restoreItem(id: string): boolean {
  // SET status='active', updated_at=now WHERE id=? AND status='deleted'
}
purgeDeletedOlderThan(cutoffMs: number): number {
  // DELETE FROM memory_items WHERE status='deleted' AND updated_at < cutoff
  // also delete embeddings when Task 6 lands — call hook or cascade later
}
```

```ts
// service.softDelete already status=deleted
// service.restore(id) → restoreItem + schedule re-embed if hybrid (no-op until T6)
```

- [ ] **Step 3: Retention job**

```ts
// trash.ts
export function runTrashRetentionJob(store: MemoryStore, config: MemoryFileConfig, now = Date.now()): number {
  const days = config.trashRetentionDays ?? 30
  const cutoff = now - days * 86_400_000
  return store.purgeDeletedOlderThan(cutoff)
}
```

Call from: startup decay path (`runStartupDecayOnce` / evolution after Phase2) + `runDecayJob` neighbor.

- [ ] **Step 4: Handlers**

- `memory:list` with `status: 'deleted'` for trash UI  
- `memory:restore`  
- `memory:emptyTrash` — hard delete all `status=deleted`  
- **Unchanged:** `deleteBySourceSession` / session derived = hard  

- [ ] **Step 5: UI**

Memory settings tabs: **Active | Trash**  
Trash: list deleted, Restore, Empty trash (confirm).

- [ ] **Step 6: Tests**

```ts
it('soft delete then restore returns to active list', ...)
it('purgeDeletedOlderThan removes only old trash', ...)
it('deleteBySourceSession still hard-deletes', ...)
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(memory): trash restore and retention purge"
```

---

## Task 5: Extract cost gates + citation allowedIds

**Files:**
- Modify: `packages/sidecar/src/memory/pipeline/queue.ts`
- Modify: `packages/sidecar/src/session/session-persist.ts`
- Modify: `packages/sidecar/src/session/session-turn-runner.ts` (track injected ids if needed)
- Modify: `MessageBubble.tsx` popover
- i18n cost copy in MemoryConfig
- Tests

- [ ] **Step 1: Daily extract counter**

```ts
// queue.ts (module state + optional persist later)
let extractCountByDay = { day: '', count: 0 }

function todayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function assertUnderDailyExtractLimit(config: MemoryFileConfig, now = Date.now()): boolean {
  const max = config.maxExtractsPerDay ?? 20
  const day = todayKey(now)
  if (extractCountByDay.day !== day) extractCountByDay = { day, count: 0 }
  return extractCountByDay.count < max
}

export function recordExtractSuccess(now = Date.now()): void {
  const day = todayKey(now)
  if (extractCountByDay.day !== day) extractCountByDay = { day, count: 0 }
  extractCountByDay.count++
}
```

In `maybeEnqueueMemoryExtract` / Phase1 success path: skip with reason `rate_limited` if over limit; increment only on Phase1 `succeeded` | `succeeded_no_output`.

- [ ] **Step 2: Citations allowedIds**

On host, accumulate ids used in `loadCoreSnapshot` + `formatPrefetch` for the turn (service can return ids, or parse from prefetch block). Pass into finalize:

```ts
const { citations, strippedContent } = parseMemoryCitations(text, host.memoryIdsInjectedThisTurn)
```

Ensure turn-runner sets `memoryIdsInjectedThisTurn` when building context.

- [ ] **Step 3: Chip popover**

```tsx
// MessageBubble — when memoryCitations length > 0
<button>{t('memory.usedN', { n })}</button>
// popover lists title || memoryId
```

- [ ] **Step 4: Tests + commit**

```bash
yarn test packages/sidecar/src/memory/pipeline/queue.test.ts packages/sidecar/src/memory/citations.test.ts
git commit -m "feat(memory): daily extract limit and citation allowedIds"
```

---

## Task 6: sqlite-vec + embedding pipeline

**Files:**
- Modify: `packages/sidecar/package.json` — add `sqlite-vec`
- Create: `packages/sidecar/src/memory/vec.ts`
- Create: `packages/sidecar/src/memory/embedding-client.ts`
- Modify: `packages/sidecar/src/persistence/schema.ts` — v18
- Modify: `packages/sidecar/src/persistence/open.ts`
- Modify: `packages/sidecar/src/memory/service.ts` — async embed after upsert
- Modify: `packages/sidecar/src/memory/handlers.ts` — reindex + index status
- Protocol: `memory:reindex`, `memory:indexStatus`
- Tests (mock embed; vec probe may skip if extension missing in CI)

- [ ] **Step 1: Install dependency**

```bash
cd packages/sidecar && yarn add sqlite-vec
```

Spike note: `sqlite-vec` npm provides loadable extension path; with `node:sqlite` `DatabaseSync`, use:

```ts
// vec.ts — adapt to actual sqlite-vec JS API after reading node_modules/sqlite-vec README
import * as sqliteVec from 'sqlite-vec'

export function tryEnableSqliteVec(db: DatabaseSync): boolean {
  try {
    // Prefer official helper if present, e.g. sqliteVec.load(db)
    // Else: db.exec(`SELECT load_extension(...)`) with path from package
    sqliteVec.load(db as never)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
        memory_id TEXT PRIMARY KEY,
        embedding float[/* dim runtime - see C2 */]
      );
    `)
    // If vec0 requires fixed dim at CREATE: store meta table first
    return true
  } catch (e) {
    console.warn('[memory] sqlite-vec unavailable; hybrid disabled', e)
    return false
  }
}
```

**Dim strategy (locked for implementer):**

1. Table `memory_embedding_meta(model_id TEXT PRIMARY KEY, dim INT NOT NULL)`  
2. On first successful embed, if no meta: `CREATE VIRTUAL TABLE memory_embeddings_dim{N}` **or** use a side table:

```sql
-- Portable fallback if vec0 fixed-dim is painful in v1 of this task:
CREATE TABLE IF NOT EXISTS memory_embedding_rows (
  memory_id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  embedding BLOB NOT NULL, -- Float32Array little-endian
  updated_at INTEGER NOT NULL
);
```

Prefer **BLOB side table + cosine in JS** if `vec0` CREATE-time dim blocks iteration; still **depend on sqlite-vec** for KNN when dim known:

```sql
-- When dim known (e.g. 1536):
CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec_1536 USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding float[1536]
);
```

Implementer must pick one path and document in code comment; tests mock distance regardless.

- [ ] **Step 2: Schema migration v18**

```ts
if (version < 18) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_embedding_meta (
      model_key TEXT PRIMARY KEY,
      dim INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_embedding_rows (
      memory_id TEXT PRIMARY KEY,
      model_key TEXT NOT NULL,
      dim INTEGER NOT NULL,
      embedding BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  db.exec('PRAGMA user_version = 18')
}
```

OpenedDb: `memoriesVecEnabled: boolean`.

- [ ] **Step 3: Embedding client**

```ts
// embedding-client.ts
export interface MemoryEmbeddingClient {
  embed(texts: string[]): Promise<number[][]>
}

export function createOpenAICompatibleEmbeddingClient(ref: MemoryModelRef): MemoryEmbeddingClient {
  return {
    async embed(texts) {
      const key = resolveApiKey(ref.providerID)
      if (!key) throw new Error('no_api_key')
      const base = (ref.baseURL || resolveProviderBaseURL(ref.providerID)).replace(/\/$/, '')
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: ref.modelID, input: texts }),
      })
      if (!res.ok) throw new Error(`embed_http_${res.status}`)
      const json = (await res.json()) as { data: Array<{ embedding: number[] }> }
      return json.data.map((d) => d.embedding)
    },
  }
}

export function truncateForEmbed(title: string, content: string, maxChars = 8000): string {
  const s = `${title}\n${content}`
  return s.length <= maxChars ? s : s.slice(0, maxChars)
}
```

- [ ] **Step 4: Upsert hook**

After successful `MemoryService.upsert`, if `embeddingModel` set and vec/rows enabled:

```ts
void this.scheduleEmbed(item.id).catch((e) => console.warn('[memory] embed failed', e))
```

`scheduleEmbed`: load item, embed, write BLOB + meta.

- [ ] **Step 5: Reindex WS**

```ts
| { type: 'memory:reindex' }
| { type: 'memory:indexStatus' }
// results: { embedded, total, failed?, modelKey? }
```

- [ ] **Step 6: Tests**

- mock client returns unit vectors  
- upsert schedules embed (inject client)  
- missing key does not throw on upsert  
- schema v18  

```bash
yarn test packages/sidecar/src/memory/embedding-client.test.ts packages/sidecar/src/memory/vec.test.ts
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(memory): sqlite-vec support and embedding pipeline"
```

---

## Task 7: Hybrid search + optional rerank

**Files:**
- Create: `packages/sidecar/src/memory/hybrid-search.ts`
- Modify: `service.ts` `search` / `formatPrefetch` / `searchInScopes` path
- Modify: handlers validation for `hybridSearchEnabled`
- Modify: MemoryConfig — toggle hybrid + index status + reindex button
- Tests

- [ ] **Step 1: Scoring**

```ts
// hybrid-search.ts
export type HybridWeights = { alpha: number; beta: number; gamma: number; delta: number; epsilon: number }
export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = {
  alpha: 0.35, beta: 0.40, gamma: 0.15, delta: 0.05, epsilon: 0.05,
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function hybridScore(parts: {
  ftsRankNorm: number // 0..1
  cosineSim: number   // 0..1
  confidence: number
  recency: number     // exp(-ageDays/30)
  pinned: boolean
  w?: HybridWeights
}): number {
  const w = parts.w ?? DEFAULT_HYBRID_WEIGHTS
  return (
    w.alpha * parts.ftsRankNorm +
    w.beta * parts.cosineSim +
    w.gamma * parts.confidence +
    w.delta * parts.recency +
    w.epsilon * (parts.pinned ? 1 : 0)
  )
}
```

- [ ] **Step 2: searchHybrid**

```ts
export async function searchHybrid(opts: {
  store: MemoryStore
  query: string
  projectKeyHash?: string
  sessionId?: string
  limit: number
  embedQuery: () => Promise<number[] | null> // null → FTS only
  getEmbedding: (id: string) => number[] | null
  now?: number
}): Promise<MemoryItem[]> {
  const ftsHits = opts.store.searchInScopes(opts.query, {
    projectKeyHash: opts.projectKeyHash,
    sessionId: opts.sessionId,
    limit: Math.max(opts.limit * 4, 40),
  })
  const qVec = await opts.embedQuery()
  if (!qVec) return ftsHits.slice(0, opts.limit)

  const scored = ftsHits.map((item, idx) => {
    const ftsRankNorm = 1 - idx / Math.max(ftsHits.length, 1)
    const emb = opts.getEmbedding(item.id)
    const cos = emb && emb.length === qVec.length ? Math.max(0, cosine(emb, qVec)) : 0
    const ageDays = ( (opts.now ?? Date.now()) - (item.lastUsedAt ?? item.updatedAt) ) / 86_400_000
    const recency = Math.exp(-ageDays / 30)
    return {
      item,
      score: hybridScore({
        ftsRankNorm,
        cosineSim: cos,
        confidence: item.confidence,
        recency,
        pinned: item.pinned,
      }),
    }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, opts.limit).map((s) => s.item)
}
```

Optional rerank: if `rerankModel` set, take top 20 text pairs, call provider (if no standard API, **skip with log** — YAGNI: implement only if a simple score API exists; else document no-op).

- [ ] **Step 3: Wire formatPrefetch**

```ts
// MemoryService.formatPrefetch
const cfg = this.getConfig()
if (cfg.hybridSearchEnabled && cfg.embeddingModel && this.embedClient) {
  items = await searchHybrid(...)
} else {
  items = this.store.searchInScopes(...)
}
```

- [ ] **Step 4: setConfig validation**

When `hybridSearchEnabled: true` without `embeddingModel` → reject with error string on `memory:setConfig`.

- [ ] **Step 5: UI**

Toggle hybrid; disabled if no embeddingModel; show index status; Reindex button.

- [ ] **Step 6: Tests**

```ts
it('with mock query vector ranks semantic neighbor above fts-only noise', ...)
it('hybrid off equals searchInScopes order subset', ...)
it('setConfig hybrid without embedding fails', ...)
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(memory): hybrid FTS+embedding search with optional rerank"
```

---

## Task 8: Polish integration + docs

**Files:**
- Expand: `integration.matrix.test.ts` — trash + hybrid mock path  
- Modify: `docs/superpowers/specs/2026-07-10-persistence-data-model.md`  
- Modify: `docs/superpowers/specs/2026-07-11-memory-phase-next-spec.md` status → Implemented (partial) when done  

- [ ] **Step 1: Integration cases**

| Id | Assert |
|----|--------|
| A1.7 | soft delete → restore → active list |
| A1.8 | hybrid mock: semantic query returns expected id |
| A1.9 | hybrid disabled after vec probe false still FTS |

- [ ] **Step 2: Data model doc**

Document: `memory_embedding_*`, trash semantics, hybrid flags, derived hard-delete vs trash.

- [ ] **Step 3: Full test sweep**

```bash
yarn test packages/sidecar/src/memory packages/protocol
yarn test src/components/account/MemoryConfig.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git commit -m "test(memory): hybrid and trash integration; update data-model docs"
```

---

## Verification (end of phase)

```bash
yarn test packages/sidecar/src/memory packages/protocol
yarn test src/components/account/MemoryConfig.test.tsx
# Optional packaging smoke (manual):
yarn workspace @hip/sidecar build
# yarn tauri build  # when validating sqlite-vec load in bundled sidecar
```

Manual smoke:

1. Enable use+generate; pin/edit/trash/restore  
2. Configure embedding + enable hybrid; reindex; semantic ask in chat  
3. Disable hybrid; behavior = V1 FTS  
4. Session delete with derived hard still purges Phase2 items  

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| A1 matrix | T1, T8 |
| A2 pin/edit | T2 |
| B1–B2 role models | T3 |
| B6 trash | T4 |
| B3–B5 cost + citations + slash polish | T5 (+ slash if missing bits in T2/T3) |
| C1–C2 sqlite-vec + embed | T6 |
| C3–C5 hybrid | T7 |
| Docs | T8 |
| Wave D | **omitted** |

---

## Risks for implementers

| Risk | Action |
|------|--------|
| sqlite-vec + `node:sqlite` load fails | BLOB cosine path still ships; `memoriesVecEnabled=false` |
| ncc bundles native .dylib | verify `sidecar:build` copies extension or loads from app resources |
| Paid embed in tests | always mock `MemoryEmbeddingClient` in unit/integration |
| Scope creep rerank | no-op if API unclear |

---

*End of plan.*
