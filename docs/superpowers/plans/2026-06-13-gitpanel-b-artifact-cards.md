# Artifact Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the agent writes renderable files during a turn (images, Markdown, HTML, SVG, PDF), surface them as one aggregate "本轮产物 (N)" card at the bottom of that assistant message. Clicking a file row drives the existing `<FilePreview>` in the 文件 tab and smart-opens the right panel.

**Architecture:** A pure helper `extractRenderedArtifacts(toolCalls)` (mirroring `src/lib/todos.ts`) filters finished `write_file` tool calls, parses their `.path` from JSON input, keeps only paths whose `previewKind()` is renderable, and dedups by path keeping the last write. `<ArtifactCard>` renders that list inside `<MessageBubble>` and on row-click reuses the existing FS preview pipeline (`sessionService.readFile` / `useFsStore.setActive` / `useFsScope`) plus a deferred `setTab('files')` to avoid a mount race. `previewKind()` is extended to recognize `pdf` and (already) `svg`.

**Tech Stack:** React 18 + TypeScript, zustand stores, react-i18next with **typed** i18n (`src/i18n/zh-CN.ts` is the type source via `src/i18n/i18next.d.ts` — every key must exist in all three locales or `tsc` breaks). Vitest with `environment: 'node'` — **no component-test stack** (zero `.test.tsx`); only the pure helper is unit-tested. Test command is `yarn test`; never `vitest run src` (it substring-matches the sidecar's paid real-LLM suites — see the project memory note `vitest-src-filter-runs-paid-tests`).

This slice (Slice B of the gitpanel spec) is **independent** of A1/A2 and touches no protocol, sidecar, or git plumbing — only `previewKind.ts`, a new pure helper, a new component, `MessageBubble.tsx`, and the three i18n files.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/components/artifact/previewKind.ts` | MODIFY | Add `'pdf'` to the `PreviewKind` union and recognize `.pdf` (`svg` already maps to `image`). |
| `src/components/artifact/previewKind.test.ts` | MODIFY | Add assertions for `.pdf` → `'pdf'` and confirm `.svg` → `'image'` by extension. |
| `src/lib/renderedArtifacts.ts` | CREATE | Pure `extractRenderedArtifacts(toolCalls)`: finished `write_file` calls → renderable `RenderedArtifact[]`, deduped by path (last wins). Mirrors `src/lib/todos.ts`. |
| `src/lib/renderedArtifacts.test.ts` | CREATE | Unit tests mirroring `src/lib/todos.test.ts` harness (`tc()` factory, `ToolCall` import). |
| `src/i18n/zh-CN.ts` | MODIFY | Add `artifact.turnOutputs` (parameterized count) under the existing `artifact` block. Type source. |
| `src/i18n/en.ts` | MODIFY | Same key, English copy. |
| `src/i18n/zh-TW.ts` | MODIFY | Same key, Traditional Chinese copy. |
| `src/components/artifact/ArtifactCard.tsx` | CREATE | Aggregate card listing artifacts; row click → preview via FS pipeline + smart auto-open. |
| `src/components/chat/MessageBubble.tsx` | MODIFY | Render `<ArtifactCard>` after the markdown body, before `MessageActions`, only for completed assistant messages with ≥1 renderable artifact. |

---

## Task 1 — Extend `previewKind` to recognize PDF

`previewKind()` is the single source of truth for "is this file renderable". The artifact helper in Task 2 reuses it. We add a `'pdf'` kind. SVG already resolves to `'image'` via the `IMG_EXT` set — we add a test to lock that in.

**Files:**
- Modify: `src/components/artifact/previewKind.ts` (full file, currently 13 lines)
- Test: `src/components/artifact/previewKind.test.ts` (existing, 11 lines)

**Steps:**

- [ ] 1.1 — Add the failing test cases. In `src/components/artifact/previewKind.test.ts`, insert these two `it(...)` lines immediately after the existing `it('detects image by ext', ...)` line (line 8):
  ```ts
    it('detects pdf by ext', () => expect(previewKind('/a/report.pdf', 'application/pdf')).toBe('pdf'))
    it('detects svg as image by ext (no mime)', () => expect(previewKind('/a/icon.svg')).toBe('image'))
  ```

- [ ] 1.2 — Run the test and watch it fail:
  ```bash
  yarn test src/components/artifact/previewKind.test.ts
  ```
  Expected failure: the `pdf` case fails with `expected 'text' to be 'pdf'` (a `.pdf` extension currently falls through to the `ext` truthiness branch and returns `'text'`). The svg-by-ext case should already pass.

- [ ] 1.3 — Implement. Replace the entire contents of `src/components/artifact/previewKind.ts` with:
  ```ts
  export type PreviewKind = 'markdown' | 'html' | 'image' | 'pdf' | 'text' | 'none'

  const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])

  export function previewKind(path: string, mimeType?: string): PreviewKind {
    const dot = path.lastIndexOf('.')
    const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
    if (mimeType?.startsWith('image/') || IMG_EXT.has(ext)) return 'image'
    if (mimeType === 'application/pdf' || ext === '.pdf') return 'pdf'
    if (mimeType === 'text/markdown' || ext === '.md' || ext === '.markdown') return 'markdown'
    if (mimeType === 'text/html' || ext === '.html' || ext === '.htm') return 'html'
    if (mimeType?.startsWith('text/') || ext) return 'text'
    return 'none'
  }
  ```

- [ ] 1.4 — Run the test and watch it pass:
  ```bash
  yarn test src/components/artifact/previewKind.test.ts
  ```
  Expected: all `previewKind` tests pass (8 total: 6 original + 2 new).

- [ ] 1.5 — Commit:
  ```bash
  git add src/components/artifact/previewKind.ts src/components/artifact/previewKind.test.ts
  git commit -m "feat(preview): recognize pdf in previewKind; lock svg→image" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

