# Per-Session Config (Slice 6) — Design

**Date:** 2026-06-10
**Theme:** Roadmap theme 6 — per-conversation control
**Status:** Approved (pending spec review)

## Goal

Two things, one slice:

1. **Bug fix — restore config on reload.** Today `session:loaded` carries only messages, so a reopened/resumed session falls back to `DEFAULT_CONFIG` in the UI while the sidecar uses the persisted config. The thinking toggle and the Files-tab cwd visibly diverge from truth. Fix: `session:loaded` carries `config`, and the reducer adopts it.

2. **Feature — per-conversation instructions ("styles").** Let the user attach freeform instructions to a single conversation, picked from a small reusable local library, modeled on Claude Desktop's per-chat Styles. The instructions are **appended** to the built-in supervisor prompt (they augment, never replace, the delegation/workspace rules).

## Non-Goals (explicitly out of scope)

- **No model selector.** DeepSeek offers only `deepseek-chat` / `deepseek-reasoner`, and the existing thinking toggle already switches between them. A separate model picker would fight it. (`resolveModel` is unchanged.)
- **No draft-stage styles.** Styles apply to a committed (persisted) session only. A pre-commit new-conversation draft has no session id to configure; the first send commits it with `DEFAULT_CONFIG`, and the chip is inert until then.
- **No preset library in SQLite.** The library is a pure frontend convenience asset in `localStorage`. The sidecar only ever sees the resolved instruction text (copy semantics).
- **No subagent prompt injection.** User instructions augment the **supervisor** only — the user-visible "voice". Planner/coder/reviewer prompts are unchanged.
- **No generic `session:configure` message, no Projects entity, no writing-example / AI-assisted style editing.**

## Architecture

The slice splits cleanly into two independent parts. Part 1 is a 3-file correctness fix; Part 2 is the feature. They share the protocol file but touch disjoint message types.

Both parts follow the **existing per-session-mutation precedent** end to end: `session:setThinking` (client) → `Session.setThinking()` idle-guarded rebuild → `store.updateConfig()` persist → `session:thinking` (server echo of the REAL state) → reducer folds it into `config`. We clone that path for `systemPrompt`. There is **no new persistence schema** — config is already a JSON blob column (`sessions.config`) written by `updateConfig`.

---

## Part 1 — Restore config on `session:loaded`

### Protocol (`packages/protocol/src/index.ts`)

Add an optional field (additive, backward-compatible — an older sidecar omits it, an older client ignores it):

```ts
| { type: 'session:loaded'; sessionId: string; messages: Message[]; config?: SessionConfig }
```

### Sidecar (`packages/sidecar/src/session/session-manager.ts`)

In the `session:load` handler, include the persisted config from the DB row:

```ts
case 'session:load': {
  const config = this.store ? JSON.parse(this.store.getSession(msg.sessionId)?.config ?? 'null') ?? undefined : undefined
  send({ type: 'session:loaded', sessionId: msg.sessionId, messages: this.store?.loadMessagesWithRuns(msg.sessionId) ?? [], config })
  break
}
```

`getSession` already exists (used by `ensureSession`). A scratch (no-cwd) session had its server-derived cwd written into `config` at create time, so `config.cwd` is always present on reload.

### Frontend reducer (`src/domain/sessionStore.ts`)

The `session:loaded` case adopts the server config when present (server is the single source of truth):

```ts
case 'session:loaded':
  return update(msg.sessionId, (s) => {
    const last = msg.messages[msg.messages.length - 1]
    const interrupted = last?.role === 'user'
    return {
      ...s,
      loaded: true,
      config: msg.config ?? s.config,   // adopt persisted config; keep current if an older sidecar omits it
      messages: msg.messages,
      status: interrupted ? 'error' : 'idle',
      error: interrupted ? { code: 'INTERRUPTED', message: '' } : null,
    }
  })
```

This is safe against `session:list:result`, which already preserves a loaded VM's fields.

---

## Part 2 — Per-conversation instructions

### Protocol (`packages/protocol/src/index.ts`)

`SessionConfig.systemPrompt?: string` already exists — it becomes the canonical "user's additional instructions for this conversation" field. Add one client message and one server echo, mirroring `setThinking`/`thinking`:

```ts
// ClientMessage
| { type: 'session:setSystemPrompt'; sessionId: string; systemPrompt: string | null }  // null clears

// ServerMessage
| { type: 'session:systemPrompt'; sessionId: string; systemPrompt: string | null }     // echoes the REAL state
```

`null` over the wire = "no extra instructions". On the config it normalizes to `systemPrompt: undefined`.

### Sidecar — compose, not replace

