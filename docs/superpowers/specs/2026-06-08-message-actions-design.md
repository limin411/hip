# Message Actions — Stop, Copy, Thinking Placeholder, Regenerate, Inline Retry

- **Date:** 2026-06-08
- **Status:** Approved (brainstorming complete; ready for implementation plan)
- **Branch:** `feat/message-actions` (base `main`)
- **Scope owner note:** This is the first slice of the broader "conversation-business" audit (2026-06-08). It deliberately covers the **message-bubble interaction layer** only. *Edit-and-resend* is explicitly deferred to its own spec because it forces branch/truncate semantics onto an append-only history (see §9).

## 1. Problem & Goals

The chat thread is **render-only**. `MessageBubble.tsx` renders content with zero affordances and `Composer`/`InputBar` wire only "send". Yet the backend already supports the hardest parts:

- **Cancel is fully plumbed** end-to-end — `sessionService.cancel()` (`src/domain/sessionService.ts:150`) → `message:cancel` (`packages/protocol/src/index.ts:54`) → `AbortController.abort()` (`packages/sidecar/src/session/session.ts:296`). No surface ever calls it.
- On abort the sidecar sends `error` `CANCELLED` and **returns before persisting** (`session.ts:233-247`, before `insertTurn` at `:261`). The partial streamed text lives only in the frontend store and vanishes on reload.
- There is **no way to re-run a turn** (no message-delete in the store, no regenerate op), and **no per-message retry** on error — the only error surface is a session-level banner.

This is the most glaring gap versus every mainstream chat app, and the payoff-to-risk ratio is high because the backend foundation exists.

### Goals (user-stated, locked)

- **G1 — Stop button.** Interrupt a running turn from the UI. The partial reply is **kept**, marked "stopped", and **persisted** (survives reload; included in next-turn context).
- **G2 — Copy.** Copy a whole message (raw markdown) and copy any individual code block.
- **G3 — Thinking placeholder.** Show a "thinking" state in the gap between send and the first streamed token.
- **G4 — Regenerate (last only).** Re-run the **last** assistant reply in place. No history truncation/branching.
- **G5 — Inline error retry.** When a turn fails, surface the error inline with a retry that re-runs the last user turn.

## 2. Product Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| D1 | Regenerate scope | **Last assistant reply only.** Re-runs in place via a shared "redo last turn" op; no branch/truncate. |
| D2 | Cancel partial | **Keep + mark "stopped" + persist.** Partial assistant text is finalized to SQLite with a `stopped` flag and pushed into the LangChain context (next turn sees it). |
| D3 | Retry == Regenerate | A failed turn leaves the last message as the *user* message; retry re-runs that turn. This is the **same** client op as regenerate ("delete last assistant **if present**, then re-run"), so one protocol message covers both. |
| D4 | Copy payload | Whole-message copy = **raw markdown** (`message.content`). Per-code-block copy = the code text. |
| D5 | Action-row presentation | **Hover-revealed toolbar** on each bubble. Copy on every bubble; Regenerate only on the **last** assistant bubble. Stopped bubbles show a `已停止` badge. |
| D6 | Inline error | Replace the top session-level banner with an **inline error block** at the end of the thread; `AGENT_ERROR`/network → "重试", `NO_API_KEY` → "去设置". |

## 3. Architecture Overview

Two of the five features (Copy, Thinking placeholder) are **pure frontend**. Stop, Regenerate, and Inline-retry touch the protocol + sidecar + persistence, unified around a single new client op and a single schema migration.

```
Stop:       Composer (Stop btn) → sessionService.cancel() → message:cancel
            → session.ts abort branch: finalize+persist partial (stopped=true)
            → message:complete{ message.stopped:true } → store finalizes bubble (idle)

Regenerate: MessageActions (last assistant) → sessionService.regenerate()
Retry:      inline error block → sessionService.regenerate()      ← SAME op
            → message:regenerate → session.regenerate():
                 if last in-memory msg is AIMessage: pop it + store.deleteLastAssistantMessage()
                 → runTurn()  (last msg is the HumanMessage; no new user insert)
            → normal token:stream / message:complete flow re-streams the reply

Copy:       MessageActions / CodeBlock → clipboard (navigator → Tauri fallback)
Thinking:   ChatPane derived render when status==='running' && last msg role==='user'
```

## 4. Protocol Changes (`packages/protocol/src/index.ts`)

1. **New client op** (covers regenerate **and** retry per D3):
   ```ts
   | { type: 'message:regenerate'; sessionId: string }
   ```
