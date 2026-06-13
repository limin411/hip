# Agent Loop P2 — 韧性层 + HITL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four production-grade control knobs to P1's single LangGraph ReAct loop — doom-loop detection (nudge-once-then-ask), human-in-the-loop interrupt/resume (cooperative message-replay, no checkpointer), retry/backoff, and auto-compaction.

**Architecture:** New self-contained modules `doom-loop.ts` / `retry.ts` / `compaction.ts` hold the pure logic (each unit-tested with fakes). `graph.ts` gains `compact`/`nudge`/`pause` nodes and four state channels. `session.ts`'s `runTurn` is refactored to accept an optional `base` (first turn vs. resume share one driver); a doom-loop pause finalizes the turn as `stopped`, emits `agent:interrupt`, and a `message:resume` re-invokes a fresh turn carrying the stashed rich message list + step count. Two new protocol messages and a minimal frontend interrupt bubble.

**Tech Stack:** TypeScript, `@langchain/langgraph` 1.4.2 (`StateGraph`, `messagesStateReducer`, `RemoveMessage`), `@langchain/openai` (`ChatOpenAI`), `@langchain/core` messages, Vitest, Zustand v5, React.

**Spec:** `docs/superpowers/specs/2026-06-13-agent-loop-p2-design.md` (read it once for the decisions D1–D4 / J1–J5; this plan implements it).

---

## ⚠️ Test-safety preamble (READ FIRST — this machine has a live DeepSeek key)

A real API key lives at `~/.hip/config/auth.json`. Several test files make **paid real-LLM calls**. To avoid burning money:

- **NEVER** run a bare `vitest run`, `vitest run src`, `vitest run packages`, or any directory/substring glob. These fire the paid suites.
- **NEVER** run `packages/sidecar/src/session/session.test.ts` or `packages/sidecar/src/session/reasoner-reasoning.integration.test.ts` — both are PAID.
- **ALWAYS** run vitest with an **explicit file path**, from the **repo root**:
  ```bash
  npx vitest run packages/sidecar/src/session/<file>.test.ts
  ```
- Type-check commands:
  - Sidecar: `cd packages/sidecar && npx tsc --noEmit` (run from the sidecar dir).
  - Frontend / protocol: `npm run type-check` (repo root; runs `tsc --noEmit` over the app, which includes `@hip/protocol` via tsconfig paths).
- All new tests in this plan use **injected fakes** (fake `ModelRunner`, fake `Summarizer`, fake transport) and make **zero** network calls.

`@hip/protocol` is consumed as source (`main`/`types` → `src/index.ts`, tsconfig paths → `src`), so editing it needs **no build step**.

---

## File Structure

**New (sidecar):**
- `packages/sidecar/src/session/doom-loop.ts` — `sigOf`, `trailingRepeatCount`, thresholds, nudge/pause text.
- `packages/sidecar/src/session/retry.ts` — `withRetry`, `isRetryable`, `parseRetryAfter`, `MAX_RETRIES`.
- `packages/sidecar/src/session/compaction.ts` — `estimateTokens`, `compactMessages`, `Summarizer`, budget consts.

**New tests:** `doom-loop.test.ts`, `retry.test.ts`, `compaction.test.ts`, `packages/sidecar/src/config/providers.test.ts`.

**Modified (sidecar):** `model-runner.ts` (retry wrap), `graph.ts` (nodes/state/routing), `session.ts` (runTurn `base` + pause/resume + summarizer), `session-manager.ts` (route resume), `config/providers.ts` (`cheapModelFor`), `loop-control.ts` (recursionLimit).

**Modified (protocol):** `packages/protocol/src/index.ts` (+`agent:interrupt`, +`message:resume`).

**Modified (frontend):** `src/domain/sessionStore.ts`, `src/domain/sessionService.ts`, `src/domain/hooks.ts`, `src/components/chat/ChatPane.tsx`, `src/i18n/{en,zh-CN,zh-TW}.ts`.

**Constants live with their owning module** (not in `loop-control.ts`): doom-loop consts → `doom-loop.ts`; compaction consts → `compaction.ts`; retry default → `retry.ts`.

**Execution order (dependencies):** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. (5 needs 1+3; 6 needs 4+5; 7 needs 4+6; 8 needs 4.)

---

### Task 1: Doom-loop signatures (`doom-loop.ts`)

**Files:**
- Create: `packages/sidecar/src/session/doom-loop.ts`
- Test: `packages/sidecar/src/session/doom-loop.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/doom-loop.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { sigOf, trailingRepeatCount, DOOM_LOOP_N } from './doom-loop.js'

describe('doom-loop signatures', () => {
  it('identical calls produce identical signatures', () => {
    const a = sigOf([{ name: 'read_file', args: { path: '/a.txt' } }])
    const b = sigOf([{ name: 'read_file', args: { path: '/a.txt' } }])
    expect(a).toBe(b)
  })

  it('different args produce different signatures', () => {
    const a = sigOf([{ name: 'read_file', args: { path: '/a.txt' } }])
    const b = sigOf([{ name: 'read_file', args: { path: '/b.txt' } }])
    expect(a).not.toBe(b)
  })

  it('trailingRepeatCount counts only the consecutive tail run', () => {
    const s = sigOf([{ name: 'ls', args: { path: '/' } }])
    const other = sigOf([{ name: 'ls', args: { path: '/sub' } }])
    expect(trailingRepeatCount([s, s, s], s)).toBe(3)
    expect(trailingRepeatCount([s, other, s, s], s)).toBe(2) // streak broken by `other`
    expect(trailingRepeatCount([s, s, other], s)).toBe(0)    // tail is not `s`
  })

  it('the threshold constant is 3', () => {
    expect(DOOM_LOOP_N).toBe(3)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run packages/sidecar/src/session/doom-loop.test.ts`
Expected: FAIL ("Cannot find module './doom-loop.js'").

- [ ] **Step 3: Implement `doom-loop.ts`**

Create `packages/sidecar/src/session/doom-loop.ts`:
```ts
/** Doom-loop detection: an identical batch of tool calls repeated N times in a row. */

export const DOOM_LOOP_N = 3

/** How many recent EXECUTED batch signatures to retain for the consecutive-repeat check. */
export const SIG_WINDOW = 6

/** Corrective note injected after the Nth identical batch, before the next model turn. */
export const DOOM_LOOP_NUDGE =
  '你已经用完全相同的参数重复调用了同一个工具多次，但没有取得进展。' +
  '请停止重复——换一种完全不同的方法，或者如果确实无法继续，就直接用文字说明情况并结束。'

/** Question shown to the user when the loop is still stuck after the nudge. */
export const PAUSE_QUESTION =
  '我反复在做同一个操作但没有进展。需要你指个方向：换个思路、跳过这一步，还是先停下？'

interface ToolCallLike {
  name: string
  args: unknown
}

/** Stable signature for one batch of tool calls: each `name:JSON(args)`, sorted then joined.
 *  Identical repeated calls serialize identically, so equality detects a repeat regardless of how
 *  many calls the batch holds or their order. */
export function sigOf(calls: readonly ToolCallLike[]): string {
  return calls.map((c) => `${c.name}:${JSON.stringify(c.args)}`).sort().join('|')
}

/** How many of the most recent signatures (counting back from the tail) equal `sig`. */
export function trailingRepeatCount(sigs: readonly string[], sig: string): number {
  let n = 0
  for (let i = sigs.length - 1; i >= 0 && sigs[i] === sig; i--) n++
  return n
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run packages/sidecar/src/session/doom-loop.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check + commit**

```bash
cd packages/sidecar && npx tsc --noEmit && cd ../..
git add packages/sidecar/src/session/doom-loop.ts packages/sidecar/src/session/doom-loop.test.ts
git commit -m "feat(loop): doom-loop signature + repeat-count helpers"
```

---

### Task 2: Retry/backoff (`retry.ts`) + wire into the model runner

**Files:**
- Create: `packages/sidecar/src/session/retry.ts`
- Test: `packages/sidecar/src/session/retry.test.ts`
- Modify: `packages/sidecar/src/session/model-runner.ts`
- Test (extend): `packages/sidecar/src/session/model-runner.test.ts`

- [ ] **Step 1: Write the failing `retry.ts` test**

Create `packages/sidecar/src/session/retry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { withRetry, isRetryable, parseRetryAfter } from './retry.js'

