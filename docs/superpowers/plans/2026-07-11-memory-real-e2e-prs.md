# Memory Real E2E — Implementation Plan (All PRs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship real end-to-end coverage for hip cross-session memory: file-DB process tests, WDIO UI (no paid LLM), and opt-in live cross-session recall — without weakening the unpaid PR gate.

**Architecture:** Four stacked PRs (T0→T3). T0 locks `idleMinutes: 0` scheduling semantics. T1 adds vitest process e2e on a real `hip.db` file with mock LLM/embed. T2 extends `window.__hipE2E` and WDIO `@memory` specs. T3 adds `@live @memory` suite + wdio staged `memory.json` + docs.

**Tech Stack:** TypeScript, Vitest, better-sqlite3 / existing `openDatabase`, WebdriverIO + Tauri e2e, existing `sessionService` memory WS APIs, React Settings testids.

**Spec:** [`docs/superpowers/specs/2026-07-11-memory-real-e2e-spec.md`](../specs/2026-07-11-memory-real-e2e-spec.md)  
**Overview:** [`docs/superpowers/plans/2026-07-11-memory-real-e2e-test-plan.md`](./2026-07-11-memory-real-e2e-test-plan.md)

**Out of scope:** Wave D, prompt quality benches, default CI paid embeddings, product “Extract now” button, replacing A1 matrix.

---

## Dependency graph

```text
PR-T0  idleMinutes=0 semantics
  │
  ├──────────────► PR-T1  process.e2e.test.ts (file DB)
  │
  └──────────────► PR-T2  __hipE2E + WDIO @memory
                      │
                      └──────────────► PR-T3  live-memory + docs
```

**Merge order:** T0 → T1 → T2 → T3（T1 与 T2 在 T0 之后可并行，但建议串行减少冲突）。

---

## File map (all PRs)

### Create

```
packages/sidecar/src/memory/process.e2e.test.ts
e2e/helpers/memory.ts
e2e/specs/memory-settings.spec.ts
e2e/specs/memory-slash.spec.ts
e2e/specs/memory-citations-harness.spec.ts
e2e/specs/live-memory.spec.ts
```

### Modify

```
packages/sidecar/src/memory/pipeline/queue.ts          # only if T0 needs fix
packages/sidecar/src/memory/pipeline/queue.test.ts     # or matrix addenda
packages/sidecar/src/memory/e2e.integration.test.ts    # merge into process / delete
src/domain/sessionService.ts                          # HipE2EHooks
e2e/helpers/e2e-hooks.ts
e2e/page-objects/SettingsPage.ts
e2e/specs/settings-smoke.spec.ts                      # optional memory nav
wdio.conf.ts                                          # stage memory.json on live
e2e/README.md
docs/superpowers/specs/2026-07-11-memory-real-e2e-spec.md   # status
docs/superpowers/plans/2026-07-11-memory-real-e2e-test-plan.md
```

### Do not delete

```
packages/sidecar/src/memory/integration.matrix.test.ts
packages/sidecar/src/memory/*.test.ts                 # unit suite
```

---

# PR-T0 — Lock idleMinutes=0 extract scheduling

**Branch suggestion:** `test/memory-e2e-t0-idle`  
**Commit style:** `test(memory): lock idleMinutes=0 Phase1 scheduling`

## Task T0.1: Document + unit-test idle=0

**Files:**
- Modify: `packages/sidecar/src/memory/pipeline/queue.ts` (only if broken)
- Modify or create: `packages/sidecar/src/memory/pipeline/queue.test.ts`
- Optional comment: `packages/protocol/src/memory-types.ts` on `idleMinutes`

**Current code (expected behavior):**

```ts
const idleMs = (config.idleMinutes ?? 15) * 60_000
// idleMinutes === 0 → setTimeout(fn, 0) → ASAP enqueue
```

- [ ] **Step 1: Confirm behavior with a focused test**

```ts
// queue.test.ts (sketch)
it('idleMinutes 0 schedules extract on next timer turn', async () => {
  vi.useFakeTimers()
  // host + spy createDefaultMemoryLlmClient / maybeEnqueue
  scheduleMemoryExtractAfterTurn(host)
  expect(createClientCalls).toBe(0)
  await vi.advanceTimersByTimeAsync(0)
  await processQueue()
  expect(createClientCalls).toBe(1)
})

it('idleMinutes 0 still debounces two schedules into one', async () => {
  vi.useFakeTimers()
  scheduleMemoryExtractAfterTurn(host)
  scheduleMemoryExtractAfterTurn(host)
  await vi.advanceTimersByTimeAsync(0)
  await processQueue()
  expect(createClientCalls).toBe(1)
})
```