2. **`Message` gains an optional flag:**
   ```ts
   export interface Message {
     id: string
     role: 'user' | 'assistant'
     content: string
     agentId?: string
     timestamp: number
     stopped?: boolean   // assistant turn was cancelled mid-stream; partial content kept
   }
   ```
   `message:complete` already carries a `Message`, so the stopped finalize reuses it — **no new server message type**.

## 5. Sidecar Changes (`packages/sidecar/src/session/`)

### 5.1 Refactor: extract `runTurn` (`session.ts`)

`sendMessage(content, send, userMessageId?)` today does (a) NO_API_KEY guard, (b) persist user message + first-turn title, (c) the streaming/trajectory/persist core, (d) title refine. Extract **(c) the streaming core** into a private:

```ts
private async runTurn(send: SendFn): Promise<{ supervisorText: string }>
```

- It assumes `this.messages` already ends with the `HumanMessage` to answer. It owns: `abortController`, the supervisor/sub-agent pumps, `agent:started/finished`, `token:stream`, the abort/catch branch, the non-empty `AIMessage` push, `insertTurn`, `message:complete`, and `touchSession`.
- `sendMessage` becomes: guard → persist user msg + title (existing) → `push(HumanMessage)` → `runTurn` → title-refine (existing, gated on `isFirstTurn`).

### 5.2 Abort branch persists the partial (D2)

Replace the current early-`return` abort handling inside `runTurn`'s `catch`:

```
on AbortError:
  finishRemaining()
  if (supervisorText) {
    this.messages.push(new AIMessage(supervisorText))     // next turn sees the partial
    insertTurn(<assistant partial, stopped:true>, runs)    // persist; FTS trigger indexes it
    touchSession(ts)
    send message:complete { message: { ...partial, stopped: true } }   // store finalizes bubble
  } else {
    send error CANCELLED                                   // no tokens yet → no bubble; store → idle
  }
  return
```

- Non-abort errors keep the **existing** behavior (send `error` `AGENT_ERROR`, no persist — the user message is already persisted, so the inline retry re-runs that turn).
- The non-empty guard mirrors the existing "don't append an empty assistant turn" rule (`session.ts:249-251`).

### 5.3 New: `regenerate` (`session.ts`)

```ts
async regenerate(send: SendFn): Promise<void> {
  if (this.usesEnvModel && !process.env.DEEPSEEK_API_KEY?.trim()) { send NO_API_KEY; return }
  const last = this.messages[this.messages.length - 1]
  if (last instanceof AIMessage) {
    this.messages.pop()                              // drop from LangChain context
    this.store?.deleteLastAssistantMessage(this.id)  // drop from DB (cascades agent_runs + FTS)
  }
  // If last was a HumanMessage (prior turn errored), nothing to delete — just re-run.
  if (!(this.messages[this.messages.length - 1] instanceof HumanMessage)) return  // nothing to redo
  await this.runTurn(send)
}
```

- **Concurrency guard:** ignore if a turn is already in flight (track an `isRunning` flag set around `runTurn`).
- Regenerate re-runs the full Supervisor→Planner→Coder→Reviewer pipeline (correct — the whole turn is redone).

### 5.4 Routing (`session-manager.ts`)

Add a `message:regenerate` branch that resolves/rehydrates the session (same lazy-resume path as `message:send`) and calls `session.regenerate(send)`.

### 5.5 Persistence (`packages/sidecar/src/persistence/`)

**`store.ts` — new method:**
```ts
/** Delete the most recent message iff it is an assistant turn. Cascades agent_runs + FTS. Returns true if one was removed. */
deleteLastAssistantMessage(sessionId: string): boolean {
  const last = this.db.prepare(
    `SELECT id, role FROM messages WHERE session_id=? ORDER BY seq DESC LIMIT 1`
  ).get(sessionId) as { id: string; role: string } | undefined
  if (!last || last.role !== 'assistant') return false
  this.db.prepare(`DELETE FROM messages WHERE id=?`).run(last.id)  // ON DELETE CASCADE → agent_runs; messages_ad → FTS
  return true
}
```
- Relies on `agent_runs.message_id REFERENCES messages(id) ON DELETE CASCADE` (`schema.ts:18`) and the `messages_ad` FTS trigger (`schema.ts:34`). Both already exist; `deleteSession` already depends on cascade, so `PRAGMA foreign_keys=ON` is already in effect (verify in `open.ts` during impl).

**`store.ts` — `stopped` plumbing:**
- `insertMessage(...)` and `insertTurn(assistant, ...)` accept an optional `stopped?: boolean` on the assistant record; write it to the new column (default 0).
- `loadMessages` selects `stopped` and maps to `Message.stopped` (`!!row.stopped`, omit when 0).

