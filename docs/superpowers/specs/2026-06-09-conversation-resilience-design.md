# Conversation Resilience — Design

**Status:** Approved (2026-06-09)
**Theme:** Roadmap theme 7 (the top open gap after themes 1 & 2 shipped). See `memory` roadmap + the 2026-06-09 audit.

## Motivation — a turn can wedge forever; a finished reply can vanish

The transport reconnect loop is solid (`ws-client.ts`: epoch-guarded backoff + a 100-message send-queue) and `ChatHeader` shows a connection dot + manual Retry. But the **turn** state is decoupled from the **connection** state, so:

1. A mid-turn drop sets the global `connection='disconnected'` but **never touches the active session's `status`** — `InputBar` keeps showing Stop + a live spinner forever (it reads only `status==='running'`).
2. **No turn timeout** anywhere — `runTurn`'s `AbortController` (`session.ts:288`/`356`) is wired *only* to user-cancel; a stalled provider stream (TCP half-open) hangs indefinitely.
3. **Reconnect doesn't resync the active session** — on `'ready'` the client sends only `session:list`, and `selectSession` reloads only when `!loaded`, so a turn that finished during the outage never reappears.
4. **The sidecar doesn't tolerate a dead socket** — no `ws.on('close')`, no `readyState` guard on `send`; with one shared `SessionManager` across reconnects, an in-flight turn keeps streaming into a closed socket (throws / wastes quota).

**Lifecycle reality (local app):** unlike cloud chat clients, hip's "server" is a localhost sidecar. A mid-turn drop is almost never network — it's a **sidecar restart/crash** (turn dies server-side → answer genuinely lost) or a **webview reload** (sidecar survives → turn finishes & persists). The design reconciles both on reconnect.