- [ ] **Step 2: If product code treats 0 as falsy (`idleMinutes || 15`), fix to `?? 15` only**

Search for any `idleMinutes ||` and correct.

- [ ] **Step 3: minExtractIntervalHours 0**

```ts
it('minExtractIntervalHours 0 does not block immediate re-enqueue after success', async () => {
  // recordExtractSuccess; schedule with interval 0; should enqueue again
})
```

- [ ] **Step 4: Run**

```bash
yarn test packages/sidecar/src/memory/pipeline/queue.test.ts
# or the file that owns the new tests
yarn test packages/sidecar/src/memory/integration.matrix.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/memory/pipeline/ packages/protocol/src/memory-types.ts
git commit -m "$(cat <<'EOF'
test(memory): lock idleMinutes=0 Phase1 scheduling semantics

E2E and live suites need immediate extract debounce without changing
the production default of 15 minutes.
EOF
)"
```

### PR-T0 acceptance checklist

- [ ] T0.1–T0.3 from Spec §7.2 green  
- [ ] Defaults still 15 / 6  
- [ ] No network  

---

# PR-T1 — L1 process E2E (file DB)

**Branch suggestion:** `test/memory-e2e-t1-process`  
**Depends on:** PR-T0  
**Commit style:** `test(memory): process e2e on file-backed hip.db`

## Task T1.1: Scaffold `process.e2e.test.ts`

**Files:**
- Create: `packages/sidecar/src/memory/process.e2e.test.ts`
- Modify: `packages/sidecar/src/memory/e2e.integration.test.ts` (delete content and re-export, or delete file)

- [ ] **Step 1: Shared fixture**

```ts
// process.e2e.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'
import { MemoryService } from './service.js'
import { handleMemoryMessage } from './handlers.js'
// pipeline imports as needed

function openFileMemDb(dir: string) {
  const dbPath = join(dir, 'hip.db')
  const opened = openDatabase(dbPath)
  return {
    dbPath,
    db: opened.db,
    store: new MemoryStore(opened.db, opened.memoriesFtsEnabled, opened.memoriesVecEnabled),
    fts: opened.memoriesFtsEnabled,
    vec: opened.memoriesVecEnabled,
  }
}
```

- [ ] **Step 2: beforeEach — temp dir + `HIP_MEMORY_CONFIG_PATH` + service**

```ts
dir = mkdtempSync(join(tmpdir(), 'hip-mem-proc-'))
configPath = join(dir, 'memory.json')
process.env.HIP_MEMORY_CONFIG_PATH = configPath
// openFileMemDb(dir); new MemoryService(store, { configPath, createEmbeddingClient?: ... })
```

- [ ] **Step 3: afterEach — reset queue, env, rm dir, restore timers/mocks**

---

## Task T1.2: M1.1–M1.5 config / CRUD / core

- [ ] **M1.1 setConfig 落盘**

```ts
svc.setConfig({ useMemories: true, generateMemories: true, idleMinutes: 0 })
expect(existsSync(configPath)).toBe(true)
const disk = JSON.parse(readFileSync(configPath, 'utf8'))
expect(disk.useMemories).toBe(true)
expect(svc.getConfig().idleMinutes).toBe(0)
```

- [ ] **M1.2 soft delete + restore** (mirror A1.7 but file DB + service API)

- [ ] **M1.3 emptyTrash** via `handleMemoryMessage` or service

- [ ] **M1.4 flags** — if full session store heavy, minimal: call handler `session:setMemoryFlags` with mock ctx that writes config JSON on a fake session row; **or** document skip and cover only in handlers.test (prefer one process-level flags test)

- [ ] **M1.5** pinned upsert → `loadCoreSnapshot` contains title

---

## Task T1.3: M1.6–M1.9 mock pipeline

- [ ] **M1.6** Phase2 mock items with `sourceSessionId` → `deleteBySourceSession` hard → undefined

- [ ] **M1.7** `idleMinutes: 0`, `minExtractIntervalHours: 0`, spy LLM, long transcript, `scheduleMemoryExtractAfterTurn` + real/fake timers → stage1 row

