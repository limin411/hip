# Per-Turn Checkpoints + Read-Only Review (Slice A1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a per-turn checkpoint chain on a private git ref (never moving HEAD), persist checkpoint metadata in SQLite, and surface it in a **read-only** right-hand panel: a 时间线 (timeline) tab with three diff modes (本轮 / 自此至今 / 起点至今) and a 更改 (changes) tab (uncommitted diff + commit log). No writes to the user's repo state in this slice (no revert, no branch ops, no agent commits — those are slice A2).

**Architecture:** Borrow Zed's checkpoint *model* — detached `git commit-tree` on a private ref `refs/hip/checkpoints/<sessionId>/<turnId>`, ref-protected immediately so the object isn't GC'd; tree-based diffs feed the existing `parseUnifiedDiff` engine generalized to a `headSha`. The three timeline modes are three base→head tree pairs. UI restructures the single **Diff** tab into two git-gated tabs (时间线 + 更改) and extracts a reusable `<DiffDisplay>` from `DiffViewer.tsx`.

**Tech Stack:** TypeScript monorepo — `@hip/protocol` (shared IPC types) ⇄ `@hip/sidecar` (Node, shells to `git` CLI via `execFile`; LangGraph ReAct agent) ⇄ React/TS frontend (zustand stores, react-i18next typed i18n). SQLite via `node:sqlite` (`PRAGMA user_version` incremental migrations).

**Save target path:** `docs/superpowers/plans/2026-06-13-gitpanel-a1-checkpoints-review.md`

**Design spec:** `docs/superpowers/specs/2026-06-13-gitpanel-checkpoints-artifacts-design.md` (§4, §5, §7, §8 A1)

---

## Cross-plan locked interfaces (A1 owns these; A2/B build on them)

- **protocol** types: `Checkpoint`, `CommitLogEntry`, `CheckpointMode` (`'this-turn'|'since-then'|'since-start'`). Client msgs A1 ships: `git:checkpoint:list`, `git:checkpoint:diff {checkpointId,mode}`, `git:commitLog`. Server msgs A1 ships: `git:checkpoint:list:result`, `git:checkpoint:diff:result`, `git:commitLog:result`, `checkpoint:created`. (`Branch`, `git:branch:*`, `git:revert*` are A2.)
- **workspace-git.ts** fns A1 adds: `sanitizeRefComponent`, `captureCheckpoint`, `listCheckpointRefs`, `getCurrentBranch`, `collectCommitLog`, and a `headSha` option on `collectWorkspaceDiff`/`prepareTrees`. (`revertToCheckpoint`, `listBranches`, `switchBranch`, `gitCommit`, `gitCreateBranch`, `gitSwitchBranch` are A2.)
- **store.ts** A1 adds: `insertCheckpoint`, `listCheckpoints`, `setSessionBranch`, `setSessionStartCommit`, `getSessionGitMeta`. **schema** v8 = `checkpoints` table + `sessions.current_branch` + `sessions.session_start_commit`.
- **frontend:** `ArtifactTab` gains `'timeline'|'changes'`; `uiStore.checkpointMode`+`setCheckpointMode`; `diffStore` gains `checkpoints`, `activeCheckpointId`, `checkpointMode`, `commitLog`, `isGitRepo` (keep existing uncommitted-diff state); `sessionService.requestCheckpoints/requestCheckpointDiff(id,mode)/requestCommitLog`; `<DiffDisplay>` extracted from `DiffViewer.tsx`; `TimelineView.tsx`, `ChangesView.tsx`, `GitInitBanner.tsx`.

---

## File Structure

**CREATE**
- `src/components/artifact/DiffDisplay.tsx` — pure, props-driven diff renderer (`FileDiff`/`HunkLines`/word-diff/split internals) extracted from `DiffViewer.tsx`; shared by Timeline + Changes + Diff.
- `src/components/artifact/TimelineView.tsx` — checkpoint list (newest first) + mode toggle (本轮/自此至今/起点至今) + selected-turn inline `<DiffDisplay>`. NO revert button (A2).
- `src/components/artifact/ChangesView.tsx` — top: uncommitted `<DiffDisplay>` (existing `fs:diff`); bottom: read-only commit log (`git:commitLog`). NO stage/commit controls.
- `src/components/artifact/GitInitBanner.tsx` — thin banner shown in the 文件 tab when `!isGitRepo`; calls existing `fs:gitInit`.
- `src/lib/checkpointMode.ts` (+ `.test.ts`) — pure helper `checkpointModeOptions(checkpoint)` returning the modes a checkpoint offers (#0 omits `this-turn`).

**MODIFY**
- `packages/protocol/src/index.ts` — add `Checkpoint`, `CommitLogEntry`, `CheckpointMode`; 3 client msgs + 4 server msgs.
- `packages/sidecar/src/persistence/schema.ts` — v8 migration block.
- `packages/sidecar/src/persistence/store.ts` — 5 checkpoint/git-meta accessors.
- `packages/sidecar/src/session/workspace-git.ts` — `sanitizeRefComponent`, `captureCheckpoint`, `listCheckpointRefs`, `getCurrentBranch`, `collectCommitLog`, `headSha` option.
- `packages/sidecar/src/session/session.ts` — record `session_start_commit` + checkpoint #0 in `captureSnapshot`; `captureCheckpoint(turnId)` fire-and-forget after `finalizeAndPersist`; `checkpointDiff(id,mode)` + `commitLog()` read methods.
- `packages/sidecar/src/session/session-manager.ts` — route `git:checkpoint:list`, `git:checkpoint:diff`, `git:commitLog`.
- `src/store/uiStore.ts` — `ArtifactTab` adds `'timeline'|'changes'`; `checkpointMode` + `setCheckpointMode`.
- `src/store/diffStore.ts` — add `checkpoints`, `activeCheckpointId`, `checkpointMode`, `checkpointDiff`, `commitLog`, `isGitRepo`; setters.
- `src/domain/sessionService.ts` — `requestCheckpoints`, `requestCheckpointDiff(id,mode)`, `requestCommitLog`; route the 4 new server msgs; fire `git:checkpoint:list`/`git:commitLog` on select + after `message:complete`.
- `src/components/artifact/ArtifactPanel.tsx` — tabs 文件·智能体·时间线·更改; gate 时间线/更改 on `isGitRepo`; render `<TimelineView>`/`<ChangesView>`; mount `<GitInitBanner>` in 文件 when `!isGitRepo`.
- `src/components/artifact/DiffViewer.tsx` — keep `DiffViewer` shell + state-gating; delegate file rendering to `<DiffDisplay>` (pure refactor, no behavior change). Re-export `Empty` for reuse.
- `src/i18n/zh-CN.ts` · `en.ts` · `zh-TW.ts` — new `artifact.timeline.*` / `artifact.changes.*` keys.

**TEST FILES** (mirror existing harnesses exactly)
- `packages/sidecar/src/persistence/schema.test.ts` (extend) — temp `:memory:` `DatabaseSync`, `migrate`, `PRAGMA table_info`.
- `packages/sidecar/src/persistence/store.test.ts` (extend) — `freshStore()` over `openDatabase(':memory:')`.
- `packages/sidecar/src/persistence/open.test.ts` (modify) — bump `user_version` assertion 7→8.
- `packages/sidecar/src/session/workspace-git.test.ts` (extend) — temp-dir real git repos via `makeRepo`.
- `src/domain/sessionService.test.ts` (extend) — `FakeTransport` harness.
- `src/lib/checkpointMode.test.ts` (create) — pure unit test.

---

## Conventions / commands (read once)

- **Run one sidecar test file (paid-free, git plumbing needs no model):**
  `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`
- **Run one frontend/lib test file:**
  `yarn vitest run src/domain/sessionService.test.ts`
- **Typecheck the whole repo:** `yarn type-check` (runs `tsc --noEmit`).
- NEVER run `yarn vitest run src` or `vitest run src` — it substring-matches `packages/sidecar/src` and fires paid real-LLM suites. Always pass a full file path.
- **i18n is typed:** `src/i18n/zh-CN.ts` is the type source (`src/i18n/i18next.d.ts`). Any new key MUST land in `zh-CN.ts` AND `en.ts` AND `zh-TW.ts` in the same task or `tsc` breaks. i18n-key tasks come BEFORE the components that use them.
- Frontend has NO component-test stack (vitest env=node, zero `.test.tsx`). Push logic into pure `.ts` helpers; leave rendering to manual GUI acceptance. Do NOT write React component tests.
- Commit message trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## TASK 1 — protocol: checkpoint types + messages

**Files:**
- Modify: `packages/protocol/src/index.ts` (types after `DiffSummary` ~line 158; `ClientMessage` union ~lines 160-183; `ServerMessage` union ~lines 185-213)
- Test: none (pure type additions; verified by `yarn type-check` and downstream task compiles)

**Steps:**

- [ ] 1.1 Add the data types. After the `DiffSummary` line (`export interface DiffSummary { totalFiles: number; totalAdditions: number; totalDeletions: number }`, ~line 158), insert:
  ```ts
  /** One per-turn (or session-start) checkpoint on the private ref chain. */
  export interface Checkpoint {
    id: string                                  // "<sessionId>:<turnId>" ("<sessionId>:start" for #0)
    sessionId: string
    turnId: string | null                       // null for checkpoint #0 (session start)
    kind: 'start' | 'turn' | 'pre-revert'
    label: string | null                        // denormalized turn label for the timeline
    treeSha: string                             // drives diffs + restore
    commitSha: string                           // GC-protected ref target
    branch: string | null                       // branch at capture (for cross-branch warnings, A2)
    createdAt: number
  }

  /** One row of the session-start..HEAD commit log (更改 tab). */
  export interface CommitLogEntry {
    sha: string
    shortSha: string
    message: string
    author: string
    timestamp: number                           // committer time, ms
  }

  /** The three timeline diff modes — each maps to a base→head tree pair. */
  export type CheckpointMode = 'this-turn' | 'since-then' | 'since-start'
  ```

- [ ] 1.2 Add the client messages. In the `ClientMessage` union, after `| { type: 'fs:gitInit'; sessionId: string }` (~line 183), append:
  ```ts
    | { type: 'git:checkpoint:list'; sessionId: string }
    | { type: 'git:checkpoint:diff'; sessionId: string; checkpointId: string; mode: CheckpointMode }
    | { type: 'git:commitLog'; sessionId: string }
  ```

- [ ] 1.3 Add the server messages. In the `ServerMessage` union, after `| { type: 'fs:gitInit:result'; sessionId: string; ok: boolean; error?: string }` (~line 213), append:
  ```ts
    | { type: 'git:checkpoint:list:result'; sessionId: string; checkpoints: Checkpoint[]; isGitRepo: boolean; currentBranch: string | null }
    | { type: 'git:checkpoint:diff:result'; sessionId: string; checkpointId: string; mode: CheckpointMode; state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }
    | { type: 'git:commitLog:result'; sessionId: string; commits: CommitLogEntry[]; state: DiffState; error?: string }
    | { type: 'checkpoint:created'; sessionId: string; checkpoint: Checkpoint }
  ```

- [ ] 1.4 Typecheck: `yarn type-check`. Expected: passes (these are pure additions; the only failures, if any, are unrelated pre-existing ones — none expected on a clean main).

- [ ] 1.5 Commit:
  ```
  git add packages/protocol/src/index.ts
  git commit -m "feat(protocol): checkpoint + commitLog types and git:checkpoint:* messages

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 2 — schema v8 migration

**Files:**
- Modify: `packages/sidecar/src/persistence/schema.ts` (add `version < 8` block after the `version < 7` block, ~line 145)
- Modify: `packages/sidecar/src/persistence/open.test.ts` (line 6 + 13: `user_version` 7→8)
- Test: `packages/sidecar/src/persistence/schema.test.ts` (extend)

**Steps:**

- [ ] 2.1 Write the failing migration test. In `packages/sidecar/src/persistence/schema.test.ts`, add a new `it` inside the existing `describe('migrate', …)` block (after the idempotency test, ~line 34, before the closing `})`):
  ```ts
  it('v8 adds the checkpoints table + sessions.current_branch/session_start_commit and reaches user_version 8', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'sessions')).toEqual(expect.arrayContaining(['current_branch', 'session_start_commit']))
    expect(columns(db, 'checkpoints')).toEqual(
      expect.arrayContaining(['id', 'session_id', 'turn_id', 'kind', 'label', 'tree_sha', 'commit_sha', 'branch', 'created_at']),
    )
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(8)
  })
  ```

- [ ] 2.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/persistence/schema.test.ts`. Expected FAIL: `expect(received).toEqual(expect.arrayContaining(["current_branch", ...]))` — `sessions` has no such columns; or an error from `PRAGMA table_info(checkpoints)` returning `[]`; and `user_version` is `7` not `8`.

- [ ] 2.3 Implement the v8 block. In `packages/sidecar/src/persistence/schema.ts`, after the `if (version < 7) { … }` block (ends ~line 145) and before the closing `}` of `migrate`, insert:
  ```ts
    if (version < 8) {
      db.exec('BEGIN')
      try {
        // Per-turn checkpoint chain (Zed-style detached commit-tree on a private ref). commit_sha
        // is the GC-protected ref target; tree_sha drives diffs + restore. No agent_commits table —
        // the 更改 tab reads the commit log live from `git log`.
        db.exec(`
          CREATE TABLE IF NOT EXISTS checkpoints (
            id         TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            turn_id    TEXT,
            kind       TEXT NOT NULL DEFAULT 'turn',
            label      TEXT,
            tree_sha   TEXT NOT NULL,
            commit_sha TEXT NOT NULL,
            branch     TEXT,
            created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at);
        `)
        // current_branch: last-seen branch. session_start_commit: branch HEAD at session create
        // (commit-log lower bound; NULL on an unborn HEAD).
        db.exec(`ALTER TABLE sessions ADD COLUMN current_branch TEXT`)
        db.exec(`ALTER TABLE sessions ADD COLUMN session_start_commit TEXT`)
        db.exec('PRAGMA user_version = 8')
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    }
  ```