**`packages/sidecar/src/session/agents.ts`** — change `buildSupervisorPrompt` to **append** optional user instructions (today the field *replaces* the whole prompt in `session.ts`; that path is removed). Pure function, directly unit-testable:

```ts
export function buildSupervisorPrompt(cwd: string, userInstructions?: string): string {
  const base =
    `${SUPERVISOR_BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}\n\n` +
    'In your final summary, only report files the coder actually wrote via tool calls.'
  const extra = userInstructions?.trim()
  return extra
    ? `${base}\n\n## Additional instructions from the user (for this conversation)\n${extra}`
    : base
}
```

**`packages/sidecar/src/session/session.ts`** — `buildAgent()` composes instead of replacing:

```ts
// was: systemPrompt: this._config.systemPrompt ?? buildSupervisorPrompt(promptCwd),
systemPrompt: buildSupervisorPrompt(promptCwd, this._config.systemPrompt),
```

Add a setter mirroring `setThinking` (idle-only; returns `false` if a turn is running so the manager can echo the real, un-changed state):

```ts
/** Set/clear per-conversation instructions and rebuild the agent. NO-OP (returns false) while a turn is running. */
setSystemPrompt(systemPrompt: string | null): boolean {
  if (this.running) return false
  const next = systemPrompt?.trim() || undefined
  this._config = { ...this._config, systemPrompt: next }
  this.buildAgent()
  return true
}
```

**`packages/sidecar/src/session/session-manager.ts`** — handler clones the `setThinking` case:

```ts
case 'session:setSystemPrompt': {
  const s = this.ensureSession(msg.sessionId)
  const applied = s.setSystemPrompt(msg.systemPrompt)
  if (applied) this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
  send({ type: 'session:systemPrompt', sessionId: msg.sessionId, systemPrompt: s.config.systemPrompt ?? null })
  break
}
```

### Frontend — service + reducer

**`src/domain/sessionService.ts`** — clone `setThinking`:

```ts
setSystemPrompt(id: string, systemPrompt: string | null): void {
  useDomainStore.getState().apply({ type: 'session:systemPrompt', sessionId: id, systemPrompt }) // optimistic
  this.transport.send({ type: 'session:setSystemPrompt', sessionId: id, systemPrompt })
}
```

**`src/domain/sessionStore.ts`** — reducer case (normalizes `null` → `undefined` so config shape stays clean):

```ts
case 'session:systemPrompt':
  return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, systemPrompt: msg.systemPrompt || undefined } }))
```

If a change is somehow attempted mid-turn (UI disables it, but defense in depth), the sidecar rejects and echoes the real state, which re-applies through this same case and corrects the optimistic value — identical to thinking.

### Frontend — the style library (`src/store/stylesStore.ts`, new)

A pure `localStorage`-persisted zustand store, copying `draftStore.ts`'s persist setup verbatim (`createJSONStorage` + `memoryStorage()` fallback so node tests don't crash, `partialize`, name `hip-styles`):

```ts
export interface StylePreset { id: string; name: string; text: string }

interface StylesStore {
  presets: StylePreset[]
  addPreset: (name: string, text: string) => StylePreset
  updatePreset: (id: string, patch: Partial<Pick<StylePreset, 'name' | 'text'>>) => void
  removePreset: (id: string) => void
}
```

The library is a **source of convenience only**: applying a preset copies its `text` into the session config. The library and the session are thereafter independent (editing a preset later does not retro-change conversations already using its text — copy semantics).

### Frontend — the chip + picker + manager

**Chip** — `InputBar` renders the new `StylePicker` component into a `slot` that `Composer` exposes in the left group next to the Thinking toggle. (Composer stays a pure presentational shell; `InputBar` already owns `activeSessionId`/`session`, so the picker — which reads the stylesStore and calls the service — lives with it, not pushed through Composer props.) Composer gains one optional prop:

```ts
// Composer
leftSlot?: React.ReactNode   // rendered after the Thinking toggle; InputBar passes <StylePicker/> here
```

**Chip label** — a pure helper `resolveStyleLabel(systemPrompt, presets)` in `src/lib/styles.ts` (a `.ts`, unit-testable without rendering): returns the matching preset's `name`; if `systemPrompt` is set but matches no preset → `{ kind: 'custom' }`; if unset → `{ kind: 'none' }`. The component maps the result to localized text + icon. The chip is disabled while `status === 'running'` (same gate as thinking).

**Picker** (`StylePicker.tsx`, new) — clicking the chip opens a `DropdownMenu` (existing radix primitive): a "None" item (clears → `sessionService.setSystemPrompt(id, null)`), each preset as a selectable item (checkmark on the active one → `setSystemPrompt(id, preset.text)`), a separator, and a "Manage styles…" item that opens the manager Modal. The picker reads `useStylesStore` and the active session directly; it renders nothing (or a disabled chip) when there is no active session.

**Manager** — a `Modal` (existing radix-dialog primitive), co-located in `StylePicker.tsx`: lists presets with edit (name `Input` + `Textarea`) and delete (`removePreset`), plus a "new preset" form (`addPreset`). Library-only; does not touch any session.

### i18n (`src/i18n/{en,zh-CN,zh-TW}.ts`)

New keys under `chat`: style chip label, "Custom", "None", "Manage styles", manager dialog title, name/instructions field labels, new/save/delete buttons, and an empty-library hint. All three locales.

## Data Flow — applying a style

```
user picks preset in DropdownMenu
  → sessionService.setSystemPrompt(activeId, preset.text)
      → optimistic apply session:systemPrompt → config.systemPrompt updated → chip reflects immediately
      → ws send session:setSystemPrompt
          → manager.ensureSession → Session.setSystemPrompt (idle check) → buildAgent() rebuild
          → store.updateConfig (persist JSON config)
          → echo session:systemPrompt (REAL state) → reducer re-applies (idempotent; corrects if rejected mid-turn)
