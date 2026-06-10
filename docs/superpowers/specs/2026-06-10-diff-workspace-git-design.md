# Diff Tab — Workspace Git View (Slice 7) — Design

**Date:** 2026-06-10
**Theme:** Roadmap "Diff MVP" — the last remaining mock tab
**Status:** Approved (pending spec review)

## Goal

Replace the mock Diff tab (`DiffViewer.tsx` hardcodes `files: []`) with a real **workspace changes view**: the worktree-vs-HEAD diff of the session's bound `cwd`, with IDE-git-panel semantics. Anything uncommitted is visible — agent writes and user edits alike. Deleted files show up too (a gap every tool-args-based approach had).

The tab is **a live view, not a recording**: it always reflects the workspace *now*. Reopening an old session shows the current workspace state, which is coherent with the view semantics.

## Decision history (routes considered)

| Route | Approach | Why not / why |
|---|---|---|
| A | Parse persisted `tool_calls` args into per-turn diffs | `write_file` carries only the *after* content, so overwrites render as misleading all-additions; 4KB `TOOL_BLOB_CAP` truncation; deletions invisible |
| B | Subclass `FilesystemBackend`, override `write`/`edit` to snapshot before-content | True per-tool before/after, race-free (the override *is* the execution point; the agent has no `execute` tool — `FilesystemBackend` is not a sandbox — so 100% of mutations flow through these two methods). Needs schema v6 + capture plumbing; no data for old sessions |
| C | Shadow-git snapshot per turn | Catches out-of-band changes, but: git binary not guaranteed, big-tree snapshot cost, user edits mid-turn misattributed to the agent |
| **D** | **Worktree vs HEAD via system git (CHOSEN)** | Thinnest backend (no schema, no protocol persistence), battle-tested diffing, deletions covered. Attribution mixing is a *feature* under the workspace-view semantic |

**Evolution path:** B can later layer per-turn "what did the agent change this turn" diffs on top without conflicting with this view. C becomes necessary only if an execute/shell tool ever lands (interception then stops covering 100%).

## Non-Goals (explicitly out of scope)

- **No agent-vs-user attribution.** The view shows all uncommitted changes, undifferentiated.
- **No write operations.** Read-only view: no commit / stage / discard / revert buttons.
- **No rename rendering.** A rename status renders as delete + add of the two paths.
- **No per-turn historical diff persistence** (route B territory, later).
- **No isomorphic-git fallback.** System `git` binary only; absence → guided empty state.
- **No fs watcher.** Refresh is event-driven (tab activation, turn completion) + manual button.

## Protocol (`packages/protocol/src/index.ts`)

New shared types (the line model matches what `DiffViewer.tsx` already renders):

```ts
export type DiffLineType = 'add' | 'del' | 'ctx'
export interface DiffLine { type: DiffLineType; content: string; oldNo: number | null; newNo: number | null }
export interface DiffFile {
  path: string            // cwd-relative for display (converted from git's repo-root-relative)
  additions: number
  deletions: number
  lines: DiffLine[]
  truncated?: boolean     // per-file line cap hit
  binary?: boolean        // "Binary files differ" → lines: []
}
export type DiffState = 'ok' | 'not_a_repo' | 'git_missing' | 'no_cwd' | 'error'
```

New messages, following the `fs:ls` → `fs:ls:result` request/response pattern:

```ts
// ClientMessage
| { type: 'fs:diff'; sessionId: string }
| { type: 'fs:gitInit'; sessionId: string }

// ServerMessage
| { type: 'fs:diff:result'; sessionId: string; state: DiffState; files?: DiffFile[]; totalFiles?: number; error?: string }
| { type: 'fs:gitInit:result'; sessionId: string; ok: boolean; error?: string }
```

`totalFiles` is the full changed-file count; `files` is capped (see Caps), so the UI can show "and N more".

## Sidecar — new module `workspace-git.ts` (peer of `workspace-fs.ts`)

All git invocations use `execFile('git', [...], { cwd, timeout: 10_000 })` — the process `cwd` is the session's bound directory, so `-- .` pathspecs scope every command to the **cwd subtree** (a cwd inside a larger repo never leaks sibling changes; consistent with the fs sandbox).