const instant = async () => {}   // no real delay
const noJitter = () => 0

describe('isRetryable', () => {
  it('retries 429 / 5xx / overload', () => {
    expect(isRetryable({ status: 429 })).toBe(true)
    expect(isRetryable({ status: 503 })).toBe(true)
    expect(isRetryable({ status: 529 })).toBe(true)
  })
  it('does not retry 4xx auth/bad-request/context-overflow', () => {
    expect(isRetryable({ status: 400 })).toBe(false)
    expect(isRetryable({ status: 401 })).toBe(false)
    expect(isRetryable({ status: 403 })).toBe(false)
  })
  it('retries known network codes only', () => {
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true)
    expect(isRetryable(new Error('boom'))).toBe(false)
  })
})

describe('parseRetryAfter', () => {
  it('parses integer seconds to ms', () => {
    expect(parseRetryAfter({ headers: { 'retry-after': '2' } })).toBe(2000)
  })
  it('is undefined when absent', () => {
    expect(parseRetryAfter({ headers: {} })).toBeUndefined()
  })
})

describe('withRetry', () => {
  it('succeeds after transient failures', async () => {
    let calls = 0
    const out = await withRetry(async () => { calls++; if (calls < 3) throw { status: 503 }; return 'ok' }, { sleep: instant, random: noJitter })
    expect(out).toBe('ok')
    expect(calls).toBe(3)
  })
  it('gives up after maxRetries and rethrows', async () => {
    let calls = 0
    await expect(withRetry(async () => { calls++; throw { status: 503 } }, { maxRetries: 2, sleep: instant, random: noJitter }))
      .rejects.toEqual({ status: 503 })
    expect(calls).toBe(3) // initial + 2 retries
  })
  it('does not retry a non-retryable error', async () => {
    let calls = 0
    await expect(withRetry(async () => { calls++; throw { status: 400 } }, { sleep: instant })).rejects.toEqual({ status: 400 })
    expect(calls).toBe(1)
  })
  it('stops retrying once the signal is aborted', async () => {
    const ac = new AbortController()
    let calls = 0
    await expect(withRetry(async () => { calls++; ac.abort(); throw { status: 503 } }, { signal: ac.signal, sleep: instant }))
      .rejects.toEqual({ status: 503 })
    expect(calls).toBe(1)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run packages/sidecar/src/session/retry.test.ts`
Expected: FAIL ("Cannot find module './retry.js'").

- [ ] **Step 3: Implement `retry.ts`**

Create `packages/sidecar/src/session/retry.ts`:
```ts
/** Retry transient LLM-API failures with exponential backoff + jitter, honoring `retry-after`. */

export const MAX_RETRIES = 4
const BASE_MS = 1000
const MAX_WAIT_MS = 30_000

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529])
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'])

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; response?: { status?: number } } | null
  return e?.status ?? e?.statusCode ?? e?.response?.status
}

/** Transient = retryable: rate limit (429), 5xx/overload, or a network reset/timeout. NOT retryable:
 *  any other 4xx (incl. 400 context-overflow → compaction's job) and auth (401/403). */
export function isRetryable(err: unknown): boolean {
  const status = statusOf(err)
  if (status !== undefined) return RETRYABLE_STATUS.has(status)
  const code = (err as { code?: string } | null)?.code
  return code !== undefined && RETRYABLE_CODES.has(code)
}

function headerGet(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined
  const rec = headers as Record<string, string | undefined>
  return rec[name] ?? rec[name.toLowerCase()]
}