```ts
vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockReturnValue({
  completeJson: async () => ({
    raw_memory: '- Prefer yarn (process-e2e-token)',
    rollout_summary: 'prefs',
  }),
})
```

- [ ] **M1.8** `runPhase2Consolidate` or `memory:consolidate` handler → items

- [ ] **M1.9** `maxExtractsPerDay: 1` → second extract skipped / not counted twice incorrectly

---

## Task T1.4: M1.10–M1.12 hybrid + citations + cleanup

- [ ] **M1.10** mock embed + `hybridSearchEnabled: true`；若 `!store.isVecEnabled()`：

```ts
it.skipIf(!vecEnabled)('M1.10 hybrid ranks semantic neighbor first', async () => { ... })
// plus always-on:
it('M1.10b reports vecEnabled from index status', () => {
  expect(typeof svc.getIndexStatus().vecEnabled).toBe('boolean')
})
```

- [ ] **M1.11** hybrid false, no embeddingModel → FTS hit

- [ ] **M1.12** citations: prefer existing `citations.test.ts` path; if process file includes message persist, assert strip + JSON column — **do not** reimplement parser

- [ ] **Optional M1.13** export/import round-trip

- [ ] **Retire** light `e2e.integration.test.ts` (merge into M1.5 or delete)

---

## Task T1.5: Run + commit

- [ ] **Run**

```bash
yarn test packages/sidecar/src/memory/process.e2e.test.ts
yarn test packages/sidecar/src/memory/integration.matrix.test.ts
```

Expected: PASS, no network.

- [ ] **Commit**

```bash
git add packages/sidecar/src/memory/process.e2e.test.ts packages/sidecar/src/memory/e2e.integration.test.ts
git commit -m "$(cat <<'EOF'
test(memory): add file-backed process e2e suite

Cover config persistence, trash, mock Phase1/2, and FTS/hybrid
degrade paths on a real hip.db file without network calls.
EOF
)"
```

### PR-T1 acceptance checklist

- [ ] Spec §8.2 must-have scenarios green  
- [ ] At least one test uses file `hip.db`  
- [ ] A1 matrix still green  
- [ ] No paid LLM  

---

# PR-T2 — __hipE2E hooks + L2 WDIO `@memory`

**Branch suggestion:** `test/memory-e2e-t2-wdio`  
**Depends on:** PR-T0（hooks 不强制 T1，但建议 T1 先合）  
**Commit style:** split 2 commits if large: hooks, then specs

## Task T2.1: Extend `HipE2EHooks`

**Files:**
- Modify: `src/domain/sessionService.ts`
- Modify: `e2e/helpers/e2e-hooks.ts`

- [ ] **Step 1: Extend type**

```ts
// sessionService.ts — HipE2EHooks
getMemoryConfig: () => Promise<MemoryFileConfig>
setMemoryConfig: (partial: Partial<MemoryFileConfig>) => Promise<MemoryFileConfig>
seedMemoryItem: (item: Partial<MemoryItem> & Pick<MemoryItem, 'title' | 'content' | 'kind' | 'scope'>) => Promise<MemoryItem>
listMemories: (filter?: { status?: MemoryStatus; limit?: number; query?: string }) => Promise<MemoryItem[]>
restoreMemory?: (id: string) => Promise<MemoryItem | null>
deleteMemory?: (id: string, hard?: boolean) => Promise<{ id: string; ok: boolean }>
triggerMemoryConsolidate?: (projectKeyHash?: string) => Promise<void>
getActiveSessionMemoryFlags: () => {
  useMemories?: boolean
  generateMemories?: boolean
  incognito?: boolean
} | null
```

- [ ] **Step 2: Wire installE2eHooks**

Delegate to existing `svc.getMemoryConfig`, `setMemoryConfig`, `upsertMemory`, `listMemories`, `restoreMemory`, `deleteMemory`, `consolidateMemories` (actual method names in SessionService — match code).

```ts
getActiveSessionMemoryFlags: () => {
  const id = useDomainStore.getState().activeSessionId
  if (!id) return null
  const s = useDomainStore.getState().sessions[id]
  return {
    useMemories: s?.config?.useMemories,
    generateMemories: s?.config?.generateMemories,
    incognito: s?.config?.incognito,
  }
}
```

- [ ] **Step 3: Mirror helpers in `e2e/helpers/e2e-hooks.ts` + `e2e/helpers/memory.ts`**

