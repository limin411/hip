# Knowledge Editor UX — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Surgical diffs only. Do **not** introduce TipTap/WYSIWYG, split preview, markdown toolbar, or IPC/storage changes unless a task explicitly says so.

**Goal:** Make knowledge-base document editing feel like a full-height note surface: single scroll, prose typography, open-to-edit, smooth typing—without changing Markdown-on-disk or save reliability. **Prove the main path on real Tauri via WebdriverIO e2e (KE1–KE6).**

**Architecture:**

- Keep CodeMirror 6 via `@uiw/react-codemirror` + `@codemirror/lang-markdown`.
- **Uncontrolled-after-mount editor:** parent passes `key={docId}` + initial body; `onChange` writes `draftBody` in the store; **do not** pass live `value={draftBody}` back into CodeMirror every keystroke.
- **Workspace** must not subscribe to `draftBody` for rendering the editor tree (avoids re-rendering `SpaceTree` on each key).
- Layout: toolbar + `flex-1 min-h-0` editor host; CM `height="100%"`; one vertical scroller only.
- **E2E:** existing WDIO + `@wdio/tauri-service` harness (`e2e/`); isolated `HIP_DATA_DIR`; tag `@knowledge` + main path `@core` for `yarn test:e2e:gate`.

**Tech Stack:** React 18, Zustand, CodeMirror 6, Vitest, i18next, WebdriverIO (e2e).

**Spec:** [`docs/superpowers/specs/2026-07-13-knowledge-editor-ux-spec.md`](../specs/2026-07-13-knowledge-editor-ux-spec.md)

**Parent context:** [`../specs/2026-07-13-knowledge-base-design.md`](../specs/2026-07-13-knowledge-base-design.md) (storage/entry still authoritative).

**E2E reference:** [`e2e/README.md`](../../../e2e/README.md); pattern sibling [`../specs/2026-07-12-context-menu-e2e-plan.md`](../specs/2026-07-12-context-menu-e2e-plan.md).

**Locked defaults (spec §8):**

| Decision | Value |
|----------|--------|
| Default mode on openDoc | `editing: true` |
| Line numbers / fold | Off |
| Controlled strategy | A — store draft every key; no value echo |
| Split preview / toolbar | Out of scope (P2) |
| Inline title | Out of scope (P1) |
| E2E harness | WDIO + Tauri (no second framework) |
| E2E P0 cases | KE1–KE6; strongly recommend KE7–KE8 |
| E2E tags | `@knowledge` + `@core` on main suite |

**Out of scope:** AI, session inject, graph, export/import, Rust knowledge commands, MiniSearch behavior, full knowledge CRUD e2e matrix, paid `@live` LLM.

---

## Dependency graph

```text
T1 knowledgeStore: openDoc/createDoc default editing + unit tests
     │
     ├─► T2 DocEditor: layout/typography/uncontrolled + autofocus + placeholder
     │         │
     │         └─► T3 DocEditor.test.tsx update
     │
     └─► T4 KnowledgeWorkspace: single-scroll shell, no draftBody subscribe, toggle copy
              │
              ├─► T5 i18n en / zh-CN / zh-TW
              │
              ├─► T6 Vitest regression (store/workspace) + manual checklist
              │
              └─► T7 E2E helpers + knowledge-editor.spec (KE1–KE6, +KE7/KE8)
                        │
                        └─► T8 e2e README tag + gate verify

T9 Optional P1 product (inline title) — does not block P0
T10 Optional P1 e2e (search/delete/chip) — does not block P0
```

**Suggested commits:**

| Commit | Tasks |
|--------|--------|
| 1 | T1 store default editing |
| 2 | T2–T5 UI + i18n |
| 3 | T6 unit regression |
| 4 | T7–T8 e2e + README |

Or squash product (T1–T6) + e2e (T7–T8) as two commits.

---

## File map

### Modify

