# Light Git Panel Writes — Revert + Branch + Agent Git Tools (Slice A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the git panel *write*: per-turn **回退 (revert)** with a mandatory pre-revert safety checkpoint (exact worktree restore, never `reset --hard`), **branch awareness** (list + switch with a safety confirm + cross-branch revert warning), and three **agent git tools** (`git_commit`, `git_create_branch`, `git_switch_branch`) so the agent commits proactively. The 更改 tab's commit log now populates from `git log session_start_commit..HEAD`.

**Architecture:** Builds directly on **Slice A1** (checkpoints table v8, `captureCheckpoint`/`collectWorkspaceDiff(headSha?)`/`getCurrentBranch`/`listCheckpointRefs`/`collectCommitLog`, `TimelineView`/`ChangesView`/`DiffDisplay`, `diffStore` checkpoint state, `sessionService.requestCheckpoints/requestCheckpointDiff/requestCommitLog`). Borrows Zed's `restore_archive_checkpoint` model — `read-tree <targetTree>` into a temp index → `checkout-index -f -a` → delete worktree files absent from `git ls-tree -r --name-only <targetTree>` — guarded by an A1 `captureCheckpoint` pre-revert safety commit that MUST succeed first. Branch + commit operations are plain `runGit` helpers. The three agent tools are `tool()` defs registered in `buildTools()` that round-trip the **existing** LangGraph `toolsNode` — **no graph or model-runner changes**.

**Tech Stack:** TypeScript monorepo — `@hip/protocol` (shared IPC types) ⇄ `@hip/sidecar` (Node, shells to the `git` CLI via `execFile`; LangGraph ReAct agent + `tool()` defs) ⇄ React/TS frontend (zustand stores, react-i18next typed i18n, Radix `Modal`/`DropdownMenu`).

**Save target path:** `docs/superpowers/plans/2026-06-13-gitpanel-a2-writes.md`

**Design spec:** `docs/superpowers/specs/2026-06-13-gitpanel-checkpoints-artifacts-design.md` (§3.3, §3.4, §6, §8 A2, §9, §10)

---

## Prerequisite — Slice A1 must be landed first

This plan **depends on** A1's contracts existing in the tree. Before starting, confirm they are present (these greps must each return ≥1 hit):
```
grep -n "captureCheckpoint" packages/sidecar/src/session/workspace-git.ts
grep -n "headSha" packages/sidecar/src/session/workspace-git.ts
grep -n "collectCommitLog" packages/sidecar/src/session/workspace-git.ts
grep -n "getCurrentBranch" packages/sidecar/src/session/workspace-git.ts
grep -n "CheckpointMode" packages/protocol/src/index.ts
grep -n "requestCheckpointDiff" src/domain/sessionService.ts
grep -n "TimelineView" src/components/artifact/ArtifactPanel.tsx
grep -n "getSessionGitMeta" packages/sidecar/src/persistence/store.ts
```
If any return nothing, STOP and land A1 first — A2 reuses these names verbatim.

---

## Cross-plan locked interfaces (A2 owns these; A1 already shipped the rest)

- **protocol** types A2 adds: `Branch` (`{ name: string; current: boolean }`). Client msgs A2 ships: `git:branch:list`, `git:branch:switch {branch}`, `git:revert {checkpointId}`. Server msgs A2 ships: `git:branch:list:result`, `git:branch:switch:result`, `git:revert:result`. (A1 owns `Checkpoint`, `CommitLogEntry`, `CheckpointMode`, and the `git:checkpoint:*`/`git:commitLog`/`checkpoint:created` messages.)
- **workspace-git.ts** fns A2 adds: `revertToCheckpoint`, `listBranches`, `switchBranch`, `gitCommit`, `gitCreateBranch`, `gitSwitchBranch`.
- **session.ts** A2 adds: `revertCheckpoint(checkpointId, send)`, `listBranches()`, `switchBranch(branch)` read/write methods.
- **session-manager.ts** A2 routes: `git:branch:list`, `git:branch:switch`, `git:revert`.
- **tools.ts** A2 adds: `git_commit`/`git_create_branch`/`git_switch_branch` `tool()` defs gated on a real cwd.
- **system-prompt.ts** A2 adds: a proactive-commit + branch guidance paragraph after the cwd block, before `ANTI_PHANTOM`.
- **frontend:** `diffStore` gains `branches` + revert/branch action setters; `sessionService.requestBranches/switchBranch/revertCheckpoint`; `TimelineView` gains a 回退 button + confirm `Modal`; new `BranchSwitcher.tsx`; new i18n `artifact.timelineView.revert*` / `artifact.branch.*` keys.

---

## File Structure

**CREATE**
- `src/components/artifact/BranchSwitcher.tsx` — panel-header current-branch chip + branch dropdown + a switch-confirm `Modal`; reads `diffStore.currentBranch`/`branches`; calls `sessionService.requestBranches`/`switchBranch`.

