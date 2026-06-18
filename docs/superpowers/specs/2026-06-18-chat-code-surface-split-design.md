# Chat / Code Surface Split — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorming complete) → ready for implementation plan
**Branch:** `feat/chat-code-surface-split`

## Problem

Today the **Chat** view carries both conversation *and* coding capability: the right-side
`ArtifactPanel` (file tree, git diff/changes, per-turn checkpoints) plus the `FolderPill`
working-directory picker all live inside Chat. This makes the experience feel split — a
conversation surface that is also a half-IDE.

## Goal

Split the app into **two independent top-level surfaces** in the left menu rail:

- **Chat** — conversation only. No directory tree, no git, no folder picker, no permission picker.
- **Code** — a full conversation experience **plus** the directory tree + git client.

The two surfaces **do not share conversations**: a conversation belongs to exactly one
surface, and each surface shows only its own conversation list. Under the hood there is **one**
session engine; the surfaces are a filter + a panel/composer variation, not duplicated code.

## Locked decisions (from brainstorming)

1. **Two independent surfaces, one engine.** Chat conversations and Code conversations are
   separate lists. Switching menus never carries a conversation across.
2. **Chat = conversation + preview panel.** The agent has the **full toolset**, but file
   operations are **jailed to the sandbox** (scratch cwd). No folder picker, no permission
   picker. Effective `permissionMode: 'edit'` pinned to the scratch cwd — no `full` (un-jail),
   no read-only `chat`. `run_script` stays HITL-gated (a shell can escape a jail; the approval
   gate is what keeps "scope = sandbox" honest).
3. **Code = Chat + git/tree.** Code conversations have a real, user-picked cwd, the full
   `ArtifactPanel` (files / changes / timeline), the `FolderPill`, and the `PermissionModePicker`.
4. **Chat preview panel** renders documents/images only — no tree, no git.
5. **Agent dashboard is Code-only.** In Chat, sub-agents still render inline in the transcript.
6. **Code requires picking a folder** before the first message. Recent-folders is deferred.
7. **Implementation = Approach A** (shared components parametrized by `surface`), not literal
   duplication and not runtime cwd-sniffing.
8. **Session restoration is asymmetric** (industry standard — see References): the **Chat**
   surface opens a **new conversation** on launch/enter (conversational-app norm); the **Code**
   surface **restores its last-open conversation** + folder (IDE-class norm). Memory is keyed by
   the **stable conversation id, never a folder path**.
9. **Naming follows the field:** the produced-content side area is an **Artifacts/preview panel**
   (Claude "Artifacts" pattern), and Chat vs Code are **top-level rail modes** (Claude Desktop
   ships Chat / Cowork / Code; Zed "Agentic"/"Classic" and Cursor "agent"/"editor" layouts are
   the agent-first-vs-project-first precedent).

## Industry references

The two surfaces and their behaviors mirror what the leading desktop agent apps actually ship
(researched + adversarially fact-checked 2026-06-18):

- **Claude Desktop App** exposes three top-level **modes — Chat / Cowork / Code** — switched as
  primary sections from a left rail (validates promoting Code to a rail mode). Substantial
  assistant output is **not inline**; a small clickable artifact card in the transcript opens a
  **dedicated right-side "Artifacts" window**, with multiple artifacts navigable in one
  conversation.
- **OpenAI Codex Desktop App** (real; macOS Feb 2026, Windows Mar 2026) uses a **Projects →
  Threads** sidebar, keeps **diff/git in separate panels** (not inline in chat), and **restores
  prior threads per project**.
- **Peer IDEs** (VS Code/Copilot, Cursor, Zed, Windsurf, JetBrains) converge on: a dockable chat
  **side panel** beside a persistent editor; an **Artifacts/Canvas side panel** (no tree) for
  tree-less chat preview; **restore-last-workspace** on reopen; and a recurring **footgun —
  keying sessions by folder path loses history when the folder moves** (Cursor, JetBrains). Key
  by a stable id.
- **Restore-vs-reset splits by app class** (fact-check refuted a blanket "always restore"):
  conversational apps (ChatGPT, Claude Desktop) **open a new chat**; IDE-class apps (VS Code,
  JetBrains, Cursor, Codex) **restore the last workspace**. Hence the asymmetric decision #8.

## Architecture

### Surface as a persisted field

`surface: 'chat' | 'code'` is the single source of truth, persisted on each session and carried
on the lightweight list summary so the sidebar can filter without loading every session.

- **`SessionConfig`** (in `packages/protocol/src/index.ts`) gains `surface: 'chat' | 'code'`.
  Optional in the type for back-compat; treated as `'code'`/`'chat'` per the inference rule below
  when absent.