```
src/store/knowledgeStore.ts
src/store/knowledgeStore.test.ts
src/components/knowledge/DocEditor.tsx
src/components/knowledge/DocEditor.test.tsx
src/components/knowledge/KnowledgeWorkspace.tsx
src/components/knowledge/DocReader.tsx          # optional empty-state only
src/components/knowledge/KnowledgeHome.tsx      # optional: create-space confirm testid
src/i18n/en.ts
src/i18n/zh-CN.ts
src/i18n/zh-TW.ts
e2e/README.md                                  # @knowledge tag + commands
```

### Create

```
e2e/helpers/knowledge.ts
e2e/specs/knowledge-editor.spec.ts
```

### Do not touch

```
src-tauri/src/knowledge.rs
src/ipc/knowledge.ts
src/domain/knowledge/search.ts
src/domain/knowledge/tree.ts
```

---

## T1 — Store: default editing on open

**Files:** `src/store/knowledgeStore.ts`, `src/store/knowledgeStore.test.ts`

- [ ] **T1.1** In `openDoc` success path, set `editing: true` (and `draftBody`/`docBody` as today).
- [ ] **T1.2** Ensure `createDoc` → subsequent open path ends in editing (if create already calls `openDoc`, T1.1 covers it; if not, set editing when selecting new doc).
- [ ] **T1.3** Keep `setEditing` / `flushSave` / `scheduleSave(500)` semantics; only change default flag.
- [ ] **T1.4** Tests: `openDoc` results in `editing === true`; switching doc still flushes previous draft (existing flush tests stay green).

**Verify:** `yarn vitest run src/store/knowledgeStore.test.ts` (or project-equivalent path).

---

## T2 — DocEditor: document canvas + uncontrolled draft

**Files:** `src/components/knowledge/DocEditor.tsx`

- [ ] **T2.1** Props redesign (minimal):

```ts
export interface DocEditorProps {
  /** Remount key source — parent should pass key={docId} as well */
  docId: string
  initialValue: string
  onDraftChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
}
```

  - Remove controlled `value` prop (or keep name but treat as initial only—prefer rename to `initialValue` for honesty).

- [ ] **T2.2** CodeMirror:
  - `value={initialValue}` only as mount value; parent **must** `key={docId}` so doc switches reset content.
  - `onChange` → `onDraftChange` only (no local React state required for A).
  - `height="100%"` (not `min(60vh, 480px)`).
  - `autoFocus`.
  - `placeholder` via basicSetup / CM placeholder extension if available through `@uiw/react-codemirror` `placeholder` prop.

- [ ] **T2.3** `basicSetup`:
  - `lineNumbers: false`
  - `foldGutter: false`
  - Keep `highlightActiveLine` optional true; `bracketMatching` ok; `autocompletion: false`.

- [ ] **T2.4** Theme / typography:
  - Primary font: UI sans stack (match app), `fontSize` ~15px, content `lineHeight` ~1.7, horizontal padding comfortable (~16–24px).
  - Gutters hidden or absent.
  - Soften border: prefer borderless or `border-border` hairline; no heavy dual GitHub+custom clash—prefer `EditorView.theme` + light/dark via existing `useIsDark` **or** single CSS-variable theme.
  - Host wrapper: `className` → `flex h-full min-h-0 flex-1 flex-col` (fill parent).

- [ ] **T2.5** Stabilize extensions:
  - `onBlur` via `useRef` + stable `EditorView.domEventHandlers` so `onChange` identity / blur churn does not `reconfigure` every parent render.

- [ ] **T2.6** `data-testid="knowledge-doc-editor"` retained on host.
- [ ] **T2.7** Ensure `.cm-content` remains in DOM (CodeMirror default) for e2e focus/type.

**Verify:** Typecheck file; e2e in T7.

---

## T3 — DocEditor unit tests

**Files:** `src/components/knowledge/DocEditor.test.tsx`

- [ ] **T3.1** Update mock/`render` for new props (`docId`, `initialValue`, `onDraftChange`).
- [ ] **T3.2** Assert host testid present; change event calls `onDraftChange`.
- [ ] **T3.3** Do not assert fixed pixel height strings that no longer exist.

