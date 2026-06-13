# Light Git Panel · Per-Turn Checkpoints · Agent Git Tools · Artifact Cards — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into per-slice implementation plans (A1 → A2 → B). This spec covers one coherent feature delivered in 3 slices; each slice becomes its own plan.

**Goal:** Evolve hip's right-hand review pane from a read-only diff viewer into a *light git panel* — per-turn checkpoints with one-click revert, branch awareness, agent-driven commits — plus surface agent-generated renderable files as end-of-turn artifact cards.

**Architecture:** Borrow Zed's agent-checkpoint *model* (detached `commit-tree` on a private ref, never moving HEAD; tree-based exact restore) but implement it natively on hip's existing `git` CLI plumbing (`runGit` + `GIT_INDEX_FILE` index isolation in `workspace-git.ts`). The UI restructures the single **Diff** tab into two git-gated tabs — **时间线** (timeline) and **更改** (changes) — and the chat renders an aggregate artifact card.

**Tech Stack:** TypeScript monorepo — `@hip/protocol` (shared IPC types) ⇄ `@hip/sidecar` (Node, shells to git CLI; LangGraph ReAct agent) ⇄ React/TS frontend (zustand stores, react-i18next, typed i18n). SQLite via `node:sqlite` (`DatabaseSync`, wrapped in `persistence/sqlite.ts`) with `PRAGMA user_version` incremental migrations.

---

## 1. Scope

**In scope** (delivered across slices A1 → A2 → B):
- Per-turn **checkpoint chain** on a private ref (`refs/hip/checkpoints/<sessionId>/<turnId>`), captured automatically at end of each turn; session-start snapshot is checkpoint #0.
- **时间线 tab** — list of turns; click a turn to see its diff in one of three modes (本轮 / 自此至今 / 起点至今); per-turn **回退 (revert)**.
- **Revert to a checkpoint** — exact worktree restore with a mandatory pre-revert safety checkpoint.
- **更改 tab** — read-only: uncommitted working changes (click → diff) + commit log (session-start → HEAD).
- **Branch awareness** — current branch shown in panel header; branch switcher; safety confirm on switch; cross-branch revert warning; each checkpoint records its branch.
- **Agent git tools** — `git_commit` (proactive, after a unit of work), `git_create_branch`, `git_switch_branch`. No user commit/stage UI.
- **Git-repo gating** — 时间线/更改 tabs appear only when cwd is a git repo; a thin init banner lives in the 文件 tab otherwise.
- **Artifact cards** — when the agent writes renderable files in a turn (HTML, Markdown, images png/jpg/gif/svg/webp, PDF), an aggregate "本轮产物 (N)" card renders at the end of the assistant message; click a file → preview in the 文件 tab (reusing existing `FilePreview`); smart auto-open.

**Out of scope** (deliberately not built):
- User-facing staging/index manipulation, manual commit UI (commits are agent-driven only).
- push / pull / fetch / merge / rebase / stash / tag / cherry-pick / conflict resolution.
- libgit2 / gitoxide bindings — pure git CLI, matching existing `workspace-git.ts`.
- A git file-watcher / event bus — refresh stays request-driven (extend the existing post-`message:complete` pull).
- Syntax highlighting in diffs (consistent with chat `CodeBlock`, which has none).
- Source-code files (`.ts/.py/...`) as artifact cards — those belong in the diff, not the card.

---

## 2. Locked UX decisions (brainstorm outcomes)

These were decided interactively and are fixed inputs to the plans:

| Topic | Decision |
|---|---|
| Base granularity | **Real checkpoint commits** (not just session-start cumulative), with revert. |
| Revert semantics | **Exact restore + automatic pre-revert safety checkpoint** (revert is itself undoable). |
| Branch handling | **Show branch + switcher + safety prompts**; checkpoints record branch; cross-branch revert warns. |
| Git-client ceiling | **Light git panel** — checkpoints + revert + branch switch + agent commits. No push/pull/merge/rebase/stash. |
| Panel IA | **Two separate tabs** — 时间线 + 更改 — **gated on git repo** (appear only after init). |
| Timeline interaction | **Per-turn-change focused** — click a turn → inline "what this turn changed"; mode toggle 本轮/自此至今/起点至今; per-row 回退. |
| 更改 tab | **Read-only**: uncommitted changes (top) + commit log (bottom). **No user commit/stage buttons.** |
| Who commits | **The agent**, proactively after a unit of work; agent also creates/switches branches. |
| Commit identity | **User's `git config` identity + `Co-authored-by: hip`** trailer; fall back to synthetic `hip <hip@local>` when no user identity is configured. |
| Commit-log scope | **All commits session-start → HEAD** (`git log`), not a separate agent-commit table. |
| Artifact card form | **One aggregate card** "本轮产物 (N)" per turn. |
| Artifact triggers | **Renderable files only** (HTML / Markdown / images / SVG / PDF). |
| Artifact click | Open right panel → 文件 tab → preview (reuse `FilePreview`). |
| Artifact auto-open | **Smart** — if panel already open, switch to preview; if closed, just show the card. |