- [ ] 2.4 Run it, see it pass: `yarn vitest run packages/sidecar/src/persistence/schema.test.ts`. Expected: all `migrate` tests green (including the existing idempotency test — a second `migrate` must not re-run v8).

- [ ] 2.5 Update the open.test.ts version assertion (now 8). In `packages/sidecar/src/persistence/open.test.ts`:
  - line 6: change `it('creates core tables and sets user_version = 7', () => {` → `it('creates core tables and sets user_version = 8', () => {`
  - line 13: change `.user_version).toBe(7)` → `.user_version).toBe(8)`

- [ ] 2.6 Run it, see it pass: `yarn vitest run packages/sidecar/src/persistence/open.test.ts`. Expected: both `openDatabase` tests green.

- [ ] 2.7 Commit:
  ```
  git add packages/sidecar/src/persistence/schema.ts packages/sidecar/src/persistence/schema.test.ts packages/sidecar/src/persistence/open.test.ts
  git commit -m "feat(persistence): schema v8 — checkpoints table + sessions git meta

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 3 — store.ts checkpoint + git-meta accessors

**Files:**
- Modify: `packages/sidecar/src/persistence/store.ts` (import line 2; add methods after `setDiffBaseSha`, ~line 30)
- Test: `packages/sidecar/src/persistence/store.test.ts` (extend)

**Steps:**

- [ ] 3.1 Write the failing test. In `packages/sidecar/src/persistence/store.test.ts`, add two `it` blocks before the final closing `})` of `describe('SessionStore', …)` (~line 313):
  ```ts
  it('inserts and lists checkpoints newest-first within a session', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertCheckpoint({ id: 's1:start', sessionId: 's1', turnId: null, kind: 'start', label: null, treeSha: 'tree0', commitSha: 'c0', branch: 'main', createdAt: 10 })
    store.insertCheckpoint({ id: 's1:t1', sessionId: 's1', turnId: 't1', kind: 'turn', label: 'add feature', treeSha: 'tree1', commitSha: 'c1', branch: 'main', createdAt: 20 })
    const list = store.listCheckpoints('s1')
    expect(list.map((c) => c.id)).toEqual(['s1:t1', 's1:start']) // newest-first
    expect(list[0]).toMatchObject({ turnId: 't1', kind: 'turn', label: 'add feature', treeSha: 'tree1', commitSha: 'c1', branch: 'main', createdAt: 20 })
    expect(list[1]).toMatchObject({ turnId: null, kind: 'start', label: null })
  })

  it('round-trips session git meta (branch + start commit, null by default)', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    expect(store.getSessionGitMeta('s1')).toEqual({ currentBranch: null, sessionStartCommit: null })
    store.setSessionBranch('s1', 'feature')
    store.setSessionStartCommit('s1', 'deadbeef')
    expect(store.getSessionGitMeta('s1')).toEqual({ currentBranch: 'feature', sessionStartCommit: 'deadbeef' })
  })
  ```

- [ ] 3.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/persistence/store.test.ts`. Expected FAIL: `TypeError: store.insertCheckpoint is not a function`.

- [ ] 3.3 Add the `Checkpoint` import. In `packages/sidecar/src/persistence/store.ts` line 2, change:
  ```ts
  import type { AgentRole, AgentRun, Message, SessionSummary, SearchHit, TimelineStep, ToolCall, ToolStatus, TurnUsage } from '@hip/protocol'
  ```
  to:
  ```ts
  import type { AgentRole, AgentRun, Checkpoint, Message, SessionSummary, SearchHit, TimelineStep, ToolCall, ToolStatus, TurnUsage } from '@hip/protocol'
  ```