**Verify:** `yarn vitest run src/components/knowledge/DocEditor.test.tsx`

---

## T4 — KnowledgeWorkspace shell

**Files:** `src/components/knowledge/KnowledgeWorkspace.tsx`

- [ ] **T4.1** Remove `const draftBody = useKnowledgeStore(...)` if only used to feed editor.
- [ ] **T4.2** Edit branch:

```tsx
{editing ? (
  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-…">
      <DocEditor
        key={activeDocId}
        docId={activeDocId}
        initialValue={docBody}
        onDraftChange={setDraftBody}
        onBlur={() => void flushSave()}
        placeholder={t('knowledge.doc.placeholder')}
      />
    </div>
  </div>
) : (
  <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
    <DocReader content={docBody} />
  </div>
)}
```

  Notes:
  - Use **`docBody` as `initialValue`** on mount (in sync with store when entering edit / opening doc). When toggling preview→edit, `setEditing(true)` already sets `draftBody = docBody`; remount editor with `key` and `initialValue={docBody}` after flush so content matches disk+draft.
  - **Conditional render already remounts** when toggling—`initialValue={docBody}` is enough when leaving preview after flush.

- [ ] **T4.3** Main content shell:
  - Parent of reader/editor: `flex min-h-0 flex-1 flex-col overflow-hidden` (edit) vs scroll (preview).
  - Remove outer `overflow-y-auto` wrapping the editor.

- [ ] **T4.4** Toggle button:
  - editing → label `knowledge.doc.preview` (new key) or reuse done→preview copy.
  - !editing → `knowledge.doc.edit`.
  - Keep `data-testid="knowledge-edit-toggle"`.

- [ ] **T4.5** Do not pass live draft into any other child that would re-render the tree unnecessarily.

**Verify:** Typecheck; component tests if present.

---

## T5 — i18n

**Files:** `src/i18n/en.ts`, `zh-CN.ts`, `zh-TW.ts`

- [ ] **T5.1** Add `knowledge.doc.placeholder` (e.g. "Start writing…" / 「开始写作…」).
- [ ] **T5.2** Add or rename preview label: `knowledge.doc.preview`（「预览」/ "Preview" / 「預覽」）.
- [ ] **T5.3** Keep `knowledge.doc.edit` / saving / saved.
- [ ] **T5.4** If translation-key tests exist, ensure new keys included.

**Verify:** translation key test or grep parity across three files.

---

## T6 — Unit regression + manual checklist

- [ ] **T6.1** Update any Workspace/AppLayout tests that assumed default read-only after open.
- [ ] **T6.2** Run:
  - `yarn vitest run src/components/knowledge src/store/knowledgeStore.test.ts`
  - (Optional) `yarn tsc --noEmit` if usually required.
- [ ] **T6.3** Manual (app `yarn tauri dev` if available) — items **not** automated in T7:

| # | Check | Why not e2e |
|---|--------|-------------|
| M1 | Open doc → type immediately, focused | Partial in KE3–KE4 |
| M2 | Resize window → editor height tracks | Layout brittle |
| M3 | Long doc → only one scrollbar in edit mode | Layout brittle |
| M4 | CJK IME composition OK | IME hard in WDIO |
| M5 | Preview shows latest; Edit returns to same text | KE5–KE6 |
| M6 | Switch docs → no content loss | Optional later |
| M7 | Left tree stable while typing | Performance feel |

- [ ] **T6.4** Spec acceptance V1–V10 self-check (V11–V12 after T7).

---

## T7 — E2E: helpers + knowledge-editor spec (P0 gate)

**Harness:** WebdriverIO + Tauri debug binary + Vite `:1420` (same as rest of `e2e/`).  
**Prereq:** `yarn tauri build --debug` (or existing `src-tauri/target/debug/hip`); port 1420 free / hip Vite.

**Spec mapping:** KE1–KE6 required; KE7–KE8 strongly recommended in same task.

