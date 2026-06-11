# Restore "纯对话" exit in the new-conversation draft

Date: 2026-06-11
Status: approved (design), pending implementation

## Problem

In the conversation feature, after a user opens a project directory there is no
clear way to switch back to pure-conversation (纯对话) mode.

The escape hatch technically exists in the draft composer — `FolderPill` renders a
weak, tertiary-colored text link "纯对话" that calls `clearProject()` — but it is
easy to miss, and the second place a folder can be opened (the **Files panel**,
which auto-opens on pick) offers no matching exit at all. So once a folder is
selected the user feels stuck in project mode.

## Scope

- **In scope:** the new-conversation **draft** stage only (before the first message
  commits the session). Frontend only.
- **Out of scope (deferred):** detaching the folder from an already-committed
  session. That requires protocol + sidecar changes (`session:setCwd` only accepts
  a `string`, and every committed session always carries a `cwd` — a real project
  dir or a `~/.hip/scratch/<id>` sandbox), so there is no current path to clear it.
  Documented here so the gap is explicit, not forgotten.

## Non-goals

- No change to the default (unbound) chat-draft entry button.
- Clearing the folder does not force-close the Files panel; it falls back to the
  existing "沙箱待创建" placeholder.
- No new component test harness (the repo has none for `.tsx`; vitest runs in
  `node`). Coverage stays where it already lives: store logic + wdio/tauri E2E +
  GUI acceptance.

## Design

Reuses the existing, already-tested `useDraftStore` action `clearProject()`
(reverts the draft to `mode: 'chat'`, `cwd: undefined`). No store or backend
changes.

### Change 1 — Composer `FolderPill` bound state → removable chip

File: `src/components/chat/FolderPill.tsx` (bound branch, lines ~26–49).

- Replace the current two-part layout (a folder button + a separate weak text link
  "纯对话") with one cohesive removable chip: `[📁 my-project │ ✕]`, subtly
  accent-tinted so it reads as "project mode active".
- The folder-name area keeps `data-testid="change-folder"` and its
  `onClick={pick}` (re-pick / change folder) and `title={bound}`.
- The "纯对话" affordance becomes an explicit `✕` icon button (lucide `X`),
  keeping `data-testid="clear-folder"`, `onClick={clearProject}`, and
  `title` / `aria-label = t('chat.clearFolder')` so screen readers and the tooltip
  still announce "纯对话". The visible text label is replaced by the icon.
- The default (unbound) state is unchanged — `data-testid="pick-folder"` and the
  `选择项目文件夹 · 或直接对话` copy are preserved (E2E depends on `pick-folder`).

### Change 2 — Files panel `FileTree` header → matching exit (draft only)

File: `src/components/artifact/FileTree.tsx` (bound-state header, lines ~112–128).

- Picking a folder auto-opens the Files panel (`setPanelOpen(true)` +
  `setTab('files')`), so the user's attention lands here with no way back. Add a
  small "纯对话" button (chat icon, lucide `MessageSquare`) into the existing
  header action group beside refresh / change-folder.
- Render it **only when `isDraft`** (draft project mode). Committed sessions
  (`!isDraft`) get nothing — out of scope.
- `onClick={() => useDraftStore.getState().clearProject()}`,
  `data-testid="tree-back-to-chat"`, `title` / `aria-label = t('artifact.backToChat')`.
- After clearing, `useFsScope` reports `chatDraft`, and `FileTree` already renders
  its "沙箱待创建" placeholder — no extra handling needed.

### i18n

- Add `artifact.backToChat` to `en`, `zh-CN`, `zh-TW`:
  - en: `Pure chat`
  - zh-CN: `纯对话`
  - zh-TW: `純對話`
- The composer reuses the existing `chat.clearFolder` key (already present in all
  three locales).

## Verification

- **Logic:** `clearProject` is already covered by `src/store/draftStore.test.ts`.
  The two changes are presentational wiring onto that action.
- **GUI acceptance (dev preview):** drive `useDraftStore.getState().pickProject(...)`
  to enter project mode; confirm the composer chip and the Files-panel exit render;
  click the chip `✕` and the panel button to confirm each returns to pure-chat
  (composer shows the default pick button; the tree shows "沙箱待创建").
- **E2E regression** (`e2e/specs/project-workspace.spec.ts`, run via GUI per the
  project's wdio+tauri workflow): after picking the fixture folder,
  (a) clicking `clear-folder` makes `pick-folder` reappear; (b) re-picking, then
  clicking `tree-back-to-chat`, returns the tree to the sandbox-pending placeholder.

## Risks / notes

- Keep `pick-folder`, `change-folder`, `clear-folder`, `refresh-tree` test IDs
  stable.
- Confirm the accent tint tokens exist before use (`accent-subtle`,
  `accent-strong`, `accent` with opacity); fall back to the existing neutral
  `border-border` + `text-accent-strong` folder icon if any token is missing.
