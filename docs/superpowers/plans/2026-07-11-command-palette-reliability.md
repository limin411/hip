# Command Palette Reliability — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Prefer surgical diffs; do not re-open the large P0–P2 launcher feature plan unless needed.

**Goal:** Fix command-palette functional defects: hotkey index desync, silent skills/init failures, disabled skills, weak session context, memory feedback, diff loading UX, and incomplete shortcuts help.

**Architecture:** Keep existing `cmdk` shell. Share one `flattenHotkeyItems` between render and keydown. Centralize feedback in `domain/commands` + `serverMessageEffects` so slash and palette stay aligned. Session id resolution becomes a pure helper used by `GlobalCommandPalette`.

**Tech Stack:** React 18, TypeScript, Zustand, sonner toasts, i18next, Vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-07-11-command-palette-reliability-spec.md`](../specs/2026-07-11-command-palette-reliability-spec.md)

**Locked defaults (spec §7):**

| Q | Default |
|---|---------|
| Skills no-composer | Toast only; **no** auto Settings |
| Memory-on | use only (scheme A); clear labels |
| History session | `chatSessionId ?? codeSessionId` |
| Init | Navigate code + Changes + result toast |

**Out of scope:** Plugin command API, settings field search, custom keybind editor, compact rework (already shipped).

---

## Dependency graph

```text
T1 pure helpers (hotkey flatten + session resolve) + tests
     │
     ├─► T2 GlobalCommandPalette wire hotkeys (P0-1)
     │
     ├─► T3 skills filter + honest handoff (P0-2, P0-4)
     │
     ├─► T4 init navigate + gitInit toasts (P0-3)
     │
     ├─► T5 session resolve in palette (P1-1)
     │
     ├─► T6 memory toast + exit incognito + copy (P1-2, P1-3)
     │
     ├─► T7 diff loading UX (P1-4)
     │
     ├─► T8 shortcuts help + i18n (P1-5)
     │
     └─► T9 P2 optional: session-then-insert skills, empty context row, docs