- [ ] 3.4 Add the accessors. In `packages/sidecar/src/persistence/store.ts`, after the `setDiffBaseSha` method (ends ~line 30) insert:
  ```ts
    /** Insert a checkpoint row. `id` is unique (e.g. "<sid>:<turnId>"); INSERT OR REPLACE so a
     *  recapture of the same turn overwrites cleanly. */
    insertCheckpoint(c: Checkpoint): void {
      this.db.prepare(
        `INSERT OR REPLACE INTO checkpoints(id,session_id,turn_id,kind,label,tree_sha,commit_sha,branch,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(c.id, c.sessionId, c.turnId, c.kind, c.label, c.treeSha, c.commitSha, c.branch, c.createdAt)
    }

    /** All checkpoints for a session, newest-first (created_at DESC). */
    listCheckpoints(sessionId: string): Checkpoint[] {
      const rows = this.db.prepare(
        `SELECT id,session_id,turn_id,kind,label,tree_sha,commit_sha,branch,created_at FROM checkpoints WHERE session_id=? ORDER BY created_at DESC, rowid DESC`,
      ).all(sessionId) as { id: string; session_id: string; turn_id: string | null; kind: Checkpoint['kind']; label: string | null; tree_sha: string; commit_sha: string; branch: string | null; created_at: number }[]
      return rows.map((r) => ({ id: r.id, sessionId: r.session_id, turnId: r.turn_id, kind: r.kind, label: r.label, treeSha: r.tree_sha, commitSha: r.commit_sha, branch: r.branch, createdAt: r.created_at }))
    }

    /** Record the session's last-seen branch (NULL clears). */
    setSessionBranch(id: string, branch: string | null): void {
      this.db.prepare(`UPDATE sessions SET current_branch=? WHERE id=?`).run(branch, id)
    }

    /** Record the session-start commit (commit-log lower bound; NULL on unborn HEAD). */
    setSessionStartCommit(id: string, sha: string | null): void {
      this.db.prepare(`UPDATE sessions SET session_start_commit=? WHERE id=?`).run(sha, id)
    }

    /** Read the session's git meta (both NULL for a missing/legacy session). */
    getSessionGitMeta(id: string): { currentBranch: string | null; sessionStartCommit: string | null } {
      const row = this.db.prepare(`SELECT current_branch, session_start_commit FROM sessions WHERE id=?`).get(id) as
        | { current_branch: string | null; session_start_commit: string | null }
        | undefined
      return { currentBranch: row?.current_branch ?? null, sessionStartCommit: row?.session_start_commit ?? null }
    }
  ```

- [ ] 3.5 Run it, see it pass: `yarn vitest run packages/sidecar/src/persistence/store.test.ts`. Expected: all `SessionStore` tests green.

- [ ] 3.6 Commit:
  ```
  git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
  git commit -m "feat(persistence): checkpoint + session git-meta accessors

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 4 — workspace-git: ref-component sanitizer (pure)

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts` (add export near the top-level helpers, after `stripPrefix` ~line 23)
- Test: `packages/sidecar/src/session/workspace-git.test.ts` (extend; import + new describe)

**Steps:**

- [ ] 4.1 Write the failing test. In `packages/sidecar/src/session/workspace-git.test.ts`, add `sanitizeRefComponent` to the import on line 7:
  ```ts
  import { parseUnifiedDiff, collectWorkspaceDiff, collectWorkspaceDiffSummary, collectWorkspaceDiffFile, gitInit, captureSessionSnapshot, sanitizeRefComponent, MAX_DIFF_LINES_PER_FILE, MAX_DIFF_FILES } from './workspace-git.js'
  ```
  Then add a new `describe` block at the end of the file (after the last `})`):
  ```ts
  describe('sanitizeRefComponent', () => {
    it('passes alnum / dash / underscore through unchanged', () => {
      expect(sanitizeRefComponent('asst-supervisor-123_4')).toBe('asst-supervisor-123_4')
    })
    it('replaces unsafe chars with a stable hash (no slashes, dots, spaces, CJK)', () => {
      const a = sanitizeRefComponent('a/b .c~说明')
      expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(a).toBe(sanitizeRefComponent('a/b .c~说明')) // deterministic
      expect(a).not.toBe(sanitizeRefComponent('different'))
    })
    it('returns a non-empty token for an empty input', () => {
      expect(sanitizeRefComponent('')).toMatch(/^[A-Za-z0-9_-]+$/)
    })
  })
  ```

- [ ] 4.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected FAIL: `sanitizeRefComponent is not exported` / `is not a function`.

- [ ] 4.3 Implement. In `packages/sidecar/src/session/workspace-git.ts`, add this after `import * as os from 'node:os'` add the crypto import (line 5 area) and the helper after `stripPrefix` (~line 23):
  - Add to the imports (after line 5 `import * as os from 'node:os'`):
    ```ts
    import { createHash } from 'node:crypto'
    ```
  - After `function stripPrefix(p: string): string { return p.replace(/^[ab]\//, '') }` (~line 23) add:
    ```ts
    /** Make a turnId / id safe to embed in a git ref path. Keep alnum/-/_ verbatim; if anything else
     *  appears (slash, dot, space, ~, CJK, …) fall back to a short deterministic sha1 so the ref is
     *  always valid (`git check-ref-format`-safe) and collision-resistant. */
    export function sanitizeRefComponent(s: string): string {
      if (s.length > 0 && /^[A-Za-z0-9_-]+$/.test(s)) return s
      return 'h' + createHash('sha1').update(s).digest('hex').slice(0, 16)
    }
    ```

- [ ] 4.4 Run it, see it pass: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected: the new `sanitizeRefComponent` block green (the rest of the suite still passes).

- [ ] 4.5 Commit:
  ```
  git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
  git commit -m "feat(sidecar): ref-component sanitizer for checkpoint ref paths

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 5 — workspace-git: generalize collectWorkspaceDiff with an explicit headSha

The three timeline modes need tree↔tree diffs (e.g. `prev.tree → this.tree`). Today `prepareTrees` always builds the now-tree from the live working tree. Add an optional `headSha` so the head side can be a fixed tree, while default behavior (live working tree) is unchanged.

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts` (`WorkspaceDiffOptions` ~line 17; `prepareTrees` ~lines 137-157; the three collectors use `p.v.nowTree` already)
- Test: `packages/sidecar/src/session/workspace-git.test.ts` (extend)

**Steps:**

- [ ] 5.1 Write the failing test. In `packages/sidecar/src/session/workspace-git.test.ts`, inside `describe('collectWorkspaceDiff', …)` add (before its closing `})`):
  ```ts
  it('diffs base tree → an explicit headSha tree (tree↔tree), ignoring the live working tree', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    // capture a tree with a.txt edited; this becomes the fixed head
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const headTree = await captureSessionSnapshot(root)
    expect(headTree).toBeTruthy()
    // now dirty the working tree differently — it must NOT appear because headSha pins the head
    await fs.writeFile(path.join(root, 'a.txt'), 'three\n')
    await fs.writeFile(path.join(root, 'b.txt'), 'noise\n')
    const r = await collectWorkspaceDiff(root, { base: 'head', headSha: headTree! })
    expect(r.state).toBe('ok')
    expect(r.files!.map((f) => f.path)).toEqual(['a.txt'])      // only the pinned head's change
    expect(r.files![0]).toMatchObject({ additions: 1, deletions: 1 })
  })
  ```

- [ ] 5.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected FAIL: `b.txt` leaks in (`headSha` is ignored), so `expect(['a.txt']).toEqual(['a.txt','b.txt'])` mismatches.

- [ ] 5.3 Add `headSha` to the options type. In `packages/sidecar/src/session/workspace-git.ts` line 17, change:
  ```ts
  export interface WorkspaceDiffOptions { gitBin?: string; base?: DiffBase; baseSha?: string | null; indexFile?: string }
  ```
  to:
  ```ts
  export interface WorkspaceDiffOptions { gitBin?: string; base?: DiffBase; baseSha?: string | null; indexFile?: string; headSha?: string }
  ```

- [ ] 5.4 Honor `headSha` in `prepareTrees`. In `prepareTrees` (~lines 144-156), replace the now-tree block:
  ```ts
    let hasHead = true
    try { await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], gitBin) } catch { hasHead = false }

    const ownIndex = !opts.indexFile
    const indexDir = ownIndex ? await fs.mkdtemp(path.join(os.tmpdir(), 'hip-idx-')) : ''
    const indexFile = opts.indexFile ?? path.join(indexDir, 'index')
    let nowTree: string
    try { nowTree = await writeWorkingTree(cwd, gitBin, hasHead, indexFile) }
    finally { if (ownIndex) await fs.rm(indexDir, { recursive: true, force: true }).catch(() => {}) }
  ```
  with:
  ```ts
    let hasHead = true
    try { await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], gitBin) } catch { hasHead = false }

    // Head side: an explicit pinned tree (tree↔tree mode), else the live working tree (default).
    let nowTree: string
    if (opts.headSha) {
      nowTree = opts.headSha
    } else {
      const ownIndex = !opts.indexFile
      const indexDir = ownIndex ? await fs.mkdtemp(path.join(os.tmpdir(), 'hip-idx-')) : ''
      const indexFile = opts.indexFile ?? path.join(indexDir, 'index')
      try { nowTree = await writeWorkingTree(cwd, gitBin, hasHead, indexFile) }
      finally { if (ownIndex) await fs.rm(indexDir, { recursive: true, force: true }).catch(() => {}) }
    }
  ```

- [ ] 5.5 Run it, see it pass: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected: the new tree↔tree test green; ALL prior `collectWorkspaceDiff` / summary / file / snapshot tests still green (default path unchanged).

- [ ] 5.6 Commit:
  ```
  git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
  git commit -m "feat(sidecar): collectWorkspaceDiff accepts an explicit headSha (tree↔tree)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 6 — workspace-git: getCurrentBranch + listCheckpointRefs

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts` (add after `captureSessionSnapshot` ~line 213)
- Test: `packages/sidecar/src/session/workspace-git.test.ts` (extend; import + new describe)

**Steps:**

- [ ] 6.1 Write the failing test. In `packages/sidecar/src/session/workspace-git.test.ts`, extend the import on line 7 to add `getCurrentBranch, listCheckpointRefs`:
  ```ts
  import { parseUnifiedDiff, collectWorkspaceDiff, collectWorkspaceDiffSummary, collectWorkspaceDiffFile, gitInit, captureSessionSnapshot, sanitizeRefComponent, getCurrentBranch, listCheckpointRefs, MAX_DIFF_LINES_PER_FILE, MAX_DIFF_FILES } from './workspace-git.js'
  ```
  Add a new describe at the end of the file:
  ```ts
  describe('getCurrentBranch + listCheckpointRefs', () => {
    it('returns the current branch name for a repo with a HEAD', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      await git(root, 'branch', '-m', 'main')
      expect(await getCurrentBranch(root)).toBe('main')
    })
    it('returns null for a non-repo folder', async () => {
      expect(await getCurrentBranch(root)).toBeNull()
    })
    it('lists hip checkpoint refs under a session prefix', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
      await git(root, 'update-ref', 'refs/hip/checkpoints/sess1/t1', head)
      await git(root, 'update-ref', 'refs/hip/checkpoints/sess1/t2', head)
      await git(root, 'update-ref', 'refs/hip/checkpoints/other/x', head)
      const refs = await listCheckpointRefs(root, 'sess1')
      expect(refs.sort()).toEqual(['refs/hip/checkpoints/sess1/t1', 'refs/hip/checkpoints/sess1/t2'])
    })
    it('returns [] when there are no refs for the session', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      expect(await listCheckpointRefs(root, 'nope')).toEqual([])
    })
  })
  ```

- [ ] 6.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected FAIL: `getCurrentBranch is not a function`.

- [ ] 6.3 Implement. In `packages/sidecar/src/session/workspace-git.ts`, after `captureSessionSnapshot` (ends ~line 213) add:
  ```ts
  /** Current branch name (`git rev-parse --abbrev-ref HEAD`). Returns null for a non-repo or a
   *  detached/unborn HEAD ('HEAD'). Never throws. */
  export async function getCurrentBranch(cwd: string, gitBin = 'git'): Promise<string | null> {
    try {
      const name = (await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], gitBin)).stdout.trim()
      return name && name !== 'HEAD' ? name : null
    } catch { return null }
  }

  /** List hip checkpoint ref names under refs/hip/checkpoints/<sessionId>/. Never throws → []. */
  export async function listCheckpointRefs(cwd: string, sessionId: string, gitBin = 'git'): Promise<string[]> {
    const prefix = `refs/hip/checkpoints/${sessionId}/`
    try {
      const out = (await runGit(cwd, ['for-each-ref', '--format=%(refname)', prefix], gitBin)).stdout
      return out.split('\n').map((l) => l.trim()).filter(Boolean)
    } catch { return [] }
  }
  ```

- [ ] 6.4 Run it, see it pass: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected: the new block green.

- [ ] 6.5 Commit:
  ```
  git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
  git commit -m "feat(sidecar): getCurrentBranch + listCheckpointRefs

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 7 — workspace-git: captureCheckpoint (commit-tree + update-ref + empty-turn skip)

This is the heart of A1. Capture = write working tree → `commit-tree -p <prev>` with synthetic hip author env → `update-ref` immediately. Skip identical turns via tree comparison.

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts` (add a `CaptureResult` type near the top types ~line 16; add `captureCheckpoint` after `listCheckpointRefs`)
- Test: `packages/sidecar/src/session/workspace-git.test.ts` (extend; import + new describe)

**Steps:**

- [ ] 7.1 Write the failing tests. Extend the import on line 7 to add `captureCheckpoint`:
  ```ts
  import { parseUnifiedDiff, collectWorkspaceDiff, collectWorkspaceDiffSummary, collectWorkspaceDiffFile, gitInit, captureSessionSnapshot, sanitizeRefComponent, getCurrentBranch, listCheckpointRefs, captureCheckpoint, MAX_DIFF_LINES_PER_FILE, MAX_DIFF_FILES } from './workspace-git.js'
  ```
  Add a new describe at the end of the file:
  ```ts
  describe('captureCheckpoint', () => {
    it('captures a tree+commit, ref-protects it, and parents to prevCommit', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      const headCommit = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
      await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
      const r = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'edit a', prevCommit: headCommit })
      expect(r.ok).toBe(true)
      expect(r.treeSha).toBeTruthy()
      expect(r.commitSha).toBeTruthy()
      // ref exists and points at the commit
      const refTarget = (await git(root, 'rev-parse', 'refs/hip/checkpoints/s1/t1')).stdout.trim()
      expect(refTarget).toBe(r.commitSha)
      // parent is prevCommit
      const parent = (await git(root, 'rev-parse', `${r.commitSha}^`)).stdout.trim()
      expect(parent).toBe(headCommit)
      // author is the synthetic hip identity (never a real commit)
      expect((await git(root, 'show', '-s', '--format=%an', r.commitSha!)).stdout.trim()).toBe('hip')
    })

    it('skips an empty turn (working tree identical to prevCommit tree)', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      const headCommit = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
      const r = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'noop', prevCommit: headCommit })
      expect(r.ok).toBe(true)
      expect(r.skipped).toBe(true)
      expect(r.commitSha).toBeUndefined()
      expect(await listCheckpointRefs(root, 's1')).toEqual([]) // no ref created
    })

    it('captures with no parent on an unborn HEAD (fresh git init)', async () => {
      await git(root, 'init')
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
      const r = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'first', prevCommit: null })
      expect(r.ok).toBe(true)
      expect(r.skipped).toBeFalsy()
      expect(r.commitSha).toBeTruthy()
      // a root commit has no parent
      const parents = (await git(root, 'rev-list', '--parents', '-n', '1', r.commitSha!)).stdout.trim().split(' ')
      expect(parents).toHaveLength(1) // just the commit sha, no parents
    })

    it('sanitizes an unsafe turnId into a valid ref', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      const headCommit = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
      await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
      const r = await captureCheckpoint(root, { sessionId: 's1', turnId: 'a/b .c', label: 'x', prevCommit: headCommit })
      expect(r.ok).toBe(true)
      const refs = await listCheckpointRefs(root, 's1')
      expect(refs).toHaveLength(1)
      expect(refs[0]).toMatch(/^refs\/hip\/checkpoints\/s1\/h[a-f0-9]{16}$/)
    })

    it('returns ok:false for a non-repo folder (never throws)', async () => {
      const r = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'x', prevCommit: null })
      expect(r.ok).toBe(false)
    })
  })
  ```

- [ ] 7.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected FAIL: `captureCheckpoint is not a function`.

- [ ] 7.3 Add the result type. In `packages/sidecar/src/session/workspace-git.ts`, after the `WorkspaceDiff`/`WorkspaceDiffOptions` lines (~line 17) add:
  ```ts
  export interface CaptureCheckpointOptions { sessionId: string; turnId: string; label: string | null; prevCommit: string | null; gitBin?: string }
  export interface CaptureResult { ok: boolean; skipped?: boolean; treeSha?: string; commitSha?: string; branch?: string | null; error?: string }
  ```

- [ ] 7.4 Implement `captureCheckpoint`. Append after `listCheckpointRefs`:
  ```ts
  /** Capture the working tree as a detached checkpoint commit and ref-protect it immediately.
   *  Borrows Zed's model: write-tree under a temp index (real index untouched), commit-tree -p prev
   *  with a synthetic hip author (so it never looks like a real commit), then update-ref. Skips the
   *  capture if the working tree is byte-identical to prevCommit's tree (empty turn). Never throws. */
  export async function captureCheckpoint(cwd: string, opts: CaptureCheckpointOptions): Promise<CaptureResult> {
    const gitBin = opts.gitBin ?? 'git'
    try {
      await fs.stat(cwd)
      await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
    } catch { return { ok: false, error: 'not_a_repo' } }
    let hasHead = true
    try { await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], gitBin) } catch { hasHead = false }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-ckpt-'))
    const idx = path.join(dir, 'index')
    try {
      const treeSha = await writeWorkingTree(cwd, gitBin, hasHead, idx)

      // Empty-turn skip: identical to prevCommit's tree → no checkpoint.
      if (opts.prevCommit) {
        const prevTree = (await runGit(cwd, ['rev-parse', `${opts.prevCommit}^{tree}`], gitBin)).stdout.trim()
        if (prevTree === treeSha) return { ok: true, skipped: true, treeSha }
      }

      const message = opts.label ?? 'hip checkpoint'
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: 'hip', GIT_AUTHOR_EMAIL: 'hip@local',
        GIT_COMMITTER_NAME: 'hip', GIT_COMMITTER_EMAIL: 'hip@local',
      }
      const ctArgs = ['commit-tree', treeSha, ...(opts.prevCommit ? ['-p', opts.prevCommit] : []), '-m', message]
      const commitSha = (await execFileP(gitBin, ctArgs, { cwd, env, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER })).stdout.trim()

      const refSession = sanitizeRefComponent(opts.sessionId)
      const refTurn = sanitizeRefComponent(opts.turnId)
      const ref = `refs/hip/checkpoints/${refSession}/${refTurn}`
      await runGit(cwd, ['update-ref', ref, commitSha], gitBin)   // immediate → GC-safe

      const branch = await getCurrentBranch(cwd, gitBin)
      return { ok: true, treeSha, commitSha, branch }
    } catch (e) {
      return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
  ```
  Note the test for the sanitized-turnId case expects the ref under `s1` (the un-sanitized sessionId `s1` is already ref-safe, so `sanitizeRefComponent('s1') === 's1'`).

- [ ] 7.5 Run it, see it pass: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected: the whole `captureCheckpoint` block green. Run the FULL file too — confirm no regressions in the other describes.

- [ ] 7.6 Commit:
  ```
  git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
  git commit -m "feat(sidecar): captureCheckpoint — detached commit-tree on a private ref

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 8 — workspace-git: collectCommitLog (session-start..HEAD)

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts` (add after `captureCheckpoint`)
- Test: `packages/sidecar/src/session/workspace-git.test.ts` (extend; import + new describe)

**Steps:**

- [ ] 8.1 Write the failing test. Extend the import on line 7 to add `collectCommitLog`. Also add a `CommitLogEntry` type import is NOT needed (the fn returns its own shape mirroring the protocol). Add a new describe at the end:
  ```ts
  describe('collectCommitLog', () => {
    it('lists commits in session-start..HEAD newest-first with short sha + author', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      const start = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
      await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
      await git(root, 'add', '-A'); await git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'second')
      await fs.writeFile(path.join(root, 'a.txt'), 'three\n')
      await git(root, 'add', '-A'); await git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'third')
      const r = await collectCommitLog(root, start)
      expect(r.state).toBe('ok')
      expect(r.commits!.map((c) => c.message)).toEqual(['third', 'second']) // start excluded, newest-first
      expect(r.commits![0]).toMatchObject({ author: 't' })
      expect(r.commits![0].shortSha.length).toBeGreaterThanOrEqual(7)
    })
    it('lists ALL commits when startCommit is null (whole history)', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root) // 'init'
      const r = await collectCommitLog(root, null)
      expect(r.state).toBe('ok')
      expect(r.commits!.map((c) => c.message)).toEqual(['init'])
    })
    it('reports not_a_repo for a plain folder', async () => {
      expect((await collectCommitLog(root, null)).state).toBe('not_a_repo')
    })
  })
  ```

- [ ] 8.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected FAIL: `collectCommitLog is not a function`.

- [ ] 8.3 Implement. Add the type import at line 6 — change:
  ```ts
  import type { DiffFile, DiffHunk, DiffFileStatus, DiffState, DiffSummary, DiffBase } from '@hip/protocol'
  ```
  to:
  ```ts
  import type { DiffFile, DiffHunk, DiffFileStatus, DiffState, DiffSummary, DiffBase, CommitLogEntry } from '@hip/protocol'
  ```
  Then append after `captureCheckpoint`:
  ```ts
  /** Read the commit log `<startCommit>..HEAD` (or the whole history when startCommit is null),
   *  newest-first. Uses a US/RS-delimited custom format to survive arbitrary CJK/multi-line messages.
   *  Never throws — folds failure into a DiffState. */
  export async function collectCommitLog(cwd: string, startCommit: string | null, gitBin = 'git'): Promise<{ state: DiffState; commits?: CommitLogEntry[]; error?: string }> {
    try { await fs.stat(cwd) } catch { return { state: 'error', error: 'cwd not accessible: ' + cwd } }
    try { await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin) }
    catch (e) { return { state: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'git_missing' : 'not_a_repo' } }
    try {
      // %x1f = unit-sep (field), %x1e = record-sep (commit). %ct = committer unix time.
      const FMT = '--format=%H%x1f%h%x1f%an%x1f%ct%x1f%s%x1e'
      const range = startCommit ? `${startCommit}..HEAD` : 'HEAD'
      const out = (await runGit(cwd, ['log', FMT, range], gitBin)).stdout
      const commits: CommitLogEntry[] = []
      for (const rec of out.split('\x1e')) {
        const r = rec.replace(/^\n+/, '')
        if (!r.trim()) continue
        const [sha, shortSha, author, ct, message] = r.split('\x1f')
        if (!sha) continue
        commits.push({ sha, shortSha, author, message: message ?? '', timestamp: parseInt(ct, 10) * 1000 })
      }
      return { state: 'ok', commits }
    } catch (e) { return { state: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
  }
  ```

- [ ] 8.4 Run it, see it pass: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected: `collectCommitLog` block green; full file green.

- [ ] 8.5 Commit:
  ```
  git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
  git commit -m "feat(sidecar): collectCommitLog (session-start..HEAD)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 9 — session.ts: record session-start commit + checkpoint #0; hook per-turn capture; add read methods

`captureSnapshot` already runs fire-and-forget at session create and on setCwd. Extend it to also record the session-start commit and a checkpoint #0. After each turn's `finalizeAndPersist`, fire a per-turn `captureCheckpoint`. Add `checkpointDiff(id,mode)` + `commitLog()` read methods, and a list method that hydrates store + live branch.

**Files:**
- Modify: `packages/sidecar/src/session/session.ts` (private fields ~line 186-196; `captureSnapshot` ~lines 307-313; `finalizeAndPersist` call sites in `runTurn` ~lines 558-583; add new public methods near `workspaceGitInit` ~line 349)
- Test: none directly (covered by session-manager routing in Task 10 + manual GUI). The git plumbing it calls is already unit-tested. Verified via `yarn type-check`.

**Steps:**

- [ ] 9.1 Add a private field to track checkpoint #0's commit (the parent of turn #1's checkpoint). After the `private _diffBaseSha: string | null = null` field (~line 186) add:
  ```ts
    // Latest checkpoint commit (the parent for the next per-turn checkpoint). Seeded by captureSnapshot
    // (checkpoint #0 / session-start commit), advanced by each successful per-turn captureCheckpoint.
    private _lastCheckpointCommit: string | null = null
  ```

- [ ] 9.2 Extend `captureSnapshot` to record the session-start commit + checkpoint #0. Replace the body of `captureSnapshot` (~lines 307-313):
  ```ts
    /** 会话创建时抓一次工作区快照并持久化（fire-and-forget 调用）。 */
    async captureSnapshot(): Promise<void> {
      if (!this._config.cwd) return
      const sha = await workspaceGit.captureSessionSnapshot(this._config.cwd)
      this._diffBaseSha = sha
      this.store?.setDiffBaseSha(this.id, sha)
    }
  ```
  with:
  ```ts
    /** 会话创建时抓一次工作区快照并持久化（fire-and-forget 调用）。同时记录会话起点 commit 与
     *  checkpoint #0（起点至今 diff 的 base / 第一轮 checkpoint 的 parent）。 */
    async captureSnapshot(): Promise<void> {
      if (!this._config.cwd) return
      const cwd = this._config.cwd
      const sha = await workspaceGit.captureSessionSnapshot(cwd)
      this._diffBaseSha = sha
      this.store?.setDiffBaseSha(this.id, sha)

      // Session-start commit (commit-log lower bound; null on unborn HEAD / non-repo) + branch.
      const branch = await workspaceGit.getCurrentBranch(cwd)
      this.store?.setSessionBranch(this.id, branch)
      let startCommit: string | null = null
      try { startCommit = (await workspaceGit.collectCommitLog(cwd, null)).commits?.[0]?.sha ?? null } catch { startCommit = null }
      this.store?.setSessionStartCommit(this.id, startCommit)

      // Checkpoint #0 (session start). prevCommit = session-start branch HEAD (or null on unborn HEAD).
      const r = await workspaceGit.captureCheckpoint(cwd, { sessionId: this.id, turnId: 'start', label: null, prevCommit: startCommit })
      if (r.ok && !r.skipped && r.commitSha) {
        this._lastCheckpointCommit = r.commitSha
        this.store?.insertCheckpoint({ id: `${this.id}:start`, sessionId: this.id, turnId: null, kind: 'start', label: null, treeSha: r.treeSha!, commitSha: r.commitSha, branch: r.branch ?? branch, createdAt: Date.now() })
      } else {
        // Empty/clean start (no change vs HEAD) → no checkpoint commit; the next turn parents to startCommit.
        this._lastCheckpointCommit = startCommit
      }
    }
  ```

- [ ] 9.3 Add the public read/capture methods. After `workspaceGitInit` (~line 349) add:
  ```ts
    /** Capture a per-turn checkpoint (fire-and-forget after finalize). Persists the row and emits
     *  checkpoint:created on a non-skipped capture. Advances _lastCheckpointCommit. Never throws. */
    async captureCheckpoint(turnId: string, label: string | null, send: SendFn): Promise<void> {
      if (!this._config.cwd) return
      const prev = this._lastCheckpointCommit
      const r = await workspaceGit.captureCheckpoint(this._config.cwd, { sessionId: this.id, turnId, label, prevCommit: prev })
      if (!r.ok || r.skipped || !r.commitSha) return
      this._lastCheckpointCommit = r.commitSha
      const checkpoint = { id: `${this.id}:${turnId}`, sessionId: this.id, turnId, kind: 'turn' as const, label, treeSha: r.treeSha!, commitSha: r.commitSha, branch: r.branch ?? null, createdAt: Date.now() }
      this.store?.insertCheckpoint(checkpoint)
      if (r.branch) this.store?.setSessionBranch(this.id, r.branch)
      send({ type: 'checkpoint:created', sessionId: this.id, checkpoint })
    }

    /** List checkpoints (newest-first) + live repo state for the timeline tab. */
    async listCheckpoints(): Promise<{ checkpoints: import('@hip/protocol').Checkpoint[]; isGitRepo: boolean; currentBranch: string | null }> {
      const checkpoints = this.store?.listCheckpoints(this.id) ?? []
      const isGitRepo = this._config.cwd ? (await workspaceGit.getCurrentBranch(this._config.cwd)) !== null || (await workspaceGit.collectCommitLog(this._config.cwd, null)).state === 'ok' : false
      const currentBranch = this._config.cwd ? await workspaceGit.getCurrentBranch(this._config.cwd) : null
      return { checkpoints, isGitRepo, currentBranch }
    }

    /** Diff for a timeline checkpoint in one of the three modes. Tree pairs:
     *  this-turn = prev.tree → this.tree | since-then = this.tree → working | since-start = #0.tree → working. */
    async checkpointDiff(checkpointId: string, mode: import('@hip/protocol').CheckpointMode): Promise<workspaceGit.WorkspaceDiff> {
      if (!this._config.cwd) return { state: 'no_cwd' }
      const all = this.store?.listCheckpoints(this.id) ?? []
      const cp = all.find((c) => c.id === checkpointId)
      if (!cp) return { state: 'error', error: 'checkpoint not found' }
      // 'start' checkpoint = the session-start tree; everything is computed off tree shas.
      const startCp = all.find((c) => c.kind === 'start')
      if (mode === 'since-then') {
        // this.tree → live working tree
        return workspaceGit.collectWorkspaceDiff(this._config.cwd, { base: 'session-start', baseSha: cp.treeSha })
      }
      if (mode === 'since-start') {
        const baseSha = startCp?.treeSha ?? this._diffBaseSha
        return workspaceGit.collectWorkspaceDiff(this._config.cwd, { base: 'session-start', baseSha })
      }
      // 'this-turn': prev.tree → this.tree. prev = the checkpoint right before cp by created_at.
      const idx = all.findIndex((c) => c.id === cp.id)
      const prev = all[idx + 1] // all is newest-first → next index is the older neighbor
      const baseSha = prev?.treeSha ?? startCp?.treeSha ?? this._diffBaseSha
      return workspaceGit.collectWorkspaceDiff(this._config.cwd, { base: 'session-start', baseSha, headSha: cp.treeSha })
    }

    /** Commit log session-start..HEAD for the 更改 tab. */
    async commitLog(): Promise<{ state: DiffState; commits?: import('@hip/protocol').CommitLogEntry[]; error?: string }> {
      if (!this._config.cwd) return { state: 'no_cwd' }
      const start = this.store?.getSessionGitMeta(this.id).sessionStartCommit ?? null
      return workspaceGit.collectCommitLog(this._config.cwd, start)
    }
  ```
  Note: `collectWorkspaceDiff` with `base:'session-start', baseSha:<tree>` diffs that tree → head; passing `headSha` additionally pins the head to a fixed tree (the `this-turn` case). When `baseSha` is a tree object (not a commit), git diffs tree→working/tree correctly (the existing snapshot path already relies on this).

- [ ] 9.4 Hook the per-turn capture after each `finalizeAndPersist`. In `runTurn`, the clean-completion path is the final `return this.finalizeAndPersist(...)` (~line 583). Replace it:
  ```ts
      return this.finalizeAndPersist(send, turnId, supervisorText, trajectory, false, usageByAgent)
  ```
  with:
  ```ts
      const finalText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, false, usageByAgent)
      // Per-turn checkpoint AFTER persistence (writes are done). Fire-and-forget — never block the
      // send path or let a git failure surface as a turn error. Label = a short slice of the reply.
      const ckptLabel = (finalText || '').replace(/\s+/g, ' ').trim().slice(0, 72) || null
      void this.captureCheckpoint(turnId, ckptLabel, send).catch(() => {})
      return finalText
  ```
  Note: only the clean-completion path captures a checkpoint in A1. (Interrupt/abort paths persist via `finalizeAndPersist` too, but checkpointing those partial turns is out of scope — keeps A1 minimal; A2 may revisit.)

- [ ] 9.5 Typecheck: `yarn type-check`. Expected: passes. (If `import('@hip/protocol').Checkpoint` inline-import imports feel awkward, you MAY instead add `Checkpoint, CommitLogEntry, CheckpointMode` to the existing top-of-file `import type { … } from '@hip/protocol'` on line 1 and drop the inline forms — functionally identical; pick one and keep it consistent.)

- [ ] 9.6 Run the session test suite to confirm no regressions (no model needed — these tests inject a fake runner): `yarn vitest run packages/sidecar/src/session/session.test.ts`. Expected: all existing session tests green (capture is fire-and-forget on cwd-bound sessions; injected-model tests typically use no real cwd or a temp dir, so capture is a no-op or harmless).

- [ ] 9.7 Commit:
  ```
  git add packages/sidecar/src/session/session.ts
  git commit -m "feat(sidecar): record session-start commit + checkpoint #0; per-turn capture + read methods

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 10 — session-manager: route the three read messages

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts` (add cases in `handleAsync` after `fs:gitInit` ~line 167)
- Test: none (routing is exercised by the existing session-manager tests if present, and by manual GUI; the underlying methods are unit-tested). Verified via `yarn type-check`.

**Steps:**

- [ ] 10.1 Add the three cases. In `packages/sidecar/src/session/session-manager.ts`, inside `handleAsync`'s `switch`, after the `case 'fs:gitInit':` block (ends ~line 167, before the closing `}` of the switch), add:
  ```ts
        case 'git:checkpoint:list': {
          const r = await this.ensureSession(msg.sessionId).listCheckpoints()
          send({ type: 'git:checkpoint:list:result', sessionId: msg.sessionId, checkpoints: r.checkpoints, isGitRepo: r.isGitRepo, currentBranch: r.currentBranch })
          break
        }
        case 'git:checkpoint:diff': {
          const r = await this.ensureSession(msg.sessionId).checkpointDiff(msg.checkpointId, msg.mode)
          send({ type: 'git:checkpoint:diff:result', sessionId: msg.sessionId, checkpointId: msg.checkpointId, mode: msg.mode, state: r.state, files: r.files, summary: r.summary, error: r.error })
          break
        }
        case 'git:commitLog': {
          const r = await this.ensureSession(msg.sessionId).commitLog()
          send({ type: 'git:commitLog:result', sessionId: msg.sessionId, commits: r.commits ?? [], state: r.state, error: r.error })
          break
        }
  ```

- [ ] 10.2 Typecheck: `yarn type-check`. Expected: passes (the `ClientMessage`/`ServerMessage` unions from Task 1 now cover these). The `switch` is exhaustive over a union; adding cases that were not there before will not break — confirm no "unhandled case" lint surfaces.

- [ ] 10.3 Commit:
  ```
  git add packages/sidecar/src/session/session-manager.ts
  git commit -m "feat(sidecar): route git:checkpoint:list/diff + git:commitLog

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 11 — uiStore: ArtifactTab adds timeline/changes + checkpointMode