/** `retry-after` as ms: integer/decimal seconds, or an HTTP date. undefined if absent/unparseable. */
export function parseRetryAfter(err: unknown): number | undefined {
  const raw = headerGet((err as { headers?: unknown } | null)?.headers, 'retry-after')
  if (!raw) return undefined
  const secs = Number(raw)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

export interface RetryOpts {
  maxRetries?: number
  shouldRetry?: (err: unknown) => boolean
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>  // injectable (tests pass an instant sleep)
  random?: () => number                  // injectable jitter (tests pass () => 0)
}

/** Run `fn`, retrying transient failures with exponential backoff + jitter and `retry-after`.
 *  Never retries once the AbortSignal is aborted. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES
  const shouldRetry = opts.shouldRetry ?? isRetryable
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const random = opts.random ?? Math.random
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      if (opts.signal?.aborted) throw err
      if (attempt >= maxRetries || !shouldRetry(err)) throw err
      const backoff = BASE_MS * 2 ** attempt
      const wait = Math.min(MAX_WAIT_MS, Math.max(parseRetryAfter(err) ?? 0, backoff + backoff * 0.25 * random()))
      await sleep(wait)
      attempt++
    }
  }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run packages/sidecar/src/session/retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing model-runner retry test**

Append to `packages/sidecar/src/session/model-runner.test.ts` (after the existing `describe('delta extractors', …)` block; add `RealModelRunner` to the existing `./model-runner.js` import):
```ts
import { RealModelRunner } from './model-runner.js'

describe('RealModelRunner retry', () => {
  const opts = () => ({ tools: [], bindTools: true, onText: () => {}, onReasoning: () => {} })

  it('retries a transient pre-stream failure then succeeds', async () => {
    let calls = 0
    const model: any = {
      bindTools() { return model },
      async stream() {
        calls++
        if (calls <= 2) { const e: any = new Error('transient'); e.status = 503; throw e }
        return (async function* () { yield new AIMessageChunk({ content: 'hi' }) })()
      },
    }
    const msg = await new RealModelRunner(model).run([], opts() as any)
    expect(typeof msg.content === 'string' ? msg.content : '').toBe('hi')
    expect(calls).toBe(3)
  })

  it('does not retry after a delta has already been emitted', async () => {
    let calls = 0
    const model: any = {
      bindTools() { return model },
      async stream() {
        calls++
        return (async function* () {
          yield new AIMessageChunk({ content: 'partial' })
          const e: any = new Error('mid-stream'); e.status = 503; throw e
        })()
      },
    }
    await expect(new RealModelRunner(model).run([], opts() as any)).rejects.toThrow()
    expect(calls).toBe(1)
  })
})
```

- [ ] **Step 6: Run it — expect FAIL**

Run: `npx vitest run packages/sidecar/src/session/model-runner.test.ts`
Expected: FAIL (current `RealModelRunner.run` does not retry; the first test sees `calls === 1` and the stream throw propagates).

- [ ] **Step 7: Wire retry into `RealModelRunner.run`**

In `packages/sidecar/src/session/model-runner.ts`, add the import near the top (next to the `MAX_STEPS_NOTE` import):
```ts
import { withRetry, isRetryable, MAX_RETRIES } from './retry.js'
```
Replace the entire `run` method body of `RealModelRunner` with:
```ts
  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    const bound = opts.bindTools ? this.model.bindTools(opts.tools) : this.model
    const input: BaseMessage[] = opts.bindTools ? messages : [...messages, new SystemMessage(MAX_STEPS_NOTE)]
    let emitted = false
    const attempt = async (): Promise<AIMessage> => {
      const stream = await bound.stream(input, { signal: opts.signal })
      let gathered: AIMessageChunk | undefined
      for await (const chunk of stream) {
        gathered = gathered ? (concat(gathered, chunk) as AIMessageChunk) : chunk
        const t = textDelta(chunk)
        if (t) { emitted = true; opts.onText(t) }
        const r = reasoningDelta(chunk)
        if (r) { emitted = true; opts.onReasoning(r) }
      }
      if (!gathered) throw new Error('model produced no output')
      return gathered as AIMessage
    }
    // Retry only transient failures thrown BEFORE the first delta — retrying mid-stream would
    // duplicate already-emitted tokens. Once `emitted` is true, shouldRetry returns false → rethrow.
    return withRetry(attempt, { maxRetries: MAX_RETRIES, signal: opts.signal, shouldRetry: (e) => !emitted && isRetryable(e) })
  }
```

- [ ] **Step 8: Run it — expect PASS (both new + existing extractor tests)**

Run: `npx vitest run packages/sidecar/src/session/model-runner.test.ts`
Expected: PASS (all tests).

- [ ] **Step 9: Type-check + commit**

```bash
cd packages/sidecar && npx tsc --noEmit && cd ../..
git add packages/sidecar/src/session/retry.ts packages/sidecar/src/session/retry.test.ts packages/sidecar/src/session/model-runner.ts packages/sidecar/src/session/model-runner.test.ts
git commit -m "feat(loop): retry transient model failures with backoff before first delta"
```

---

### Task 3: Auto-compaction (`compaction.ts`) + `cheapModelFor`

**Files:**
- Create: `packages/sidecar/src/session/compaction.ts`
- Test: `packages/sidecar/src/session/compaction.test.ts`
- Modify: `packages/sidecar/src/config/providers.ts`
- Test: `packages/sidecar/src/config/providers.test.ts`

- [ ] **Step 1: Write the failing `compaction.ts` test**

Create `packages/sidecar/src/session/compaction.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import { estimateTokens, compactMessages, type Summarizer } from './compaction.js'

const fakeSummarizer = (capture?: (m: BaseMessage[]) => void): Summarizer => ({
  async summarize(m) { capture?.(m); return '摘要内容' },
})

describe('estimateTokens', () => {
  it('counts chars / 3 across messages', () => {
    expect(estimateTokens([new HumanMessage('123456')])).toBe(2)
  })
})

describe('compactMessages', () => {
  const build = (): BaseMessage[] => [
    new SystemMessage({ id: 'sys', content: 'you are hip' }),
    new HumanMessage({ id: 'u1', content: '原始目标：做个网页' }),
    new AIMessage({ id: 'a1', content: '老的中间回复' }),
    new HumanMessage({ id: 'u2', content: '中间追问' }),
    new AIMessage({ id: 'a2', content: '中间回复' }),
    new HumanMessage({ id: 'u3', content: '最近的问题' }),
    new AIMessage({ id: 'a3', content: '最近的回复' }),
  ]

  it('pins system + first user + recent K turns and summarizes the middle', async () => {
    let seen: BaseMessage[] = []
    const result = await compactMessages(build(), { keepRecentTurns: 1, summarizer: fakeSummarizer((m) => { seen = m }) })
    expect(result).not.toBeNull()
    // keepRecentTurns=1 → recent span starts at u3; middle = [a1, u2, a2]
    expect(seen.map((m) => m.id)).toEqual(['a1', 'u2', 'a2'])
    expect(result!.summary.id).toBe('a1')   // replace-in-place at the middle head
    expect(typeof result!.summary.content === 'string' ? result!.summary.content : '').toContain('[对话摘要]')
    expect(result!.removeIds).toEqual(['u2', 'a2'])
  })

  it('returns null when there is no middle (too few turns)', async () => {
    const few: BaseMessage[] = [
      new SystemMessage({ id: 'sys', content: 's' }),
      new HumanMessage({ id: 'u1', content: 'goal' }),
      new AIMessage({ id: 'a1', content: 'reply' }),
    ]
    expect(await compactMessages(few, { keepRecentTurns: 3, summarizer: fakeSummarizer() })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run packages/sidecar/src/session/compaction.test.ts`
Expected: FAIL ("Cannot find module './compaction.js'").

- [ ] **Step 3: Implement `compaction.ts`**

Create `packages/sidecar/src/session/compaction.ts`:
```ts
import { SystemMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'

/** Compact when the estimated prompt exceeds this. Conservative: the sidecar cannot read the active
 *  model's real context window (config/providers.ts carries none), so assume a ~64k floor and keep
 *  ~16k headroom for the reply. `buildGraph` can override it (tests pass a tiny value). */
export const COMPACT_BUDGET_TOKENS = 48_000

/** Turns kept verbatim at the tail. A turn = a user message and everything up to the next one. */
export const KEEP_RECENT_TURNS = 3

/** No tokenizer in-stack → char heuristic. /3 over-estimates English (≈4 ch/tok) but fits dense
 *  CJK/code, so it triggers a little early rather than too late. */
const CHARS_PER_TOKEN = 3

/** Summarizes a span of messages into a short note. Injected so compaction is unit-testable. */
export interface Summarizer {
  summarize(messages: BaseMessage[]): Promise<string>
}

function textOf(m: BaseMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) return m.content.map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? ''))).join('')
  return ''
}