> **Note on `FilePreview`:** `FilePreview.tsx` has no `'pdf'` rendering branch yet, so a clicked PDF falls into its final `<pre>` text branch (it shows raw bytes — harmless, not a crash). A dedicated PDF preview branch is **out of scope** for this slice; the card surfacing + click-to-preview is the deliverable. Do **not** add a PDF iframe here — `FilePreview` only receives base64/utf8 content via `fs:read`, and wiring a real PDF viewer is a separate concern.

---

## Task 2 — Pure helper `extractRenderedArtifacts`

This is the only unit-tested logic in the slice. It mirrors `src/lib/todos.ts` exactly: typed result interface, a JSON parse that never throws, a single exported function that walks `ToolCall[]`.

**Behavior (from spec §3.5 / §8 B):**
- Consider only `write_file` calls (not `edit_file` — edits modify existing files, not "produced" artifacts).
- Only `status === 'finished'` calls (a `running`/`error` write produced nothing renderable).
- Parse `.path` from the call's JSON `input`; skip the call if JSON is malformed or `.path` is missing/non-string.
- Keep only paths whose `previewKind(path)` is renderable: `image | markdown | html | pdf`. (`text`/`none` → skipped, so `.ts/.py/...` source files never become cards.)
- Dedup by path, **keeping the last** write (later `seq` wins) so re-writing the same file in one turn yields one row reflecting the final write.
- Preserve first-seen order of the surviving paths (a stable, readable list).
- Never throw; return `[]` for `undefined`/empty input.

**Files:**
- Create: `src/lib/renderedArtifacts.ts`
- Test: `src/lib/renderedArtifacts.test.ts`

**Steps:**