```ts
// e2e/helpers/memory.ts
export async function openMemorySettings(): Promise<void> {
  await openSettings()
  const nav = await browser.$('[data-testid="settings-nav-memory"]')
  await nav.waitForClickable({ timeout: 10000 })
  await nav.click()
  await browser.$('[data-testid="memory-config-empty"], [data-testid="memory-config"]')
    .waitForExist({ timeout: 15000 })
}

export async function seedMemory(item: { title: string; content: string; kind?: string; scope?: string; pinned?: boolean }) {
  return browser.execute(async (payload) => {
    const hooks = (window as unknown as { __hipE2E?: any }).__hipE2E
    if (!hooks?.seedMemoryItem) throw new Error('seedMemoryItem missing')
    return hooks.seedMemoryItem(payload)
  }, item)
}
```

Note: `browser.execute` cannot pass async easily — prefer sync bridge that returns Promise if wdio supports, or use `browser.call` / expose sync-looking API that returns thenable via executeAsync. **Match patterns already used in e2e-hooks** (sync execute returning values). If seed is async WS, use:

```ts
export async function seedMemory(...) {
  return browser.executeAsync((payload, done) => {
    const hooks = (window as any).__hipE2E
    hooks.seedMemoryItem(payload).then((r: unknown) => done(r)).catch((e: Error) => done({ error: e.message }))
  }, item)
}
```

- [ ] **Step 4: SettingsPage.nav type**

```ts
nav(page: 'general' | 'model' | 'agents' | 'mcp' | 'skill' | 'plugins' | 'memory')
```

---

## Task T2.2: `memory-settings.spec.ts`

**Files:**
- Create: `e2e/specs/memory-settings.spec.ts`

- [ ] **Scaffold**

```ts
describe('memory settings @memory', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
  })
  // M2.1 open
  // M2.2 enable both
  // M2.4 seed unique title
  // M2.5 pin
  // M2.6 edit
  // M2.7 trash restore
  // M2.13 hybrid disabled without embed
})
```

- [ ] **Unique tokens:** `const token = \`m2-${Date.now()}\``

- [ ] **Prefer testid clicks** over i18n strings

---

## Task T2.3: `memory-slash.spec.ts`

- [ ] `/memory` → settings memory panel visible  
- [ ] `/memory-on` → `getActiveSessionMemoryFlags().useMemories === true`  
- [ ] `/memory-off` → false  

Use existing slash helpers patterns from `slash-commands.spec.ts` / `ChatPage`.

---

## Task T2.4: `memory-citations-harness.spec.ts`

- [ ] Create chat session via `__hipE2E`  
- [ ] `injectServerMessage` assistant message with `memoryCitations: [{ id, title }]` (match `Message` type)  
- [ ] Assert `[data-testid="memory-citations-chip"]` exists  

---

## Task T2.5: README + optional settings smoke

- [ ] Update `e2e/README.md` tags table with `@memory`  
- [ ] Optional: add `{ id: 'memory', label: ... }` to settings-smoke（label 以 i18n 实际文案为准，或只点 nav 不断言中文）  

- [ ] **Run**

```bash
# requires debug binary + vite
E2E_GREP=@memory yarn test:e2e
```

- [ ] **Commit**

```bash
git commit -m "$(cat <<'EOF'
test(e2e): memory settings, slash, and citations harness

Add __hipE2E memory hooks and unpaid @memory WDIO coverage for
Settings CRUD/trash, slash flags, and citation chips.
EOF
)"
```

### PR-T2 acceptance checklist

- [ ] Spec §9.2 hooks + §9.3 must-have UI scenarios  
- [ ] `E2E_GREP=@memory yarn test:e2e` green  
- [ ] Gate grep unchanged  
- [ ] PROD 无 `__hipE2E` memory 面（既有 PROD return）  

---

# PR-T3 — L3 live memory + docs

**Branch suggestion:** `test/memory-e2e-t3-live`  
**Depends on:** PR-T2（hooks + settings paths）  
**Commit style:** `test(e2e): live memory cross-session recall`

## Task T3.1: Stage accelerated `memory.json` for live

**Files:**
- Modify: `wdio.conf.ts` → `stageE2eData`

- [ ] **When `process.env.E2E_LIVE_LLM === '1'`**, write:

```ts
const memoryPath = path.join(configDir, 'memory.json')
fs.writeFileSync(
  memoryPath,
  JSON.stringify(
    {
      version: 1,
      useMemories: true,
      generateMemories: true,
      idleMinutes: 0,
      minExtractIntervalHours: 0,
      maxExtractsPerDay: 50,
      hybridSearchEnabled: false,
    },
    null,
    2,
  ),
)
```

