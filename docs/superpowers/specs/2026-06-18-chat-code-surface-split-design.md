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
- **Per-surface active conversation:** `uiStore` remembers the last-opened session id per surface
  (`activeChatSessionId`, `activeCodeSessionId`). Switching menus restores that surface's
  conversation, or its new-conversation screen if none. Selecting a session in a sidebar — which
  lists only that surface's sessions — updates both the domain active id and the per-surface
  memory.
- **Per-surface panel state:** each surface keeps its own right-panel open/tab state.

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

### Chat `PreviewPanel`

Reuses the existing file-preview renderer (markdown / image / text) from the `files` tab, but
**no tree and no git**.

- Fed by a flat list of files the agent produced or modified **this conversation**, derived from
  tool-call results in the transcript (e.g. `write_file` / `edit_file` results). De-duplicated,
  most-recent first.
- Clicking an entry renders it with the existing renderer (markdown/image/text).
- Empty state when the conversation has produced nothing previewable.
- No directory browsing, no git, no commit/checkpoint UI.

This is the component with the most net-new surface area and should get the most detail in the
plan (how the produced-file list is derived from messages, which renderers are reused).

## Components & files (expected touch points)

**Protocol**
- `packages/protocol/src/index.ts` — add `surface` to `SessionConfig` and `SessionSummary`.

**Sidecar**
- `packages/sidecar/src/persistence/store.ts` — `listSessions()` emits `surface` (with inference).
- `packages/sidecar/src/session/scratch.ts` — reuse `scratchDirFor` for the inference helper
  (or export a small `isScratchCwd(cwd, id)` helper).
- New pure helper module for `surfaceOf(config)` / `isScratchCwd` with unit tests.

**Frontend — state**
- `src/store/uiStore.ts` — `activeView` adds `'code'`; per-surface active-session + panel state.
- `src/store/draftStore.ts` — ensure Chat drafts are `mode:'chat'`, Code drafts `mode:'project'`;
  the view sets the draft's surface intent.
- `src/domain/sessionService.ts` — `configFromDraft` sets `surface`; apply inference on
  `session:loaded` when `surface` is absent.

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
- New `src/components/chat/PreviewPanel.tsx` — Chat's slim doc/image preview.

**i18n**
- `nav.code` and any new keys (en / zh-CN / zh-TW).

## Testing

- **Pure helpers (TDD):** `surfaceOf(config)` / `isScratchCwd(cwd, id)`; per-surface session
  filter; `configFromDraft` surface assignment.
- **Sidecar:** `listSessions()` emits `surface`, including inference for legacy rows (scratch→chat,
  project→code).
- **Frontend components:** `MenuRail` renders Code; `AppLayout` swaps the right panel by surface;
  `NewConversation`/`InputBar` show the right controls per surface; `SessionList` shows only the
  active surface's sessions.
- **Migration:** a stored session with scratch cwd and no `surface` lists as `chat`; one with a
  real project cwd lists as `code`.

Run paid-free: move `~/.hip/config/auth.json` aside before `yarn test` (the setup re-seeds the
real key otherwise), then restore.

## Out of scope / deferred

- Recent-/last-used-folder shortcut on Code new-conversation.
- Agent dashboard inside the Chat preview panel.
- Any change to git/checkpoint behavior, the sidecar engine, or MCP/Skill plumbing.
- Settings page structure (unchanged; stays in the avatar dropdown).