export function estimateTokens(messages: readonly BaseMessage[]): number {
  let chars = 0
  for (const m of messages) chars += textOf(m).length
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

export interface CompactResult {
  /** SystemMessage carrying the summary, id = the middle head's id (replace-in-place keeps order). */
  summary: BaseMessage
  /** ids of the rest of the middle to delete via RemoveMessage. */
  removeIds: string[]
}

/** Plan a compaction: pin system + first user message (the goal) + the recent K turns; summarize the
 *  span between. Cuts only at user-message (turn) boundaries, so an assistant↔tool pair is never
 *  split (no orphan tool messages). Returns null when there is no middle worth compacting. `messages`
 *  must have ids (LangGraph assigns them in state). */
export async function compactMessages(
  messages: BaseMessage[],
  opts: { keepRecentTurns: number; summarizer: Summarizer },
): Promise<CompactResult | null> {
  const firstHumanIdx = messages.findIndex((m) => m instanceof HumanMessage)
  if (firstHumanIdx === -1) return null
  const humanIdxs: number[] = []
  messages.forEach((m, i) => { if (m instanceof HumanMessage) humanIdxs.push(i) })
  if (humanIdxs.length <= opts.keepRecentTurns) return null
  const recentStart = humanIdxs[humanIdxs.length - opts.keepRecentTurns]
  const middle = messages.slice(firstHumanIdx + 1, recentStart)
  if (middle.length === 0) return null
  const headId = middle[0].id
  if (!headId) return null
  const text = await opts.summarizer.summarize(middle)
  return {
    summary: new SystemMessage({ id: headId, content: `[对话摘要] ${text}` }),
    removeIds: middle.slice(1).map((m) => m.id).filter((id): id is string => !!id),
  }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run packages/sidecar/src/session/compaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `cheapModelFor` test**

Create `packages/sidecar/src/config/providers.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { cheapModelFor } from './providers.js'

describe('cheapModelFor', () => {
  it('maps deepseek to its cheap chat model', () => {
    expect(cheapModelFor('deepseek', 'deepseek-reasoner')).toBe('deepseek-chat')
  })
  it('falls back to the active model for unknown providers', () => {
    expect(cheapModelFor('acme', 'acme-large')).toBe('acme-large')
  })
})
```

- [ ] **Step 6: Run it — expect FAIL**

Run: `npx vitest run packages/sidecar/src/config/providers.test.ts`
Expected: FAIL ("cheapModelFor is not a function" / not exported).

- [ ] **Step 7: Add `cheapModelFor` to `providers.ts`**

Append to `packages/sidecar/src/config/providers.ts`:
```ts
/** Cheap model for a provider's auxiliary calls (titles, compaction summaries). Falls back to the
 *  caller's active model when the provider has no known cheaper variant. */
const CHEAP_MODEL: Record<string, string> = { deepseek: 'deepseek-chat' }
export function cheapModelFor(providerID: string, fallbackModelID: string): string {
  return CHEAP_MODEL[providerID] ?? fallbackModelID
}
```

- [ ] **Step 8: Run it — expect PASS**

Run: `npx vitest run packages/sidecar/src/config/providers.test.ts`
Expected: PASS.

- [ ] **Step 9: Type-check + commit**

```bash
cd packages/sidecar && npx tsc --noEmit && cd ../..
git add packages/sidecar/src/session/compaction.ts packages/sidecar/src/session/compaction.test.ts packages/sidecar/src/config/providers.ts packages/sidecar/src/config/providers.test.ts
git commit -m "feat(loop): compaction planner (pin goal, summarize middle) + cheap-model map"
```

---

### Task 4: Protocol — `agent:interrupt` + `message:resume`

**Files:**
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Add the ServerMessage variant**

In `packages/protocol/src/index.ts`, inside the `ServerMessage` union, add after the `message:complete` line:
```ts
  | { type: 'agent:interrupt'; sessionId: string; turnId: string; agentId: string; question: string; context?: string }
```

- [ ] **Step 2: Add the ClientMessage variant**

In the `ClientMessage` union, add after the `message:regenerate` line:
```ts
  | { type: 'message:resume'; sessionId: string; content: string }
```

- [ ] **Step 3: Type-check**

Run (repo root): `npm run type-check`
Expected: PASS (no consumers yet — the union just grows). If the sidecar is also worth checking now: `cd packages/sidecar && npx tsc --noEmit && cd ../..` (PASS).

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): add agent:interrupt (server) and message:resume (client)"
```

---

### Task 5: Graph — `compact` / `nudge` / `pause` nodes + doom-loop routing

**Files:**
- Modify: `packages/sidecar/src/session/graph.ts` (full rewrite below)
- Modify: `packages/sidecar/src/session/loop-control.ts` (`recursionLimit` bump)
- Test (rewrite): `packages/sidecar/src/session/graph.test.ts`

- [ ] **Step 1: Bump `recursionLimit` (each loop is now 3 node visits)**

In `packages/sidecar/src/session/loop-control.ts`, replace the body of `recursionLimit`:
```ts
/** LangGraph recursion limit. Each model turn now visits ~3 nodes (compact + agent + tools), plus
 *  occasional nudge/pause detours, so reserve headroom above 3*MAX_STEPS; our own step cap (not this
 *  limit) is the real stop condition. */
export function recursionLimit(): number {
  return MAX_STEPS * 3 + 10
}
```
Update `packages/sidecar/src/session/loop-control.test.ts` — change the asserted `recursionLimit()` expectation to `MAX_STEPS * 3 + 10` (find the existing assertion that checks the number and update it to `expect(recursionLimit()).toBe(MAX_STEPS * 3 + 10)`; if it imports `MAX_STEPS`, keep that, else assert `85`).

- [ ] **Step 2: Rewrite the graph test (existing 3 tests get a summarizer in ctx; add doom-loop + compaction)**

Replace the entire contents of `packages/sidecar/src/session/graph.test.ts` with:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, SystemMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { buildTools } from './tools.js'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'

/** Fake runner: returns the scripted message for each successive turn (clamps to the last). */
function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {} }
const noopSummarizer: Summarizer = { async summarize() { return '' } }
const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-graph-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

describe('agent loop graph', () => {
  it('stops immediately when the model returns a plain text answer', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('你好，我是助手')])
      const out = await app.invoke(
        { messages: [new HumanMessage('你是谁')], steps: 0 },
        { configurable: { ctx: { runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } } },
      )
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('你好，我是助手')
      expect(out.steps).toBe(1)
    })
  })

  it('executes a write_file tool call then loops back and finishes', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/index.html', content: '<h1>me</h1>' }, id: 'c1' }] }),
        new AIMessage('已创建 /index.html'),
      ])
      const started: string[] = []
      const out = await app.invoke(
        { messages: [new HumanMessage('做个 HTML 自我介绍')], steps: 0 },
        { configurable: { ctx: { runner, tools: buildTools(root), emit: { ...noopEmit, toolStarted: (n: string) => started.push(n) }, summarizer: noopSummarizer } } },
      )
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toBe('<h1>me</h1>')
      expect(started).toContain('write_file')
      expect(out.steps).toBe(2)
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('已创建 /index.html')
    })
  })

  it('terminates at the step cap even if the model keeps requesting tools', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(2) // tiny cap
      const loopMsg = new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
      const out = await app.invoke(
        { messages: [new HumanMessage('spin')], steps: 0 },
        { configurable: { ctx: { runner: fakeRunner([loopMsg]), tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 50 },
      )
      expect(out.steps).toBeLessThanOrEqual(2)
    })
  })

  it('nudges once then pauses (awaiting_user) on a repeated identical tool call', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const loop = () => new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
      const out = await app.invoke(
        { messages: [new HumanMessage('一直 ls')], steps: 0 },
        { configurable: { ctx: { runner: fakeRunner([loop(), loop(), loop(), loop()]), tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 90 },
      )
      expect(out.status).toBe('awaiting_user')
      expect(out.pendingQuestion).toBeTruthy()
      expect(out.messages.some((m) => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('重复'))).toBe(true)
    })
  })

  it('compacts the middle when over the token budget before answering', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(25, 1) // budget=1 token → always over budget on entry
      let summarizeCalled = 0
      const summarizer: Summarizer = { async summarize() { summarizeCalled++; return '早期摘要' } }
      const msgs: BaseMessage[] = [
        new HumanMessage({ id: 'u1', content: '原始目标' }),
        new AIMessage({ id: 'a1', content: '老回复一' }),
        new HumanMessage({ id: 'u2', content: '追问二' }),
        new AIMessage({ id: 'a2', content: '老回复二' }),
        new HumanMessage({ id: 'u3', content: '追问三' }),
        new AIMessage({ id: 'a3', content: '回复三' }),
        new HumanMessage({ id: 'u4', content: '追问四' }),
      ]
      const out = await app.invoke(
        { messages: msgs, steps: 0 },
        { configurable: { ctx: { runner: fakeRunner([new AIMessage('最终答复')]), tools: buildTools(root), emit: noopEmit, summarizer } } },
      )
      expect(summarizeCalled).toBeGreaterThan(0)
      expect(out.messages.some((m) => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('早期摘要'))).toBe(true)
    })
  })
})
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `npx vitest run packages/sidecar/src/session/graph.test.ts`
Expected: FAIL (`GraphCtx` has no `summarizer`; `status`/`pendingQuestion` channels don't exist; no nudge/pause/compact behavior).

- [ ] **Step 4: Rewrite `graph.ts`**

Replace the entire contents of `packages/sidecar/src/session/graph.ts` with:
```ts
import { StateGraph, Annotation, START, END, messagesStateReducer } from '@langchain/langgraph'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import { AIMessage, SystemMessage, ToolMessage, RemoveMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ModelRunner } from './model-runner.js'
import { MAX_STEPS } from './loop-control.js'
import { sigOf, trailingRepeatCount, DOOM_LOOP_N, SIG_WINDOW, DOOM_LOOP_NUDGE, PAUSE_QUESTION } from './doom-loop.js'
import { estimateTokens, compactMessages, COMPACT_BUDGET_TOKENS, KEEP_RECENT_TURNS, type Summarizer } from './compaction.js'

/** Streaming sinks the graph emits through (wired to the WS layer in session.ts). */
export interface GraphEmit {
  token(delta: string): void
  reasoning(delta: string): void
  toolStarted(name: string, callId: string, input: unknown): void
  toolFinished(callId: string, status: 'finished' | 'error', output?: string, error?: string): void
}

/** Per-turn context passed via config.configurable.ctx (keeps the compiled graph reusable). */
export interface GraphCtx {
  runner: ModelRunner
  tools: StructuredToolInterface[]
  emit: GraphEmit
  summarizer: Summarizer
}

const LoopState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  steps: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
  recentSigs: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  nudgedSig: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
  status: Annotation<'running' | 'awaiting_user'>({ reducer: (_prev, next) => next, default: () => 'running' }),
  pendingQuestion: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
})