- [ ] 2.1 — Write the failing test. Create `src/lib/renderedArtifacts.test.ts` with (this mirrors the `tc()` factory + `ToolCall` import style from `src/lib/todos.test.ts`):
  ```ts
  import { describe, it, expect } from 'vitest'
  import type { ToolCall } from '@hip/protocol'
  import { extractRenderedArtifacts, type RenderedArtifact } from './renderedArtifacts'

  function tc(over: Partial<ToolCall>): ToolCall {
    return { callId: 'c', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', seq: 0, ...over }
  }

  describe('extractRenderedArtifacts', () => {
    it('keeps finished write_file calls whose path is renderable', () => {
      const calls: ToolCall[] = [
        tc({ callId: 'c1', seq: 1, input: JSON.stringify({ path: '/p/page.html' }) }),
        tc({ callId: 'c2', seq: 2, input: JSON.stringify({ path: '/p/notes.md' }) }),
        tc({ callId: 'c3', seq: 3, input: JSON.stringify({ path: '/p/logo.png' }) }),
        tc({ callId: 'c4', seq: 4, input: JSON.stringify({ path: '/p/report.pdf' }) }),
        tc({ callId: 'c5', seq: 5, input: JSON.stringify({ path: '/p/icon.svg' }) }),
      ]
      expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
        { path: '/p/page.html', name: 'page.html', kind: 'html' },
        { path: '/p/notes.md', name: 'notes.md', kind: 'markdown' },
        { path: '/p/logo.png', name: 'logo.png', kind: 'image' },
        { path: '/p/report.pdf', name: 'report.pdf', kind: 'pdf' },
        { path: '/p/icon.svg', name: 'icon.svg', kind: 'image' },
      ])
    })

    it('skips source-code and unknown files (previewKind text/none)', () => {
      const calls: ToolCall[] = [
        tc({ callId: 'c1', seq: 1, input: JSON.stringify({ path: '/p/main.ts' }) }),
        tc({ callId: 'c2', seq: 2, input: JSON.stringify({ path: '/p/blob' }) }),
        tc({ callId: 'c3', seq: 3, input: JSON.stringify({ path: '/p/ok.md' }) }),
      ]
      expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
        { path: '/p/ok.md', name: 'ok.md', kind: 'markdown' },
      ])
    })

    it('ignores non-finished write_file and non-write_file calls', () => {
      const calls: ToolCall[] = [
        tc({ callId: 'c1', seq: 1, status: 'running', input: JSON.stringify({ path: '/p/a.png' }) }),
        tc({ callId: 'c2', seq: 2, status: 'error', input: JSON.stringify({ path: '/p/b.png' }) }),
        tc({ callId: 'c3', seq: 3, name: 'edit_file', input: JSON.stringify({ path: '/p/c.md' }) }),
        tc({ callId: 'c4', seq: 4, name: 'read_file', input: JSON.stringify({ path: '/p/d.html' }) }),
        tc({ callId: 'c5', seq: 5, input: JSON.stringify({ path: '/p/keep.html' }) }),
      ]
      expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
        { path: '/p/keep.html', name: 'keep.html', kind: 'html' },
      ])
    })

    it('dedups by path keeping the last write, in first-seen order', () => {
      const calls: ToolCall[] = [
        tc({ callId: 'c1', seq: 1, input: JSON.stringify({ path: '/p/a.html' }) }),
        tc({ callId: 'c2', seq: 2, input: JSON.stringify({ path: '/p/b.md' }) }),
        tc({ callId: 'c3', seq: 3, input: JSON.stringify({ path: '/p/a.html' }) }),
      ]
      const out = extractRenderedArtifacts(calls)
      expect(out.map((a) => a.path)).toEqual(['/p/a.html', '/p/b.md'])
    })

    it('drops calls with malformed JSON or a missing/non-string path', () => {
      const calls: ToolCall[] = [
        tc({ callId: 'c1', seq: 1, input: 'not json' }),
        tc({ callId: 'c2', seq: 2, input: JSON.stringify({ nope: 1 }) }),
        tc({ callId: 'c3', seq: 3, input: JSON.stringify({ path: 42 }) }),
        tc({ callId: 'c4', seq: 4, input: JSON.stringify({ path: '/p/good.png' }) }),
      ]
      expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
        { path: '/p/good.png', name: 'good.png', kind: 'image' },
      ])
    })

    it('returns [] for undefined or empty input', () => {
      expect(extractRenderedArtifacts(undefined)).toEqual([])
      expect(extractRenderedArtifacts([])).toEqual([])
    })
  })
  ```