- **Detection:** `ENOENT` spawning git → `git_missing`. `git rev-parse --is-inside-work-tree` fails → `not_a_repo`. `git rev-parse --show-toplevel` gives the repo root for repo-root-relative → cwd-relative path conversion.
- **Change collection:** `git status --porcelain=v1 -z -uall -- .` (NUL-separated; `-uall` lists files inside untracked directories individually instead of a single `dir/` entry). Status provides the untracked list and the total count; tracked-change content comes entirely from the diff call below.
- **Tracked changes:** one `git -c core.quotepath=false diff --no-color --no-renames HEAD -- .` call, parsed by a **pure function** `parseUnifiedDiff(text): DiffFile[]` (per-file split, hunk headers → `oldNo`/`newNo`, `Binary files … differ` → `binary: true`). `--no-renames` forces renames to appear as plain delete + add (matching the Non-Goal); `core.quotepath=false` keeps CJK filenames literal instead of octal-escaped; deleted files come out as all-`del` naturally.
- **No HEAD** (fresh repo, zero commits): `git diff HEAD` fails — treat *every* status entry like an untracked file (full-content additions).
- **Untracked files** (`??`): read from disk and render as all-add `DiffFile`. Reuse the NUL-byte binary sniff and the 1 MB text cap pattern from `workspace-fs.ts`.
- **`gitInit(cwd)`:** `git init` → `git add -A` → `git -c user.name=hip -c user.email=hip@local -c commit.gpgsign=false commit -m "hip baseline" --allow-empty --no-verify`. The inline `-c` identity matters: a baseline commit must not depend on the user's global git config. After init the diff is empty (clean baseline); subsequent changes surface normally. The gpgsign/no-verify flags keep the baseline commit independent of the user's global git config and hooks; init steps run with a 60 s timeout.
- **Handlers** (`session-manager.ts`): `case 'fs:diff'` / `case 'fs:gitInit'` mirror `fs:ls` — resolve the session's cwd from its config; missing cwd → `state: 'no_cwd'` (defensive; config.cwd is always written at create time, including scratch sessions).

### Caps

| Cap | Value | Surfaced as |
|---|---|---|
| Lines per file | 2000 | `truncated: true` → badge on the file header |
| Files in response | 200 (merged tracked+untracked list, codepoint path order) | `totalFiles` > `files.length` → "and N more files" row |
| Untracked file read | 1 MB | `truncated: true` |
| git exec timeout | 10 s | `state: 'error'` + message |

## Frontend

- **New `src/store/diffStore.ts`** mirroring `fsStore.ts`: per-session `{ status: 'idle' | 'loading' | 'ready', state?: DiffState, files: DiffFile[], totalFiles: number, error?: string, initPending: boolean }`.
- **`sessionService`:** `requestDiff(sessionId)` (in-flight dedupe — drop the request if one is already loading) and `gitInit(sessionId)`; fold `fs:diff:result` / `fs:gitInit:result` in the `onMessage` chain next to the existing `fs:ls:result` handling (`sessionService.ts:57`). A successful `fs:gitInit:result` immediately issues a fresh `fs:diff`.
- **Refresh triggers:** Diff tab activation; `message:complete` for the completing session (any session — diff state is per-session) *while the Diff tab is visible* (`useUiStore.activeTab === 'diff'`); a manual refresh button in the tab header.
- **`DiffViewer.tsx`:** delete the hardcoded `files: []`; subscribe to `diffStore` + active session. The existing `FileDiff`/`DiffLine` rendering stays as-is. Add: header row (refresh button, changed-file count), per-file `truncated` badge, "and N more files" row, and four empty states:
  - `no_cwd` → "bind a project folder first" (points at the Files-tab folder flow)
  - `not_a_repo` → explainer + **"Initialize git repository"** button (user-triggered `fs:gitInit`)
  - `git_missing` → install guidance
  - `error` → message + retry button
- **i18n:** new `artifact.diffView.*` keys in en / zh-CN / zh-TW (full parity, per project convention).

## Error handling

- Any git command failure → `state: 'error'` with a capped stderr excerpt; UI shows retry.
- `gitInit` failure → stays `not_a_repo`, shows the error inline under the button.
- In-flight dedupe prevents request storms from rapid tab toggling; auto-refresh is suppressed when the tab is not visible.
- Pathological workspaces (huge folders, no `.gitignore`) are bounded by the caps; the only slow user-facing operation is the baseline commit inside `gitInit`, which is user-triggered.

## Testing (per project convention: no DOM/RTL; real-machine E2E welcome)

- **`workspace-git.test.ts`** (sidecar): build **real temp git repos** in `tmpdir` — modified / staged / untracked / deleted / binary / fresh-no-HEAD / non-repo / subtree scoping (cwd inside a larger repo) / caps / `gitInit` baseline (incl. inline identity). Zero LLM calls.
- **`parseUnifiedDiff`** pure-function unit tests (hunk math, multi-file split, binary marker, rename emission).
- **`diffStore` / `sessionService`** unit tests: result folding, in-flight dedupe, init→refresh chaining.
- **E2E (one spec, optional):** bind a non-repo temp cwd → Diff tab shows init empty state → click init → clean state. Paid-call-free.
