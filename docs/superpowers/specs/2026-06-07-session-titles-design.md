# Session Titles (Auto-title + Rename) — Design

**Date:** 2026-06-07
**Status:** Approved (pending written-spec review)
**Goal:** Give every conversation a meaningful, live-updating title — an instant placeholder derived from the first message, refined into a concise LLM-generated title after the first reply — and let the user rename any session via a right-click context menu. User-set titles are never overwritten by auto-titling.

---

## 1. Scope

### In scope
- **Auto-title (hybrid):** on the first user message, instantly set the title to a truncated form of that message and **push it to the frontend** (today this write happens but is never sent to the client, so the sidebar keeps showing `新对话`). After the first reply completes, generate a concise title with a single lightweight DeepSeek completion and replace it live.
- **Manual rename:** right-click a session in the sidebar → context menu (Rename / Delete) → inline edit of the title.
- **"Pinned" semantics:** a manual rename marks the title as user-set; auto-titling (truncate *and* LLM) never overwrites a user-set title.
- **Live title push:** a single `session:title` server message carries every title change (instant truncate, LLM refine, rename echo) to the frontend.

### Out of scope (explicit non-goals)
- Re-titling on later turns. Auto-title fires exactly once, on the first turn of a session.
- Bulk rename, title history/undo, or per-session title-language override.
- Renaming from anywhere other than the sidebar list (no command palette, no header rename).
- Automated tests that spend real DeepSeek quota. The production LLM-title path is validated by GUI acceptance, consistent with the project convention (see `prefer-gui-over-real-llm-tests`).

### Constraints
- The **sidecar is authoritative** for the persisted title; the frontend is a view that updates optimistically on rename and is corrected by the server echo.
- Existing offline tests inject a `FakeListChatModel`. The LLM-title path must stay **off** for injected-model sessions so those tests need no change and CI spends no quota.

---

## 2. Behavior & timing

| Moment | What happens |
|---|---|
| New session created | Title = `新对话` (unchanged). `title_custom = 0`. |
| First user message (`seq === 1`) | Sidecar derives a truncated title via `deriveTitle()`, writes it with `updateTitleIfAuto`, and **pushes `session:title`** → sidebar updates instantly. |
| First reply completes | If first turn **and** the title is still auto (`title_custom = 0`) **and** a title generator is available **and** the reply is non-empty: run one DeepSeek completion to produce a concise title, sanitize it, `updateTitleIfAuto`, and push `session:title` **only if a row actually changed**. |
| User renames | Inline edit → frontend optimistically sets the title and sends `session:rename` → sidecar sanitizes, `setCustomTitle` (sets `title_custom = 1`), and echoes `session:title`. |

**Why "pinned" is race-proof:** `setCustomTitle` sets `title_custom = 1`; the LLM refine writes through `updateTitleIfAuto`, whose `WHERE … AND title_custom = 0` guard makes it a no-op once a title is pinned. So even if the user renames during the first turn (before the refine returns), the refine changes zero rows and pushes nothing — the user's title wins. No in-memory flag or cross-component coordination needed.

---

## 3. Data model change

Migrate the schema from `user_version = 1` to `2`, adding one column to `sessions` (transactional, mirroring the existing migration pattern in `schema.ts`):

```sql
ALTER TABLE sessions ADD COLUMN title_custom INTEGER NOT NULL DEFAULT 0;  -- 0 = auto, 1 = user-set
```

Existing v1 databases upgrade in place; every existing row gets `title_custom = 0`. Old rows are already past their first turn, so auto-titling won't touch them — but they remain fully eligible for manual rename (the only title path that applies retroactively).

---

## 4. Protocol changes (`packages/protocol/src/index.ts`)

```ts
// ClientMessage — new
| { type: 'session:rename'; sessionId: string; title: string }

// ServerMessage — new (reused for instant truncate, LLM refine, and rename echo)
| { type: 'session:title'; sessionId: string; title: string }
```

A single server message for all three title sources keeps the frontend reducer to one trivial case (`set title`).

---

## 5. Components

### 5.1 `packages/sidecar/src/persistence/schema.ts`
- Add a v1→v2 migration step that runs the `ALTER TABLE` above and bumps `user_version` to 2, inside the existing transactional `migrate(db)` flow.

### 5.2 `packages/sidecar/src/persistence/store.ts`
- `updateTitleIfAuto(id: string, title: string): number` — `UPDATE sessions SET title=? WHERE id=? AND title_custom=0`; returns `changes` (0 or 1) so callers can decide whether to push.
- `setCustomTitle(id: string, title: string): void` — `UPDATE sessions SET title=?, title_custom=1 WHERE id=?`.
- Remove the now-unused `updateTitle` (its sole caller in `session.ts` switches to `updateTitleIfAuto`).

### 5.3 `packages/sidecar/src/session/session.ts`
- **Injectable title-generator seam:**
  ```ts
  export type TitleGenerator = (input: { firstUserMessage: string; firstReply: string }) => Promise<string>
  ```
  Add a constructor param `titleGenerator?: TitleGenerator`. When omitted **and** `usesEnvModel` is true (production, no injected model), lazily build a default generator backed by a dedicated `ChatOpenAI` (`deepseek-chat`, base URL as in `buildModel`, `maxTokens ≈ 24`). When a model **is** injected (offline tests) and no generator is passed, the generator stays undefined → no LLM call.
