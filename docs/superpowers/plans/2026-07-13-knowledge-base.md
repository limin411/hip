# Knowledge Base — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Prefer surgical diffs. Do **not** add AI, session injection, wiki-links, or relationship graph. Do **not** refactor session tab model into a unified Tab union (use the pseudo-chip approach).

**Goal:** Ship a local-first Markdown knowledge base as a first-class surface opened from the title-bar `+` menu: multi-space home, folder tree, read/edit docs, persist under `~/.hip/knowledge`, with title search in P0 and full-text MiniSearch in P1.

**Architecture:**

- UI: `activeView: 'knowledge'` + `knowledgeTabOpen` chip in `SessionTabBar` (not a session id).
- Domain: `knowledgeStore` (UI state) + pure tree helpers + `knowledgeService` (async I/O).
- Persistence: Tauri Rust commands scoped to `~/.hip/knowledge/**` (same pattern as skills: `invoke`, not sidecar protocol).
- On-disk: `index.json` + `<spaceId>/{meta.json,tree.json,docs/<docId>.md}`.
- Preview: reuse `MarkdownBody`. Edit P0: controlled `textarea` + preview toggle.

**Tech Stack:** React 18, Zustand, Vitest, Tauri v2 commands (Rust), existing Radix dropdowns, i18next. Optional npm: `minisearch` (P1 only).

**Spec:** [`docs/superpowers/specs/2026-07-13-knowledge-base-spec.md`](../specs/2026-07-13-knowledge-base-spec.md)

**Design (authoritative after review):** [`docs/superpowers/specs/2026-07-13-knowledge-base-design.md`](../specs/2026-07-13-knowledge-base-design.md)  
> Completeness review (2026-07-13) closed open gaps. Where this plan conflicts with the design (e.g. `knowledgeService.ts`, close-surface restore, PR2 AppLayout stub, space rename/delete UI in P0), **follow the design**.

**Prototype:** [`docs/prototypes/knowledge-base/index.html`](../../prototypes/knowledge-base/index.html)

**Locked defaults:**

| Decision | Value |
|----------|--------|
| Tab model | Pseudo-chip: `knowledgeTabOpen` + `activeView === 'knowledge'` |
| Storage root | `~/.hip/knowledge` (fixed in P0; custom root = P1+) |
| Tree source of truth | `tree.json` node list + `docs/<id>.md` bodies |
| I/O path | Tauri commands in `src-tauri` (not sidecar WS, not unscoped plugin-fs) |
| Editor P0 | `textarea` + `MarkdownBody` preview |
| Search P0 | Title / path filter in-memory |
| Search P1 | `minisearch` over title + body |
| DnD reorder | Out of P0 (optional P1) |
| AI / inject / graph | **Forbidden** this plan |

**Out of scope:** Memory integration, command-palette deep features beyond optional “Open knowledge base”, import/export zip (P1 optional), CodeMirror, multiplayer.

---

## Dependency graph

```text
T1 types + pure tree helpers + unit tests
     │
     ├─► T2 Tauri knowledge FS commands + path sandbox
     │         │
     │         └─► T3 ipc/knowledge.ts + knowledgeService
     │                   │
     │                   └─► T4 knowledgeStore (load/mutate/save orchestration)
     │
     └─► T5 uiStore ActiveView + knowledgeTabOpen persist
              │
              ├─► T6 SessionTabBar entry (+ menu + chip)
              │
              └─► T7 Knowledge UI shell (Home + Workspace + tree + reader/editor)
                        │
                        ├─► T8 i18n (en / zh-CN / zh-TW)
                        │
                        ├─► T9 component tests + wire AppLayout
                        │
                        └─► T10 P1 MiniSearch + recent docs (+ optional export)

PR batches (recommended):
  PR1 = T1 + T2 + T3          # foundation + I/O
  PR2 = T4 + T5 + T6 + T8     # state + entry + i18n keys
  PR3 = T7 + T9               # UI + tests (user-visible P0)
  PR4 = T10                   # search enhancement (optional same sprint)
```

---

## File map

### Create