### T7.0 — Selectors / product small hooks (if needed)

**Files (optional):** `src/components/knowledge/KnowledgeHome.tsx`

- [ ] **T7.0.1** Add `data-testid="knowledge-create-space-confirm"` on create-space modal primary button (locale-stable).
- [ ] **T7.0.2** Do **not** invent random testids; prefer existing list in spec §3.7.
- [ ] **T7.0.3** Prefer real UI entry (`new-session-kb`); only add `__hipE2E.openKnowledgeForE2e` if menu is flaky after retries (mirror settings pattern). **Not** required for first green.

### T7.1 — Helper module

**File:** `e2e/helpers/knowledge.ts`

- [ ] **T7.1.1** `openKnowledgeFromMenu()`:
  - Reuse `+` menu open pattern from `e2e/helpers/surface.ts` (copy retry logic or export `openNewSessionMenu` if clean).
  - Click `[data-testid="new-session-kb"]`.
  - Wait for `[data-testid="knowledge-page"]` (timeout ≥ 20s).

- [ ] **T7.1.2** `createSpaceAndOpen(name: string)`:
  - Click `knowledge-create-space`.
  - Type name into modal input (focused Input or first textbox in dialog).
  - Confirm via `knowledge-create-space-confirm` or Enter.
  - Wait for `knowledge-workspace` **or** click first `knowledge-space-card` then wait workspace.

- [ ] **T7.1.3** `createDocAndExpectEditor()`:
  - Click `knowledge-new-doc`.
  - Wait for `knowledge-doc-editor` (default editing — **must not** require edit-toggle first).
  - Wait for `.cm-content` inside editor host.

- [ ] **T7.1.4** `typeInKnowledgeEditor(text: string)`:
  - Click `.cm-content` (or host) to focus.
  - `browser.keys(text)` **or** chunked keys; avoid depending on Vitest mock testid.
  - Wait until editor text contains marker (`waitUntil` on `getText()` / `execute` read).

- [ ] **T7.1.5** `togglePreview()` / `toggleEdit()`:
  - Click `knowledge-edit-toggle`.
  - Preview: wait `knowledge-doc-reader`; editor absent.
  - Edit: wait `knowledge-doc-editor` again.

- [ ] **T7.1.6** Export only what specs need; keep helpers free of paid LLM / settings side effects.

### T7.2 — Spec file

**File:** `e2e/specs/knowledge-editor.spec.ts`

```ts
describe('knowledge editor ux @knowledge @core', () => {
  // before: waitForAppReady + skipLoginIfPresent + waitForMainApp
  // cases below
})
```

- [ ] **T7.2.1 KE1** — Open knowledge from `+` menu → `knowledge-page` visible.
- [ ] **T7.2.2 KE2** — Create space (unique name with timestamp) → enter `knowledge-workspace`.
- [ ] **T7.2.3 KE3** — New doc → `knowledge-doc-editor` visible **without** clicking edit toggle first.
- [ ] **T7.2.4 KE4** — Type unique plain marker `e2e-kb-<ts>` (no MD syntax) → editor content includes marker.
- [ ] **T7.2.5 KE5** — Toggle preview → `knowledge-doc-reader` text includes marker; editor gone.
- [ ] **T7.2.6 KE6** — Toggle edit → editor back; content still includes marker.
- [ ] **T7.2.7 KE7 (recommended)** — After KE4, wait ≥800ms (debounce) + blur/toggle preview; leave workspace to home and re-open same doc (tree click `knowledge-tree-doc-*`) **or** re-open space; marker still present (proves flush/disk, not only React state).
- [ ] **T7.2.8 KE8 (recommended)** — `knowledge-tab` visible while open; optional close via `knowledge-tab-close` returns to non-knowledge shell without crash.

**Isolation notes:**

- Fresh `HIP_DATA_DIR` per WDIO run → empty knowledge root; create own space/doc.
- Shared app process: if previous suite left settings open, leave settings first (`titlebar-back` / existing helper).
- After suite, optional close knowledge chip so later specs are not stuck (nice-to-have).
- Marker strings: ASCII plain text only for stable preview assertions.