type State = typeof LoopState.State

function ctxOf(config: LangGraphRunnableConfig): GraphCtx {
  const ctx = (config.configurable as { ctx?: GraphCtx } | undefined)?.ctx
  if (!ctx) throw new Error('graph invoked without configurable.ctx')
  return ctx
}

/** Build the agent-loop graph. `maxSteps` and `compactBudget` are injectable for tests. */
export function buildGraph(maxSteps: number = MAX_STEPS, compactBudget: number = COMPACT_BUDGET_TOKENS) {
  /** Pre-turn + mid-loop context shrink: summarize the middle when over budget (≤ once per visit). */
  async function compact(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    if (estimateTokens(state.messages) <= compactBudget) return {}
    const result = await compactMessages(state.messages, { keepRecentTurns: KEEP_RECENT_TURNS, summarizer: ctxOf(config).summarizer })
    if (!result) return {}
    return { messages: [result.summary, ...result.removeIds.map((id) => new RemoveMessage({ id }))] }
  }

  async function agent(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const { runner, tools, emit } = ctxOf(config)
    const capped = state.steps >= maxSteps - 1 // last allowed step: no tools, force text
    const msg = await runner.run(state.messages, {
      tools,
      bindTools: !capped,
      signal: config.signal,
      onText: (d) => emit.token(d),
      onReasoning: (d) => emit.reasoning(d),
    })
    return { messages: [msg], steps: state.steps + 1 }
  }

  async function toolsNode(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const { tools, emit } = ctxOf(config)
    const byName = new Map(tools.map((t) => [t.name, t]))
    const last = state.messages[state.messages.length - 1] as AIMessage
    const out: ToolMessage[] = []
    for (const call of last.tool_calls ?? []) {
      const id = call.id ?? call.name
      emit.toolStarted(call.name, id, call.args)
      const t = byName.get(call.name)
      if (!t) {
        emit.toolFinished(id, 'error', undefined, `unknown tool: ${call.name}`)
        out.push(new ToolMessage({ content: `Error: unknown tool ${call.name}`, tool_call_id: id, name: call.name }))
        continue
      }
      try {
        const result = String(await t.invoke(call.args))
        emit.toolFinished(id, 'finished', result)
        out.push(new ToolMessage({ content: result, tool_call_id: id, name: call.name }))
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        emit.toolFinished(id, 'error', undefined, error)
        out.push(new ToolMessage({ content: `Error: ${error}`, tool_call_id: id, name: call.name }))
      }
    }
    // The Nth identical batch is executed too (keeps tool_calls↔ToolMessage valid); doom-loop is
    // detected post-execution from the trailing signature run.
    const sig = sigOf(last.tool_calls ?? [])
    return { messages: out, recentSigs: [...state.recentSigs, sig].slice(-SIG_WINDOW) }
  }

  /** Corrective note after the Nth identical batch; recorded against the offending signature. */
  function nudge(state: State): Partial<State> {
    return { messages: [new SystemMessage(DOOM_LOOP_NUDGE)], nudgedSig: state.recentSigs[state.recentSigs.length - 1] }
  }

  /** Stop the turn pending user input (Option Z: session.ts reads this and emits agent:interrupt). */
  function pause(_state: State): Partial<State> {
    return { status: 'awaiting_user', pendingQuestion: PAUSE_QUESTION }
  }

  function routeAfterAgent(state: State): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1] as AIMessage
    const wantsTools = (last.tool_calls?.length ?? 0) > 0
    return wantsTools && state.steps < maxSteps ? 'tools' : END
  }

  function routeAfterTools(state: State): 'nudge' | 'pause' | 'compact' {
    const lastSig = state.recentSigs[state.recentSigs.length - 1]
    if (lastSig !== undefined && trailingRepeatCount(state.recentSigs, lastSig) >= DOOM_LOOP_N) {
      return state.nudgedSig === lastSig ? 'pause' : 'nudge'
    }
    return 'compact'
  }

  return new StateGraph(LoopState)
    .addNode('compact', compact)
    .addNode('agent', agent)
    .addNode('tools', toolsNode)
    .addNode('nudge', nudge)
    .addNode('pause', pause)
    .addEdge(START, 'compact')
    .addEdge('compact', 'agent')
    .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', [END]: END })
    .addConditionalEdges('tools', routeAfterTools, { nudge: 'nudge', pause: 'pause', compact: 'compact' })
    .addEdge('nudge', 'agent')
    .addEdge('pause', END)
    .compile()
}
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx vitest run packages/sidecar/src/session/graph.test.ts`
Expected: PASS (5 tests).

Also run the loop-control test you touched:
Run: `npx vitest run packages/sidecar/src/session/loop-control.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check + commit**

