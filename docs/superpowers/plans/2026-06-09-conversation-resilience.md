# Conversation Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a conversation turn from wedging on disconnect or stall: join connection state to per-session turn state (derived "reconnecting" UI), resync + reconcile on reconnect (recover finished turns, else mark interrupted + manual Retry), harden the sidecar against a dead socket, and add a 60s idle-timeout watchdog.

**Architecture:** Three independent units. (1) Client reconciliation — the `session:loaded` reducer settles `status` from the trailing persisted message; `sessionService` forces a resync on reconnect when a turn was running; `InputBar`/`Composer` derive a "reconnecting" state. (2) Sidecar dead-socket tolerance — `ws.on('close')` cancels in-flight turns; `send` is `readyState`-guarded. (3) Idle watchdog — an extracted `IdleWatchdog` class aborts a stalled turn. **No protocol changes** (interrupted is client-derived; timeout reuses `error`; cancel-on-close reuses cancel).

**Tech Stack:** TypeScript, React, Zustand, vitest (fake timers for the watchdog); Node `ws` sidecar; yarn workspaces.

**Green-increment ordering:** i18n keys first (they're type-checked at call sites), then the three units in any order, then the gate.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/i18n/{en,zh-CN,zh-TW}.ts` | Modify | `chat.reconnecting`, `chat.errorInterrupted`, `chat.errorTimeout` |
| `src/domain/sessionStore.ts` | Modify | `session:loaded` reconciliation (trailing-message → settled status) |
| `src/domain/sessionStore.test.ts` | Modify | reconciliation tests |
| `src/domain/sessionService.ts` | Modify | `resyncActiveIfRunning()` on `'ready'` |
| `src/domain/sessionService.test.ts` | Modify | resync-on-ready test |
| `src/components/chat/InputBar.tsx` | Modify | derive `reconnecting`, pass to Composer |
| `src/components/chat/Composer.tsx` | Modify | `reconnecting` prop → disable Stop + hint |
| `src/components/chat/ChatPane.tsx` | Modify | `INTERRUPTED`/`TIMEOUT` banner text branches |
| `packages/sidecar/src/session/idle-watchdog.ts` | Create | `IdleWatchdog` (arm/reset/stop) |
| `packages/sidecar/src/session/idle-watchdog.test.ts` | Create | watchdog unit tests (fake timers) |
| `packages/sidecar/src/session/session.ts` | Modify | wire watchdog into `runTurn`; `TIMEOUT` terminal error; `idleTimeoutMs` |
| `packages/sidecar/src/session/session-manager.ts` | Modify | `cancelAllRunning()` |
| `packages/sidecar/src/server/ws-server.ts` | Modify | `readyState` send guard + `ws.on('close')` → `cancelAllRunning` |

---

## Task 1: i18n keys

**Files:** Modify `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`.

- [ ] **Step 1: Add three `chat.*` keys to each locale**

Add after the existing `chat.thoughtFor`/`chat.delegatedTo` keys in each file:

`en.ts`:
```ts
      reconnecting: 'Reconnecting…',
      errorInterrupted: 'Connection lost — the reply didn\'t finish.',
      errorTimeout: 'Response timed out and was stopped.',
```
`zh-CN.ts`:
```ts
      reconnecting: '重新连接中…',
      errorInterrupted: '连接中断，回复未完成。',
      errorTimeout: '响应超时，已停止。',
```
`zh-TW.ts`:
```ts
      reconnecting: '重新連線中…',
      errorInterrupted: '連線中斷，回覆未完成。',
      errorTimeout: '回應逾時，已停止。',
```

- [ ] **Step 2: Type-check (types derive from zh-CN)**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(i18n): reconnecting + interrupted/timeout error copy"
```

---

## Task 2: Reducer — `session:loaded` reconciliation

**Files:** Modify `src/domain/sessionStore.ts` (the `session:loaded` case, currently line 247-248). Test: `src/domain/sessionStore.test.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/domain/sessionStore.test.ts` (uses the existing `baseSession` helper + `applyServerMessage`):

```ts
it('session:loaded marks interrupted when the trailing persisted message is a user turn', () => {
  const s0 = { sessions: [baseSession({ id: 's1', loaded: false, status: 'running' })] }
  const next = applyServerMessage(s0, { type: 'session:loaded', sessionId: 's1', messages: [
    { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
  ] }, 0)
  expect(next.sessions[0]).toMatchObject({ loaded: true, status: 'error' })
  expect(next.sessions[0].error).toEqual({ code: 'INTERRUPTED', message: '' })
})

it('session:loaded settles to idle when the trailing message is an assistant reply', () => {
  const s0 = { sessions: [baseSession({ id: 's1', loaded: false, status: 'running' })] }
  const next = applyServerMessage(s0, { type: 'session:loaded', sessionId: 's1', messages: [
    { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
    { id: 't1', role: 'assistant', content: 'done', timestamp: 1 },
  ] }, 0)
  expect(next.sessions[0]).toMatchObject({ loaded: true, status: 'idle', error: null })
})

it('session:loaded with a trailing stopped assistant settles idle (Stopped badge path)', () => {
  const s0 = { sessions: [baseSession({ id: 's1', loaded: false })] }
  const next = applyServerMessage(s0, { type: 'session:loaded', sessionId: 's1', messages: [
    { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
    { id: 't1', role: 'assistant', content: 'partial', timestamp: 1, stopped: true },
  ] }, 0)
  expect(next.sessions[0].status).toBe('idle')
})
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `yarn vitest run src/domain/sessionStore.test.ts -t "session:loaded marks interrupted"`
Expected: FAIL (status stays `running`, error not set).

- [ ] **Step 3: Implement the reconciliation**

Replace the `session:loaded` case (lines 247-248) with:

```ts
    case 'session:loaded':
      return update(msg.sessionId, (s) => {
        // A completed conversation always ends with an assistant reply; a trailing user
        // message means the last turn never finished (drop/crash/timeout) → interrupted.
        const last = msg.messages[msg.messages.length - 1]
        const interrupted = last?.role === 'user'
        return {
          ...s,
          loaded: true,
          messages: msg.messages,
          status: interrupted ? 'error' : 'idle',
          error: interrupted ? { code: 'INTERRUPTED', message: '' } : null,
        }
      })
```

- [ ] **Step 4: Update any existing `session:loaded` test**

Run `yarn vitest run src/domain/sessionStore.test.ts`. If a pre-existing `session:loaded` test asserted only `{ loaded: true, messages }`, extend it to also expect `status: 'idle'` (for an assistant-trailing fixture) — do not weaken; adjust the expectation to the now-settled status.

- [ ] **Step 5: Run, confirm PASS**

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat(store): reconcile turn status from trailing message on session:loaded"
```

---

## Task 3: Service — resync the active session on reconnect

**Files:** Modify `src/domain/sessionService.ts` (the `receive` method, currently the `'ready'` branch at lines 53-54). Test: `src/domain/sessionService.test.ts`.

- [ ] **Step 1: Write the failing test**

Add to `src/domain/sessionService.test.ts` (FIRST READ the file to reuse its existing mock-transport + service-construction harness — it drives `receive` via the transport's onMessage and inspects `transport.send` calls). The test:

```ts
it('on ready, resyncs the active session when its turn was running', () => {
  // ...construct the service with the file's mock transport; set an active session with status 'running' and loaded:true...
  // drive a 'ready' message through the transport
  // assert transport.send was called with { type: 'session:load', sessionId: <active> }
})
it('on ready with no running active session, only lists sessions', () => {
  // active session idle (or none) → assert session:list sent, NO session:load
})
```
Fill in using the file's real harness (set `useDomainStore` active session + status as the other tests do; assert on the recorded `send` calls). Match the existing assertion style.

- [ ] **Step 2: Run, confirm FAIL**

Run: `yarn vitest run src/domain/sessionService.test.ts -t "resyncs the active session"`
Expected: FAIL (no `session:load` sent on ready).

- [ ] **Step 3: Implement `resyncActiveIfRunning` + call it on ready**

In `sessionService.ts`, change the `'ready'` branch in `receive` (lines 53-54) and add a private helper:

```ts
    if (msg.type === 'ready') {
      this.transport.send({ type: 'session:list' })
      this.resyncActiveIfRunning()
    } else if (msg.type === 'fs:ls:result') {
```

Add the helper (near the other private methods):

```ts
  /** On (re)connect, if the active session had an in-flight turn, force a history resync so a
   *  turn that finished/was interrupted during the outage is reconciled (see session:loaded). */
  private resyncActiveIfRunning(): void {
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const s = sessions.find((x) => x.id === activeSessionId)
    if (s?.status === 'running') this.transport.send({ type: 'session:load', sessionId: activeSessionId })
  }
```

- [ ] **Step 4: Run, confirm PASS**

Run: `yarn vitest run src/domain/sessionService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "feat(domain): resync the active session on reconnect when a turn was running"
```

---

## Task 4: UI — reconnecting state + interrupted/timeout banner text

**Files:** Modify `src/components/chat/Composer.tsx`, `src/components/chat/InputBar.tsx`, `src/components/chat/ChatPane.tsx`. (Presentational; verified by `yarn type-check` + GUI acceptance — no DOM tests, per project convention.)

- [ ] **Step 1: Add a `reconnecting` prop to Composer**

In `Composer.tsx`, add `reconnecting` to the props type (after `thinkingDisabled`):

```ts
  thinkingDisabled?: boolean
  reconnecting?: boolean
```
and destructure it: `}: { ... thinkingDisabled?: boolean; reconnecting?: boolean }) {` (add `reconnecting,` to the destructure list).

Then change the running/Stop branch (lines 58-66) to disable Stop + show the hint while reconnecting:

```tsx
        {running && onStop ? (
          <div className="flex items-center gap-2">
            {reconnecting && <span className="text-[12px] text-ink-tertiary">{t('chat.reconnecting')}</span>}
            <button
              onClick={onStop}
              disabled={reconnecting}
              data-testid="composer-stop"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              title={t('chat.stop')}
            >
              <Square size={15} />
            </button>
          </div>
        ) : (
```
(Leave the `else` Send branch unchanged.)

- [ ] **Step 2: Derive `reconnecting` in InputBar and pass it**

In `InputBar.tsx`, import `useConnectionStatus`, compute the flag, and pass it:

```tsx
import { useState } from 'react'
import { Composer } from './Composer'
import { sessionService, useActiveSession, useActiveSessionId, useActiveSessionStatus, useConnectionStatus } from '@/domain'

export function InputBar() {
  const [value, setValue] = useState('')
  const status = useActiveSessionStatus()
  const connection = useConnectionStatus()
  const session = useActiveSession()
  const activeSessionId = useActiveSessionId()
  const thinking = session?.config.thinking ?? true
  const reconnecting = status === 'running' && connection !== 'connected'
  const submit = () => {
    const text = value.trim()
    if (!text) return
    sessionService.sendMessage(text)
    setValue('')
  }
  return (
    <div className="shrink-0 px-5 pb-5">
      <div className="mx-auto max-w-3xl">
        <Composer
          value={value}
          onChange={setValue}
          onSubmit={submit}
          running={status === 'running'}
          onStop={() => sessionService.cancel()}
          thinking={thinking}
          thinkingDisabled={status === 'running'}
          reconnecting={reconnecting}
          onToggleThinking={activeSessionId ? (next) => sessionService.setThinking(activeSessionId, next) : undefined}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add INTERRUPTED/TIMEOUT banner text in ChatPane**

In `ChatPane.tsx`, replace the banner `<p>` text expression (lines 56-60) so the code maps to its own message; the button logic (lines 61-76) stays as-is (NO_API_KEY → settings; everything else → regenerate Retry, which already covers INTERRUPTED/TIMEOUT):

```tsx
            <p>
              {error.code === 'NO_API_KEY'
                ? t('chat.errorNoApiKey')
                : error.code === 'INTERRUPTED'
                  ? t('chat.errorInterrupted')
                  : error.code === 'TIMEOUT'
                    ? t('chat.errorTimeout')
                    : t('chat.errorGeneric', { message: error.message })}
            </p>
```

- [ ] **Step 4: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/Composer.tsx src/components/chat/InputBar.tsx src/components/chat/ChatPane.tsx
git commit -m "feat(ui): reconnecting state (disable Stop) + interrupted/timeout banner text"
```

---

## Task 5: `IdleWatchdog` (extracted, unit-tested)

**Files:** Create `packages/sidecar/src/session/idle-watchdog.ts`, `packages/sidecar/src/session/idle-watchdog.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/idle-watchdog.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IdleWatchdog } from './idle-watchdog.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('IdleWatchdog', () => {
  it('fires onTimeout after the interval with no kicks', () => {
    const onTimeout = vi.fn()
    const w = new IdleWatchdog(100, onTimeout)
    w.kick()
    vi.advanceTimersByTime(99)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('kick resets the countdown', () => {
    const onTimeout = vi.fn()
    const w = new IdleWatchdog(100, onTimeout)
    w.kick()
    vi.advanceTimersByTime(80)
    w.kick() // reset
    vi.advanceTimersByTime(80)
    expect(onTimeout).not.toHaveBeenCalled() // 160ms total but reset at 80
    vi.advanceTimersByTime(20)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('stop prevents firing and makes later kicks no-ops', () => {
    const onTimeout = vi.fn()
    const w = new IdleWatchdog(100, onTimeout)
    w.kick()
    w.stop()
    vi.advanceTimersByTime(200)
    expect(onTimeout).not.toHaveBeenCalled()
    w.kick() // no-op after stop
    vi.advanceTimersByTime(200)
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `yarn vitest run packages/sidecar/src/session/idle-watchdog.test.ts`
Expected: FAIL (cannot resolve `./idle-watchdog`).

- [ ] **Step 3: Implement**

Create `packages/sidecar/src/session/idle-watchdog.ts`:

```ts
/**
 * A resettable idle timer. `kick()` (re)arms the countdown; if the full interval elapses with no
 * kick, `onTimeout` fires once. `stop()` cancels it permanently (later kicks are no-ops). Used to
 * abort a turn whose provider stream has stalled (no activity), without killing a turn that is
 * still progressing — any outbound activity kicks it.
 */
export class IdleWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  constructor(private readonly ms: number, private readonly onTimeout: () => void) {}

  kick(): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; this.onTimeout() }, this.ms)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `yarn vitest run packages/sidecar/src/session/idle-watchdog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/idle-watchdog.ts packages/sidecar/src/session/idle-watchdog.test.ts
git commit -m "feat(sidecar): IdleWatchdog — resettable idle timer for turn stalls"
```

---

## Task 6: Wire the watchdog into `runTurn` + TIMEOUT terminal error

**Files:** Modify `packages/sidecar/src/session/session.ts` (`runTurn`, lines 287-430; constructor for `idleTimeoutMs`). Test: `packages/sidecar/src/session/session-unit.test.ts`.

- [ ] **Step 1: Add the `idleTimeoutMs` knob**

In `session.ts`, add near the top-level constants:
```ts
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000
```
Add an `idleTimeoutMs` field/param to the `Session` class. FIRST READ the current constructor signature; add an optional trailing parameter `idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS` stored on a private readonly field `this.idleTimeoutMs`. Existing call sites (`session-manager.ts`) pass nothing → default applies (no change needed there).

- [ ] **Step 2: Write the failing test**

In `packages/sidecar/src/session/session-unit.test.ts`, add (reuse the file's existing model/`collect` harness; adapt the fake model so its stream HANGS — yields nothing and rejects on the abort signal — so no activity arrives after `agent:started`):

```ts
it('aborts a stalled turn after the idle timeout and emits a TIMEOUT error', async () => {
  const sent: ServerMessage[] = []
  // Build a Session with a tiny idleTimeoutMs (e.g. 20) and a fake model whose streamEvents
  // hangs until aborted (its async iterables never yield; awaiting them rejects with AbortError
  // when the signal aborts). Drive one turn via sendMessage(..., send=sent.push).
  // Use real timers + a short wait (>20ms) OR vi.useFakeTimers()+advance, matching the file's style.
  const timeoutErr = sent.find((m) => m.type === 'error' && m.code === 'TIMEOUT')
  expect(timeoutErr).toBeDefined()
})

it('does not emit a TIMEOUT error for a normal fast turn', async () => {
  const sent: ServerMessage[] = []
  // Normal FakeListChatModel turn with the default (or generous) idleTimeoutMs.
  // ...drive one turn...
  expect(sent.some((m) => m.type === 'error' && m.code === 'TIMEOUT')).toBe(false)
})
```
If faking a hanging `streamEvents` is impractical with the existing harness, the watchdog timer logic is already fully covered by Task 5; in that case keep the negative test (no false TIMEOUT on a normal turn) and assert the wiring by a focused check (e.g. that constructing `runTurn` with a tiny timeout + a model that never completes results in `abortController` being aborted). Prefer the behavioral TIMEOUT-error assertion.

- [ ] **Step 3: Run, confirm FAIL**

Run: `yarn vitest run packages/sidecar/src/session/session-unit.test.ts -t "TIMEOUT"`
Expected: the stalled-turn test FAILs (no TIMEOUT error today — the turn hangs forever / the test times out without the watchdog).

- [ ] **Step 4: Implement — wrap `send`, arm/kick/stop the watchdog, emit TIMEOUT terminally**

In `runTurn` (starting line 287): rename the parameter `send` → `rawSend`, and at the top (after `this.running = true`) add the watchdog + wrapped `send`:

```ts
  private async runTurn(rawSend: SendFn): Promise<string> {
    this.abortController = new AbortController()
    this.running = true
    let timedOut = false
    const watchdog = new IdleWatchdog(this.idleTimeoutMs, () => { timedOut = true; this.abortController?.abort() })
    // Every outbound activity kicks the watchdog; a stall (no sends for idleTimeoutMs) aborts the turn.
    const send: SendFn = (msg) => { watchdog.kick(); rawSend(msg) }
    // ...existing body unchanged (it all uses `send`)...
```

Update the `catch` block (lines 408-423) to make TIMEOUT the terminal signal:

```ts
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      await Promise.allSettled(pending)
      if (isAbort && supervisorText) {
        const text = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, true)
        if (timedOut) rawSend({ type: 'error', sessionId: this.id, code: 'TIMEOUT', message: '' })
        return text
      }
      rawSend({
        type: 'error',
        sessionId: this.id,
        code: timedOut ? 'TIMEOUT' : isAbort ? 'CANCELLED' : 'AGENT_ERROR',
        message: timedOut ? '' : isAbort ? 'User cancelled the request' : err instanceof Error ? err.message : String(err),
      })
      return ''
    } finally {
      watchdog.stop()
      this.running = false
      this.abortController = null
    }
```
(Use `rawSend` for the terminal TIMEOUT error so it isn't itself kicking a stopped watchdog — harmless either way, but `rawSend` is clearest. Emitting it AFTER `finalizeAndPersist` ensures the client ends in `error` state, not `idle`.)

Add the import at the top of `session.ts`:
```ts
import { IdleWatchdog } from './idle-watchdog.js'
```

- [ ] **Step 5: Run, confirm PASS**

Run: `yarn vitest run packages/sidecar/src/session/session-unit.test.ts && yarn workspace @hip/sidecar type-check`
Expected: PASS (incl. the TIMEOUT test + no-false-timeout test).

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-unit.test.ts
git commit -m "feat(sidecar/session): idle-timeout watchdog aborts stalled turns (TIMEOUT)"
```

---

## Task 7: Sidecar — tolerate a dead socket

**Files:** Modify `packages/sidecar/src/session/session-manager.ts` (add `cancelAllRunning`), `packages/sidecar/src/server/ws-server.ts` (`handleConnection`, lines 31-58). Test: `packages/sidecar/src/session/session-manager.ts` test (reuse an existing manager test file, e.g. `session-manager-persist.test.ts` or a sibling).

- [ ] **Step 1: Write the failing test**

Add to a sidecar manager test file (reuse the existing harness that drives a turn via `manager.handle({type:'message:send', ...})`):

```ts
it('cancelAllRunning cancels an in-flight turn (persists a stopped/aborted turn, no orphan)', async () => {
  // start a turn that is in-flight (use a model that streams slowly / hangs until aborted),
  // call manager.cancelAllRunning(), then assert the turn settled: a CANCELLED error OR a
  // message:complete with stopped=true was emitted, and session.running is false afterwards.
})
it('cancelAllRunning is a no-op when nothing is running', () => {
  // fresh manager, no turns → cancelAllRunning() does not throw
})
```
Use the file's existing fake-model + send-collector harness; for the in-flight case reuse whatever "slow/hanging model" approach Task 6 established (or a model whose stream awaits the abort signal).

- [ ] **Step 2: Run, confirm FAIL**

Run: `yarn vitest run packages/sidecar/src/session/session-manager-persist.test.ts -t "cancelAllRunning"`
Expected: FAIL (`manager.cancelAllRunning is not a function`).

- [ ] **Step 3: Add `cancelAllRunning` to SessionManager**

In `session-manager.ts`, add a public method (near `destroySession`):

```ts
  /** Cancel every in-flight turn — called when the sole client disconnects (ws close).
   *  Safe no-op for idle sessions (Session.cancel() aborts only if a turn is running). */
  cancelAllRunning(): void {
    for (const s of this.sessions.values()) s.cancel()
  }
```

- [ ] **Step 4: Guard `send` and cancel on close in ws-server**

In `ws-server.ts` `handleConnection`, change the `send` definition (line 45) and register a `close` handler (alongside the `message`/`error` handlers, lines 49-57):

```ts
    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }
    send({ type: 'ready', hasApiKey: !!process.env.DEEPSEEK_API_KEY?.trim() })
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage
        this.sessionManager.handle(msg, send)
      } catch (err) {
        send({ type: 'error', code: 'PARSE_ERROR', message: String(err) })
      }
    })
    ws.on('close', () => this.sessionManager.cancelAllRunning())
    ws.on('error', (err) => console.error('[ws] client error', err))
```

- [ ] **Step 5: Run, confirm PASS + sidecar type-check**

Run: `yarn vitest run packages/sidecar/src/session/session-manager-persist.test.ts && yarn workspace @hip/sidecar type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/server/ws-server.ts packages/sidecar/src/session/session-manager-persist.test.ts
git commit -m "feat(sidecar): cancel in-flight turns on ws close + readyState send guard"
```

---

## Task 8: Final verification gate

- [ ] **Step 1: Whole-suite + type-checks + build**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check && yarn test && yarn build`
Expected: both type-checks PASS; vitest all green (live-LLM suites run if a key is present, else skip); `vite build` succeeds.

- [ ] **Step 2: Confirm no regressions in the connection path**

Run: `grep -rn "session:loaded" src packages/sidecar/src --include=*.ts | grep -v "\.test\."`
Expected: the client reads only `msg.messages` (reconciled) and the sidecar sends `{messages}` only — consistent with the no-protocol-change design.

- [ ] **Step 3: Manual GUI acceptance (user, per project convention)**

With the live key configured:
- Start a turn, then kill/restart the sidecar mid-turn (or reload the webview): confirm the spinner does NOT hang forever — the composer shows "reconnecting…" with Stop disabled, and on reconnect the turn reconciles (a finished reply reappears, or an interrupted turn shows the banner + working Retry).
- Confirm Retry re-runs the turn cleanly (no double reply, no stuck "running").
- (If inducible) a stalled stream is aborted after ~60s with the timeout banner.
- Confirm a normal long delegating turn (reasoner + sub-agents) is NOT killed by the watchdog (it keeps emitting activity).

---

## Self-Review

**Spec coverage:**
- Derived "reconnecting" UI (D1) → Task 4 (InputBar/Composer). ✅
- Resync on reconnect (D1) → Task 3. ✅
- Trailing-message reconciliation (recover / stopped / interrupted) → Task 2. ✅
- Interrupted → manual Retry (D2) → Task 2 (status→error) + Task 4 (banner reuses regenerate Retry). ✅
- Idle timeout 60s, reset on activity, abort+finalize+TIMEOUT terminal (D3) → Tasks 5+6. ✅
- ws.close cancels in-flight (D4) + readyState send guard → Task 7. ✅
- No protocol changes (D5) → confirmed: no `@hip/protocol` edits in any task; TIMEOUT reuses `error`, INTERRUPTED is client-derived. ✅
- i18n → Task 1. ✅

**Placeholder scan:** No TBD/TODO. The two places with latitude (Task 6 hanging-model test, Task 7 in-flight test) give a concrete primary approach + an explicit fallback, with the timer logic fully covered by Task 5 — not a missing implementation.

**Type consistency:** `IdleWatchdog(ms, onTimeout)` with `kick()`/`stop()` consistent across Tasks 5/6. `cancelAllRunning()` consistent across Tasks 7. Error codes `INTERRUPTED` (client-set, Task 2) / `TIMEOUT` (server-set, Task 6) consistent with the ChatPane branches (Task 4) and i18n keys (Task 1). `reconnecting` prop consistent across Composer/InputBar (Task 4). `idleTimeoutMs` field consistent across the Session constructor + `runTurn` (Task 6).