**Reference-product alignment (informs the decisions):** the idle-timeout watchdog mirrors the ping-aware/idle-timeout fix recommended for the Anthropic SDK (issues #867/#998) and the gap Claude Code still has open (#33949, #26729). The status-reconciliation-on-resume is exactly the model behind Codex's `latestTurnStatus`/`markedStreaming`, whose bug #19690 ("restored turns left `markedStreaming=true` → stuck reconnecting") is the precise trap we avoid. Manual retry matches Claude Code's actual current behavior (`--resume` + "continue"); robust auto-resume is an unshipped feature request even there. True in-flight re-attach (cloud products re-subscribe / resume-from-partial) is deliberately **out of scope** — hip binds a turn's `send` to the socket it started on, so it can't redirect a live stream to a new socket without re-architecture.

## Locked decisions

- **D1 — Transient "reconnecting", reconcile on reconnect.** On a mid-turn drop, *derive* a "reconnecting" state (running + not connected) — disable Stop, show a reconnecting hint — without prematurely declaring failure. On reconnect, resync the active session and reconcile against persisted truth.
- **D2 — Unrecoverable turn → marked interrupted, MANUAL retry.** No auto-retry (avoids surprise re-billing / unwanted re-runs).
- **D3 — Idle timeout = 60s of no stream activity** (a resettable constant, injectable for tests). On fire: abort the turn → the partial persists via the existing finalize path → surface a `TIMEOUT` error (banner + Retry).
- **D4 — On `ws.close` the sidecar cancels all in-flight turns.** Single-window app → the one client just left, so cancel-all is correct. This keeps the model **race-free**: a dropped turn is cleanly aborted + its partial persisted, so reconnect-resync always sees a settled state (no background completion racing a manual retry). A turn that *completed* just before close is unaffected (cancel is a no-op once `running` is false), so it still recovers on resync. (Chosen over "let it finish for recovery" because hip can't deliver a still-streaming turn to the new socket anyway — see Motivation — so keep-running would add the orphan-race for almost no recovery gain.)
- **D5 — No protocol changes.** "Interrupted" is derived client-side in the reducer; the timeout reuses the existing `error` message (`code:'TIMEOUT'`); cancel-on-close reuses the existing cancel path. The `@hip/protocol` surface is unchanged.

## Architecture overview

Three independent units, each testable on its own:

1. **Client: reconnecting state + resync reconciliation** (`sessionStore.ts`, `sessionService.ts`, `InputBar.tsx`, the error banner). Connection state and turn state are joined: the UI derives "reconnecting" from both; reconnect forces a resync; the `session:loaded` reducer reconciles persisted truth into a settled `status`.
2. **Sidecar: dead-socket tolerance** (`ws-server.ts`, `session-manager.ts`). A `ws.on('close')` cancels in-flight turns; `send` is guarded by `readyState`.
3. **Sidecar: idle-timeout watchdog** (`session.ts`). A per-turn idle timer aborts a stalled stream.

## Data flow

**In-session disconnect → reconnect (store survives):**
1. Socket drops → `ws-client` sets `connection='disconnected'` → `setConnection` in the store. The active session's `status` is still `'running'` (optimistic).
2. UI derives `reconnecting = status==='running' && connection!=='connected'` → `InputBar` disables Stop + shows the reconnecting hint. (No reducer state change for this transient phase.)
3. Server side: the sidecar's `ws.on('close')` fires → `cancelAllRunning()` → each running turn aborts → `finalizeAndPersist(stopped=true)` persists the partial (or drops an empty provisional). Any emits hit the guarded `send` (dropped, socket closed).
4. Transport reconnects → `'ready'` → `sessionService` sees the active session was `'running'` → forces `session:load` (resync) for it.
5. `session:loaded` reducer reconciles using the **trailing persisted message** (see below).

**Sidecar restart/crash (store may survive, server memory does not):** the old turn was never finalized (process killed) → no assistant persisted → trailing message is the user turn. New sidecar has no in-flight turn. Reconnect + resync → trailing user message → interrupted. Same reconciliation path.

**Webview reload (store wiped, sidecar alive):** the sidecar's `ws.on('close')` already cancelled + persisted the partial (step 3). Fresh client reconnects → `session:list` → user opens the session → normal `session:load` → the trailing persisted message (stopped partial or user turn) drives reconciliation. (The `wasRunning` signal is gone after a reload, which is why reconciliation keys off the persisted message, not prior client state.)

**Idle timeout (sidecar alive, provider stream stalls):** no activity for 60s → abort → finalize(stopped) → emit `error{code:'TIMEOUT'}` as the terminal state → client banner + Retry.

## Frontend changes (no protocol change)

- **`domain/sessionStore.ts` — `session:loaded` reconciliation.** A completed conversation always ends with an assistant reply, so a **trailing `role:'user'` message means the last turn never completed**:
  ```ts
  case 'session:loaded':
    return update(msg.sessionId, (s) => {
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
  - trailing **user** message → `status:'error'` + `INTERRUPTED` → existing inline banner + Retry.
  - trailing **stopped** assistant (partial persisted) → `status:'idle'` → existing "Stopped" badge + regenerate.
  - trailing **complete** assistant (finished server-side before resync) → `status:'idle'` → the recovered reply just shows.
  This also makes opening *any* historically-interrupted session offer Retry — a free bonus, and it never mis-fires on normal sessions (they end with an assistant reply; an actively-running session is never lazy-loaded because it's already in memory).
- **`domain/sessionService.ts` — resync on reconnect.** In `receive`, on `'ready'`: if the active session's `status === 'running'`, force a `session:load` for it (bypassing the `!loaded` guard). First cold-start (no active session) keeps the existing `session:list`-only behavior. Factor a small `private resyncActiveIfRunning()` helper.
- **`components/chat/InputBar.tsx` — reconnecting UI.** Read `useConnectionStatus()` alongside the existing `useActiveSessionStatus()`. When `reconnecting` (running && not connected): disable the Stop button (cancel into a dead socket is pointless) and show a "reconnecting…" hint in place of the live spinner label. Purely derived; no new store state.
- **Error banner (`components/chat/ChatPane.tsx`).** Add `INTERRUPTED` and `TIMEOUT` branches to the existing code→message mapping (which already distinguishes `NO_API_KEY` vs generic). Their Retry calls `sessionService.regenerate()` (now unblocked — see below).
- **`regenerate` is already correct** (`sessionService.ts:172`: `if (sess.status === 'running') return`). The fix is upstream: interrupted/timeout set `status` to `'error'` (not `'running'`), so Retry/regenerate is no longer inert. No change to `regenerate` itself.

## Sidecar changes (no protocol change)

- **`server/ws-server.ts` — tolerate a dead socket.**
  - Guard `send`: `const send = (msg: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)) }`.
  - Add `ws.on('close', () => this.sessionManager.cancelAllRunning())`.
- **`session/session-manager.ts` — `cancelAllRunning()`.** New method: `for (const s of this.sessions.values()) s.cancel()`. `Session.cancel()` is already a safe no-op when no turn is in flight (`abortController?.abort()` with `abortController === null`). Cancelling a running turn flows through the existing abort → `finalizeAndPersist(stopped=true)` path (persists the partial).
- **`session/session.ts` — idle-timeout watchdog in `runTurn`.**
  - `IDLE_TIMEOUT_MS = 60_000` module constant; make it injectable (Session option/ctor or a settable field) so a unit test can use a tiny value with fake timers.
  - At turn start, arm an idle timer; reset it on every outbound activity send during the turn (token/reasoning/tool/agent events). On expiry: `this.abortController?.abort()`, let the existing abort path finalize the partial as stopped, then emit `{ type:'error', sessionId:this.id, code:'TIMEOUT', message:'' }` as the **terminal** signal (after finalize, so the client ends in the `error` state, not `idle`). Clear the timer in the `finally` block alongside `running=false`.
  - Implementation note: wrap the turn's `send` once (`const sendTick = (m) => { resetIdle(); send(m) }`) and use it for streaming emits, or call `resetIdle()` at the existing emit points — the plan picks the least-invasive form.

## i18n (`src/i18n/{en,zh-CN,zh-TW}.ts`)

- `chat.reconnecting` — e.g. "Reconnecting…" / "重新连接中…" / "重新連線中…".
- `chat.errorInterrupted` — e.g. "Connection lost — the reply didn't finish." / "连接中断，回复未完成。" / "連線中斷，回覆未完成。".
- `chat.errorTimeout` — e.g. "Response timed out and was stopped." / "响应超时，已停止。" / "回應逾時，已停止。".
  Wired into the error-banner code→message map (types derive from `zh-CN`).

## Testing strategy

- **Reducer units (`sessionStore.test.ts`):** `session:loaded` reconciliation — the three branches (trailing user → `error`+`INTERRUPTED`; trailing stopped assistant → `idle`; trailing complete assistant → `idle`). Confirm a normal lazy-load (trailing assistant) lands `idle` and doesn't clobber unrelated state.
- **Service unit (`sessionService.test.ts`):** on `'ready'` with a previously-`running` active session, a `session:load` resync is issued; on `'ready'` with no active session, only `session:list` (unchanged).
- **Sidecar units:**
  - `session-manager`: `cancelAllRunning()` aborts an in-flight turn and is a no-op for idle sessions.
  - `ws-server`: `send` after `readyState !== OPEN` does not throw / does not call `ws.send` (inject a fake ws); `ws.on('close')` triggers `cancelAllRunning`.
  - `session`: the idle watchdog aborts the turn after the injected interval with no activity, and is reset by activity (vitest fake timers); the timer is cleared on normal completion (no abort on a fast turn).
- **Presentational React** (`InputBar` reconnecting state, banner branches): `yarn type-check` + manual GUI acceptance (project convention).
- **Live DeepSeek (skipIf no key):** existing multi-agent + cancel-persist suites stay green under the watchdog (a normal turn emits activity well within 60s, so it must not be killed).

## Risks & deferred validations

- **Timeout false-kill:** a legitimately long reasoner/multi-agent turn must keep emitting within 60s; reset-on-activity prevents a false kill. Validate during GUI acceptance with a long delegating turn.
- **Terminal-state ordering on timeout:** the `TIMEOUT` error must arrive *after* the abort's `message:complete` so the client ends in `error` (banner), not `idle`. The plan pins the emit order; covered by the sidecar test asserting the final emitted error.
- **Resync churn:** forcing `session:load` on every reconnect-with-a-running-turn is one extra load per reconnect — negligible.
- **GUI acceptance pending** (project convention) for the live path, same as slice 2.

## Out of scope (YAGNI)

- True in-flight **resume/re-attach** (delivering a still-streaming turn to the new socket; resume-from-partial). We recover only turns that completed+persisted before resync; everything else is interrupted+retry.
- **Auto-retry** of interrupted turns (D2: manual only).
- **Per-connection session ownership** / multi-window / multi-client sidecar sharing (single-window app → cancel-all-on-close suffices).
- A WebSocket→HTTP/SSE **transport fallback** (Codex-style) — localhost WS doesn't have the internet failure profile that motivates it; the existing reconnect loop is sufficient.