- **`SessionSummary`** gains `surface: 'chat' | 'code'` so `session:list` results can be split
  into two filtered lists cheaply.

Why a new field rather than deriving it: `session:list` returns `SessionSummary` only
(id/title/preview/updatedAt/messageCount) — no cwd, no config — so the list cannot be filtered
without it. And `mode` is never persisted today (only cwd presence is), while a cwd path is
fragile (users move/rename project folders; scratch dirs are ephemeral).

### Inference rule (for legacy sessions)

A pure helper infers the surface of a pre-existing session from its stored config:

```
surfaceOf(config): 'chat' | 'code'
  if config.surface is set        → config.surface
  else if cwd is under scratch    → 'chat'      // ~/.hip/scratch/<id> or $HIP_SCRATCH_ROOT/<id>
  else                            → 'code'
```

"under scratch" = cwd equals `path.join(scratchRoot, sessionId)` for the session's id, where
`scratchRoot` is `$HIP_SCRATCH_ROOT` or `~/.hip/scratch` (mirror `scratchDirFor` in
`packages/sidecar/src/session/scratch.ts`).

### Migration (lazy, no DB change)

`surface` lives inside the existing `config` JSON blob — **no SQLite schema change**.

- **Write path:** `configFromDraft` sets `surface` from the draft. The frontend already sends
  the full config on `session:create`; the sidecar persists it as today.
- **List path:** `store.listSessions()` parses each row's config and emits `surface`, applying
  the inference rule for rows that lack the field.
- **Load path:** `session:loaded` returns the stored config; the frontend applies the same
  inference if `surface` is absent.
- The inferred value is persisted opportunistically the next time a session's config is written
  (no migration script, no downtime).

### Navigation

- **`uiStore.activeView`** becomes `'chat' | 'code' | 'settings'` (default `'chat'`).
- **`MenuRail`** gains a **Code** rail button between Chat and the avatar (icon `FolderGit2`).
  Settings stays in the avatar dropdown.
- **Per-surface UI state (namespaced):** today `uiStore` has single global `panelOpen` /
  `activeTab` / `collapsed`. With two real surfaces these are tracked per surface so Code's
  git-tab/tree state never leaks into the tree-less Chat surface and vice-versa. Chat tracks
  `{ activeSessionId, panelOpen, selectedArtifactPath }`; Code tracks
  `{ activeSessionId, panelOpen, activeTab }` (mirrors the existing `settingsNavCollapsed` sibling
  added for the same per-view-parallel-state reason). `activeSessionId` is in-memory per surface;
  only the restore pointer below is persisted.
- **Selecting a session** in a sidebar — which lists only that surface's sessions — updates that
  surface's `activeSessionId` and its persisted restore slot.

### Session restoration (asymmetric — decision #8)

Persist **one record**, `surfaceLastConversation = { chat: string | null, code: string | null }`,
in localStorage via the existing zustand `persist` + memoryStorage-fallback pattern (see
`draftStore`). **Keys are conversation ids** (the `session:list` DB primary key), **never folder
paths** — path-keying is the documented "moved the folder, lost my chats" footgun in Cursor /
JetBrains.

- On launch / switching **into Code**: read `surfaceLastConversation.code`; if that id still
  exists in the loaded session list, select it (and restore its cwd/root + permission state); if
  the id is missing (deleted) or null, fall back to the Code new-conversation screen.
- On launch / switching **into Chat**: always show the new-conversation screen. Do **not**
  auto-select `surfaceLastConversation.chat`; retain it only so the sidebar's recents and an
  explicit "resume last" click can reopen it in one step.
- Whenever a conversation is opened in either surface, write its id to that surface's slot; on
  delete, clear any slot pointing at it (mirror the existing `deleteSession` fallback in
  `sessionStore`).

### Layout (`AppLayout`)

`AppLayout` renders the **same** `PanelGroup` for `'chat'` and `'code'`, passing the active
surface down; the `SettingsPage` overlay is unchanged.

- **Sidebar** (left): same component, filtered to the active surface's sessions.
- **Center:** same `ChatPane` + composer for both.
- **Right panel** differs by surface:
  - **Code** → existing `ArtifactPanel` (files / changes / timeline, git-gated as today; agents
    tab stays here).
  - **Chat** → new slim **`PreviewPanel`**.
- `TitleBar` / `ChatTitleBar` reused for both Chat and Code (title, connection, token/cost, panel
  toggle).

### Composer / new-conversation per surface

`Composer.leftSlot` is already a prop, so each surface passes the right controls.