```

Next turn's agent is built with the composed supervisor prompt. Reload later → Part 1 restores `config.systemPrompt` → chip shows the right style.

## Error Handling

- **Change while running:** UI disables the chip; sidecar `setSystemPrompt` returns false and echoes the unchanged real state → optimistic value self-corrects. (Thinking precedent.)
- **Legacy session config without `systemPrompt`:** field is `undefined` → `buildSupervisorPrompt` appends nothing → pure built-in prompt.
- **Preset edited after being applied:** the conversation keeps its copied text; the chip's name match may fail and fall back to "Custom". Acceptable, expected copy semantics.
- **Empty/whitespace instructions:** normalized to `undefined` both client- and server-side → treated as "no style".
- **Older sidecar (no `config` on `session:loaded`):** reducer keeps current config (`msg.config ?? s.config`).

## Testing

**Sidecar (unit, no live LLM):**
- `buildSupervisorPrompt(cwd)` → no "Additional instructions" section; `buildSupervisorPrompt(cwd, '  ')` → none; `buildSupervisorPrompt(cwd, 'Be terse')` → appends the section with the text.
- `Session.setSystemPrompt`: applies + persists when idle; returns false and does not mutate config while running (use the running-flag setup from the existing setThinking test).
- `session-manager` `session:setSystemPrompt`: echoes real state; persists via `updateConfig`; mid-turn echo reflects unchanged state.
- `session:load` returns `config` from the row (extend an existing store/manager test).

**Frontend (unit):**
- reducer `session:systemPrompt` sets/clears `config.systemPrompt` (null → undefined).
- reducer `session:loaded` adopts `msg.config` when present, keeps `s.config` when absent.
- `stylesStore` CRUD (add returns preset with id; update patches; remove drops).
- `resolveStyleLabel` helper: matched preset name / `{kind:'custom'}` / `{kind:'none'}`.

**Presentational (Composer chip, DropdownMenu picker, Manager modal):** type-check + **manual GUI acceptance**, per project convention (no DOM/RTL tests). Live DeepSeek path: GUI acceptance that a styled conversation actually honors the instructions.

## Files Touched

| File | Part | Change |
|---|---|---|
| `packages/protocol/src/index.ts` | 1+2 | `session:loaded.config?`; `session:setSystemPrompt`; `session:systemPrompt` |
| `packages/sidecar/src/session/session-manager.ts` | 1+2 | `session:load` includes config; `session:setSystemPrompt` handler |
| `packages/sidecar/src/session/session.ts` | 2 | `buildAgent` composes; `setSystemPrompt` setter |
| `packages/sidecar/src/session/agents.ts` | 2 | `buildSupervisorPrompt(cwd, userInstructions?)` appends |
| `src/domain/sessionStore.ts` | 1+2 | `session:loaded` adopts config; `session:systemPrompt` case |
| `src/domain/sessionService.ts` | 2 | `setSystemPrompt` method |
| `src/store/stylesStore.ts` | 2 | **new** — localStorage preset library |
| `src/lib/styles.ts` | 2 | **new** — `resolveStyleLabel` pure helper |
| `src/components/chat/Composer.tsx` | 2 | add `leftSlot` prop |
| `src/components/chat/InputBar.tsx` | 2 | render `<StylePicker/>` into Composer's `leftSlot` |
| `src/components/chat/StylePicker.tsx` | 2 | **new** — chip + DropdownMenu picker + Manager modal |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | 2 | style keys (3 locales) |
| sidecar + domain test files | 1+2 | as above |
```