- [ ] 2.2 — Run the test and watch it fail (module does not exist yet):
  ```bash
  yarn test src/lib/renderedArtifacts.test.ts
  ```
  Expected failure: `Failed to resolve import "./renderedArtifacts"` (the source file does not exist).

- [ ] 2.3 — Implement. Create `src/lib/renderedArtifacts.ts` with:
  ```ts
  import type { ToolCall } from '@hip/protocol'
  import { previewKind, type PreviewKind } from '@/components/artifact/previewKind'

  /** A renderable file the agent wrote this turn — surfaced as an artifact-card row. */
  export interface RenderedArtifact {
    path: string
    name: string
    kind: Extract<PreviewKind, 'image' | 'markdown' | 'html' | 'pdf'>
  }

  const RENDERABLE: ReadonlySet<PreviewKind> = new Set(['image', 'markdown', 'html', 'pdf'])

  /** Parse a write_file ToolCall.input (JSON) and return its `.path`, or null; never throws. */
  function pathOf(input: string): string | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(input)
    } catch {
      return null
    }
    const p = (parsed as { path?: unknown }).path
    return typeof p === 'string' ? p : null
  }

  function basename(p: string): string {
    const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
    return parts[parts.length - 1] || p
  }

  /**
   * Renderable files written this turn, for the aggregate artifact card. Filters finished
   * `write_file` calls, parses `.path`, keeps only renderable previewKinds (image/markdown/html/pdf
   * — source files map to text/none and are dropped), and dedups by path keeping the LAST write
   * (later seq wins) while preserving first-seen order. A turn's Message.toolCalls flattens child
   * runs' calls, so a sub-agent's writes are included by design. Never throws.
   */
  export function extractRenderedArtifacts(toolCalls?: ToolCall[]): RenderedArtifact[] {
    if (!toolCalls || toolCalls.length === 0) return []
    // Last write per path wins: sort a shallow copy by seq, build a path→artifact map, then
    // re-emit in first-seen order.
    const byPath = new Map<string, RenderedArtifact>()
    const order: string[] = []
    const sorted = [...toolCalls].sort((a, b) => a.seq - b.seq)
    for (const tc of sorted) {
      if (tc.name !== 'write_file' || tc.status !== 'finished') continue
      const path = pathOf(tc.input)
      if (!path) continue
      const kind = previewKind(path)
      if (!RENDERABLE.has(kind)) continue
      if (!byPath.has(path)) order.push(path)
      byPath.set(path, { path, name: basename(path), kind: kind as RenderedArtifact['kind'] })
    }
    return order.map((p) => byPath.get(p)!)
  }
  ```

- [ ] 2.4 — Run the test and watch it pass:
  ```bash
  yarn test src/lib/renderedArtifacts.test.ts
  ```
  Expected: all 6 `extractRenderedArtifacts` tests pass.