**MODIFY**
- `packages/protocol/src/index.ts` — add `Branch`; 3 client msgs + 3 server msgs.
- `packages/sidecar/src/session/workspace-git.ts` — `revertToCheckpoint`, `listBranches`, `switchBranch`, `gitCommit`, `gitCreateBranch`, `gitSwitchBranch`.
- `packages/sidecar/src/session/tools.ts` — register `git_commit`/`git_create_branch`/`git_switch_branch` (gated on a real cwd via a new `cwd` param).
- `packages/sidecar/src/session/session.ts` — pass cwd into `buildTools`; add `revertCheckpoint`/`listBranches`/`switchBranch` methods.
- `packages/sidecar/src/session/session-manager.ts` — route `git:branch:list`, `git:branch:switch`, `git:revert`.
- `packages/sidecar/src/session/system-prompt.ts` — proactive-commit + branch guidance paragraph.
- `src/store/diffStore.ts` — add `branches` to `SessionDiff` + `EMPTY_DIFF`; `setBranches` setter (revert/switch reuse A1's `setCheckpoints`/`addCheckpoint`/`setCommitLogResult`).
- `src/domain/sessionService.ts` — `requestBranches`, `switchBranch(branch)`, `revertCheckpoint(checkpointId)`; route the 3 new server msgs.
- `src/components/artifact/TimelineView.tsx` — add a 回退 button to each turn row + a confirm `Modal`; show a cross-branch warning when `cp.branch !== currentBranch`.
- `src/components/artifact/ArtifactPanel.tsx` — mount `<BranchSwitcher>` in the panel header (visible only when `isGitRepo`).
- `src/i18n/zh-CN.ts` · `en.ts` · `zh-TW.ts` — `artifact.timelineView.revert*` + `artifact.branch.*` keys.

**TEST FILES** (mirror existing harnesses exactly)
- `packages/sidecar/src/session/workspace-git.test.ts` (extend) — temp-dir real git repos via `makeRepo` + the `git()` helper.
- `packages/sidecar/src/session/tools.test.ts` (extend) — `buildTools(root, undefined, root)` over a temp-dir real git repo (commit tool needs a repo).
- `packages/sidecar/src/session/system-prompt.test.ts` (extend) — string assertions.
- `src/domain/sessionService.test.ts` (extend) — `FakeTransport` harness.

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
- **subagent-git-checkout trap:** the branch/commit/revert helpers mutate a *real* git checkout. Tests ALWAYS run them against a fresh temp-dir repo (`makeRepo(root)`), NEVER against this project's checkout. After any git-capable subagent finishes, verify `git branch --show-current` is still `main`. Reviewers must use `git diff base...HEAD` WITHOUT switching branches.
- Commit message trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## TASK 1 — protocol: Branch type + branch/revert messages

**Files:**
- Modify: `packages/protocol/src/index.ts` (types after A1's `CheckpointMode` ~line 134 of the spec mapping; in the actual file, after the A1-added `Checkpoint`/`CommitLogEntry`/`CheckpointMode` block which sits just after `DiffSummary` at line 158; `ClientMessage` union; `ServerMessage` union)
- Test: none (pure type additions; verified by `yarn type-check` and downstream tasks compile)

**Steps:**

- [ ] 1.1 Add the `Branch` type. In `packages/protocol/src/index.ts`, find A1's `export type CheckpointMode = 'this-turn' | 'since-then' | 'since-start'` line (added by A1 right after `DiffSummary`). Immediately after that line, insert:
  ```ts
  /** One branch in the repo, with a flag for the checked-out one. */
  export interface Branch { name: string; current: boolean }
  ```

- [ ] 1.2 Add the client messages. In the `ClientMessage` union, after A1's `| { type: 'git:commitLog'; sessionId: string }` line, append:
  ```ts
    | { type: 'git:branch:list'; sessionId: string }
    | { type: 'git:branch:switch'; sessionId: string; branch: string }
    | { type: 'git:revert'; sessionId: string; checkpointId: string }
  ```

- [ ] 1.3 Add the server messages. In the `ServerMessage` union, after A1's `| { type: 'checkpoint:created'; sessionId: string; checkpoint: Checkpoint }` line, append:
  ```ts
    | { type: 'git:branch:list:result'; sessionId: string; branches: Branch[]; currentBranch: string | null }
    | { type: 'git:branch:switch:result'; sessionId: string; branch: string; ok: boolean; currentBranch: string | null; error?: string }
    | { type: 'git:revert:result'; sessionId: string; checkpointId: string; ok: boolean; safetyCheckpointId?: string; error?: string }
  ```

- [ ] 1.4 Typecheck: `yarn type-check`. Expected: passes (pure additions; no failures on a clean post-A1 tree).

- [ ] 1.5 Commit:
  ```
  git add packages/protocol/src/index.ts
  git commit -m "feat(protocol): Branch type + git:branch:list/switch + git:revert messages

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 2 — workspace-git: listBranches + switchBranch

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts` (add after A1's `collectCommitLog`; import `Branch` from `@hip/protocol`)
- Test: `packages/sidecar/src/session/workspace-git.test.ts` (extend; import + new describe)

**Steps:**

- [ ] 2.1 Write the failing test. In `packages/sidecar/src/session/workspace-git.test.ts`, extend the import on line 7 to add `listBranches, switchBranch` (the line already lists A1's exports; append these two before `MAX_DIFF_LINES_PER_FILE`):
  ```ts
  import { parseUnifiedDiff, collectWorkspaceDiff, collectWorkspaceDiffSummary, collectWorkspaceDiffFile, gitInit, captureSessionSnapshot, sanitizeRefComponent, getCurrentBranch, listCheckpointRefs, captureCheckpoint, collectCommitLog, listBranches, switchBranch, MAX_DIFF_LINES_PER_FILE, MAX_DIFF_FILES } from './workspace-git.js'
  ```
  (If A1's import line differs in ordering, just ensure `listBranches` and `switchBranch` are added to it.) Then add a new `describe` block at the end of the file (after the last `})`):
  ```ts
  describe('listBranches + switchBranch', () => {
    it('lists branches with the current one flagged', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      await git(root, 'branch', '-m', 'main')
      await git(root, 'branch', 'feature')
      const r = await listBranches(root)
      expect(r.ok).toBe(true)
      expect(r.branches!.map((b) => b.name).sort()).toEqual(['feature', 'main'])
      expect(r.branches!.find((b) => b.name === 'main')!.current).toBe(true)
      expect(r.branches!.find((b) => b.name === 'feature')!.current).toBe(false)
    })
    it('switches to an existing branch (HEAD moves, never throws)', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      await git(root, 'branch', '-m', 'main')
      await git(root, 'branch', 'feature')
      const r = await switchBranch(root, 'feature')
      expect(r.ok).toBe(true)
      expect(await getCurrentBranch(root)).toBe('feature')
    })
    it('returns ok:false with an error switching to a missing branch', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      const r = await switchBranch(root, 'does-not-exist')
      expect(r.ok).toBe(false)
      expect(r.error).toBeTruthy()
    })
    it('listBranches returns ok:false for a non-repo folder', async () => {
      expect((await listBranches(root)).ok).toBe(false)
    })
  })
  ```

- [ ] 2.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected FAIL: `listBranches is not a function`.

- [ ] 2.3 Add the `Branch` type import. At the top of `packages/sidecar/src/session/workspace-git.ts`, A1 changed line 6's protocol import to add `CommitLogEntry`. Extend it to also import `Branch`:
  ```ts
  import type { DiffFile, DiffHunk, DiffFileStatus, DiffState, DiffSummary, DiffBase, CommitLogEntry, Branch } from '@hip/protocol'
  ```

- [ ] 2.4 Implement. Append after A1's `collectCommitLog` function (end of file region):
  ```ts
  /** List local branches with the current one flagged. Never throws → { ok:false } on a non-repo. */
  export async function listBranches(cwd: string, gitBin = 'git'): Promise<{ ok: boolean; branches?: Branch[]; error?: string }> {
    try {
      await fs.stat(cwd)
      await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
    } catch { return { ok: false, error: 'not_a_repo' } }
    try {
      // %(HEAD) = '*' for the checked-out branch, ' ' otherwise. %(refname:short) = bare branch name.
      const out = (await runGit(cwd, ['for-each-ref', '--format=%(HEAD)%09%(refname:short)', 'refs/heads/'], gitBin)).stdout
      const branches: Branch[] = []
      for (const ln of out.split('\n')) {
        if (!ln.trim()) continue
        const [flag, name] = ln.split('\t')
        if (!name) continue
        branches.push({ name, current: flag === '*' })
      }
      return { ok: true, branches }
    } catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
  }

  /** Switch the checkout to an existing branch. `git switch` with a `checkout` fallback for old git.
   *  Never throws → { ok:false, error } (e.g. a dirty tree that would be overwritten, or a missing branch). */
  export async function switchBranch(cwd: string, name: string, gitBin = 'git'): Promise<{ ok: boolean; error?: string }> {
    try { await runGit(cwd, ['switch', name], gitBin); return { ok: true } }
    catch {
      try { await runGit(cwd, ['checkout', name], gitBin); return { ok: true } }
      catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
    }
  }
  ```

- [ ] 2.5 Run it, see it pass: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected: the new `listBranches + switchBranch` block green; the rest of the suite still green.

- [ ] 2.6 Commit:
  ```
  git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
  git commit -m "feat(sidecar): listBranches + switchBranch

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 3 — workspace-git: gitCommit / gitCreateBranch / gitSwitchBranch (agent tool fns)

The three helpers the agent tools call. `gitCommit` resolves the author: read user `git config user.name`/`user.email`; if both present, commit as the user with a `\n\nCo-authored-by: hip <hip@local>` trailer; else `-c user.name=hip -c user.email=hip@local`. Always `-c commit.gpgsign=false … --no-verify`; `git add -A` first; read back HEAD sha.

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts` (add after `switchBranch`)
- Test: `packages/sidecar/src/session/workspace-git.test.ts` (extend; import + new describe)

**Steps:**

- [ ] 3.1 Write the failing tests. Extend the import on line 7 to add `gitCommit, gitCreateBranch, gitSwitchBranch`. Add a new `describe` block at the end of the file:
  ```ts
  describe('gitCommit', () => {
    it('stages everything and commits, returning the new HEAD sha', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
      await fs.writeFile(path.join(root, 'b.txt'), 'new\n')
      const r = await gitCommit(root, 'do a thing')
      expect(r.ok).toBe(true)
      expect(r.sha).toMatch(/^[0-9a-f]{40}$/)
      expect((await git(root, 'rev-parse', 'HEAD')).stdout.trim()).toBe(r.sha)
      expect((await git(root, 'log', '-1', '--format=%s')).stdout.trim()).toBe('do a thing')
      // working tree is now clean (everything was staged + committed)
      expect((await git(root, 'status', '--porcelain')).stdout.trim()).toBe('')
    })
    it('uses the user git identity + a Co-authored-by: hip trailer when user identity is configured', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      await git(root, 'config', 'user.name', 'Ada')
      await git(root, 'config', 'user.email', 'ada@example.com')
      await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
      const r = await gitCommit(root, 'real work')
      expect(r.ok).toBe(true)
      expect((await git(root, 'log', '-1', '--format=%an')).stdout.trim()).toBe('Ada')
      expect((await git(root, 'log', '-1', '--format=%ae')).stdout.trim()).toBe('ada@example.com')
      expect((await git(root, 'log', '-1', '--format=%b')).stdout).toContain('Co-authored-by: hip <hip@local>')
    })
    it('falls back to the synthetic hip identity when no user identity is configured', async () => {
      // a repo with NO user.name/user.email set locally
      await git(root, 'init')
      await git(root, 'config', '--unset-all', 'user.name').catch(() => {})
      await git(root, 'config', '--unset-all', 'user.email').catch(() => {})
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
      const r = await gitCommit(root, 'first')
      expect(r.ok).toBe(true)
      expect((await git(root, 'log', '-1', '--format=%an')).stdout.trim()).toBe('hip')
      expect((await git(root, 'log', '-1', '--format=%ae')).stdout.trim()).toBe('hip@local')
      // no Co-authored-by trailer in the synthetic-identity path
      expect((await git(root, 'log', '-1', '--format=%b')).stdout).not.toContain('Co-authored-by')
    })
    it('returns ok:false with an error for a non-repo folder', async () => {
      const r = await gitCommit(root, 'x')
      expect(r.ok).toBe(false)
      expect(r.error).toBeTruthy()
    })
  })

  describe('gitCreateBranch + gitSwitchBranch (tool helpers)', () => {
    it('creates a branch without switching to it', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      await git(root, 'branch', '-m', 'main')
      const r = await gitCreateBranch(root, 'feature')
      expect(r.ok).toBe(true)
      expect(await getCurrentBranch(root)).toBe('main') // still on main
      const list = await listBranches(root)
      expect(list.branches!.map((b) => b.name).sort()).toEqual(['feature', 'main'])
    })
    it('gitSwitchBranch moves HEAD to an existing branch', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      await git(root, 'branch', '-m', 'main')
      await git(root, 'branch', 'feature')
      const r = await gitSwitchBranch(root, 'feature')
      expect(r.ok).toBe(true)
      expect(await getCurrentBranch(root)).toBe('feature')
    })
    it('gitCreateBranch returns ok:false for a duplicate branch name', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      await git(root, 'branch', '-m', 'main')
      await git(root, 'branch', 'feature')
      const r = await gitCreateBranch(root, 'feature')
      expect(r.ok).toBe(false)
      expect(r.error).toBeTruthy()
    })
  })
  ```

- [ ] 3.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected FAIL: `gitCommit is not a function`.

- [ ] 3.3 Implement. Append after `switchBranch`:
  ```ts
  /** Read a local git config value (e.g. user.name). Returns '' when unset. Never throws. */
  async function gitConfigGet(cwd: string, gitBin: string, key: string): Promise<string> {
    try { return (await runGit(cwd, ['config', '--get', key], gitBin)).stdout.trim() }
    catch { return '' }
  }

  /** Stage everything (`git add -A`) and commit. Identity: use the user's git config (user.name +
   *  user.email) plus a `Co-authored-by: hip <hip@local>` trailer when both are present; otherwise
   *  commit with the synthetic `hip <hip@local>` identity (no trailer). Always commit.gpgsign=false
   *  + --no-verify so a user's hooks/signing never block an agent commit. Reads back HEAD for the sha.
   *  Never throws → { ok:false, error }. */
  export async function gitCommit(cwd: string, message: string, gitBin = 'git'): Promise<{ ok: boolean; sha?: string; error?: string }> {
    try {
      await fs.stat(cwd)
      await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
    } catch { return { ok: false, error: 'not_a_repo' } }
    try {
      await runGit(cwd, ['add', '-A'], gitBin)
      const name = await gitConfigGet(cwd, gitBin, 'user.name')
      const email = await gitConfigGet(cwd, gitBin, 'user.email')
      const hasUser = !!name && !!email
      const fullMessage = hasUser ? `${message}\n\nCo-authored-by: hip <hip@local>` : message
      const identityArgs = hasUser
        ? ['-c', 'commit.gpgsign=false']
        : ['-c', 'user.name=hip', '-c', 'user.email=hip@local', '-c', 'commit.gpgsign=false']
      await runGit(cwd, [...identityArgs, 'commit', '-m', fullMessage, '--no-verify'], gitBin)
      const sha = (await runGit(cwd, ['rev-parse', 'HEAD'], gitBin)).stdout.trim()
      return { ok: true, sha }
    } catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
  }

  /** Create a branch at HEAD without switching to it. Never throws → { ok:false, error }. */
  export async function gitCreateBranch(cwd: string, name: string, gitBin = 'git'): Promise<{ ok: boolean; error?: string }> {
    try { await runGit(cwd, ['branch', name], gitBin); return { ok: true } }
    catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
  }

  /** Switch to an existing branch (agent tool path). Thin alias over switchBranch so the tool and
   *  the panel share one implementation. */
  export async function gitSwitchBranch(cwd: string, name: string, gitBin = 'git'): Promise<{ ok: boolean; error?: string }> {
    return switchBranch(cwd, name, gitBin)
  }
  ```

- [ ] 3.4 Run it, see it pass: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected: the new `gitCommit` and `gitCreateBranch + gitSwitchBranch` blocks green; whole file green.

- [ ] 3.5 Commit:
  ```
  git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
  git commit -m "feat(sidecar): gitCommit (user identity + hip trailer) + gitCreateBranch/gitSwitchBranch

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 4 — workspace-git: revertToCheckpoint (mandatory safety checkpoint → exact restore)

The heart of A2. Restore the worktree to a checkpoint's tree WITHOUT moving HEAD/index/branches:
1. **Mandatory** pre-revert safety checkpoint via A1's `captureCheckpoint` — must succeed (or the empty-turn skip, which means nothing to lose); if `captureCheckpoint` returns `ok:false`, ABORT.
2. `git read-tree <targetTree>` into a temp index (`GIT_INDEX_FILE`).
3. `git checkout-index -f -a` (writes tracked content from that index).
4. Delete files present in the worktree but **absent** from `git ls-tree -r --name-only <targetTree>` (the set-difference; the only data-loss surface — hence step 1 is mandatory).
**Never** `git reset --hard`. Must work on an unborn-HEAD repo too.

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts` (add a `RevertResult` type near A1's `CaptureResult`; add `revertToCheckpoint` after `gitSwitchBranch`)
- Test: `packages/sidecar/src/session/workspace-git.test.ts` (extend; import + new describe)

**Steps:**

- [ ] 4.1 Write the failing tests. Extend the import on line 7 to add `revertToCheckpoint`. Add a new `describe` at the end of the file:
  ```ts
  describe('revertToCheckpoint', () => {
    it('restores the exact tree of a checkpoint (overwrites edits, deletes files added after)', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
      // checkpoint captures the state "a.txt = two"
      await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
      const cap = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'edit', prevCommit: head })
      expect(cap.ok && cap.treeSha).toBeTruthy()
      // drift AFTER the checkpoint: change a.txt + add a brand-new file
      await fs.writeFile(path.join(root, 'a.txt'), 'three\n')
      await fs.writeFile(path.join(root, 'extra.txt'), 'added later\n')
      const r = await revertToCheckpoint(root, { sessionId: 's1', targetTree: cap.treeSha!, prevCommit: cap.commitSha! })
      expect(r.ok).toBe(true)
      expect(r.safetyCheckpointId).toBeTruthy()
      expect(await fs.readFile(path.join(root, 'a.txt'), 'utf8')).toBe('two\n') // restored
      await expect(fs.access(path.join(root, 'extra.txt'))).rejects.toThrow() // deleted (absent in target tree)
    })
    it('writes a mandatory pre-revert safety checkpoint ref before restoring', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
      await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
      const cap = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'edit', prevCommit: head })
      await fs.writeFile(path.join(root, 'a.txt'), 'three\n') // dirty so the safety checkpoint is non-empty
      const r = await revertToCheckpoint(root, { sessionId: 's1', targetTree: cap.treeSha!, prevCommit: cap.commitSha! })
      expect(r.ok).toBe(true)
      // the safety checkpoint id is "<sessionId>:<turnId>"; its ref must exist
      const turnId = r.safetyCheckpointId!.split(':').slice(1).join(':')
      const refs = await listCheckpointRefs(root, 's1')
      expect(refs.some((ref) => ref.endsWith('/' + sanitizeRefComponent(turnId)))).toBe(true)
    })
    it('NEVER moves HEAD (revert is worktree-only)', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
      await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
      const cap = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'edit', prevCommit: head })
      await fs.writeFile(path.join(root, 'a.txt'), 'three\n')
      await revertToCheckpoint(root, { sessionId: 's1', targetTree: cap.treeSha!, prevCommit: cap.commitSha! })
      expect((await git(root, 'rev-parse', 'HEAD')).stdout.trim()).toBe(head) // HEAD unchanged
    })
    it('works on an unborn-HEAD repo (fresh git init, checkpoint #0 has no commit ancestry)', async () => {
      await git(root, 'init')
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
      const cap = await captureCheckpoint(root, { sessionId: 's1', turnId: 'start', label: null, prevCommit: null })
      expect(cap.ok && cap.treeSha).toBeTruthy()
      await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
      await fs.writeFile(path.join(root, 'b.txt'), 'extra\n')
      const r = await revertToCheckpoint(root, { sessionId: 's1', targetTree: cap.treeSha!, prevCommit: cap.commitSha! })
      expect(r.ok).toBe(true)
      expect(await fs.readFile(path.join(root, 'a.txt'), 'utf8')).toBe('one\n')
      await expect(fs.access(path.join(root, 'b.txt'))).rejects.toThrow()
    })
    it('returns ok:false for a non-repo folder', async () => {
      const r = await revertToCheckpoint(root, { sessionId: 's1', targetTree: 'deadbeef', prevCommit: null })
      expect(r.ok).toBe(false)
    })
  })
  ```

- [ ] 4.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected FAIL: `revertToCheckpoint is not a function`.

- [ ] 4.3 Add the result/options types. In `packages/sidecar/src/session/workspace-git.ts`, after A1's `CaptureResult` interface, insert:
  ```ts
  export interface RevertOptions { sessionId: string; targetTree: string; prevCommit: string | null; gitBin?: string }
  export interface RevertResult { ok: boolean; safetyCheckpointId?: string; error?: string }
  ```

- [ ] 4.4 Implement `revertToCheckpoint`. Append after `gitSwitchBranch`:
  ```ts
  /** Exact worktree restore to a checkpoint's tree, Zed-style and hardened. NEVER touches HEAD/index/
   *  branches. Steps: (1) MANDATORY pre-revert safety checkpoint via captureCheckpoint — must succeed
   *  (or be a clean empty-turn skip) or we abort before deleting anything; (2) read-tree targetTree into
   *  a temp index; (3) checkout-index -f -a writes the tracked content; (4) delete worktree files absent
   *  from `git ls-tree -r --name-only targetTree` (the set-difference — the only data-loss surface).
   *  Never `reset --hard`. Never throws → { ok:false, error }. */
  export async function revertToCheckpoint(cwd: string, opts: RevertOptions): Promise<RevertResult> {
    const gitBin = opts.gitBin ?? 'git'
    try {
      await fs.stat(cwd)
      await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
    } catch { return { ok: false, error: 'not_a_repo' } }

    // (1) Mandatory pre-revert safety checkpoint. A monotonic turnId keeps refs unique across reverts.
    const safetyTurnId = `pre-revert-${Date.now()}`
    const safety = await captureCheckpoint(cwd, { sessionId: opts.sessionId, turnId: safetyTurnId, label: 'pre-revert safety', prevCommit: opts.prevCommit, gitBin })
    if (!safety.ok) return { ok: false, error: 'safety checkpoint failed: ' + (safety.error ?? 'unknown') }
    const safetyCheckpointId = `${opts.sessionId}:${safetyTurnId}`

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-revert-'))
    const idx = path.join(dir, 'index')
    try {
      // (2) read the target tree into a temp index (real index untouched).
      const env = { ...process.env, GIT_INDEX_FILE: idx }
      const runIdx = (args: string[]) => execFileP(gitBin, args, { cwd, env, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER })
      await runIdx(['read-tree', opts.targetTree])
      // (3) write the tracked content from that index into the worktree.
      await runIdx(['checkout-index', '-f', '-a'])

      // (4) delete worktree files absent from the target tree (set-difference).
      const wantOut = (await runGit(cwd, ['ls-tree', '-r', '--name-only', opts.targetTree], gitBin)).stdout
      const want = new Set(wantOut.split('\n').map((l) => l.trim()).filter(Boolean))
      // Enumerate the worktree's tracked + untracked files (respecting .gitignore: ignored files stay).
      const haveOut = (await runGit(cwd, ['ls-files', '--cached', '--others', '--exclude-standard'], gitBin)).stdout
      const have = haveOut.split('\n').map((l) => l.trim()).filter(Boolean)
      for (const rel of have) {
        if (!want.has(rel)) await fs.rm(path.join(cwd, rel), { force: true }).catch(() => {})
      }
      return { ok: true, safetyCheckpointId }
    } catch (e) {
      return { ok: false, safetyCheckpointId, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
  ```
  Note: `ls-files --others --exclude-standard` lists untracked-but-not-ignored files, so the set-difference deletes exactly the files added after the checkpoint without nuking `.gitignore`d artifacts (node_modules etc.). `checkout-index -f -a` only writes files in the target tree; files removed in the target tree (and tracked in HEAD) are deleted by step 4 too because `ls-files --cached` lists them.

- [ ] 4.5 Run it, see it pass: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected: the `revertToCheckpoint` block green; whole file green (run it all to confirm no regression in the A1 capture tests).

- [ ] 4.6 Commit:
  ```
  git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
  git commit -m "feat(sidecar): revertToCheckpoint — safety checkpoint + exact tree restore (no reset --hard)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 5 — tools.ts: git_commit / git_create_branch / git_switch_branch (cwd-gated)

Register three `tool()` defs. They need the absolute `cwd` to run against. `buildTools` currently takes `(root, spawnSubagent?)` — add a third optional `cwd` param; register the git tools only when `cwd` is a real path. Handlers return a string (`"committed <shortSha>"` / `"Error: …"`) so they round-trip the existing LangGraph `toolsNode` — no graph changes.

**Files:**
- Modify: `packages/sidecar/src/session/tools.ts` (signature ~line 31; import the workspace-git fns; register the 3 tools before the final `return`)
- Test: `packages/sidecar/src/session/tools.test.ts` (extend; import + new describe over a temp-dir real git repo)

**Steps:**

- [ ] 5.1 Write the failing tests. In `packages/sidecar/src/session/tools.test.ts`, extend the imports (top) to add real-git helpers and a `byNameCwd` helper. After the existing imports add:
  ```ts
  import { execFile } from 'node:child_process'
  import { promisify } from 'node:util'
  const execFileP = promisify(execFile)
  const git = (cwd: string, ...args: string[]) => execFileP('git', args, { cwd })
  async function makeRepo(dir: string): Promise<void> {
    await git(dir, 'init')
    await git(dir, 'add', '-A')
    await git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init', '--allow-empty')
    await git(dir, 'branch', '-m', 'main')
  }
  function byNameCwd(root: string, name: string) {
    return buildTools(root, undefined, root).find((t) => t.name === name)!
  }
  ```
  Then add a new `describe` at the end of the file:
  ```ts
  describe('git tools (cwd-gated)', () => {
    it('buildTools(root) WITHOUT a cwd has no git tools', () => {
      const names = buildTools(root).map((t) => t.name)
      expect(names).not.toContain('git_commit')
      expect(names).not.toContain('git_create_branch')
      expect(names).not.toContain('git_switch_branch')
    })

    it('buildTools(root, undefined, cwd) registers the three git tools', () => {
      const names = buildTools(root, undefined, root).map((t) => t.name)
      expect(names).toEqual(expect.arrayContaining(['git_commit', 'git_create_branch', 'git_switch_branch']))
    })

    it('git_commit stages + commits and returns a short-sha confirmation', async () => {
      await makeRepo(root)
      writeFileSync(join(root, 'x.txt'), 'hi')
      const out = String(await byNameCwd(root, 'git_commit').invoke({ message: 'add x' }))
      expect(out).toMatch(/committed [0-9a-f]{7}/)
      expect((await git(root, 'log', '-1', '--format=%s')).stdout.trim()).toBe('add x')
    })

    it('git_commit returns an Error string when there is nothing to commit', async () => {
      await makeRepo(root) // clean tree, nothing staged
      const out = String(await byNameCwd(root, 'git_commit').invoke({ message: 'noop' }))
      expect(out).toMatch(/^Error:/)
    })

    it('git_create_branch creates a branch without switching', async () => {
      await makeRepo(root)
      const out = String(await byNameCwd(root, 'git_create_branch').invoke({ branchName: 'feature' }))
      expect(out).toMatch(/feature/)
      expect((await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()).toBe('main')
    })

    it('git_switch_branch moves HEAD to an existing branch', async () => {
      await makeRepo(root)
      await git(root, 'branch', 'feature')
      const out = String(await byNameCwd(root, 'git_switch_branch').invoke({ branchName: 'feature' }))
      expect(out).toMatch(/feature/)
      expect((await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()).toBe('feature')
    })

    it('git_switch_branch returns an Error string for a missing branch', async () => {
      await makeRepo(root)
      const out = String(await byNameCwd(root, 'git_switch_branch').invoke({ branchName: 'nope' }))
      expect(out).toMatch(/^Error:/)
    })
  })
  ```

- [ ] 5.2 Run them, see them fail: `yarn vitest run packages/sidecar/src/session/tools.test.ts`. Expected FAIL: `buildTools(...).find(...)` returns undefined for `git_commit` → `Cannot read properties of undefined (reading 'invoke')` (because the 3rd `cwd` arg isn't supported yet).

- [ ] 5.3 Import the workspace-git fns. In `packages/sidecar/src/session/tools.ts`, after the existing imports (line 6 `import { resolveWithin } from './workspace-fs.js'`), add:
  ```ts
  import { gitCommit, gitCreateBranch, gitSwitchBranch } from './workspace-git.js'
  ```

- [ ] 5.4 Add the `cwd` param and register the git tools. In `buildTools`, change the signature (~line 31-34):
  ```ts
  export function buildTools(
    root: string,
    spawnSubagent?: (description: string) => Promise<string>,
  ): StructuredToolInterface[] {
  ```
  to:
  ```ts
  export function buildTools(
    root: string,
    spawnSubagent?: (description: string) => Promise<string>,
    cwd?: string,
  ): StructuredToolInterface[] {
  ```
  Then, just before the final `return` block (the section that today reads `const base = [writeFile, readFile, editFile, ls, glob, grep, writeTodos]` ~line 208), add the git tools and fold them into `base` when `cwd` is set. Replace:
  ```ts
    const base = [writeFile, readFile, editFile, ls, glob, grep, writeTodos]
    if (!spawnSubagent) return base
  ```
  with:
  ```ts
    const base: StructuredToolInterface[] = [writeFile, readFile, editFile, ls, glob, grep, writeTodos]

    // Git tools are registered only for a real on-disk cwd (a git repo). They run against `cwd`
    // (the bound project root), NOT the file-tool sandbox `root` — same dir in practice, but explicit.
    if (cwd) {
      const gitCommitTool = tool(
        async ({ message }) => {
          const r = await gitCommit(cwd, message)
          return r.ok ? `committed ${(r.sha ?? '').slice(0, 7)}` : `Error: ${r.error ?? 'commit failed'}`
        },
        {
          name: 'git_commit',
          description:
            'Stage all changes and create a git commit with the given one-line `message`. Use ' +
            'proactively after completing a coherent unit of work (not per file). Returns "committed <sha>" ' +
            'or an error.',
          schema: z.object({ message: z.string() }),
        },
      )
      const gitCreateBranchTool = tool(
        async ({ branchName }) => {
          const r = await gitCreateBranch(cwd, branchName)
          return r.ok ? `created branch ${branchName}` : `Error: ${r.error ?? 'create branch failed'}`
        },
        {
          name: 'git_create_branch',
          description: 'Create a new git branch named `branchName` at the current HEAD (does not switch to it).',
          schema: z.object({ branchName: z.string() }),
        },
      )
      const gitSwitchBranchTool = tool(
        async ({ branchName }) => {
          const r = await gitSwitchBranch(cwd, branchName)
          return r.ok ? `switched to ${branchName}` : `Error: ${r.error ?? 'switch branch failed'}`
        },
        {
          name: 'git_switch_branch',
          description: 'Switch the checkout to an existing git branch named `branchName`.',
          schema: z.object({ branchName: z.string() }),
        },
      )
      base.push(gitCommitTool, gitCreateBranchTool, gitSwitchBranchTool)
    }

    if (!spawnSubagent) return base
  ```
  (The existing `task` tool block and `return [...base, task]` at the end stay unchanged — `task` is still appended after the git tools.)

- [ ] 5.5 Run them, see them pass: `yarn vitest run packages/sidecar/src/session/tools.test.ts`. Expected: the new `git tools (cwd-gated)` block green; all existing file-tool + task-gating tests still green (the new optional 3rd param is backward-compatible — `byName(root, name)` calls `buildTools(root)` with no cwd, so no git tools leak into those assertions).

- [ ] 5.6 Commit:
  ```
  git add packages/sidecar/src/session/tools.ts packages/sidecar/src/session/tools.test.ts
  git commit -m "feat(sidecar): git_commit/git_create_branch/git_switch_branch agent tools (cwd-gated)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 6 — session.ts: pass cwd into buildTools; revert/branch read-write methods

`buildTools` is called once per turn in `runTurn` (~line 542) as `buildTools(cwd, spawnSubagent)`. Pass the real cwd through so the git tools register. Then add the panel-facing `revertCheckpoint`/`listBranches`/`switchBranch` methods. After a successful revert, re-checkpoint so the timeline shows the post-revert state (the safety checkpoint is already on the ref chain from `revertToCheckpoint`).

**Files:**
- Modify: `packages/sidecar/src/session/session.ts` (the `const tools = buildTools(cwd, spawnSubagent)` line ~542; add public methods after A1's `commitLog()` method)
- Test: none directly (the git plumbing is unit-tested; routing covered by Task 7 + manual GUI). Verified via `yarn type-check` + the session suite.

**Steps:**

- [ ] 6.1 Pass cwd into `buildTools`. In `packages/sidecar/src/session/session.ts`, the `runTurn` method has `const cwd = this._config.cwd ?? process.cwd()` (~line 499) and later `const tools = buildTools(cwd, spawnSubagent)` (~line 542). Change that line to:
  ```ts
      const tools = buildTools(cwd, spawnSubagent, this._config.cwd)
  ```
  Note: passing `this._config.cwd` (not the `cwd` fallback) means the git tools register only when the session is bound to a REAL project dir, never for a pure-chat session running in `process.cwd()`. This matches the spec's "agent commits only in a real repo" intent.

- [ ] 6.2 Add the revert/branch methods. A1 added `commitLog()` after its `checkpointDiff`/`listCheckpoints` methods (around `workspaceGitInit`). Immediately after A1's `commitLog()` method, insert:
  ```ts
    /** Revert the worktree to a checkpoint's tree (worktree-only; HEAD untouched). Writes a mandatory
     *  pre-revert safety checkpoint first, persists it + a post-revert checkpoint, and re-emits the
     *  checkpoint list so the timeline reflects both. Never throws. */
    async revertCheckpoint(checkpointId: string, send: SendFn): Promise<{ ok: boolean; safetyCheckpointId?: string; error?: string }> {
      if (!this._config.cwd) return { ok: false, error: 'no_workspace' }
      const all = this.store?.listCheckpoints(this.id) ?? []
      const cp = all.find((c) => c.id === checkpointId)
      if (!cp) return { ok: false, error: 'checkpoint not found' }
      const r = await workspaceGit.revertToCheckpoint(this._config.cwd, {
        sessionId: this.id, targetTree: cp.treeSha, prevCommit: this._lastCheckpointCommit ?? cp.commitSha,
      })
      if (!r.ok) return r
      // Persist the pre-revert safety checkpoint that revertToCheckpoint just wrote on the ref chain.
      if (r.safetyCheckpointId) {
        const turnId = r.safetyCheckpointId.split(':').slice(1).join(':')
        // Resolve the safety ref's commit + tree directly so we store accurate shas.
        const meta = await workspaceGit.checkpointRefMeta(this._config.cwd, this.id, turnId)
        if (meta) {
          const safety = { id: r.safetyCheckpointId, sessionId: this.id, turnId, kind: 'pre-revert' as const, label: 'pre-revert safety', treeSha: meta.treeSha, commitSha: meta.commitSha, branch: meta.branch, createdAt: Date.now() }
          this.store?.insertCheckpoint(safety)
          this._lastCheckpointCommit = meta.commitSha
          send({ type: 'checkpoint:created', sessionId: this.id, checkpoint: safety })
        }
      }
      return r
    }

    /** List branches (+ current). For the panel's BranchSwitcher. Never throws. */
    async listBranches(): Promise<{ branches: import('@hip/protocol').Branch[]; currentBranch: string | null }> {
      if (!this._config.cwd) return { branches: [], currentBranch: null }
      const r = await workspaceGit.listBranches(this._config.cwd)
      const currentBranch = await workspaceGit.getCurrentBranch(this._config.cwd)
      return { branches: r.branches ?? [], currentBranch }
    }

    /** Switch the checkout to a branch (panel path). Records the new branch on the session. Never throws. */
    async switchBranch(branch: string): Promise<{ ok: boolean; currentBranch: string | null; error?: string }> {
      if (!this._config.cwd) return { ok: false, currentBranch: null, error: 'no_workspace' }
      const r = await workspaceGit.switchBranch(this._config.cwd, branch)
      const currentBranch = await workspaceGit.getCurrentBranch(this._config.cwd)
      if (r.ok) this.store?.setSessionBranch(this.id, currentBranch)
      return { ok: r.ok, currentBranch, error: r.error }
    }
  ```
  This references the `workspaceGit.checkpointRefMeta` helper added in step 6.3 (cleaner than re-deriving shas inline).

- [ ] 6.3 Add the `checkpointRefMeta` helper to workspace-git. In `packages/sidecar/src/session/workspace-git.ts`, append after `revertToCheckpoint`:
  ```ts
  /** Resolve a checkpoint ref's commit sha, tree sha, and branch (at the ref commit). Used to persist the
   *  pre-revert safety checkpoint after revertToCheckpoint wrote it. Returns null if the ref is missing. */
  export async function checkpointRefMeta(cwd: string, sessionId: string, turnId: string, gitBin = 'git'): Promise<{ commitSha: string; treeSha: string; branch: string | null } | null> {
    const ref = `refs/hip/checkpoints/${sanitizeRefComponent(sessionId)}/${sanitizeRefComponent(turnId)}`
    try {
      const commitSha = (await runGit(cwd, ['rev-parse', ref], gitBin)).stdout.trim()
      const treeSha = (await runGit(cwd, ['rev-parse', `${ref}^{tree}`], gitBin)).stdout.trim()
      const branch = await getCurrentBranch(cwd, gitBin)
      return { commitSha, treeSha, branch }
    } catch { return null }
  }
  ```

- [ ] 6.4 Add a unit test for `checkpointRefMeta` (keeps the helper TDD-covered). In `packages/sidecar/src/session/workspace-git.test.ts`, add `checkpointRefMeta` to the import on line 7, then add a small `describe` at the end:
  ```ts
  describe('checkpointRefMeta', () => {
    it('resolves a checkpoint ref to its commit + tree shas', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
      await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
      const cap = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'x', prevCommit: head })
      const meta = await checkpointRefMeta(root, 's1', 't1')
      expect(meta).not.toBeNull()
      expect(meta!.commitSha).toBe(cap.commitSha)
      expect(meta!.treeSha).toBe(cap.treeSha)
    })
    it('returns null for a missing ref', async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
      expect(await checkpointRefMeta(root, 's1', 'nope')).toBeNull()
    })
  })
  ```

- [ ] 6.5 Run the workspace-git suite: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`. Expected: `checkpointRefMeta` block green; whole file green.

- [ ] 6.6 Typecheck: `yarn type-check`. Expected: passes. (If the inline `import('@hip/protocol').Branch` form feels inconsistent with A1's choice, match A1: if A1 added `Checkpoint, CommitLogEntry, CheckpointMode` to the top-of-file `import type { … } from '@hip/protocol'` on line 1, add `Branch` there too and use the bare `Branch` name. Otherwise keep the inline form.)

- [ ] 6.7 Run the session suite to confirm no regressions: `yarn vitest run packages/sidecar/src/session/session.test.ts`. Expected: all existing session tests green (the new `buildTools` 3rd arg only registers tools for a real cwd; injected-model session tests typically have no real cwd, so the git tools are absent and nothing changes).

- [ ] 6.8 Commit:
  ```
  git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
  git commit -m "feat(sidecar): wire git tools to cwd; revert/branch session methods + checkpointRefMeta

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 7 — session-manager: route git:branch:list / git:branch:switch / git:revert

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts` (add cases in `handleAsync` after A1's `git:commitLog` case)
- Test: none (routing exercised by manual GUI + the underlying unit tests). Verified via `yarn type-check`.

**Steps:**

- [ ] 7.1 Add the three cases. In `packages/sidecar/src/session/session-manager.ts`, inside `handleAsync`'s `switch`, after A1's `case 'git:commitLog': { … break }` block (before the closing `}` of the switch), add:
  ```ts
        case 'git:branch:list': {
          const r = await this.ensureSession(msg.sessionId).listBranches()
          send({ type: 'git:branch:list:result', sessionId: msg.sessionId, branches: r.branches, currentBranch: r.currentBranch })
          break
        }
        case 'git:branch:switch': {
          const r = await this.ensureSession(msg.sessionId).switchBranch(msg.branch)
          send({ type: 'git:branch:switch:result', sessionId: msg.sessionId, branch: msg.branch, ok: r.ok, currentBranch: r.currentBranch, ...(r.error ? { error: r.error } : {}) })
          break
        }
        case 'git:revert': {
          const r = await this.ensureSession(msg.sessionId).revertCheckpoint(msg.checkpointId, send)
          send({ type: 'git:revert:result', sessionId: msg.sessionId, checkpointId: msg.checkpointId, ok: r.ok, ...(r.safetyCheckpointId ? { safetyCheckpointId: r.safetyCheckpointId } : {}), ...(r.error ? { error: r.error } : {}) })
          break
        }
  ```

- [ ] 7.2 Typecheck: `yarn type-check`. Expected: passes (the `ClientMessage`/`ServerMessage` unions from Task 1 cover these).

- [ ] 7.3 Commit:
  ```
  git add packages/sidecar/src/session/session-manager.ts
  git commit -m "feat(sidecar): route git:branch:list/switch + git:revert

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 8 — system-prompt: proactive-commit + branch guidance

**Files:**
- Modify: `packages/sidecar/src/session/system-prompt.ts` (add a `GIT_GUIDANCE` constant; inject it into `buildSystemPrompt` after the cwd block, before `ANTI_PHANTOM`)
- Test: `packages/sidecar/src/session/system-prompt.test.ts` (extend)

**Steps:**

- [ ] 8.1 Write the failing test. In `packages/sidecar/src/session/system-prompt.test.ts`, add to the existing `describe('buildSystemPrompt', …)` block (before its closing `})`):
  ```ts
    it('includes proactive-commit + branch guidance for the git tools', () => {
      const s = buildSystemPrompt({ cwd: '/tmp/proj' })
      expect(s).toMatch(/git_commit/)
      expect(s).toMatch(/git_create_branch/)
      expect(s).toMatch(/git_switch_branch/)
      expect(s).toMatch(/proactively|after a coherent unit/i)
    })

    it('orders git guidance after the cwd block and before the anti-phantom rule', () => {
      const s = buildSystemPrompt({ cwd: '/tmp/proj' })
      const cwdIdx = s.indexOf('working directory')
      const gitIdx = s.indexOf('git_commit')
      const antiIdx = s.indexOf('MUST NOT claim')
      expect(cwdIdx).toBeGreaterThanOrEqual(0)
      expect(gitIdx).toBeGreaterThan(cwdIdx)
      expect(antiIdx).toBeGreaterThan(gitIdx)
    })
  ```

- [ ] 8.2 Run it, see it fail: `yarn vitest run packages/sidecar/src/session/system-prompt.test.ts`. Expected FAIL: `expect(s).toMatch(/git_commit/)` — the prompt has no git guidance.

- [ ] 8.3 Add the `GIT_GUIDANCE` constant. In `packages/sidecar/src/session/system-prompt.ts`, after the `ANTI_PHANTOM` constant (lines 1-4), add:
  ```ts
  const GIT_GUIDANCE =
    'When the project is a git repository you also have git tools — git_commit, git_create_branch, ' +
    'git_switch_branch. Commit proactively after a coherent unit of work with a concise one-line ' +
    'message (under 72 characters, imperative mood). Group related edits into a single commit — do not ' +
    'commit after every individual file write. Use git_create_branch / git_switch_branch only when the ' +
    'work warrants a separate line of history (e.g. an experimental or large refactor). These tools ' +
    'commit on the user\'s behalf, so keep messages clear and the history clean.'
  ```

- [ ] 8.4 Inject it into `buildSystemPrompt`. Change the `base` assembly line (~line 41):
  ```ts
    const base = `${IDENTITY}\n\n${BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}`
  ```
  to:
  ```ts
    const base = `${IDENTITY}\n\n${BASE}\n\n${cwdBlock(cwd)}\n\n${GIT_GUIDANCE}\n\n${ANTI_PHANTOM}`
  ```
  Note: `childSystemPrompt` (sub-agents) deliberately does NOT get the git guidance — sub-agents have no git tools (only the supervisor's `buildTools` receives the cwd; sub-agents run via `runSubagent` with their own tool set). Leave `childSystemPrompt` unchanged.

- [ ] 8.5 Run it, see it pass: `yarn vitest run packages/sidecar/src/session/system-prompt.test.ts`. Expected: all `buildSystemPrompt` tests green (including the existing ordering-agnostic ones) and the new git-guidance + ordering tests green; `childSystemPrompt` tests still green.

- [ ] 8.6 Commit:
  ```
  git add packages/sidecar/src/session/system-prompt.ts packages/sidecar/src/session/system-prompt.test.ts
  git commit -m "feat(sidecar): system-prompt proactive-commit + branch guidance

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 9 — i18n keys: revert + branch (all three locales)

A1 added an `artifact.timelineView.*` block and `artifact.changesView.*`/`artifact.gitInitBanner.*`. A2 adds revert keys under `timelineView` and a new `branch` block.

**Files:**
- Modify: `src/i18n/zh-CN.ts` (the TYPE SOURCE — inside `artifact.timelineView` add revert keys; add an `artifact.branch` block)
- Modify: `src/i18n/en.ts` (same)
- Modify: `src/i18n/zh-TW.ts` (same)
- Test: none (typed i18n; `yarn type-check` is the gate after Task 11)

**Steps:**

- [ ] 9.1 Add revert keys + a branch block to `src/i18n/zh-CN.ts`. Inside the A1-added `timelineView: { … }` object (under `artifact`), add these keys (place them after A1's `turn: '第 {{n}} 轮',` line, before `timelineView`'s closing `},`):
  ```ts
          revert: '回退到此处',
          revertConfirmTitle: '回退到此检查点？',
          revertConfirmBody: '工作区将精确恢复到这一刻的状态。回退前会自动创建一个安全检查点，因此此操作本身可被撤销。',
          revertConfirmAction: '回退',
          reverting: '回退中…',
          revertFailed: '回退失败',
          crossBranchWarn: '此检查点是在分支「{{branch}}」上创建的，与当前分支不同。',
  ```
  Then, immediately after the `timelineView: { … }` object's closing `},` (still inside `artifact`), add a sibling `branch` block:
  ```ts
        branch: {
          current: '当前分支',
          noBranch: '（无分支）',
          switchTitle: '切换分支',
          switchConfirmTitle: '切换到分支「{{branch}}」？',
          switchConfirmBody: '将切换 git 检出到该分支。未提交的改动可能会被覆盖，请先确认。',
          switchConfirmAction: '切换',
          switching: '切换中…',
          switchFailed: '切换分支失败',
        },
  ```

- [ ] 9.2 Add the SAME keys to `src/i18n/en.ts` at the matching locations:
  Inside `timelineView`:
  ```ts
          revert: 'Revert to here',
          revertConfirmTitle: 'Revert to this checkpoint?',
          revertConfirmBody: 'Your working tree will be restored exactly to this point. A safety checkpoint is created automatically first, so this is itself undoable.',
          revertConfirmAction: 'Revert',
          reverting: 'Reverting…',
          revertFailed: 'Revert failed',
          crossBranchWarn: 'This checkpoint was created on branch "{{branch}}", which differs from the current branch.',
  ```
  Sibling `branch` block:
  ```ts
        branch: {
          current: 'Current branch',
          noBranch: '(no branch)',
          switchTitle: 'Switch branch',
          switchConfirmTitle: 'Switch to branch "{{branch}}"?',
          switchConfirmBody: 'This switches the git checkout to that branch. Uncommitted changes may be overwritten — confirm first.',
          switchConfirmAction: 'Switch',
          switching: 'Switching…',
          switchFailed: 'Could not switch branch',
        },
  ```

- [ ] 9.3 Add the SAME keys to `src/i18n/zh-TW.ts` at the matching locations:
  Inside `timelineView`:
  ```ts
          revert: '回退到此處',
          revertConfirmTitle: '回退到此檢查點？',
          revertConfirmBody: '工作區將精確還原到這一刻的狀態。回退前會自動建立一個安全檢查點，因此此操作本身可被撤銷。',
          revertConfirmAction: '回退',
          reverting: '回退中…',
          revertFailed: '回退失敗',
          crossBranchWarn: '此檢查點是在分支「{{branch}}」上建立的，與目前分支不同。',
  ```
  Sibling `branch` block:
  ```ts
        branch: {
          current: '目前分支',
          noBranch: '（無分支）',
          switchTitle: '切換分支',
          switchConfirmTitle: '切換到分支「{{branch}}」？',
          switchConfirmBody: '將切換 git 檢出到該分支。未提交的變更可能會被覆蓋，請先確認。',
          switchConfirmAction: '切換',
          switching: '切換中…',
          switchFailed: '切換分支失敗',
        },
  ```

- [ ] 9.4 Sanity-check the three locales have IDENTICAL key trees for the new keys by eye (same nesting, same key names). Full `yarn type-check` runs after Task 11 (the components that consume these keys aren't written yet).

- [ ] 9.5 Commit:
  ```
  git add src/i18n/zh-CN.ts src/i18n/en.ts src/i18n/zh-TW.ts
  git commit -m "feat(i18n): revert + branch keys (zh-CN/en/zh-TW)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 10 — diffStore: branches state + sessionService request/route

**Files:**
- Modify: `src/store/diffStore.ts` (A1 already added `checkpoints`/`commitLog`/`isGitRepo`/`currentBranch`; A2 adds `branches` + `setBranches`)
- Modify: `src/domain/sessionService.ts` (import; route the 3 new server msgs; add `requestBranches`/`switchBranch`/`revertCheckpoint`)
- Test: `src/domain/sessionService.test.ts` (extend)

**Steps:**

- [ ] 10.1 Write the failing tests. In `src/domain/sessionService.test.ts`, add a new `describe` block at the end of the file (after A1's `checkpoints + commit log` describe's closing `})`):
  ```ts
  describe('branches + revert', () => {
    it('requestBranches sends git:branch:list', () => {
      const t = new FakeTransport(); const svc = new SessionService(t)
      svc.requestBranches('s1')
      expect(t.sent.at(-1)).toMatchObject({ type: 'git:branch:list', sessionId: 's1' })
    })

    it('git:branch:list:result folds branches + currentBranch into diffStore', () => {
      const t = new FakeTransport(); new SessionService(t)
      t.push({ type: 'git:branch:list:result', sessionId: 's1', branches: [{ name: 'main', current: true }, { name: 'feature', current: false }], currentBranch: 'main' })
      const s = useDiffStore.getState().bySession['s1']
      expect(s.branches).toHaveLength(2)
      expect(s.currentBranch).toBe('main')
    })

    it('switchBranch sends git:branch:switch', () => {
      const t = new FakeTransport(); const svc = new SessionService(t)
      svc.switchBranch('s1', 'feature')
      expect(t.sent.at(-1)).toMatchObject({ type: 'git:branch:switch', sessionId: 's1', branch: 'feature' })
    })

    it('git:branch:switch:result on ok updates currentBranch and re-requests branches + checkpoints', () => {
      const t = new FakeTransport(); new SessionService(t)
      t.push({ type: 'git:branch:switch:result', sessionId: 's1', branch: 'feature', ok: true, currentBranch: 'feature' })
      expect(useDiffStore.getState().bySession['s1'].currentBranch).toBe('feature')
      expect(t.sent.some((m) => m.type === 'git:branch:list' && m.sessionId === 's1')).toBe(true)
      expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(true)
    })

    it('revertCheckpoint sends git:revert', () => {
      const t = new FakeTransport(); const svc = new SessionService(t)
      svc.revertCheckpoint('s1', 's1:t1')
      expect(t.sent.at(-1)).toMatchObject({ type: 'git:revert', sessionId: 's1', checkpointId: 's1:t1' })
    })

    it('git:revert:result on ok re-requests the checkpoint list + diff summary', () => {
      const t = new FakeTransport(); new SessionService(t)
      t.push({ type: 'git:revert:result', sessionId: 's1', checkpointId: 's1:t1', ok: true, safetyCheckpointId: 's1:pre-revert-1' })
      expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(true)
      expect(t.sent.some((m) => m.type === 'fs:diffSummary' && m.sessionId === 's1')).toBe(true)
    })
  })
  ```

- [ ] 10.2 Run them, see them fail: `yarn vitest run src/domain/sessionService.test.ts`. Expected FAIL: `svc.requestBranches is not a function`.

- [ ] 10.3 Add `branches` to the diffStore. In `src/store/diffStore.ts`:
  - In the `SessionDiff` interface (A1 added the checkpoint fields including `currentBranch`), add a `branches` field right after `currentBranch`:
    ```ts
    branches: import('@hip/protocol').Branch[]
    ```
    (Or, if A1's diffStore imports protocol types at the top via `import type { … } from '@hip/protocol'`, add `Branch` to that import and use the bare name `branches: Branch[]`.)
  - In `EMPTY_DIFF`, add `branches: []` to the object (next to A1's `currentBranch: null`).
  - In the `DiffStore` interface (the actions block), add after A1's `setCheckpoints` declaration:
    ```ts
    setBranches: (sessionId: string, branches: import('@hip/protocol').Branch[], currentBranch: string | null) => void
    ```
  - In the store body, add after A1's `setCheckpoints` implementation:
    ```ts
    setBranches: (id, branches, currentBranch) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, branches, currentBranch })) })),
    ```

- [ ] 10.4 Widen the sessionService import. In `src/domain/sessionService.ts` line 2 (A1 added `CheckpointMode`), keep that; no new protocol import is needed for these (the messages are typed via `ServerMessage`).

- [ ] 10.5 Route the three new server messages. In `receive` (in `src/domain/sessionService.ts`), after A1's `git:commitLog:result` branch, add:
  ```ts
      } else if (msg.type === 'git:branch:list:result') {
        useDiffStore.getState().setBranches(msg.sessionId, msg.branches, msg.currentBranch)
      } else if (msg.type === 'git:branch:switch:result') {
        if (msg.ok) {
          useDiffStore.getState().setBranches(msg.sessionId, useDiffStore.getState().bySession[msg.sessionId]?.branches ?? [], msg.currentBranch)
          // Branch changed → re-pull branches (current flag) + checkpoints (branch labels) + diff summary.
          this.transport.send({ type: 'git:branch:list', sessionId: msg.sessionId })
          this.transport.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
          const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
          this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
        }
      } else if (msg.type === 'git:revert:result') {
        if (msg.ok) {
          // Worktree changed → refresh the checkpoint list (safety checkpoint was added) + diff badge.
          this.transport.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
          const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
          this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
        }
  ```

- [ ] 10.6 Add the public methods. After A1's `requestCommitLog` method (in `src/domain/sessionService.ts`), add:
  ```ts
    /** Pull the branch list (+ current) for the BranchSwitcher. */
    requestBranches(sessionId: string): void {
      this.transport.send({ type: 'git:branch:list', sessionId })
    }

    /** Switch the checkout to a branch. The :result re-pulls branches + checkpoints + diff. */
    switchBranch(sessionId: string, branch: string): void {
      this.transport.send({ type: 'git:branch:switch', sessionId, branch })
    }

    /** Revert the worktree to a checkpoint (worktree-only; a safety checkpoint is written first). */
    revertCheckpoint(sessionId: string, checkpointId: string): void {
      this.transport.send({ type: 'git:revert', sessionId, checkpointId })
    }
  ```

- [ ] 10.7 Run them, see them pass: `yarn vitest run src/domain/sessionService.test.ts`. Expected: the new `branches + revert` describe green; all A1 + base tests still green.

- [ ] 10.8 Commit:
  ```
  git add src/store/diffStore.ts src/domain/sessionService.ts src/domain/sessionService.test.ts
  git commit -m "feat(domain): branches state + requestBranches/switchBranch/revertCheckpoint in sessionService

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 11 — TimelineView 回退 button + confirm modal; BranchSwitcher; ArtifactPanel header

This is the green gate — after this task `yarn type-check` must pass.

**Files:**
- Create: `src/components/artifact/BranchSwitcher.tsx`
- Modify: `src/components/artifact/TimelineView.tsx` (add a 回退 button per turn row + a confirm `Modal` + cross-branch warning)
- Modify: `src/components/artifact/ArtifactPanel.tsx` (mount `<BranchSwitcher>` in the header when `isGitRepo`)
- Test: none (UI rendering = manual GUI; all logic that can be unit-tested lives in sessionService/diffStore which are covered)

**Steps:**

- [ ] 11.1 Create `src/components/artifact/BranchSwitcher.tsx`. Current-branch chip + a dropdown of branches + a switch-confirm `Modal`. Reuses the existing `DropdownMenu` and `Modal` primitives:
  ```tsx
  import { useEffect, useState } from 'react'
  import { useTranslation } from 'react-i18next'
  import { GitBranch, Check, ChevronDown, Loader2 } from 'lucide-react'
  import { cn } from '@/lib/utils'
  import { useDomainStore } from '@/domain/sessionStore'
  import { sessionService } from '@/domain/sessionService'
  import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
  import { Modal } from '@/components/ui/Modal'
  import { Button } from '@/components/ui/Button'
  import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/DropdownMenu'

  /** Panel-header current-branch chip + branch dropdown + a switch-confirm modal. */
  export function BranchSwitcher() {
    const { t } = useTranslation()
    const sessionId = useDomainStore((s) => s.activeSessionId)
    const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
    const [pending, setPending] = useState<string | null>(null) // branch awaiting confirm
    const [switching, setSwitching] = useState(false)

    // Pull the branch list on mount / session change so the chip + dropdown are populated.
    useEffect(() => { if (sessionId) sessionService.requestBranches(sessionId) }, [sessionId])

    // Clear the switching spinner once the current branch reflects the pending target.
    useEffect(() => {
      if (switching && pending && diff.currentBranch === pending) { setSwitching(false); setPending(null) }
    }, [switching, pending, diff.currentBranch])

    if (!sessionId) return null
    const current = diff.currentBranch
    const branches = diff.branches

    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="branch-chip"
              className="flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-caption text-ink-secondary hover:bg-surface-muted"
              title={t('artifact.branch.current')}
            >
              <GitBranch size={12} className="shrink-0" />
              <span className="max-w-[120px] truncate">{current ?? t('artifact.branch.noBranch')}</span>
              <ChevronDown size={12} className="shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('artifact.branch.switchTitle')}</DropdownMenuLabel>
            {branches.map((b) => (
              <DropdownMenuItem
                key={b.name}
                data-testid="branch-option"
                onSelect={() => { if (!b.current) setPending(b.name) }}
                className="justify-between text-body"
              >
                <span className="truncate">{b.name}</span>
                {b.current && <Check size={14} className="shrink-0 text-accent" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Modal open={!!pending} onOpenChange={(o) => { if (!o && !switching) setPending(null) }} title={t('artifact.branch.switchConfirmTitle', { branch: pending ?? '' })}>
          <div className="flex flex-col gap-4 p-5">
            <p className="text-body text-ink-secondary">{t('artifact.branch.switchConfirmBody')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={switching} onClick={() => setPending(null)}>{t('common.cancel')}</Button>
              <Button
                size="sm"
                disabled={switching}
                data-testid="branch-switch-confirm"
                onClick={() => { if (pending) { setSwitching(true); sessionService.switchBranch(sessionId, pending) } }}
              >
                {switching && <Loader2 size={13} className={cn('mr-1.5 animate-spin')} />}
                {switching ? t('artifact.branch.switching') : t('artifact.branch.switchConfirmAction')}
              </Button>
            </div>
          </div>
        </Modal>
      </>
    )
  }
  ```
  Note: this uses `common.cancel` and `common.close` — verify `common.cancel` exists in the i18n type source; if it does not, this component would break `tsc`. Confirm with `grep -n "cancel:" src/i18n/zh-CN.ts`. If `common.cancel` is missing, add `cancel` keys to the `common` block in all three locales as part of Task 9 (re-open Task 9 and add `common.cancel` = 取消 / Cancel / 取消) before writing this component.

- [ ] 11.2 Verify `common.cancel` exists. Run: `grep -n "cancel" src/i18n/zh-CN.ts`. If it returns a `cancel:` under a `common:` block, proceed. If NOT, add to all three locales (zh-CN/en/zh-TW) inside their `common: { … }` block: `cancel: '取消'` / `cancel: 'Cancel'` / `cancel: '取消'`, then re-stage those i18n files.

- [ ] 11.3 Add the 回退 button + confirm modal + cross-branch warning to `src/components/artifact/TimelineView.tsx`. A1's TimelineView renders a checkpoint list (rows) and an inline diff. Make these changes:
  - Add imports at the top (merge with A1's existing imports):
    ```tsx
    import { useState } from 'react'
    import { RotateCcw, AlertTriangle } from 'lucide-react'
    import { Modal } from '@/components/ui/Modal'
    import { Button } from '@/components/ui/Button'
    ```
    (A1 already imports `useEffect`, `useTranslation`, `cn`, the stores, `DiffDisplay`/`Empty`, `checkpointModeOptions`, `formatRelativeTime`. Add `useState` to the existing `react` import; add the lucide icons to the existing `lucide-react` import.)
  - Inside the `TimelineView` component body, after A1's existing hooks (e.g. `const setMode = useUiStore((s) => s.setCheckpointMode)`), add revert state:
    ```tsx
      const [revertTarget, setRevertTarget] = useState<string | null>(null) // checkpointId awaiting confirm
      const [reverting, setReverting] = useState(false)
      // Clear the modal once a revert round-trips (the checkpoint list refreshes with a new safety checkpoint).
      useEffect(() => { if (reverting) { setReverting(false); setRevertTarget(null) } }, [diff.checkpoints.length]) // eslint-disable-line react-hooks/exhaustive-deps
    ```
  - In A1's checkpoint-row `<button>` map, A1 renders each row as a button with a label + timestamp. Wrap the row so the 回退 action sits beside it WITHOUT nesting a button-in-button. Replace A1's row markup (the `<button … data-testid="timeline-row">…</button>` element) with a row container that has the selectable area plus a revert button — for a `turn` or `pre-revert` checkpoint only (never `start`, which has no "here" to revert to in a meaningful way — actually `start` IS revertable as "session start", so include it; only skip if you want — keep it simple and show 回退 on every checkpoint EXCEPT none):
    ```tsx
              <div key={c.id} data-testid="timeline-row" className={cn('flex w-full items-center gap-1 px-3 py-1.5 hover:bg-surface-muted', c.id === activeId && 'bg-accent/10')}>
                <button
                  onClick={() => useDiffStore.getState().setActiveCheckpoint(sessionId, c.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-meta"
                >
                  <span className="min-w-0 truncate text-ink">{label}</span>
                  <span className="shrink-0 text-caption text-ink-tertiary">{formatRelativeTime(c.createdAt, i18n.language)}</span>
                </button>
                <button
                  data-testid="timeline-revert"
                  title={t('artifact.timelineView.revert')}
                  onClick={() => setRevertTarget(c.id)}
                  className="shrink-0 rounded p-1 text-ink-tertiary opacity-0 transition-opacity hover:bg-surface hover:text-ink group-hover:opacity-100"
                >
                  <RotateCcw size={13} />
                </button>
              </div>
    ```
    Note: the `opacity-0 … group-hover:opacity-100` needs the row's parent list container to have a `group` class, OR drop the opacity classes to always show the icon. Simplest: drop `opacity-0 … group-hover:opacity-100` and keep the icon always visible (`className="shrink-0 rounded p-1 text-ink-tertiary hover:bg-surface hover:text-ink"`). Use the always-visible variant to avoid a `group` dependency.
  - At the end of the component's returned JSX (just before the outermost closing `</div>`), add the confirm `Modal`. Resolve the target checkpoint + cross-branch flag:
    ```tsx
        {/* revert confirm */}
        {(() => {
          const target = diff.checkpoints.find((c) => c.id === revertTarget)
          const crossBranch = !!target && !!target.branch && !!diff.currentBranch && target.branch !== diff.currentBranch
          return (
            <Modal open={!!revertTarget} onOpenChange={(o) => { if (!o && !reverting) setRevertTarget(null) }} title={t('artifact.timelineView.revertConfirmTitle')}>
              <div className="flex flex-col gap-4 p-5">
                <p className="text-body text-ink-secondary">{t('artifact.timelineView.revertConfirmBody')}</p>
                {crossBranch && (
                  <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-meta text-ink">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                    <span>{t('artifact.timelineView.crossBranchWarn', { branch: target!.branch })}</span>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" disabled={reverting} onClick={() => setRevertTarget(null)}>{t('common.cancel')}</Button>
                  <Button
                    size="sm"
                    disabled={reverting}
                    data-testid="timeline-revert-confirm"
                    onClick={() => { if (revertTarget) { setReverting(true); sessionService.revertCheckpoint(sessionId, revertTarget) } }}
                  >
                    {reverting && <Loader2 size={13} className="mr-1.5 animate-spin" />}
                    {reverting ? t('artifact.timelineView.reverting') : t('artifact.timelineView.revertConfirmAction')}
                  </Button>
                </div>
              </div>
            </Modal>
          )
        })()}
    ```
    Add `Loader2` to A1's lucide import if it's not already there (A1's TimelineView imports `Loader2` for the diff-loading spinner, so it is present).

- [ ] 11.4 Mount `<BranchSwitcher>` in the panel header. In `src/components/artifact/ArtifactPanel.tsx` (A1's version), the header `<div … border-b … px-2>` holds the `<TabsList>` and the close `<Button>`. Import the switcher and render it between the tabs and the close button, only when `isGitRepo`:
  - Add the import (with A1's other artifact imports):
    ```tsx
    import { BranchSwitcher } from './BranchSwitcher'
    ```
  - In the header row, change A1's close-button wrapper. A1 renders:
    ```tsx
            <Button variant="ghost" size="icon" onClick={togglePanel} title={t('artifact.closePanel')} data-tauri-drag-region="false">
              <X size={16} />
            </Button>
    ```
    Wrap it so the BranchSwitcher sits to its left:
    ```tsx
            <div className="flex items-center gap-2" data-tauri-drag-region="false">
              {isGitRepo && <BranchSwitcher />}
              <Button variant="ghost" size="icon" onClick={togglePanel} title={t('artifact.closePanel')}>
                <X size={16} />
              </Button>
            </div>
    ```
    (`isGitRepo` is already computed in A1's ArtifactPanel.)

- [ ] 11.5 Typecheck — the green gate: `yarn type-check`. Expected: passes. If it flags a missing `common.cancel` key, you skipped step 11.2 — go add it to all three locales and re-run.

- [ ] 11.6 Run the frontend domain suite to confirm nothing regressed: `yarn vitest run src/domain/sessionService.test.ts`. Expected: green.

- [ ] 11.7 Commit:
  ```
  git add src/components/artifact/BranchSwitcher.tsx src/components/artifact/TimelineView.tsx src/components/artifact/ArtifactPanel.tsx
  git commit -m "feat(artifact): revert button + confirm; BranchSwitcher + cross-branch warning

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## TASK 12 — full-suite verification (paid-free)

**Files:** none (verification only)

**Steps:**

- [ ] 12.1 Guard against paid tests: move the API-key file aside so no real-LLM suite can fire even if a path is fat-fingered.
  ```
  test -f ~/.hip/config/auth.json && mv ~/.hip/config/auth.json ~/.hip/config/auth.json.bak || echo "no auth.json — already paid-free"
  ```

- [ ] 12.2 Run the full test suite: `yarn test`. Expected: all suites green. Real-LLM suites `skipIf`-skip (no key). If any non-LLM suite fails, fix it before proceeding (use superpowers:systematic-debugging).

- [ ] 12.3 Restore the key file:
  ```
  test -f ~/.hip/config/auth.json.bak && mv ~/.hip/config/auth.json.bak ~/.hip/config/auth.json || echo "nothing to restore"
  ```

- [ ] 12.4 Final typecheck: `yarn type-check`. Expected: passes.

- [ ] 12.5 Confirm the working tree is clean and you are still on the right branch (subagent-git-checkout trap): `git status` (clean), `git branch --show-current` (your A2 branch — NOT a branch a test left behind), and `git log --oneline -12` (the A2 commits in order). If `git branch --show-current` is unexpected, a git-capable subagent or a test left the checkout switched — `git switch` back to your A2 branch (your named commits survive).

---

## Manual GUI Acceptance

Run the app (`yarn tauri dev` or the project's launch skill) with a real DeepSeek-compatible key configured. Bind a project folder that IS a git repo with at least one commit and at least two branches (e.g. `git branch feature`).

- [ ] Open the right panel in a git-repo cwd. The header shows a **current-branch chip** (e.g. `main`) to the left of the close button. In a non-repo cwd, no chip shows.
- [ ] Click the branch chip → a dropdown lists local branches with a check on the current one. Selecting a different branch opens a **switch-confirm modal** with the body warning about uncommitted changes.
- [ ] Confirm the switch → the checkout switches; the chip updates to the new branch; the 时间线 + 更改 tabs refresh. In a terminal, `git branch --show-current` reflects the new branch.
- [ ] Cancel the switch modal → nothing changes; you stay on the current branch.
- [ ] Send a turn that edits a file. After it completes, open **时间线**: a new checkpoint row appears with a 回退 (revert) icon button on the right.
- [ ] Click 回退 on a turn checkpoint → a **revert-confirm modal** opens, explaining the exact restore + automatic safety checkpoint. Confirm → the worktree is restored to that checkpoint's state (edits after it are undone; files added after it are deleted). A new **安全检查点 (pre-revert safety)** row appears at the top of the timeline (the revert is itself undoable — revert to that safety checkpoint to get back).
- [ ] Confirm HEAD never moved during a revert: `git rev-parse HEAD` before and after a revert is unchanged (revert is worktree-only).
- [ ] Revert on an unborn-HEAD repo: in a freshly `git init`'d folder (no commits), send a turn, then revert checkpoint #0 → the worktree restores without error.
- [ ] Cross-branch warning: switch to `feature`, send a turn (creating a checkpoint on `feature`), switch back to `main`, then open 时间线 and click 回退 on the `feature` checkpoint → the confirm modal shows the amber **cross-branch warning** naming the branch the checkpoint was created on.
- [ ] Ask the agent to "commit your changes" (or let it commit proactively after a unit of work). The agent calls **git_commit**; the new commit appears in the **更改 → 提交记录** list (session-start → HEAD), newest-first, authored by your git identity with a `Co-authored-by: hip` trailer (verify in a terminal: `git log -1 --format='%an <%ae>%n%b'`). If your repo has no user identity configured, the commit is authored `hip <hip@local>` with no trailer.
- [ ] Ask the agent to "create a branch called X and switch to it." The agent calls **git_create_branch** then **git_switch_branch**; the branch chip updates to `X` and the branch dropdown lists it.
- [ ] In a pure-chat session (no bound project dir), the agent has NO git tools (it should say it can't commit without a project folder, not hallucinate a commit) — confirm no `git_commit` tool call appears in the timeline.
- [ ] Switch UI language (简体 / English / 繁體) → all revert/branch labels, confirm-modal titles/bodies, and the cross-branch warning translate; no raw i18n keys appear.
- [ ] A turn that makes NO file changes still does NOT add a checkpoint row (A1 empty-turn skip is unaffected); `git_commit` on a clean tree returns an error string (visible in the tool output) rather than an empty commit.

The plan is saved to `/Users/lijiamin/data/my-github/hip/docs/superpowers/plans/2026-06-13-gitpanel-a2-writes.md`.