**`schema.ts` — migration `user_version 2 → 3`:**
```sql
ALTER TABLE messages ADD COLUMN stopped INTEGER NOT NULL DEFAULT 0;
```
Follows the existing versioned/transactional migration block pattern (`schema.ts:57-68`).

## 6. Frontend Changes (`src/`)

### 6.1 Domain (`domain/`)

- **`sessionService.ts`** — add `regenerate()` mirroring `cancel()` (reads `activeSessionId`, sends `message:regenerate`), plus an optimistic store call before sending.
- **`sessionStore.ts`:**
  - New action `regenerateLastTurn(sessionId)`: if the last message is `assistant`, drop it; clear `agents`; set `status:'running'`, `error:null`. (If the last message is a user message — the error/retry case — leave messages as-is, just clear error and set running.) The subsequent `token:stream` rebuilds the assistant bubble; `agent:started` repopulates the dashboard.
  - `message:complete` reducer (`finalizeAssistant`) already replaces the trailing assistant message — it carries `stopped` through unchanged via the `Message`. No reducer branch needed beyond passing the field along.

### 6.2 Components (`components/chat/`)

**New:**
- `MessageActions.tsx` — hover toolbar rendered inside a bubble. Props: `message`, `isLastAssistant`. Buttons: **Copy** (all), **Regenerate** (last assistant only). Keeps `MessageBubble` lean.
- `CodeBlock.tsx` — a react-markdown `pre`/`code` component override that renders fenced code with a hover **copy** button (copies the code text). Wired via `<ReactMarkdown components={{ pre: CodeBlock }}>`.
- `ThinkingBubble.tsx` — shimmer / "思考中…" placeholder.

**Changed:**
- `MessageBubble.tsx` — render `<MessageActions>`; show a `已停止` badge when `message.stopped`; pass `components={{ pre: CodeBlock }}` to `ReactMarkdown`.
- `ChatPane.tsx`:
  - Render `<ThinkingBubble>` after the list when `status==='running'` && last message role is `'user'` (G3).
  - Replace the session-level error banner with an **inline error block** at the end of the thread (D6): `AGENT_ERROR`/network → "重试" (`sessionService.regenerate()`); `NO_API_KEY` → "去设置" (opens Settings).
  - Pass `isLastAssistant` to the trailing assistant bubble.
- `Composer.tsx` — accept optional `running?: boolean` and `onStop?: () => void`. When `running`, the submit affordance becomes a **Stop** button (square icon) calling `onStop`; otherwise current send behavior. `NewConversation` omits these props (a draft never runs).
- `InputBar.tsx` — read the active session `status` and pass `running` + `onStop={() => sessionService.cancel()}` to `Composer`.

### 6.3 IPC (`src/ipc/`)

- `clipboard.ts` — `copyText(text)`: try `navigator.clipboard.writeText`; on failure (WKWebView/CSP), fall back to the Tauri clipboard plugin. Co-located with `dialog.ts` / `secrets.ts`. **Risk to verify in the bundled app** (current `tauri.conf.json` CSP + WKWebView secure-context).

### 6.4 i18n (`src/i18n/{en,zh-CN,zh-TW}.ts`)

New strings: `stop`, `copy`, `copied`, `copyCode`, `regenerate`, `thinking`, `retry`, `stopped` (badge), `goToSettings`.

## 7. Data Flow Summary

```
Stop (mid-stream):
  Composer Stop → sessionService.cancel() → message:cancel{sessionId}
  → session.ts abort branch (in runTurn) → (partial non-empty)
     push AIMessage + insertTurn(stopped) + message:complete{stopped:true}
  → store finalizeAssistant → bubble shows 已停止, status idle

Regenerate (last assistant):
  MessageActions → sessionService.regenerate()
     ├─ optimistic: store.regenerateLastTurn (drop last assistant, clear agents, running)
     └─ message:regenerate{sessionId}
  → session.regenerate: pop AIMessage + deleteLastAssistantMessage → runTurn
  → token:stream rebuilds bubble → message:complete finalizes

Retry (after error):
  inline error block → sessionService.regenerate()
     ├─ optimistic: store.regenerateLastTurn (last is user → keep messages, clear error, running)
     └─ message:regenerate → session.regenerate: last is HumanMessage → runTurn

Copy: button → ipc.copyText(message.content | codeText) → transient "已复制"
Thinking: status running + last msg user → <ThinkingBubble> until first token
```