```bash
cd packages/sidecar && npx tsc --noEmit && cd ../..
git add packages/sidecar/src/session/graph.ts packages/sidecar/src/session/graph.test.ts packages/sidecar/src/session/loop-control.ts packages/sidecar/src/session/loop-control.test.ts
git commit -m "feat(loop): compact/nudge/pause nodes + doom-loop routing in the graph"
```

---

### Task 6: Session — `runTurn(base)` refactor + pause/resume + summarizer

**Files:**
- Modify: `packages/sidecar/src/session/session.ts`
- Test (extend): `packages/sidecar/src/session/session-loop.test.ts`

Context: `session.ts`'s `runTurn` already builds the trajectory/emit machinery and ends with `finalizeAndPersist`. We (a) feed the graph a `summarizer`, (b) let `runTurn` start from an optional `base` (so resume re-invokes with the stashed rich messages + carried steps), (c) detect `finalState.status === 'awaiting_user'`, finalize the turn as `stopped`, and emit `agent:interrupt`, and (d) add `resume()` + pause-aware `cancel()`/guards. Pause/resume produces **two** assistant turns (A `stopped`, then B), with the rich graph history threaded into B so context isn't lost (spec §5).

- [ ] **Step 1: Write the failing pause/resume + cancel tests**

Append to `packages/sidecar/src/session/session-loop.test.ts` (the file already has the `fakeRunner` helper and the `root`/`beforeEach`/`afterEach` harness):
```ts
  it('pauses on a doom loop, emits agent:interrupt, then resumes to completion', async () => {
    const tc = () => new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
    const runner = fakeRunner([tc(), tc(), tc(), tc(), new AIMessage('好的，我换个方法完成了任务。')])
    const session = new Session('s2', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    const sent: ServerMessage[] = []
    await session.sendMessage('一直 ls 根目录', (m) => sent.push(m))

    const interrupt = sent.find((m) => m.type === 'agent:interrupt') as Extract<ServerMessage, { type: 'agent:interrupt' }>
    expect(interrupt).toBeTruthy()
    expect(interrupt.question).toBeTruthy()
    const firstComplete = sent.find((m) => m.type === 'message:complete') as Extract<ServerMessage, { type: 'message:complete' }>
    expect(firstComplete.message.stopped).toBe(true)

    const sent2: ServerMessage[] = []
    await session.resume('改用直接写文件', (m) => sent2.push(m))
    const done = sent2.find((m) => m.type === 'message:complete') as Extract<ServerMessage, { type: 'message:complete' }>
    expect(done.message.content).toContain('换个方法完成了')
  })

  it('cancel while awaiting resume clears the pause (next send is a fresh turn)', async () => {
    const tc = () => new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
    const runner = fakeRunner([tc(), tc(), tc(), tc(), new AIMessage('已直接回答。')])
    const session = new Session('s3', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)
    await session.sendMessage('一直 ls', () => {})
    session.cancel() // clears the awaiting-resume pause
    const sent: ServerMessage[] = []
    await session.sendMessage('换个问题', (m) => sent.push(m)) // must NOT be a no-op now
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)
  })
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run packages/sidecar/src/session/session-loop.test.ts`
Expected: FAIL (`session.resume` is not a function; no `agent:interrupt` emitted; pause never happens).

- [ ] **Step 3: Add imports to `session.ts`**

In `packages/sidecar/src/session/session.ts`, extend the existing imports:
- Add to the `'./graph.js'` import nothing new (GraphCtx already imported). Add new imports below the `recursionLimit` import:
```ts
import type { Summarizer } from './compaction.js'
import { PAUSE_QUESTION } from './doom-loop.js'
import { cheapModelFor } from '../config/providers.js'
```
(`getActiveModel` is already imported from `'../config/providers.js'` — add `cheapModelFor` to that same import line instead of a duplicate, i.e. `import { getActiveModel, isOpenAICompatible } from '../config/providers.js'` → add `cheapModelFor`.)

- [ ] **Step 4: Add the summarizer plumbing (near the other top-level helpers, e.g. after `buildModel`)**

```ts
const NOOP_SUMMARIZER: Summarizer = { async summarize() { return '' } }

const SUMMARY_SYSTEM_PROMPT =
  '你是对话压缩器。把给定的较早对话片段压成一段简洁中文摘要，保留：任务目标、关键决策、约束、' +
  '已写入或修改的文件、近期工具结果与未决事项；丢弃：中间推理、被否方案、冗长输出。只输出摘要正文。'

/** Production summarizer: one cheap completion over the middle span. Not used in injected-model tests. */
class RealSummarizer implements Summarizer {
  async summarize(messages: BaseMessage[]): Promise<string> {
    const { providerID, modelID, baseURL } = getActiveModel()
    const model = new ChatOpenAI({ model: cheapModelFor(providerID, modelID), apiKey: activeKey(providerID), configuration: { baseURL }, maxTokens: 512, temperature: 0.2 })
    const transcript = messages.map((m) => `${m.getType()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')
    const res = await model.invoke([new SystemMessage(SUMMARY_SYSTEM_PROMPT), new HumanMessage(transcript)])
    return typeof res.content === 'string' ? res.content : ''
  }
}
```

- [ ] **Step 5: Add fields + constructor param + `summarizer()`**

In the `Session` class, add fields next to `private running = false`:
```ts
  private awaitingResume = false
  private paused: { messages: BaseMessage[]; steps: number } | null = null
  private readonly injectedSummarizer?: Summarizer
```
Add an 8th constructor parameter (after `runner?: ModelRunner,`):
```ts
    summarizer?: Summarizer,
```
and in the constructor body (next to `this.injectedRunner = runner`):
```ts
    this.injectedSummarizer = summarizer
```
Add the method (next to `modelRunner()`):
```ts
  /** The Summarizer for compaction: injected (tests), else a cheap-model summarizer for the env model,
   *  else a no-op (injected-model/runner sessions never hit the paid path). */
  private summarizer(): Summarizer {
    if (this.injectedSummarizer) return this.injectedSummarizer
    return this.usesEnvModel ? new RealSummarizer() : NOOP_SUMMARIZER
  }
```

- [ ] **Step 6: Feed the summarizer into the graph ctx**

In `runTurn`, change the `ctx` construction:
```ts
    const ctx: GraphCtx = { runner: this.modelRunner(), tools, emit }
```
to:
```ts
    const ctx: GraphCtx = { runner: this.modelRunner(), tools, emit, summarizer: this.summarizer() }