**Files:**
- Modify: `src/store/uiStore.ts` (`ArtifactTab` line 3; `UiState` ~lines 31-32; store impl ~lines 59-60)
- Test: none (zustand store; covered via sessionService.test FakeTransport indirectly, and manual GUI). No component test.

**Steps:**

- [ ] 11.1 Widen `ArtifactTab` and add `checkpointMode` to the interface. In `src/store/uiStore.ts`:
  - line 3: change `export type ArtifactTab = 'files' | 'agents' | 'diff'` → `export type ArtifactTab = 'files' | 'agents' | 'timeline' | 'changes'`
  - Add the `CheckpointMode` import at the top (line 1 area), after `import { create } from 'zustand'`:
    ```ts
    import type { CheckpointMode } from '@hip/protocol'
    ```
  - In `interface UiState`, after the `diffViewMode` / `setDiffViewMode` lines (~lines 31-32) add:
    ```ts
      // Timeline checkpoint diff mode (本轮/自此至今/起点至今). In-memory only, like diffViewMode.
      checkpointMode: CheckpointMode
      setCheckpointMode: (m: CheckpointMode) => void
    ```

- [ ] 11.2 Implement in the store body. In `useUiStore`, after the `setDiffViewMode` line (~line 60) add:
  ```ts
    checkpointMode: 'this-turn',
    setCheckpointMode: (m) => set({ checkpointMode: m }),
  ```