## 8. Edge Cases & Error Handling

- **Double regenerate / regenerate while running** → guarded in `sessionService`/store (status check) and in `session.regenerate` (`isRunning` flag). No-op when running.
- **Cancel at the completion boundary** (abort fires after the stream finished but before persist) → no `AbortError` thrown; the normal success path runs. The Stop button is hidden the instant `status` leaves `running`.
- **Cancel before first token** → `supervisorText` empty → `CANCELLED` error → store maps to `idle`, no bubble (matches today).
- **Regenerate when the only assistant message was itself stopped** → it's still an assistant row → deleted and re-run normally.
- **Retry on `NO_API_KEY`** → no retry button (config error); show "去设置" instead. Regenerate on the sidecar also re-checks the key and emits `NO_API_KEY` if still missing.
- **Stopped partial re-pull** → `message:complete` (incl. stopped) already triggers the FS re-pull in `sessionService.receive` (`:60-67`); a stop after the Coder wrote files keeps the Files panel correct.
- **Clipboard unavailable** → `ipc.copyText` falls back to Tauri; if both fail, surface a small "复制失败" toast (no throw).
- **Reload after stop** → `loadMessages` returns the partial with `stopped:true`; badge re-renders.

## 9. Out of Scope / Deferred (YAGNI)

- **Edit-and-resend** a prior user message — deferred to its own spec; needs branch/truncate semantics over the append-only `messages` table (parent/branch pointers), which is exactly the heavy change this slice avoids.
- **Regenerate any (non-last) assistant turn** — same truncation/branch complexity as edit-and-resend; D1 restricts to last only.
- **Regenerate variants UI** ("‹ 2/3 ›" between alternative responses) — append-only history keeps a single linear thread for v1.
- **Syntax highlighting** of code blocks (color) — `CodeBlock` ships the copy button now; a highlighter (Shiki/Prism) is a separate enhancement.
- **Markdown plugin ecosystem** (LaTeX/footnotes), **composer token counter** — unrelated polish from the audit, not this slice.
- **Sub-agent output inline in the chat thread** — belongs to the "multi-agent visibility" theme.

## 10. Testing Strategy

Per project conventions (manual GUI acceptance for the live-LLM path; unit tests use an **injected mock model** so `yarn test` never hits the paid API):

**Sidecar (Vitest, injected model + temp SQLite):**
- `deleteLastAssistantMessage`: removes a trailing assistant row + cascades its `agent_runs`; no-op when the last row is a user message or the session is empty; FTS row removed (extends `store.test.ts`).
- Migration `2→3`: fresh DB ends at `user_version 3`; an existing v2 DB upgrades and back-fills `stopped=0` (extends `schema.test.ts`).
- Abort persists partial: cancel mid-stream → exactly one assistant message persisted with `stopped=1`, its content == streamed-so-far, and it appears in the next turn's context (extends `session-persist.test.ts` / `session.test.ts` mock paths).
- Abort before first token → no assistant row; `CANCELLED` emitted.
- `regenerate`: with a trailing assistant turn → deletes it then re-runs (one assistant row afterward); after an errored turn (trailing user msg) → re-runs without deleting; ignored while running.

**Store (Vitest, `environment: node`):**
- `regenerateLastTurn`: drops a trailing assistant message, clears `agents`, sets `running`/clears `error`; with a trailing user message leaves messages intact and only flips state.
- `applyServerMessage`: `message:complete` carries `stopped` through `finalizeAssistant`.

**Frontend component (Vitest + RTL where already used):**
- `MessageActions`: copy invokes `ipc.copyText`; regenerate shown only on the last assistant bubble.
- `ChatPane`: ThinkingBubble visible iff running && trailing user message; inline error block shows the right action per error code.

**E2E (WebdriverIO + Tauri):** non-LLM-deterministic assertions only — e.g. Stop button appears while `status==='running'`, the `已停止` badge persists across a reload (seeded via a fake transport / mock turn). Live regenerate/cancel against DeepSeek = manual GUI acceptance.

## 11. Open Questions

None blocking. Settle during the plan:
1. Whether `Composer` reads the active session `status` itself or receives `running` purely as a prop from `InputBar` (favor prop-drilling from `InputBar` to keep `Composer` reusable by `NewConversation`).
2. Confirm `PRAGMA foreign_keys=ON` in `persistence/open.ts` (assumed via existing `deleteSession` cascade) before relying on it for `deleteLastAssistantMessage`.
3. Exact Tauri clipboard fallback (plugin vs `invoke`) — pick the smaller diff once the bundled-app clipboard behavior is verified.