```
src/domain/knowledge/types.ts
src/domain/knowledge/tree.ts
src/domain/knowledge/tree.test.ts
src/domain/knowledge/paths.ts            # id sanitization helpers (TS mirror of Rust rules if needed)
src/ipc/knowledge.ts
src/store/knowledgeStore.ts
src/store/knowledgeStore.test.ts
src/components/knowledge/KnowledgePage.tsx
src/components/knowledge/KnowledgeHome.tsx
src/components/knowledge/KnowledgeWorkspace.tsx
src/components/knowledge/SpaceTree.tsx
src/components/knowledge/DocReader.tsx
src/components/knowledge/DocEditor.tsx
src/components/knowledge/KnowledgeHome.test.tsx
src/components/knowledge/SpaceTree.test.tsx
src-tauri/src/knowledge.rs
```

### Modify

```
src/store/uiStore.ts                     # ActiveView + knowledgeTabOpen
src/store/uiStore.test.ts
src/components/tabs/SessionTabBar.tsx
src/components/tabs/SessionTabBar.test.tsx
src/routes/AppLayout.tsx
src/routes/AppLayout.test.tsx            # mock KnowledgePage if needed
src/i18n/en.ts
src/i18n/zh-CN.ts
src/i18n/zh-TW.ts
src/i18n/translation-keys.test.ts        # if key parity asserts structure
src-tauri/src/lib.rs                     # mod knowledge; register commands
src-tauri/Cargo.toml                     # only if new crate deps required (prefer std + serde_json)
docs/superpowers/specs/2026-07-13-knowledge-base-spec.md  # status → In progress / Implemented
```

### Do not touch

```
packages/sidecar/**                      # no protocol/memory coupling
src/domain/sessionService.ts             # no inject hooks
src/components/account/MemoryConfig.tsx
docs/prototypes/**                       # leave prototype as reference
```

---

## On-disk contract (implement once, test against it)

```text
~/.hip/knowledge/
  index.json
  <spaceId>/
    meta.json
    tree.json
    docs/
      <docId>.md
```

**`index.json`**

```json
{
  "version": 1,
  "spaces": [
    {
      "id": "spc_…",
      "name": "产品知识库",
      "icon": "📦",
      "createdAt": 0,
      "updatedAt": 0
    }
  ]
}
```

**`meta.json`** — same fields as one space entry (name/icon/timestamps); keep in sync when renaming.

