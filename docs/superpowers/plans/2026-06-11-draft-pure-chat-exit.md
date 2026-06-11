# Draft Pure-Chat Exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the new-conversation draft, make "switch back to 纯对话" an obvious, reversible affordance — a removable folder chip in the composer plus a matching exit in the Files panel header.

**Architecture:** Frontend-only. Both controls call the existing, already-tested `useDraftStore` action `clearProject()` (reverts the draft to `mode:'chat'`, `cwd:undefined`). No store, protocol, or sidecar changes. Committed-session detach is explicitly out of scope (deferred — needs protocol + sidecar).

**Tech Stack:** React 18 + TypeScript, Zustand, Tailwind (custom teal tokens in `src/styles/tokens.css`), lucide-react icons, react-i18next, vitest (node env — no component test harness), wdio+tauri E2E.

**Testing note:** The repo has no `.tsx`/RTL unit harness (vitest runs in `node`). The logic these controls invoke (`clearProject`) is already covered by `src/store/draftStore.test.ts`. So the test layer for this change is: (a) keep the full vitest suite + `type-check` green, (b) add wdio+tauri E2E regressions (run via the project's GUI E2E workflow), (c) GUI acceptance in the dev preview. There is no runnable red→green unit cycle for the JSX wiring; do not invent one.

---

### Task 1: Add the `artifact.backToChat` i18n key

**Files:**
- Modify: `src/i18n/en.ts` (artifact block, near `refresh` ~line 98)
- Modify: `src/i18n/zh-CN.ts` (artifact block, near `refresh` ~line 98)
- Modify: `src/i18n/zh-TW.ts` (artifact block, near `refresh` ~line 98)

- [ ] **Step 1: Add the key to `en.ts`**

In `src/i18n/en.ts`, find the artifact `refresh: 'Refresh',` line and add immediately after it:

```ts
      backToChat: 'Pure chat',
```

- [ ] **Step 2: Add the key to `zh-CN.ts`**

In `src/i18n/zh-CN.ts`, find `refresh: '刷新',` and add immediately after it:

```ts
      backToChat: '纯对话',
```

- [ ] **Step 3: Add the key to `zh-TW.ts`**

In `src/i18n/zh-TW.ts`, find `refresh: '重新整理',` and add immediately after it:

```ts
      backToChat: '純對話',
```

- [ ] **Step 4: Type-check (the `en` resource is the typed source of truth for i18n keys)**

Run: `yarn type-check`
Expected: PASS (no errors). This confirms the new key is consistent across the typed resources.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "i18n: add artifact.backToChat (纯对话) for the Files-panel exit"
```

---

### Task 2: Composer `FolderPill` bound state → removable chip

**Files:**
- Modify: `src/components/chat/FolderPill.tsx` (import line 1; bound branch lines 26-49)

- [ ] **Step 1: Add the `X` icon to the lucide import**

Change line 1 of `src/components/chat/FolderPill.tsx` from:

```tsx
import { Folder } from 'lucide-react'
```

to:

```tsx
import { Folder, X } from 'lucide-react'
```

- [ ] **Step 2: Replace the bound-state JSX with a removable chip**

Replace the entire `if (bound) { ... }` block (lines 26-49) with:

```tsx
  if (bound) {
    return (
      <div
        className="flex items-center overflow-hidden rounded-md border border-accent/30 bg-accent-subtle text-meta text-accent-strong"
        data-testid="folder-chip"
      >
        <button
          onClick={pick}
          data-testid="change-folder"
          title={bound}
          className="flex items-center gap-1.5 py-1 pl-2.5 pr-1.5 transition-colors hover:bg-accent-active"
        >
          <Folder size={13} className="text-accent-strong" />
          {basename(bound)}
        </button>
        <button
          onClick={() => useDraftStore.getState().clearProject()}
          data-testid="clear-folder"
          title={t('chat.clearFolder')}
          aria-label={t('chat.clearFolder')}
          className="flex items-center py-1 pl-1 pr-1.5 transition-colors hover:bg-accent-active"
        >
          <X size={13} />
        </button>
      </div>
    )
  }
```

(The unbound `return` below it — the `pick-folder` button — is unchanged.)

- [ ] **Step 3: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Run the full unit suite (nothing should regress)**

Run: `yarn test`
Expected: PASS (same suite as before; this change touches no tested logic).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/FolderPill.tsx
git commit -m "feat(chat): make the draft folder pill a removable chip (✕ → 纯对话)"
```

---

### Task 3: Files panel `FileTree` header → draft-only "纯对话" exit

**Files:**
- Modify: `src/components/artifact/FileTree.tsx` (import line 3; header action group lines 112-128)

- [ ] **Step 1: Add `MessageSquare` to the lucide import**

Change line 3 of `src/components/artifact/FileTree.tsx` from:

```tsx
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FolderGit2, RefreshCw } from 'lucide-react'
```

to:

```tsx
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FolderGit2, RefreshCw, MessageSquare } from 'lucide-react'
```

- [ ] **Step 2: Add the exit button as the first action in the header group**

Find the header action group (currently `<div className="flex items-center gap-0.5">` containing the refresh and change-folder buttons, ~line 112). Insert the following as the FIRST child, immediately after the opening `<div className="flex items-center gap-0.5">` line and before the refresh `<button>`:

```tsx
          {isDraft && (
            <button
              title={t('artifact.backToChat')}
              aria-label={t('artifact.backToChat')}
              data-testid="tree-back-to-chat"
              onClick={() => useDraftStore.getState().clearProject()}
              className="rounded p-1 text-accent-strong transition-colors hover:bg-surface-muted"
            >
              <MessageSquare size={13} />
            </button>
          )}
```

(`isDraft` and `useDraftStore` are already in scope — `isDraft` comes from `useFsScope()` at line 63, and `useDraftStore` is imported at line 8.)

- [ ] **Step 3: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Run the full unit suite (nothing should regress)**

Run: `yarn test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/FileTree.tsx
git commit -m "feat(artifact): add draft-only 纯对话 exit to the Files panel header"
```

---

### Task 4: E2E regressions for both exits

**Files:**
- Modify: `e2e/specs/project-workspace.spec.ts`

These insert into the existing stateful flow inside `describe('new conversation', ...)`, right AFTER the test `'picking a folder opens the tree without creating a sidebar row'` and BEFORE `'renders a Markdown preview (rendered, not source)'`. Each new test restores project mode at its end so the subsequent preview tests still find the tree.

- [ ] **Step 1: Insert the two regression tests**

After the closing `})` of the `it('picking a folder opens the tree without creating a sidebar row', ...)` block, insert:

```ts
  it('the composer chip ✕ returns to pure-chat (then re-pick restores the tree)', async () => {
    await (await browser.$('[data-testid="clear-folder"]')).click()
    // The default pick affordance reappears → we are back in chat mode.
    await (await browser.$('[data-testid="pick-folder"]')).waitForExist({ timeout: 10000 })
    // Restore project mode for the preview tests that follow.
    await (await browser.$('[data-testid="pick-folder"]')).click()
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
  })

  it('the Files-panel exit returns the tree to sandbox-pending (then re-pick restores it)', async () => {
    await (await browser.$('[data-testid="tree-back-to-chat"]')).click()
    // The tree entries are gone (chat-mode draft → "沙箱待创建" placeholder).
    await browser.waitUntil(async () => !(await (await entry('/README.md')).isExisting()), { timeout: 10000, interval: 200 })
    // Restore project mode for the preview tests that follow.
    await (await browser.$('[data-testid="pick-folder"]')).click()
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
  })
```

- [ ] **Step 2: Type-check the spec compiles**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/project-workspace.spec.ts
git commit -m "test(e2e): cover both draft pure-chat exits (chip ✕ + Files-panel)"
```

- [ ] **Step 4 (manual, via the project's GUI E2E workflow): run E2E**

Run: `yarn test:e2e` (per the project's wdio+tauri launch procedure; this is a GUI run and is paid-call-free for this flow — it clears before sending any message).
Expected: the `new conversation` describe block passes, including the two new tests.

---

### Task 5: GUI acceptance + final verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev preview and confirm a clean console**

Use the preview tooling to start the Vite dev server and open the new-conversation landing. Confirm no console/network errors on load.

- [ ] **Step 2: Drive the draft into project mode and verify both controls render**

In the preview, run:

```js
useDraftStore.getState().pickProject('/tmp/demo-project'); useUiStore.getState().setPanelOpen(true); useUiStore.getState().setTab('files')
```

(If `useDraftStore`/`useUiStore` are not global in the preview, trigger the same state by clicking `pick-folder` and using the dialog seam.) Confirm: the composer shows the accent-tinted folder chip `[📁 demo-project ✕]` (testids `folder-chip`, `change-folder`, `clear-folder`), and the Files panel header shows the `tree-back-to-chat` button.

- [ ] **Step 3: Verify the composer ✕ returns to pure-chat**

Click the chip's `clear-folder` (✕). Confirm the composer reverts to the default `pick-folder` button and the Files panel shows the "沙箱待创建" placeholder. Screenshot for the record.

- [ ] **Step 4: Verify the Files-panel exit returns to pure-chat**

Re-enter project mode (Step 2), then click `tree-back-to-chat`. Confirm the tree returns to the "沙箱待创建" placeholder and the composer shows `pick-folder`. Screenshot for the record.

- [ ] **Step 5: Final green check**

Run: `yarn type-check && yarn test`
Expected: both PASS.

- [ ] **Step 6: (Already committed per task.) Confirm branch state**

Run: `git log --oneline -6` and `git status`
Expected: the spec + four implementation commits present, working tree clean.