- **Instant truncate:** on `seq === 1`, replace the current `updateTitle(...)` with `updateTitleIfAuto(...)` and, if it changed a row, `_send({ type: 'session:title', sessionId: this.id, title })`.
- **LLM refine:** after the turn completes and `message:complete` is sent, if `seq === 1 && titleGenerator && supervisorText`: `await` the generator, sanitize, `updateTitleIfAuto`, and push `session:title` only when `changes === 1`. Wrap in `try/catch` and swallow errors (title is best-effort; the truncated title is the floor). Awaiting (rather than fire-and-forget) keeps tests deterministic; it runs *after* `message:complete`, so the reply is already visible to the user.
- **Sanitize:** trim, collapse internal whitespace, strip surrounding quotes, drop trailing punctuation, truncate to `TITLE_LEN` (40). If empty after sanitizing, skip the push.

### 5.4 `packages/sidecar/src/session/session-manager.ts`
- Handle `session:rename`: sanitize the title (trim; cap length ~200; if empty, fall back to `新对话`), call `store.setCustomTitle(sessionId, title)`, and `send({ type: 'session:title', sessionId, title })`.
- Thread the optional `titleGenerator` into `new Session(...)` (default undefined; production path builds its own). Tests may inject a stub.

### 5.5 `src/domain/sessionStore.ts`
- Reducer: `case 'session:title': return update(msg.sessionId, (s) => ({ ...s, title: msg.title }))`.
- Store action `renameSession(id, title)`: optimistic local set of the title.

### 5.6 `src/domain/sessionService.ts`
- `renameSession(id, title)`: optimistic `useDomainStore.getState().renameSession(id, title)` + `transport.send({ type: 'session:rename', sessionId: id, title })`.

### 5.7 `src/components/ui/ContextMenu.tsx` (new)
- Thin wrapper mirroring `DropdownMenu.tsx`, built on **`@radix-ui/react-context-menu`** (new dependency, same radix family already in use). Exports `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuSeparator` with the existing surface/border/shadow styling.

### 5.8 `src/components/sidebar/SessionItem.tsx`
- Wrap the row in `ContextMenu` / `ContextMenuTrigger` (right-click) with items **Rename** and **Delete**.
- Local `editing` + `draft` state. Selecting **Rename** enters edit mode: render a controlled `<input>` in place of the title span, auto-focused and select-all. Enter (or blur) commits via `sessionService.renameSession(id, draft.trim() || fallback)`; Esc cancels. While editing, `stopPropagation` on the input so clicks don't trigger `onSelect`.
- The existing hover **✕** quick-delete stays as-is.

### 5.9 i18n (`src/i18n/{en,zh-CN,zh-TW}.ts`)
- Add `sidebar.renameSession`: `Rename` / `重命名` / `重新命名`.

---

## 6. Edge cases & error handling

- **Empty rename** → server falls back to `新对话` and echoes it; the client (which optimistically showed empty/old) is corrected by the echo.
- **Over-long rename** → capped at ~200 chars server-side; the sidebar already CSS-truncates display.
- **LLM title failure / network error / no key** → caught and swallowed; the truncated title remains. No error is surfaced (title is non-critical).
- **No API key** → the agent never produces a first reply (NO_API_KEY guard), so the LLM refine never runs; behavior degrades cleanly to the truncated title.
- **Rename before first reply** → `setCustomTitle` pins the title; the later refine no-ops (see §2).

---

## 7. Testing (all offline)

- **schema:** v1→v2 migration is idempotent; `title_custom` defaults to 0 on existing rows.
- **store:** `updateTitleIfAuto` updates when auto and returns 0 (no change) when the title is pinned; `setCustomTitle` sets the flag.
- **session:** first user message pushes `session:title` with the truncated title; with an injected **stub** generator, the turn pushes a second `session:title` with the refined title and persists it; if `setCustomTitle` ran first, the refine pushes nothing. A session with an injected model and **no** generator pushes only the truncate (guards existing tests).
- **session-manager:** `session:rename` calls `setCustomTitle` and echoes `session:title`.
- **frontend:** reducer `session:title` sets the title; `renameSession` updates optimistically; the service sends `session:rename`.
- **No real-LLM automated tests.** The production title generator is exercised in GUI acceptance.

---

## 8. File structure summary

| File | Change |
|---|---|
| `packages/protocol/src/index.ts` | +`session:rename` (client), +`session:title` (server) |
| `packages/sidecar/src/persistence/schema.ts` | v2 migration: `title_custom` column |
| `packages/sidecar/src/persistence/store.ts` | +`updateTitleIfAuto`, +`setCustomTitle`, −`updateTitle` |
| `packages/sidecar/src/session/session.ts` | `TitleGenerator` seam; push truncate; LLM refine + sanitize |
| `packages/sidecar/src/session/session-manager.ts` | handle `session:rename`; thread `titleGenerator` |
| `src/domain/sessionStore.ts` | reducer `session:title`; `renameSession` action |
| `src/domain/sessionService.ts` | `renameSession()` |
| `src/components/ui/ContextMenu.tsx` | **new** radix context-menu wrapper |
| `src/components/sidebar/SessionItem.tsx` | right-click menu + inline title edit |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | +`sidebar.renameSession` |
| `package.json` | +`@radix-ui/react-context-menu` |

---

## 9. GUI acceptance checklist (user)

1. New chat shows `新对话`; sending the first message flips the sidebar title to the truncated text **immediately**.
2. After the first reply finishes, the title refines to a concise LLM-generated summary **without** a reload.
3. Right-click a session → **Rename** → inline edit → Enter persists; relaunch and the renamed title survives.
4. Rename a brand-new session, then send a first message + get a reply: the auto-title does **not** overwrite the manual name.
5. ✕ quick-delete still works.
6. `Esc` cancels an inline rename; empty rename falls back to `新对话`.