**`tree.json`**

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "nod_…",
      "parentId": null,
      "kind": "folder",
      "title": "决策",
      "order": 0,
      "createdAt": 0,
      "updatedAt": 0
    },
    {
      "id": "doc_…",
      "parentId": "nod_…",
      "kind": "doc",
      "title": "权限模型 v2",
      "order": 0,
      "createdAt": 0,
      "updatedAt": 0
    }
  ]
}
```

**Rules:**

- Ids: `nanoid` or `spc_` / `nod_` / `doc_` prefix + url-safe alphabet; **never** user title as path segment for docs.
- Only `kind === 'doc'` has a file under `docs/<id>.md`.
- Delete folder = recursive delete child nodes + their md files.
- Path sandbox: resolve real path; must stay under knowledge root (reject `..`).

---

## T1 — Types + pure tree helpers

**Files:** `src/domain/knowledge/types.ts`, `tree.ts`, `tree.test.ts`.

- [ ] **T1.1** Define types: `KnowledgeSpace`, `KnowledgeNode`, `KnowledgeNodeKind`, `KnowledgeIndex`, `KnowledgeTreeFile`, `KnowledgeRecentItem` (optional).
- [ ] **T1.2** Pure functions (no I/O):
  - `buildChildrenMap(nodes)`
  - `listChildren(nodes, parentId)` sorted by `order` then title
  - `getPathTitles(nodes, nodeId)` → breadcrumb strings
  - `insertNode(nodes, node)`
  - `renameNode(nodes, id, title)`
  - `removeNodeSubtree(nodes, id)` → `{ nodes, removedDocIds }`
  - `nextOrder(nodes, parentId)`
  - `filterNodesByTitle(nodes, query)` (case-insensitive)
- [ ] **T1.3** Unit tests covering insert/remove subtree/path/sort/filter.
- [ ] **T1.4** Commit: `feat(knowledge): domain types and pure tree helpers`

```bash
yarn vitest run src/domain/knowledge
```

---

## T2 — Tauri knowledge FS commands

**Files:** `src-tauri/src/knowledge.rs`, `src-tauri/src/lib.rs`.

### Commands (JSON in/out where convenient)

| Command | Behavior |
|---------|----------|
| `knowledge_ensure_root` | Create `~/.hip/knowledge` + empty `index.json` if missing |
| `knowledge_list_spaces` | Read `index.json` → spaces array |
| `knowledge_create_space` | `{ name, icon? }` → append space, create dir + empty tree + meta |
| `knowledge_update_space` | rename/icon; update index + meta |
| `knowledge_delete_space` | remove space dir + index entry |
| `knowledge_get_tree` | `{ spaceId }` → tree.json |
| `knowledge_save_tree` | `{ spaceId, tree }` atomic write |
| `knowledge_read_doc` | `{ spaceId, docId }` → string body |
| `knowledge_write_doc` | `{ spaceId, docId, body }` atomic write |
| `knowledge_delete_doc_file` | `{ spaceId, docId }` ignore if missing |

- [ ] **T2.1** Resolve root: `$HOME/.hip/knowledge` (respect any existing hip home env if the codebase already has one—grep `hip` home helpers in Rust and reuse).
- [ ] **T2.2** Implement path join + canonicalization sandbox; reject escapes.
- [ ] **T2.3** Atomic writes: write temp file in same dir then rename.
- [ ] **T2.4** Register commands in `lib.rs` invoke handler.
- [ ] **T2.5** Rust unit tests for sandbox reject `../` and for create_space layout (tempdir).
- [ ] **T2.6** Commit: `feat(tauri): knowledge base filesystem commands`

```bash
cd src-tauri && cargo test knowledge
```

**Notes:**

- Prefer `serde_json::Value` or small structs with serde.
- Do not add `tauri-plugin-fs` for P0 unless commands become unmaintainable—explicit commands match `list_skills` / `read_skill_file`.

---

## T3 — Frontend IPC wrapper

**Files:** `src/ipc/knowledge.ts` (+ thin tests with mocked `invoke` if pattern exists).

- [ ] **T3.1** Wrap each command with typed TS functions.
- [ ] **T3.2** Normalize errors to `Error` with message string for toasts.
- [ ] **T3.3** Commit: `feat(ipc): knowledge invoke wrappers`

---

## T4 — knowledgeStore

**Files:** `src/store/knowledgeStore.ts`, `knowledgeStore.test.ts`.

State shape (adjust names but keep semantics):

```ts
{
  loaded: boolean
  spaces: KnowledgeSpace[]
  activeSpaceId: string | null
  nodes: KnowledgeNode[]          // current space tree
  activeDocId: string | null
  docBody: string                 // loaded body
  draftBody: string               // editor buffer
  editing: boolean
  mode: 'home' | 'workspace'
  searchQuery: string
  recent: { spaceId: string; docId: string; title: string; spaceName: string; at: number }[]
  busy: boolean
  error: string | null
}
```

Actions:

- [ ] **T4.1** `loadSpaces()` → ensure root + list.
- [ ] **T4.2** `createSpace` / `renameSpace` / `deleteSpace`.
- [ ] **T4.3** `openSpace(id)` → load tree; set mode workspace.
- [ ] **T4.4** `openHome()` → clear active doc; mode home.
- [ ] **T4.5** `createFolder` / `createDoc` (update tree + write empty md for docs + save tree).
- [ ] **T4.6** `renameNode` / `deleteNode` (subtree + delete md files for removed docs).
- [ ] **T4.7** `openDoc` / `setEditing` / `setDraftBody` / `saveDoc` (debounce optional in UI layer).
- [ ] **T4.8** Persist `recent` in `localStorage` key `hip-knowledge-recent` (cap 20).
- [ ] **T4.9** Unit tests with mocked `@/ipc/knowledge`.
- [ ] **T4.10** Commit: `feat(knowledge): zustand store for spaces and docs`

---

## T5 — uiStore surface flags

**Files:** `src/store/uiStore.ts`, `uiStore.test.ts`.

- [ ] **T5.1** Extend `ActiveView` with `'knowledge'`.
- [ ] **T5.2** Add `knowledgeTabOpen: boolean`, `setKnowledgeTabOpen`, `openKnowledgeView()`, `closeKnowledgeView()`.
  - `openKnowledgeView`: set `knowledgeTabOpen=true`, `activeView='knowledge'`, remember `previousView` like settings if pattern exists.
  - `closeKnowledgeView`: `knowledgeTabOpen=false`; if `activeView==='knowledge'`, restore chat/code via existing previousView / session selection.
- [ ] **T5.3** Persist `knowledgeTabOpen` in `hip-ui` only if cheap; **optional**—reopen can be false on launch (acceptable for P0). Prefer **not** forcing knowledge on boot.
- [ ] **T5.4** Tests for open/close view flags.
- [ ] **T5.5** Commit: `feat(ui): knowledge activeView and tab chip flag`

---

## T6 — SessionTabBar entry + chip

**Files:** `SessionTabBar.tsx`, `SessionTabBar.test.tsx`.

- [ ] **T6.1** Dropdown: after code item, separator, item「知识库」`data-testid="new-session-kb"` → `openKnowledgeView()` + `knowledgeStore.loadSpaces()` (fire-and-forget).
- [ ] **T6.2** When `knowledgeTabOpen`, render a tab chip after session tabs (before `+`):
  - label: `t('tabs.knowledge')` or active space name if in workspace
  - `aria-selected={activeView==='knowledge'}`
  - click → `setActiveView('knowledge')`
  - close button → `closeKnowledgeView()`
  - `data-testid="knowledge-tab"`
- [ ] **T6.3** Selecting a session tab should set `activeView` to chat/code as existing `selectSession` does—verify knowledge view deactivates (selected state) without necessarily closing chip.
- [ ] **T6.4** Tests: menu item present; click opens knowledge; chip visible when open.
- [ ] **T6.5** Commit: `feat(tabs): knowledge base entry in plus menu`

---

## T7 — Knowledge UI

**Files:** under `src/components/knowledge/*`, `AppLayout.tsx`.

### T7.1 Page shell

- [ ] **T7.1** `KnowledgePage`: if `mode==='home'` → Home; else Workspace. Show error banner if `error`.

### T7.2 Home

- [ ] **T7.2** Space cards grid; create space control (prompt/modal—reuse existing `Modal` if available).
- [ ] **T7.3** Recent list from store.
- [ ] **T7.4** Search input: P0 filter spaces by name + filter recent by title; (full doc search in T10).
- [ ] **T7.5** Empty state when no spaces.
- [ ] **T7.6** `data-testid="knowledge-home"`, `knowledge-space-card`, `knowledge-create-space`.

### T7.3 Workspace

- [ ] **T7.7** Left: space switcher (back to home), tree, new doc/folder buttons.
- [ ] **T7.8** `SpaceTree`: expand/collapse folders (local UI state), select node, context actions rename/delete (menu or inline—keep minimal).
- [ ] **T7.9** Right: breadcrumb; toolbar **Edit** / **Done** (save); optional Export later.
- [ ] **T7.10** `DocReader` → `MarkdownBody`; `DocEditor` → textarea (`data-testid="knowledge-doc-editor"`) + optional side-by-side preview.
- [ ] **T7.11** Autosave: debounce 500ms on `draftBody` while `editing`, and save on Done / blur.
- [ ] **T7.12** Dirty guard: if navigating away with unsaved draft, save first or confirm—P0: always try save on leave.

### T7.4 Layout wire

- [ ] **T7.13** `AppLayout.renderMainContent`: `activeView === 'knowledge'` → `<KnowledgePage />` (before session null check).
- [ ] **T7.14** Ensure history/settings still take precedence as today.
- [ ] **T7.15** Commit: `feat(knowledge): home and workspace UI`

**Visual:** Match hip tokens (`border-border`, `bg-surface`, `text-ink*`, sage accent). Mirror prototype spacing; do not copy emoji-heavy chrome if product prefers lucide icons—icons via `lucide-react` (`BookOpen`, `Folder`, `FileText`, `Plus`).

---

## T8 — i18n

**Files:** `en.ts`, `zh-CN.ts`, `zh-TW.ts`.

Suggested key namespace `knowledge.*` + dropdown/tabs:

```
dropdown.newKnowledge
tabs.knowledge
tabs.closeKnowledge
knowledge.title
knowledge.home.subtitle
knowledge.home.searchPlaceholder
knowledge.home.mySpaces
knowledge.home.recent
knowledge.home.emptyTitle
knowledge.home.emptyHint
knowledge.home.createSpace
knowledge.space.namePlaceholder
knowledge.space.deleteConfirm
knowledge.tree.newDoc
knowledge.tree.newFolder
knowledge.tree.rename
knowledge.tree.delete
knowledge.tree.empty
knowledge.doc.edit
knowledge.doc.done
knowledge.doc.untitled
knowledge.doc.saveFailed
knowledge.doc.loadFailed
knowledge.error.generic
```

- [ ] **T8.1** Add all keys to three locales with real copy (not English placeholders in zh).
- [ ] **T8.2** Keep `translation-keys` test green.
- [ ] **T8.3** Commit: `feat(i18n): knowledge base strings`

---

## T9 — Tests, polish, spec status

- [ ] **T9.1** Component tests: Home create/open space (mock store); tree select; editor save calls store.
- [ ] **T9.2** SessionTabBar + AppLayout integration smoke with mocks.
- [ ] **T9.3** Manual checklist (dev):
  1. `+` → 知识库 → home
  2. Create space → open → create doc → edit → restart app → content persists
  3. Close knowledge chip → back to chat
  4. No AI/graph UI present
- [ ] **T9.4** `yarn tsc` / `yarn test` targeted paths green.
- [ ] **T9.5** Update spec status to **Implemented** (or **P0 Implemented**) and link this plan.
- [ ] **T9.6** Commit: `test(knowledge): UI coverage and mark P0 done`

```bash
yarn vitest run src/domain/knowledge src/store/knowledgeStore src/store/uiStore src/components/tabs/SessionTabBar src/components/knowledge
yarn tsc --noEmit
```

---

## T10 — P1 MiniSearch + extras (separate PR)

- [ ] **T10.1** `yarn add minisearch`
- [ ] **T10.2** Build index from all spaces: for each doc load body (lazy batch) or index on open-space + queue on write.
- [ ] **T10.3** Home search uses MiniSearch; results open doc in workspace.
- [ ] **T10.4** Optional: single-doc export via dialog save (Tauri dialog already available).
- [ ] **T10.5** Optional: `react-arborist` only if tree DnD requested—default skip.
- [ ] **T10.6** Commit: `feat(knowledge): full-text search with minisearch`

---

## Verification matrix (P0)

| Spec ID | Verify |
|---------|--------|
| G1 | `+` menu shows 知识库; opens surface |
| G2 | Chip independent of session ids; close works |
| G3 | Create/list/delete space |
| G4 | Folder/doc CRUD on tree |
| G5 | Read MarkdownBody; edit textarea; persist |
| G6 | Title filter at least; full-text T10 |
| G7 | Files under `~/.hip/knowledge` survive restart |
| G8 | Three locales |
| NG1–3 | No AI / inject / graph affordances |

---

## Risk notes for implementers

1. **TitleBar special views:** settings/history replace the whole tab bar. Knowledge stays on the normal tab bar path (`activeView` not special)—do not route knowledge through `isSpecialView`.
2. **selectSession vs knowledge:** when user picks a session tab, ensure main content leaves knowledge (`setActiveView` chat/code). Chip may remain for one-click return.
3. **Web / non-Tauri tests:** mock `invoke` in unit tests; knowledge I/O won’t run in happy-dom without mocks.
4. **E2E:** optional follow-up; not required to close P0 if unit coverage is solid and manual checklist passes.
5. **Idempotent ensure_root:** safe to call on every open.

---

## Suggested commit sequence

1. `feat(knowledge): domain types and pure tree helpers`
2. `feat(tauri): knowledge base filesystem commands`
3. `feat(ipc): knowledge invoke wrappers`
4. `feat(knowledge): zustand store for spaces and docs`
5. `feat(ui): knowledge activeView and tab chip flag`
6. `feat(i18n): knowledge base strings`
7. `feat(tabs): knowledge base entry in plus menu`
8. `feat(knowledge): home and workspace UI`
9. `test(knowledge): UI coverage and mark P0 done`
10. (optional) `feat(knowledge): full-text search with minisearch`

---

## Change log

| Date | Note |
|------|------|
| 2026-07-13 | Initial plan from knowledge-base spec + prototype + dependency survey |