- [ ] 2.5 — Commit:
  ```bash
  git add src/lib/renderedArtifacts.ts src/lib/renderedArtifacts.test.ts
  git commit -m "feat(lib): extractRenderedArtifacts pure helper for artifact cards" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 3 — i18n key `artifact.turnOutputs`

The card title is "本轮产物 (N)". i18n is **typed**: the key must be added to `zh-CN.ts` (the type source) **and** `en.ts` **and** `zh-TW.ts` in the same change, or `tsc` fails. This task comes **before** the component (Task 4) that consumes the key.

The existing `artifact` block ends with `sandboxPending` on line 131 (all three locales — verified identical layout), with `},` closing the block on line 132. We insert the new key on a new line **after `sandboxPending`** in each file. We use i18next's count pluralization convention already used elsewhere in this file (e.g. `toolsCount: '{{count}} 次工具调用'`); for the parenthesized form provide both the base and `_one` variant so English reads naturally.

**Files:**
- Modify: `src/i18n/zh-CN.ts` (after line 131, `sandboxPending: '发送第一条消息后将创建沙箱工作区',`)
- Modify: `src/i18n/en.ts` (after line 131, `sandboxPending: 'A sandbox workspace is created when you send the first message',`)
- Modify: `src/i18n/zh-TW.ts` (after line 131, `sandboxPending: '傳送第一則訊息後將建立沙箱工作區',`)

**Steps:**

- [ ] 3.1 — In `src/i18n/zh-CN.ts`, replace the line:
  ```ts
        sandboxPending: '发送第一条消息后将创建沙箱工作区',
  ```
  with:
  ```ts
        sandboxPending: '发送第一条消息后将创建沙箱工作区',
        turnOutputs: '本轮产物 ({{count}})',
        turnOutputs_one: '本轮产物 ({{count}})',
  ```

- [ ] 3.2 — In `src/i18n/en.ts`, replace the line:
  ```ts
        sandboxPending: 'A sandbox workspace is created when you send the first message',
  ```
  with:
  ```ts
        sandboxPending: 'A sandbox workspace is created when you send the first message',
        turnOutputs: '{{count}} outputs this turn',
        turnOutputs_one: '{{count}} output this turn',
  ```

- [ ] 3.3 — In `src/i18n/zh-TW.ts`, replace the line:
  ```ts
        sandboxPending: '傳送第一則訊息後將建立沙箱工作區',
  ```
  with:
  ```ts
        sandboxPending: '傳送第一則訊息後將建立沙箱工作區',
        turnOutputs: '本輪產物 ({{count}})',
        turnOutputs_one: '本輪產物 ({{count}})',
  ```

- [ ] 3.4 — Typecheck to confirm the typed-i18n contract holds across all three locales:
  ```bash
  yarn tsc --noEmit
  ```
  Expected: exits 0 with no output (no missing-key errors). If you see an error like `Property 'turnOutputs' is missing in type` referencing `en.ts` or `zh-TW.ts`, a locale is out of sync — fix it before continuing.

- [ ] 3.5 — Commit:
  ```bash
  git add src/i18n/zh-CN.ts src/i18n/en.ts src/i18n/zh-TW.ts
  git commit -m "i18n: add artifact.turnOutputs (count) in all locales" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 4 — `ArtifactCard.tsx` component

The card lists each renderable artifact as a clickable row. A row click drives the existing FS preview pipeline and smart-opens the panel. There is **no component-test stack** — this component's only testable logic (the artifact list) already lives in the Task 2 helper, so this task has no `.test.tsx`; verification is `tsc` + lint + manual GUI acceptance.