| | **Chat** | **Code** |
|---|---|---|
| New-conversation extras | — | `FolderPill` (must pick a folder before first send) |
| Composer left slot | `ModelPicker` | `ModelPicker` + `PermissionModePicker` |
| Draft | `mode: 'chat'`, no cwd → `surface: 'chat'` | `mode: 'project'` + cwd → `surface: 'code'` |
| Created session | scratch cwd, effective `edit`@sandbox | real cwd, picker-driven mode |

`PermissionModePicker` and `FolderPill` are **Code-only**. Code blocks the first send until a
folder is chosen (with an inline hint).

### Chat `PreviewPanel` (Artifacts pattern, tree-less)

The Chat surface's right panel is a dedicated single-purpose **Preview/Artifacts pane** — **not**
the four-tab `ArtifactPanel` (no `FileTree`, no Timeline/Changes git tabs). It is the file-tree-less
equivalent of the Claude "Artifacts" window. hip already has every piece; this is mostly wiring.

- **Two levels, one data source.** Both read the same helper, `extractRenderedArtifacts(toolCalls)`
  (`src/lib/renderedArtifacts.ts`, already unit-tested), which yields `RenderedArtifact[]`
  (`{ path, name, kind: 'markdown'|'image'|'html'|'pdf' }`).
  1. **Inline** (kept as-is): the per-turn `ArtifactCard` in `MessageBubble` — the in-transcript
     clickable reference, matching Claude's "small artifact card in the transcript."
  2. **Panel**: a left rail listing the **conversation-scoped union** of `extractRenderedArtifacts`
     over **every** assistant turn's `toolCalls` (deduped by path, last-write-wins, first-seen
     order), and a main area that is the existing **`FilePreview`** renderer (image/markdown/html/
     pdf/text already handled; html/pdf already sandboxed via `<iframe sandbox>`). Reuse
     `ArtifactCard`'s `iconFor` + row markup for the list.
- **Selection** drives the existing FS preview pipeline — `useFsStore.getState().setActive(scopeId,
  path)` + `sessionService.readDraftFile(scopeId, path)` (or `readFile` for a committed session),
  exactly as `ArtifactCard.open()` does today.
- **Surface-aware open:** `ArtifactCard.open()` currently opens the panel and switches to the
  `files` tab. On the **Chat** surface there is no `files` tab — instead it opens the `PreviewPanel`
  and sets `selectedArtifactPath`. On **Code** it keeps today's behavior.
- **Header actions:** file name + **Copy** + **Download** + close `X` (Claude's artifact toolbar is
  Copy + a download caret). **Out of scope for v1:** version history, Publish, and the
  code-vs-rendered toggle (markdown/html already render; raw text shows as-is).
- **Empty state:** when the conversation has produced no renderable files, a centered message
  (`智能体生成的文档与图片会显示在这里`) via the existing `Centered` helper in `FilePreview.tsx`.
- **No** directory browsing, git, commit, or checkpoint UI.

Net-new code is small (a `PreviewPanel` shell + a conversation-level artifact aggregator + the
surface branch in `ArtifactCard.open()`); the renderer, FS pipeline, and extraction helper are all
reused. Aggregating across all turns (vs per-turn) is the one behavioral change — see the open
risks for the long-conversation cap and the `extractRenderedArtifacts` 4KB-clip coverage gap.

## Components & files (expected touch points)

**Protocol**
- `packages/protocol/src/index.ts` — add `surface` to `SessionConfig` and `SessionSummary`.

**Sidecar**
- `packages/sidecar/src/persistence/store.ts` — `listSessions()` emits `surface` (with inference).
- `packages/sidecar/src/session/scratch.ts` — reuse `scratchDirFor` for the inference helper
  (or export a small `isScratchCwd(cwd, id)` helper).
- New pure helper module for `surfaceOf(config)` / `isScratchCwd` with unit tests.

**Frontend — state**
- `src/store/uiStore.ts` — `activeView` adds `'code'`; per-surface namespaced UI state (Chat
  `{ activeSessionId, panelOpen, selectedArtifactPath }`, Code `{ activeSessionId, panelOpen,
  activeTab }`); a persisted `surfaceLastConversation = { chat, code }` (zustand `persist` +
  memoryStorage fallback, keyed by conversation id).
- `src/store/draftStore.ts` — ensure Chat drafts are `mode:'chat'`, Code drafts `mode:'project'`;
  the view sets the draft's surface intent.
- `src/domain/sessionService.ts` — `configFromDraft` sets `surface`; apply inference on
  `session:loaded` when `surface` is absent; clear `surfaceLastConversation` slot on delete.