### T7.3 — Run e2e

- [ ] **T7.3.1** Single file:
  ```bash
  yarn test:e2e --spec e2e/specs/knowledge-editor.spec.ts
  ```
- [ ] **T7.3.2** Grep tag:
  ```bash
  E2E_GREP=@knowledge yarn test:e2e
  ```
- [ ] **T7.3.3** Confirm `@core` title includes suite so gate picks it up:
  ```bash
  # after green single-file:
  yarn test:e2e:gate
  # or at least: E2E_GREP='@knowledge' yarn test:e2e
  ```
- [ ] **T7.3.4** On failure: check `E2E_SCREENSHOT_DIR` (default `/tmp/hip-e2e-screenshots`); fix selectors/timing, do not weaken assertions to `pause`-only.

**Verify (done when):** KE1–KE6 green on unpaid harness; KE7/KE8 green or explicitly deferred with note in PR.

---

## T8 — E2E docs + gate hygiene

**Files:** `e2e/README.md` (and optional coverage audit cross-link)

- [ ] **T8.1** Document tag `@knowledge` in README tags table.
- [ ] **T8.2** Document commands:
  ```bash
  E2E_GREP=@knowledge yarn test:e2e
  yarn test:e2e --spec e2e/specs/knowledge-editor.spec.ts
  ```
- [ ] **T8.3** Note: unpaid; uses isolated `HIP_DATA_DIR`; no `@live`.
- [ ] **T8.4** Spec V11–V12 check; mark T7–T8 complete.

**Optional:** One-line in `docs/superpowers/specs/2026-07-13-e2e-business-coverage-audit.md` that knowledge editor path is now covered (only if that file is still maintained).

---

## T9 — Optional P1 product (do not block P0)

- [ ] Inline title input above editor → `renameNode` on blur.
- [ ] Unify empty `DocReader` with placeholder string.

---

## T10 — Optional P1 e2e (do not block P0)

- [ ] Search: type in `knowledge-search` → open hit → lands in editor with body.
- [ ] Delete space confirm flow (destructive; ensure isolation).
- [ ] Chip close restores chat/code surface (`surfaceOf` behavior).

---

## Implementation notes (pitfalls)

1. **`@uiw/react-codemirror` value echo:** If `value` prop changes while typing, wrapper may `dispatch` full replace after 200ms latch. **Never** feed per-keystroke store state back as `value`.
2. **`extensions` dependency arrays:** Unstable `onBlur` / `onChange` causes `StateEffect.reconfigure`—use refs for blur handler.
3. **`flushSave` reads store:** Scheme A requires `setDraftBody` on every CM `onChange` so flush sees latest text.
4. **`openDoc` editing true** changes unit tests that asserted `editing === false` **and** is what KE3 asserts.
5. **Paid LLM tests:** Prefer path-scoped vitest (`src/components/knowledge` …) per `CLAUDE.md`.
6. **CodeMirror e2e input:** Always focus `.cm-content` before keys; unique ASCII markers; `waitUntil` not fixed long sleeps.
7. **`+` menu flaky:** Reuse `surface.ts` Enter/pointer retry; do not single-shot click.
8. **Locale:** Prefer testids over Chinese/English button labels for confirm actions.
9. **Gate cost:** Keep knowledge e2e short (one describe, few its); avoid full-tree CRUD matrix in `@core`.

---

## Done definition

- [ ] All P0 tasks **T1–T8** checkboxes complete (T9–T10 optional)
- [ ] Spec §6 V1–V12 satisfied (V11–V12 = e2e)
- [ ] No Rust/IPC changes
- [ ] `yarn vitest run src/components/knowledge src/store/knowledgeStore.test.ts` green
- [ ] `yarn test:e2e --spec e2e/specs/knowledge-editor.spec.ts` green (KE1–KE6)
- [ ] Working tree ready to commit (user asks before commit/push unless instructed)