**FS preview pipeline (grounded in `FileTree.tsx` `Node.onClick` and `FilePreview.tsx`):**
- The FS store (`fsStore.ts`) is keyed by `scopeId` (a committed session's nanoid id, or — for an un-committed project draft — its absolute cwd). `useFsScope()` resolves the current `{ scopeId, isDraft }`.
- `FilePreview` reads `useFsStore(s => s.bySession[scopeId]?.preview)`. To drive it: call `useFsStore.getState().setActive(scopeId, path)` then `sessionService.readFile(scopeId, path)` (committed) or `sessionService.readDraftFile(scopeId, path)` (draft) — exactly what `FileTree`'s `Node.onClick` does.

**Smart auto-open (spec §10 "Smart auto-open race"):**
- If the panel is closed, `setPanelOpen(true)` then **defer** `setTab('files')` to the next tick (`setTimeout(..., 0)`) so the Files tab mounts after the panel, avoiding a mount race. If the panel is already open, set the tab synchronously (no defer needed).
- Never auto-open from anywhere else (this slice only auto-opens on an explicit row click; `checkpoint:created` belongs to Slice A and must not trigger this).
- If there is **no FS scope** (`scopeId == null` — e.g. a chat-mode draft with no cwd), the file cannot be previewed; render the rows non-interactive (no click handler) so we never call `readFile(null, …)`.

**Files:**
- Create: `src/components/artifact/ArtifactCard.tsx`

**Steps:**

- [ ] 4.1 — Create `src/components/artifact/ArtifactCard.tsx` with:
  ```tsx
  import { useTranslation } from 'react-i18next'
  import { FileText, FileImage, FileCode, FileType } from 'lucide-react'
  import type { ToolCall } from '@hip/protocol'
  import { sessionService } from '@/domain'
  import { useFsScope } from '@/store/useFsScope'
  import { useFsStore } from '@/store/fsStore'
  import { useUiStore } from '@/store/uiStore'
  import { extractRenderedArtifacts, type RenderedArtifact } from '@/lib/renderedArtifacts'
  import { cn } from '@/lib/utils'

  function iconFor(kind: RenderedArtifact['kind']) {
    if (kind === 'image') return FileImage
    if (kind === 'html') return FileCode
    if (kind === 'pdf') return FileType
    return FileText // markdown
  }

  export function ArtifactCard({ toolCalls }: { toolCalls?: ToolCall[] }) {
    const { t } = useTranslation()
    const { scopeId, isDraft } = useFsScope()
    const artifacts = extractRenderedArtifacts(toolCalls)
    if (artifacts.length === 0) return null

    const canPreview = scopeId != null

    const open = (path: string) => {
      if (!scopeId) return
      // Drive the existing FS preview pipeline (same as FileTree's Node.onClick).
      useFsStore.getState().setActive(scopeId, path)
      if (isDraft) sessionService.readDraftFile(scopeId, path)
      else sessionService.readFile(scopeId, path)
      // Smart auto-open: if the panel is closed, open it then defer the tab switch one tick so the
      // Files tab mounts after the panel (avoids a mount race). If already open, switch synchronously.
      const ui = useUiStore.getState()
      if (!ui.panelOpen) {
        ui.setPanelOpen(true)
        setTimeout(() => useUiStore.getState().setTab('files'), 0)
      } else {
        ui.setTab('files')
      }
    }

    return (
      <div data-testid="artifact-card" className="mt-2 overflow-hidden rounded-md border border-border bg-surface-muted/40">
        <div className="border-b border-border px-3 py-1.5 text-meta font-medium text-ink-secondary">
          {t('artifact.turnOutputs', { count: artifacts.length })}
        </div>
        <ul>
          {artifacts.map((a) => {
            const Icon = iconFor(a.kind)
            return (
              <li key={a.path}>
                <button
                  type="button"
                  data-testid="artifact-row"
                  data-path={a.path}
                  onClick={canPreview ? () => open(a.path) : undefined}
                  disabled={!canPreview}
                  title={a.path}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-ink transition-colors',
                    canPreview ? 'cursor-pointer hover:bg-surface-muted' : 'cursor-default opacity-70',
                  )}
                >
                  <Icon size={15} className="shrink-0 text-ink-tertiary" />
                  <span className="truncate">{a.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }
  ```

- [ ] 4.2 — Typecheck (no component test exists; `tsc` is the gate):
  ```bash
  yarn tsc --noEmit
  ```
  Expected: exits 0 with no output. (Confirms the `lucide-react` icon imports, `useFsScope`/`useFsStore`/`useUiStore` signatures, and the `RenderedArtifact['kind']` union all resolve.)

- [ ] 4.3 — Lint the new file:
  ```bash
  yarn eslint src/components/artifact/ArtifactCard.tsx
  ```
  Expected: no errors.

- [ ] 4.4 — Commit:
  ```bash
  git add src/components/artifact/ArtifactCard.tsx
  git commit -m "feat(artifact): ArtifactCard with smart auto-open file preview" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 5 — Render `<ArtifactCard>` in `MessageBubble`

Inject the card after the markdown body and before `MessageActions`, only for **completed assistant messages** (not while streaming). The card itself returns `null` when there are no renderable artifacts, so the gate here is just: assistant role + not streaming. Inserting it inside the `{!streaming && (...)}` block scopes it to completed turns and keeps it adjacent to `MessageActions`.

**Files:**
- Modify: `src/components/chat/MessageBubble.tsx` (import near line 9; render inside the `{!streaming && (...)}` block at lines 71–88)

**Steps:**

- [ ] 5.1 — Add the import. In `src/components/chat/MessageBubble.tsx`, after the existing line (line 9):
  ```tsx
  import { MessageActions } from './MessageActions'
  ```
  add:
  ```tsx
  import { ArtifactCard } from '@/components/artifact/ArtifactCard'
  ```

- [ ] 5.2 — Render the card. In the same file, the completed-message block currently reads:
  ```tsx
          {!streaming && (
            <div className="mt-1 flex items-center gap-2">
              <MessageActions message={message} isLastAssistant={!!isLastAssistant} />
  ```
  Change it to insert the card above the actions row (still inside `{!streaming && (...)}`). Replace:
  ```tsx
          {!streaming && (
            <div className="mt-1 flex items-center gap-2">
              <MessageActions message={message} isLastAssistant={!!isLastAssistant} />
  ```
  with:
  ```tsx
          {!streaming && message.role === 'assistant' && (
            <ArtifactCard toolCalls={message.toolCalls} />
          )}
          {!streaming && (
            <div className="mt-1 flex items-center gap-2">
              <MessageActions message={message} isLastAssistant={!!isLastAssistant} />
  ```

- [ ] 5.3 — Typecheck:
  ```bash
  yarn tsc --noEmit
  ```
  Expected: exits 0 with no output.

- [ ] 5.4 — Run the full unit suite to confirm nothing regressed (sessionStore tests touch `Message`/`ToolCall` shapes):
  ```bash
  yarn test
  ```
  Expected: all suites pass. If the run pauses or makes network calls, stop — a paid real-LLM suite is being hit; consult the project memory note `vitest-src-filter-runs-paid-tests` (move `~/.hip/config/auth.json` aside, trap-restore, re-run). Under normal `yarn test` (which equals `vitest run`) the paid suites `skipIf`-skip when the key is absent.

- [ ] 5.5 — Commit:
  ```bash
  git add src/components/chat/MessageBubble.tsx
  git commit -m "feat(chat): render ArtifactCard on completed assistant messages" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Manual GUI Acceptance

Run the app (`yarn tauri dev`, or the project's `run` skill) against a **committed session bound to a real project folder** and have the agent write files in a turn. (Per the project memory note `prefer-gui-over-real-llm-tests`, manual GUI is the acceptance path for live-LLM-driven UI.) Verify:

- [ ] After a turn where the agent writes an HTML, Markdown, image, SVG, and/or PDF file, an aggregate card titled "本轮产物 (N)" (or the English/Traditional equivalent) appears at the bottom of that assistant message, with N matching the number of distinct renderable files written.
- [ ] A turn that writes only source files (`.ts`, `.py`, etc.) or unknown/extension-less files shows **no** card.
- [ ] A turn that writes the same file path twice shows that path **once** (deduped), and previewing it shows the final content.
- [ ] The card does **not** appear while the assistant message is still streaming; it appears once the turn completes.
- [ ] Clicking a row with the right panel **closed** opens the panel, switches to the 文件 tab, and renders the file in `<FilePreview>` (image renders inline, Markdown renders prose, HTML renders in the sandboxed iframe).
- [ ] Clicking a row with the panel **already open** switches to the 文件 tab and previews the file (no flicker, no missed tab switch — the deferred `setTab` mount-race fix holds).
- [ ] Clicking a PDF row previews it without crashing (raw text fallback is acceptable for this slice; no dedicated PDF viewer expected).
- [ ] A `checkpoint:created` event (if Slice A is also present) does **not** auto-open or switch the panel — only an explicit row click does.
- [ ] In all three UI languages (简体中文 / 繁體中文 / English), the card title renders the localized "outputs this turn" / "本轮产物" / "本輪產物" copy with the correct count.
- [ ] The artifact rows reflect files written by a sub-agent too (a turn's `toolCalls` flattens child runs), not only supervisor writes.