Suggested commits: one per T1–T8 (or squash P0 as one commit + P1 as one).
```

**PR / commit order:**

| Batch | Tasks | Theme |
|-------|-------|--------|
| PR-A / commit | T1, T2 | Hotkey correctness |
| PR-B | T3, T4 | Skills + Init honesty |
| PR-C | T5, T6, T7 | Context + memory + diff |
| PR-D | T8 | Help + i18n polish |
| PR-E optional | T9 | P2 polish |

---

## File map

### Create

```
src/components/command-palette/hotkeyItems.ts
src/components/command-palette/hotkeyItems.test.ts
src/components/command-palette/sessionResolve.ts
src/components/command-palette/sessionResolve.test.ts
```

### Modify (primary)

```
src/components/command-palette/favorites.ts          # optionally re-export / keep flattenVisibleItems; add hotkey filter usage
src/components/command-palette/GlobalCommandPalette.tsx
src/components/command-palette/GlobalCommandPalette.test.tsx
src/components/command-palette/registry.ts
src/components/command-palette/registry.test.ts
src/components/command-palette/buildGlobalCommands.ts
src/components/command-palette/buildGlobalCommands.test.ts
src/components/command-palette/keys.ts
src/components/command-palette/ShortcutsHelpDialog.tsx
src/components/command-palette/README.md
src/domain/commands/codeActions.ts
src/domain/commands/codeActions.test.ts
src/domain/commands/memoryActions.ts
src/domain/commands/memoryActions.test.ts
src/domain/commands/slashBuiltins.ts
src/domain/serverMessageEffects.ts
src/domain/serverMessageEffects.test.ts
src/domain/sessionService.ts                        # optional: requestDiff skip callback
src/components/chat/SlashCommandPalette.tsx         # enabled filter in buildCommandList
src/components/chat/SlashCommandPalette.logic.test.tsx
src/components/chat/useSlashCommandHandler.ts       # incognito-off if slash
src/components/chat/useSlashCommandHandler.test.tsx
src/i18n/en.ts
src/i18n/zh-CN.ts
src/i18n/zh-TW.ts
src/i18n/translation-keys.test.ts
e2e/specs/command-palette.spec.ts                  # if cheap coverage exists
e2e/specs/slash-commands.spec.ts
```

### Do not touch (unless required)

```
packages/sidecar compact path
rankGlobalCommands / fuzzyScore (behavior unchanged)
favoritesStore persistence format
```

---

## T1 — Pure helpers: hotkey list + session resolve

**Files:** create `hotkeyItems.ts`, `sessionResolve.ts` + tests.

- [ ] **T1.1** Implement `flattenHotkeyItems(groups)` — flatten all items, **skip** `item.to`.
- [ ] **T1.2** Keep `flattenVisibleItems` for any UI that needs full list; document difference in file comment.
- [ ] **T1.3** Implement `resolvePaletteSessionId(activeView, chatSessionId, codeSessionId)` per spec §3.4.
- [ ] **T1.4** Unit tests: mixed `to` / non-`to` order; view matrix for session id.
- [ ] **T1.5** Commit: `fix(command-palette): pure helpers for hotkeys and session resolve`

```bash
yarn vitest run src/components/command-palette/hotkeyItems.test.ts src/components/command-palette/sessionResolve.test.ts
```

---

## T2 — Wire ⌘1–⌘9 (P0-1)

**Files:** `GlobalCommandPalette.tsx`, tests.

- [ ] **T2.1** Replace keydown list source with `flattenHotkeyItems(visible)`.
- [ ] **T2.2** Replace render `hotkeyCounter` with index lookup into same list (1-based, max 9).
- [ ] **T2.3** Test: groups with one `to` item + two runnables → ⌘1 is first runnable, not the `to` item.
- [ ] **T2.4** Commit: `fix(command-palette): align ⌘1–9 with visible hotkey indices`

```bash
yarn vitest run src/components/command-palette/GlobalCommandPalette.test.tsx
```

---

## T3 — Skills: enabled filter + honest handoff (P0-2, P0-4)

**Files:** `registry.ts`, `GlobalCommandPalette.tsx` (pass enabled if needed), `SlashCommandPalette.tsx` `buildCommandList`, tests, i18n.

- [ ] **T3.1** Filter skills: `enabled[id] !== false` (missing key → treat as enabled).
- [ ] **T3.2** Palette ctx: pass `skillsEnabled: Record<string, boolean>` from `useSkillsStore` **or** read store inside provider (prefer inject for testability).
- [ ] **T3.3** Change `skillsCommandProvider` run:

```ts
run: () => {
  const text = `/${s.name} `
  if (insertComposerText(text)) return
  toast.message(i18n.t('commandPalette.skills.needComposer'))
  // do NOT goSettingsPage('skill') by default
}
```

- [ ] **T3.4** Slash `buildCommandList(skills, { enabled })` same filter.
- [ ] **T3.5** i18n en/zh-CN/zh-TW for `commandPalette.skills.needComposer`.
- [ ] **T3.6** Tests: disabled excluded; no inserter → toast spy, settings not opened.
- [ ] **T3.7** Commit: `fix(command-palette): filter disabled skills and honest handoff`

```bash
yarn vitest run src/components/command-palette/registry.test.ts src/components/chat/SlashCommandPalette.logic.test.tsx
```

---

## T4 — Init: navigate + result toasts (P0-3)

**Files:** `codeActions.ts`, `serverMessageEffects.ts`, tests, i18n.

- [ ] **T4.1** `runInit`: mirror `runDiff` navigation:

```ts
export function runInit(sessionId: string): void {
  sessionService.gitInitWorkspace(sessionId)
  useUiStore.getState().setTab('changes')
  useUiStore.getState().setActiveView('code')
}
```

- [ ] **T4.2** In `fs:gitInit:result`:
  - ok → `toast.success(t('chat.init.success'))`
  - !ok → map `no_workspace` → `chat.init.noWorkspace`, else `chat.init.failed` with `{{error}}`
- [ ] **T4.3** i18n three locales.
- [ ] **T4.4** Tests: runInit calls setTab/setActiveView; effect ok/fail toast (mock sonner).
- [ ] **T4.5** Commit: `fix(command-palette): init navigates to Changes with result toasts`

```bash
yarn vitest run src/domain/commands/codeActions.test.ts src/domain/serverMessageEffects.test.ts
```

---

## T5 — Session resolve in palette (P1-1)

**Files:** `GlobalCommandPalette.tsx`, `buildGlobalCommands` when if needed, tests.

- [ ] **T5.1** Use `resolvePaletteSessionId(activeView, chatSessionId, codeSessionId)` for `ctx.sessionId`.
- [ ] **T5.2** Keep `diff`/`init` `when.views: ['code']` **or** allow all views since handlers force code — **prefer allow views `['chat','code','history','settings']` for init/diff only if handler always navigates**; simpler: expand when to any view with session so History can run them (handlers already switch to code).
- [ ] **T5.3** Spec default: expand `ctx-diff` / `ctx-init` `when.views` to all four **or** omit views and rely on requiresSession — choose **requiresSession only** for init/diff so History works.
- [ ] **T5.4** Test buildGlobalCommands with activeView `settings` + chatSessionId set → compact/memory present.
- [ ] **T5.5** Commit: `fix(command-palette): resolve session outside chat/code views`

```bash
yarn vitest run src/components/command-palette/buildGlobalCommands.test.ts src/components/command-palette/GlobalCommandPalette.test.tsx
```

---

## T6 — Memory feedback + exit incognito (P1-2, P1-3)

**Files:** `memoryActions.ts`, `buildGlobalCommands.ts`, `slashBuiltins.ts`, `useSlashCommandHandler.ts`, i18n, tests.

- [ ] **T6.1** After `setUseMemories` / `setIncognito`, fire short toast (pass copy via i18n in caller or inside action with i18n import — match project style; `memoryActions` already uses sonner for status).
- [ ] **T6.2** Add `setIncognito(sessionId, false)` path; command id `ctx-memory-incognito-off` + slash `memory-incognito-off`.
- [ ] **T6.3** Update labels: memory-on → “Enable memory injection” style (scheme A); ensure zh copy matches.
- [ ] **T6.4** Optional polish: hide redundant commands based on current flags (if cheap); else show all four + off.
- [ ] **T6.5** Tests for handlers + slash list includes new command.
- [ ] **T6.6** Commit: `fix(command-palette): memory action toasts and exit incognito`

```bash
yarn vitest run src/domain/commands/memoryActions.test.ts src/components/chat/useSlashCommandHandler.test.tsx src/components/chat/SlashCommandPalette.logic.test.tsx
```

---

## T7 — Diff loading UX (P1-4)

**Files:** `codeActions.ts` and/or `sessionService.requestDiff`, tests.

- [ ] **T7.1** Ensure `runDiff` **always** sets tab + view even when request deduped.
- [ ] **T7.2** If `requestDiff` returns early due to loading, optional `toast.message(t('chat.diff.loading'))` — only when called from user action (runDiff), not internal refresh. Prefer: `requestDiff` returns `'sent' | 'deduped'`; `runDiff` toasts on deduped.
- [ ] **T7.3** Tests.
- [ ] **T7.4** Commit: `fix(command-palette): diff always opens Changes; toast when already loading`

```bash
yarn vitest run src/domain/commands/codeActions.test.ts src/domain/sessionService.test.ts
```

---

## T8 — Shortcuts help + i18n (P1-5)

**Files:** `keys.ts`, `ShortcutsHelpDialog.tsx` (if static list), i18n ×3, translation-keys test.

- [ ] **T8.1** Extend `getKeybindHelp` entries:

| id | combo | meaning |
|----|-------|---------|
| palette | ⌘K | open |
| slash | / | composer slash |
| hotkeys | ⌘1–⌘9 | run nth visible command |
| prefix-cmd | > | commands only |
| prefix-sess | # | sessions |
| prefix-skill | @ | skills |
| favorite | (text) | star to pin |
| nest-esc | Esc | back from subpage |

- [ ] **T8.2** i18n keys under `commandPalette.shortcuts.*`.
- [ ] **T8.3** translation-keys parity test green.
- [ ] **T8.4** Commit: `docs(command-palette): complete shortcuts help entries`

```bash
yarn vitest run src/i18n/translation-keys.test.ts src/components/command-palette/
```

---

## T9 — P2 optional polish

Do only if P0–P1 green and product wants extras.

- [ ] **T9.1 (P2-1)** Skills: if no inserter but `resolvePaletteSessionId` non-null → `selectSession` then retry insert once after rAF/timeout (max 1–2 retries); else toast.
- [ ] **T9.2 (P2-2)** Richer init/diff success copy from result payloads.
- [ ] **T9.3 (P2-3)** Empty context placeholder command (disabled / no-op with description).
- [ ] **T9.4 (P2-4)** Update `command-palette/README.md` reliability notes; add e2e smoke if harness cheap.
- [ ] **T9.5** Commit: `feat(command-palette): P2 reliability polish`

---

## Cross-cutting checklist

- [ ] No regression on compact (`compact:result` applied/noop).
- [ ] Slash and palette call same domain functions for init/diff/memory.
- [ ] i18n en + zh-CN + zh-TW for every new user string.
- [ ] `yarn vitest run` on touched test paths green before commit.

### Suggested full verification

```bash
yarn vitest run \
  src/components/command-palette \
  src/domain/commands \
  src/domain/serverMessageEffects.test.ts \
  src/components/chat/SlashCommandPalette.logic.test.tsx \
  src/components/chat/useSlashCommandHandler.test.tsx \
  src/i18n/translation-keys.test.ts
```

---

## Task → Spec mapping

| Task | Spec IDs |
|------|----------|
| T1–T2 | P0-1, R1 |
| T3 | P0-2, P0-4, R2, R4 |
| T4 | P0-3, R3 |
| T5 | P1-1, R5 |
| T6 | P1-2, P1-3, R3 |
| T7 | P1-4, R3 |
| T8 | P1-5, R6 |
| T9 | P2-1…P2-4 |

---

## Done when

1. P0-1…P0-4 acceptance rows in the spec pass.  
2. P1-1…P1-5 acceptance rows pass (or explicitly deferred with reason).  
3. Related unit tests green; no intentional silent redirect for skills/init.  
4. Spec status can move to **Accepted / Implemented**.