---

## 3. Architecture — Zed-informed, hip-native

**Borrow the model, not the runtime.** Zed (`crates/git`, `crates/git_ui`, `crates/agent`) is Rust + libgit2/CLI with an event-driven `Repository` snapshot, a job queue (`JobKey` dedup), optimistic `PendingOps`, and a `.gitconfig` watcher. hip needs **none** of that machinery: its tabs are read-only, checkpoint capture is fire-and-forget once per turn, and refresh is request-driven. We adopt Zed's *shapes* and skip the concurrency layer.

### 3.1 Checkpoint engine (Zed `acp_thread.rs` + `repository.rs` → hip `workspace-git.ts`)
Zed's three deliberate choices map 1:1:
1. **Detached `commit-tree`, ref-protected immediately.** hip already isolates the index: `write-tree` runs under `GIT_INDEX_FILE=<temp>` (`workspace-git.ts:117–130`), so the real index is untouched. Capture =
   - `tree = writeWorkingTree(cwd, …)` (existing helper — untracked included, `.gitignore` respected),
   - `commit = git commit-tree <tree> -p <prevCheckpointCommit> -m "<turn label>"` with synthetic author env (`GIT_AUTHOR_NAME=hip` etc.) so checkpoints never look like real commits,
   - `git update-ref refs/hip/checkpoints/<sessionId>/<turnId> <commit>` **immediately** (un-reffed `commit-tree` objects are GC'd — Zed's hard rule). Checkpoint #0's parent is the session-start branch HEAD commit (or no parent on an unborn HEAD).
2. **Skip empty turns** via `git diff-tree --quiet <prevTree> <newTree>` (exit 0 ⇒ identical ⇒ do not create a checkpoint).
3. **Record branch at capture** (`git rev-parse --abbrev-ref HEAD`) for cross-branch revert warnings.

### 3.2 Three diff modes = three tree pairs
The 时间线 modes are just different base→head pairs fed to the existing diff engine, generalized to accept an explicit head tree:
- **本轮 (this turn):** `diff(prev.tree → this.tree)` — what this turn changed.
- **自此至今 (since then):** `diff(this.tree → workingTree)`.
- **起点至今 (since start):** `diff(checkpoint#0.tree → workingTree)` — identical to today's session-start diff.

Checkpoint #0 (session start) has no previous turn, so it offers only 自此至今 / 起点至今 (no 本轮).