**Frontend — navigation & layout**
- `src/components/rail/MenuRail.tsx` — add the Code rail button.
- `src/routes/AppLayout.tsx` — render Chat/Code with the same `PanelGroup`, surface-parametrized;
  swap the right panel (`ArtifactPanel` vs `PreviewPanel`).
- `src/components/layout/TitleBar.tsx` / `ChatTitleBar.tsx` — reuse for both surfaces.
- `src/components/layout/SidebarToggle.tsx` — already view-aware; extend to `'code'`.

**Frontend — chat components (parametrized)**
- `src/components/sidebar/SessionList.tsx` — filter by active surface.
- `src/components/chat/NewConversation.tsx` — surface-aware extras (FolderPill/permission only in
  Code).
- `src/components/chat/InputBar.tsx` — surface-aware left slot.
- `src/components/chat/Composer.tsx` — unchanged (leftSlot already a prop).
- `src/components/artifact/ArtifactCard.tsx` — surface branch in `open()` (Chat → PreviewPanel +
  `selectedArtifactPath`; Code → today's `files` tab).

**Frontend — Chat preview (new + reused)**
- New `src/components/artifact/PreviewPanel.tsx` — list (conversation-level artifacts) + `FilePreview`.
- New `src/lib/conversationArtifacts.ts` (or extend `renderedArtifacts.ts`) — aggregate
  `extractRenderedArtifacts` across all assistant turns, dedupe last-write-wins; TDD'd pure helper.
- Reused verbatim: `src/components/artifact/FilePreview.tsx`, `src/lib/renderedArtifacts.ts`,
  `src/store/fsStore.ts`, `src/store/useFsScope.ts`.

**i18n**
- `nav.code`, the PreviewPanel empty-state + header actions, and any new keys (en / zh-CN / zh-TW).

## Testing

- **Pure helpers (TDD):** `surfaceOf(config)` / `isScratchCwd(cwd, id)`; per-surface session
  filter; `configFromDraft` surface assignment; conversation-level artifact aggregator (dedupe
  last-write-wins, first-seen order, empty input).
- **Sidecar:** `listSessions()` emits `surface`, including inference for legacy rows (scratch→chat,
  project→code).
- **Restoration logic:** entering Code selects `surfaceLastConversation.code` when present;
  falls back to new-conversation when the id is missing/deleted; entering Chat always shows
  new-conversation and never auto-selects; opening/deleting a conversation updates/clears the slot.
- **Frontend components:** `MenuRail` renders Code; `AppLayout` swaps the right panel by surface
  (Chat → `PreviewPanel`, Code → `ArtifactPanel`); `NewConversation`/`InputBar` show the right
  controls per surface; `SessionList` shows only the active surface's sessions; `ArtifactCard.open()`
  routes to PreviewPanel on Chat vs `files` tab on Code.
- **Migration:** a stored session with scratch cwd and no `surface` lists as `chat`; one with a
  real project cwd lists as `code`.

Run paid-free: move `~/.hip/config/auth.json` aside before `yarn test` (the setup re-seeds the
real key otherwise), then restore.

## Open risks (carry into the plan)

- **Dangling restore pointer.** A `surfaceLastConversation` slot can point at a deleted
  conversation; the restore effect MUST verify the id exists in the freshly loaded `session:list`
  before selecting, and fall back to new-conversation otherwise.
- **`extractRenderedArtifacts` 4KB clip.** It parses `write_file` `ToolCall.input`, which the
  sidecar clips to ~4KB, and its `recoverPath` regex assumes `path` precedes `content`. Large
  artifacts whose JSON orders `content` first are dropped from the conversation-level list too —
  acceptable for v1, but a known coverage gap to note, not silently absorb.
- **Long-conversation list growth.** Aggregating produced files across all turns can grow large
  and re-reads files on selection; the FS pipeline already guards file size, but the list itself
  should cap/virtualize for very long conversations.
- **HTML/PDF sandbox posture.** `FilePreview` renders html/pdf in an `<iframe sandbox>`; confirm
  assistant-produced HTML in the jailed sandbox still renders with no script/network capability
  before surfacing it more prominently than today's per-turn card.
- **Don't over-generalize Codex.** Codex's desktop restore is per-project *thread* restoration
  (IDE-class); it is **not** precedent for the Chat surface's reset-to-new default, which rests on
  ChatGPT/Claude consumer-chat behavior.

## Out of scope / deferred

- Recent-/last-used-folder shortcut on Code new-conversation.
- Agent dashboard inside the Chat preview panel.
- Any change to git/checkpoint behavior, the sidecar engine, or MCP/Skill plumbing.
- Settings page structure (unchanged; stays in the avatar dropdown).