```

- [ ] **Step 7: Refactor `runTurn` to accept `base` + handle the pause**

Change the method signature:
```ts
  private async runTurn(rawSend: SendFn): Promise<string> {
```
to:
```ts
  private async runTurn(rawSend: SendFn, base?: { messages: BaseMessage[]; steps: number }): Promise<string> {
```
Then replace the `try { … }` invoke block. Find:
```ts
    try {
      await this.app.invoke(
        { messages: [new SystemMessage(system), ...this.messages], steps: 0 },
        { configurable: { ctx }, signal: this.abortController.signal, recursionLimit: recursionLimit() },
      )
      closeReasoning('supervisor')
      finishRemaining()
    } catch (err) {
```
and replace with:
```ts
    try {
      const finalState = await this.app.invoke(
        { messages: [new SystemMessage(system), ...(base?.messages ?? this.messages)], steps: base?.steps ?? 0, recentSigs: [], nudgedSig: undefined, status: 'running' },
        { configurable: { ctx }, signal: this.abortController.signal, recursionLimit: recursionLimit() },
      )
      closeReasoning('supervisor')
      finishRemaining()
      if (finalState.status === 'awaiting_user') {
        // Stash the rich graph history (minus the leading system msg) so resume re-plans with full
        // context, finalize this turn as stopped, and ask the user. The finally below stops the
        // watchdog and clears `running`; `awaitingResume` makes the next user message a resume.
        this.paused = { messages: finalState.messages.slice(1), steps: finalState.steps }
        this.awaitingResume = true
        const stoppedText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, true)
        send({ type: 'agent:interrupt', sessionId: this.id, turnId, agentId: 'supervisor', question: finalState.pendingQuestion ?? PAUSE_QUESTION })
        return stoppedText
      }
    } catch (err) {
```
(The trailing `return this.finalizeAndPersist(send, turnId, supervisorText, trajectory, false)` after the `finally` is unchanged and handles the normal, non-paused completion.)

- [ ] **Step 8: Guard `sendMessage` + `regenerate` against the awaiting-resume state**

In `sendMessage`, change the first line:
```ts
    if (this.running) return
```
to:
```ts
    if (this.running || this.awaitingResume) return
```
In `regenerate`, change:
```ts
    if (this.running) return
```
to:
```ts
    if (this.running || this.awaitingResume) return
```

- [ ] **Step 9: Add `resume()` and make `cancel()` pause-aware**

Add the `resume` method (e.g. after `sendMessage`):
```ts
  /** Continue a turn that paused for user input (Option Z): append the answer to the stashed rich
   *  message list and re-invoke as a fresh turn carrying the prior step count. No-op unless awaiting. */
  async resume(content: string, send: SendFn): Promise<void> {
    if (!this.awaitingResume || !this.paused || this.running) return
    const base = { messages: [...this.paused.messages, new HumanMessage(content)], steps: this.paused.steps }
    this.awaitingResume = false
    this.paused = null
    const ts = Date.now()
    if (this.store) {
      this.store.insertMessage({ id: `u-${ts}`, sessionId: this.id, role: 'user', agentId: null, content, timestamp: ts })
      this.store.touchSession(this.id, ts)
    }
    this.messages.push(new HumanMessage(content))
    await this.runTurn(send, base)
  }
```
Change `cancel()`:
```ts
  cancel(): void {
    this.abortController?.abort()
  }
```
to:
```ts
  cancel(): void {
    if (this.awaitingResume) { this.awaitingResume = false; this.paused = null; return }
    this.abortController?.abort()
  }
```

- [ ] **Step 10: Run it — expect PASS**

Run: `npx vitest run packages/sidecar/src/session/session-loop.test.ts`
Expected: PASS (the original "writes the requested file" test + the 2 new tests).

- [ ] **Step 11: Run the non-paid sibling Session tests (regression — explicit paths only)**

Run each (all use injected models/runners, no paid calls):
```bash
npx vitest run packages/sidecar/src/session/session-unit.test.ts
npx vitest run packages/sidecar/src/session/session-persist.test.ts
npx vitest run packages/sidecar/src/session/session-regenerate.test.ts
npx vitest run packages/sidecar/src/session/session-cwd.test.ts
npx vitest run packages/sidecar/src/session/session-title.test.ts
```
Expected: PASS. **Do NOT run `session.test.ts` — it is PAID.**

- [ ] **Step 12: Type-check + commit**

```bash
cd packages/sidecar && npx tsc --noEmit && cd ../..
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-loop.test.ts
git commit -m "feat(loop): HITL pause/resume via cooperative message-replay + compaction summarizer"
```

---

### Task 7: Session manager — route `message:resume`

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts`
- Test: `packages/sidecar/src/session/session-manager-resume.test.ts`

- [ ] **Step 1: Write the failing routing test**

Create `packages/sidecar/src/session/session-manager-resume.test.ts` (mirror the construction used in a sibling `session-manager-*.test.ts` — pass a temp scratch root so no real `~/.hip` dir is touched):
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from './session-manager.js'
import type { ServerMessage } from '@hip/protocol'

let scratch: string
beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'hip-mgr-')) })
afterEach(() => { rmSync(scratch, { recursive: true, force: true }) })