`collectWorkspaceDiff` gains an optional `headSha` (default = live working tree) so tree↔tree diffs work; keep `--find-renames` (better than Zed's `--no-renames`).

### 3.3 Revert engine (Zed `restore_archive_checkpoint` → hip, hardened)
Exact restore **without touching index/HEAD/branches**:
1. **Mandatory** pre-revert safety checkpoint (must succeed; if it fails, abort the revert).
2. `git read-tree <targetTree>` into a temp index (`GIT_INDEX_FILE`),
3. `git checkout-index -f -a` (writes tracked content),
4. delete files present in the worktree but **absent** from `git ls-tree -r --name-only <targetTree>` (the set-difference step — the only data-loss surface, hence step 1 is mandatory).
**Never** `git reset --hard` (it moves HEAD). Restore is branch-agnostic (trees only); the cross-branch warning is informational.

### 3.4 Branch & commit-log
- **Current branch / list:** `git rev-parse --abbrev-ref HEAD`, `git branch --format=…`.
- **Switch:** client confirm → `git switch <name>` (fallback `checkout`). Re-anchor nothing (checkpoints are branch-agnostic); record new branch on subsequent checkpoints.
- **Commit log (更改 tab):** `git log <session_start_commit>..HEAD --format=…` on the current branch. Cross-branch fuzziness is an accepted tradeoff of the "all commits since session-start" decision.

### 3.5 Artifact detection (line B)
Mirror `src/lib/todos.ts`: a pure helper `extractRenderedArtifacts(toolCalls)` filters `write_file` calls with status `finished`, parses `.path` from the JSON input, and keeps only paths whose `previewKind()` is renderable (`image | markdown | html`; extend with `pdf` and `svg`). `.ts/.py/...` → `none` → skipped. Dedup by path (keep last write).

---

## 4. Data model — SQLite v8 migration

Current `user_version` is **7** (`schema.ts:139`). Add a `version < 8` block, then set `PRAGMA user_version = 8`. **No `agent_commits` table** (commit log is read live from `git log`).

```sql
CREATE TABLE checkpoints (
  id            TEXT PRIMARY KEY,          -- e.g. "<sessionId>:<turnId>"
  session_id    TEXT NOT NULL,
  turn_id       TEXT,                      -- NULL for checkpoint #0 (session start)
  kind          TEXT NOT NULL DEFAULT 'turn',  -- 'start' | 'turn' | 'pre-revert'
  label         TEXT,                      -- denormalized turn label for the timeline
  tree_sha      TEXT NOT NULL,             -- drives diffs + restore
  commit_sha    TEXT NOT NULL,             -- GC-protected ref target
  branch        TEXT,                      -- branch at capture (for cross-branch warning)
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_checkpoints_session ON checkpoints(session_id, created_at);

ALTER TABLE sessions ADD COLUMN current_branch       TEXT;  -- last-seen branch
ALTER TABLE sessions ADD COLUMN session_start_commit TEXT;  -- branch HEAD at session create (commit-log lower bound; NULL on unborn HEAD)
```

`commit_sha` ≠ `tree_sha` — store both. Cascade clears DB rows on session delete; shadow refs are cleaned separately (§10). `store.ts` gains: `insertCheckpoint`, `listCheckpoints(sessionId)`, `setSessionBranch`, `setSessionStartCommit`, `getSessionGitMeta`.

---

## 5. New `@hip/protocol` messages (`packages/protocol/src/index.ts`)

Data types:
```ts
export interface Checkpoint  { id: string; sessionId: string; turnId: string | null; kind: 'start'|'turn'|'pre-revert'; label: string | null; treeSha: string; commitSha: string; branch: string | null; createdAt: number }
export interface CommitLogEntry { sha: string; shortSha: string; message: string; author: string; timestamp: number }
export interface Branch      { name: string; current: boolean }
export type CheckpointMode   = 'this-turn' | 'since-then' | 'since-start'
```
ClientMessage additions: `git:checkpoint:list {sessionId}`, `git:checkpoint:diff {sessionId, checkpointId, mode}`, `git:commitLog {sessionId}`, `git:branch:list {sessionId}`, `git:branch:switch {sessionId, branch}`, `git:revert {sessionId, checkpointId}`.
ServerMessage additions: `git:checkpoint:list:result {sessionId, checkpoints}`, `git:checkpoint:diff:result {sessionId, checkpointId, mode, ...DiffResult}`, `git:commitLog:result {sessionId, commits}`, `git:branch:list:result {sessionId, branches}`, `git:branch:switch:result {sessionId, branch, ok, error?}`, `git:revert:result {sessionId, checkpointId, ok, safetyCheckpointId?, error?}`, `checkpoint:created {sessionId, checkpoint}`.
`DiffBase` (`'session-start' | 'head'`) and the existing `fs:diff*` messages remain for the 更改 tab's uncommitted view.

---

## 6. Agent git tools + system prompt

**`workspace-git.ts`** — three helpers (each `runGit` + try/catch, never throws, returns `{ok, …}`):
```ts
gitCommit(cwd, message, opts):       Promise<{ ok: boolean; sha?: string; error?: string }>
gitCreateBranch(cwd, name, opts):    Promise<{ ok: boolean; error?: string }>
gitSwitchBranch(cwd, name, opts):    Promise<{ ok: boolean; error?: string }>
```
- `gitCommit`: resolve author — read user `git config user.name/user.email`; if both present, commit as the user and append a `\n\nCo-authored-by: hip <hip@local>` trailer; else commit with `-c user.name=hip -c user.email=hip@local`. Always `-c commit.gpgsign=false … --no-verify`. Stage with `git add -A` first; read back `git rev-parse HEAD` for `sha`.
- `gitCreateBranch`: `git branch <name>`. `gitSwitchBranch`: `git switch <name>` (fallback `checkout`).

**`tools.ts`** (`buildTools()`): register 3 `tool()` defs with Zod schemas `{message}` / `{branchName}` / `{branchName}`; handlers call the workspace-git fns and return a **string** (`"committed <shortSha>"` / `"Error: …"`) so they round-trip through the existing LangGraph `toolsNode` — **no graph/model-runner changes**.

**`system-prompt.ts`**: one paragraph after the cwd block, before `ANTI_PHANTOM`: commit proactively after a coherent unit of work with a concise one-line message (<72 chars); group related edits into one commit (don't commit per file write); use branch tools only when the work warrants a separate line of history. Note: `ANTI_PHANTOM`/`verifyWrites()` do not police git ops — the agent must actually call the tool.

---

## 7. Frontend — panel IA + components

| File | Action | Responsibility |
|---|---|---|
| `src/store/uiStore.ts` | MODIFY | `ArtifactTab = 'files'\|'agents'\|'timeline'\|'changes'`; add `checkpointMode` (in-memory, no persist — matches existing pattern). |
| `src/store/diffStore.ts` | MODIFY | Add `checkpoints`, `activeCheckpointId`, per-mode diff cache, `branches`, `currentBranch`, `commitLog`, `isGitRepo`; keep the existing uncommitted-diff state for 更改. |
| `src/domain/sessionService.ts` | MODIFY | `requestCheckpoints`, `requestCheckpointDiff(id, mode)`, `requestCommitLog`, `requestBranches`, `switchBranch`, `revertCheckpoint`; route the new `git:*:result` + `checkpoint:created` into stores; fire `git:checkpoint:list`/`git:commitLog` on session select & after `message:complete`. |
| `src/components/artifact/ArtifactPanel.tsx` | MODIFY | Tabs 文件·智能体·时间线·更改; **gate** 时间线/更改 on `isGitRepo`; render counts/badges. |
| `src/components/artifact/DiffViewer.tsx` | MODIFY | Extract a reusable `<DiffDisplay>` (the `FileDiff`/`HunkLines`/word-diff/split internals) so Timeline + Changes share rendering; keep the existing not-a-repo init banner, now surfaced in the 文件 tab. |
| `src/components/artifact/TimelineView.tsx` | CREATE | Checkpoint list (newest first); mode toggle (本轮/自此至今/起点至今); selected-turn inline `<DiffDisplay>`; per-row 回退 → confirm modal → `git:revert`. |
| `src/components/artifact/ChangesView.tsx` | CREATE | Top: uncommitted `<DiffDisplay>`. Bottom: read-only commit log. No stage/commit controls. |
| `src/components/artifact/BranchSwitcher.tsx` | CREATE | Panel-header current-branch chip + dropdown; switch confirm; feeds cross-branch revert warning. |
| `src/components/artifact/GitInitBanner.tsx` | CREATE (or reuse DiffViewer's) | Thin banner in 文件 tab when `!isGitRepo`; calls existing `fs:gitInit`. |
| `src/lib/renderedArtifacts.ts` (+ `.test.ts`) | CREATE | `extractRenderedArtifacts(toolCalls)` — pure, unit-tested (mirror `todos.ts`). |
| `src/components/artifact/ArtifactCard.tsx` | CREATE | Aggregate "本轮产物 (N)" card; row click → drive `FilePreview` (via `useFsScope`/`fsStore` + `sessionService.readFile`) + smart auto-open (open panel if closed, then `setTab('files')` deferred to next tick to avoid the mount race). |
| `src/components/chat/MessageBubble.tsx` | MODIFY | Render `<ArtifactCard>` after markdown / before `MessageActions`, only for completed assistant messages with ≥1 renderable artifact. |
| `src/components/artifact/previewKind.ts` | REUSE/EXTEND | Source of truth for renderable detection; add `pdf`, ensure `svg`→image. |
| `src/i18n/zh-CN.ts` · `en.ts` · `zh-TW.ts` | MODIFY | All new keys in **every** locale in the same change (typed i18n; zh-CN is the type source). |

---

## 8. Slices (each → its own plan via writing-plans)

**Slice A1 — Checkpoint capture + read-only review** (no writes to the user's repo state):
- v8 migration (`checkpoints` + `sessions.current_branch`/`session_start_commit`); store accessors.
- `workspace-git.ts`: `captureCheckpoint` (commit-tree + update-ref + empty-turn skip), `listCheckpointRefs`, `getCurrentBranch`, generalized `collectWorkspaceDiff(headSha?)`.
- `session.ts`: `captureCheckpoint(turnId)` hooked fire-and-forget after `finalizeAndPersist`; record `session_start_commit` + checkpoint #0 in `captureSnapshot`.
- protocol: `git:checkpoint:list[:result]`, `git:checkpoint:diff[:result]`, `git:commitLog[:result]`, `checkpoint:created`.
- Frontend: tab IA + gating, `DiffDisplay` extraction, `TimelineView` (modes, no revert button yet), `ChangesView` (uncommitted + commit log), `GitInitBanner`.
- **Deliverable:** you can review, per turn, exactly what the agent changed; read-only.

**Slice A2 — Writes** (revert + branch + agent commits):
- `workspace-git.ts`: `revertToCheckpoint` (safety checkpoint → restore), `listBranches`, `switchBranch`, `gitCommit`/`gitCreateBranch`/`gitSwitchBranch`.
- `tools.ts` + `system-prompt.ts`: 3 agent tools + proactive-commit guidance.
- protocol: `git:branch:list[:result]`, `git:branch:switch[:result]`, `git:revert[:result]`.
- Frontend: TimelineView 回退 button + confirm; `BranchSwitcher` + safety/cross-branch warnings.
- **Deliverable:** time-travel revert, branch ops, agent commits; commit log populates.

**Slice B — Artifact cards** (independent; can ship alongside A1):
- `renderedArtifacts.ts` (+ test), `ArtifactCard.tsx`, `MessageBubble` injection, `previewKind` extension, smart auto-open, i18n.
- **Deliverable:** agent-generated renderable files surface as a card → one-click preview.

---

## 9. Resolved decisions (former open questions)
1. **Commit identity** — user identity + `Co-authored-by: hip` trailer; fallback synthetic `hip` identity.
2. **Commit-log scope** — `git log session_start_commit..HEAD` (no agent-commit table).
3. **turnId** — reuse the existing per-turn id passed to `finalizeAndPersist`; sanitize to ref-safe chars (alnum/`-`/`_`), hash if needed.
4. **Shadow-ref cleanup** — best-effort `git update-ref -d` on session delete; never block deletion on failure (orphaned refs are harmless).
5. **Init banner** — reuse existing `fs:gitInit` (its "hip baseline" commit becomes the session-start commit / checkpoint #0 parent).
6. **Branch switch ownership** — both agent (`gitSwitchBranch` tool) and UI; both paths checkpoint-protected and trigger cross-branch labeling.
7. **Rename revert** — tree-based restore (delete new path, restore old); documented as expected.
8. **Unborn HEAD** — restore via `read-tree`/`checkout-index` must be tested on a freshly-`git init` repo (checkpoint #0 has no commit ancestry / `session_start_commit` is NULL).

---

## 10. Risks & mitigations
- **Shadow-ref GC** — `update-ref` immediately after `commit-tree`; sanitize ref path; lazy-list refs; best-effort delete on session delete.
- **Exact-restore data loss** — pre-revert safety checkpoint is mandatory and must succeed before any delete; run under temp index so real index/HEAD never move; show the safety checkpoint in the timeline.
- **Branch-switch safety** — client confirm before switch; record branch per checkpoint; warn on cross-branch revert.
- **Typed i18n** — add keys to zh-CN/en/zh-TW together or `tsc` breaks.
- **[[subagent-git-checkout-branch-trap]]** — after any git-capable subagent, verify `git branch --show-current`; reviewers use `git diff base...HEAD` without switching; never run the real branch tools against the live checkout in CI/review.
- **[[vitest-src-filter-runs-paid-tests]]** — test git plumbing with temp-dir repos via `yarn test`, never `vitest run src`; if a sidecar suite is in scope, move `~/.hip/config/auth.json` aside (trap-restore) first. Git unit tests need no model.
- **Checkpoint timing** — capture after writes finish, before the diff refresh; fire-and-forget (don't `await` in the send path).
- **Smart auto-open race** — defer `setTab('files')` to next tick after `setPanelOpen(true)`; only auto-open on card click, never on `checkpoint:created`.
- **bash 3.2 / CJK var bracing** — applies only to any script-side messages ([[bash32-cjk-var-bracing]]); these strings are JS, not shell.

---

## 11. Testing strategy
- **Pure helpers** unit-tested: `renderedArtifacts.ts`, any checkpoint-mode base-pair selection, ref-path sanitization.
- **Sidecar git plumbing** tested against **temp-dir git repos** (create, commit, branch, checkpoint, revert, unborn-HEAD) via `yarn test` — no model, paid-free.
- **No component-test stack** (zero `.test.tsx`, vitest env=node): push UI logic into pure helpers; verify rendering via wdio e2e + manual GUI acceptance (see [[prefer-gui-over-real-llm-tests]]).
- Each plan ends with a manual GUI acceptance checklist + e2e additions.

---

## 12. Relationship to prior work
Supersedes/extends `docs/superpowers/specs/2026-06-13-gitdiff-review-pane-design.md` (the read-only hunk-first diff pane, branch `feat/gitdiff-review-pane`). That pane's engine (`workspace-git.ts` two-tree diff, `captureSessionSnapshot`, `DiffViewer` internals) is the foundation this builds on; the **Diff** tab is replaced by **时间线 + 更改**. If the prior branch is unmerged at implementation time, rebase these slices on it (or merge it first).