**Caveat:** Sidecar must read this path under `HIP_DATA_DIR`. Confirm hip resolves `memory.json` under data dir config (same as `HIP_MEMORY_CONFIG_PATH` / production `~/.hip/config`). If e2e only sets `HIP_DATA_DIR`, verify memory config path joins that dir — **adjust env** if needed:

```ts
process.env.HIP_MEMORY_CONFIG_PATH = memoryPath
```

（若 production 已从 HIP_DATA_DIR 推导，则不必。）

---

## Task T3.2: `live-memory.spec.ts`

**Files:**
- Create: `e2e/specs/live-memory.spec.ts`

```ts
const LIVE = process.env.E2E_LIVE_LLM === '1'

;(LIVE ? describe : describe.skip)('live memory cross-session @live @memory', () => {
  const token = `HIP_E2E_MEM_${Date.now()}`

  it('M3.1 teaches a unique preference and persists a memory item', async () => {
    // ensure use+generate (staged or setMemoryConfig via hook)
    // multi-turn: "Remember package manager preference: always yarn not npm. Token: ${token}"
    // poll listMemories until title/content includes token OR timeout 180s
  })

  it('M3.2 new session recalls preference', async () => {
    // new session, use on
    // ask: "What package manager should we use? Mention any memory token if present."
    // hard/semi: list still has token; optional soft: reply matches /yarn/i
    // optional: citations chip
  })
})
```

- [ ] **Hard assert first:** `listMemories` contains token after M3.1  
- [ ] **M3.2 semi-hard:** if hooks can expose last inject / skip if unavailable; at minimum list still active + assistant non-empty  
- [ ] **Do not fail solely on prose** if hard assert passed and reply empty edge — document  

- [ ] **Timeouts:** mocha already 180s; inner waitUntil up to 180s for extract  

---

## Task T3.3: Docs + status

- [ ] `e2e/README.md` — live memory command, cost note, tags  
- [ ] Spec status → `Implemented (partial)` or full when M3.1–2 verified  
- [ ] Overview plan §12 checklist mark done items  
- [ ] This plan PR-T3 tasks checked  

```bash
# Documented command
E2E_LIVE_LLM=1 E2E_GREP=@live.*memory yarn test:e2e --spec e2e/specs/live-memory.spec.ts
```

- [ ] **Commit**

```bash
git commit -m "$(cat <<'EOF'
test(e2e): add opt-in live memory cross-session suite

Stage accelerated memory.json under E2E_LIVE_LLM and cover teach →
new-session recall with unique tokens and hard list assertions.
EOF
)"
```

### PR-T3 acceptance checklist

- [ ] Self-skip without `E2E_LIVE_LLM`  
- [ ] Auth copy path unchanged  
- [ ] Docs complete  
- [ ] Manual green note (maintainer) for M3.1+M3.2  

---

## Cross-PR verification matrix

| Check | T0 | T1 | T2 | T3 |
|-------|----|----|----|-----|
| `yarn test` memory slice | ✓ | ✓ | — | — |
| A1 matrix still green | ✓ | ✓ | — | — |
| `E2E_GREP=@memory yarn test:e2e` | — | — | ✓ | — |
| `E2E_LIVE_LLM=1` … live-memory | — | — | — | ✓ |
| No default gate change | ✓ | ✓ | ✓ | ✓ |
| No secrets in repo | ✓ | ✓ | ✓ | ✓ |

---

## Suggested local order for a single agent

1. Land **T0** (small, unblocks timers)  
2. Land **T1** (no UI binary needed)  
3. Land **T2** (needs `yarn tauri build --debug` + e2e)  
4. Land **T3** (needs auth.json + paid calls; can draft skip suite earlier)

---

## Open items (do not block T0–T2)

| Item | Notes |
|------|-------|
| Promote `@memory` into `test:e2e:gate` | After 1 week flake-free |
| Sidecar child-process E2E | Only if handlers-only misses a real WS bug |
| `HIP_MEMORY_E2E=1` auto-fixture LLM | Optional; prefer mock inject in tests |
| M3.6 hybrid live | Separate follow-up |
| DeleteSession derived-memory e2e | Optional M2.15 |

---

## Revision history

| Date | Change |
|------|--------|
| 2026-07-11 | Initial all-PR plan (T0–T3) with checkbox tasks |