- [ ] 11.3 Note: the `'diff'` tab literal is gone. The existing `ArtifactPanel.tsx` and `DiffViewer.tsx` and `sessionService.ts` reference `'diff'`; those are updated in Tasks 12, 14, 15. Do NOT typecheck yet (it will fail on those references — that's expected and fixed by the following tasks). Commit this store change together with the i18n keys in Task 12's commit to keep the tree green per-commit OR proceed and let Task 15's commit be the green point. To keep commits green, defer the commit: stage but commit at the end of Task 12.

- [ ] 11.4 (Deferred commit — see Task 12.6.)

---

## TASK 12 — i18n keys for timeline + changes (all three locales)

**Files:**
- Modify: `src/i18n/zh-CN.ts` (artifact block, after `diffView` closes ~line 110)
- Modify: `src/i18n/en.ts` (same location ~line 110)
- Modify: `src/i18n/zh-TW.ts` (same location ~line 110)
- Test: none (typed i18n; `yarn type-check` is the gate)

**Steps:**

- [ ] 12.1 Add keys to `src/i18n/zh-CN.ts` (the TYPE SOURCE). Inside `artifact: { … }`, immediately after the closing `},` of the `diffView` object (~line 110), insert:
  ```ts
        timeline: '时间线',
        changes: '更改',
        timelineView: {
          empty: '暂无检查点',
          emptyDesc: '智能体每完成一轮就会自动创建一个检查点',
          sessionStart: '会话起点',
          modeThisTurn: '本轮',
          modeSinceThen: '自此至今',
          modeSinceStart: '起点至今',
          noChange: '本检查点无改动',
          turn: '第 {{n}} 轮',
        },
        changesView: {
          uncommitted: '未提交的改动',
          commitLog: '提交记录',
          noCommits: '本会话开始以来暂无提交',
          commitLogError: '无法读取提交记录',
        },
        gitInitBanner: {
          title: '初始化 git 以启用检查点',
          desc: '将此文件夹变成 git 仓库后，即可按轮追踪、对比与回退改动',
          button: '初始化 git 仓库',
        },
  ```

- [ ] 12.2 Add the SAME keys to `src/i18n/en.ts` at the matching location (after `diffView` closes ~line 110):
  ```ts
        timeline: 'Timeline',
        changes: 'Changes',
        timelineView: {
          empty: 'No checkpoints yet',
          emptyDesc: 'A checkpoint is created automatically after each turn the agent completes',
          sessionStart: 'Session start',
          modeThisTurn: 'This turn',
          modeSinceThen: 'Since then',
          modeSinceStart: 'Since start',
          noChange: 'No changes in this checkpoint',
          turn: 'Turn {{n}}',
        },
        changesView: {
          uncommitted: 'Uncommitted changes',
          commitLog: 'Commits',
          noCommits: 'No commits since this session started',
          commitLogError: 'Could not read the commit log',
        },
        gitInitBanner: {
          title: 'Initialize git to enable checkpoints',
          desc: 'Turn this folder into a git repo to track, compare, and revert changes per turn',
          button: 'Initialize Git Repository',
        },
  ```

- [ ] 12.3 Add the SAME keys to `src/i18n/zh-TW.ts` at the matching location (after `diffView` closes ~line 110):
  ```ts
        timeline: '時間軸',
        changes: '變更',
        timelineView: {
          empty: '暫無檢查點',
          emptyDesc: '智能體每完成一輪就會自動建立一個檢查點',
          sessionStart: '工作階段起點',
          modeThisTurn: '本輪',
          modeSinceThen: '自此至今',
          modeSinceStart: '起點至今',
          noChange: '本檢查點無變更',
          turn: '第 {{n}} 輪',
        },
        changesView: {
          uncommitted: '未提交的變更',
          commitLog: '提交記錄',
          noCommits: '本工作階段開始以來暫無提交',
          commitLogError: '無法讀取提交記錄',
        },
        gitInitBanner: {
          title: '初始化 git 以啟用檢查點',
          desc: '將此資料夾變成 git 倉庫後，即可按輪追蹤、比對與回退變更',
          button: '初始化 git 倉庫',
        },
  ```

- [ ] 12.4 Typecheck just the i18n shape consistency by building types — but the whole repo still references the now-removed `'diff'` tab (Tasks 14/15 pending). So instead, sanity-check the three locales have IDENTICAL key trees by eye, then proceed. (Full `yarn type-check` will pass after Task 15.)

- [ ] 12.5 Note on the existing `artifact.diff` key (`'Diff'`): the 时间线/更改 tabs replace the single Diff tab. Leave the existing `artifact.diff` key in place for now (harmless; `DiffViewer`'s internal `diffView.*` keys are still used by `<DiffDisplay>` and `ChangesView`). Do NOT delete `diffView.*`.

- [ ] 12.6 Commit the uiStore (Task 11) + i18n together:
  ```
  git add src/store/uiStore.ts src/i18n/zh-CN.ts src/i18n/en.ts src/i18n/zh-TW.ts
  git commit -m "feat(ui): ArtifactTab timeline/changes + checkpointMode + i18n keys

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 13 — diffStore: checkpoints, commitLog, isGitRepo, checkpointDiff cache

**Files:**
- Modify: `src/store/diffStore.ts` (import line 2; `SessionDiff` interface ~lines 4-15; `EMPTY_DIFF` ~line 17; `DiffStore` interface ~lines 21-33; store impl ~lines 39-55)
- Test: `src/domain/sessionService.test.ts` will exercise these via Task 15. No dedicated diffStore test (mirrors the existing pattern — diffStore has no own test file).

**Steps:**

- [ ] 13.1 Widen the imports. In `src/store/diffStore.ts` line 2, change:
  ```ts
  import type { DiffFile, DiffState, DiffBase, DiffSummary } from '@hip/protocol'
  ```
  to:
  ```ts
  import type { DiffFile, DiffState, DiffBase, DiffSummary, Checkpoint, CommitLogEntry, CheckpointMode } from '@hip/protocol'
  ```

- [ ] 13.2 Extend `SessionDiff` and `EMPTY_DIFF`. Replace the `SessionDiff` interface (lines 4-15) by adding fields, and update `EMPTY_DIFF` (line 17). New interface:
  ```ts
  export interface SessionDiff {
    status: 'idle' | 'loading' | 'ready'
    state?: DiffState
    base: DiffBase
    hasSessionStart: boolean
    files: DiffFile[]
    summary?: DiffSummary
    error?: string
    initPending: boolean
    expanded: Record<string, DiffFile>
    collapsed: Record<string, boolean>
    // --- checkpoint / git-panel additions (A1) ---
    isGitRepo: boolean
    currentBranch: string | null
    checkpoints: Checkpoint[]
    activeCheckpointId: string | null
    // per (checkpointId|mode) cached diff result; key = `${checkpointId}|${mode}`
    checkpointDiff: Record<string, { status: 'loading' | 'ready'; state?: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }>
    commitLog: { status: 'idle' | 'loading' | 'ready'; state?: DiffState; commits: CommitLogEntry[]; error?: string }
  }
  ```
  New `EMPTY_DIFF`:
  ```ts
  export const EMPTY_DIFF: SessionDiff = {
    status: 'idle', base: 'session-start', hasSessionStart: false, files: [], initPending: false, expanded: {}, collapsed: {},
    isGitRepo: false, currentBranch: null, checkpoints: [], activeCheckpointId: null, checkpointDiff: {}, commitLog: { status: 'idle', commits: [] },
  }
  ```

- [ ] 13.3 Add setters to the `DiffStore` interface (after `clearSession` / before `resetTransient`, ~line 31):
  ```ts
    setCheckpoints: (sessionId: string, checkpoints: Checkpoint[], isGitRepo: boolean, currentBranch: string | null) => void
    addCheckpoint: (sessionId: string, checkpoint: Checkpoint) => void
    setActiveCheckpoint: (sessionId: string, checkpointId: string | null) => void
    setCheckpointDiffLoading: (sessionId: string, key: string) => void
    setCheckpointDiffResult: (sessionId: string, key: string, r: { state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }) => void
    setCommitLogLoading: (sessionId: string) => void
    setCommitLogResult: (sessionId: string, r: { state: DiffState; commits: CommitLogEntry[]; error?: string }) => void
  ```

- [ ] 13.4 Implement the setters in `useDiffStore`, after `clearSession` (~line 51, before `resetTransient`):
  ```ts
    setCheckpoints: (id, checkpoints, isGitRepo, currentBranch) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, checkpoints, isGitRepo, currentBranch })) })),
    addCheckpoint: (id, checkpoint) => set((st) => ({ bySession: patch(st.bySession, id, (s) => (s.checkpoints.some((c) => c.id === checkpoint.id) ? s : { ...s, checkpoints: [checkpoint, ...s.checkpoints] })) })),
    setActiveCheckpoint: (id, checkpointId) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, activeCheckpointId: checkpointId })) })),
    setCheckpointDiffLoading: (id, key) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, checkpointDiff: { ...s.checkpointDiff, [key]: { status: 'loading' } } })) })),
    setCheckpointDiffResult: (id, key, r) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, checkpointDiff: { ...s.checkpointDiff, [key]: { status: 'ready', state: r.state, files: r.files, summary: r.summary, error: r.error } } })) })),
    setCommitLogLoading: (id) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, commitLog: { ...s.commitLog, status: 'loading' } })) })),
    setCommitLogResult: (id, r) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, commitLog: { status: 'ready', state: r.state, commits: r.commits, error: r.error } })) })),
  ```

- [ ] 13.5 Typecheck deferred (the panel still references `'diff'` — fixed in Task 14). Stage and commit with Task 14 to keep commits green, OR commit now and accept a transient type-check failure until Task 15. To keep per-commit green, defer: stage these changes and commit them together with Task 14.

- [ ] 13.6 (Deferred commit — see Task 14.7.)

---

## TASK 14 — extract `<DiffDisplay>` from DiffViewer (pure refactor)

Pull `STATUS_CHIP`, `lineStyle`, `sign`, `HunkLines`, `FileDiff`, `Empty`, and the file-list + body rendering into a props-driven `<DiffDisplay>` so Timeline + Changes + the existing Diff state-gating reuse it. Behavior must be byte-identical for the uncommitted view.

**Files:**
- Create: `src/components/artifact/DiffDisplay.tsx`
- Modify: `src/components/artifact/DiffViewer.tsx` (delegate to `<DiffDisplay>`; keep state-gating shell)
- Test: none (rendering verified by manual GUI; the diff parsing/word-diff/split logic is already unit-tested in `wordDiff.test.ts` / `diffSplit.test.ts`).

**Steps:**

- [ ] 14.1 Create `src/components/artifact/DiffDisplay.tsx` with the extracted internals. The component takes the files + view-mode + handlers as props so it has no `sessionId`/store coupling beyond callbacks:
  ```tsx
  import { type ReactNode } from 'react'
  import { useTranslation } from 'react-i18next'
  import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
  import type { DiffFile, DiffHunk, DiffLine, DiffLineType, DiffFileStatus, DiffSummary } from '@hip/protocol'
  import { cn } from '@/lib/utils'
  import { computeHunkWordDiffs } from '@/lib/wordDiff'
  import { buildSplitRows } from '@/lib/diffSplit'

  export const STATUS_CHIP = {
    added: { cls: 'bg-success/15 text-success', key: 'artifact.diffView.statusAdded' },
    modified: { cls: 'bg-warning/15 text-warning', key: 'artifact.diffView.statusModified' },
    deleted: { cls: 'bg-danger/15 text-danger', key: 'artifact.diffView.statusDeleted' },
    renamed: { cls: 'bg-accent/15 text-accent', key: 'artifact.diffView.statusRenamed' },
  } as const satisfies Record<DiffFileStatus, { cls: string; key: string }>

  function lineStyle(t: DiffLineType): string { return t === 'add' ? 'bg-success/10' : t === 'del' ? 'bg-danger/10' : '' }
  function sign(t: DiffLineType): string { return t === 'add' ? '+' : t === 'del' ? '-' : ' ' }

  function HunkLines({ hunk, viewMode }: { hunk: DiffHunk; viewMode: 'unified' | 'split' }) {
    const { t } = useTranslation()
    if (viewMode === 'split') {
      const splitRows = buildSplitRows(hunk.lines)
      return (
        <>
          <div className="flex bg-surface-muted/60 text-caption text-ink-tertiary">
            <span className="shrink-0 select-none px-2 font-mono">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
            {hunk.header && <span className="truncate px-1 opacity-70">{hunk.header}</span>}
          </div>
          {splitRows.map((row, i) => (
            <div key={i} className="flex">
              <div className={cn('flex flex-1 min-w-0', row.left ? lineStyle(row.left.type) : 'bg-surface-muted/30')}>
                {row.left ? (
                  <>
                    <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{row.left.oldNo ?? ''}</span>
                    <span className={cn('w-4 shrink-0 select-none text-center', row.left.type === 'del' && 'text-danger')}>{sign(row.left.type)}</span>
                    <span className="whitespace-pre px-1 text-ink">{row.left.content}</span>
                  </>
                ) : (<span className="w-full" />)}
              </div>
              <div className="w-px shrink-0 bg-border" />
              <div className={cn('flex flex-1 min-w-0', row.right ? lineStyle(row.right.type) : 'bg-surface-muted/30')}>
                {row.right ? (
                  <>
                    <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{row.right.newNo ?? ''}</span>
                    <span className={cn('w-4 shrink-0 select-none text-center', row.right.type === 'add' && 'text-success')}>{sign(row.right.type)}</span>
                    <span className="whitespace-pre px-1 text-ink">{row.right.content}</span>
                  </>
                ) : (<span className="w-full" />)}
              </div>
            </div>
          ))}
        </>
      )
    }
    const spans = computeHunkWordDiffs(hunk.lines)
    return (
      <>
        <div className="flex bg-surface-muted/60 text-caption text-ink-tertiary">
          <span className="shrink-0 select-none px-2 font-mono">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
          {hunk.header && <span className="truncate px-1 opacity-70">{hunk.header}</span>}
        </div>
        {hunk.lines.map((line: DiffLine, i) => (
          <div key={i} className={cn('flex', lineStyle(line.type))}>
            <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.oldNo ?? ''}</span>
            <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.newNo ?? ''}</span>
            <span className={cn('w-4 shrink-0 select-none text-center', line.type === 'add' && 'text-success', line.type === 'del' && 'text-danger')}>{sign(line.type)}</span>
            {spans[i]
              ? <span className="whitespace-pre px-1 text-ink">{spans[i]!.map((sp, k) => <span key={k} className={cn(sp.changed && (line.type === 'add' ? 'bg-success/30' : 'bg-danger/30'))}>{sp.text}</span>)}</span>
              : <span className="whitespace-pre px-1 text-ink">{line.content}</span>}
            {line.noNewline && <span className="select-none px-1 text-ink-tertiary" title={t('artifact.diffView.noNewline')}>&#8626;&#824;</span>}
          </div>
        ))}
      </>
    )
  }

  function FileDiff({ file, expanded, collapsed, viewMode, onToggleCollapse, onShowFull, onCollapseFull }: {
    file: DiffFile; expanded?: DiffFile; collapsed?: boolean; viewMode: 'unified' | 'split'
    onToggleCollapse: (path: string) => void; onShowFull?: (path: string) => void; onCollapseFull?: (path: string) => void
  }) {
    const { t } = useTranslation()
    const chip = STATUS_CHIP[file.status]
    const shown = expanded ?? file
    const isExpanded = !!expanded
    const isCollapsed = !!collapsed
    return (
      <div id={`diff-file-${file.path}`} className="border-b border-border" data-testid="diff-file">
        <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-surface-muted px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <button
              aria-label={isCollapsed ? t('artifact.diffView.expand') : t('artifact.diffView.collapse')}
              onClick={() => onToggleCollapse(file.path)}
              className="shrink-0 text-ink-tertiary hover:text-ink"
              data-testid="diff-file-collapse-toggle"
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
            <span className={cn('shrink-0 rounded px-1 font-medium', chip.cls)} data-testid="diff-status">
              <span className="text-caption">{t(chip.key)}</span>
            </span>
            <span className="truncate font-mono text-meta text-ink">
              {file.oldPath && <span className="text-ink-tertiary">{file.oldPath} → </span>}{file.path}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-caption">
            {file.truncated && <span className="text-ink-tertiary">{t('artifact.truncated')}</span>}
            <span className="text-success">+{file.additions}</span>
            <span className="text-danger">-{file.deletions}</span>
          </span>
        </div>
        {!isCollapsed && (shown.binary ? (
          <div className="px-3 py-2 text-meta text-ink-tertiary">{t('artifact.diffView.binary')}</div>
        ) : shown.hunks.length === 0 ? (
          <div className="px-3 py-2 text-meta text-ink-tertiary">{t('artifact.diffView.modeOnly')}</div>
        ) : (
          <>
            <div className="overflow-x-auto font-mono text-meta leading-relaxed">
              {shown.hunks.map((h, i) => <HunkLines key={i} hunk={h} viewMode={viewMode} />)}
            </div>
            {(onShowFull || onCollapseFull) && (
              <div className="flex justify-center gap-3 border-t border-border py-1 text-caption text-ink-tertiary">
                {!isExpanded
                  ? onShowFull && <button data-testid="diff-show-full" onClick={() => onShowFull(file.path)}>{t('artifact.diffView.showFull')}</button>
                  : onCollapseFull && <button data-testid="diff-collapse-full" onClick={() => onCollapseFull(file.path)}>{t('artifact.diffView.collapseFull')}</button>}
              </div>
            )}
          </>
        ))}
      </div>
    )
  }

  export function Empty({ icon, title, desc, children }: { icon?: ReactNode; title: string; desc?: string; children?: ReactNode }) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-ink-tertiary">
        <span className="text-stat opacity-40">{icon ?? '±'}</span>
        <div className="text-body">{title}</div>
        {desc && <div className="max-w-[220px] text-center text-meta opacity-70">{desc}</div>}
        {children}
      </div>
    )
  }

  /** Pure, props-driven diff list (file jump-list + per-file hunks). Shared by Diff / Timeline / Changes. */
  export function DiffDisplay({ files, summary, viewMode, expanded, collapsed, onToggleCollapse, onShowFull, onCollapseFull }: {
    files: DiffFile[]
    summary?: DiffSummary
    viewMode: 'unified' | 'split'
    expanded?: Record<string, DiffFile>
    collapsed?: Record<string, boolean>
    onToggleCollapse: (path: string) => void
    onShowFull?: (path: string) => void
    onCollapseFull?: (path: string) => void
  }) {
    const { t } = useTranslation()
    return (
      <>
        {files.length > 1 && (
          <div className="shrink-0 border-b border-border bg-surface" data-testid="diff-file-list">
            {files.map((file) => (
              <button
                key={file.path}
                data-testid="diff-file-jump"
                onClick={() => document.getElementById(`diff-file-${file.path}`)?.scrollIntoView({ block: 'start' })}
                className="flex w-full items-center justify-between px-3 py-0.5 text-meta hover:bg-surface-muted"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn('shrink-0 rounded px-1 text-caption font-medium', STATUS_CHIP[file.status].cls)}>{t(STATUS_CHIP[file.status].key)}</span>
                  <span className="truncate font-mono text-ink-secondary">{file.path}</span>
                </span>
                <span className="shrink-0 font-mono text-caption"><span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></span>
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {files.map((file, i) => (
            <FileDiff
              key={`${file.path}-${i}`}
              file={file}
              expanded={expanded?.[file.path]}
              collapsed={collapsed?.[file.path]}
              viewMode={viewMode}
              onToggleCollapse={onToggleCollapse}
              onShowFull={onShowFull}
              onCollapseFull={onCollapseFull}
            />
          ))}
          {(summary?.totalFiles ?? 0) > files.length && (
            <div className="px-3 py-2 text-meta text-ink-tertiary">
              {t('artifact.diffView.moreFiles', { count: (summary!.totalFiles) - files.length })}
            </div>
          )}
        </div>
      </>
    )
  }

  // Re-export to keep the toolbar refresh icon import co-located for callers that compose their own header.
  export { RefreshCw }
  ```

- [ ] 14.2 Rewrite `src/components/artifact/DiffViewer.tsx` to delegate to `<DiffDisplay>` / `<Empty>` while keeping ALL state-gating (no-session/no-cwd/git-missing/not-a-repo/error/loading) + the base + view-mode + refresh toolbar. Replace the entire file body of `DiffViewer.tsx` from the imports down with:
  ```tsx
  import { useEffect } from 'react'
  import { useTranslation } from 'react-i18next'
  import { GitBranch, Loader2, RefreshCw } from 'lucide-react'
  import { cn } from '@/lib/utils'
  import { useDomainStore } from '@/domain/sessionStore'
  import { sessionService } from '@/domain/sessionService'
  import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
  import { useUiStore } from '@/store/uiStore'
  import { Button } from '@/components/ui/Button'
  import { DiffDisplay, Empty } from './DiffDisplay'

  export function DiffViewer() {
    const { t } = useTranslation()
    const sessionId = useDomainStore((s) => s.activeSessionId)
    const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
    const diffViewMode = useUiStore((s) => s.diffViewMode)
    const setDiffViewMode = useUiStore((s) => s.setDiffViewMode)

    useEffect(() => { if (sessionId) sessionService.requestDiff(sessionId) }, [sessionId])
    useEffect(() => { if (sessionId && diff.status === 'idle') sessionService.requestDiff(sessionId) }, [sessionId, diff.status])

    if (!sessionId) return <Empty title={t('artifact.diffView.noSession')} desc={t('artifact.diffView.noSessionDesc')} />
    if (diff.status !== 'ready' && !diff.state) {
      return <div className="flex h-full items-center justify-center text-ink-tertiary"><Loader2 size={16} className="animate-spin" /></div>
    }
    if (diff.state === 'no_cwd') return <Empty title={t('artifact.diffView.noCwd')} desc={t('artifact.diffView.noCwdDesc')} />
    if (diff.state === 'git_missing') return <Empty title={t('artifact.diffView.gitMissing')} desc={t('artifact.diffView.gitMissingDesc')} />
    if (diff.state === 'not_a_repo') {
      return (
        <Empty icon={<GitBranch size={24} />} title={t('artifact.diffView.notRepo')} desc={t('artifact.diffView.notRepoDesc')}>
          <Button size="sm" data-testid="diff-init" disabled={diff.initPending} onClick={() => sessionService.gitInitWorkspace(sessionId)}>
            {diff.initPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
            {t('artifact.diffView.initButton')}
          </Button>
          {diff.error && <div className="max-w-[220px] text-center text-meta text-danger">{diff.error}</div>}
        </Empty>
      )
    }
    if (diff.state === 'error') {
      return (
        <Empty title={t('artifact.diffView.error')} desc={diff.error}>
          <Button size="sm" variant="secondary" onClick={() => sessionService.requestDiff(sessionId)}>{t('artifact.diffView.retry')}</Button>
        </Empty>
      )
    }

    return (
      <div className="flex h-full flex-col" data-testid="diff-view">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
          <div className="flex items-center gap-3 text-meta text-ink-secondary">
            <span>{t('artifact.diffView.changedFiles', { count: diff.summary?.totalFiles ?? diff.files.length })}</span>
            {diff.summary && (diff.summary.totalAdditions > 0 || diff.summary.totalDeletions > 0) && (
              <span className="font-mono text-caption"><span className="text-success">+{diff.summary.totalAdditions}</span> <span className="text-danger">-{diff.summary.totalDeletions}</span></span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded border border-border text-caption" data-testid="diff-base-toggle">
              {(['session-start', 'head'] as const).map((b) => {
                const disabled = b === 'session-start' && !diff.hasSessionStart
                return (
                  <button key={b} disabled={disabled}
                    onClick={() => { if (diff.base !== b) { useDiffStore.getState().setBase(sessionId, b); sessionService.requestDiff(sessionId, b) } }}
                    className={cn('px-2 py-0.5', diff.base === b ? 'bg-accent/15 text-accent' : 'text-ink-tertiary hover:text-ink', disabled && 'cursor-not-allowed opacity-40')}>
                    {t(b === 'session-start' ? 'artifact.diffView.baseSession' : 'artifact.diffView.baseHead')}
                  </button>
                )
              })}
            </div>
            <div className="inline-flex overflow-hidden rounded border border-border text-caption" data-testid="diff-view-toggle">
              {(['unified', 'split'] as const).map((m) => (
                <button key={m} onClick={() => setDiffViewMode(m)}
                  className={cn('px-2 py-0.5', diffViewMode === m ? 'bg-accent/15 text-accent' : 'text-ink-tertiary hover:text-ink')}>
                  {t(m === 'unified' ? 'artifact.diffView.viewUnified' : 'artifact.diffView.viewSplit')}
                </button>
              ))}
            </div>
            <button title={t('artifact.refresh')} data-testid="diff-refresh" onClick={() => sessionService.requestDiff(sessionId)}
              className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink">
              <RefreshCw size={13} className={cn(diff.status === 'loading' && 'animate-spin')} />
            </button>
          </div>
        </div>
        {diff.files.length === 0 ? (
          <div data-testid="diff-clean" className="flex-1"><Empty title={t('artifact.diffView.clean')} desc={t('artifact.diffView.cleanDesc')} /></div>
        ) : (
          <DiffDisplay
            files={diff.files}
            summary={diff.summary}
            viewMode={diffViewMode}
            expanded={diff.expanded}
            collapsed={diff.collapsed}
            onToggleCollapse={(p) => useDiffStore.getState().toggleCollapsed(sessionId, p)}
            onShowFull={(p) => sessionService.requestDiffFile(sessionId, p, 'full')}
            onCollapseFull={(p) => useDiffStore.getState().collapseFile(sessionId, p)}
          />
        )}
      </div>
    )
  }
  ```
  Note: `DiffViewer` is no longer mounted by `ArtifactPanel` after Task 16 (the Diff tab is replaced by 时间线/更改). It's kept as a working component (it may still be referenced by tests / e2e) and as the canonical reference for the uncommitted-diff toolbar that `ChangesView` reuses. If a linter flags `DiffViewer` as unused after Task 16, that's acceptable for this slice; do NOT delete it (A2/e2e may use it).

- [ ] 14.3 Typecheck still pending on uiStore's removed `'diff'` literal (ArtifactPanel/sessionService). Continue.

- [ ] 14.4 Commit the diffStore (Task 13) + DiffDisplay extraction + DiffViewer refactor together:
  ```
  git add src/store/diffStore.ts src/components/artifact/DiffDisplay.tsx src/components/artifact/DiffViewer.tsx
  git commit -m "refactor(artifact): extract pure DiffDisplay; diffStore checkpoint/commitLog state

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 15 — sessionService: request methods + route the 4 server messages

This is the green point — after this task `yarn type-check` must pass (the `'diff'` literal is replaced everywhere).

**Files:**
- Modify: `src/domain/sessionService.ts` (import line 2; `receive` switch ~lines 71-92; new public methods after `gitInitWorkspace` ~line 167; `selectSession` ~line 103; `message:complete` handler ~lines 81-92)
- Test: `src/domain/sessionService.test.ts` (extend)

**Steps:**

- [ ] 15.1 Write the failing tests. In `src/domain/sessionService.test.ts`, add a new `describe` block at the end of the file (after the `workspace diff` describe's closing `})`):
  ```ts
  describe('checkpoints + commit log', () => {
    it('requestCheckpoints sends git:checkpoint:list', () => {
      const t = new FakeTransport(); const svc = new SessionService(t)
      svc.requestCheckpoints('s1')
      expect(t.sent.at(-1)).toMatchObject({ type: 'git:checkpoint:list', sessionId: 's1' })
    })

    it('git:checkpoint:list:result folds checkpoints + isGitRepo into diffStore', () => {
      const t = new FakeTransport(); new SessionService(t)
      const checkpoint = { id: 's1:t1', sessionId: 's1', turnId: 't1', kind: 'turn' as const, label: 'x', treeSha: 'tr', commitSha: 'c', branch: 'main', createdAt: 1 }
      t.push({ type: 'git:checkpoint:list:result', sessionId: 's1', checkpoints: [checkpoint], isGitRepo: true, currentBranch: 'main' })
      const s = useDiffStore.getState().bySession['s1']
      expect(s.isGitRepo).toBe(true)
      expect(s.currentBranch).toBe('main')
      expect(s.checkpoints).toHaveLength(1)
    })

    it('checkpoint:created prepends a checkpoint (dedupe by id)', () => {
      const t = new FakeTransport(); new SessionService(t)
      const checkpoint = { id: 's1:t1', sessionId: 's1', turnId: 't1', kind: 'turn' as const, label: 'x', treeSha: 'tr', commitSha: 'c', branch: 'main', createdAt: 1 }
      t.push({ type: 'checkpoint:created', sessionId: 's1', checkpoint })
      t.push({ type: 'checkpoint:created', sessionId: 's1', checkpoint }) // duplicate id
      expect(useDiffStore.getState().bySession['s1'].checkpoints).toHaveLength(1)
    })

    it('requestCheckpointDiff sets loading and sends git:checkpoint:diff; result caches by key', () => {
      const t = new FakeTransport(); const svc = new SessionService(t)
      svc.requestCheckpointDiff('s1', 's1:t1', 'this-turn')
      expect(t.sent.at(-1)).toMatchObject({ type: 'git:checkpoint:diff', sessionId: 's1', checkpointId: 's1:t1', mode: 'this-turn' })
      expect(useDiffStore.getState().bySession['s1'].checkpointDiff['s1:t1|this-turn'].status).toBe('loading')
      t.push({ type: 'git:checkpoint:diff:result', sessionId: 's1', checkpointId: 's1:t1', mode: 'this-turn', state: 'ok', files: [] })
      expect(useDiffStore.getState().bySession['s1'].checkpointDiff['s1:t1|this-turn']).toMatchObject({ status: 'ready', state: 'ok' })
    })

    it('requestCommitLog sends git:commitLog; result folds into the store', () => {
      const t = new FakeTransport(); const svc = new SessionService(t)
      svc.requestCommitLog('s1')
      expect(t.sent.at(-1)).toMatchObject({ type: 'git:commitLog', sessionId: 's1' })
      expect(useDiffStore.getState().bySession['s1'].commitLog.status).toBe('loading')
      t.push({ type: 'git:commitLog:result', sessionId: 's1', state: 'ok', commits: [{ sha: 'a', shortSha: 'a', message: 'm', author: 'me', timestamp: 1 }] })
      expect(useDiffStore.getState().bySession['s1'].commitLog).toMatchObject({ status: 'ready', state: 'ok' })
      expect(useDiffStore.getState().bySession['s1'].commitLog.commits).toHaveLength(1)
    })

    it('selectSession requests the checkpoint list', () => {
      const t = new FakeTransport(); const svc = new SessionService(t)
      svc.selectSession('s1')
      expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(true)
    })

    it('message:complete refreshes the checkpoint list', () => {
      const t = new FakeTransport(); new SessionService(t)
      t.push({ type: 'message:complete', sessionId: 's1', message: { id: 'm', role: 'assistant', content: '', timestamp: 0 } as any })
      expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(true)
    })
  })
  ```
  Also, in the existing `beforeEach` (line 34), the `useUiStore.setState({ scrollTargetMessageId: null, activeTab: 'agents' })` already resets the tab; no change needed. The existing test `message:complete refreshes the diff only while the Diff tab is active` uses `activeTab: 'diff'` — UPDATE that test (and `requestDiff sends the current store base`'s sibling) where it sets `activeTab: 'diff'` to `activeTab: 'changes'` (the uncommitted diff now lives in the 更改 tab). Find the line `useUiStore.setState({ activeTab: 'diff' })` (~line 338) and change `'diff'` → `'changes'`.

- [ ] 15.2 Run them, see them fail: `yarn vitest run src/domain/sessionService.test.ts`. Expected FAIL: `svc.requestCheckpoints is not a function`; plus the updated `message:complete` diff test now expects `'changes'` to trigger a diff refresh (which the service doesn't yet do).

- [ ] 15.3 Widen the imports. In `src/domain/sessionService.ts` line 2, change:
  ```ts
  import type { ServerMessage, SessionConfig, DiffBase } from '@hip/protocol'
  ```
  to:
  ```ts
  import type { ServerMessage, SessionConfig, DiffBase, CheckpointMode } from '@hip/protocol'
  ```

- [ ] 15.4 Route the four new server messages. In `receive` (~lines 71-92), after the `fs:gitInit:result` branch (ends ~line 80) and before the `message:complete` branch, add:
  ```ts
      } else if (msg.type === 'git:checkpoint:list:result') {
        useDiffStore.getState().setCheckpoints(msg.sessionId, msg.checkpoints, msg.isGitRepo, msg.currentBranch)
      } else if (msg.type === 'checkpoint:created') {
        useDiffStore.getState().addCheckpoint(msg.sessionId, msg.checkpoint)
      } else if (msg.type === 'git:checkpoint:diff:result') {
        useDiffStore.getState().setCheckpointDiffResult(msg.sessionId, `${msg.checkpointId}|${msg.mode}`, { state: msg.state, files: msg.files, summary: msg.summary, error: msg.error })
      } else if (msg.type === 'git:commitLog:result') {
        useDiffStore.getState().setCommitLogResult(msg.sessionId, { state: msg.state, commits: msg.commits, error: msg.error })
  ```

- [ ] 15.5 Refresh checkpoint list + the active tab's view on `message:complete`. In the `message:complete` branch (~lines 81-92), replace its tail (the diff-refresh lines):
  ```ts
        // 改完文件 → 总是刷新角标(便宜)；diff 标签激活时再拉全量
        const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
        this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
        if (useUiStore.getState().activeTab === 'diff') this.requestDiff(msg.sessionId)
  ```
  with:
  ```ts
        // 改完文件 → 总是刷新角标(便宜) + 检查点列表(新一轮可能新建了 checkpoint)。
        const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
        this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
        this.transport.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
        const tab = useUiStore.getState().activeTab
        if (tab === 'changes') { this.requestDiff(msg.sessionId); this.requestCommitLog(msg.sessionId) }
  ```

- [ ] 15.6 Fire the checkpoint list on select. In `selectSession` (~lines 103-114), after the `fs:diffSummary` send (~line 111) add:
  ```ts
      // Pull the checkpoint list (cheap; also tells the panel whether the cwd is a git repo → tab gating).
      this.transport.send({ type: 'git:checkpoint:list', sessionId: id })
  ```

- [ ] 15.7 Add the public request methods. After `gitInitWorkspace` (~line 167) add:
  ```ts
    /** Pull the checkpoint list (+ isGitRepo / current branch) for the timeline tab + tab gating. */
    requestCheckpoints(sessionId: string): void {
      this.transport.send({ type: 'git:checkpoint:list', sessionId })
    }

    /** Pull a checkpoint's diff in a given mode. Caches by `${id}|${mode}`; re-request always allowed. */
    requestCheckpointDiff(sessionId: string, checkpointId: string, mode: CheckpointMode): void {
      useDiffStore.getState().setCheckpointDiffLoading(sessionId, `${checkpointId}|${mode}`)
      this.transport.send({ type: 'git:checkpoint:diff', sessionId, checkpointId, mode })
    }

    /** Pull the session-start..HEAD commit log for the 更改 tab. */
    requestCommitLog(sessionId: string): void {
      useDiffStore.getState().setCommitLogLoading(sessionId)
      this.transport.send({ type: 'git:commitLog', sessionId })
    }
  ```

- [ ] 15.8 Run them, see them pass: `yarn vitest run src/domain/sessionService.test.ts`. Expected: the new `checkpoints + commit log` describe green, plus the updated `message:complete` diff test (now keyed on `'changes'`) green, and ALL prior tests still green.

- [ ] 15.9 Full typecheck — this is the green gate: `yarn type-check`. Expected: passes (no more `'diff'` literal references; uiStore/diffStore/sessionService/protocol all consistent).

- [ ] 15.10 Commit:
  ```
  git add src/domain/sessionService.ts src/domain/sessionService.test.ts
  git commit -m "feat(domain): checkpoint + commitLog request/route in sessionService

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 16 — checkpointMode helper (pure) + TimelineView + ChangesView + GitInitBanner + ArtifactPanel tabs

This task wires the read-only UI. It mounts the new components in the panel, gated on `isGitRepo`, and puts `GitInitBanner` in the 文件 tab.

**Files:**
- Create: `src/lib/checkpointMode.ts` (+ `.test.ts`)
- Create: `src/components/artifact/TimelineView.tsx`
- Create: `src/components/artifact/ChangesView.tsx`
- Create: `src/components/artifact/GitInitBanner.tsx`
- Modify: `src/components/artifact/ArtifactPanel.tsx`
- Test: `src/lib/checkpointMode.test.ts` (pure unit test). UI rendering = manual GUI.

**Steps:**

- [ ] 16.1 Write the failing pure-helper test. Create `src/lib/checkpointMode.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import type { Checkpoint } from '@hip/protocol'
  import { checkpointModeOptions } from './checkpointMode'

  const turnCp: Checkpoint = { id: 's:1', sessionId: 's', turnId: '1', kind: 'turn', label: 'x', treeSha: 't', commitSha: 'c', branch: 'main', createdAt: 1 }
  const startCp: Checkpoint = { ...turnCp, id: 's:start', turnId: null, kind: 'start', label: null }

  describe('checkpointModeOptions', () => {
    it('offers all three modes for a turn checkpoint', () => {
      expect(checkpointModeOptions(turnCp)).toEqual(['this-turn', 'since-then', 'since-start'])
    })
    it('omits this-turn for the session-start checkpoint (#0 has no previous turn)', () => {
      expect(checkpointModeOptions(startCp)).toEqual(['since-then', 'since-start'])
    })
  })
  ```

- [ ] 16.2 Run it, see it fail: `yarn vitest run src/lib/checkpointMode.test.ts`. Expected FAIL: `Cannot find module './checkpointMode'`.

- [ ] 16.3 Create `src/lib/checkpointMode.ts`:
  ```ts
  import type { Checkpoint, CheckpointMode } from '@hip/protocol'

  /** Which diff modes a checkpoint offers. The session-start checkpoint (#0) has no previous turn,
   *  so it omits 'this-turn'. */
  export function checkpointModeOptions(cp: Checkpoint): CheckpointMode[] {
    return cp.kind === 'start'
      ? ['since-then', 'since-start']
      : ['this-turn', 'since-then', 'since-start']
  }
  ```

- [ ] 16.4 Run it, see it pass: `yarn vitest run src/lib/checkpointMode.test.ts`. Expected: both tests green.

- [ ] 16.5 Create `src/components/artifact/GitInitBanner.tsx`:
  ```tsx
  import { GitBranch, Loader2 } from 'lucide-react'
  import { useTranslation } from 'react-i18next'
  import { useDomainStore } from '@/domain/sessionStore'
  import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
  import { sessionService } from '@/domain/sessionService'
  import { Button } from '@/components/ui/Button'

  /** Thin banner shown in the 文件 tab when the cwd is not a git repo. Reuses fs:gitInit. */
  export function GitInitBanner() {
    const { t } = useTranslation()
    const sessionId = useDomainStore((s) => s.activeSessionId)
    const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
    if (!sessionId) return null
    return (
      <div className="flex items-center gap-3 border-b border-border bg-surface-muted/60 px-3 py-2">
        <GitBranch size={16} className="shrink-0 text-ink-tertiary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-meta text-ink">{t('artifact.gitInitBanner.title')}</div>
          <div className="truncate text-caption text-ink-tertiary">{t('artifact.gitInitBanner.desc')}</div>
        </div>
        <Button size="sm" disabled={diff.initPending} onClick={() => sessionService.gitInitWorkspace(sessionId)}>
          {diff.initPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
          {t('artifact.gitInitBanner.button')}
        </Button>
      </div>
    )
  }
  ```

- [ ] 16.6 Create `src/components/artifact/TimelineView.tsx`. Checkpoint list (newest-first) + per-checkpoint mode toggle + inline `<DiffDisplay>`. On mount/session-change, request the checkpoint list; on row select or mode change, request the checkpoint diff:
  ```tsx
  import { useEffect } from 'react'
  import { useTranslation } from 'react-i18next'
  import { GitCommit, Loader2 } from 'lucide-react'
  import { cn } from '@/lib/utils'
  import { useDomainStore } from '@/domain/sessionStore'
  import { sessionService } from '@/domain/sessionService'
  import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
  import { useUiStore } from '@/store/uiStore'
  import { formatRelativeTime } from '@/lib/datetime'
  import { checkpointModeOptions } from '@/lib/checkpointMode'
  import { DiffDisplay, Empty } from './DiffDisplay'

  const MODE_KEY = { 'this-turn': 'artifact.timelineView.modeThisTurn', 'since-then': 'artifact.timelineView.modeSinceThen', 'since-start': 'artifact.timelineView.modeSinceStart' } as const

  export function TimelineView() {
    const { t, i18n } = useTranslation()
    const sessionId = useDomainStore((s) => s.activeSessionId)
    const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
    const diffViewMode = useUiStore((s) => s.diffViewMode)
    const mode = useUiStore((s) => s.checkpointMode)
    const setMode = useUiStore((s) => s.setCheckpointMode)

    // Mount === tab activation (Radix unmounts inactive tabs). Pull the list.
    useEffect(() => { if (sessionId) sessionService.requestCheckpoints(sessionId) }, [sessionId])

    const active = diff.checkpoints.find((c) => c.id === diff.activeCheckpointId) ?? diff.checkpoints[0]
    const activeId = active?.id ?? null

    // The active checkpoint may not offer the current mode (#0 has no 'this-turn') → fall back.
    const options = active ? checkpointModeOptions(active) : []
    const effectiveMode = active && options.includes(mode) ? mode : options[0]

    // Fetch the active checkpoint's diff for the effective mode (cache-aware: only when missing).
    useEffect(() => {
      if (!sessionId || !activeId || !effectiveMode) return
      const key = `${activeId}|${effectiveMode}`
      if (!diff.checkpointDiff[key]) sessionService.requestCheckpointDiff(sessionId, activeId, effectiveMode)
    }, [sessionId, activeId, effectiveMode, diff.checkpointDiff])

    if (!sessionId) return <Empty title={t('artifact.diffView.noSession')} desc={t('artifact.diffView.noSessionDesc')} />
    if (diff.checkpoints.length === 0) return <Empty icon={<GitCommit size={24} />} title={t('artifact.timelineView.empty')} desc={t('artifact.timelineView.emptyDesc')} />

    const key = activeId && effectiveMode ? `${activeId}|${effectiveMode}` : ''
    const cur = key ? diff.checkpointDiff[key] : undefined

    return (
      <div className="flex h-full flex-col" data-testid="timeline-view">
        {/* checkpoint list */}
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border">
          {diff.checkpoints.map((c, idx) => {
            const turnNo = diff.checkpoints.length - 1 - idx // oldest = #0; list is newest-first
            const label = c.kind === 'start' ? t('artifact.timelineView.sessionStart') : (c.label || t('artifact.timelineView.turn', { n: turnNo }))
            return (
              <button key={c.id} data-testid="timeline-row"
                onClick={() => useDiffStore.getState().setActiveCheckpoint(sessionId, c.id)}
                className={cn('flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-meta hover:bg-surface-muted', c.id === activeId && 'bg-accent/10')}>
                <span className="min-w-0 truncate text-ink">{label}</span>
                <span className="shrink-0 text-caption text-ink-tertiary">{formatRelativeTime(c.createdAt, i18n.language)}</span>
              </button>
            )
          })}
        </div>
        {/* mode toggle */}
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
          <div className="inline-flex overflow-hidden rounded border border-border text-caption" data-testid="timeline-mode-toggle">
            {options.map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={cn('px-2 py-0.5', m === effectiveMode ? 'bg-accent/15 text-accent' : 'text-ink-tertiary hover:text-ink')}>
                {t(MODE_KEY[m])}
              </button>
            ))}
          </div>
        </div>
        {/* diff */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!cur || cur.status === 'loading' ? (
            <div className="flex h-full items-center justify-center text-ink-tertiary"><Loader2 size={16} className="animate-spin" /></div>
          ) : (cur.files?.length ?? 0) === 0 ? (
            <Empty title={t('artifact.timelineView.noChange')} />
          ) : (
            <DiffDisplay
              files={cur.files!}
              summary={cur.summary}
              viewMode={diffViewMode}
              onToggleCollapse={() => {}}
            />
          )}
        </div>
      </div>
    )
  }
  ```
  Note: TimelineView intentionally has NO 回退 (revert) button (slice A2). `onToggleCollapse={() => {}}` — collapse/show-full are not wired for the checkpoint diff in A1 (the checkpoint diff result is whole-file already; per-file expand is a Diff-tab feature). The full-file expand callbacks are omitted (no `onShowFull`/`onCollapseFull`), so `DiffDisplay` renders no footer for these.

- [ ] 16.7 Create `src/components/artifact/ChangesView.tsx`. Reuses the existing uncommitted `fs:diff` flow on top (via `requestDiff` + `DiffDisplay`) and the commit log below:
  ```tsx
  import { useEffect } from 'react'
  import { useTranslation } from 'react-i18next'
  import { GitBranch, GitCommit, Loader2 } from 'lucide-react'
  import { useDomainStore } from '@/domain/sessionStore'
  import { sessionService } from '@/domain/sessionService'
  import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
  import { useUiStore } from '@/store/uiStore'
  import { formatRelativeTime } from '@/lib/datetime'
  import { DiffDisplay, Empty } from './DiffDisplay'
  import { Button } from '@/components/ui/Button'

  export function ChangesView() {
    const { t, i18n } = useTranslation()
    const sessionId = useDomainStore((s) => s.activeSessionId)
    const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
    const diffViewMode = useUiStore((s) => s.diffViewMode)

    useEffect(() => {
      if (!sessionId) return
      sessionService.requestDiff(sessionId)
      sessionService.requestCommitLog(sessionId)
    }, [sessionId])

    if (!sessionId) return <Empty title={t('artifact.diffView.noSession')} desc={t('artifact.diffView.noSessionDesc')} />

    // Reuse the existing not-a-repo / git-missing / no-cwd states for the uncommitted half.
    if (diff.state === 'no_cwd') return <Empty title={t('artifact.diffView.noCwd')} desc={t('artifact.diffView.noCwdDesc')} />
    if (diff.state === 'git_missing') return <Empty title={t('artifact.diffView.gitMissing')} desc={t('artifact.diffView.gitMissingDesc')} />
    if (diff.state === 'not_a_repo') {
      return (
        <Empty icon={<GitBranch size={24} />} title={t('artifact.diffView.notRepo')} desc={t('artifact.diffView.notRepoDesc')}>
          <Button size="sm" disabled={diff.initPending} onClick={() => sessionService.gitInitWorkspace(sessionId)}>
            {diff.initPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
            {t('artifact.diffView.initButton')}
          </Button>
        </Empty>
      )
    }

    const log = diff.commitLog
    return (
      <div className="flex h-full flex-col" data-testid="changes-view">
        {/* uncommitted (top) */}
        <div className="flex min-h-0 flex-[3] flex-col border-b border-border">
          <div className="flex h-8 shrink-0 items-center px-3 text-meta text-ink-secondary">{t('artifact.changesView.uncommitted')}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {diff.status !== 'ready' && !diff.state ? (
              <div className="flex h-full items-center justify-center text-ink-tertiary"><Loader2 size={16} className="animate-spin" /></div>
            ) : diff.files.length === 0 ? (
              <Empty title={t('artifact.diffView.clean')} desc={t('artifact.diffView.cleanDesc')} />
            ) : (
              <DiffDisplay
                files={diff.files}
                summary={diff.summary}
                viewMode={diffViewMode}
                expanded={diff.expanded}
                collapsed={diff.collapsed}
                onToggleCollapse={(p) => useDiffStore.getState().toggleCollapsed(sessionId, p)}
                onShowFull={(p) => sessionService.requestDiffFile(sessionId, p, 'full')}
                onCollapseFull={(p) => useDiffStore.getState().collapseFile(sessionId, p)}
              />
            )}
          </div>
        </div>
        {/* commit log (bottom) — read-only */}
        <div className="flex min-h-0 flex-[2] flex-col">
          <div className="flex h-8 shrink-0 items-center px-3 text-meta text-ink-secondary">{t('artifact.changesView.commitLog')}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {log.status === 'loading' ? (
              <div className="flex h-full items-center justify-center text-ink-tertiary"><Loader2 size={16} className="animate-spin" /></div>
            ) : log.state && log.state !== 'ok' ? (
              <Empty title={t('artifact.changesView.commitLogError')} desc={log.error} />
            ) : log.commits.length === 0 ? (
              <Empty icon={<GitCommit size={24} />} title={t('artifact.changesView.noCommits')} />
            ) : (
              <ul>
                {log.commits.map((c) => (
                  <li key={c.sha} className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-meta" data-testid="commit-row">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-caption text-ink-tertiary">{c.shortSha}</span>
                      <span className="min-w-0 truncate text-ink">{c.message}</span>
                    </span>
                    <span className="shrink-0 text-caption text-ink-tertiary">{c.author} · {formatRelativeTime(c.timestamp, i18n.language)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    )
  }
  ```

- [ ] 16.8 Rewrite `src/components/artifact/ArtifactPanel.tsx` to host the four tabs with git-gating + GitInitBanner. Replace the file:
  ```tsx
  import { X } from 'lucide-react'
  import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
  import { useTranslation } from 'react-i18next'
  import type { ArtifactTab } from '@/store/uiStore'
  import { useUiStore } from '@/store/uiStore'
  import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
  import { Button } from '@/components/ui/Button'
  import { FileTree } from './FileTree'
  import { FilePreview } from './FilePreview'
  import { AgentDashboard } from './AgentDashboard'
  import { TimelineView } from './TimelineView'
  import { ChangesView } from './ChangesView'
  import { GitInitBanner } from './GitInitBanner'
  import { useDomainStore } from '@/domain/sessionStore'
  import { useDiffStore } from '@/store/diffStore'

  export function ArtifactPanel() {
    const { t } = useTranslation()
    const activeTab = useUiStore((s) => s.activeTab)
    const setTab = useUiStore((s) => s.setTab)
    const togglePanel = useUiStore((s) => s.togglePanel)
    const sid = useDomainStore((s) => s.activeSessionId)
    const isGitRepo = useDiffStore((s) => (sid ? s.bySession[sid]?.isGitRepo : false)) ?? false
    const diffCount = useDiffStore((s) => (sid ? s.bySession[sid]?.summary?.totalFiles : 0)) ?? 0

    // Git-gated tabs only appear in a git repo. The two always-on tabs are 文件 / 智能体.
    const TABS: { value: ArtifactTab; label: string; gated?: boolean; badge?: number }[] = [
      { value: 'files', label: t('artifact.files') },
      { value: 'agents', label: t('artifact.agents') },
      { value: 'timeline', label: t('artifact.timeline'), gated: true },
      { value: 'changes', label: t('artifact.changes'), gated: true, badge: diffCount },
    ]
    const visible = TABS.filter((tab) => !tab.gated || isGitRepo)
    // If the active tab got gated out (cwd changed to a non-repo), fall back to 文件.
    const effectiveTab = visible.some((tab) => tab.value === activeTab) ? activeTab : 'files'

    return (
      <div className="h-full animate-panel-in bg-surface">
        <Tabs value={effectiveTab} onValueChange={(v) => setTab(v as ArtifactTab)} className="flex h-full flex-col">
          <div data-tauri-drag-region className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
            <TabsList className="h-full gap-4" data-tauri-drag-region="false">
              {visible.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-${tab.value}`}>
                  {tab.label}
                  {tab.value === 'changes' && (tab.badge ?? 0) > 0 && (
                    <span data-testid="changes-badge" className="ml-1.5 rounded-full bg-accent/15 px-1.5 text-caption text-accent">{tab.badge}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <Button variant="ghost" size="icon" onClick={togglePanel} title={t('artifact.closePanel')} data-tauri-drag-region="false">
              <X size={16} />
            </Button>
          </div>

          <TabsContent value="files" className="overflow-hidden p-0">
            <div className="flex h-full flex-col">
              {!isGitRepo && <GitInitBanner />}
              <PanelGroup direction="horizontal" className="min-h-0 flex-1">
                <Panel defaultSize={42} minSize={24}><FileTree /></Panel>
                <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
                  <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
                </PanelResizeHandle>
                <Panel minSize={30}><FilePreview /></Panel>
              </PanelGroup>
            </div>
          </TabsContent>
          <TabsContent value="agents" className="p-3"><AgentDashboard /></TabsContent>
          {isGitRepo && <TabsContent value="timeline" className="p-0"><TimelineView /></TabsContent>}
          {isGitRepo && <TabsContent value="changes" className="p-0"><ChangesView /></TabsContent>}
        </Tabs>
      </div>
    )
  }
  ```
  Note: the default `activeTab` in `uiStore` is `'agents'` (unchanged). The panel now needs `isGitRepo` populated — `selectSession` (Task 15.6) and `message:complete` (Task 15.5) both fire `git:checkpoint:list`, whose result sets `isGitRepo`. On the very first panel-open with no select yet, the tabs show only 文件/智能体 until the list arrives (acceptable; the list is requested on session select).

- [ ] 16.9 Typecheck: `yarn type-check`. Expected: passes. (`ArtifactPanel` no longer imports `DiffViewer`; `DiffViewer` + `DiffDisplay` still compile.)

- [ ] 16.10 Run the two affected unit suites to confirm nothing regressed: `yarn vitest run src/lib/checkpointMode.test.ts` and `yarn vitest run src/domain/sessionService.test.ts`. Expected: both green.

- [ ] 16.11 Commit:
  ```
  git add src/lib/checkpointMode.ts src/lib/checkpointMode.test.ts src/components/artifact/TimelineView.tsx src/components/artifact/ChangesView.tsx src/components/artifact/GitInitBanner.tsx src/components/artifact/ArtifactPanel.tsx
  git commit -m "feat(artifact): timeline + changes tabs (read-only), git-gated; init banner in files

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 17 — full-suite verification (paid-free)

**Files:** none (verification only)

**Steps:**

- [ ] 17.1 Guard against paid tests: move the API-key file aside so no real-LLM suite can fire even if a path is fat-fingered.
  ```
  test -f ~/.hip/config/auth.json && mv ~/.hip/config/auth.json ~/.hip/config/auth.json.bak || echo "no auth.json — already paid-free"
  ```

- [ ] 17.2 Run the full test suite: `yarn test`. Expected: all suites green. Real-LLM suites `skipIf`-skip (no key). If any non-LLM suite fails, fix it before proceeding (use superpowers:systematic-debugging).

- [ ] 17.3 Restore the key file:
  ```
  test -f ~/.hip/config/auth.json.bak && mv ~/.hip/config/auth.json.bak ~/.hip/config/auth.json || echo "nothing to restore"
  ```

- [ ] 17.4 Final typecheck: `yarn type-check`. Expected: passes.

- [ ] 17.5 Confirm the working tree is clean and all commits landed: `git status` (clean) and `git log --oneline -12` (the A1 commits in order).

---

## Manual GUI Acceptance

Run the app (`yarn tauri dev` or the project's launch skill) with a real DeepSeek-compatible key configured. Bind a project folder that IS a git repo with at least one commit.

- [ ] Open the right panel. With a git-repo cwd, the tabs show **文件 · 智能体 · 时间线 · 更改**. With a non-repo cwd, only **文件 · 智能体** show, and the 文件 tab shows the **GitInitBanner** at the top.
- [ ] Click the init banner's button in a non-repo cwd → `git init` + baseline commit runs; the panel re-pulls and the **时间线 / 更改** tabs appear.
- [ ] Send a turn that edits a file. After it completes, open **时间线**: a new checkpoint row appears at the top (newest-first) with a label derived from the reply and a relative timestamp.
- [ ] In **时间线**, select a turn checkpoint → the mode toggle shows **本轮 / 自此至今 / 起点至今**; **本轮** shows exactly what that turn changed.
- [ ] Select the bottom-most checkpoint (**会话起点 / session start**) → the mode toggle shows only **自此至今 / 起点至今** (no 本轮).
- [ ] Switch modes on a turn checkpoint: **自此至今** = changes from that turn to now; **起点至今** = changes from session start to now. Each mode renders without a full reload (cached per mode).
- [ ] A turn that makes NO file changes does NOT add a checkpoint row (empty-turn skip).
- [ ] Open **更改**: the top shows uncommitted changes (same rendering as the old Diff tab — file jump-list, hunks, +/-, expand/collapse, show-full), and the **更改 badge** reflects the changed-file count.
- [ ] The bottom of **更改** shows a read-only **提交记录** list (session-start → HEAD), newest-first, with short sha + message + author + relative time. There are NO commit/stage buttons.
- [ ] In a session with no commits since start, the commit log shows the empty state (无提交).
- [ ] Switch UI language (简体 / English / 繁體) → all timeline/changes/init-banner labels translate; no raw i18n keys appear.
- [ ] Switch the cwd to a non-repo folder mid-session → the 时间线/更改 tabs disappear; if one was active, the panel falls back to 文件 with the init banner.
- [ ] Confirm HEAD never moved: in a terminal, `git rev-parse HEAD` before and after several turns is unchanged (checkpoints live only on `refs/hip/checkpoints/...`); `git for-each-ref refs/hip/checkpoints` lists the per-turn refs.
- [ ] No revert button exists anywhere in 时间线 (that is slice A2).