describe('SessionManager message:resume routing', () => {
  it('forwards message:resume to the session as a guarded no-op when not awaiting', async () => {
    const mgr = new SessionManager(undefined, () => undefined, scratch)
    const sent: ServerMessage[] = []
    mgr.handle({ type: 'session:create', id: 's1', config: { llmProvider: 'deepseek', model: '', tools: [] } }, (m) => sent.push(m))
    // Session never paused → resume() returns immediately (before any model/key access) → no error.
    await mgr.handleAsync({ type: 'message:resume', sessionId: 's1', content: 'hi' }, (m) => sent.push(m))
    expect(sent.some((m) => m.type === 'error')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run packages/sidecar/src/session/session-manager-resume.test.ts`
Expected: FAIL (the `message:resume` case doesn't exist; TS/runtime: the switch falls through, and `handleAsync`'s `msg.content` is unreachable — the test fails because the type isn't routed). It may surface as a type error in tsc; either way, proceed.

- [ ] **Step 3: Add the route**

In `packages/sidecar/src/session/session-manager.ts`, inside the `switch (msg.type)` in `handleAsync`, add after the `case 'message:regenerate':` block:
```ts
      case 'message:resume':
        await this.ensureSession(msg.sessionId).resume(msg.content, send)
        break
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run packages/sidecar/src/session/session-manager-resume.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
cd packages/sidecar && npx tsc --noEmit && cd ../..
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-resume.test.ts
git commit -m "feat(loop): route message:resume to Session.resume"
```

---

### Task 8: Frontend — interrupt bubble + resume routing

**Files:**
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionService.ts`
- Modify: `src/domain/hooks.ts`
- Modify: `src/components/chat/ChatPane.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`
- Test (extend): `src/domain/sessionStore.test.ts`, `src/domain/sessionService.test.ts`

- [ ] **Step 1: Write the failing store + service tests**

Append to `src/domain/sessionStore.test.ts` (inside the `describe('applyServerMessage', …)` block):
```ts
  it('agent:interrupt records the pending interrupt on the session', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'agent:interrupt', sessionId: 's1', turnId: 't1', agentId: 'supervisor', question: '我该怎么做？' }, 1)
    expect(next.sessions[0].interrupt).toEqual({ turnId: 't1', question: '我该怎么做？', context: undefined })
  })
```

Append to `src/domain/sessionService.test.ts` (inside `describe('SessionService', …)`):
```ts
  it('routes a send to message:resume when an interrupt is pending, and clears it', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDomainStore.setState({ sessions: [{ ...useDomainStore.getState().sessions[0], interrupt: { turnId: 't1', question: 'q' } }] })
    svc.sendMessage('do this instead')
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:resume', sessionId: 's1', content: 'do this instead' })
    expect(useDomainStore.getState().sessions[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'do this instead' })
    expect(useDomainStore.getState().sessions[0].interrupt ?? null).toBeNull()
  })
```

- [ ] **Step 2: Run them — expect FAIL**

```bash
npx vitest run src/domain/sessionStore.test.ts
npx vitest run src/domain/sessionService.test.ts
```
Expected: FAIL (no `interrupt` field / no `agent:interrupt` case / send doesn't route to resume).

- [ ] **Step 3: Extend `SessionVM` + reducer + clearing (sessionStore.ts)**

In `src/domain/sessionStore.ts`:

(a) Add an **optional** field to `SessionVM` (optional keeps the existing inline `baseSession`/`setState` test helpers valid):
```ts
  interrupt?: { turnId: string; question: string; context?: string } | null  // pending HITL question, null/absent = none
```

(b) In `applyServerMessage`, add a case (e.g. after the `message:complete` case):
```ts
    case 'agent:interrupt':
      return update(msg.sessionId, (s) => ({ ...s, interrupt: { turnId: msg.turnId, question: msg.question, context: msg.context } }))
```

(c) Clear the interrupt when the user sends/answers — in the `appendUserMessage` action, add `interrupt: null` to the updated session object:
```ts
          : { ...sess, status: 'running' as const, error: null, interrupt: null, updatedAtMs: Date.now(), messages: [...sess.messages, { id, role: 'user' as const, content, timestamp: Date.now() }] },
```

(d) Initialize the field in both factories (runtime tidiness; the field is optional so this is non-breaking):
- In `emptySession(...)` return object, add `interrupt: null`.
- In `summaryToVM(...)` return object, add `interrupt: null`.

- [ ] **Step 4: Add the resume routing (sessionService.ts)**

In `src/domain/sessionService.ts`, at the very start of `sendMessage`, branch to resume when the active session has a pending interrupt:
```ts
  sendMessage(content: string): void {
    const text = content.trim()
    if (!text) return
    const st = useDomainStore.getState()
    const active = st.sessions.find((s) => s.id === st.activeSessionId)
    if (active?.interrupt) { this.resume(text); return }
    let { activeSessionId } = useDomainStore.getState()
    // …rest of the existing sendMessage body unchanged…
```
Add a `resume` method (e.g. after `sendMessage`):
```ts
  /** Answer a paused turn's question: append the reply to the transcript (clears the interrupt) and
   *  send it as message:resume so the sidecar continues the loop. */
  resume(content: string): void {
    const text = content.trim()
    if (!text) return
    const { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) return
    const id = nanoid()
    useDomainStore.getState().appendUserMessage(activeSessionId, id, text) // appends, clears interrupt, status→running
    this.transport.send({ type: 'message:resume', sessionId: activeSessionId, content: text })
  }
```

- [ ] **Step 5: Add the `useActiveInterrupt` hook (hooks.ts)**

Append to `src/domain/hooks.ts`:
```ts
export function useActiveInterrupt(): { turnId: string; question: string; context?: string } | null {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.interrupt ?? null)
}
```

- [ ] **Step 6: Render the interrupt bubble (ChatPane.tsx)**

In `src/components/chat/ChatPane.tsx`:

(a) Add `useActiveInterrupt` to the `@/domain` import and read it:
```tsx
import { sessionService, useActiveSessionId, useActiveMessages, useActiveSessionError, useActiveSessionStatus, useActiveInterrupt } from '@/domain'
```
```tsx
  const interrupt = useActiveInterrupt()
```

(b) Render a notice just before the `{error && (…)}` block (so the question sits at the tail of the transcript):
```tsx
          {interrupt && (
            <div className="rounded-lg border border-accent/30 bg-accent-subtle px-4 py-3 text-body text-ink" data-testid="chat-interrupt">
              <p className="flex items-start gap-2"><span aria-hidden>⏸</span><span>{interrupt.question}</span></p>
              <p className="mt-1 text-meta text-ink-secondary">{t('chat.interruptHint')}</p>
            </div>
          )}
```
(No composer change is needed — the composer already calls `sessionService.sendMessage`, which now routes to `resume` when an interrupt is pending.)

- [ ] **Step 7: Add the i18n string**

Add `interruptHint` to the `chat` object in each locale (next to `errorInterrupted`):
- `src/i18n/en.ts`: `interruptHint: 'Reply below to tell hip how to proceed.',`
- `src/i18n/zh-CN.ts`: `interruptHint: '在下方回复，告诉 hip 接下来怎么做。',`
- `src/i18n/zh-TW.ts`: `interruptHint: '在下方回覆，告訴 hip 接下來怎麼做。',`

- [ ] **Step 8: Run the tests — expect PASS**

```bash
npx vitest run src/domain/sessionStore.test.ts
npx vitest run src/domain/sessionService.test.ts
```
Expected: PASS.

- [ ] **Step 9: Type-check + commit**

```bash
npm run type-check
git add src/domain/sessionStore.ts src/domain/sessionService.ts src/domain/hooks.ts src/components/chat/ChatPane.tsx src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/domain/sessionStore.test.ts src/domain/sessionService.test.ts
git commit -m "feat(ui): inline interrupt bubble + route sends to message:resume while paused"
```

---

## Final verification (after all tasks)

- [ ] **Sidecar type-check:** `cd packages/sidecar && npx tsc --noEmit && cd ../..` → clean.
- [ ] **Frontend type-check:** `npm run type-check` → clean.
- [ ] **Run the P2 + touched non-paid suites by explicit path** (NEVER a bare/glob run):
  ```bash
  npx vitest run \
    packages/sidecar/src/session/doom-loop.test.ts \
    packages/sidecar/src/session/retry.test.ts \
    packages/sidecar/src/session/compaction.test.ts \
    packages/sidecar/src/config/providers.test.ts \
    packages/sidecar/src/session/model-runner.test.ts \
    packages/sidecar/src/session/graph.test.ts \
    packages/sidecar/src/session/loop-control.test.ts \
    packages/sidecar/src/session/session-loop.test.ts \
    packages/sidecar/src/session/session-manager-resume.test.ts \
    src/domain/sessionStore.test.ts \
    src/domain/sessionService.test.ts
  ```
  Expected: all PASS. (Each path is explicit; none triggers `session.test.ts` or `reasoner-reasoning.integration.test.ts`.)
- [ ] **Manual GUI acceptance (PAID, human-run, bundled with P1's pending live verification):** in a long/looping scenario, confirm a doom-loop surfaces the `⏸` bubble, an inline reply resumes the turn, and a long session compacts instead of erroring. Also re-confirm P1's "用一个 HTML 做个自我介绍" still writes a file.

## Risks carried from the spec (verify during the paid spike, not in unit tests)

- **R1:** real DeepSeek `APIError` field locations for `.status` / `.headers['retry-after']`, and whether DeepSeek accepts a mid-list `SystemMessage` (the nudge + the compaction summary). If it rejects mid-list system role, switch both to a `HumanMessage` with a `[系统]` prefix (spec P2-J2). Verify in `scratch/spike-loop.mts`.
- **R4:** compaction must not loop — the "no-op when under budget" gate + "null when no middle" guard cover it; the `buildGraph(25, 1)` test uses a pathological budget only because its model ends in one step.
